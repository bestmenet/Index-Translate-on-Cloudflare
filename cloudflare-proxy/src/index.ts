// The official web demo uses this query route to satisfy its CDN allowlist.
const UPSTREAM = "https://index-translate.bilibili.com/?p=/v1/chat/completions";
const MODELS = ["Index-Translate-35B-A3B", "Index-Translate-9B", "Index-Translate-2B"];
const MAX_BODY = 262144;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-API-Key, X-Requested-With",
  "Access-Control-Expose-Headers": "Retry-After, X-Request-ID",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
};
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: CORS });
}
function error(message: string, status: number, code: string) {
  return json({ error: { message, type: "proxy_error", code } }, status);
}
async function authenticated(request: Request, key: string) {
  if (!key) return false;
  const supplied = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")
    || request.headers.get("X-API-Key") || "";
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([key, supplied].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))));
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new RangeError("Request body exceeds 256 KiB"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method === "GET" && ["/", "/health"].includes(path)) {
      return json({ service: "Index-Translate Trancy bridge", status: "ready", model: MODELS[0] });
    }
    if (!await authenticated(request, env.API_KEY)) return error("Invalid API key", 401, "invalid_api_key");
    if (request.method === "GET" && ["/models", "/v1/models"].includes(path)) {
      return json({ object: "list", data: MODELS.map(id => ({ id, object: "model", owned_by: "IndexTeam" })) });
    }
    if (!["/chat/completions", "/v1/chat/completions"].includes(path)) {
      return error("Use /v1/chat/completions as the complete Trancy API URL", 404, "not_found");
    }
    if (request.method !== "POST") return error("Use POST", 405, "method_not_allowed");
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(await readBody(request));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected object");
      payload = parsed as Record<string, unknown>;
    } catch (cause) {
      return error(cause instanceof RangeError ? cause.message : "Invalid JSON body", cause instanceof RangeError ? 413 : 400, "invalid_request");
    }
    if (!Array.isArray(payload.messages) || !payload.messages.length || payload.messages.some(message =>
      !message || typeof message !== "object" || !["system", "user", "assistant"].includes(message.role)
      || typeof message.content !== "string")) {
      return error("messages must contain text chat messages", 400, "invalid_messages");
    }
    payload.model ||= MODELS[0];
    if (!MODELS.includes(String(payload.model))) return error("Unsupported Index-Translate model", 400, "invalid_model");
    payload.temperature = 0;
    payload.chat_template_kwargs = { enable_thinking: false };
    payload.stream = payload.stream === true;
    const requestedTokens = payload.max_tokens ?? payload.max_completion_tokens ?? 4096;
    payload.max_tokens = typeof requestedTokens === "number" && Number.isFinite(requestedTokens)
      ? Math.max(1, Math.min(8192, Math.floor(requestedTokens))) : 4096;
    delete payload.max_completion_tokens;
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120000)]);
      const encodedBody = JSON.stringify(payload);
      let upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Index-Translate-Client/1.0", "Accept": payload.stream ? "text/event-stream" : "application/json" },
        body: encodedBody,
        signal,
        redirect: "manual",
      });
      if (upstream.status === 412) {
        await upstream.body?.cancel();
        const [{ connect }, { requestOverTls }] = await Promise.all([import("cloudflare:sockets"), import("./tls-request.ts")]);
        const url = new URL(UPSTREAM);
        const socket = connect({ hostname: url.hostname, port: 443 }, { secureTransport: "on", allowHalfOpen: false });
        void socket.closed.catch(() => {});
        const result = await requestOverTls(socket, url, encodedBody, signal);
        ctx.waitUntil(result.completion);
        upstream = result.response;
      }
      const contentType = upstream.headers.get("Content-Type") || "";
      if (!/application\/json|text\/event-stream/i.test(contentType)) {
        await upstream.body?.cancel();
        return error(`Upstream returned a non-API response (HTTP ${upstream.status})`, 502, "upstream_non_api_response");
      }
      const headers = new Headers(CORS);
      headers.set("Content-Type", contentType);
      for (const name of ["Retry-After", "X-Request-ID"]) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      // Preserve SSE chunks and HTTP errors; never invent a successful DONE event.
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (cause) {
      console.error(JSON.stringify({ event: "upstream_failure", name: cause instanceof Error ? cause.name : "Unknown", message: cause instanceof Error ? cause.message : "Unknown" }));
      const timedOut = cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name);
      return error(timedOut ? "Upstream translation timed out or was cancelled" : "Could not connect to upstream translation API", timedOut ? 504 : 502, "upstream_unavailable");
    }
  },
} satisfies ExportedHandler<Env>;
