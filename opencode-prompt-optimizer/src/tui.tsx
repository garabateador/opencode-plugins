/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { Optimize, type ModelRef, type OptimizeOutput } from "./rpc"

/**
 * TUI part of opencode-prompt-optimizer for OpenCode v2.
 *
 * V1 replaced the whole Prompt component through the `home_prompt` /
 * `session_prompt` slots and wrote the result back with TuiPromptRef.set().
 * V2 removes those slots and exposes no prompt read/write API, so the same
 * behavior is delivered through the V2 surfaces instead:
 *
 * - ✦ icon lives at the bottom-right of the input box (claimed via the
 *   documented `prompt.footer` slot trail — the footer row is a
 *   space-between flex row, appended claims render last)
 * - `/optimize [text]` slash command + palette command (arguments: true
 *   keeps the typed text and passes it to run())
 * - result delivery: `delivery` option, "insert" (default) replaces the
 *   input box content in place (the V1 ref.set / Desktop composer.setText
 *   parity: locate the prompt's TextareaRenderable through the renderer
 *   tree and drive EditBuffer.replaceText — an OpenTUI-internal surface
 *   that silently falls back to the dialog if the host moves), "dialog"
 *   opens the draft for review with one-key OSC-52 clipboard copy (`c`)
 */

type TuiOptions = {
  /** Result delivery: "insert" (default) replaces the input in place; "dialog" opens the review dialog. */
  delivery?: "dialog" | "insert"
}

const IDLE_ICON = "\u2727"
const SPINNER_FRAMES = ["\u281B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u280F"]

const TOAST = {
  success: "Optimized (review before sending)",
  replaced: "Optimized — replaced into the input, review before sending",
  failedTitle: "Optimization failed",
  emptyInput: "Input is empty, nothing to optimize",
}

// RPC/transport rejections arrive in several shapes (ClientError with .data,
// nested .cause, plain RpcError body objects). Resolve the human message
// without ever rendering "[object Object]".
const messageOf = (error: unknown): string => {
  if (typeof error === "string") return error
  const source = (error ?? {}) as Record<string, unknown>
  const candidates: unknown[] = [
    (source as { data?: { message?: unknown } }).data,
    source.cause,
    (source.cause as { data?: { message?: unknown } } | undefined)?.data,
  ]
  for (const candidate of candidates) {
    const message = (candidate as { message?: unknown } | undefined)?.message
    if (typeof message === "string" && message.length > 0) return message
  }
  if (error instanceof Error && error.message) return error.message
  const direct = (source as { message?: unknown }).message
  if (typeof direct === "string" && direct.length > 0) return direct
  try {
    const json = JSON.stringify(error)
    if (json && json !== "undefined") return json.slice(0, 240)
  } catch {
    /* fall through */
  }
  return String(error)
}

