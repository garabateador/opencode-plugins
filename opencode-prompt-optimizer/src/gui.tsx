import { Command, ComposerPill, Plugin, Style, type Command as CommandItem } from "@opencode/plugin/gui"
import { createSignal } from "solid-js"
import { Optimize, type ModelRef, type OptimizeOutput } from "./rpc"

/**
 * GUI part (OpenCode Desktop) of opencode-prompt-optimizer for OpenCode v2.
 *
 * The Desktop composer exposes read/write APIs the TUI does not, so this
 * part reproduces the V1 behavior exactly:
 *
 * 1. read the rough request with composer.text()
 * 2. optimize through the server part's RPC (project-aware, one-shot)
 * 3. replace the composer text with the optimized draft via composer.setText —
 *    the V2 equivalent of the V1 ref.set({ input, mode, parts })
 * 4. focus the composer; the user reviews/edits and sends manually
 *
 * Triggers:
 * - command palette (⌘⇧O), slash `/optimize`
 * - `buttonPlacement: "inline"` (default): a native ✦ button injected
 *   directly left of the composer's send/stop button. The v2 window-slot
 *   surface has no contribution point beside the composer actions (the
 *   only window slots are window.bottom / session.header /
 *   session.location.menu / session.panel.end), so this observation-based
 *   injection is the supported-shape workaround:
 *   - anchors on the app's stable data attributes
 *     ([data-slot="composer-actions"] → [data-action="composer-submit"]),
 *     which are also used by the app's own test suites
 *   - inserts nothing when the structure changes (silent no-op), never
 *     breaks the app, and removes its nodes on plugin unload/config change
 *   - `buttonPlacement: "lane"` restores the floating ✦ Optimize pill above
 *     the composer; `"none"` keeps only the commands
 */

type Options = {
  /** Where the ✦ trigger lives: "inline" = left of the send/stop button (default), "lane" = pill above the composer, "none". */
  buttonPlacement?: "inline" | "lane" | "none"
  /** Legacy 1.0.0 option; true = lane pill, false = none, undefined = new default ("inline"). */
  showPill?: boolean
}

const TOAST = {
  success: "Optimized (review before sending)",
  failedTitle: "Optimization failed",
  emptyInput: "Input is empty, nothing to optimize",
}

const BUTTON_MARKER = "data-prompt-optimizer-button"

const INLINE_CSS = `
button[${BUTTON_MARKER}] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  margin-inline-start: 8px;
  margin-inline-end: 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.15s ease, background-color 0.15s ease;
  flex-shrink: 0;
}
button[${BUTTON_MARKER}]:hover {
  opacity: 1;
  background: color-mix(in oklab, currentColor 8%, transparent);
}
button[${BUTTON_MARKER}]:disabled,
button[${BUTTON_MARKER}][aria-busy="true"] {
  opacity: 0.35;
  cursor: default;
}
button[${BUTTON_MARKER}] > span {
  display: inline-flex;
  pointer-events: none;
}
button[${BUTTON_MARKER}].is-busy > span {
  animation: pom-OptimizerSpin 0.9s linear infinite;
}
@keyframes pom-OptimizerSpin {
  to { transform: rotate(360deg); }
}
`

