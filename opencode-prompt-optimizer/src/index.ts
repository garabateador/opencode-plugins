import { Plugin } from "@opencode/plugin"
import { buildPrompt, detectLanguage, gatherProjectContext, stripDraftPrefix, stripThinkBlocks, type ProjectContext, type VcsSnapshot } from "./engine"
import { Optimize, type LanguageSetting, type OptimizeInput } from "./rpc"

/**
 * Server part of opencode-prompt-optimizer for OpenCode v2.
 *
 * V1 did all of this in the TUI part (api.client.session.create →
 * session.prompt → poll session.messages → session.delete). V2 replaces
 * that four-call-plus-polling dance with one call to the session-less
 * generation API (ctx.experimental.generate.text) and serves TUI, GUI,
 * and external clients through the typed RPC in src/rpc.ts.
 */

type ModelSpec = { providerID: string; modelID: string }

export type PluginOptions = {
  /** "auto" (default) detects CJK text → zh, otherwise en. */
  language?: LanguageSetting
  /** Force a model. Default: the location's default model (V1: inherit the main agent's model). */
  overrideModel?: ModelSpec
  /** Model variant name, e.g. "none" to turn thinking off. Provider-specific, silent fallback. */
  variant?: string
  /** Read package.json + rule files + git state into the system prompt. Default true. */
  includeContext?: boolean
  /** Single optimization time budget in ms. Default 120_000. */
  timeoutMs?: number
  /** V1 polling option; V2 uses one-shot generation and ignores it. */
  pollIntervalMs?: number
}

const DEFAULT_TIMEOUT_MS = 120_000
const CONTEXT_TTL_MS = 5 * 60 * 1000

/** V1 semantics: the whole per-directory context (docs + git) is cached for 5 minutes. */
const contextCache = new Map<string, { at: number; value: Promise<ProjectContext | null> }>()

