/** @jsxImportSource @opentui/solid */
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createSignal, For, Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"

/**
 * TUI part of opencode-prompt-navigator.
 *
 * The Desktop rail's navigation surfaces have no TUI equivalent — the TUI
 * plugin SDK exposes no way to read or drive the timeline's scroll position
 * (host renderables are not plugin API), so the workbuddy rail is reshaped
 * into the TUI's own sanctioned surfaces with the same data flow:
 *
 * - sidebar widget (`sidebar.content`): recent user inputs, one line each,
 *   chronological numbering; clicking a line opens the panel focused there
 * - `/prompts` slash command + palette command: opens the full navigation
 *   panel (the TUI counterpart of clicking the Desktop rail)
 * - `session.panel` contribution: the complete input list — click a row to
 *   expand the FULL prompt text in place, `c` copies it (OSC-52); keyboard
 *   j/k / ↑/↓ / pgup/pgdn scrolls; the panel header shows `focus / total`
 * - "current position" in the TUI = the row you focused/expanded (the
 *   timeline's scroll offset is host-internal); long sessions cap at the
 *   latest 300 rows with the count shown in the header
 *
 * Entries come from the synced session data (`data.session.message`,
 * type "user") — identical to the Desktop rail's data source. Data updates
 * flow through the host's reactive store, so new inputs appear without any
 * polling; an initial per-session sync warms the store on mount/open.
 */

type Entry = {
  id: string
  idx: number
  /** FULL prompt text (truncation happens at render time). */
  text: string
  created: number
}

const WIDGET_RECENT = 8
const PANEL_MAX = 300

/** Color for the "currently processing" prompt index in the sidebar header. */
const CURRENT_INDEX_COLOR = "#4CAF50"

const snippet = (text: string, max = 64): string => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat || "(empty input)"
}

const fullSnippet = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat || "(empty input)"
}

