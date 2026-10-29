import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

/**
 * Builds the GUI part with the app's official preset:
 * - compiles Solid JSX (window-side DOM)
 * - emits ONE CommonJS file for `./gui-experimental` (all dynamic imports inlined)
 * - keeps the app's shared modules (solid-js, effect, @opencode/*, @opencode/plugin/gui)
 *   and Node/Electron built-ins external, bundling everything else
 */
export default defineConfig({ plugins: [gui()] })