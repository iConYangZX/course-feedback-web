const test = require('node:test')
const assert = require('node:assert/strict')
const { buildCoursewareSummaryChunks, createCoursewareSummary } = require('../lib/courseware-summary')

const image = (page) => ({ name: `courseware-0-page-${page}.jpg`, dataUrl: `data:image/jpeg;base64,page${page}` })
const paper = (count, name = '教学讲义.pdf') => ({
  name,
  mime: 'application/pdf',
  selectedPdfPages: Array.from({ length: count }, (_, index) => index + 1),
  visionImages: Array.from({ length: count }, (_, index) => image(index + 1)),
  extractedText: Array.from({ length: count }, (_, index) => `第 ${index + 1} 页：第${index + 1}个知识点。 `).join('')
})

test('all 32 pages are covered exactly once by six-image chunks with matching page text', async () => {
  const original = paper(32)
  const seen = []
  const result = await createCoursewareSummary(original, async (chunk) => {
    seen.push(chunk)
    return `分析了第${chunk.pageNumbers.join('、')}页。`
  })
  assert.deepEqual(seen.map((chunk) => chunk.visionImages.length), [6, 6, 6, 6, 6, 2])
  assert.deepEqual(seen.flatMap((chunk) => chunk.pageNumbers), original.selectedPdfPages)
  assert.equal(seen.map((chunk) => chunk.extractedText).join(''), original.extractedText)
  assert.equal(result.summaryStats.coveredImageCount, 32)
  assert.equal(result.summaryStats.sourceImageCount, 32)
  assert.equal(result.summaryStats.coveredTextChars, original.extractedText.length)
  assert.equal(result.summaryStats.completedChunkCount, 6)
  assert.equal(result.visionImages.length, 0)
  assert.equal(result.mime, 'text/plain')
  assert.match(result.extractedText, /原第 31、32 页/)
  assert.equal(original.visionImages.length, 32)
})

test('a selection of the final 20 pages preserves original page numbers and all page evidence', () => {
  const original = paper(32)
  original.selectedPdfPages = original.selectedPdfPages.slice(12)
  original.visionImages = original.visionImages.slice(12)
  original.extractedText = original.selectedPdfPages.map((page) => `第 ${page} 页：知识点${page}。`).join('')
  const chunks = buildCoursewareSummaryChunks(original)
  assert.deepEqual(chunks.map((chunk) => chunk.visionImages.length), [6, 6, 6, 2])
  assert.deepEqual(chunks.flatMap((chunk) => chunk.pageNumbers), original.selectedPdfPages)
  assert.equal(chunks.map((chunk) => chunk.extractedText).join(''), original.extractedText)
})

test('page headers separated by a vertical bar map to their original images', () => {
  const source = { name: '讲义.pdf', extractedText: '第1页｜概念学习\n内容甲。\n第2页｜典型例题\n内容乙。', visionImages: [image(1), image(2)] }
  const chunks = buildCoursewareSummaryChunks(source)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].extractedText, source.extractedText)
  assert.deepEqual(chunks[0].pageNumbers, [1, 2])
})

test('long text and Unicode are split without truncation or duplicated image requests', () => {
  const text = `第 1 页：${'甲'.repeat(7992)}😀${'乙'.repeat(17000)}`
  const chunks = buildCoursewareSummaryChunks({ name: '长课件.pdf', extractedText: text, visionImages: [image(1)] })
  assert.equal(chunks.map((chunk) => chunk.extractedText).join(''), text)
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.visionImages.length, 0), 1)
  assert.ok(chunks.every((chunk) => chunk.extractedText.length <= 8000))
  assert.ok(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk.extractedText)))
})

test('unmapped text and preamble remain covered while image chunks keep their matched text', () => {
  const text = '讲义前言。第 1 页：甲。第 2 页：乙。第 20 页：附录。'
  const chunks = buildCoursewareSummaryChunks({ name: '讲义.pdf', extractedText: text, visionImages: [image(1), image(2)] })
  assert.equal(chunks[0].extractedText, '第 1 页：甲。第 2 页：乙。')
  assert.equal(chunks[1].extractedText, '讲义前言。第 20 页：附录。')
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.extractedText.length, 0), text.length)
})

test('multiple original files stay separate and synthetic combined headings are not treated as evidence', async () => {
  const first = paper(7, '第一份.pdf')
  const second = paper(3, '第二份.pdf')
  second.extractedText = ''
  const combined = { name: '两份课件', files: [first, second], extractedText: '人工合并标题占位文字', visionImages: [...first.visionImages, ...second.visionImages] }
  const result = await createCoursewareSummary(combined, async (chunk) => `${chunk.name}分析`)
  assert.deepEqual(result.summaryStats.chunks.map((chunk) => chunk.name), ['第一份.pdf', '第一份.pdf', '第二份.pdf'])
  assert.equal(result.summaryStats.sourceImageCount, 10)
  assert.equal(result.summaryStats.coveredImageCount, 10)
  assert.equal(result.summaryStats.sourceTextChars, first.extractedText.length)
})

test('concurrency stays at two and result order follows source order after out-of-order completion', async () => {
  let active = 0
  let peak = 0
  const pending = []
  const run = createCoursewareSummary(paper(18), async (chunk) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => { pending[chunk.index - 1] = resolve })
    active -= 1
    return `结果${chunk.index}`
  })
  assert.equal(active, 2)
  pending[1]()
  await new Promise(setImmediate)
  assert.equal(active, 2)
  pending[2]()
  pending[0]()
  const result = await run
  assert.equal(peak, 2)
  assert.ok(result.extractedText.indexOf('结果1') < result.extractedText.indexOf('结果2'))
  assert.ok(result.extractedText.indexOf('结果2') < result.extractedText.indexOf('结果3'))
})

test('a failed or empty chunk rejects the whole summary instead of returning partial evidence', async () => {
  let calls = 0
  await assert.rejects(createCoursewareSummary(paper(30), async (chunk) => {
    calls += 1
    if (chunk.index === 1) throw new Error('上游 HTTP 524')
    return '已分析'
  }), /第 1\/5 段分析失败.*524/)
  assert.equal(calls, 2)
  await assert.rejects(createCoursewareSummary(paper(1), async () => '  '), /未返回这一段的分析内容/)
})

test('missing page images and unreadable files fail explicitly, while image-only inputs remain valid', async () => {
  assert.throws(() => buildCoursewareSummaryChunks({ name: '损坏.pdf', visionImages: [{ name: 'page-1.jpg' }] }), /无法读取的页面图片/)
  assert.throws(() => buildCoursewareSummaryChunks({ name: '无内容.pdf', extractedText: '' }), /没有可读取的文字/)
  const chunks = buildCoursewareSummaryChunks({ name: '讲义.png', isImage: true, dataUrl: 'data:image/png;base64,original', extractedText: '' })
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].visionImages.length, 1)
  assert.equal(await createCoursewareSummary(null, async () => 'unused'), null)
})
