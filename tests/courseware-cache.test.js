const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { AIResultCache } = require('../lib/ai-result-cache')
const { createCoursewareSummary } = require('../lib/courseware-summary')

const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
const names = ['prepareFeedbackCourseware', 'getCoursewareVisionImages']
const declarations = names.map((name) => {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'))
  assert.ok(match, `production function ${name} exists`)
  return match[0]
}).join('\n')

function load(requestTeachingTextAI) {
  return new Function('requestTeachingTextAI', 'createCoursewareSummary', 'coursewareSummaryCache', 'crypto',
    `${declarations}; return prepareFeedbackCourseware`)(requestTeachingTextAI, createCoursewareSummary, new AIResultCache(), crypto)
}

const config = { provider: 'custom', model: 'gpt-5.6-sol', baseUrl: 'https://synthetic.invalid/v1', apiKey: 'test-only-not-a-real-key' }
function fixture(count = 32) {
  return {
    name: '合成数学讲义.pdf', isImage: false,
    selectedPdfPages: Array.from({ length: count }, (_, index) => index + 1),
    visionImages: Array.from({ length: count }, (_, index) => ({
      pageNumber: index + 1, name: `page-${index + 1}.jpg`, dataUrl: `data:image/jpeg;base64,synthetic-${index + 1}`
    })),
    extractedText: Array.from({ length: count }, (_, index) => `第${index + 1}页：分数与数量关系，第${index + 1}组练习。\n`).join('')
  }
}
const lesson = (count) => ({
  lessonTitle: '分数应用', courseNote: '围绕单位一分析题目',
  students: Array.from({ length: count }, (_, index) => ({ id: `s${index + 1}`, name: `合成学生${index + 1}` }))
})

test('changing only the same user’s roster from 14 to 20 reuses all six summaries', async () => {
  let calls = 0
  const prepare = load(async (prompt, aiConfig, options) => {
    calls += 1
    return `摘要覆盖：${options.images.map((image) => image.pageNumber).join('、')}页`
  })
  const material = fixture()
  const first = await prepare(material, config, lesson(14), 'user-a')
  assert.equal(calls, 6)
  const second = await prepare(structuredClone(material), { ...config }, lesson(20), 'user-a')
  assert.equal(calls, 6, 'no provider calls for the already analyzed courseware')
  assert.equal(second.extractedText, first.extractedText)
  assert.equal(second.summaryStats.coveredImageCount, 32)
})

test('the cache isolates users, material contents, lesson context, and models', async (t) => {
  const changes = [
    ['user', (args) => { args.scope = 'user-b' }, 6],
    ['image content', (args) => { args.material.visionImages[0].dataUrl += '-changed' }, 1],
    ['extracted text', (args) => { args.material.extractedText = args.material.extractedText.replace('第1组练习', '第一组修订后的练习') }, 1],
    ['lesson title', (args) => { args.payload.lessonTitle = '比例综合应用' }, 6],
    ['lesson note', (args) => { args.payload.courseNote = '重点复习新的单位一' }, 6],
    ['model', (args) => { args.aiConfig.model = 'synthetic-different-model' }, 6]
  ]
  for (const [name, modify, expectedNewCalls] of changes) {
    await t.test(name, async () => {
      let calls = 0
      const prepare = load(async () => `provider summary ${++calls}`)
      await prepare(fixture(), config, lesson(14), 'user-a')
      assert.equal(calls, 6)
      const args = { material: fixture(), aiConfig: { ...config }, payload: lesson(20), scope: 'user-a' }
      modify(args)
      await prepare(args.material, args.aiConfig, args.payload, args.scope)
      assert.equal(calls, 6 + expectedNewCalls, `${name} must invalidate the affected cached facts`)
    })
  }
})

test('retrying a failed summary recomputes only the failed group and retains the successful group', async () => {
  const groupCalls = new Map()
  let failSecond = true
  const prepare = load(async (prompt, aiConfig, options) => {
    const group = options.images.map((image) => image.pageNumber).join(',')
    groupCalls.set(group, (groupCalls.get(group) || 0) + 1)
    if (group.startsWith('7,') && failSecond) {
      failSecond = false
      throw Object.assign(new Error('synthetic upstream authentication failure'), { code: 'AI_HTTP_ERROR' })
    }
    return `successful provider summary: ${group}`
  })
  await assert.rejects(prepare(fixture(12), config, lesson(14), 'user-a'), /synthetic upstream authentication failure/)
  assert.equal(groupCalls.get('1,2,3,4,5,6'), 1)
  assert.equal(groupCalls.get('7,8,9,10,11,12'), 1)

  const recovered = await prepare(fixture(12), config, lesson(20), 'user-a')
  assert.equal(groupCalls.get('1,2,3,4,5,6'), 1, 'successful chunk is not sent to the provider again')
  assert.equal(groupCalls.get('7,8,9,10,11,12'), 2, 'failed chunk is not cached')
  assert.equal(recovered.summaryStats.coveredImageCount, 12)
  assert.match(recovered.extractedText, /successful provider summary: 1,2,3,4,5,6/)
  assert.match(recovered.extractedText, /successful provider summary: 7,8,9,10,11,12/)
})
