# opencode-prompt-navigator

Workbuddy-style **prompt navigation** for OpenCode v2 — a right-edge rail on **Desktop** and a sidebar widget + navigation panel on the **TUI**, shipped as one GUI+TUI plugin.

**Desktop (`./gui-experimental`)** — a slim vertical rail docked to the right edge of the session conversation area:

- **Chronological marks** — one tick per user input, in order; a numeric index beside each tick when ≤ 32 inputs, then every 10th (each in its own 18px column, so ticks/numerals/tooltip never overlap)
- **Thumbnail text on hover** — `#index · HH:MM · snippet` on a native-looking tooltip (app `--v2-*` tokens, dark/light aware)
- **Current position indicator** — the active tick elongates in accent color; the rail header shows `current / total`
- **Click to jump** — scroll to the user's prompt row (turn-anchored estimate → virtualizer mounts the row → `user-message:` wrapper aligned START under the sticky title → accent flash highlight), with a frame-by-frame follower absorbing virtualizer measurement drift
- **`Mod+Alt+N`** toggles the rail; the command palette lists "Toggle prompt navigation rail"

**TUI (`./tui`)** — the rail reshaped onto the TUI's sanctioned surfaces (the TUI plugin SDK offers no access to the timeline's scroll offset, so host-internal scroll sync is replaced by focus tracking):

- `sidebar.content` widget — `PROMPTS · focus/total` plus the latest 8 inputs (`#i HH:MM snippet`), clicking one opens the panel focused there
- `/prompts` slash + palette command — opens the full navigation panel (up to the latest 300 inputs of any session)
- Panel: `↑/↓` select, `enter`/click expands the FULL prompt text, `c` copies it via OSC-52, `j/k` scrolls, `esc` closes
- Entries come from the same synced session data (`data.session.message`, `type:"user"`); Enter/Return handled for both keynames

## Loading

```jsonc
// ~/.config/opencode/opencode.json   (Desktop, GUI part)
{
  "plugins": [
    { "package": "/path/to/opencode-prompt-navigator", "options": { "enabled": true, "inset": 16 } }
  ]
}
```

```json
// ~/.config/opencode/cli.json   (TUI part — a TUI+GUI package without a server part is registered here)
{
  "plugins": [
    { "package": "/path/to/opencode-prompt-navigator", "options": { "enabled": true } }
  ]
}
```

`npm run build` produces `dist/tui.js` (Bun) and `dist/gui-experimental.cjs` (Vite); `vite build --watch` hot-reloads the Desktop rail, TUI restarts pick up rebuilt bundles.

## How it works

- Entries come from the synced session data (`data.session.message`, `type:"user"`), not the DOM, so history is never re-scanned
- The Desktop timeline is virtualized; DOM reads are bounded to the mounted window. Row wrappers expose `[data-timeline-key]` (`user-message:<id>` — unique to prompt rows; never `[data-message-id]`, which every row of a turn carries) and are positioned at the virtualizer's own authoritative offsets
- Jumps use the app's own search recipe: turn-anchored scrollTop estimate → scroll → bounded rAF retry (with a ±2-viewport nudge when the scroll is pinned/inert) → center + highlight → 350 ms re-align
- One rAF loop coalesces geometry sync (rail follows the scroller rect — side panels, resize, narrow screens, 56px top / 110px bottom / 16px scrollbar clearances) and active-position detection (cursor line = viewport top + 100px, same constant as the app); all style writes are change-detected
- The TUI reads the OpenTUI keymap layers (`context.keymap.layer`), the session panel registry (`context.ui.slot({ append: "session.panel" })`) and `renderer.copyToClipboardOSC52` — all documented plugin APIs

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `enabled` | `true` | rail visible on session screens (both ends); TUI panel toggleable at runtime |
| `inset` (Desktop) | `16` | right-edge inset in px |

If the app's internal structure changes, the Desktop rail degrades to a silent no-op (the command still works); removing the `plugins`/`cli.json` entry uninstalls it. License: MIT.