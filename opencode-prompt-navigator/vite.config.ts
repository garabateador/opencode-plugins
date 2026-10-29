import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

/** One CommonJS bundle for the GUI part, via the app's official preset. */
export default defineConfig({ plugins: [gui()] })