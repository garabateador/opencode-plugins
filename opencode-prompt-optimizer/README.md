# opencode-prompt-optimizer (OpenCode v2)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.3-blue.svg)](.)
[![Platform](https://img.shields.io/badge/platform-opencode%20v2-blueviolet.svg)](https://opencode.ai)

OpenCode **v2** plugin. Expands rough requests into engineering task drafts that an LLM can execute directly (output begins directly with the task content — no `[DRAFT]` prefix; that marker was removed in 1.0.1), and works in both the **TUI** and **Desktop**.

> A complete rewrite of the v1 [opencode-prompt-optimizer 0.3.x](https://github.com/JochenYang/opencode-prompt-optimizer) (TUI-only) to the v2 plugin standard.

## What you get

You type in the input box:

```
Add a status bar under the sessions chat area that shows the current model and context usage
```

After triggering optimization you get (replaced into the input box on Desktop; shown in a review dialog with one-key copy on the TUI):

```
Work from the existing frontend stack (first use the Read tool to inspect the sidebar and
session-area component directory structure and locate key files such as Sidebar,
ChatInput/MessageInput), delivering in this order:

1. StatusBar component
- ...(generated based on the actual project)
```

The output starts directly with the task content (no leading `[DRAFT]` marker) and automatically references real files of the current project. **Drafts are reviewed first and sent second** — never auto-sent — matching v1 semantics (the v1 `[DRAFT]` marker was removed by user request).

## v2 architecture: one package, four parts

| Export | Runs in | Responsibility |
| --- | --- | --- |
| `.` (server) | OpenCode server | The optimization engine (the only implementation of this plugin): RPC registration, model resolution, project awareness, one-shot generation |
| `./rpc` | any client | Typed RPC contract `Optimize.optimize` |
| `./tui` | terminal UI | ✦ icon (`prompt.footer.status` slot), `/optimize` command, result dialog + OSC-52 copy |
| `./gui-experimental` | Desktop window | ⌘⇧O / `/optimize` commands, the ✦ Optimize pill, composer read/write (fully restores v1 input-box replacement semantics) |

```text
opencode-prompt-optimizer/
├── package.json               # four exports + build scripts + v2 dependencies
├── tsconfig.json              # server/rpc/engine (plain TS)
├── tsconfig.tui.json          # TUI (OpenTUI Solid JSX)
├── tsconfig.gui.json          # GUI (Solid DOM JSX)
├── vite.config.ts             # the app's official Vite preset for the GUI part
├── scripts/build.ts           # Bun bundling for the TUI part
├── smoke.ts                   # RPC smoke script (local verification; not shipped in the package)
└── src/
    ├── index.ts               # server part: Plugin.define + ctx.rpc.register + generate.text
    ├── engine.ts              # migrated from v1 verbatim: prompt building / language detection / think stripping / project context
    ├── rpc.ts                 # Rpc.define contract (shared by all three parts)
    ├── tui.tsx                # TUI part
    └── gui.tsx                # GUI part
```

## Installation

### From npm (recommended)

```
opencode plugin add opencode-prompt-optimizer
```

The package includes the server part → it is registered into the `plugins` array of the global `opencode.json(c)`; the TUI and Desktop then load their own parts automatically. Restart OpenCode for this to take effect.

### Manual configuration

```jsonc title="opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-prompt-optimizer",
    // or the object form with options:
    {
      "package": "opencode-prompt-optimizer",
      "options": {
        "language": "auto",
        "variant": "none",
        "includeContext": true,
        "timeoutMs": 120000
      }
    }
  ]
}
```

### Local directory (for development)

v2 auto-discovers directories under `.opencode/plugins/`; when a directory contains `package.json` + `exports`, it is loaded like a published package:

```bash
mkdir -p .opencode/plugins
ln -s /path/to/opencode-prompt-optimizer .opencode/plugins/prompt-optimizer
```

### Uninstall

```
opencode plugin remove opencode-prompt-optimizer
```

Or delete the entry from the `plugins` array in `opencode.json(c)`, then clear the cache:

```
rm -rf ~/.cache/opencode/packages/opencode-prompt-optimizer*
```

## Usage

### TUI

| Trigger | Behavior |
| --- | --- |
| Type `/opt <rough request>` (or `/optimize`) | Directly optimizes the text after the command; after running, the `/opt` prefix stays in the input box (generic host behavior for `arguments` commands) — clear it manually |
| Type a rough request, then click the **✦** at the **bottom-right of the input box** (or pick "Optimize prompt" via ⌘P) | **Reads the current input → optimizes → replaces it in place** (v1 semantics fully restored) |
| Pick "Optimize prompt" in the command palette (⌘P) | Same as above |

Default `delivery: "insert"`: the input box content is **replaced in place** (read → optimize → write back via `EditBuffer.replaceText`, with an automatic fallback to the dialog + copy path when read-back verification fails); set `"delivery": "dialog"` (via `cli.json` options) to return to the review-dialog + OSC-52 copy mode. While running, the ✦ turns into a spinner. The ✦ sits at the far right of the input box's footer row (appended to the documented `prompt.footer` slot trail — the last element of that space-between flex row — and works on both the home and session input boxes). In-place replacement locates the prompt TextareaRenderable through the plugin's `context.renderer` renderable tree — an OpenTUI-internal surface (if the host changes shape, it falls back to the dialog automatically; see the `delivery` semantics).

### Desktop

| Trigger | Behavior |
| --- | --- |
| Type a rough request in the session composer and press **⌘⇧O** | The composer content is **replaced** with the optimized task draft and focus returns to the composer; send after review |
| Type `/optimize` in a session | Same as above |
| Click the **✦ Optimize** pill above the composer | Same as above |
| Press ⌘⇧O on Home (no session open) | A dialog collects the request → optimize → opens a new draft session pre-filled with the task draft |

**On Desktop, v1's "read input → replace → human review" semantics are reproduced exactly via `composer.text()` / `composer.setText()`.**

> ⚠️ The v2 Desktop window slots (`window.bottom` / `session.header` / `session.location.menu` / `session.panel.end`) do not cover a position beside the send/stop button, so the inline form uses controlled DOM injection (anchored on the app's `data-slot`/`data-action` attributes; it renders nothing when the anchor is missing, and `buttonPlacement: "lane"` can always be switched back).

## Configuration

Put options in the `options` object of the plugin entry in `opencode.json(c)` (read by the server part):

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `language` | `"auto"` / `"en"` / `"zh"` | `"auto"` | Output language; `"auto"` detects from input text (Chinese → zh) |
| `overrideModel` | `{ providerID, modelID }` | (inherited) | Force a model; the location's default model otherwise |
| `variant` | `string` | (none) | Model variant (e.g. `"none"` to turn thinking off). The v2 server part first validates against the target model's `variants` list and **falls back silently** to the model's default variant when the variant is unregistered (v1 semantics; the native v2 generate API hard-fails, so the fallback is implemented inside the plugin — the server logs `variant not registered, falling back`) |
| `includeContext` | `boolean` | `true` | Whether to inject project context; when off, only the request text is polished |
| `timeoutMs` | `number` | `120000` | Per-optimization timeout in ms; a typed error is returned on timeout |
| `buttonPlacement` | `"inline" \| "lane" \| "none"` (GUI only) | `"inline"` | `inline`: the ✦ button is injected to the **left** of the send/stop button (DOM anchor `[data-slot="composer-actions"]` → `[data-action="composer-submit"]`; degrades to a hidden no-op when the app's internals change — ⌘⇧O always works); `lane`: pill above the composer (1.0 behavior); `none`: commands only |
| `showPill` (GUI only, compatibility) | `boolean` | — | Legacy from 1.0: `true` → `lane`, `false` → `none`; the default resolves to `inline` |
| `pollIntervalMs` | — | — | **V1 legacy, ignored** (v2 logs a notice on load since there is no polling) |

### Project awareness

When enabled, every optimization injects (same scope and budget as v1):

- `package.json` name / description / dependencies (first 8) + devDependencies (first 6)
- Rule files (2 KB budget, in priority order): `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `.cursorrules` / `.windsurfrules` / `CONVENTIONS.md` / `INSTRUCTIONS.md` / `.github/copilot-instructions.md`
- Git state (read through `ctx.vcs` in v2, works on remote servers): current branch + modified files (first 12, `node_modules/` filtered)

The cache is reused for the same directory for 5 minutes. **Only the fixed files above are read — no recursive project scanning.** Fully disabled with `"includeContext": false`.

## Permissions

- The RPC surface is the permission surface: a single method `optimize` (read text → one-shot generation), with no tools, no shell, and no recursive scanning.
- All model calls happen in the server process using OpenCode's configured providers; the plugin adds no `permission.request` of its own.
- The GUI part shows up in Desktop under Settings → Extensions → Plugins and can be toggled on/off at any time.

## Key v1 → v2 differences and changes

### API / lifecycle / configuration

| Dimension | v1 (0.3.x) | v2 (1.0.0) | Corresponding change |
| --- | --- | --- | --- |
| Plugin shape | `./tui` part only | server + rpc + tui + gui (four parts) | Optimization engine moved to the server part; RPC and GUI parts added |
| Entry point | `TuiPluginModule { id, tui }` with `tui(api, options)` (`@opencode-ai/plugin/tui`) | `Plugin.define({ id, setup(ctx) })` (`@opencode/plugin` / `/tui` / `/gui`) | All three entry points rewritten; cleanup semantics provided by the v2 lifecycle (cache-pruning timer) |
| Optimization execution | In the TUI: `session.create → session.prompt → poll messages → session.delete` (4+ API calls + polling) | `ctx.experimental.generate.text` (no session, no tools, nothing in history — one call) | Polling code removed; `pollIntervalMs` retired |
| Composer read/write | Slots `home_prompt` / `session_prompt` replaced the whole Prompt component and captured a `TuiPromptRef` (`ref.set`) | The v2 SDK has **no prompt read/write API** (Desktop has `composer.text/setText`) | Desktop fully restored; the TUI switched to "command arguments / dialog to collect input + dialog to deliver the draft + one-key OSC-52 copy" — the same pattern as the host's first-party plugins (/btw) |
| UI injection | `api.slots.register` | The slot tree such as `ctx.ui.slot({append: "prompt.footer.status", render})` | The ✦ icon moved to `prompt.footer.status` (rendered on both home and session input boxes) |
| Feedback | `api.ui.toast({variant: success\|warning\|error})` | TUI `ctx.ui.toast.show` (info/success/warning/error); GUI `ctx.toast.show` (default/success/error/loading) | Call surface and variant sets updated |
| Theming | `api.theme.current.accent / textMuted` | `ctx.theme.text.base/muted/faint` and `theme.hue.interactive[200]` | Token structure updated |
| Project awareness | `execFileSync git` + local fs in the TUI process | Server-part fs + `ctx.vcs.get/status` (located by the RPC `directory` argument, works remotely) | The git subprocess is gone |
| Configuration | `tui.json` `"plugin": [pkg \| [pkg, opts]]` | `opencode.json(c)` `"plugins": [... \| {package, options}]`; TUI-only packages use `cli.json`; `.opencode/plugins/` auto-discovery | Config key, file names, and forms all changed |
| Dependencies | peer `@opencode-ai/plugin >=1`; deps `@opentui/*` 0.2.16, `solid-js` 1.9.13 | dep `@opencode/plugin ^2.2`; peer `@opentui/* >=0.6.6`, `solid-js >=1.9` | One SDK dependency; the host runtime provides the remaining modules |

### Semantics preservation checklist

- `[DRAFT]` prefix: present in v1; removed from 1.0.1 by user request (the prompt no longer asks for it, and any model-emitted one is stripped defensively). The 300-word cap, ordered sub-tasks, and no-Markdown-headings rules are retained (same builder code).
- Language `auto/en/zh` detection and fallback, think-block stripping — preserved verbatim.
- Project-awareness scope / budget / TTL — preserved verbatim (the git read channel was replaced).
- "Draft is reviewed before sending, never auto-sent" — identical semantics on Desktop; on the TUI it became dialog delivery + one-key copy due to v2 SDK capability limits (the closest equivalent form under the v2 rules).
- `overrideModel` / `variant` / `includeContext` / `timeoutMs` — semantics unchanged.

## Development

```bash
npm install          # or bun install
npm run typecheck    # the three tsconfigs (server / TUI / GUI)
npm run build        # dist/tui.js (Bun) + dist/gui-experimental.cjs (Vite)
npm run dev          # TUI watch mode (for the GUI use vite build --watch)
```

## Verification and testing (executable steps)

All of the following steps were actually executed during the development of this repository.

### 1. Build and type check

```bash
npm run typecheck && npm run build
# expected output:
#   tui.js  ~9.5 KB
#   dist/gui-experimental.cjs  ~3 kB │ gzip: 1.33 kB
```

### 2. Artifact contract check

```bash
bun -e 'const m = await import("./dist/tui.js"); console.log(m.default)'
# expected: { id: "prompt-optimizer.tui", setup: [Function] }  ← the shape the host's isPlugin check expects
```

### 3. Server-part load + full RPC smoke run (no UI)

```bash
# prepare a test project
SMOKE=$(mktemp -d) && cd $SMOKE && git init -q
echo '{"name":"smoke"}' > package.json && echo '# Smoke' > AGENTS.md
mkdir -p .opencode/plugins
ln -s /path/to/opencode-prompt-optimizer .opencode/plugins/prompt-optimizer
git add -A && git commit -qm smoke && echo x > echo.txt

# start the v2 server
opencode serve --hostname 127.0.0.1 --port 4587 2>&1 | tee serve.out &
sleep 5
# expected log line: [prompt-optimizer] server part loaded { language: "auto", ... }

# call the RPC via this repository's smoke.ts (a configured model is required, e.g. opencode auth login)
export SMOKE_PASSWORD=$(grep -a "server password" serve.out | awk '{print $3}')
bun /path/to/opencode-prompt-optimizer/smoke.ts
# expected in the plugin list: { id: "prompt-optimizer", state: "active", features: { server: true, tui: true, rpc: true, gui: true } }
# expected optimize result: { language: "zh", contextUsed: true } and text starting directly with the task content (no [DRAFT] prefix)
```

Expected output for the empty-input path (reproducible without a usable model):

```
empty-text ok: Input is empty, nothing to optimize
```

### 4. TUI end-to-end (verified locally against opencode v2.2.0, with a real terminal driven through tmux)

```bash
cd $SMOKE && opencode
```

Execution record (`opencode.json` configured with `overrideModel` + the local-path package):

1. ✅ The **✦** appeared in the footer at the bottom of both the home and session input boxes (the `prompt.footer.status` slot); the control project without the plugin directory showed no ✦ (the negative control held).
2. ✅ The `/` slash completion listed both `/opt` and `/optimize` (the alias works), described as "Expand a rough request into an executable task spec".
3. ✅ `/opt <rough request>` + Enter → the ✦ turned into a **spinner** (busy state) → optimization ran on the model selected in the composer → the **result dialog** rendered fully (title "Optimized draft — review, edit, then paste into the input and send"), and the draft correctly cited real project info (AGENTS.md and the solid-js + TypeScript stack were detected — project awareness works).
4. ✅ Pressing `c` in the dialog → OSC-52 write to the clipboard → the hint changed to `✓ copied`; `esc` closes.
5. ✅ `/opt` without arguments → the `/opt` prefix stayed in the input box plus the same empty-input toast as v1.
6. ✅ Running the slash command with arguments did **not** submit the command text to the main agent (drafts are never auto-sent).
7. ✅ The `/plugins` page showed both the TUI part `prompt-optimizer.tui` and the server part `prompt-optimizer` as active.
8. ⚠️ Two v2 details were discovered and fixed along the way: error-message rendering (RPC error object shapes) and the need to **explicitly pass `location` with RPC calls** (under a shared-server topology the server resolves plugin registrations per location) — both are now baked into `src/tui.tsx` / `src/gui.tsx`.
9. ℹ️ The only remaining model-layer issue was an account-level quota problem ("Free usage limit reached" once the free quota was exhausted — even free models count against the same quota); switching to an authenticated provider unblocked it — local verification was switched to Ollama Cloud.

### 5. Desktop end-to-end

Prerequisite facts (verified locally): the Desktop app's own sidecar (`serve --service`) already loads the plugin's server part and RPC under location scope (confirmed by the server log `loading plugin … entrypoint=src/index.ts`); the GUI part's window-side injection requires the interactive steps below.

1. Add this package to the `plugins` array of the global `opencode.jsonc` → `prompt-optimizer` appears, enabled, under **Settings → Extensions → Plugins**.
3. Type a rough request in a session → **⌘⇧O** → the input box is **replaced** with the optimized task draft and focus returns to it; press Enter to send after review.
4. Also try `/optimize` and the ✦ button; on Home, press ⌘⇧O → a new draft session opens carrying the task draft.
5. `"options": { "showPill": false }` → the pill disappears, commands keep working.

### 6. Semantic regression checklist

| Case | Expected |
| --- | --- |
| Chinese input | Chinese draft output |
| English input | English draft output |
| `"includeContext": false` | `contextUsed: false` in the server log |
| `"variant": "none"` | the model field in the server log carries the variant |
| `"overrideModel": {...}` | generation uses the specified model |
| Empty input | typed error `Input is empty, nothing to optimize` |
| Model timeout (set `timeoutMs` to 1000) | `Optimization failed: 1s timeout` |

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Plugin not loaded | Look for `[prompt-optimizer] server part loaded` in the `opencode serve` log; if absent, check `.opencode/plugins/` or the `plugins` array in `opencode.jsonc` |
| No ✦ / no `/opt` in the TUI | Missing build artifacts: with the local-directory install, run `npm run build` first (`./tui` points at `dist/tui.js`); check the TUI part status via `/plugins` |
| Optimization output is English (Chinese input) | Set `"language": "zh"` explicitly |
| `Optimization failed: …s timeout` | Increase `timeoutMs` or switch `overrideModel` |
| Free-quota error | `Free usage limit reached…` is a provider-side limit; configure authentication or switch provider |
| TUI copy fails | The terminal does not support OSC-52; select the text with the mouse and copy |
| GUI part missing in Desktop | Check that `dist/gui-experimental.cjs` is built, and that the plugin is listed in the **global** `opencode.json(c)` (Desktop reads only the global config) |

## License

[MIT](LICENSE)