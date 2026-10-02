'use strict'

const DEFAULT_MAX_IMAGES = 6
const DEFAULT_MAX_TEXT_CHARS = 8000
const DEFAULT_CONCURRENCY = 2
const DEFAULT_OUTPUT_TOKENS = 2400
const MIN_TEXT_SPLIT_CHARS = 1000

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function sourceFiles(courseware) {
  if (!courseware) return []
  if (Array.isArray(courseware.files) && courseware.files.length) {
    return courseware.files.flatMap(sourceFiles)
  }
  return [courseware]
}

function sourceImages(file) {
  const images = []
  if (file.isImage && file.dataUrl) images.push({ name: file.name, dataUrl: file.dataUrl })
  if (Array.isArray(file.visionImages)) images.push(...file.visionImages)
  for (const image of images) {
    if (!image || typeof image.dataUrl !== 'string' || !image.dataUrl.trim()) {
      throw new Error(`课件“${file.name || '未命名文件'}”含无法读取的页面图片，请重新上传`)
    }
  }
  return images
}

function imagePageNumber(image, index, file, imageCount) {
  const explicit = Number(image.pageNumber)
  if (Number.isInteger(explicit) && explicit > 0) return explicit
  const match = String(image.name || '').match(/(?:^|[-_])page[-_](\d+)(?:[.\-_]|$)/i)
  if (match) return Number(match[1])
  if (Array.isArray(file.selectedPdfPages) && file.selectedPdfPages.length === imageCount) {
    const selected = Number(file.selectedPdfPages[index])
    if (Number.isInteger(selected) && selected > 0) return selected
  }
  // The ordinal is an image position, not evidence of the original PDF page.
  return null
}

function splitText(text, maxChars) {
  const parts = []
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + maxChars, text.length)
    // Do not break a Unicode surrogate pair at a chunk boundary.
    if (end < text.length && end > start && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1
    if (end === start) end = Math.min(start + 2, text.length)
    parts.push(text.slice(start, end))
    start = end
  }
  return parts
}

function pageTextSegments(text) {
  const matches = [...text.matchAll(/第\s*(\d+)\s*页\s*[：:|｜]/g)]
  if (!matches.length) return [{ pageNumber: null, text }]
  const segments = []
  if (matches[0].index > 0) segments.push({ pageNumber: null, text: text.slice(0, matches[0].index) })
  matches.forEach((match, index) => segments.push({
    pageNumber: Number(match[1]),
    text: text.slice(match.index, index + 1 < matches.length ? matches[index + 1].index : text.length)
  }))
  return segments
}

function buildCoursewareSummaryChunks(courseware, options = {}) {
  const maxImages = Math.min(DEFAULT_MAX_IMAGES, positiveInteger(options.maxImages, DEFAULT_MAX_IMAGES))
  const maxTextChars = Math.max(2, Math.min(DEFAULT_MAX_TEXT_CHARS, positiveInteger(options.maxTextChars, DEFAULT_MAX_TEXT_CHARS)))
  const chunks = []
  sourceFiles(courseware).forEach((file, fileIndex) => {
    const images = sourceImages(file)
    const text = typeof file.extractedText === 'string' ? file.extractedText : ''
    if (!images.length && !text.trim()) {
      throw new Error(`课件“${file.name || '未命名文件'}”没有可读取的文字或页面图片，请重新上传`)
    }
    const segments = pageTextSegments(text)
    const usedSegments = new Set()
    const append = (visionImages, extractedText, pageNumbers, imageStart, imagePageNumbers = []) => {
      const parts = splitText(extractedText, maxTextChars)
      if (!parts.length && visionImages.length) parts.push('')
      parts.forEach((part, textPartIndex) => chunks.push({
        name: file.name || `课件 ${fileIndex + 1}`,
        sourceFileIndex: fileIndex,
        extractedText: part,
        visionImages: textPartIndex === 0 ? visionImages : [],
        pageNumbers,
        imagePageNumbers: textPartIndex === 0 ? imagePageNumbers : [],
        imageStart: textPartIndex === 0 && visionImages.length ? imageStart : null,
        textPartIndex: textPartIndex + 1,
        textPartCount: parts.length
      }))
    }

    for (let start = 0; start < images.length; start += maxImages) {
      const group = images.slice(start, start + maxImages)
      const imagePageNumbers = group.map((image, index) => imagePageNumber(image, start + index, file, images.length))
      const pageNumbers = imagePageNumbers.filter((page) => page !== null)
      const selectedPages = new Set(pageNumbers)
      const correspondingText = segments.map((segment, index) => {
        if (usedSegments.has(index) || !selectedPages.has(segment.pageNumber)) return ''
        usedSegments.add(index)
        return segment.text
      }).join('')
      append(group, correspondingText, pageNumbers, start + 1, imagePageNumbers)
    }
    const remaining = segments.filter((segment, index) => !usedSegments.has(index))
    append([], remaining.map((segment) => segment.text).join(''),
      [...new Set(remaining.map((segment) => segment.pageNumber).filter((page) => page !== null))], null)
  })
  return chunks.map((chunk, index) => ({ ...chunk, index: index + 1, total: chunks.length }))
}

