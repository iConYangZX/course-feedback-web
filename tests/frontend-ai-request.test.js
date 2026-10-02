const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8')

function createHarness() {
  const clock = { now: 1000000, nextTimer: 0, intervals: new Map(), timeouts: new Map() }
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])) }
    static now() { return clock.now }
  }
  const context = vm.createContext({
    document: { addEventListener() {}, querySelector: () => ({ scrollIntoView() {} }) },
    window: { crypto: { randomUUID: () => 'generation-test-request' } },
    console,
    Date: ClockDate,
    TypeError,
    FormData,
    Blob,
    setTimeout: (callback, delay) => {
      const id = ++clock.nextTimer
      clock.timeouts.set(id, { callback, delay })
      return id
    },
    clearTimeout: (id) => clock.timeouts.delete(id),
    setInterval: (callback, delay) => {
      const id = ++clock.nextTimer
      clock.intervals.set(id, { callback, delay })
      return id
    },
    clearInterval: (id) => clock.intervals.delete(id)
  })
  vm.runInContext(source, context)
  const { state, els } = vm.runInContext('({ state, els })', context)
  els.generateBtn = { textContent: '', disabled: false, setAttribute() {} }
  els.generationStatus = { textContent: '', dataset: {}, classList: { toggle() {} } }
  els.generationInstructionInput = { value: '请保留我填写的生成要求' }
  const notifications = []
  context.showToast = (message) => notifications.push(message)
  return {
    context, clock, state, els, notifications,
    advance(milliseconds) {
      clock.now += milliseconds
      for (const { callback } of [...clock.intervals.values()]) callback()
    },
    runTimeouts() {
      const callbacks = [...clock.timeouts.values()]
      clock.timeouts.clear()
      callbacks.forEach(({ callback }) => callback())
    }
  }
}

const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(data)
})

async function flushMicrotasks() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

test('AI requests keep waiting for headers and response bodies beyond the old limits', async () => {
  const h = createHarness()
  const controller = new AbortController()
  const options = { method: 'POST', signal: controller.signal }
  let resolveHeaders
  let resolveBody
  let settled = false
  h.context.fetch = (url, receivedOptions) => {
    assert.equal(url, '/test')
    assert.equal(receivedOptions, options)
    return new Promise((resolve) => { resolveHeaders = resolve })
  }
  const pending = h.context.requestAiJson('/test', options, '生成失败')
  pending.then(() => { settled = true }, () => { settled = true })

  h.advance(20 * 60 * 1000)
  assert.equal(h.clock.timeouts.size, 0)
  assert.equal(controller.signal.aborted, false)
  assert.equal(settled, false)

  resolveHeaders({ ok: true, status: 200, text: () => new Promise((resolve) => { resolveBody = resolve }) })
  await flushMicrotasks()
  h.advance(60 * 60 * 1000)
  assert.equal(h.clock.timeouts.size, 0)
  assert.equal(controller.signal.aborted, false)
  assert.equal(settled, false)
  resolveBody('{"text":"长时间等待后成功"}')
  assert.equal((await pending).data.text, '长时间等待后成功')
})

test('caller cancellation remains the original error without an invented deadline', async () => {
  const h = createHarness()
  const controller = new AbortController()
  const aborted = new DOMException('User cancelled', 'AbortError')
  h.context.fetch = (url, options) => new Promise((resolve, reject) => {
    assert.equal(options.signal, controller.signal)
    options.signal.addEventListener('abort', () => reject(aborted), { once: true })
  })
  const pending = h.context.requestAiJson('/test', { signal: controller.signal }, '生成失败')
  controller.abort()
  await assert.rejects(pending, (error) => error === aborted)
  assert.equal(h.clock.timeouts.size, 0)
})

