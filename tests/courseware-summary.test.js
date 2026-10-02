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
  await assert.rejects(createCoursewareSummary(paper(1), async () => '  '), /重试后仍未返回有效课件分析/)
})

test('missing page images and unreadable files fail explicitly, while image-only inputs remain valid', async () => {
  assert.throws(() => buildCoursewareSummaryChunks({ name: '损坏.pdf', visionImages: [{ name: 'page-1.jpg' }] }), /无法读取的页面图片/)
  assert.throws(() => buildCoursewareSummaryChunks({ name: '无内容.pdf', extractedText: '' }), /没有可读取的文字/)
  const chunks = buildCoursewareSummaryChunks({ name: '讲义.png', isImage: true, dataUrl: 'data:image/png;base64,original', extractedText: '' })
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].visionImages.length, 1)
  assert.equal(await createCoursewareSummary(null, async () => 'unused'), null)
})

function aiError(code, message = 'AI 返回内容过长，请减少学生数量') {
  const error = new Error(message)
  error.code = code
  return error
}

test('truncated image groups split to complete original pages without increasing global concurrency', async () => {
  const original = paper(12)
  const completed = []
  let active = 0
  let peak = 0
  const result = await createCoursewareSummary(original, async (chunk) => {
    active += 1
    peak = Math.max(peak, active)
    try {
      await new Promise(setImmediate)
      if (chunk.visionImages.length > 1) throw aiError('AI_OUTPUT_TRUNCATED')
      assert.equal(chunk.visionImages.length, 1)
      const page = chunk.pageNumbers[0]
      assert.equal(chunk.visionImages[0], original.visionImages[page - 1], 'original image is never cropped or replaced')
      assert.equal(chunk.extractedText, `第 ${page} 页：第${page}个知识点。 `)
      completed.push(page)
      return `第${page}页完整知识点`
    } finally { active -= 1 }
  })
  assert.equal(peak, 2)
  assert.deepEqual(completed.sort((left, right) => left - right), original.selectedPdfPages)
  assert.equal(result.summaryStats.initialChunkCount, 2)
  assert.equal(result.summaryStats.completedChunkCount, 12)
  assert.equal(result.summaryStats.splitCount, 10)
  assert.equal(result.summaryStats.requestCount, 22)
  assert.equal(result.summaryStats.coveredImageCount, 12)
  assert.equal(result.summaryStats.coveredTextChars, original.extractedText.length)
  for (let page = 1; page < 12; page += 1) {
    assert.ok(result.extractedText.indexOf(`第${page}页完整知识点`) < result.extractedText.indexOf(`第${page + 1}页完整知识点`))
  }
})

test('one dense page is retried once with more output space while retaining all original evidence', async () => {
  const original = paper(1)
  const attempts = []
  const result = await createCoursewareSummary(original, async (chunk) => {
    attempts.push(chunk.maxOutputTokens)
    assert.equal(chunk.visionImages[0], original.visionImages[0])
    assert.equal(chunk.extractedText, original.extractedText)
    if (chunk.maxOutputTokens === 2400) throw aiError('AI_OUTPUT_TRUNCATED')
    return '完整单页摘要'
  })
  assert.deepEqual(attempts, [2400, 4800])
  assert.equal(result.summaryStats.outputBudgetIncreaseCount, 1)
  assert.equal(result.summaryStats.coveredImageCount, 1)
  assert.equal(result.summaryStats.coveredTextChars, original.extractedText.length)
})

test('persistent single-page truncation stops after its one larger retry without requesting fewer students', async () => {
  let attempts = 0
  await assert.rejects(createCoursewareSummary(paper(1), async () => {
    attempts += 1
    throw aiError('AI_OUTPUT_TRUNCATED')
  }), (error) => error.code === 'AI_OUTPUT_TRUNCATED' && /自动细分课件/.test(error.message) && !/减少.*学生|减少.*人数/.test(error.message))
  assert.equal(attempts, 2)
})

