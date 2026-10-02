const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { fetch, Agent } = require('undici')
const { readAIResponseText } = require('../lib/ai-response-stream')
const { normalizeAIProviderError } = require('../lib/ai-provider-error')

// These tests send real HTTP JSON/SSE responses through the production request,
// stream reader, provider parser and feedback recovery code. No error.code is
// fabricated by the test and no real provider credentials are loaded.
function productionFunctions(dispatcher) {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
  const declarations = [...source.matchAll(/^((?:async )?function (\w+)\([^\n]*\) \{[\s\S]*?^\})/gm)]
    .map((match) => match[1]).join('\n')
  const constants = [...source.matchAll(/^const ([A-Z][A-Z0-9_]*) = (\d+)\s*$/gm)]
    .map((match) => `const ${match[1]} = ${match[2]}`).join('\n')
  const dependencies = {
    fetch,
    aiDispatcher: dispatcher,
    readAIResponseText,
    normalizeAIProviderError,
    console: { error() {}, warn() {}, log() {} },
    // Only the production retry delay is accelerated. HTTP body reading and
    // recovery decisions still execute as production code.
    setTimeout: (callback) => setImmediate(callback)
  }
  return new Function(...Object.keys(dependencies), `${constants}\n${declarations}; return { requestFeedbackBatch, requestFeedbacks }`)(...Object.values(dependencies))
}