function textSplitOffset(text) {
  const midpoint = Math.floor(text.length / 2)
  const pages = pageTextSegments(text)
  const pageBoundaries = []
  let offset = 0
  for (const page of pages.slice(0, -1)) {
    offset += page.text.length
    if (offset > 0 && offset < text.length) pageBoundaries.push(offset)
  }
  if (pageBoundaries.length) {
    return pageBoundaries.sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint))[0]
  }
  if (text.length < MIN_TEXT_SPLIT_CHARS * 2) return null
  const boundaries = [...text.matchAll(/\n(?:[ \t]*\n)?|[。！？；]\s*/g)]
    .map((match) => match.index + match[0].length)
    .filter((index) => index >= MIN_TEXT_SPLIT_CHARS && text.length - index >= MIN_TEXT_SPLIT_CHARS)
  if (boundaries.length) {
    return boundaries.sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint))[0]
  }
  return /[\uD800-\uDBFF]/.test(text[midpoint - 1]) ? midpoint - 1 : midpoint
}

function splitSummaryChunk(chunk) {
  const images = chunk.visionImages
  const children = []
  const child = (fields) => ({
    ...chunk,
    ...fields,
    subdivisionPath: `${chunk.subdivisionPath || chunk.index}.${children.length + 1}`
  })

  if (images.length > 1) {
    const midpoint = Math.ceil(images.length / 2)
    const segments = pageTextSegments(chunk.extractedText)
    const usedSegments = new Set()
    for (const [start, end] of [[0, midpoint], [midpoint, images.length]]) {
      const imagePageNumbers = chunk.imagePageNumbers.slice(start, end)
      const pageNumbers = imagePageNumbers.filter((page) => page !== null)
      const pageSet = new Set(pageNumbers)
      const extractedText = segments.map((segment, index) => {
        if (usedSegments.has(index) || !pageSet.has(segment.pageNumber)) return ''
        usedSegments.add(index)
        return segment.text
      }).join('')
      children.push(child({
        visionImages: images.slice(start, end),
        imagePageNumbers,
        pageNumbers,
        extractedText,
        imageStart: chunk.imageStart === null ? null : chunk.imageStart + start
      }))
    }
    const remaining = segments.filter((segment, index) => !usedSegments.has(index))
    const remainingText = remaining.map((segment) => segment.text).join('')
    if (remainingText.length) {
      children.push(child({
        visionImages: [], imagePageNumbers: [], imageStart: null,
        extractedText: remainingText,
        pageNumbers: [...new Set(remaining.map((segment) => segment.pageNumber).filter((page) => page !== null))]
      }))
    }
    return children
  }

  // Never crop a page image or detach its corresponding text to make it fit.
  if (images.length) return null
  const splitAt = textSplitOffset(chunk.extractedText)
  if (!splitAt) return null
  for (const extractedText of [chunk.extractedText.slice(0, splitAt), chunk.extractedText.slice(splitAt)]) {
    const pageNumbers = pageTextSegments(extractedText).map((segment) => segment.pageNumber).filter((page) => page !== null)
    children.push(child({ extractedText, pageNumbers: pageNumbers.length ? pageNumbers : chunk.pageNumbers }))
  }
  return children
}

function wrapSummaryFailure(error, index, total) {
  const recoverableMessages = {
    AI_OUTPUT_TRUNCATED: '自动细分课件并增加输出空间后，AI 仍未完整返回分析，请稍后重新生成',
    AI_INVALID_OUTPUT: 'AI 重试后仍未返回有效课件分析，请稍后重新生成',
    AI_RESPONSE_INTERRUPTED: 'AI 课件分析连接中断，自动重试未完成，请稍后重新生成'
  }
  const detail = recoverableMessages[error && error.code] || (error && error.message) || '请重新生成'
  const failure = new Error(`课件第 ${index + 1}/${total} 段分析失败：${detail}`, { cause: error })
  if (error && error.code) failure.code = error.code
  return failure
}

