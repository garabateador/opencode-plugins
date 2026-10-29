# opencode-prompt-optimizer (OpenCode v2)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](.)
[![Platform](https://img.shields.io/badge/platform-opencode%20v2-blueviolet.svg)](https://opencode.ai)
[![中文](https://img.shields.io/badge/docs-中文-green.svg)](README.md)

OpenCode **v2** plugin. Expands rough requests into directly-executable task specs (`[DRAFT]`), for both the **TUI** and **Desktop**. Complete rewrite of the v1 (TUI-only) plugin to the v2 plugin standard.

## Architecture: one package, four parts

| Export | Runs in | Responsibility |
| --- | --- | --- |
| `.` (server) | OpenCode server | The only implementation of the optimizer: RPC, model resolution, project awareness, one-shot generation |
| `./rpc` | any client | Typed RPC contract `Optimize.optimize` |
| `./tui` | terminal UI | ✦ icon (`prompt.footer.status` slot), `/optimize` command, result dialog + OSC-52 copy |
| `./gui-experimental` | Desktop windows | ⌘⇧O / `/optimize`, ✦ Optimize composer pill, composer read/write (exact v1 semantics) |

## Install

```bash
opencode plugin add opencode-prompt-optimizer
```

Or in `opencode.json(c)`:

```jsonc
{
  "plugins": [
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

Local development: symlink the directory under `.opencode/plugins/` (auto-discovered).

## Usage

**TUI** — type a rough request, then the ✦ button at the bottom-right of the prompt input (or ⌘P → Optimize prompt): the plugin reads the input, optimizes it, and **replaces the input in place** (V1 semantics, via `delivery: "insert"`, default). `/opt [text]` optimizes the typed arguments. `"delivery": "dialog"` (cli.json options) keeps the OSC-52 review-dialog flow instead.

**Desktop** — write a rough request in the composer, then ⌘⇧O / `/optimize` / the ✦ pill. The composer text is **replaced** with the `[DRAFT]` (via `composer.setText`), focus returns, and you review before sending — identical to v1. On Home, the draft opens in a new session instead.

## Options (server part, via `options`)

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `language` | `"auto" \| "en" \| "zh"` | `"auto"` | CJK detection for auto |
| `overrideModel` | `{ providerID, modelID }` | inherit | location default model otherwise |
| `variant` | `string` | — | e.g. `"none"`; silent fallback |
| `includeContext` | `boolean` | `true` | package.json + rule files + git |
| `timeoutMs` | `number` | `120000` | typed timeout error |
| `buttonPlacement` (GUI only) | `"inline" \| "lane" \| "none"` | `"inline"` | `inline`: ✦ injected **left of the send/stop button** (DOM anchor `[data-slot="composer-actions"]` → `[data-action="composer-submit"]`; silent no-op if the app's internals move — ⌘⇧O always works); `lane`: pill above the composer (1.0 behavior); `none`: commands only |
| `showPill` (legacy) | `boolean` | — | `true` → `lane`, `false` → `none` |
| `pollIntervalMs` | — | — | **V1 artifact, ignored** |

Project awareness scans the same fixed file set as v1 (package.json, `AGENTS.md`/`CLAUDE.md`/… under a 2 KB budget, git branch + up to 12 modified files) with a 5-minute per-directory cache; git state now goes through `ctx.vcs`. No recursive scans. See [README.md](README.md) for the full v1→v2 migration table, verification steps, and troubleshooting.

## Verify

```bash
npm run typecheck && npm run build
# server part + RPC smoke test:
opencode serve 2>&1 | tee serve.out & sleep 5
export SMOKE_PASSWORD=$(grep -a "server password" serve.out | awk '{print $3}')
bun smoke.ts
```

## License

[MIT](LICENSE)