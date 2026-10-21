import { Buffer } from "node:buffer";
import { HTTPParser } from "http-parser-js";
import type { connect } from "cloudflare:sockets";
type TlsSocket = ReturnType<typeof connect>;

/** HTTPS over a verified TLS socket, without fetch's automatically added proxy headers. */
export async function requestOverTls(socket: TlsSocket, url: URL, body: string, signal: AbortSignal) {
  const parser = new HTTPParser(HTTPParser.RESPONSE);
  parser.maxHeaderSize = 32768;
  const output = new TransformStream<Uint8Array, Uint8Array>();
  const bodyWriter = output.writable.getWriter();
  let resolveHeaders!: (response: Response) => void;
  let rejectHeaders!: (reason: unknown) => void;
  const headersReady = new Promise<Response>((resolve, reject) => { resolveHeaders = resolve; rejectHeaders = reject; });
  let writes: Promise<void> = Promise.resolve();
  let complete = false;
  parser[HTTPParser.kOnHeadersComplete] = info => {
    const headers = new Headers();
    for (let i = 0; i < info.headers.length; i += 2) headers.append(info.headers[i], info.headers[i + 1]);
    headers.delete("Transfer-Encoding");
    headers.delete("Connection");
    resolveHeaders(new Response(output.readable, { status: info.statusCode, headers }));
  };
  parser[HTTPParser.kOnBody] = (buffer, offset, length) => {
    const bytes = new Uint8Array(buffer.subarray(offset, offset + length));
    writes = writes.then(() => bodyWriter.write(bytes));
  };
  parser[HTTPParser.kOnMessageComplete] = () => { complete = true; };
  const abort = () => {
    const reason = signal.reason || new DOMException("Aborted", "AbortError");
    rejectHeaders(reason);
    void bodyWriter.abort(reason).catch(() => {});
    void socket.close().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const completion = (async () => {
    try {
      signal.throwIfAborted();
      await socket.opened;
      const requestWriter = socket.writable.getWriter();
      const encodedBody = new TextEncoder().encode(body);
      const headers = [
        `POST ${url.pathname}${url.search} HTTP/1.1`, `Host: ${url.hostname}`,
        "Content-Type: application/json", "Accept: application/json, text/event-stream",
        "Accept-Encoding: identity", "User-Agent: Index-Translate-Client/1.0",
        `Content-Length: ${encodedBody.byteLength}`, "Connection: close", "", "",
      ].join("\r\n");
      await requestWriter.write(new TextEncoder().encode(headers));
      await requestWriter.write(encodedBody);
      requestWriter.releaseLock();
      const reader = socket.readable.getReader();
      while (!complete) {
        const { value, done } = await reader.read();
        if (done) {
          const finished = parser.finish();
          if (finished instanceof Error) throw finished;
          if (!complete) throw new Error("Incomplete upstream HTTP response");
          break;
        }
        const parsed = parser.execute(Buffer.from(value));
        if (parsed instanceof Error) throw parsed;
        await writes;
      }
      await writes;
      await bodyWriter.close();
    } catch (cause) {
      rejectHeaders(cause);
      await bodyWriter.abort(cause).catch(() => {});
      throw cause;
    } finally {
      signal.removeEventListener("abort", abort);
      await socket.close().catch(() => {});
    }
  })();
  // Register immediately, before the caller receives the completion promise.
  void completion.catch(() => {});
  return { response: await headersReady, completion };
}