const students = (count) => Array.from({ length: count }, (_, index) => ({
  id: `s${index + 1}`, name: `合成测试学生${index + 1}`, performance: '表现良好', remark: `第${index + 1}位的独立备注`
}))
const payload = (count = 3) => ({
  mode: 'class', feedbackScope: 'individual', students: students(count),
  template: '家长您好：\n【课堂表现】请严格保留模板并加入学生表现。',
  lessonTitle: '分数的意义', courseNote: '保留全部原始课件证据'
})
const material = () => ({
  name: '合成课件.pdf', mime: 'application/pdf', extractedText: '第1页：分数表示整体的一部分。',
  selectedPdfPages: [1], visionImages: [{ name: 'page-1.jpg', dataUrl: 'data:image/png;base64,synthetic-original-page' }]
})
const message = 'Upstream HTTP/2 stream failed'
const providerError = { error: { message, type: 'upstream_error' } }
const sse = (event, data) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`

function requestedStudents(body, roster) {
  const user = body.messages.find((item) => item.role === 'user').content
  const text = typeof user === 'string' ? user : user.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
  return roster.filter((student) => new RegExp(`"id"\\s*:\\s*"${student.id}"`).test(text))
}

function successfulBody(roster) {
  return JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    feedbacks: roster.map((student) => ({ studentId: student.id, name: student.name, feedback: `来自上游的有效反馈:${student.id}` }))
  }) } }] })
}

async function harness(t, responder, count = 3) {
  const calls = []
  const server = http.createServer(async (req, res) => {
    const parts = []
    for await (const part of req) parts.push(part)
    const body = JSON.parse(Buffer.concat(parts).toString('utf8'))
    const roster = requestedStudents(body, students(count))
    const call = { body, roster, ids: roster.map((student) => student.id) }
    calls.push(call)
    const reply = responder(call, calls.length)
    res.writeHead(reply.status || 200, { 'content-type': reply.contentType || 'application/json', connection: 'close' })
    if (reply.contentType === 'text/event-stream') {
      // Fragment the wire payload, including the event name, like a real proxy.
      res.write(reply.body.slice(0, 9))
      setImmediate(() => res.end(reply.body.slice(9)))
    } else res.end(reply.body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 })
  t.after(async () => {
    await dispatcher.close()
    await new Promise((resolve) => server.close(resolve))
  })
  return {
    api: productionFunctions(dispatcher), calls,
    config: { provider: 'custom', model: 'synthetic-test-model', baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'synthetic-test-key' }
  }
}

const transientFixtures = [
  ['HTTP 200 JSON error envelope', { body: JSON.stringify(providerError) }],
  ['HTTP 200 SSE event:error envelope', { contentType: 'text/event-stream', body: sse('error', { message, code: 'upstream_error' }) }],
  ['HTTP 200 response.failed with a nested upstream error', { contentType: 'text/event-stream', body: sse('response.failed', { response: { error: { message, code: 'upstream_error' } } }) }],
  ['HTTP 502 JSON upstream error envelope', { status: 502, body: JSON.stringify(providerError) }]
]

for (const [name, failure] of transientFixtures) {
  test(`${name} retries the same batch and original image before succeeding`, async (t) => {
    const { api, calls, config } = await harness(t, (call, number) => number === 1 ? failure : { body: successfulBody(call.roster) })
    const courseware = material()
    const results = await api.requestFeedbackBatch(payload(), courseware, config)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0].ids, ['s1', 's2', 's3'])
    assert.deepEqual(calls[1].ids, calls[0].ids, 'a transient stream error must not split or duplicate a completed batch')
    assert.deepEqual(calls[1].body, calls[0].body, 'all evidence and the complete template remain unchanged')
    assert.equal(calls[1].body.messages[1].content.find((part) => part.type === 'image_url').image_url.url, courseware.visionImages[0].dataUrl)
    assert.equal(results.length, 3)
    assert.ok(results.every((item) => item.feedback === `来自上游的有效反馈:${item.studentId}`))
  })
}

const permanentFixtures = [
  ['HTTP 401 authentication', { status: 401, body: JSON.stringify({ error: { message: 'Invalid API key', code: 'invalid_api_key' } }) }],
  ['HTTP 200 insufficient balance', { body: JSON.stringify({ error: { message: 'Insufficient account balance', code: 'insufficient_quota' } }) }],
  ['HTTP 429 insufficient balance', { status: 429, body: JSON.stringify({ error: { message: 'Insufficient account balance', code: 'insufficient_balance' } }) }]
]

for (const [name, failure] of permanentFixtures) {
  test(`${name} fails once without repeated requests or smaller batches`, async (t) => {
    const { api, calls, config } = await harness(t, () => failure)
    await assert.rejects(api.requestFeedbackBatch(payload(), material(), config))
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].ids, ['s1', 's2', 's3'])
  })
}

test('a permanently interrupted middle batch preserves every real success from the other batches', async (t) => {
  const { api, calls, config } = await harness(t, (call) => call.ids.includes('s4')
    ? { body: JSON.stringify(providerError) }
    : { body: successfulBody(call.roster) }, 9)
  const result = await api.requestFeedbacks(payload(9), material(), config)
  assert.equal(result.partial, true)
  assert.deepEqual(result.feedbacks.map((item) => item.studentId), ['s1', 's2', 's3', 's7', 's8', 's9'])
  assert.deepEqual(result.failedStudents.map((item) => item.studentId), ['s4', 's5', 's6'])
  assert.equal(result.failedBatchCount, 1)
  assert.equal(result.batchCount, 3)
  assert.ok(result.feedbacks.every((item) => item.feedback === `来自上游的有效反馈:${item.studentId}`))
  assert.equal(calls.filter((call) => call.ids.includes('s1')).length, 1)
  assert.equal(calls.filter((call) => call.ids.includes('s7')).length, 1)
  const failed = calls.filter((call) => call.ids.includes('s4'))
  assert.equal(failed.length, 3, 'permanent transient failures stop after three bounded attempts')
  assert.deepEqual(failed.map((call) => call.body.stream), [true, true, false])
  const evidence = failed.map((call) => { const { stream, ...body } = call.body; return body })
  assert.deepEqual(evidence[1], evidence[0])
  assert.deepEqual(evidence[2], evidence[0], 'compatibility fallback changes only streaming, never students or evidence')
})

test('two real HTTP/2 stream failures recover on a third non-streaming request with all evidence preserved', async (t) => {
  const { api, calls, config } = await harness(t, (call) => call.body.stream
    ? { contentType: 'text/event-stream', body: sse('error', { message, code: 'upstream_error' }) }
    : { body: successfulBody(call.roster) })
  const results = await api.requestFeedbackBatch(payload(), material(), config)
  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map((call) => call.body.stream), [true, true, false])
  assert.ok(calls.every((call) => JSON.stringify(call.ids) === JSON.stringify(['s1', 's2', 's3'])))
  const evidence = calls.map((call) => { const { stream, ...body } = call.body; return body })
  assert.deepEqual(evidence[1], evidence[0])
  assert.deepEqual(evidence[2], evidence[0])
  assert.equal(results.length, 3)
  assert.ok(results.every((item) => item.feedback === `来自上游的有效反馈:${item.studentId}`))
})

test('nested missing-student recovery retains completed ancestors after a later real provider error', async (t) => {
  const { api, calls, config } = await harness(t, (call) => {
    if (call.ids.length > 1) return { body: successfulBody([call.roster[0]]) }
    return { body: JSON.stringify(providerError) }
  })
  const result = await api.requestFeedbacks(payload(), material(), config)
  assert.equal(result.partial, true)
  assert.deepEqual(result.feedbacks.map((item) => item.studentId), ['s1', 's2'])
  assert.deepEqual(result.failedStudents.map((item) => item.studentId), ['s3'])
  assert.deepEqual(calls.slice(0, 2).map((call) => call.ids), [['s1', 's2', 's3'], ['s2', 's3']])
  assert.equal(calls.filter((call) => call.ids.includes('s1')).length, 1)
  assert.equal(calls.filter((call) => call.ids.length === 1 && call.ids[0] === 's3').length, 3)
  assert.ok(result.feedbacks.every((item) => item.feedback === `来自上游的有效反馈:${item.studentId}`))
})

test('when every upstream request fails no demo or fabricated partial success is returned', async (t) => {
  const { api, calls, config } = await harness(t, () => ({ body: JSON.stringify(providerError) }))
  await assert.rejects(api.requestFeedbacks(payload(), material(), config))
  assert.equal(calls.length, 3)
  assert.ok(calls.every((call) => call.ids.length === 3))
})
