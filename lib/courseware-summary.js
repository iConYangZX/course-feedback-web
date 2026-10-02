'use strict'

const DEFAULT_MAX_IMAGES = 6
const DEFAULT_MAX_TEXT_CHARS = 8000
const DEFAULT_CONCURRENCY = 2

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
    const append = (visionImages, extractedText, pageNumbers, imageStart) => {
      const parts = splitText(extractedText, maxTextChars)
      if (!parts.length && visionImages.length) parts.push('')
      parts.forEach((part, textPartIndex) => chunks.push({
        name: file.name || `课件 ${fileIndex + 1}`,
        sourceFileIndex: fileIndex,
        extractedText: part,
        visionImages: textPartIndex === 0 ? visionImages : [],
        pageNumbers,
        imageStart: textPartIndex === 0 && visionImages.length ? imageStart : null,
        textPartIndex: textPartIndex + 1,
        textPartCount: parts.length
      }))
    }

    for (let start = 0; start < images.length; start += maxImages) {
      const group = images.slice(start, start + maxImages)
      const pageNumbers = group.map((image, index) => imagePageNumber(image, start + index, file, images.length))
        .filter((page) => page !== null)
      const selectedPages = new Set(pageNumbers)
      const correspondingText = segments.map((segment, index) => {
        if (usedSegments.has(index) || !selectedPages.has(segment.pageNumber)) return ''
        usedSegments.add(index)
        return segment.text
      }).join('')
      append(group, correspondingText, pageNumbers, start + 1)
    }
    const remaining = segments.filter((segment, index) => !usedSegments.has(index))
    append([], remaining.map((segment) => segment.text).join(''),
      [...new Set(remaining.map((segment) => segment.pageNumber).filter((page) => page !== null))], null)
  })
  return chunks.map((chunk, index) => ({ ...chunk, index: index + 1, total: chunks.length }))
}

async function createCoursewareSummary(courseware, summarizeChunk, options = {}) {
  if (!courseware) return null
  if (typeof summarizeChunk !== 'function') throw new TypeError('summarizeChunk must be a function')
  const chunks = buildCoursewareSummaryChunks(courseware, options)
  const summaries = new Array(chunks.length)
  const concurrency = Math.min(DEFAULT_CONCURRENCY, positiveInteger(options.concurrency, DEFAULT_CONCURRENCY), chunks.length)
  let nextIndex = 0
  let failure = null
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!failure && nextIndex < chunks.length) {
      const index = nextIndex++
      try {
        const result = await summarizeChunk(chunks[index])
        if (typeof result !== 'string' || !result.trim()) throw new Error('AI 未返回这一段的分析内容')
        summaries[index] = result.trim()
      } catch (error) {
        if (!failure) {
          failure = new Error(`课件第 ${index + 1}/${chunks.length} 段分析失败：${(error && error.message) || '请重新生成'}`, { cause: error })
        }
      }
    }
  }))
  if (failure) throw failure

  const files = sourceFiles(courseware)
  const summaryText = summaries.map((summary, index) => {
    const chunk = chunks[index]
    const pages = chunk.pageNumbers.length ? `；原第 ${chunk.pageNumbers.join('、')} 页` : ''
    return `【课件分段 ${chunk.index}/${chunk.total}：${chunk.name}${pages}】\n${summary}`
  }).join('\n\n')
  const sourceImageCount = files.reduce((sum, file) => sum + sourceImages(file).length, 0)
  const sourceTextChars = files.reduce((sum, file) => sum + (typeof file.extractedText === 'string' ? file.extractedText.length : 0), 0)
  const summaryStats = {
    sourceFileCount: files.length,
    chunkCount: chunks.length,
    completedChunkCount: summaries.length,
    sourceImageCount,
    coveredImageCount: chunks.reduce((sum, chunk) => sum + chunk.visionImages.length, 0),
    sourceTextChars,
    coveredTextChars: chunks.reduce((sum, chunk) => sum + chunk.extractedText.length, 0),
    chunks: chunks.map((chunk) => ({
      index: chunk.index,
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
