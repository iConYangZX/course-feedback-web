const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8')
function node() {
  const classes = new Set()
  return {
    textContent: '', innerHTML: '', dataset: {}, disabled: false,
    setAttribute() {},
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name) },
      add(name) { classes.add(name) }, remove(name) { classes.delete(name) },
      contains(name) { return classes.has(name) }
    }
  }
}

function harness() {
  let nextId = 0
  const intervals = new Map()
  const context = vm.createContext({
    document: { addEventListener() {}, querySelector: () => ({ scrollIntoView() {} }) },
    window: { crypto: { randomUUID: () => `test-request-${++nextId}` } },
    FormData, Blob, File, TypeError, console, setTimeout, clearTimeout,
    setInterval: (callback) => { const id = ++nextId; intervals.set(id, callback); return id },
    clearInterval: (id) => intervals.delete(id)
  })
  vm.runInContext(source, context)
  const { state, els } = vm.runInContext('({ state, els })', context)
  for (const key of ['generateBtn', 'generationStatus', 'partialFeedbackNotice', 'retryIncompleteBtn', 'copyAllBtn', 'resultNote', 'resultList', 'teachingApplyBar', 'applyTeachingDataBtn']) els[key] = node()
  els.feedbackFormatSelect = { value: 'text' }
  els.generationInstructionInput = { value: '保留原来的反馈要求' }
  const payload = {
    mode: 'class', classId: 'class-1', lessonTitle: '分数应用', feedbackScope: 'individual',
    generationInstruction: els.generationInstructionInput.value,
    students: [1, 2, 3].map((id) => ({ id: `s${id}`, name: `合成学生${id}`, remark: `原始备注${id}` }))
  }
  const pdf = new File(['synthetic PDF content'], 'original-courseware.pdf', { type: 'application/pdf' })
  context.buildGeneratePayload = () => structuredClone(payload)
  context.getSelectedCoursewareFiles = () => [pdf]
  context.showToast = () => {}
  let pdfReads = 0
  context.appendPdfPreviewData = async (formData, file, requestedPayload) => {
    pdfReads += 1
    requestedPayload.coursewareMeta = [{ fileIndex: 0, selectedPdfPages: [1], clientPdfText: '原课件文字' }]
    formData.append('pdfPageImage', new Blob(['synthetic page'], { type: 'image/jpeg' }), 'courseware-0-page-1.jpg')
  }
  return { context, state, els, payload, pdf, intervals, pdfReads: () => pdfReads }
}
const feedback = (id, text = `真实生成结果${id}`) => ({ studentId: `s${id}`, name: `合成学生${id}`, feedback: text })
const response = (data, status = 200) => ({ response: { ok: status < 400, status }, data })
const partial = (items = [feedback(1)]) => ({ partial: true, feedbacks: items, failedStudents: [2, 3].map((id) => ({ studentId: `s${id}`, name: `合成学生${id}`, error: 'AI 连接中断' })) })

test('partial responses display only real successes and leave failed students, form, and teaching records intact', async () => {
  const h = harness()
  h.context.requestFeedbackGeneration = async () => response(partial())
  await h.context.generateFeedback()
  assert.equal(h.state.feedbacks.length, 1)
  assert.equal(h.state.feedbacks[0].studentId, 's1')
  assert.match(h.els.resultNote.textContent, /已完成 1 \/ 3/)
  assert.match(h.els.partialFeedbackNotice.textContent, /合成学生2.*合成学生3/)
  assert.equal(h.els.retryIncompleteBtn.classList.contains('hidden'), false)
  assert.equal(h.els.retryIncompleteBtn.disabled, false)
  assert.equal(h.state.pendingTeachingApplication, null)
  assert.equal(h.els.generationInstructionInput.value, '保留原来的反馈要求')
  assert.doesNotMatch(h.els.resultList.innerHTML, /真实生成结果2|真实生成结果3/)
  assert.equal(h.intervals.size, 0)
})