const timeOf = (created: number): string => {
  if (!created) return ""
  const d = new Date(created)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

const readEntries = (context: Plugin.Context, sessionID: string | undefined): Entry[] => {
  if (!sessionID) return []
  const raw = context.data.session.message.list(sessionID) ?? []
  const entries: Entry[] = []
  for (const message of raw) {
    if ((message as { type?: string }).type !== "user") continue
    const user = message as { id: string; text?: string; time?: { created?: number } }
    entries.push({
      id: user.id,
      idx: entries.length + 1,
      text: user.text ?? "",
      created: user.time?.created ?? 0,
    })
  }
  return entries
}

export default Plugin.define({
  id: "prompt-navigator.tui",
  setup(context) {
    const [focusId, setFocusId] = createSignal<string | undefined>(undefined)
    const [expandedId, setExpandedId] = createSignal<string | undefined>(undefined)

    const entriesFor = (sessionID: string | undefined) => readEntries(context, sessionID)

    const openPanel = (sessionID: string | undefined, focus?: string) => {
      if (!sessionID) {
        context.ui.toast.show({ variant: "warning", message: "Open a session first" })
        return
      }
      setFocusId(focus)
      setExpandedId(focus)
      // Warm the store; the render reads it reactively and updates itself.
      void context.data.session.message.sync(sessionID).catch(() => undefined)
      context.ui.panel.open("navigator", { presentation: "fullscreen" })
    }

    // Palette + slash entry.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "prompt-navigator.panel",
          title: "Prompt navigation",
          description: "Browse every user input of the session",
          group: "Prompt",
          palette: true,
          suggested: true,
          slash: { name: "prompts" },
          run: () => {
            const route = context.ui.router.current()
            if (route.type !== "session") {
              openPanel(undefined)
              return
            }
            openPanel(route.sessionID)
          },
        },
      ],
    }))

    // Sidebar widget: the session sidebar hosts the always-on preview.
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => {
        const sessionID = props.sessionID
        void context.data.session.message.sync(sessionID).catch(() => undefined)
        const entries = () => entriesFor(sessionID)
        const recent = () => entries().slice(-WIDGET_RECENT)
        const focusedIdx = () => {
          const index = entries().findIndex((entry) => entry.id === focusId()) + 1
          return index > 0 ? index : entries().length
        }

        return (
          <Show when={sessionID && entries().length > 0}>
            <box flexDirection="column" marginTop={1} flexShrink={0}>
              <text fg={context.theme.text.base} attributes={TextAttributes.BOLD}>
                {`USER PROMPTS · `}
                <span style={{ fg: CURRENT_INDEX_COLOR }}>{`${focusedIdx()}`}</span>
                {`/${entries().length}`}
              </text>
              <For each={recent()}>
                {(entry) => (
                  <box
                    flexShrink={0}
                    onMouseUp={() => openPanel(sessionID, entry.id)}
                  >
                    <text
                      fg={entry.id === focusId() ? context.theme.hue.interactive[200] : context.theme.text.muted}
                      wrapMode="none"
                      truncate
                    >
                      {`#${entry.idx} ${timeOf(entry.created)} ${snippet(entry.text, 40)}`}
                    </text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        )
      },
    })

    // Full navigation panel (session.panel contribution).
    context.ui.slot({
      append: "session.panel",
      render: (panel) => {
        const [copiedId, setCopiedId] = createSignal<string | undefined>(undefined)
        const sessionID = panel.sessionID
        void context.data.session.message.sync(sessionID).catch(() => undefined)
        const entries = () => entriesFor(sessionID)

        let scroll: ScrollBoxRenderable | undefined
        const rows = () => entries().slice(-PANEL_MAX)
        // Keyboard focus: -1 = none (the header then shows the latest input).
        const [focusIdx, setFocusIdx] = createSignal(-1)

        const moveFocus = (delta: number): void => {
          const index = focusIdx() < 0 ? rows().length - 1 : focusIdx() + delta
          setFocusIdx(Math.max(0, Math.min(rows().length - 1, index)))
          if (scroll && focusIdx() >= 0) scroll.scrollTo(focusIdx())
        }

        useKeyboard((event) => {
          if (!scroll) return
          if (event.name === "up" || event.name === "k") return moveFocus(-1)
          if (event.name === "down" || event.name === "j") return moveFocus(1)
          if (event.name === "pageup") return scroll.scrollBy(-10)
          if (event.name === "pagedown") return scroll.scrollBy(10)
          if (event.name === "home") {
            scroll.scrollTo(0)
            setFocusIdx(rows().length > 0 ? Math.max(0, entries().length - PANEL_MAX) : -1)
            return
          }
          if (event.name === "end") {
            scroll.scrollTo(scroll.scrollHeight)
            setFocusIdx(rows().length - 1)
            return
          }
          if (event.name === "enter" || event.name === "return") {
            const entry = rows()[focusIdx()]
            if (!entry) return
            setFocusId(entry.id)
            setExpandedId(expandedId() === entry.id ? undefined : entry.id)
          }
        })

        // Panel-local keymap: copy the focused entry (OSC-52) and close.
        context.keymap.layer(() => ({
          commands: [
            {
              bind: "escape",
              run: () => {
                context.ui.panel.close()
              },
            },
            {
              id: "prompt-navigator.copy",
              title: "Copy prompt",
              group: "Prompt Navigator",
              bind: "c",
              run: () => {
                const focused = rows()[focusIdx()] ?? entriesFor(sessionID).at(-1)
                if (!focused) return
                const written = context.renderer.copyToClipboardOSC52(focused.text)
                setCopiedId(focused.id)
                context.ui.toast.show({
                  variant: written ? "success" : "warning",
                  message: written ? "Prompt copied (OSC-52)" : "Copy failed: terminal does not support OSC-52",
                  duration: 3000,
                })
              },
            },
          ],
        }))

        return (
          <box
            flexDirection="column"
            flexGrow={1}
            height="100%"
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={context.theme.background.base}
          >
            <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingBottom={1}>
              <text attributes={TextAttributes.BOLD} fg={context.theme.text.base}>
                PROMPT NAVIGATION
              </text>
              <text fg={context.theme.text.faint}>{`  #${(focusIdx() >= 0 ? rows()[focusIdx()]?.idx : rows().at(-1)?.idx) ?? 0}/${entries().length} · esc close`}</text>
            </box>
            <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingBottom={1}>
              <text fg={context.theme.text.faint} wrapMode="none">
                {`↑/↓ select · enter expand · c copy · j/k scroll · esc close`}
              </text>
            </box>
            <scrollbox
              ref={(element: ScrollBoxRenderable) => (scroll = element)}
              flexGrow={1}
              contentOptions={{ minHeight: 0 }}
              scrollbarOptions={{ visible: false }}
            >
              <box paddingLeft={2} paddingRight={2}>
                <For each={rows()}>
                  {(entry, position) => (
                    <box flexDirection="column" flexShrink={0}>
                      <box
                        flexShrink={0}
                        onMouseUp={() => {
                          setFocusIdx(position())
                          setFocusId(entry.id)
                          setExpandedId(expandedId() === entry.id ? undefined : entry.id)
                        }}
                      >
                        <text
                          attributes={
                            position() === focusIdx() || entry.id === expandedId() ? TextAttributes.BOLD : 0
                          }
                          fg={
                            position() === focusIdx() || entry.id === expandedId()
                              ? context.theme.hue.interactive[200]
                              : context.theme.text.muted
                          }
                          wrapMode="none"
                        >
                          {`#${entry.idx} ${timeOf(entry.created)} ${snippet(entry.text, 88)}`}
                        </text>
                      </box>
                      <Show when={expandedId() === entry.id}>
                        <box paddingLeft={3} flexShrink={0}>
                          <text fg={context.theme.text.base} wrapMode="word">
                            {fullSnippet(entry.text)}
                          </text>
                        </box>
                      </Show>
                    </box>
                  )}
                </For>
                <Show when={entries().length > PANEL_MAX}>
                  <box paddingLeft={2} paddingTop={1} flexShrink={0}>
                    <text fg={context.theme.text.faint}>
                      {`showing latest ${PANEL_MAX} of ${entries().length} inputs`}
                    </text>
                  </box>
                </Show>
              </box>
            </scrollbox>
            <Show when={copiedId()}>
              <box flexShrink={0} paddingLeft={2} paddingTop={1}>
                <text fg={context.theme.text.faint}>✓ copied</text>
              </box>
            </Show>
          </box>
        )
      },
    })

    console.error("[prompt-navigator] TUI part loaded")
  },
})