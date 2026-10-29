/**
 * Shared error-message normalization used by the TUI and GUI parts:
 * RPC/transport rejections arrive in several shapes (ClientError with .data,
 * nested .cause, plain RpcError body objects). Resolve the human message
 * without ever rendering "[object Object]".
 */
export const messageOf = (error: unknown): string => {
  if (typeof error === "string") return error
  const source = (error ?? {}) as Record<string, unknown>
  const candidates: unknown[] = [
    (source as { data?: { message?: unknown } }).data,
    source.cause,
    (source.cause as { data?: { message?: unknown } } | undefined)?.data,
  ]
  for (const candidate of candidates) {
    const message = (candidate as { message?: unknown } | undefined)?.message
    if (typeof message === "string" && message.length > 0) return message
  }
  if (error instanceof Error && error.message) return error.message
  const direct = (source as { message?: unknown }).message
  if (typeof direct === "string" && direct.length > 0) return direct
  try {
    const json = JSON.stringify(error)
    if (json && json !== "undefined") return json.slice(0, 240)
  } catch {
    /* fall through */
  }
  return String(error)
}