export default Plugin.define({
  id: "prompt-optimizer.tui",
  setup(context) {
    const options: TuiOptions = (context.options ?? {}) as TuiOptions
    const delivery = options.delivery ?? "insert"
    const [pending, setPending] = createSignal(0)
    const [frame, setFrame] = createSignal(0)
    let spinnerTimer: ReturnType<typeof setInterval> | undefined

    createEffect(() => {
      if (pending() > 0) {
        if (!spinnerTimer) spinnerTimer = setInterval(() => setFrame((value) => (value + 1) % SPINNER_FRAMES.length), 80)
      } else if (spinnerTimer) {
        clearInterval(spinnerTimer)
        spinnerTimer = undefined
        setFrame(0)
      }
    })
    onCleanup(() => {
      if (spinnerTimer) clearInterval(spinnerTimer)
    })

    const rpc = () => context.client.rpc(Optimize)

    /**
     * Locate the composer's textarea by walking the renderer's renderable
     * tree (renderer.root → getChildren). The prompt input is a
     * TextareaRenderable (an EditBufferRenderable); the app's own
     * tui.prompt.append handler drives exactly this object. Detection is
     * defensive: prefer instanceof against the runtime class, fall back to
     * the method signature, and prefer the focused instance when several
     * exist.
     */
    let promptInputCache: { node: unknown } | undefined
    const findPromptInput = async (): Promise<any | undefined> => {
      const cached = (promptInputCache?.node ?? undefined) as any
      if (cached && cached?.parent) return cached
      promptInputCache = undefined
      try {
        const coreModule = (await import("@opentui/core")) as any
        const textareaClass = coreModule?.TextareaRenderable
        const found: unknown[] = []
        const visit = (node: any, depth: number): void => {
          if (!node || depth > 80 || found.length >= 12) return
          const isTextarea = textareaClass ? node instanceof textareaClass : false
          const duck =
            typeof node.replaceText === "function" &&
            typeof node.insertText === "function" &&
            typeof node.gotoBufferEnd === "function" &&
            typeof node.getTextRange === "function"
          if (isTextarea || duck) {
            found.push(node)
            return
          }
          const children = typeof node.getChildren === "function" ? node.getChildren() : []
          for (const child of children) visit(child, depth + 1)
        }
        visit((context.renderer as unknown as { root: unknown }).root, 0)
        probeCount = found.length
        console.error("[prompt-optimizer] textarea probe:", {
          textareas: found.length,
          focusedFlags: found.map((candidate) => Boolean((candidate as any).focused)),
        })
        if (found.length === 0) return undefined
        const focused = found.find((candidate) => (candidate as any).focused === true)
        const chosen = focused ?? found[0]
        promptInputCache = { node: chosen }
        return chosen
      } catch {
        return undefined
      }
    }

    let probeCount = -1
    let probeReadback = "n/a"

    /** Read the composer's current content through the same internal channel
     *  as the write side. Returns undefined when the textarea cannot be
     *  located (caller falls back to the review dialog). */
    const readComposerText = async (): Promise<string | undefined> => {
      try {
        const input = await findPromptInput()
        if (!input || typeof input.getTextRange !== "function") return undefined
        const text = typeof input.plainText === "string" ? input.plainText : input.getTextRange(0, 20_000)
        return typeof text === "string" ? text : undefined
      } catch {
        return undefined
      }
    }

    /** In-place replacement of the composer content. Returns false when the
     *  textarea cannot be located or the write cannot be verified (caller
     *  falls back to the dialog flow). */
    const replaceComposerText = async (text: string): Promise<boolean> => {
      try {
        const input = await findPromptInput()
        if (!input || typeof input.replaceText !== "function") {
          probeReadback = "no textarea"
          console.error("[prompt-optimizer] insert unavailable: no textarea located")
          return false
        }
        input.replaceText(text)
        if (typeof input.invalidateIntrinsicSize === "function") input.invalidateIntrinsicSize()
        if (typeof input.gotoBufferEnd === "function") input.gotoBufferEnd()
        context.renderer.requestRender?.()
        // Read back: the EditBuffer is authoritative for submissions, so a
        // mismatch means the replacement did not take and we fall back.
        const read = typeof input.getTextRange === "function" ? input.getTextRange(0, 4_000) : undefined
        const matches = typeof read === "string" ? read.replace(/\s+$/g, "") === text.replace(/\s+$/g, "") : false
        if (!matches) {
          probeReadback = `mismatch:${typeof read === "string" ? JSON.stringify(read.slice(0, 40)) : typeof read}`
          console.error("[prompt-optimizer] insert readback mismatch:", probeReadback)
        }
        return matches
      } catch (error) {
        probeReadback = `threw:${String(error).slice(0, 60)}`
        console.error("[prompt-optimizer] in-place replace failed:", error)
        return false
      }
    }

    const optimize = async (raw: string): Promise<OptimizeOutput | undefined> => {
      if (pending() > 0) return undefined
      setPending((count) => count + 1)
      try {
        const directory = context.location?.directory
        // Follow the model currently selected in the prompt (可配置的模型).
        // While the catalog loads current() is undefined → the server falls
        // back to its options/default.
        let model: ModelRef | undefined
        try {
          const selected = context.ui.model.current()
          if (selected) model = { providerID: selected.providerID, modelID: selected.modelID, ...(selected.variant ? { variant: selected.variant } : {}) }
        } catch {
          model = undefined
        }
        // RPC output is `unknown` (JSON Schema): narrow to the contract type.
        // `location` resolves the server-side registry of this plugin's
        // workspace; `directory` (input) drives project awareness. They are
        // the same path here, but the shared-server topology can resolve the
        // RPC against the server's default location without `location`.
        const location = directory ? { location: { directory } } : undefined
        const result = (await rpc().optimize(
          { text: raw, model, ...(directory ? { directory } : {}) },
          location,
        )) as OptimizeOutput
        if (delivery === "insert") {
          const replaced = await replaceComposerText(result.text)
          if (replaced) {
            context.ui.toast.show({ variant: "success", message: TOAST.replaced })
            return result
          }
          // In-place replacement unavailable (host internals moved): keep
          // the review dialog as the compliant fallback; carry the probe
          // diagnostics so the state stays visible on screen.
          const note = `in-place replace unavailable — textareas: ${probeCount}, readback: ${
            typeof probeReadback === "string" ? probeReadback : "n/a"
          }`
          context.ui.toast.show({ variant: "success", message: TOAST.success })
          showDraft(result, note)
          return result
        }
        context.ui.toast.show({ variant: "success", message: TOAST.success })
        showDraft(result)
        return result
      } catch (error) {
        const message = messageOf(error)
        console.error("[prompt-optimizer] enhance failed:", message)
        context.ui.toast.show({
          variant: "error",
          title: TOAST.failedTitle,
          message: message.slice(0, 240),
          duration: 8000,
        })
        return undefined
      } finally {
        setPending((count) => count - 1)
      }
    }

    const showDraft = (result: OptimizeOutput, note?: string) => {
      context.ui.dialog.show(() => {
        const [copied, setCopied] = createSignal(false)
        const dimensions = useTerminalDimensions()
        const maxHeight = () => Math.max(8, Math.floor(dimensions().height * 0.6))

        const copy = () => {
          // Clipboard is not part of the plugin SDK; the renderer's OSC-52
          // write is the supported path and reaches the host clipboard on
          // every terminal that implements it.
          const written = context.renderer.copyToClipboardOSC52(result.text)
          if (written) {
            setCopied(true)
            return
          }
          context.ui.toast.show({
            variant: "warning",
            message: "Copy failed: terminal does not support OSC-52. Select the text with the mouse and copy it.",
            duration: 8000,
          })
        }

        // Scoped to this dialog component: unmounted together with it.
        context.keymap.layer(() => ({
          mode: "modal",
          commands: [{ bind: "c", title: "Copy draft", group: "Prompt Optimizer", run: copy }],
        }))

        return (
          <box flexDirection="column" paddingBottom={1}>
            <box paddingLeft={1} paddingRight={1} paddingTop={1}>
              <text attributes={TextAttributes.BOLD} fg={context.theme.text.base} wrapMode="none">
                Optimized draft — review, edit, then paste into the input and send
              </text>
            </box>
            <Show when={note}>
              <box paddingLeft={1} paddingRight={1}>
                <text fg={context.theme.hue.accent[500]} wrapMode="none">
                  {note}
                </text>
              </box>
            </Show>
            <scrollbox maxHeight={maxHeight()} scrollbarOptions={{ visible: false }}>
              <box paddingLeft={1} paddingRight={1}>
                <text fg={context.theme.text.muted} wrapMode="word">
                  {result.text}
                </text>
              </box>
            </scrollbox>
            <box paddingLeft={1} paddingRight={1} paddingTop={1}>
              <text fg={context.theme.text.faint} wrapMode="none">
                {`esc close · c copy${copied() ? " · ✓ copied" : ""}`}
              </text>
            </box>
          </box>
        )
      })
    }

    const runWithText = async (raw: string) => {
      // Delivery (in-place replace / dialog) is fully handled inside
      // optimize(); the result is returned for callers that only need to
      // know the run succeeded.
      await optimize(raw)
    }

    const runCommand = async (input?: string) => {
      const raw = input?.trim()
      if (input !== undefined && input !== null && !raw) {
        // V1 message parity for an explicitly empty argument.
        context.ui.toast.show({ variant: "warning", message: TOAST.emptyInput })
        return
      }
      if (pending() > 0) return
      let source = raw ?? undefined
      if (!source) {
        // V1 parity: the ✦ click optimizes what is ALREADY TYPED in the
        // input. Read it through the same internal channel as the write
        // side; when that surface is unavailable (or the input is empty)
        // the typed dialog is the fallback.
        const current = (await readComposerText())?.trim()
        if (current) {
          if (current.startsWith("/opt")) {
            // Residual slash prefix from this very command run — strip it.
            source = current.replace(/^\/(?:opt|optimize)\b/, "").trim()
          } else {
            source = current
          }
        }
        if (!source) {
          const asked = await context.ui.dialog.prompt({
            title: "Optimize prompt",
            placeholder: "Describe what you want, roughly",
          })
          if (!asked?.trim()) return
          source = asked.trim()
        }
      }
      await runWithText(source)
    }

    // Palette + slash command. `arguments: true` keeps the raw text typed
    // after the command and hands it to run().
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "prompt-optimizer.optimize",
          title: "Optimize prompt",
          description: "Expand a rough request into an executable task spec you can review before sending",
          group: "Prompt",
          palette: true,
          suggested: true,
          slash: { name: "optimize", aliases: ["opt"], arguments: true },
          run: (input) => {
            void runCommand(input)
          },
        },
      ],
    }))

    // ✦ button, bottom-right of the input box. The prompt footer row is a
    // `justify-content: space-between` flex row (host markup: the
    // prompt.footer.status slot sits left, prompt.footer.file right), so
    // appending our claim to the `prompt.footer` slot trail renders it as
    // the last element — flush with the input box's right edge. V1 injected
    // it by replacing the whole Prompt component; V2 keeps everything in the
    // documented slot tree (works on home and session prompts alike).
    context.ui.slot({
      append: "prompt.footer",
      render: (props) => (
        <Show when={props.mode === "normal"}>
          <box
            flexShrink={0}
            onMouseUp={() => {
              if (pending() > 0) return
              void runCommand()
            }}
          >
            <Show
              when={pending() > 0}
              fallback={
                <text fg={context.theme.hue.interactive[200]} wrapMode="none">
                  {IDLE_ICON}
                </text>
              }
            >
              <text fg={context.theme.text.muted} wrapMode="none">
                {SPINNER_FRAMES[frame()]}
              </text>
            </Show>
          </box>
        </Show>
      ),
    })

    console.error("[prompt-optimizer] TUI part loaded")
  },
})