# opencode-plugins

Two [OpenCode](https://opencode.ai) **v2** plugins, developed and shipped together:

| Plugin | Version | What it does | Surfaces |
| --- | --- | --- | --- |
| `opencode-prompt-navigator` | 1.1.0 | Jump back to any user prompt of a session — a right-edge navigation rail on Desktop, a sidebar widget + navigation panel in the TUI | Desktop (GUI), TUI |
| `opencode-prompt-optimizer` | 1.0.3 | One-click rewrite of a rough request into a concise, directly-executable task spec — always reviewed before sending | OpenCode server, TUI, Desktop (GUI) |

Both plugins are written in TypeScript and built on `@opencode/plugin` (^2.2.0). They target OpenCode **v2.x** only.

<!--
  Maintainer fill-in points:
  - Author / repository URL: this README avoids absolute self-links; add the
    repository link and author badge when publishing to npm or elsewhere.
  - opencode-prompt-navigator declares "license": "MIT" in package.json but
    has no LICENSE file yet — add one (and a top-level LICENSE if desired).
-->

## Requirements

- **OpenCode v2.x.** OpenCode itself provides the plugin SDK (`@opencode/plugin`) and the peer runtimes (`@opentui/core`, `@opentui/solid`, `solid-js`) that the plugins build against — you do not install those yourself.
- Only needed to **build from source**: [Bun](https://bun.sh) (TUI bundle) and Node.js/npm with the Vite toolchain (Desktop bundle). Prebuilt releases do not require Bun.

## Installation

### From a published package

```bash
opencode plugin add opencode-prompt-optimizer
```

`opencode-prompt-navigator` installs the same way if you publish it to npm; otherwise install it from a local path as shown below.

> TODO: adjust the install command once both package names are confirmed on npm.

### From source (local development)

Each plugin directory is self-contained:

```bash
cd opencode-prompt-navigator   # or opencode-prompt-optimizer
npm install
npm run build                  # dist/tui.js (Bun) + dist/gui-experimental.cjs (Vite)
```

OpenCode v2 auto-discovers plugins under `.opencode/plugins/` in a workspace:

```bash
mkdir -p .opencode/plugins
ln -s /absolute/path/to/opencode-prompt-navigator .opencode/plugins/prompt-navigator
ln -s /absolute/path/to/opencode-prompt-optimizer .opencode/plugins/prompt-optimizer
```

### Registering the plugins

Config snippets use `options` per plugin; see [Configuration](#configuration) for the full option tables.

```jsonc
// ~/.config/opencode/opencode.json — Desktop (GUI part) of the navigator
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-prompt-navigator",
      "options": { "enabled": true, "inset": 16 }
    }
  ]
}
```

```json
// ~/.config/opencode/cli.json — TUI part of the navigator
{
  "plugins": [
    { "package": "/absolute/path/to/opencode-prompt-navigator" }
  ]
}
```

The navigator has no server part, so register the same package in both files (`opencode.json` for the Desktop rail, `cli.json` for the TUI panel).

```jsonc
// ~/.config/opencode/opencode.json(c) — the optimizer has a server part,
// registered through the standard plugins array (TUI/Desktop parts load automatically)
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    // string form loads with default options:
    // "opencode-prompt-optimizer"
    {
      "package": "opencode-prompt-optimizer",
      "options": {
        "language": "auto",
        "includeContext": true,
        "timeoutMs": 120000
      }
    }
  ]
}
```

Restart OpenCode after changing the configuration. The plugins log their load status to the server/stderr console, e.g. `[prompt-optimizer] server part loaded …` and `[prompt-navigator] TUI part loaded`.

### Uninstall

```bash
opencode plugin remove opencode-prompt-optimizer
```

Or remove the entries from the config files above, then clear the package cache:

```bash
rm -rf ~/.cache/opencode/packages/<plugin-name>*
```

## Usage

### opencode-prompt-navigator

The navigator lists every **user input** of a session (from the synced session data, `type: "user"`) so you can re-read or re-anchor at any prompt without scrolling through replies.

**Desktop (`./gui-experimental`)** — a slim vertical rail docked to the right edge of the conversation timeline:

- One tick mark per user input, in chronological order; numeric index labels next to ticks (all labels when the session has ≤ 32 inputs, otherwise every 10th)
- Hovering a tick shows a tooltip: `#index · HH:MM · prompt snippet`
- A **current-position** indicator tracks the prompt next to the app's cursor line; the rail header shows `current/total`
- **Click a tick** to scroll straight to that prompt row (works across the fully virtualized timeline) and flash-highlight it for ~1.8 s
- Toggle the rail with <kbd>Mod</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> (`Mod` = `Cmd`/`Ctrl` depending on platform) or via the command palette entry *Toggle prompt navigation rail*; the toggle is for the current app run and resets on reload

**TUI (`./tui`)** — the same data reshaped onto the TUI's sanctioned surfaces:

- A sidebar widget shows `USER PROMPTS · focus/total` plus the latest 8 inputs (`#index HH:MM snippet`); clicking a row opens the navigation panel focused on it
- The `/prompts` slash command (or *Prompt navigation* in the command palette) opens the full navigation panel — the latest **300** inputs of any session
- Panel keys:

| Key | Action |
| --- | --- |
| `↑` / `↓` or `j` / `k` | Select previous / next row |
| `Enter` or click | Expand / collapse the full prompt text |
| `c` | Copy the focused prompt to the clipboard (OSC-52) |
| `PgUp` / `PgDn` | Scroll by 10 rows |
| `Home` / `End` | Jump to first / last row |
| `Esc` | Close the panel |

Example:

```
#12 14:30  refactor auth middleware to pass the tenant id ── Press Enter for full text
```

### opencode-prompt-optimizer

The optimizer rewrites a rough request into a reviewable task draft (≤ 300 words, sub-tasks in execution order, project conventions respected). **Drafts are never sent automatically** — they land in your input for review, and *you* hit send.

Internals (one package, four parts):

| Export | Runs in | Responsibility |
| --- | --- | --- |
| `.` (server) | OpenCode server | The optimizer engine: RPC registration, model resolution, project awareness, one-shot generation |
| `./rpc` | any client | Typed RPC contract `Optimize.optimize` |
| `./tui` | terminal UI | `✧` trigger in the prompt footer, `/optimize` command, result dialog + OSC-52 copy |
| `./gui-experimental` | Desktop window | `Mod+Shift+O` / `/optimize` / `✦` button, composer read/write |

**TUI**

| Trigger | Behavior |
| --- | --- |
| Click the `✧` icon at the bottom-right of the input box | Optimizes what is already typed and **replaces the input in place** (`delivery: "insert"`, default); shows a braille spinner while running |
| `/opt <rough request>` or `/optimize <…>` | Optimizes the typed arguments |
| Same triggers with `delivery: "dialog"` (or when in-place replacement is unavailable) | Opens the draft in a review dialog; `c` copies it via OSC-52, `Esc` closes |

**Desktop**

| Trigger | Behavior |
| --- | --- |
| <kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> / `/optimize` / command palette | Replaces the composer text with the optimized draft and returns focus for review |
| The `✦` button (default placement: left of the send/stop button) | Same action |
| `Mod+Shift+O` on the home screen (no session open) | Asks for the rough request in a dialog, then opens a **new draft session** containing the optimized prompt |

Example (illustrative output shape):

```text
Input:   add a status bar under the chat area showing the active model
         and context usage

Draft:   Add a StatusBar component below the chat area using the existing
         frontend stack — locate the chat input components first
         (path:line refs where known). In execution order:
         1. StatusBar component: current model id + context usage.
         2. Mount it under the chat area; keep layout stable while streaming.
         Include unit tests and TypeScript types; handle unknown model ids.
```

**Behavioral guarantees (from the server part):**

- One-shot generation via the session-less API — no session is created, no tools run, nothing is added to any session history
- The RPC surface is a single read-only method `optimize`; no shell, no recursive file scans
- Project context reads a **fixed** file set only (see below); git state comes through OpenCode's VCS API and works on remote servers too
- Think blocks (`<think>`/`<thinking>`) and any stray `[DRAFT]` prefix are stripped from the model output

## Configuration

Options live in the `options` object of each plugin entry in `opencode.json(c)` / `cli.json`.

### opencode-prompt-navigator

| Option | Type | Default | Applies to | Description |
| --- | --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Desktop + TUI | Rail visible on session screens; the Desktop rail can also be toggled at runtime (`Mod+Alt+N`) |
| `inset` | `number` | `16` | Desktop | Right-edge inset of the rail in px |

### opencode-prompt-optimizer (server part)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `language` | `"auto" \| "en" \| "zh"` | `"auto"` | Output language; `auto` detects CJK text in the input → `zh`, otherwise `en` |
| `overrideModel` | `{ providerID, modelID }` | unset | Force a specific model. Precedence: the model currently selected in your composer → `overrideModel` → the location's default model |
| `variant` | `string` | unset | Model variant, e.g. `"none"` to disable thinking. Silently dropped when the model does not offer it (server logs `variant not registered, falling back`) |
| `includeContext` | `boolean` | `true` | Inject project context into the system prompt (see below) |
| `timeoutMs` | `number` | `120000` | Per-optimization time budget in ms; timeouts surface as typed `failed` RPC errors |
| `pollIntervalMs` | — | — | V1 artifact, **ignored** with a log warning |

### opencode-prompt-optimizer (UI parts)

| Option | Type | Default | Part | Description |
| --- | --- | --- | --- | --- |
| `delivery` | `"insert" \| "dialog"` | `"insert"` | TUI | `insert` replaces the input box in place (with automatic fallback to the dialog); `dialog` always opens the review dialog with OSC-52 copy |
| `buttonPlacement` | `"inline" \| "lane" \| "none"` | `"inline"` | Desktop | `inline`: `✦` button injected left of the send/stop button; `lane`: floating `✦ Optimize` pill above the composer; `none`: commands only |
| `showPill` | `boolean` | unset | Desktop | Legacy 1.0 option: `true` → `"lane"`, `false` → `"none"` |

### Project awareness (optimizer)

When `includeContext` is enabled (default), each optimization is primed with:

- `package.json` — name, description, first 8 dependencies + first 6 devDependencies
- Rule files (combined budget ~2 KB, each capped): `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `CONVENTIONS.md`, `INSTRUCTIONS.md`, `.github/copilot-instructions.md`
- Git state — current branch + up to 12 modified files (excluding `node_modules/`)

Reads are limited to these fixed paths — **no directory walking** — and the context is cached per directory for 5 minutes. Set `"includeContext": false` to optimize text only.

## FAQ

**Does the optimizer send anything to the model without showing me?**
No. The result is always placed into your input box (or a review dialog) for manual review; nothing is submitted automatically, and no session is created.

**The `✦` button doesn't appear on Desktop.**
The inline button is injected next to the app's own send/stop control and renders nothing if the app's internal markup changes (silent no-op). `Mod+Shift+O`, `/optimize` and the command palette always work, and `"buttonPlacement": "lane"` is a layout-independent alternative.

**TUI copy (`c`) doesn't put anything in my clipboard.**
Both TUI parts copy via OSC-52, which requires a terminal that implements it. If unsupported, select the text with the mouse and copy it manually.

**Why was my `variant` ignored?**
Variants are validated against the model's variant list and dropped silently when unsupported — check the server log for `variant not registered, falling back`.

**The navigator panel caps at 300 rows?**
Only the TUI navigation panel limits itself to the latest 300 inputs of very long sessions (shown in its header). The Desktop rail always lists all inputs.

**What data do the plugins read?**
The navigator reads your session's user messages through OpenCode's session-data API. The optimizer reads the fixed context file set listed above and the git status of the target directory.

## Development

Run inside a plugin directory:

```bash
npm install
npm run typecheck   # tsc over the server / TUI / GUI tsconfigs
npm run build       # dist/tui.js (Bun) + dist/gui-experimental.cjs (Vite)
npm run dev         # watch mode for the TUI bundle; for the GUI bundle: npx vite build --watch
```

The optimizer ships an RPC smoke test against a running `opencode serve`:

```bash
opencode serve --hostname 127.0.0.1 --port 4587 &   # grab the server password from the log
export SMOKE_PASSWORD=<server password>
export SMOKE_BASE=http://127.0.0.1:4587             # optional override
bun run smoke                                       # prints plugin state + one optimize() round-trip
```

The navigator has a seeding helper for manual TUI testing (creates sessions with user prompts via the OpenCode HTTP API):

```bash
SEED_PASSWORD=<server password> \
SEED_DIR=<target project directory> \
SEED_BASE=http://127.0.0.1:49374 \
bun scripts/seed.ts
# SEED_TEXTS="first prompt|second prompt" to customize (pipe-separated)
```

Neither script hardcodes credentials — both read passwords from environment variables.

## License

MIT — see [opencode-prompt-optimizer/LICENSE](opencode-prompt-optimizer/LICENSE).

- `opencode-prompt-optimizer` ships the full MIT license text.
- `opencode-prompt-navigator` declares `"license": "MIT"` in its `package.json`.

<!-- TODO: add a LICENSE file for opencode-prompt-navigator (and a top-level
     LICENSE if this repository is published as a whole). -->