export default Plugin.define({
  id: "prompt-optimizer",
  async setup(ctx) {
    const options: PluginOptions = ctx.options ?? {}
    const timeoutMs =
      typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS
    if (options.pollIntervalMs !== undefined) {
      console.error("[prompt-optimizer] option pollIntervalMs is a V1 artifact; V2 one-shot generation ignores it")
    }

    console.error("[prompt-optimizer] server part loaded", {
      language: options.language ?? "auto",
      model: options.overrideModel ?? "(inherit default model)",
      variant: options.variant ?? "(none)",
      includeContext: options.includeContext !== false,
      timeoutMs,
      directory: ctx.location.directory,
    })

    // Keep the context cache bounded; also demonstrates the V2 cleanup
    // convention (V1 had no unload lifecycle at all).
    const cachePruner = setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of contextCache) if (now - entry.at >= CONTEXT_TTL_MS) contextCache.delete(key)
    }, 60_000)

    // V2 parity of the V1 note "variant 未注册时静默回退": v2's generation
    // API hard-fails on unregistered variants, so verify against the model's
    // variant list and drop the variant silently when it is not available.
    const applyVariantGuard = async (
      model: { providerID: string; id: string; variant?: string } | undefined,
    ): Promise<{ providerID: string; id: string; variant?: string } | undefined> => {
      if (!model?.variant) return model
      try {
        const listed = await ctx.model.list()
        const info = listed.data?.find((entry) => entry.providerID === model.providerID && entry.modelID === model.id)
        if (!info || !info.variants.some((entry) => entry.id === model.variant)) {
          console.error("[prompt-optimizer] variant not registered, falling back to model default:", model.variant)
          const { variant: _drop, ...rest } = model
          return rest
        }
      } catch (error) {
        console.error("[prompt-optimizer] model list failed, dropping variant:", error)
        const { variant: _drop, ...rest } = model
        return rest
      }
      return model
    }

    const resolveModel = async (
      explicit?: { providerID: string; modelID: string; variant?: string },
    ): Promise<{ providerID: string; id: string; variant?: string } | undefined> => {
      // Highest priority: the model the caller selected in its composer/prompt
      // ("使用对话框所选择的当前模型"). Falls through to the plugin options,
      // then to the location default below.
      if (explicit) {
        return applyVariantGuard({
          providerID: explicit.providerID,
          id: explicit.modelID,
          ...(explicit.variant ? { variant: explicit.variant } : {}),
        })
      }
      if (options.overrideModel) {
        const spec = {
          providerID: options.overrideModel.providerID,
          id: options.overrideModel.modelID,
          ...(options.variant ? { variant: options.variant } : {}),
        }
        return applyVariantGuard(spec)
      }
      // V1 attached the variant to the inherited session model; V2 does the
      // same against the location's default model. Without a default, the
      // server picks the model and the variant cannot apply (silent fallback).
      if (options.variant) {
        try {
          const selected = await ctx.model.default()
          if (selected?.data)
            return applyVariantGuard({
              providerID: selected.data.providerID,
              id: selected.data.modelID,
              variant: options.variant,
            })
        } catch (error) {
          console.error("[prompt-optimizer] model.default failed, variant dropped:", error)
        }
      }
      return undefined
    }

    // V1 ran execFileSync("git", ...) in the TUI process. V2 asks the
    // server's VCS domain for the same snapshot, scoped to the caller's
    // directory (works on remote servers too). No repository → null.
    const vcsSnapshot = async (directory: string): Promise<VcsSnapshot | null> => {
      try {
        let branch = ""
        try {
          const info = await ctx.vcs.get({ location: { directory } })
          branch = info.data?.branch?.current ?? ""
        } catch {
          return null
        }
        if (!branch) return null
        let modifiedFiles: string[] = []
        try {
          const status = await ctx.vcs.status({ location: { directory } })
          for (const entry of status.data ?? []) {
            const file = typeof entry.file === "string" ? entry.file : ""
            const path = file.includes(" -> ") ? (file.split(" -> ").pop() ?? "") : file
            if (path && !path.startsWith("node_modules/")) modifiedFiles.push(path)
            if (modifiedFiles.length >= 12) break
          }
        } catch {
          modifiedFiles = []
        }
        return { branch, modifiedFiles }
      } catch {
        return null
      }
    }

    const projectContext = (directory: string): Promise<ProjectContext | null> => {
      const hit = contextCache.get(directory)
      if (hit && Date.now() - hit.at < CONTEXT_TTL_MS) return hit.value
      const value = (async () => {
        const vcs = await vcsSnapshot(directory)
        // V1 parity: no package.json → no project context at all (docs and
        // git are not gathered either).
        return gatherProjectContext(directory, vcs)
      })()
      contextCache.set(directory, { at: Date.now(), value })
      return value
    }

    const withTimeout = <T,>(promise: Promise<T>, ms: number, external?: AbortSignal): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => finish(() => reject(new Error(`${Math.round(ms / 1000)}s timeout`))), ms)
        const finish = (run: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          external?.removeEventListener("abort", onAbort)
          run()
        }
        const onAbort = () => finish(() => reject(new Error("cancelled")))
        if (external) {
          if (external.aborted) return onAbort()
          external.addEventListener("abort", onAbort, { once: true })
        }
        promise.then(
          (value) => finish(() => resolve(value)),
          (error) => finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
        )
      })

    await ctx.rpc.register(Optimize, {
      optimize: async (rawInput, context) => {
        // JSON Schema inputs arrive as `unknown` (Rpc.Output): narrow to the
        // contract type declared in src/rpc.ts.
        const input = rawInput as OptimizeInput
        const raw = String(input.text ?? "").trim()
        if (!raw) {
          return context.error("failed", "Input is empty, nothing to optimize", {
            message: "Input is empty, nothing to optimize",
          })
        }

        const setting: LanguageSetting = input.language ?? options.language ?? "auto"
        const language = setting === "auto" ? detectLanguage(raw) : setting
        const directory = input.directory || ctx.location.directory

        const includeContext = options.includeContext !== false
        const project = includeContext ? await projectContext(directory) : null
        const prompt = buildPrompt({ lang: language, project, raw, directory })

        console.error("[prompt-optimizer] run", {
          directory,
          contextUsed: project !== null,
          docsBytes: project?.docs.length ?? 0,
          gitBytes: project?.git.length ?? 0,
        })

        const model = await resolveModel(input.model)
        try {
          // One server-side call replaces V1's session create → prompt →
          // poll → delete. No session exists, no tools run, nothing is
          // added to any session history.
          const generated = await withTimeout(
            ctx.experimental.generate.text({ prompt, model }),
            timeoutMs,
            context.signal,
          )
          // Model output may still carry the old "[DRAFT]" convention
          // (V1 heritage) — strip any leading marker defensively.
          const text = stripDraftPrefix(stripThinkBlocks(generated.text))
          if (!text) {
            return context.error("failed", "Optimization failed: empty model response", {
              message: "Optimization failed: empty model response",
            })
          }
          return { text, language, contextUsed: project !== null }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error("[prompt-optimizer] enhance failed:", message)
          return context.error("failed", `Optimization failed: ${message}`, { message })
        }
      },
    })

    return () => {
      clearInterval(cachePruner)
      contextCache.clear()
    }
  },
})