async function createCoursewareSummary(courseware, summarizeChunk, options = {}) {
  if (!courseware) return null
  if (typeof summarizeChunk !== 'function') throw new TypeError('summarizeChunk must be a function')
  const chunks = buildCoursewareSummaryChunks(courseware, options)
    .map((chunk) => ({ ...chunk, maxOutputTokens: DEFAULT_OUTPUT_TOKENS }))
  const summaries = new Array(chunks.length)
  const concurrency = Math.min(DEFAULT_CONCURRENCY, positiveInteger(options.concurrency, DEFAULT_CONCURRENCY), chunks.length)
  let nextIndex = 0
  let failure = null
  let requestCount = 0
  let splitCount = 0
  let outputBudgetIncreaseCount = 0

  const summarize = async (chunk, transientRetried = false) => {
    if (failure) throw failure
    try {
      requestCount += 1
      const result = await summarizeChunk(chunk)
      if (typeof result !== 'string' || !result.trim()) {
        const error = new Error('AI 未返回这一段的分析内容')
        error.code = 'AI_INVALID_OUTPUT'
        throw error
      }
      return [{ chunk, summary: result.trim() }]
    } catch (error) {
      if (error && error.code === 'AI_OUTPUT_TRUNCATED') {
        const children = splitSummaryChunk(chunk)
        if (children) {
          splitCount += 1
          const results = []
          // Recover sequentially inside the existing worker. Adaptive splitting
          // must never multiply the configured global concurrency.
          for (const next of children) results.push(...await summarize(next))
          return results
        }
        if (!chunk.outputBudgetRaised) {
          outputBudgetIncreaseCount += 1
          return summarize({ ...chunk, maxOutputTokens: DEFAULT_OUTPUT_TOKENS * 2, outputBudgetRaised: true }, transientRetried)
        }
      } else if (!transientRetried && error && ['AI_INVALID_OUTPUT', 'AI_RESPONSE_INTERRUPTED'].includes(error.code)) {
        return summarize(chunk, true)
      }
      throw error
    }
  }

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!failure && nextIndex < chunks.length) {
      const index = nextIndex++
      try {
        summaries[index] = await summarize(chunks[index])
      } catch (error) {
        if (!failure) failure = wrapSummaryFailure(error, index, chunks.length)
      }
    }
  }))
  if (failure) throw failure

  const completed = summaries.flat()
  const files = sourceFiles(courseware)
  const summaryText = completed.map(({ chunk, summary }, index) => {
    const pages = chunk.pageNumbers.length ? `；原第 ${chunk.pageNumbers.join('、')} 页` : ''
    return `【课件分段 ${index + 1}/${completed.length}：${chunk.name}${pages}】\n${summary}`
  }).join('\n\n')
  const sourceImageCount = files.reduce((sum, file) => sum + sourceImages(file).length, 0)
  const sourceTextChars = files.reduce((sum, file) => sum + (typeof file.extractedText === 'string' ? file.extractedText.length : 0), 0)
  const summaryStats = {
    sourceFileCount: files.length,
    initialChunkCount: chunks.length,
    chunkCount: completed.length,
    completedChunkCount: completed.length,
    requestCount,
    retryCount: requestCount - completed.length,
    splitCount,
    outputBudgetIncreaseCount,
    sourceImageCount,
    coveredImageCount: completed.reduce((sum, item) => sum + item.chunk.visionImages.length, 0),
    sourceTextChars,
    coveredTextChars: completed.reduce((sum, item) => sum + item.chunk.extractedText.length, 0),
    chunks: completed.map(({ chunk }, index) => ({
      index: index + 1,
      originalChunkIndex: chunk.index,
      subdivisionPath: chunk.subdivisionPath || '',
      name: chunk.name,
      sourceFileIndex: chunk.sourceFileIndex,
      pageNumbers: chunk.pageNumbers,
      imageCount: chunk.visionImages.length,
      textChars: chunk.extractedText.length
    }))
  }
  return {
    ...courseware,
    mime: 'text/plain',
    buffer: Buffer.alloc(0),
    extractedText: summaryText,
    extractionSource: 'ai-courseware-summary',
    isImage: false,
    dataUrl: '',
    visionImages: [],
    files: [],
    summaryStats
  }
}

module.exports = { buildCoursewareSummaryChunks, createCoursewareSummary }
