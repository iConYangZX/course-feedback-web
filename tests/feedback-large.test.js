const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createCoursewareSummary } = require('../lib/courseware-summary')
const { readAIResponseText } = require('../lib/ai-response-stream')

// Exercise the production orchestration without starting the app or loading credentials.
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
function load(names, dependencies = {}) {
  const declarations = names.map((name) => {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'))
    assert.ok(match, `production function ${name} exists`)
    return match[0]
  }).join('\n')
  return new Function(...Object.keys(dependencies), `${declarations}; return { ${names.join(',')} }`)(...Object.values(dependencies))
}

const parserNames = ['parseProviderResponseJson', 'parseFeedbackResponse', 'extractAIResponseText', 'extractAIContentText', 'parseJsonText', 'tryParseJson', 'extractFirstJsonObject', 'repairJsonLatexBackslashes', 'buildNonJsonAIResponseMessage', 'trim']
const aiConfig = { provider: 'custom', model: 'gpt-5.6-sol', baseUrl: 'https://synthetic.invalid/v1', apiKey: 'synthetic-test-key' }
const frame = (data) => `data: ${JSON.stringify(data)}\n\n`
function streamResponse(text, responsesApi = false) {
  const sse = responsesApi
    ? frame({ type: 'response.completed', response: { status: 'completed', output: [{ content: [{ type: 'output_text', text }] }] } })
    : frame({ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n'
  return new Response(sse, { headers: { 'content-type': 'text/event-stream' } })
}

test('32 pages are summarized once in six groups before four complete student batches', async () => {
  const students = Array.from({ length: 20 }, (_, i) => ({ id: `student-${i + 1}`, name: `合成同学${i + 1}` }))
  const original = {
    name: '合成32页数学讲义.pdf', isImage: false,
    selectedPdfPages: Array.from({ length: 32 }, (_, i) => i + 1),
    extractedText: Array.from({ length: 32 }, (_, i) => `第${i + 1}页：分数与数量关系，第${i + 1}组例题。\n`).join(''),
    visionImages: Array.from({ length: 32 }, (_, i) => ({ name: `page-${i + 1}.jpg`, pageNumber: i + 1, dataUrl: `data:image/jpeg;base64,synthetic-page-${i + 1}` }))
  }
  const summaries = []
  const batches = []
  const api = load([
    ...parserNames, 'getCoursewareVisionImages', 'prepareFeedbackCourseware', 'requestFeedbacks',
    'requestFeedbackBatch', 'buildFeedbackBatchPayload', 'assertCompleteFeedbacks', 'matchFeedbacksByStudent'
  ], {
    createCoursewareSummary, FEEDBACK_BATCH_SIZE: 5, FEEDBACK_BATCH_CONCURRENCY: 3,
    requestTeachingTextAI: async (prompt, config, options) => {
      assert.equal(config, aiConfig)
      assert.ok(options.images.length > 0 && options.images.length <= 6)
      summaries.push(options.images)
      return `本段数学知识：${options.images.map((image) => image.pageNumber).join('、')}页的分数与数量关系。`
    },
    requestAI: async (payload, courseware, config) => {
      assert.equal(config, aiConfig)
      assert.equal(summaries.length, 6, 'summary stage finishes before student generation')
      assert.equal(courseware.visionImages.length, 0)
      assert.equal(courseware.dataUrl, '')
      assert.equal(courseware.extractionSource, 'ai-courseware-summary')
      assert.match(courseware.extractedText, /32页/)
      batches.push(payload.students)
      return { choices: [{ message: { content: JSON.stringify({ feedbacks: payload.students.map((student) => ({ studentId: student.id, name: student.name, feedback: '已掌握分数，继续练习数量关系。' })) }) }, finish_reason: 'stop' }] }
    }
  })
  const payload = { feedbackScope: 'individual', students, lessonTitle: '分数复习' }
  const summarized = await api.prepareFeedbackCourseware(original, aiConfig, payload)
  const result = await api.requestFeedbacks(payload, summarized, aiConfig)
  assert.equal(summaries.length, 6)
  assert.deepEqual(summaries.flat().map((image) => image.pageNumber).sort((a, b) => a - b), original.selectedPdfPages)
  assert.deepEqual(batches.map((batch) => batch.length), [5, 5, 5, 5])
  assert.equal(result.feedbacks.length, 20)
  assert.equal(new Set(result.feedbacks.map((item) => item.studentId)).size, 20)
  assert.equal(result.failedBatchCount, 0)
  assert.equal(original.visionImages.length, 32, 'source images are not mutated')
})

test('feedback and image-summary entry points request streaming and consume real SSE', async () => {
  const calls = []
  const images = [{ dataUrl: 'data:image/jpeg;base64,synthetic-image' }]
  const resultText = JSON.stringify({ feedbacks: [{ studentId: 'student-1', name: '合成同学', feedback: '完成' }] })
  const api = load([...parserNames, 'requestAI', 'requestChatCompatible', 'requestOpenAI', 'sendChatCompatibleRequest', 'requestChatText', 'requestOpenAIText', 'hasCoursewareVisionImages', 'getCoursewareVisionImages'], {
    readAIResponseText,
    buildSystemPrompt: () => '合成测试',
    buildUserContent: () => [{ type: 'input_image', image_url: images[0].dataUrl }],
    buildChatCompatibleUserContent: (payload, courseware, options) => {
      assert.equal(options.includeImage, true)
      return courseware.visionImages.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } }))
    },
    fetchAI: async (url, options) => {
      const body = JSON.parse(options.body)
      assert.equal(body.stream, true)
      calls.push({ url, body })
      return streamResponse(resultText, url.endsWith('/responses'))
    }
  })
  await api.requestAI({}, { visionImages: images }, { ...aiConfig, provider: 'openai' }, { maxOutputTokens: 16000 })
  await api.requestAI({}, { visionImages: images }, aiConfig, { maxOutputTokens: 16000 })
  assert.equal(await api.requestChatText('分析图片', aiConfig, { images }), resultText)
  assert.equal(await api.requestOpenAIText('分析图片', aiConfig, { images }), resultText)
  assert.equal(calls.length, 4)
  assert.equal(calls[0].body.max_output_tokens, 16000, 'Responses receives the increased recovery budget')
  assert.equal(calls[1].body.max_tokens, 16000, 'custom chat receives the increased recovery budget')
  assert.equal(calls[0].body.input[0].content[0].image_url, images[0].dataUrl)
  assert.equal(calls[1].body.messages[1].content[0].image_url.url, images[0].dataUrl)
  assert.equal(calls[2].body.messages[1].content[1].image_url.url, images[0].dataUrl)
  assert.equal(calls[3].body.input[0].content[1].image_url, images[0].dataUrl)
})

