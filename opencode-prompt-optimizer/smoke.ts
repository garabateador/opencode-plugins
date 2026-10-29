/// <reference types="bun" />
// Smoke test: call the plugin's RPC over HTTP against a running `opencode serve`.
import { OpenCode } from "@opencode/client"
import { Optimize } from "./src/rpc"

const baseUrl = process.env.SMOKE_BASE ?? "http://127.0.0.1:4587"
const password = process.env.SMOKE_PASSWORD!
if (!password) throw new Error("SMOKE_PASSWORD is required")

const client = OpenCode.make({
  baseUrl,
  headers: {
    authorization: "Basic " + Buffer.from(`opencode:${password}`).toString("base64"),
  },
})
console.log("plugins:", (await client.plugin.list({ location: { directory: process.cwd() } })).data.map((p) => ({ id: p.id, state: p.state.status, features: p.features })))

const result = await client.rpc(Optimize).optimize({
  text: process.env.SMOKE_TEXT ?? "我想在聊天框下面加一个 statusbar，显示当前模型和上下文占用",
  directory: process.cwd(),
})
console.log("optimize ->", { language: result.language, contextUsed: result.contextUsed })
console.log("draft >>>", result.text)