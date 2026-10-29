/// <reference types="bun" />
// Seeds user prompts into a session of the TUI test project (admission only —
// generation continues in the background; user rows are what the rail lists).
import { OpenCode } from "@opencode/client"
import type { OpenCode as OC } from "@opencode/client"

const baseUrl = process.env.SEED_BASE ?? "http://127.0.0.1:49374"
const password = process.env.SEED_PASSWORD!
if (!password) throw new Error("SEED_PASSWORD required")

const client: OC = OpenCode.make({
  baseUrl,
  headers: { authorization: "Basic " + Buffer.from(`opencode:${password}`).toString("base64") },
})

const directory = process.env.SEED_DIR!
const prompts = (
  process.env.SEED_TEXTS ??
  "fix the login redirect bug|add a retry decorator to the fetch helper|write unit tests for the parser"
).split("|")

for (const text of prompts) {
  const session = await client.session.create({ title: `seed:${text.slice(0, 12)}`, directory })
  await client.session.prompt({ sessionID: session.id, text })
  console.log("seeded", session.id, "→", text)
}