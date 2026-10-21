import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestOverTls } from '../src/tls-request.ts';
function socketFrom(wire, step = 7) {
  const bytes = new TextEncoder().encode(wire), sent = [];
  let offset = 0;
  return { sent, socket: {
    opened: Promise.resolve({}), closed: Promise.resolve(),
    writable: new WritableStream({ write(chunk) { sent.push(Buffer.from(chunk)); } }),
    readable: new ReadableStream({ pull(controller) {
      if(offset === bytes.length) { controller.close(); return; }
      const end = Math.min(offset + step, bytes.length); controller.enqueue(bytes.slice(offset,end)); offset = end;
    } }), close: async () => {},
  } };
}
test('TLS HTTP parser handles split headers, UTF-8 bytes, content length and fixed destination', async () => {
  const body = JSON.stringify({ choices: [{ message: {content:'你好，世界'} }] });
  const {socket,sent} = socketFrom(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  const result = await requestOverTls(socket, new URL('https://index-translate.bilibili.com/?p=/v1/chat/completions'), '{"text":"你好"}', new AbortController().signal);
  assert.equal(result.response.status,200);
  assert.equal((await result.response.json()).choices[0].message.content,'你好，世界');
  await result.completion;
  const request=Buffer.concat(sent).toString();
  assert.match(request,/POST \/\?p=\/v1\/chat\/completions HTTP\/1.1/);
  assert.match(request,/Host: index-translate.bilibili.com/);
  assert.match(request,/Content-Length: 17/);
  assert.doesNotMatch(request,/Authorization|Cookie/);
});
test('chunked SSE is decoded incrementally without HTTP chunk framing', async () => {
  const data='data: {"choices":[{"delta":{"content":"你好"}}]}\n\n';
  const done='data: [DONE]\n\n';
  const frame=part=>Buffer.byteLength(part).toString(16)+'\r\n'+part+'\r\n';
  const {socket}=socketFrom('HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n'+frame(data)+frame(done)+'0\r\n\r\n',3);
  const result=await requestOverTls(socket,new URL('https://index-translate.bilibili.com/?p=/v1/chat/completions'),'{}',new AbortController().signal);
  assert.equal(result.response.headers.has('transfer-encoding'),false);
  assert.equal(await result.response.text(),data+done);
  await result.completion;
});
test('truncated content length rejects the response stream', async () => {
  const {socket}=socketFrom('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 99\r\n\r\n{}');
  const result=await requestOverTls(socket,new URL('https://index-translate.bilibili.com/?p=/v1/chat/completions'),'{}',new AbortController().signal);
  await assert.rejects(result.response.text());
  await assert.rejects(result.completion);
});