test('retry submits only missing students using the original prepared PDF and merges by ID without overwriting successes', async () => {
  const h = harness()
  const requests = []
  h.context.requestFeedbackGeneration = async (formData) => {
    requests.push(formData)
    return requests.length === 1 ? response(partial()) : response({ feedbacks: [feedback(3), feedback(2), feedback(1, '不得覆盖原结果')] })
  }
  await h.context.generateFeedback()
  // A later edit or file-picker change must not change the pending request snapshot.
  h.payload.students[1].remark = '后来修改的备注'
  h.context.getSelectedCoursewareFiles = () => { throw new Error('must reuse the original prepared files') }
  await h.context.retryIncompleteFeedbacks()
  const originalPayload = JSON.parse(requests[0].get('payload'))
  const retryPayload = JSON.parse(requests[1].get('payload'))
  assert.deepEqual(retryPayload.students.map((item) => item.id), ['s2', 's3'])
  assert.equal(retryPayload.students[0].remark, '原始备注2')
  assert.notEqual(originalPayload.generationRequestId, retryPayload.generationRequestId)
  assert.equal(await requests[1].get('courseware').text(), await requests[0].get('courseware').text())
  assert.equal(requests[1].get('courseware').name, 'original-courseware.pdf')
  assert.equal(requests[1].get('pdfPageImage').name, 'courseware-0-page-1.jpg')
  assert.equal(h.pdfReads(), 1)
  assert.deepEqual(Array.from(h.state.feedbacks, (item) => item.studentId), ['s1', 's2', 's3'])
  assert.equal(h.state.feedbacks[0].feedback, '真实生成结果1')
  assert.equal(h.state.partialGeneration, null)
  assert.equal(h.els.retryIncompleteBtn.classList.contains('hidden'), true)
  assert.equal(h.state.pendingTeachingApplication.feedbacks.length, 3)
  assert.equal(h.intervals.size, 0)
})

test('another partial retry keeps earlier successes and the next retry targets only the remaining student', async () => {
  const h = harness()
  const requests = []
  h.context.requestFeedbackGeneration = async (formData) => {
    requests.push(JSON.parse(formData.get('payload')))
    if (requests.length === 1) return response(partial())
    if (requests.length === 2) return response({ partial: true, feedbacks: [feedback(2)], failedStudents: [{ studentId: 's3', name: '合成学生3', error: '仍未完成' }] })
    return response({ feedbacks: [feedback(3)] })
  }
  await h.context.generateFeedback()
  await h.context.retryIncompleteFeedbacks()
  assert.equal(h.state.feedbacks.length, 2)
  assert.match(h.els.partialFeedbackNotice.textContent, /已完成 2 \/ 3/)
  assert.equal(h.state.pendingTeachingApplication, null)
  await h.context.retryIncompleteFeedbacks()
  assert.deepEqual(requests[2].students.map((item) => item.id), ['s3'])
  assert.equal(h.state.feedbacks.length, 3)
})

test('a failed retry preserves completed results and keeps retry available; an initial total failure stays an error', async () => {
  const h = harness()
  h.context.requestFeedbackGeneration = async () => response(partial())
  await h.context.generateFeedback()
  h.context.requestFeedbackGeneration = async () => { throw new Error('Upstream HTTP/2 stream failed') }
  await h.context.retryIncompleteFeedbacks()
  assert.equal(h.state.feedbacks.length, 1)
  assert.equal(h.state.feedbacks[0].feedback, '真实生成结果1')
  assert.equal(h.els.retryIncompleteBtn.disabled, false)
  assert.equal(h.els.generationStatus.dataset.state, 'error')
  assert.equal(h.els.generationInstructionInput.value, '保留原来的反馈要求')
  assert.equal(h.intervals.size, 0)

  const first = harness()
  first.context.requestFeedbackGeneration = async () => response({ error: '服务中断' }, 500)
  await first.context.generateFeedback()
  assert.equal(first.state.feedbacks.length, 0)
  assert.equal(first.state.partialGeneration, null)
  assert.equal(first.els.generationStatus.dataset.state, 'error')
})

test('normalization never fabricates missing results or assigns unknown IDs or ambiguous names by position', () => {
  const h = harness()
  const normalized = h.context.normalizeGeneratedFeedbacksForPayload([
    feedback(3), { studentId: 'unknown', name: '合成学生1', feedback: '错误身份' }
  ], h.payload)
  assert.deepEqual(Array.from(normalized, (item) => item.studentId), ['s3'])
  const duplicateNames = { students: [{ id: 'a', name: '同名' }, { id: 'b', name: '同名' }] }
  assert.equal(h.context.normalizeGeneratedFeedbacksForPayload([{ name: '同名', feedback: '不能确定身份' }], duplicateNames).length, 0)
})

test('clearing or switching the current results discards the old partial retry snapshot', async () => {
  const h = harness()
  let requests = 0
  h.context.requestFeedbackGeneration = async () => { requests += 1; return response(partial()) }
  await h.context.generateFeedback()
  h.state.lastGeneratedPayload = null
  h.state.feedbacks = []
  h.context.renderResults()
  await h.context.retryIncompleteFeedbacks()
  assert.equal(requests, 1)
  assert.equal(h.state.partialGeneration, null)
  assert.equal(h.els.retryIncompleteBtn.classList.contains('hidden'), true)
})
