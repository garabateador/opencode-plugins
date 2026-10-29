import { Rpc } from "@opencode/plugin/rpc"

export type Language = "en" | "zh"
export type LanguageSetting = Language | "auto"

/** A model reference as selected in a composer/model picker. */
export type ModelRef = {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
}

/** Input of `Optimize.optimize`, as sent by the TUI part, the GUI part, or any RPC client. */
export type OptimizeInput = {
  /** The rough request to rewrite into an executable task spec. */
  readonly text: string
  /** Output language. Omit to use the plugin option, "auto" by default (CJK detection on the text). */
  readonly language?: LanguageSetting
  /**
   * Workspace directory the request belongs to. Drives project-awareness
   * (package.json, rule files, git state). Omit to use the server's location.
   */
  readonly directory?: string
  /**
   * The model to generate with. Callers pass the model currently selected in
   * their composer (TUI: ui.model.current(), GUI: composer.model()); the
   * server falls back to its overrideModel option, then to the location
   * default. Variant is dropped silently when the model does not offer it.
   */
  readonly model?: ModelRef
}

/** Output of `Optimize.optimize`. */
export type OptimizeOutput = {
  /** The optimized task spec the user reviews and edits before sending. */
  readonly text: string
  readonly language: Language
  /** Whether project context (package.json / rule files / git) was injected. */
  readonly contextUsed: boolean
}

/**
 * Typed RPC contract implemented by the server part (src/index.ts) and called
 * by the TUI part, the GUI part, and external clients (via `./rpc`).
 *
 * The method list is the plugin's permission surface: one read-only,
 * one-shot generation method. No tools run, no sessions are created, and
 * project reads are limited to the fixed file set in src/engine.ts.
 */
export const Optimize = Rpc.define({
  id: "prompt-optimizer",
  methods: {
    optimize: {
      input: {
        type: "object",
        properties: {
          text: { type: "string" },
          language: { type: "string", enum: ["auto", "en", "zh"] },
          directory: { type: "string" },
          model: {
            type: "object",
            properties: {
              providerID: { type: "string" },
              modelID: { type: "string" },
              variant: { type: "string" },
            },
            required: ["providerID", "modelID"],
            additionalProperties: false,
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          text: { type: "string" },
          language: { type: "string", enum: ["en", "zh"] },
          contextUsed: { type: "boolean" },
        },
        required: ["text", "language", "contextUsed"],
        additionalProperties: false,
      },
      errors: {
        failed: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
          additionalProperties: false,
        },
      },
    },
  },
  events: {},
})