function retryApi(fetch) {
  return load([...parserNames, 'fetchAI', 'withProxy', 'applyAIModelCompatibility', 'isRetryableAIStatus', 'isRetryableAIError', 'requestChatCompatible', 'sendChatCompatibleRequest', 'hasCoursewareVisionImages', 'getCoursewareVisionImages'], {
    fetch, aiDispatcher: {}, AI_REQUEST_RETRY_COUNT: 2, waitForRetry: async () => {}, readAIResponseText,
    buildSystemPrompt: () => '合成测试',
    buildChatCompatibleUserContent: (payload, courseware, options) => {
      assert.equal(options.includeImage, true)
      return courseware.visionImages.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } }))
    }
  })
}

test('HTTP 524 retries preserve every image and the identical request body', async () => {
  const bodies = []
  const courseware = { visionImages: [{ dataUrl: 'data:image/jpeg;base64,original-page' }] }
  const api = retryApi(async (url, options) => {
    bodies.push(options.body)
    return bodies.length === 1
      ? new Response('<html>Gateway timeout</html>', { status: 524 })
      : streamResponse('{"feedbacks":[{"feedback":"完成"}]}')
  })
  await api.requestChatCompatible({}, courseware, aiConfig)
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0], bodies[1])
  assert.equal(JSON.parse(bodies[1]).messages[1].content[0].image_url.url, courseware.visionImages[0].dataUrl)
  assert.equal(courseware.imageSendSucceeded, true)
  assert.notEqual(courseware.imageFallbackUsed, true)
})

test('a nonretryable failure after HTTP 524 propagates without a text-only fallback', async () => {
  const bodies = []
  const courseware = { visionImages: [{ dataUrl: 'data:image/jpeg;base64,original-page' }] }
  const api = retryApi(async (url, options) => {
    bodies.push(options.body)
    return bodies.length === 1
      ? new Response('<html>Gateway timeout</html>', { status: 524 })
      : new Response('{"error":{"message":"image input rejected"}}', { status: 400, headers: { 'content-type': 'application/json' } })
  })
  await assert.rejects(api.requestChatCompatible({}, courseware, aiConfig), /image input rejected/)
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0], bodies[1])
  assert.notEqual(courseware.imageSendSucceeded, true)
  assert.notEqual(courseware.imageFallbackUsed, true)
  assert.equal(courseware.visionImages.length, 1)
})