test('actual network failures and gateway errors remain actionable', async () => {
  const h = createHarness()
  h.context.fetch = async () => { throw new TypeError('Failed to fetch') }
  await assert.rejects(h.context.requestAiJson('/test', {}, '生成失败'), /网络连接中断/)
  h.context.fetch = async () => ({ ok: false, status: 504, text: async () => '<html>Gateway timeout</html>' })
  const { response, data } = await h.context.requestAiJson('/test', {}, '生成失败')
  assert.equal(response.status, 504)
  assert.match(data.error, /AI 服务响应超时/)
  assert.doesNotMatch(data.error, /html|4 分钟/)
})

test('automatic reconnect reuses the same payload and generation request ID', async () => {
  const h = createHarness()
  const formData = new FormData()
  formData.append('payload', JSON.stringify({ generationRequestId: 'one-logical-request', students: [] }))
  const bodies = []
  h.context.fetch = async (url, options) => {
    bodies.push(options.body)
    if (bodies.length === 1) throw new TypeError('Failed to fetch')
    return jsonResponse({ feedbacks: [{ feedback: '已完成' }] })
  }
  const pending = h.context.requestFeedbackGeneration(formData)
  await flushMicrotasks()
  assert.equal(h.clock.timeouts.size, 1)
  assert.equal([...h.clock.timeouts.values()][0].delay, 1200)
  h.runTimeouts()
  assert.equal((await pending).data.feedbacks[0].feedback, '已完成')
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0], formData)
  assert.equal(bodies[1], formData)
  assert.equal(JSON.parse(bodies[1].get('payload')).generationRequestId, 'one-logical-request')
})

test('elapsed progress has no deadline and terminal errors stop the clock without clearing input', () => {
  const h = createHarness()
  h.context.setGenerating(true)
  h.context.setGenerationStatus('AI 正在生成反馈。', 'busy')
  assert.match(h.els.generationStatus.textContent, /已等待 0 秒/)
  h.advance(65 * 1000)
  assert.match(h.els.generationStatus.textContent, /已等待 1 分 5 秒/)
  h.advance(60 * 60 * 1000)
  assert.match(h.els.generationStatus.textContent, /已等待 61 分 5 秒/)
  assert.equal(h.state.generating, true)
  assert.equal(h.els.generateBtn.disabled, true)
  assert.equal(h.clock.intervals.size, 1)

  h.context.setGenerationStatus('真实服务错误，请稍后重试', 'error')
  h.context.setGenerating(false)
  h.advance(60 * 1000)
  assert.equal(h.clock.intervals.size, 0)
  assert.equal(h.els.generationStatus.textContent, '真实服务错误，请稍后重试')
  assert.equal(h.els.generationInstructionInput.value, '请保留我填写的生成要求')
  assert.equal(h.els.generateBtn.disabled, false)
})

test('generation restarts replace the old timer and success stays visible', () => {
  const h = createHarness()
  h.context.setGenerating(true)
  h.context.setGenerationStatus('处理中', 'busy')
  h.advance(30 * 1000)
  h.context.setGenerating(true)
  h.context.setGenerationStatus('再次生成中', 'busy')
  assert.equal(h.clock.intervals.size, 1)
  assert.match(h.els.generationStatus.textContent, /已等待 0 秒/)
  h.context.setGenerationStatus('反馈已生成', 'success')
  h.context.setGenerating(false)
  h.advance(60 * 1000)
  assert.equal(h.clock.intervals.size, 0)
  assert.equal(h.els.generationStatus.textContent, '反馈已生成')
})

test('generation failure releases the button and timer and preserves teacher input', async () => {
  const h = createHarness()
  h.context.buildGeneratePayload = () => ({ students: [] })
  h.context.getSelectedCoursewareFiles = () => []
  h.context.requestFeedbackGeneration = async () => { throw new Error('上游服务连接中断') }
  await h.context.generateFeedback()
  assert.equal(h.state.generating, false)
  assert.equal(h.clock.intervals.size, 0)
  assert.equal(h.els.generateBtn.disabled, false)
  assert.equal(h.els.generationStatus.dataset.state, 'error')
  assert.equal(h.els.generationStatus.textContent, '上游服务连接中断')
  assert.equal(h.els.generationInstructionInput.value, '请保留我填写的生成要求')
})
