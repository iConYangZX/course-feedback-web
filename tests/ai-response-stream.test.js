const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { readAIResponseText } = require('../lib/ai-response-stream')

// Exercise the existing production parser after the new stream reader.
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
const names = ['parseProviderResponseJson', 'tryParseJson', 'extractAIContentText', 'buildNonJsonAIResponseMessage', 'extractAIResponseText']
const declarations = names.map((name) => source.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'))[0]).join('\n')
const { parseProviderResponseJson, extractAIResponseText } = new Function(`${declarations}; return {${names.join(',')}}`)()
const encoder = new TextEncoder()
const frame = (event) => `data: ${JSON.stringify(event)}\n\n`

function makeResponse(text, { close = true, segments = null, headers = {}, status = 200, cancel } = {}) {
  const bytes = encoder.encode(text)
  let offset = 0
  let segmentIndex = 0
  let cancelled = false
  const stream = new ReadableStream({
    pull(controller) {
      if (offset < bytes.length) {
        const size = segments ? segments[segmentIndex++ % segments.length] : bytes.length
        controller.enqueue(bytes.slice(offset, offset + size))
        offset += size
      } else if (close) controller.close()
    },
    cancel() { cancelled = true; return cancel && cancel() }
  })
  return { response: new Response(stream, { status, headers }), cancelled: () => cancelled }
}

async function parse(response) {
  return parseProviderResponseJson(await readAIResponseText(response), 'AI', response.status)
}

test('UTF-8 characters and CRLF delimiters split across chunks retain complete feedback', async () => {
  const text = ': heartbeat\r\n\r\n' + frame({ choices: [{ index: 0, delta: { content: '学生掌握' } }] }).replaceAll('\n', '\r\n')
    + frame({ choices: [{ index: 0, delta: { content: '分数🙂' }, finish_reason: 'stop' }] }).replaceAll('\n', '\r\n')
  const { response } = makeResponse(text, { segments: [1, 2, 1, 3] })
  assert.equal(extractAIResponseText(await parse(response)), '学生掌握分数🙂')
  assert.equal(response.body.locked, false)
})

test('multiline data and event metadata terminate a Responses stream with an open socket', async () => {
  const text = 'event: response.completed\r\ndata: {\r\ndata: "response": {"status":"completed", "output_text":"完成"}\r\ndata: }\r\n\r\n'
  const sample = makeResponse(text, { close: false, segments: [3, 1, 7] })
  assert.equal(extractAIResponseText(await parse(sample.response)), '完成')
  assert.equal(sample.cancelled(), true)
  assert.equal(sample.response.body.locked, false)
})

test('[DONE] completes without waiting for a socket or cancellation promise to resolve', async () => {
  const sample = makeResponse(frame({ choices: [{ index: 0, delta: { content: '完成' } }] }) + 'data: [DONE]\n\n', {
    close: false,
    cancel: () => new Promise(() => {})
  })
  assert.equal(extractAIResponseText(await parse(sample.response)), '完成')
  assert.equal(sample.cancelled(), true)
  assert.equal(sample.response.body.locked, false)
})

test('the primary chat choice finish reason completes and excludes later junk in the same chunk', async () => {
  const sample = makeResponse(frame({ choices: [{ index: 0, delta: { content: '成功' }, finish_reason: 'stop' }] }) + 'data: broken junk\n\n', { close: false })
  assert.equal(extractAIResponseText(await parse(sample.response)), '成功')
  assert.equal(sample.cancelled(), true)
})

test('another choice finishing does not truncate the primary choice', async () => {
  const text = frame({ choices: [{ index: 1, delta: { content: '其他' }, finish_reason: 'stop' }] })
    + frame({ choices: [{ index: 0, delta: { content: '主要结果' }, finish_reason: 'stop' }] })
  assert.equal(extractAIResponseText(await parse(makeResponse(text).response)), '主要结果')
})

test('incomplete and failed terminal responses preserve their error semantics', async () => {
  const incomplete = makeResponse(frame({ type: 'response.incomplete', response: { status: 'incomplete', output_text: '部分' } }), { close: false })
  const result = await parse(incomplete.response)
  assert.equal(result.status, 'incomplete')
  assert.throws(() => extractAIResponseText(result), /截断/)
  assert.equal(incomplete.cancelled(), true)
  const failed = makeResponse(frame({ type: 'response.failed', response: { status: 'failed', error: { message: 'provider failure' } } }), { close: false })
  const failedResult = await parse(failed.response)
  assert.throws(() => extractAIResponseText(failedResult), /provider failure/)
  assert.equal(failed.cancelled(), true)
})

test('a named error event stops reading and preserves the provider message', async () => {
  const sample = makeResponse('event: error\ndata: {"message":"余额不足"}\n\n', { close: false })
  await assert.rejects(parse(sample.response), /余额不足/)
  assert.equal(sample.cancelled(), true)
})

test('a clean EOF before completion is rejected by the production parser', async () => {
  const sample = makeResponse(frame({ choices: [{ delta: { content: '未完成' } }] }))
  await assert.rejects(parse(sample.response), /中途断开/)
  assert.equal(sample.response.body.locked, false)
})

test('an abrupt stream error propagates and always releases the reader', async () => {
  let reads = 0
  const failure = new Error('upstream disconnected')
  const response = new Response(new ReadableStream({ pull(controller) {
    if (reads++ === 0) controller.enqueue(encoder.encode(frame({ choices: [{ delta: { content: '部分' } }] })))
    else controller.error(failure)
  } }))
  await assert.rejects(readAIResponseText(response), (error) => error === failure)
  assert.equal(response.body.locked, false)
})

test('ordinary JSON is preserved when the provider ignores streaming', async () => {
  const text = ' {"choices":[{"message":{"content":"普通 JSON"},"finish_reason":"stop"}]}\n'
  const sample = makeResponse(text, { segments: [1, 4, 2], headers: { 'content-type': 'application/json' } })
  assert.equal(await readAIResponseText(sample.response), text)
})

test('HTTP HTML and JSON error bodies retain original status and text', async () => {
  const html = '<!doctype html><html>524 origin timeout</html>'
  const sample = makeResponse(html, { status: 524, headers: { 'content-type': 'text/html' } })
  const text = await readAIResponseText(sample.response)
  assert.equal(text, html)
  assert.equal(sample.response.status, 524)
  assert.throws(() => parseProviderResponseJson(text, 'AI', sample.response.status), /HTTP 524/)
  const denied = makeResponse('{"error":{"message":"invalid key"}}', { status: 401 })
  assert.equal((await parse(denied.response)).error.message, 'invalid key')
})

test('a malformed complete SSE frame fails immediately even if the socket stays open', async () => {
  const sample = makeResponse('data: invalid json\n\n', { close: false })
  await assert.rejects(parse(sample.response), /无法解析/)
  assert.equal(sample.cancelled(), true)
})

test('terminal frame at EOF without a final empty line is accepted', async () => {
  const sample = makeResponse(frame({ choices: [{ delta: { content: '完整' } }] }) + 'data: [DONE]')
  assert.equal(extractAIResponseText(await parse(sample.response)), '完整')
})


test('length and content-filter terminal events stop the socket but remain failures', async () => {
  for (const [reason, message] of [['length', /截断/], ['content_filter', /调整输入/]]) {
    const sample = makeResponse(frame({ choices: [{ delta: { content: '部分结果' }, finish_reason: reason }] }), { close: false })
    const result = await parse(sample.response)
    assert.throws(() => extractAIResponseText(result), message)
    assert.equal(sample.cancelled(), true)
  }
})
