import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Language } from "./rpc"

/**
 * Optimization engine, ported from the V1 implementation in src/tui.tsx
 * (opencode-prompt-optimizer 0.3.x). Behavior semantics are preserved:
 *
 * - output is a reviewable draft, never sent automatically (V1 marked it
 *   with a leading "[DRAFT]"; the marker is no longer requested and any
 *   model-emitted one is stripped defensively — see stripDraftPrefix)
 * - 300-word hard limit, ordered sub-tasks, natural language + short list
 * - "auto" language detection (CJK → zh, otherwise en), en fallback
 * - think-block stripping for reasoning models
 * - project awareness: package.json + fixed rule-file set under a 2 KB
 *   budget + git branch/modified files (12 max, node_modules filtered)
 *
 * Only two things changed from V1:
 * - the working directory is an explicit argument (V1 used process.cwd())
 * - git state is injected as a `VcsSnapshot` (V1 shelled out to
 *   execFileSync git; V2 reads it through the server's ctx.vcs domain)
 */

const LANG_HINT: Record<Language, string> = {
  en: "Output the optimized prompt in English. No explanation, no preamble, no think tags.",
  zh: "Output the optimized prompt in Chinese. No explanation, no preamble, no think tags.",
}

const STRONG_DOC_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".cursorrules",
  ".windsurfrules",
  "CONVENTIONS.md",
  "INSTRUCTIONS.md",
  ".github/copilot-instructions.md",
]

export const detectLanguage = (text: string): Language => (/[\u4e00-\u9fff]/.test(text) ? "zh" : "en")

export const stripThinkBlocks = (s: string): string =>
  s
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<\|begin\u258Cof\u258Cthinking\|>[\s\S]*?<\|end\u258Cof\u258Cthinking\|>/gi, "")
    .trim()

/**
 * V1 marked the optimized output with a leading "[DRAFT]". The marker is no
 * longer requested, but models familiar with the convention may still emit
 * one (optionally followed by a separator) — strip it from the head.
 */
export const stripDraftPrefix = (s: string): string =>
  s.replace(/^\s*\[DRAFT\]\s*[-—:：]?\s*/i, "").trim()

export type VcsSnapshot = {
  branch: string
  modifiedFiles: string[]
}

export type ProjectContext = {
  name: string
  description: string
  stack: string
  docs: string
  git: string
}

function readTextSafe(path: string, maxBytes: number): string | null {
  try {
    if (!existsSync(path)) return null
    const stat = statSync(path)
    if (!stat.isFile() || stat.size === 0) return null
    const buf = readFileSync(path)
    if (buf.length === 0) return null
    return buf.subarray(0, maxBytes).toString("utf-8")
  } catch {
    return null
  }
}

/**
 * Fixed-name reads only (package.json + STRONG_DOC_FILES). No directory
 * walking: the plugin never scans the tree, matching the V1 privacy note
 * ("read only these fixed files, no recursive scanning of the project").
 */
export function gatherProjectContext(directory: string, vcs: VcsSnapshot | null): ProjectContext | null {
  const pkgRaw = readTextSafe(join(directory, "package.json"), 1024)
  if (!pkgRaw) return null

  let name = ""
  let description = ""
  let stack = ""
  try {
    const pkg = JSON.parse(pkgRaw)
    name = typeof pkg.name === "string" ? pkg.name : ""
    description = typeof pkg.description === "string" ? pkg.description : ""
    const depList: string[] = []
    if (pkg.dependencies && typeof pkg.dependencies === "object") {
      depList.push(...Object.keys(pkg.dependencies).slice(0, 8))
    }
    if (pkg.devDependencies && typeof pkg.devDependencies === "object") {
      depList.push(...Object.keys(pkg.devDependencies).slice(0, 6))
    }
    stack = depList.filter(Boolean).join(", ")
  } catch {
    return null
  }

  let docs = ""
  let budget = 2048
  for (const file of STRONG_DOC_FILES) {
    if (budget <= 0) break
    const content = readTextSafe(join(directory, file), Math.min(budget, 512))
    if (content) {
      const header = "[from: " + file + "]\n"
      docs += "\n" + header + content + "\n"
      budget -= content.length + header.length
    }
  }

  let git = ""
  if (vcs) {
    git = "\n[GIT STATE]\n"
    git += "- Branch: " + vcs.branch + "\n"
    if (vcs.modifiedFiles.length > 0) {
      git += "- Modified:\n"
      for (const f of vcs.modifiedFiles) {
        git += "  - " + f + "\n"
      }
    }
  }

  return { name, description, stack, docs: docs.trim(), git: git.trim() }
}

/**
 * The user-facing instruction block, verbatim from V1's buildSystem
 * (only the CWD line now renders the explicit directory).
 */
function buildSystem(lang: Language, project: ProjectContext | null, userInput: string, directory: string): string {
  const ctx = project
    ? [
        "[WORKSPACE]",
        "- Project: " + project.name + (project.description ? " - " + project.description : ""),
        "- Stack: " + (project.stack || "(unknown)"),
        "- CWD: " + directory,
        project.docs ? "\n[PROJECT CONVENTIONS]\n" + project.docs : "",
        project.git ? "\n" + project.git : "",
      ].join("\n")
    : "[WORKSPACE: no project context (no package.json in cwd)]"

  return (
    "You are a project-aware prompt rewriter. Output is a DRAFT that the user will review and edit before sending to the main agent.\n\n" +
    ctx + "\n\n" +
    "[USER REQUEST]\n" + userInput + "\n\n" +
    "[YOUR JOB]\n" +
    "Rewrite the user's rough request into a clear, directly-executable engineering prompt that:\n" +
    "1. References specific files (path:line) when relevant to the request\n" +
    "2. Follows the project's existing tech stack and conventions (see [WORKSPACE])\n" +
    "3. Lists the sub-tasks in execution order\n" +
    "4. Includes non-functional requirements (tests, types, error handling, perf)\n" +
    "5. Output is a DRAFT - keep it concise, do NOT over-engineer\n" +
    "6. Hard length limit: 300 words max\n" +
    "7. Format: natural language + short list, no Markdown headings\n" +
    "8. " + LANG_HINT[lang] + "\n" +
    "Do NOT start the output with any marker like \"[DRAFT]\"; begin directly with the task."
  )
}

/** V1 sent the raw request as the user message with this suffix; generate.text takes one prompt, so the same shape is assembled. */
const USER_MESSAGE_SUFFIX =
  "\n\n(Please output the optimized prompt directly, without any explanation, markers, or formatting notes.)"

export function buildPrompt(input: {
  lang: Language
  project: ProjectContext | null
  raw: string
  directory: string
}): string {
  const userText = input.raw + USER_MESSAGE_SUFFIX
  return buildSystem(input.lang, input.project, input.raw, input.directory) + "\n\n" + userText
}