// Same shape handling as the TUI part: rpc/transport rejections vary; never
// render "[object Object]".
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
  i18n: {
    en: {
      "command.optimize.title": "Optimize prompt",
      "command.optimize.description": "Expand the rough request into an executable task spec",
      "button.optimize.title": "Optimize prompt (Mod+Shift+O)",
      "pill.label": "✦ Optimize",
      "dialog.prompt.placeholder": "Describe what you want, roughly",
      "toast.optimizing": "Optimizing prompt…",
    },
  },
  setup(ctx) {
    const options = (ctx.options ?? {}) as Options
    const [running, setRunning] = createSignal(false)

    const optimize = async (
      raw: string,
      source: { directory?: string; model?: ModelRef } = {},
    ): Promise<OptimizeOutput | undefined> => {
      let result: OptimizeOutput | undefined
      const { directory, model } = source
      try {
        // RPC output is `unknown` (JSON Schema): narrow to the contract type.
        // `location` keeps the registry resolution beside the session's
        // workspace (equal to the sidecar default, but explicit for remote or
        // multi-location servers). `model` carries the model currently
        // selected in the composer, so optimization follows the user's picker
        // choice; without one the server falls back to its options/default.
        result = (await ctx.client.rpc(Optimize).optimize(
          { text: raw, ...(directory ? { directory } : {}), ...(model ? { model } : {}) },
          directory ? { location: { directory } } : undefined,
        )) as OptimizeOutput
        ctx.toast.show({ variant: "success", title: TOAST.success })
      } catch (error) {
        const message = messageOf(error)
        console.error("[prompt-optimizer] enhance failed:", message)
        ctx.toast.show({ variant: "error", title: TOAST.failedTitle, description: message.slice(0, 240) })
      }
      return result
    }

    /** The composer's currently selected model in the contract's shape, or undefined when it has none yet. */
    const selectedComposerModel = (): ModelRef | undefined => {
      const selected = ctx.screen.current()?.composer.model()
      if (!selected) return undefined
      return {
        providerID: selected.providerID,
        modelID: selected.modelID,
        ...(selected.variant ? { variant: selected.variant } : {}),
      }
    }

    // One busy signal drives the command's enabled state AND every injected
    // inline button's busy state. Inline mode re-points it to the DOM sync.
    let notifyRunning: (value: boolean) => void = setRunning
    const setRunningState = (value: boolean) => {
      setRunning(value)
      notifyRunning(value)
    }

    const withProgress = async (work: () => Promise<void>) => {
      if (running()) return
      setRunningState(true)
      const progress = ctx.toast.show({ variant: "loading", title: ctx.t("toast.optimizing"), persistent: true })
      try {
        await work()
      } finally {
        progress.dismiss()
        setRunningState(false)
      }
    }

    const optimizeComposer = () =>
      void withProgress(async () => {
        const session = ctx.sessions.current()
        const composer = ctx.screen.current()?.composer

        if (!session || !composer) {
          await optimizeHome()
          return
        }

        const raw = composer.text().trim()
        if (!raw) {
          ctx.toast.show({ variant: "error", title: TOAST.failedTitle, description: TOAST.emptyInput })
          composer.focus()
          return
        }

        const result = await optimize(raw, { directory: session.directory, model: selectedComposerModel() })
        if (!result) return
        // V1 parity: replace the input content; the user reviews and sends.
        composer.setText(result.text)
        composer.focus()
      })

    const optimizeHome = async () => {
      const rough = await ctx.dialogs.prompt({
        title: ctx.t("command.optimize.title"),
        placeholder: ctx.t("dialog.prompt.placeholder"),
      })
      if (!rough?.trim()) return

      const server = ctx.servers.list()[0] ?? "sidecar"
      const data = ctx.servers.get(server)?.data
      try {
        await data?.project.sync()
      } catch {
        /* fall through to the error toast below */
      }
      const directory = data?.project.list()[0]?.canonical
      const result = await optimize(rough.trim(), { directory })
      if (!result) return
      if (!directory) {
        ctx.toast.show({ variant: "error", title: TOAST.failedTitle, description: "No project directory available" })
        return
      }
      // Open the optimized prompt in a new draft session for review.
      ctx.layout.draft({ server, directory, prompt: result.text })
    }

    ctx.add(
      Command,
      (): CommandItem => ({
        id: "optimize",
        title: ctx.t("command.optimize.title"),
        description: ctx.t("command.optimize.description"),
        group: "Prompt",
        bind: "mod+shift+o",
        slash: { name: "optimize" },
        editable: true,
        enabled: !running(),
        run: () => optimizeComposer(),
      }),
    )

    // Placement resolution: the new inline button by default; the legacy
    // showPill option maps to the old modes.
    const placement =
      options.buttonPlacement ?? (options.showPill === true ? "lane" : options.showPill === false ? "none" : "inline")

    if (placement === "lane") {
      ctx.add(ComposerPill, {
        id: "optimize",
        show: () => ({
          label: ctx.t("pill.label"),
          title: ctx.t("command.optimize.title"),
          run: () => optimizeComposer(),
        }),
      })
    }

    if (placement === "inline") {
      // The ✦ button, injected directly left of the composer's send/stop
      // button in every mounted composer. Insertion is defensive: nothing is
      // rendered when the app's internals move (silent no-op — the command
      // palette and ⌘⇧O still work), and plugin unload / config change
      // removes every node.
      const buttons = new Set<HTMLButtonElement>()
      let pendingScan: ReturnType<typeof setTimeout> | undefined

      notifyRunning = () => {
        const busy = running()
        for (const button of [...buttons]) {
          if (!button.isConnected) {
            buttons.delete(button)
            continue
          }
          button.disabled = busy
          button.setAttribute("aria-busy", String(busy))
          button.classList.toggle("is-busy", busy)
        }
      }

      const ensure = () => {
        document.querySelectorAll<HTMLElement>('[data-slot="composer-actions"]').forEach((lane) => {
          if (lane.querySelector(`[${BUTTON_MARKER}]`)) return
          const submit = lane.querySelector<HTMLButtonElement>('[data-action="composer-submit"]')
          if (!submit) return

          // Matching the app's own model chip behavior: pressing the button
          // must not move focus out of the editor.
          const button = document.createElement("button")
          button.type = "button"
          button.setAttribute(BUTTON_MARKER, "inline")
          button.title = ctx.t("button.optimize.title")
          button.setAttribute("aria-label", ctx.t("command.optimize.title"))
          const glyph = document.createElement("span")
          glyph.setAttribute("aria-hidden", "true")
          glyph.textContent = "✦"
          button.appendChild(glyph)
          button.addEventListener("mousedown", (event) => event.preventDefault())
          button.addEventListener("click", (event) => {
            event.preventDefault()
            event.stopPropagation()
            void optimizeComposer()
          })
          submit.before(button)
          buttons.add(button)
        })
        notifyRunning(running())
      }

      const observer = new MutationObserver(() => {
        clearTimeout(pendingScan)
        pendingScan = setTimeout(ensure, 100) as unknown as ReturnType<typeof setTimeout>
      })
      observer.observe(document.body, { childList: true, subtree: true })
      ensure()

      ctx.add(Style, INLINE_CSS)

      return () => {
        clearTimeout(pendingScan)
        observer.disconnect()
        notifyRunning = setRunning
        setRunningState(false)
        for (const button of buttons) button.remove()
        buttons.clear()
      }
    }

    console.error("[prompt-optimizer] GUI part loaded", { buttonPlacement: placement })
  },
})