test('text recovery preserves every character and Unicode pair across smaller summaries', async () => {
  const text = `${'甲'.repeat(3999)}😀${'乙'.repeat(3999)}`
  const completed = []
  const result = await createCoursewareSummary({ name: '纯文本.txt', extractedText: text }, async (chunk) => {
    if (chunk.extractedText.length > 2000) throw aiError('AI_OUTPUT_TRUNCATED')
    assert.equal(/[\uD800-\uDBFF]$/.test(chunk.extractedText), false)
    assert.equal(/^[\uDC00-\uDFFF]/.test(chunk.extractedText), false)
    completed.push(chunk.extractedText)
    return '摘要完成'
  })
  assert.equal(completed.join(''), text)
  assert.equal(result.summaryStats.coveredTextChars, text.length)
  assert.ok(result.summaryStats.splitCount > 0)
})

test('text with page labels splits at whole-page boundaries before splitting paragraphs', async () => {
  const original = paper(3)
  original.visionImages = []
  const completed = []
  const result = await createCoursewareSummary(original, async (chunk) => {
    const pages = [...chunk.extractedText.matchAll(/第\s*(\d+)\s*页/g)]
    if (pages.length > 1) throw aiError('AI_OUTPUT_TRUNCATED')
    assert.equal(pages.length, 1)
    completed.push(chunk.extractedText)
    return `第${pages[0][1]}页已完整分析`
  })
  assert.equal(completed.join(''), original.extractedText)
  assert.equal(result.summaryStats.completedChunkCount, 3)
  assert.equal(result.summaryStats.outputBudgetIncreaseCount, 0)
})

test('invalid or interrupted summaries retry the same evidence once without splitting it', async () => {
  for (const code of ['AI_INVALID_OUTPUT', 'AI_RESPONSE_INTERRUPTED']) {
    const original = paper(6)
    const attempts = []
    const result = await createCoursewareSummary(original, async (chunk) => {
      attempts.push(chunk)
      if (attempts.length === 1) throw aiError(code)
      return '完整摘要'
    })
    assert.equal(attempts.length, 2)
    assert.equal(attempts[0], attempts[1])
    assert.equal(result.summaryStats.splitCount, 0)
    assert.equal(result.summaryStats.coveredImageCount, 6)
    assert.equal(result.summaryStats.retryCount, 1)
  }
})

test('permanent invalid output and ordinary provider errors have bounded attempts', async () => {
  for (const [code, expected] of [['AI_INVALID_OUTPUT', 2], ['AI_RESPONSE_INTERRUPTED', 2], ['HTTP_401', 1]]) {
    let attempts = 0
    await assert.rejects(createCoursewareSummary(paper(6), async () => {
      attempts += 1
      throw aiError(code, 'provider error')
    }), (error) => error.code === code)
    assert.equal(attempts, expected)
  }
})

test('unknown page numbers stay unknown after image subdivision and text is still fully covered', async () => {
  const original = {
    name: '页面.pdf', extractedText: '没有页码的完整正文。',
    visionImages: Array.from({ length: 4 }, (_, index) => ({ name: `picture-${index}.png`, dataUrl: `data:image/png;base64,original-${index}` }))
  }
  const completedImages = []
  let completedText = ''
  const result = await createCoursewareSummary(original, async (chunk) => {
    if (chunk.visionImages.length > 1) throw aiError('AI_OUTPUT_TRUNCATED')
    assert.deepEqual(chunk.pageNumbers, [])
    completedImages.push(...chunk.visionImages)
    completedText += chunk.extractedText
    return '完整分析'
  })
  assert.equal(new Set(completedImages).size, 4)
  assert.equal(completedText, original.extractedText)
  assert.equal(result.summaryStats.coveredImageCount, 4)
  assert.equal(result.summaryStats.coveredTextChars, original.extractedText.length)
})

test('HTTP/2 summary failures retry the same bounded chunk twice in streaming mode then once without streaming', async () => {
  const original = paper(6)
  const attempts = []
  const result = await createCoursewareSummary(original, async (chunk) => {
    attempts.push(chunk)
    assert.equal(chunk.extractedText, original.extractedText)
    assert.deepEqual(chunk.visionImages, original.visionImages)
    if (chunk.stream !== false) {
      const error = aiError('AI_RESPONSE_INTERRUPTED', 'AI 服务响应连接中断')
      error.streamFallbackRecommended = true
      throw error
    }
    return '保留六页完整资料后的摘要'
  })
  assert.deepEqual(attempts.map((chunk) => chunk.stream !== false), [true, true, false])
  assert.equal(result.summaryStats.streamFallbackCount, 1)
  assert.equal(result.summaryStats.coveredImageCount, 6)
  assert.equal(result.summaryStats.coveredTextChars, original.extractedText.length)
})

