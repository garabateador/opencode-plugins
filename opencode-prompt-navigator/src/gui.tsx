import { Command, Plugin, Style } from "@opencode/plugin/gui"

/**
 * opencode-prompt-navigator — workbuddy-style prompt navigation rail for
 * OpenCode Desktop sessions.
 *
 * A slim vertical rail docked to the right edge of the session conversation
 * area marks every user input in chronological order (index markers + tick
 * marks + thumbnail tooltip on hover), shows the current reading position,
 * and jumps to — and highlights — the corresponding message on click.
 *
 * ## Why the rail is DOM-observed
 *
 * The v2 window-slot surface (window.bottom / session.header /
 * session.location.menu / session.panel.end) has no right-edge anchor inside
 * the conversation view, so the rail attaches beside the timeline's own
 * scroll root — `[data-slot="session-timeline-scroll"]`, the same element the
 * app's search feature drives. Anchors reference attributes the app itself
 * relies on (`data-message-id`, `[data-session-title]`); if the app's
 * internals move, the rail renders nothing (silent no-op) and the palette
 * command keeps working. Plugin unload / config change removes every node.
 *
 * ## Virtualized timeline
 *
 * The timeline virtualizes its rows: only a window of messages exists in the
 * DOM. The rail therefore reads the FULL ordered user-input list from the
 * synced session data (`data.session.message`), and jumps use the app's own
 * search recipe: estimate scrollTop from mounted message anchors, scroll,
 * re-check in a bounded rAF retry loop, then center and highlight the message
 * once it is mounted.
 *
 * ## Long-session performance
 *
 * - DOM reads are bounded: only messages mounted inside the visible
 *   virtualizer window are queried (a few dozen), never the whole history
 * - one rAF loop coalesces rail geometry sync + active-position detection;
 *   every style write is change-detected so idle frames write nothing
 * - rail items are diffed by message id (append/remove, never rebuilt
 *   wholesale); entries come from the SDK data store, so new inputs appear
 *   without re-scanning history
 * - data re-sync is throttled: immediately on session switch, then every 2s
 *   while the session is running
 */

type Options = {
  /** Show the rail by default. Toggleable at runtime via the palette command. */
  enabled?: boolean
  /** Right-edge inset of the track in px. */
  inset?: number
}

const SCROLLER_SELECTOR = '[data-slot="session-timeline-scroll"]'
const RAIL_MARKER = "data-pomx-rail"
const ITEM_MARKER = "data-pomx-item"
const FLASH_CLASS = "pomx-message-flash"
const ACTIVE_CLASS = "is-active"
const NUM_REVEAL_CLASS = "reveal"
const MAX_JUMP_ATTEMPTS = 20
/** Wait between jump attempts: lets the virtualizer mount the new window and
 *  leave its large-jump (inert) mode before re-anchoring. */
const JUMP_SETTLE_MS = 110
/** The app's own cursor line: ~100px below the scroll viewport top. */
const CURSOR_LINE_OFFSET = 100
/** Clear the sticky session title / header row above the timeline. */
const RAIL_TOP_GAP = 56
/** Clear composer/queue overlays and the timeline bottom fade below. */
const RAIL_BOTTOM_GAP = 110
/** Keep clear of the timeline's native scrollbar on the right edge. */
const RAIL_WIDTH = 40
const RAIL_MIN_HEIGHT = 160
const RAIL_MAX_HEIGHT = 560
const POLL_MS = 400
const SYNC_RUNNING_MS = 2000

