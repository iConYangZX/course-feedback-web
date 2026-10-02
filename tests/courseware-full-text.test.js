const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const AdmZip = require('adm-zip')
const { createCoursewareSummary } = require('../lib/courseware-summary')

const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
function load(names, dependencies = {}) {
  const declarations = names.map((name) => {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'))
    assert.ok(match, `production function ${name} exists`)
    return match[0]
  }).join('\n')
  return new Function(...Object.keys(dependencies), `${declarations}; return {${names.join(',')}}`)(...Object.values(dependencies))
}

const extractionNames = [
  'normalizeCoursewareUploads', 'normalizeCourseware', 'normalizeUploadFileName', 'getMojibakeScore',
  'getMimeType', 'normalizePageNumbers', 'sliceTextByApproxPages', 'trim', 'extractCoursewareText',
  'extractDocxText', 'extractPptxText', 'xmlToText', 'normalizeExtractedCoursewareText', 'truncateText',
  'combineCoursewares', 'getCoursewareVisionImages', 'extractPdfText'
]
const tail = '末尾唯一知识点：三角函数的和差公式必须保留。'
const longText = `课程正文开始。${'完整知识点与例题。'.repeat(5000)}${tail}`
function api(overrides = {}) {
  return load(extractionNames, {
    AdmZip,
    pdfParse: async () => ({ text: longText }),
    extractPdfImageText: async () => ({ text: '', pageCount: 0 }),
    ...overrides
  })
}
function file(name, buffer) { return { originalname: name, buffer, mimetype: 'application/octet-stream' } }

test('feedback uploads and stored text materials retain the final paragraph through every summary chunk', async () => {
  const production = api()
  const uploaded = file('lesson.txt', Buffer.from(longText))
  const courseware = await production.normalizeCoursewareUploads([uploaded], null)
  const stored = await production.normalizeCoursewareUploads([], uploaded)
  assert.equal(courseware.extractedText, longText)
  assert.equal(stored.extractedText, longText)
  const seen = []
  const summarized = await createCoursewareSummary(courseware, async (chunk) => {
    seen.push(chunk.extractedText)
    return chunk.extractedText.slice(-tail.length)
  })
  assert.equal(seen.join(''), longText)
  assert.ok(seen.every((part) => part.length <= 8000))
  assert.equal(summarized.summaryStats.coveredTextChars, longText.length)
  assert.match(summarized.extractedText, /三角函数的和差公式必须保留/)
})

test('non-feedback normalization keeps the previous 22000-character behavior', async () => {
  const production = api()
  const result = await production.normalizeCourseware(file('lesson.md', Buffer.from(longText)))
  assert.equal(result.extractedText, `${longText.slice(0, 22000)}\n\n[课件内容较长，后文已截断]`)
  assert.equal(result.extractedText.includes(tail), false)
})

test('real DOCX and PPTX archives retain late document paragraphs and final slides for feedback', async () => {
  const production = api()
  const docx = new AdmZip()
  docx.addFile('word/document.xml', Buffer.from(`<w:document><w:p><w:t>${longText}</w:t></w:p></w:document>`))
  const pptx = new AdmZip()
  pptx.addFile('ppt/slides/slide1.xml', Buffer.from(`<a:p><a:t>${'前半部分内容。'.repeat(5000)}</a:t></a:p>`))
  pptx.addFile('ppt/slides/slide2.xml', Buffer.from(`<a:p><a:t>${tail}</a:t></a:p>`))
  for (const uploaded of [file('lesson.docx', docx.toBuffer()), file('lesson.pptx', pptx.toBuffer())]) {
    const full = await production.normalizeCoursewareUploads([uploaded], null)
    const legacy = await production.normalizeCourseware(uploaded)
    assert.ok(full.extractedText.length > 22000)
    assert.ok(full.extractedText.endsWith(tail))
    assert.equal(legacy.extractedText.includes(tail), false)
  }
})

test('embedded PDF text preserves its tail in feedback without altering other consumers', async () => {
  let parseCalls = 0
  const production = api({ pdfParse: async () => { parseCalls += 1; return { text: longText } } })
  const uploaded = file('lesson.pdf', Buffer.from('synthetic-pdf-parser-input'))
  const full = await production.normalizeCoursewareUploads([uploaded], null)
  const legacy = await production.normalizeCourseware(uploaded)
  assert.equal(full.extractedText, longText)
  assert.equal(legacy.extractedText.includes(tail), false)
  assert.equal(parseCalls, 2)
})

test('PDF OCR fallback receives the preservation option from the feedback path', async () => {
  const optionsSeen = []
  const production = api({
    pdfParse: async () => ({ text: '' }),
    extractPdfImageText: async (buffer, options) => {
      optionsSeen.push(options)
      return { text: options.preserveFullText ? longText : longText.slice(0, 22000), pageCount: 8 }
    }
  })
  const uploaded = file('scan.pdf', Buffer.from('synthetic-scan'))
  const full = await production.normalizeCoursewareUploads([uploaded], null)
  await production.normalizeCourseware(uploaded)
  assert.equal(full.extractedText, longText)
  assert.equal(optionsSeen[0].preserveFullText, true)
  assert.notEqual(optionsSeen[1].preserveFullText, true)
})

test('actual image and PDF OCR aggregation keep long recognized text only when opted in', async () => {
  const pageNames = ['page-01.png', 'page-02.png', 'page-03.png']
  const production = load(['extractImageText', 'extractPdfImageText', 'normalizeExtractedCoursewareText', 'truncateText'], {
    path, os,
    fs: { writeFileSync() {}, unlinkSync() {}, mkdtempSync: () => '/synthetic-ocr', readdirSync: () => pageNames, rmSync() {} },
    getOcrCommand: () => ({ command: 'synthetic-ocr', args: [] }),
    getPdftoppmPath: () => 'synthetic-pdftoppm',
    execFileAsync: async () => ({ stdout: longText }),
    runOcrOnImageFile: async (name) => name.endsWith('03.png') ? tail : '页面知识点。'.repeat(3000)
  })
  assert.equal(await production.extractImageText(Buffer.alloc(0), 'lesson.png', { preserveFullText: true }), longText)
  assert.equal((await production.extractImageText(Buffer.alloc(0), 'lesson.png')).includes(tail), false)
  const pdfFull = await production.extractPdfImageText(Buffer.alloc(0), { preserveFullText: true })
  const pdfLegacy = await production.extractPdfImageText(Buffer.alloc(0))
  assert.ok(pdfFull.text.endsWith(tail))
  assert.equal(pdfLegacy.text.includes(tail), false)
})
