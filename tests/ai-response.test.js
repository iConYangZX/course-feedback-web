const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { normalizeAIProviderError } = require('../lib/ai-provider-error')
// Load the real pure functions without starting storage, network clients or the web server.
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
const names = ['parseProviderResponseJson', 'parseFeedbackResponse', 'parsePaperAnalysisResponse', 'parsePaperScoreRecognitionResponse', 'extractAIResponseText', 'extractAIContentText', 'parseJsonText', 'applyAIModelCompatibility', 'tryParseJson', 'extractFirstJsonObject', 'repairJsonLatexBackslashes', 'buildNonJsonAIResponseMessage', 'assertCompleteFeedbacks', 'matchFeedbacksByStudent', 'trim']
const declarations = names.map((name) => source.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'))[0]).join('\n')
const {
  parseProviderResponseJson,
  parseFeedbackResponse,
  parsePaperAnalysisResponse,
  parsePaperScoreRecognitionResponse,
  extractAIResponseText,
  parseJsonText,
  applyAIModelCompatibility,
  assertCompleteFeedbacks
} = new Function('normalizeAIProviderError', `${declarations}; return { ${names.join(',')} }`)(normalizeAIProviderError)

const feedback = { feedbacks: [{ studentId: 's1', name: '同学', feedback: '掌握了分数的基本概念。' }] }
const chat = (content, finish_reason = 'stop') => ({ choices: [{ message: { content }, finish_reason }] })
const frame = (value) => `data: ${JSON.stringify(value)}\r\n\r\n`

test('standard provider JSON and byte-order marks are accepted', () => {
  assert.deepEqual(parseFeedbackResponse(parseProviderResponseJson(`\uFEFF ${JSON.stringify(chat(JSON.stringify(feedback)))}`, 'AI'), 'custom'), feedback)
})

test('SSE from a compatible gateway is assembled into feedback even with stream disabled', () => {
  const content = JSON.stringify(feedback)
  const response = ': keepalive\r\n\r\n' + frame({ choices: [{ index: 0, delta: { content: content.slice(0, 18) } }] })
    + frame({ choices: [{ index: 0, delta: { content: content.slice(18) }, finish_reason: 'stop' }] }) + 'data: [DONE]\r\n\r\n'
  assert.deepEqual(parseFeedbackResponse(parseProviderResponseJson(response, 'AI'), 'custom'), feedback)
})

test('interrupted or malformed streams fail instead of reporting success', () => {
  assert.throws(() => parseProviderResponseJson(frame({ choices: [{ delta: { content: '{"feedbacks":' } }] }), 'AI'), /中途断开/)
  assert.throws(() => parseProviderResponseJson('data: broken\n\ndata: [DONE]\n\n', 'AI'), /无法解析/)
})

test('Responses API stream and final output work across provider selections', () => {
  const response = { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(feedback) }] }] }
  const stream = frame({ type: 'response.completed', response })
  assert.deepEqual(parseFeedbackResponse(parseProviderResponseJson(stream, 'AI'), 'custom'), feedback)
})

test('content arrays and fenced JSON with surrounding whitespace are supported', () => {
  const response = chat([{ type: 'text', text: ' \n```json\n' }, { type: 'text', text: JSON.stringify(feedback) + '\n```\n' }])
  assert.deepEqual(parseFeedbackResponse(response, 'custom'), feedback)
})

test('JSON extraction respects quoted braces and trailing commentary', () => {
  assert.deepEqual(parseJsonText('说明：{"feedbacks":[{"feedback":"用 {x} 代入"}]}。备注 {无关}', { strict: true }), { feedbacks: [{ feedback: '用 {x} 代入' }] })
})

test('malformed, empty, truncated and refused AI outputs are actionable failures', () => {
  assert.throws(() => parseFeedbackResponse(chat('not JSON'), 'custom'), /格式不完整/)
  assert.throws(() => parseFeedbackResponse(chat('{"feedbacks":[]}'), 'custom'), /未返回可用/)
  assert.throws(() => extractAIResponseText(chat('')), /为空/)
  assert.throws(() => parseFeedbackResponse(chat(JSON.stringify(feedback), 'length'), 'custom'), /截断/)
  assert.throws(() => extractAIResponseText(chat('filtered', 'content_filter')), /调整输入/)
})

test('HTML gateway errors disclose status without returning provider HTML', () => {
  assert.throws(() => parseProviderResponseJson('<!doctype html><body>private debug data</body>', 'AI', 502), (error) => /HTTP 502/.test(error.message) && !error.message.includes('private debug'))
  assert.throws(() => parseProviderResponseJson('unauthorized', 'AI', 401), /认证失败/)
  assert.throws(() => parseProviderResponseJson('limit', 'AI', 429), /额度不足/)
})

test('paper parsing never substitutes demo questions or fake scores on invalid AI output', () => {
  assert.throws(() => parsePaperAnalysisResponse(chat('{}'), 'custom'), /未识别出试卷题目/)
  assert.throws(() => parsePaperScoreRecognitionResponse(chat('{"scores":[]}'), 'custom'), /未识别出有效分数/)
  assert.deepEqual(parsePaperScoreRecognitionResponse(chat('{"scores":[{"key":"q1","score":3}]}'), 'custom').scores, [{ key: 'q1', score: 3 }])
})

test('lenient local metadata parsing and existing model compatibility remain intact', () => {
  assert.deepEqual(parseJsonText('[{"title":"第一讲"}]'), [{ title: '第一讲' }])
  assert.deepEqual(parseJsonText('bad'), { feedbacks: [], questions: [], scores: [] })
  const options = applyAIModelCompatibility({ body: JSON.stringify({ model: 'gpt-5.6-sol', messages: [] }) })
  assert.equal(JSON.parse(options.body).reasoning_effort, 'none')
})


test('partial batches cannot silently generate fallback feedback for missing students', () => {
  const students = [{ id: 's1', name: '甲' }, { id: 's2', name: '乙' }]
  assert.throws(() => assertCompleteFeedbacks([{ studentId: 's1', name: '甲', feedback: '已掌握' }], students), /学生反馈不完整/)
  assert.doesNotThrow(() => assertCompleteFeedbacks([{ studentId: 's1', feedback: '已掌握' }, { studentId: 's2', feedback: '需巩固' }], students))
})