const STYLE = `
/* Workbuddy-style rail: chromeless tick track on the right edge. The
   container is pointer-transparent so the native scrollbar, buttons and
   wheel scrolling of the underlying timeline keep working; only the tick
   buttons capture the pointer. */
[data-pomx-rail] {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding: 0;
  background: transparent;
  border: none;
  backdrop-filter: none;
  z-index: 45;
  pointer-events: none;
  user-select: none;
}
[data-pomx-rail] .pomx-head {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 2px;
  font-size: 10px;
  line-height: 1;
  padding: 0 6px 5px 0;
  width: 100%;
  white-space: nowrap;
  color: var(--v2-text-text-faint, var(--v2-alpha-dark-40, rgba(0, 0, 0, 0.4)));
}
[data-pomx-rail] .pomx-head .pomx-idx-current {
  color: var(--v2-text-text-accent, currentColor);
  font-weight: 600;
}
[data-pomx-rail] .pomx-track {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  min-height: 12px;
  width: 40px; /* 22px tick column + 18px reserved numeral column: layers never overlap */
  overflow: hidden auto;
  scrollbar-width: none;
  pointer-events: none;
  padding: 4px 2px;
  border-radius: 8px;
  mask-image: linear-gradient(to bottom, transparent, #000 10px, #000 calc(100% - 10px), transparent);
}
[data-pomx-rail] [${ITEM_MARKER}] {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 22px;
  height: 10px;
  padding: 0 1px;
  border: none;
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  pointer-events: auto;
}
[data-pomx-rail] [${ITEM_MARKER}]:hover {
  background: var(--v2-overlay-simple-overlay-hover, rgba(0, 0, 0, 0.04));
}
[data-pomx-rail] .pomx-tick {
  display: block;
  width: 10px;
  height: 2px;
  border-radius: 2px;
  background: var(--v2-alpha-dark-20, rgba(0, 0, 0, 0.2));
  transition: width 0.15s ease, height 0.15s ease, background-color 0.15s ease;
}
[data-pomx-rail] [${ITEM_MARKER}]:hover .pomx-tick {
  width: 14px;
  height: 3px;
  background: var(--v2-alpha-dark-60, rgba(0, 0, 0, 0.6));
}
[data-pomx-rail] [${ITEM_MARKER}].is-active {
  background: var(--v2-overlay-simple-overlay-hover, rgba(0, 0, 0, 0.04));
}
[data-pomx-rail] [${ITEM_MARKER}].is-active .pomx-tick {
  width: 18px;
  height: 3px;
  background: var(--v2-icon-icon-accent, var(--v2-background-bg-accent, currentColor));
}
[data-pomx-rail] .pomx-num {
  position: absolute;
  right: 25px; /* lives in its own column, left of the 22px tick column */
  font-size: 9px;
  line-height: 10px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--v2-text-text-faint, var(--v2-alpha-dark-40, rgba(0, 0, 0, 0.4)));
  opacity: 0;
  transition: opacity 0.12s ease;
  pointer-events: none;
}
[data-pomx-rail]:hover .pomx-num.${NUM_REVEAL_CLASS} {
  opacity: 1;
}
[data-pomx-rail] .pomx-tip {
  position: absolute;
  right: calc(100% + 10px);
  top: 0;
  max-width: 280px;
  display: none;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--v2-background-bg-inverse, #161616);
  color: var(--v2-text-text-inverse, #f5f5f5);
  font-size: 11px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: var(--v2-elevation-floating, 0 4px 12px rgba(0, 0, 0, 0.2));
  pointer-events: none;
  z-index: 2;
}
[data-pomx-rail] .pomx-tip.is-shown {
  display: block;
}
[data-pomx-rail] .pomx-tip .pomx-tip-idx {
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
  margin-inline-end: 6px;
}
/* Locate flash on the target message — a subtle accent frame with app tokens. */
[data-message-id].pomx-message-flash {
  background: color-mix(in oklab, var(--v2-background-bg-accent, #2563eb) 9%, transparent) !important;
  box-shadow: inset 2px 0 0 0 var(--v2-background-bg-accent, #2563eb);
  border-radius: 6px;
  transition: background-color 0.25s ease;
}
`

interface Entry {
  id: string
  idx: number
  text: string
  created: number
}

interface RailItem {
  el: HTMLElement
}

interface Rail {
  scroller: HTMLElement
  /**
   * The REAL scrolling viewport: ScrollView's inner `[data-scrollable]`
   * element (`.scroll-view__viewport`, overflow-y auto). The wrapper that
   * carries data-slot="session-timeline-scroll" is overflow:hidden and only
   * hosts the custom scrollbar chrome — scrolled on it, scrollTo is a no-op.
   */
  viewport: HTMLElement
  root: HTMLElement
  headCurrent: HTMLElement
  headTotal: HTMLElement
  track: HTMLElement
  tip: HTMLElement
  tipIdx: HTMLElement
  tipText: HTMLElement
  /** message id -> item element (chronological) */
  items: Map<string, RailItem>
  entries: Entry[]
  activeId: string
  sessionKey: string
  /** last-applied geometry for change-detection */
  geo: { left: number; top: number; height: number }
  /** bumps on every jump; each locate loop cancels the previous one */
  jumpToken: number
  /** turn model for the session: userMsgId/anyMsgId -> turn index */
  turns: { byUser: Map<string, number>; byMessage: Map<string, number>; count: number }
}