test('persistent HTTP/2 summary failures stop after three attempts without a retry loop', async () => {
  const streams = []
  await assert.rejects(createCoursewareSummary(paper(6), async (chunk) => {
    streams.push(chunk.stream !== false)
    const error = aiError('AI_RESPONSE_INTERRUPTED')
    error.streamFallbackRecommended = true
    throw error
  }), (error) => error.code === 'AI_RESPONSE_INTERRUPTED')
  assert.deepEqual(streams, [true, true, false])
})

test('HTTP/2 summary compatibility recovery keeps concurrency at two and does not bypass permanent errors', async () => {
  let active = 0
  let peak = 0
  const perChunk = new Map()
  const result = await createCoursewareSummary(paper(18), async (chunk) => {
    active += 1
    peak = Math.max(peak, active)
    try {
      await new Promise(setImmediate)
      perChunk.set(chunk.index, (perChunk.get(chunk.index) || 0) + 1)
      if (chunk.stream !== false) {
        const error = aiError('AI_RESPONSE_INTERRUPTED')
        error.streamFallbackRecommended = true
        throw error
      }
      return `第${chunk.index}段全部完成`
    } finally { active -= 1 }
  })
  assert.equal(peak, 2)
  assert.deepEqual([...perChunk.values()], [3, 3, 3])
  assert.equal(result.summaryStats.coveredImageCount, 18)
  let attempts = 0
  await assert.rejects(createCoursewareSummary(paper(6), async () => {
    attempts += 1
    const error = aiError(attempts === 1 ? 'AI_RESPONSE_INTERRUPTED' : 'AI_PROVIDER_QUOTA')
    error.streamFallbackRecommended = true
    throw error
  }), (error) => error.code === 'AI_PROVIDER_QUOTA')
  assert.equal(attempts, 2)
})

test('exhausted HTTP retries never restart summary recovery or compatibility fallback', async () => {
  for (const code of ['AI_RESPONSE_INTERRUPTED', 'AI_PROVIDER_BUSY', 'AI_OUTPUT_TRUNCATED']) {
    let calls = 0
    const exhausted = aiError(code)
    exhausted.httpRetryExhausted = true
    exhausted.streamFallbackRecommended = true
    await assert.rejects(createCoursewareSummary(paper(6), async () => {
      calls += 1
      throw exhausted
    }), (error) => error.code === code && error.httpRetryExhausted === true && error.cause === exhausted)
    assert.equal(calls, 1, `${code} must not multiply the already exhausted HTTP attempts`)
  }
})

test('HTTP-200 provider busy errors retry the identical chunk once after a short backoff without stream fallback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const succeeds of [true, false]) {
    const attempts = []
    const pending = createCoursewareSummary(paper(6), async (chunk) => {
      attempts.push(chunk)
      if (succeeds && attempts.length === 2) return '繁忙恢复后的完整六页摘要'
      const error = aiError('AI_PROVIDER_BUSY', 'AI 服务繁忙')
      error.status = 200
      error.streamFallbackRecommended = true // A busy error must never use this hint.
      throw error
    })
    const outcome = pending.then((result) => ({ result }), (error) => ({ error }))
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(attempts.length, 1)
    t.mock.timers.tick(699)
    await Promise.resolve()
    assert.equal(attempts.length, 1)
    t.mock.timers.tick(1)
    const settled = await outcome
    assert.equal(attempts.length, 2)
    assert.equal(attempts[0], attempts[1])
    assert.ok(attempts.every((chunk) => chunk.stream !== false))
    if (succeeds) {
      assert.equal(settled.result.summaryStats.coveredImageCount, 6)
      assert.equal(settled.result.summaryStats.streamFallbackCount, 0)
    } else assert.equal(settled.error.code, 'AI_PROVIDER_BUSY')
  }
})
