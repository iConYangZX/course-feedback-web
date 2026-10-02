const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
const functionNames = ['fetchAI', 'withProxy', 'applyAIModelCompatibility', 'isRetryableAIStatus', 'isRetryableAIError', 'waitForRetry', 'trim', 'startJsonHeartbeat', 'stopJsonHeartbeat', 'sendJsonResult']
const declarations = functionNames.map((name) => {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'))
  assert.ok(match, `real server function ${name} exists`)
  return match[0]
}).join('\n')

function loadFunctions(fetchStub) {
  const dispatcher = { name: 'test-ai-dispatcher' }
  const dependencies = {
    fetch: fetchStub,
    aiDispatcher: dispatcher,
    AI_REQUEST_RETRY_COUNT: 2,
    JSON_HEARTBEAT_INTERVAL_MS: 12000,
    JSON_HEARTBEAT_CHUNK_SIZE: 16384,
    JSON_HEARTBEAT_INITIAL_CHUNK_SIZE: 65536,
    AbortSignal: { timeout() { throw new Error('An automatic AI deadline must never be installed') } }
  }
  const funcs = new Function(...Object.keys(dependencies), `${declarations}; return { ${functionNames.join(',')} }`)(...Object.values(dependencies))
  return { ...funcs, dispatcher }
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function responseMock() {
  const res = new EventEmitter()
  res.chunks = []
  res.headers = {}
  res.status = (status) => { res.statusCode = status; return res }
  res.setHeader = (name, value) => { res.headers[name] = value }
  res.flushHeaders = () => {}
  res.write = (chunk) => { res.chunks.push(chunk); return true }
  res.end = (chunk) => { res.chunks.push(chunk); res.writableEnded = true }
  return res
}

test('AI requests remain pending beyond 120, 240 and 300 seconds without automatic cancellation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let release
  let seenOptions
  let settled = false
  const api = loadFunctions((url, options) => {
    seenOptions = options
    return new Promise((resolve) => { release = resolve })
  })
  const pending = api.fetchAI('https://ai.invalid/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-5.6-sol', messages: [] }) })
  pending.then(() => { settled = true })
  for (const elapsed of [120000, 120000, 60000, 60000]) {
    t.mock.timers.tick(elapsed)
    await flushPromises()
    assert.equal(settled, false)
    assert.equal(seenOptions.signal, undefined)
  }
  assert.equal(seenOptions.dispatcher, api.dispatcher)
  assert.equal(JSON.parse(seenOptions.body).reasoning_effort, 'none')
  const response = { status: 200, text: async () => 'complete' }
  release(response)
  assert.equal(await pending, response)
})

test('caller-provided cancellation remains available without adding a deadline', async () => {
  const controller = new AbortController()
  let observedSignal
  let calls = 0
  const api = loadFunctions((url, options) => {
    calls += 1
    observedSignal = options.signal
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  })
  const pending = api.fetchAI('https://ai.invalid', { signal: controller.signal })
  controller.abort(new DOMException('User cancelled', 'AbortError'))
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(observedSignal, controller.signal)
  assert.equal(calls, 1)
})

test('real 503 responses retry and consume the failed body, while success remains usable', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  let consumed = 0
  const good = { status: 200, text: async () => 'success' }
  const api = loadFunctions(async () => ++calls === 1 ? { status: 503, text: async () => { consumed += 1; return 'upstream unavailable' } } : good)
  const pending = api.fetchAI('https://ai.invalid')
  await flushPromises()
  assert.equal(calls, 1)
  t.mock.timers.tick(700)
  assert.equal(await pending, good)
  assert.equal(calls, 2)
  assert.equal(consumed, 1)
})

test('authentication failures surface immediately without a retry loop', async () => {
  let calls = 0
  const denied = { status: 401, text: async () => 'invalid credentials' }
  const api = loadFunctions(async () => { calls += 1; return denied })
  assert.equal(await api.fetchAI('https://ai.invalid'), denied)
  assert.equal(calls, 1)
})

test('a response body may remain idle past five minutes and still complete', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let releaseBody
  let settled = false
  const api = loadFunctions(async () => ({ status: 200, text: () => new Promise((resolve) => { releaseBody = resolve }) }))
  const pending = (async () => (await api.fetchAI('https://ai.invalid')).text())()
  pending.then(() => { settled = true })
  await flushPromises()
  t.mock.timers.tick(360000)
  await flushPromises()
  assert.equal(settled, false)
  releaseBody('data: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  assert.match(await pending, /完成/)
})

test('heartbeat continues beyond five minutes and closes its timer when the browser disconnects', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const api = loadFunctions()
  const res = responseMock()
  const heartbeat = api.startJsonHeartbeat(res)
  assert.equal(res.listenerCount('close'), 1)
  t.mock.timers.tick(360000)
  assert.ok(res.chunks.length >= 31)
  assert.equal(heartbeat.stopped, false)
  res.destroyed = true
  res.emit('close')
  const count = res.chunks.length
  assert.equal(heartbeat.stopped, true)
  assert.equal(res.listenerCount('close'), 0)
  t.mock.timers.tick(360000)
  assert.equal(res.chunks.length, count)
  api.stopJsonHeartbeat(heartbeat)
})

test('normal completion stops heartbeat and preserves the complete JSON result', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const api = loadFunctions()
  const res = responseMock()
  const heartbeat = api.startJsonHeartbeat(res)
  const payload = { feedbacks: [{ feedback: '完成反馈' }] }
  api.sendJsonResult(res, payload, heartbeat)
  assert.deepEqual(JSON.parse(res.chunks.join('')), payload)
  assert.equal(heartbeat.stopped, true)
  assert.equal(res.listenerCount('close'), 0)
  const count = res.chunks.length
  t.mock.timers.tick(360000)
  assert.equal(res.chunks.length, count)
})
