import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
const env = { API_KEY: 'test-key-only' };
const request = (body, extras = {}) => new Request('https://example.test/v1/chat/completions', {
  method: 'POST', headers: { Authorization: 'Bearer test-key-only', 'Content-Type': 'application/json', Cookie: 'must-not-forward=1', ...extras }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const valid = { model: 'Index-Translate-35B-A3B', messages: [{ role: 'system', content: 'Translate into Chinese; preserve %% separators.' }, { role: 'user', content: 'Hello\n\n%%\n\nGood morning' }] };
test('browser preflight and authorization protect upstream calls', async () => {
  const preflight = await worker.fetch(new Request('https://example.test/v1/chat/completions', { method: 'OPTIONS' }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  assert.equal((await worker.fetch(request(valid, { Authorization: 'Bearer wrong' }), env)).status, 401);
});
test('invalid or oversized input is rejected before upstream', async () => {
  assert.equal((await worker.fetch(request('{'), env)).status, 400);
  assert.equal((await worker.fetch(request({ messages: [] }), env)).status, 400);
  assert.equal((await worker.fetch(request({ ...valid, model: 'unrelated' }), env)).status, 400);
  assert.equal((await worker.fetch(request('x'.repeat(262145)), env)).status, 413);
});
test('Trancy batch prompt survives; upstream never receives proxy key or cookies', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://index-translate.bilibili.com/?p=/v1/chat/completions');
    assert.equal(init.redirect, 'manual'); // Workers does not implement redirect: error.
    const headers = new Headers(init.headers);
    assert.equal(headers.has('authorization'), false);
    assert.equal(headers.has('cookie'), false);
    const body = JSON.parse(init.body);
    assert.deepEqual(body.messages, valid.messages);
    assert.equal(body.temperature, 0);
    assert.equal(body.chat_template_kwargs.enable_thinking, false);
    assert.equal(body.max_tokens, 4000);
    return Response.json({ choices: [{ message: { content: '你好\n\n%%\n\n早上好' } }] });
  });
  const response = await worker.fetch(request({ ...valid, temperature: 1, max_tokens: 4000 }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, '你好\n\n%%\n\n早上好');
});
test('SSE is returned immediately and preserves bytes and DONE', async (t) => {
  const encoder = new TextEncoder();
  let controller;
  const stream = new ReadableStream({ start(c) { controller = c; c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n')); } });
  t.mock.method(globalThis, 'fetch', async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
  const response = await worker.fetch(request({ ...valid, stream: true }), env);
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /你好/);
  controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: [DONE]\n\n');
});
test('upstream throttling remains an error with Retry-After', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'rate limited' } }, { status: 429, headers: { 'Retry-After': '15' } }));
  const response = await worker.fetch(request(valid), env);
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '15');
});
test('HTML challenges become a structured error rather than a false translation', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Challenge</html>', { status: 403, headers: { 'Content-Type': 'text/html' } }));
  const response = await worker.fetch(request(valid), env);
  assert.equal(response.status, 502); assert.equal((await response.json()).error.code, 'upstream_non_api_response');
});