const snippet = (text: string, max = 110): string => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat || "(empty input)"
}

const timeOf = (created: number): string => {
  if (!created) return ""
  const d = new Date(created)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/** Escape a message id for a CSS attribute selector. */
const esc = (value: string): string => value.replace(/[^\w-]/g, (c) => `\\${c}`)

/**
 * The USER row's virtualizer wrapper. Do NOT target `[data-message-id]`:
 * every row of a turn carries data-message-id = the turn owner's user
 * message id (session-timeline-row.tsx), so assistant rows match the same
 * selector and a query would hit the mounted *reply* rows first. The
 * `data-timeline-key` value `user-message:<id>` is unique to the prompt row.
 */
const userRowSel = (id: string): string => `[data-timeline-key="user-message:${esc(id)}"]`

export default Plugin.define({
  i18n: {
    en: {
      "command.navigator.toggle": "Toggle prompt navigation rail",
      "command.navigator.description": "Show or hide the input-history navigation rail beside the timeline",
    },
  },
  setup(ctx) {
    const options = (ctx.options ?? {}) as Options
    const INSET = typeof options.inset === "number" ? options.inset : 16

    const rails = new Map<HTMLElement, Rail>()
    let raf = 0
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let flashTimer: number | undefined
    let lastSyncSessionKey = ""
    let lastSyncAt = 0
    let shownTip: { rail: Rail } | undefined
    const enabledRef = { value: options.enabled !== false }
    const isEnabled = () => enabledRef.value

    ctx.add(
      Command,
      (): Command => ({
        id: "toggle-rail",
        title: ctx.t("command.navigator.toggle"),
        description: ctx.t("command.navigator.description"),
        group: "Prompt",
        bind: "mod+alt+n",
        run: () => {
          enabledRef.value = !enabledRef.value
          if (!enabledRef.value) teardownRails()
          else ensureRails()
        },
      }),
    )

    ctx.add(Style, STYLE)

    // ---------- data ----------

    const dataFor = (serverId: string) => ctx.servers.get(serverId || "sidecar")?.data

    const entriesFor = (sessionKey: string): Entry[] => {
      const serverId = sessionKey.slice(0, sessionKey.indexOf("\n")) || "sidecar"
      const sessionID = sessionKey.slice(sessionKey.indexOf("\n") + 1)
      const data = dataFor(serverId)
      if (!data || !sessionID) return []
      const raw = data.session.message.list(sessionID) ?? []
      const entries: Entry[] = []
      for (const message of raw) {
        if ((message as { type?: string }).type !== "user") continue
        const user = message as { id: string; text?: string; time?: { created?: number } }
        entries.push({
          id: user.id,
          idx: entries.length + 1,
          text: snippet(user.text ?? ""),
          created: user.time?.created ?? 0,
        })
      }
      return entries
    }

    const syncSessionData = (sessionKey: string): void => {
      const serverId = sessionKey.slice(0, sessionKey.indexOf("\n")) || "sidecar"
      const sessionID = sessionKey.slice(sessionKey.indexOf("\n") + 1)
      const data = dataFor(serverId)
      if (!data || !sessionID) return
      void data.session.message.sync(sessionID).catch(() => undefined)
    }

    const sessionKeyOf = (): string => {
      const session = ctx.sessions.current()
      return session ? `${session.server.id}\n${session.id}` : ""
    }

    // ---------- rail construction ----------

    /** The ScrollView's real scrolling viewport inside the timeline wrapper. */
    const VIEWPORT_SELECTOR = '[data-scrollable], .scroll-view__viewport'

    const findViewport = (scroller: HTMLElement): HTMLElement => {
      return scroller.querySelector<HTMLElement>(VIEWPORT_SELECTOR) ?? scroller
    }

const buildRail = (scroller: HTMLElement): Rail | undefined => {
      // Attach inside the nearest positioned ancestor so the rail never
      // scrolls away with the timeline content.
      let anchor: HTMLElement | null = scroller.parentElement
      while (anchor && getComputedStyle(anchor).position === "static") anchor = anchor.parentElement
      const host = anchor ?? scroller.parentElement
      if (!host) return undefined

      const root = document.createElement("div")
      root.setAttribute(RAIL_MARKER, "inline")

      const head = document.createElement("div")
      head.className = "pomx-head"
      const headCurrent = document.createElement("span")
      headCurrent.className = "pomx-idx-current"
      headCurrent.textContent = "–"
      const headTotal = document.createElement("span")
      headTotal.textContent = "/ 0"
      head.append(headCurrent, document.createTextNode(" "), headTotal)

      const track = document.createElement("div")
      track.className = "pomx-track"

      const tip = document.createElement("div")
      tip.className = "pomx-tip"
      const tipIdx = document.createElement("span")
      tipIdx.className = "pomx-tip-idx"
      const tipText = document.createElement("span")
      tip.append(tipIdx, tipText)

      root.append(head, track, tip)
      // The rail must not intercept clicks meant for the timeline.
      root.addEventListener("pointerdown", (event) => event.stopPropagation())
      host.appendChild(root)

      return {
        scroller,
        viewport: findViewport(scroller),
        root,
        headCurrent,
        headTotal,
        track,
        tip,
        tipIdx,
        tipText,
        items: new Map(),
        entries: [],
        activeId: "",
        sessionKey: "",
        geo: { left: NaN, top: NaN, height: NaN },
        jumpToken: 0,
        turns: { byUser: new Map(), byMessage: new Map(), count: 0 },
      }
    }

    const hideTipIfFrom = (rail: Rail): void => {
      if (shownTip?.rail === rail) {
        rail.tip.classList.remove("is-shown")
        shownTip = undefined
      }
    }

    const showTip = (rail: Rail, el: HTMLElement, entry: Entry): void => {
      if (shownTip && shownTip.rail !== rail) shownTip.rail.tip.classList.remove("is-shown")
      rail.tipIdx.textContent = `#${entry.idx}`
      rail.tipText.textContent = `${timeOf(entry.created)} · ${entry.text}`
      const itemRect = el.getBoundingClientRect()
      const railRect = rail.root.getBoundingClientRect()
      rail.tip.style.top = `${Math.max(0, Math.round(itemRect.top - railRect.top - 4))}px`
      rail.tip.classList.add("is-shown")
      shownTip = { rail }
    }

    const updateItem = (rail: Rail, item: RailItem, entry: Entry, showNumerals: boolean): void => {
      item.el.setAttribute(ITEM_MARKER, String(entry.idx))
      item.el.setAttribute("aria-label", `Input ${entry.idx}: ${entry.text}`)
      let numeral = item.el.querySelector<HTMLElement>(".pomx-num")
      const wanted = showNumerals || entry.idx % 10 === 0
      if (wanted && !numeral) {
        numeral = document.createElement("span")
        numeral.className = `pomx-num ${NUM_REVEAL_CLASS}`
        item.el.appendChild(numeral)
      } else if (!wanted && numeral) {
        numeral.remove()
      }
      if (numeral) numeral.textContent = String(entry.idx)
      item.el.dataset.entryId = entry.id
    }

    const rebuildItems = (rail: Rail): void => {
      const entries = rail.entries
      const wantedIds = new Set(entries.map((entry) => entry.id))
      for (const [id, item] of [...rail.items]) {
        if (!wantedIds.has(id)) {
          item.el.remove()
          rail.items.delete(id)
        }
      }
      const showNumerals = entries.length <= 32
      let cursor = rail.track.firstElementChild
      for (const entry of entries) {
        let item = rail.items.get(entry.id)
        if (!item) {
          // New user inputs appear at the end; index keys keep this O(delta).
          const el = document.createElement("button")
          el.type = "button"
          el.setAttribute(ITEM_MARKER, String(entry.idx))
          const tick = document.createElement("span")
          tick.className = "pomx-tick"
          el.appendChild(tick)
          el.addEventListener("click", () => jumpTo(rail, entry))
          el.addEventListener("pointerenter", () => showTip(rail, el, entry))
          el.addEventListener("pointerleave", () => hideTipIfFrom(rail))
          rail.track.appendChild(el)
          item = { el }
          rail.items.set(entry.id, item)
        }
        updateItem(rail, item, entry, showNumerals)
        if (cursor !== item.el) rail.track.insertBefore(item.el, cursor!)
        cursor = item.el.nextElementSibling
      }
    }

    // ---------- locate & highlight ----------

    /** Mirror of the timeline's turn model: each user message opens a turn
     *  (order = data order); every other message maps to the turn it
     *  belongs to. Used to translate message ids into turn indexes. */
    const rebuildTurns = (rail: Rail): void => {
      const serverId = rail.sessionKey.slice(0, rail.sessionKey.indexOf("\n")) || "sidecar"
      const sessionID = rail.sessionKey.slice(rail.sessionKey.indexOf("\n") + 1)
      const data = dataFor(serverId)
      const byUser = new Map<string, number>()
      const byMessage = new Map<string, number>()
      let turn = -1
      for (const message of data?.session.message.list(sessionID) ?? []) {
        const anyMessage = message as { id?: string; type?: string; text?: string }
        if (!anyMessage.id) continue
        if (anyMessage.type === "user") {
          turn += 1
          byUser.set(anyMessage.id, turn)
        }
        if (turn >= 0) byMessage.set(anyMessage.id, turn)
      }
      rail.turns = { byUser, byMessage, count: turn + 1 }
    }

    // ---------- locate: turn-anchored virtualizer-faithful jump ----------

    /**
     * The timeline virtualizes rows: unmounted messages have no DOM. Mounted
     * rows are absolutely-positioned wrappers `[data-timeline-key]` whose
     * style carries the virtualizer's own authoritative offsets (top =
     * item.start - topOffset, height = item.size) and whose key encodes the
     * identity (`user-message:<id>`, `assistant-part:…`, `turn-gap:<id>`…).
     *
     * Anchors are therefore read from the DOM, translated into turn indexes,
     * and the target's scrollTop is estimated in TURN space (linear between
     * bracketing mounted turns, extrapolated by the average mounted turn
     * height otherwise). Each attempt re-anchors from freshly mounted rows,
     * so the loop converges even when the first estimate is coarse.
     */
    const rowTurn = (wrapper: HTMLElement, rail: Rail): number => {
      const key = wrapper.dataset.timelineKey ?? ""
      const byUser = rail.turns.byUser
      const byMessage = rail.turns.byMessage
      if (key.startsWith("user-message:") || key.startsWith("turn-divider:") || key.startsWith("turn-gap:") || key.startsWith("error:") || key.startsWith("retry:") || key.startsWith("thinking:")) {
        return byUser.get(key.slice(key.indexOf(":") + 1)) ?? -1
      }
      if (key.startsWith("shell:") || key.startsWith("notice:") || key.startsWith("turn-diff:")) {
        const rest = key.slice(key.indexOf(":") + 1)
        const id = rest.slice(0, rest.indexOf(":") >= 0 ? rest.indexOf(":") : undefined)
        return byMessage.get(id) ?? -1
      }
      const inner = wrapper.querySelector<HTMLElement>("[data-message-id]")
      const id = inner?.getAttribute("data-message-id")
      return (id ? byMessage.get(id) : undefined) ?? -1
    }

    interface TurnAnchor {
      turn: number
      top: number
      height: number
    }

    /** Mounted turns with their pixel extent inside the scroller. */
    const mountedTurnAnchors = (rail: Rail): TurnAnchor[] => {
      const viewport = rail.viewport
      const viewportRect = viewport.getBoundingClientRect()
      const byTurn = new Map<number, TurnAnchor>()
      for (const wrapper of viewport.querySelectorAll<HTMLElement>("[data-timeline-key]")) {
        const turn = rowTurn(wrapper, rail)
        if (turn < 0) continue
        // Top relative to the real scrollbar viewport (scrollTop-corrected).
        const top = wrapper.getBoundingClientRect().top - viewportRect.top + viewport.scrollTop
        const height = Number.parseFloat(wrapper.style.height) || wrapper.getBoundingClientRect().height
        const existing = byTurn.get(turn)
        if (!existing) {
          byTurn.set(turn, { turn, top, height })
        } else {
          // A turn spans several rows; extend to its full extent.
          const topMin = Math.min(existing.top, top)
          const bottom = Math.max(existing.top + existing.height, top + height)
          existing.top = topMin
          existing.height = bottom - topMin
        }
      }
      return [...byTurn.values()].sort((a, b) => a.turn - b.turn)
    }

    const flash = (node: HTMLElement): void => {
      if (flashTimer) clearTimeout(flashTimer)
      for (const previous of document.querySelectorAll<HTMLElement>(`.${FLASH_CLASS}`)) {
        previous.classList.remove(FLASH_CLASS)
      }
      node.classList.add(FLASH_CLASS)
      flashTimer = window.setTimeout(() => node.classList.remove(FLASH_CLASS), 1800)
    }

    /** The app reveals prompt rows aligned to START (below the sticky title). */
    const settle = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, JUMP_SETTLE_MS)))
      })

    const jumpTo = (rail: Rail, entry: Entry): void => {
      const token = (rail.jumpToken += 1)
      let attempt = 0
      let lastTop = -1
      let stableRun = 0

      const isActive = () => token === rail.jumpToken && rail.viewport.isConnected

      // Immediate rail feedback.
      rail.activeId = entry.id
      for (const [id, item] of rail.items) item.el.classList.toggle(ACTIVE_CLASS, id === entry.id)
      rail.headCurrent.textContent = String(entry.idx)

      /**
       * Frame-by-frame alignment once the prompt row is mounted. Mounting
       * mid-history rows triggers batched ResizeObserver measurement (code/
       * image heights), which shifts row offsets under any one-shot absolute
       * computation — the same reason the app anchors revealed rows. An
       * incremental follower re-measures each frame and absorbs that drift
       * until the prompt row sits at its anchor position below the sticky
       * title.
       */
      const alignFollower = (deadlineMs: number): void => {
        const started = performance.now()
        const rowSelector = userRowSel(entry.id)
        const tickFn = () => {
          if (token !== rail.jumpToken || !rail.viewport.isConnected) return
          const viewport = rail.viewport
          const row = viewport.querySelector<HTMLElement>(rowSelector)
          if (!row) {
            if (performance.now() - started < deadlineMs) requestAnimationFrame(tickFn)
            return
          }
          const viewportRect = viewport.getBoundingClientRect()
          const rowRect = row.getBoundingClientRect()
          const sticky = viewport.querySelector<HTMLElement>("[data-session-title]")
          const inset = (sticky instanceof HTMLElement ? sticky.offsetHeight : 0) + 8
          const delta = rowRect.top - (viewportRect.top + inset)
          if (Math.abs(delta) > 1) viewport.scrollTop += Math.round(delta)
          row.classList.add(FLASH_CLASS)
          if (performance.now() - started < deadlineMs) requestAnimationFrame(tickFn)
        }
        requestAnimationFrame(tickFn)
      }

      const step = async (): Promise<void> => {
        while (isActive() && attempt <= MAX_JUMP_ATTEMPTS) {
          const viewport = rail.viewport
          const row = viewport.querySelector<HTMLElement>(userRowSel(entry.id))
          if (row) {
            alignFollower(900)
            return
          }
          attempt += 1
          if (attempt > MAX_JUMP_ATTEMPTS) return

          const anchors = mountedTurnAnchors(rail)
          let estimate: number | undefined
          if (anchors.length >= 2) {
            let lower = anchors[0]
            let upper = anchors[anchors.length - 1]
            for (let i = 0; i < anchors.length - 1; i += 1) {
              if (anchors[i].turn <= entry.idx && anchors[i + 1].turn >= entry.idx) {
                lower = anchors[i]
                upper = anchors[i + 1]
                break
              }
            }
            if (lower === upper) {
              const nearest = anchors.reduce((best, anchor) =>
                Math.abs(anchor.turn - entry.idx) < Math.abs(best.turn - entry.idx) ? anchor : best,
              )
              let gap = 0
              let spans = 0
              for (let i = 1; i < anchors.length; i += 1) {
                const span = anchors[i].turn - anchors[i - 1].turn
                if (span > 0) {
                  gap += (anchors[i].top - anchors[i - 1].top) / span
                  spans += 1
                }
              }
              const perTurn = spans > 0 ? gap / spans : 480
              estimate = nearest.top + (entry.idx - nearest.turn) * perTurn
            } else {
              const spanTurns = upper.turn - lower.turn
              estimate =
                spanTurns > 0
                  ? lower.top + ((entry.idx - lower.turn) / spanTurns) * (upper.top - lower.top)
                  : lower.top
            }
          } else if (anchors.length === 1) {
            const count = Math.max(1, rail.turns.count)
            const perTurn = Math.max(240, viewport.scrollHeight / count)
            estimate = anchors[0].top + (entry.idx - anchors[0].turn) * perTurn
          } else {
            const count = Math.max(1, rail.turns.count)
            estimate = viewport.scrollHeight * (entry.idx / count)
          }

          const top = Math.max(0, Math.round(estimate))
          viewport.scrollTo({ top, behavior: "auto" })
          await settle()

          // Escape-hatch for the virtualizer's large-jump inert mode: when
          // the scroll position did not move across attempts, nudge ±2
          // viewports so rows around the target mount.
          const current = rail.viewport.scrollTop
          if (Math.abs(current - lastTop) < 1) {
            stableRun += 1
            if (stableRun >= 2) {
              rail.viewport.scrollTo({ top: Math.max(0, top - viewport.clientHeight * 2), behavior: "auto" })
              await settle()
              rail.viewport.scrollTo({ top, behavior: "auto" })
              await settle()
              stableRun = 0
            }
          } else {
            stableRun = 0
          }
          lastTop = current
        }
      }
      void step()
    }

    // ---------- frame loop ----------

    let frameScheduled = false
    const scheduleFrame = (): void => {
      if (frameScheduled || rails.size === 0) return
      frameScheduled = true
      raf = requestAnimationFrame(() => {
        frameScheduled = false
        raf = 0
        let alive = false
        for (const [scroller, rail] of [...rails]) {
          if (!scroller.isConnected) {
            rail.root.remove()
            rails.delete(scroller)
            hideTipIfFrom(rail)
            continue
          }
          alive = true
          syncGeometry(rail)
          updateActive(rail)
        }
        if (alive) scheduleFrame()
      })
    }

    const ensureRails = (): void => {
      if (!isEnabled()) return
      const key = sessionKeyOf()
      document.querySelectorAll<HTMLElement>(SCROLLER_SELECTOR).forEach((scroller) => {
        if (rails.has(scroller)) return
        const rect = scroller.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return // hidden screen
        const rail = buildRail(scroller)
        if (!rail) return
        rail.sessionKey = key
        rails.set(scroller, rail)
        rail.entries = entriesFor(key)
        rebuildTurns(rail)
        rebuildItems(rail)
        syncSessionData(key)
        lastSyncSessionKey = key
      })
      scheduleFrame()
    }

    const teardownRails = (): void => {
      for (const rail of rails.values()) {
        rail.root.remove()
        hideTipIfFrom(rail)
      }
      rails.clear()
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
      frameScheduled = false
    }

    /** Rail geometry follows the scroller rect each frame (adapts to side
     *  panels, resize, narrow screens) while staying clear of the header
     *  row, the sticky title, composer overlays and the native scrollbar.
     *  Every write is change-detected. */
    const syncGeometry = (rail: Rail): void => {
      const rect = rail.scroller.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        if (rail.root.style.display !== "none") rail.root.style.display = "none"
        return
      }
      if (rail.root.style.display === "none") rail.root.style.display = ""
      const parent = rail.root.offsetParent ?? document.body
      const parentRect = parent.getBoundingClientRect()
      const height = Math.round(
        Math.max(RAIL_MIN_HEIGHT, Math.min(RAIL_MAX_HEIGHT, rect.height - RAIL_TOP_GAP - RAIL_BOTTOM_GAP)),
      )
      const available = Math.round(rect.height - RAIL_TOP_GAP - RAIL_BOTTOM_GAP)
      const top = Math.round(rect.top - parentRect.top + RAIL_TOP_GAP)
      const left = Math.round(rect.right - parentRect.left - RAIL_WIDTH - INSET)
      const h = Math.min(height, Math.max(RAIL_MIN_HEIGHT, available))
      if (left !== rail.geo.left) rail.root.style.left = `${left}px`
      if (top !== rail.geo.top) rail.root.style.top = `${top}px`
      if (h !== rail.geo.height) rail.root.style.height = `${h}px`
      rail.geo = { left, top, height: h }
    }

    /** Active tick = the user input straddling the app's cursor line (top+100). */
    const updateActive = (rail: Rail): void => {
      const viewport = rail.viewport
      const box = viewport.getBoundingClientRect()
      const line = box.top + CURSOR_LINE_OFFSET
      const indexById = new Map(rail.entries.map((entry) => [entry.id, entry.idx]))
      let activeId = ""
      let activeIdx = 0
      let fallback: { id: string; idx: number; top: number } | undefined
      for (const element of viewport.querySelectorAll<HTMLElement>("[data-message-id]")) {
        const id = element.dataset.messageId
        const idx = id ? indexById.get(id) : undefined
        if (!id || idx === undefined) continue
        const rect = element.getBoundingClientRect()
        if (rect.bottom <= box.top || rect.top >= box.bottom) continue
        if (rect.top <= line && rect.bottom >= line) {
          activeId = id
          activeIdx = idx
          break
        }
        if (!fallback || rect.top < fallback.top) fallback = { id, idx, top: rect.top }
      }
      if (!activeId && fallback) {
        activeId = fallback.id
        activeIdx = fallback.idx
      }
      if (!activeId || activeId === rail.activeId) return
      rail.activeId = activeId
      for (const [id, item] of rail.items) {
        const on = id === activeId
        item.el.classList.toggle(ACTIVE_CLASS, on)
        if (on) item.el.scrollIntoView({ block: "nearest" })
      }
      rail.headCurrent.textContent = String(activeIdx)
    }

    // ---------- polling (session / entries changes, throttled sync) ----------

    const tick = (): void => {
      ensureRails()
      // Entries follow the session data store; a length or id-set change
      // updates the rail without any DOM history scan.
      for (const rail of rails.values()) {
        const key = sessionKeyOf()
        if (key && key !== rail.sessionKey) {
          rail.sessionKey = key
          rail.entries = entriesFor(key)
          rail.activeId = ""
          rebuildTurns(rail)
          rebuildItems(rail)
          syncSessionData(key)
          lastSyncSessionKey = key
          lastSyncAt = Date.now()
          continue
        }
        const entries = entriesFor(rail.sessionKey)
        const changed =
          entries.length !== rail.entries.length ||
          entries.some((entry, index) => (rail.entries[index]?.id ?? null) !== entry.id)
        if (changed) {
          rail.entries = entries
          rebuildTurns(rail)
          rebuildItems(rail)
        }
        const total = `/ ${rail.entries.length}`
        if (rail.headTotal.textContent !== total) rail.headTotal.textContent = total
        if (!rail.activeId) {
          const first = rail.entries[0]
          if (first) {
            rail.activeId = first.id
            rail.items.get(first.id)?.el.classList.add(ACTIVE_CLASS)
            rail.headCurrent.textContent = "1"
          }
        }
      }
      // Throttled re-sync of the session data: session switch is immediate,
      // a running session refreshes every 2s (idle sessions don't need it).
      for (const rail of rails.values()) {
        // Solid can recreate the ScrollView subtree on route/detail changes —
        // re-bind the real scrolling viewport when the old one went away.
        if (!rail.viewport.isConnected) rail.viewport = findViewport(rail.scroller)
      }
      const rail = rails.values().next().value as Rail | undefined
      const now = Date.now()
      if (rail && rail.sessionKey && now - lastSyncAt > 800) {
        const running =
          dataFor(rail.sessionKey.slice(0, rail.sessionKey.indexOf("\n")))?.session.status(
            rail.sessionKey.slice(rail.sessionKey.indexOf("\n") + 1),
          ) === "running"
        if (rail.sessionKey !== lastSyncSessionKey || (running && now - lastSyncAt > SYNC_RUNNING_MS)) {
          lastSyncSessionKey = rail.sessionKey
          lastSyncAt = now
          syncSessionData(rail.sessionKey)
        }
      }
    }

    pollTimer = setInterval(tick, POLL_MS)
    ensureRails()

    console.error("[prompt-navigator] GUI part loaded")

    // ---------- cleanup ----------

    return () => {
      if (pollTimer) clearInterval(pollTimer)
      if (raf) cancelAnimationFrame(raf)
      if (flashTimer) clearTimeout(flashTimer)
      teardownRails()
    }
  },
})