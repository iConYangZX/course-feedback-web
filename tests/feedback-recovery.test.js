const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Load real orchestration/parser functions while replacing the provider boundary.
// No server startup, credentials, network, or invented fallback feedback is used.
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
const declarations = new Map([...source.matchAll(/^((?:async )?function (\w+)\([^\n]*\) \{[\s\S]*?^\})/gm)]
  .map((match) => [match[2], match[1]]))
const constantDeclarations = [...source.matchAll(/^const ([A-Z][A-Z0-9_]*FEEDBACK[A-Z0-9_]*|FEEDBACK_[A-Z0-9_]+) = ([0-9]+)\s*$/gm)]
  .map((match) => `const ${match[1]} = ${match[2]}`)

function load(requestAI) {
  const requested = ['requestFeedbacks', 'requestFeedbackBatch', 'matchFeedbacksByStudent', 'assertCompleteFeedbacks']
  const included = new Set()
  function include(name) {
    if (name === 'requestAI' || included.has(name)) return
    assert.ok(declarations.has(name), `production function ${name} exists`)
    included.add(name)
    const body = declarations.get(name)
    for (const dependency of declarations.keys()) {
      if (new RegExp(`\\b${dependency}\\b`).test(body)) include(dependency)
    }
  }
  requested.forEach(include)
  const code = `${constantDeclarations.join('\n')}\n${[...included].map((name) => declarations.get(name)).join('\n')}`
  return new Function('requestAI', 'console', `${code}; return { ${requested.join(',')} }`)(requestAI, { error() {} })
}

const config = { provider: 'custom', model: 'gpt-5.6-sol' }
const material = { extractedText: '真实读取的合成数学课件摘要', visionImages: [] }
const students = (count) => Array.from({ length: count }, (_, index) => ({ id: `s${index + 1}`, name: `合成学生${index + 1}` }))
const payloadFor = (count) => ({ students: students(count), feedbackScope: 'individual', lessonTitle: '分数应用' })
const itemFor = (student, feedback = `provider-confirmed:${student.id}`) => ({ studentId: student.id, name: student.name, feedback })
const chat = (content, finish_reason = 'stop') => ({ choices: [{ message: { content }, finish_reason }] })
const completed = (items) => chat(JSON.stringify({ feedbacks: items }))

test('20 students use the production three-person default and all results come from the provider', async () => {
  const calls = []
  const api = load(async (payload, courseware, aiConfig) => {
    assert.equal(courseware, material)
    assert.equal(aiConfig, config)
    calls.push(payload.students.map((student) => student.id))
    return completed(payload.students.map((student) => itemFor(student)))
  })
  const result = await api.requestFeedbacks(payloadFor(20), material, config)
  assert.equal(calls.length, 7)
  assert.deepEqual(calls.map((batch) => batch.length), [3, 3, 3, 3, 3, 3, 2])
  assert.equal(result.feedbacks.length, 20)
  assert.equal(new Set(result.feedbacks.map((item) => item.studentId)).size, 20)
  for (const student of students(20)) {
    const item = result.feedbacks.find((value) => value.studentId === student.id)
    assert.equal(item.feedback, `provider-confirmed:${student.id}`)
  }
})

for (const failure of ['truncated', 'invalid JSON', 'interrupted']) {
  test(`a five-person batch recovers ${failure} by requesting smaller batches`, async () => {
    const calls = []
    const api = load(async (payload) => {
      calls.push(payload.students.map((student) => student.id))
      if (payload.students.length > 2) {
        if (failure === 'truncated') return chat('{"feedbacks":[', 'length')
        if (failure === 'invalid JSON') return chat('malformed provider output')
        const error = new Error('AI 服务返回中途断开')
        error.code = 'AI_RESPONSE_INTERRUPTED'
        throw error
      }
      return completed(payload.students.map((student) => itemFor(student)))
    })
    const feedbacks = await api.requestFeedbackBatch(payloadFor(5), material, config)
    assert.equal(calls[0].length, 5)
    assert.ok(calls.slice(1).every((batch) => batch.length < 5))
    assert.equal(feedbacks.length, 5)
    assert.equal(new Set(feedbacks.map((item) => item.studentId)).size, 5)
    assert.ok(feedbacks.every((item) => item.feedback === `provider-confirmed:${item.studentId}`))
  })
}

test('a valid partial response preserves completed students and requests only the missing student', async () => {
  const calls = []
  const api = load(async (payload) => {
    calls.push(payload.students.map((student) => student.id))
    if (calls.length === 1) {
      return completed([itemFor(payload.students[2], 'first-response:s3'), itemFor(payload.students[0], 'first-response:s1')])
    }
    assert.deepEqual(payload.students.map((student) => student.id), ['s2'])
    return completed([itemFor(payload.students[0], 'recovered:s2')])
  })
  const result = await api.requestFeedbacks(payloadFor(3), material, config)
  assert.deepEqual(calls, [['s1', 's2', 's3'], ['s2']])
  assert.deepEqual(new Map(result.feedbacks.map((item) => [item.studentId, item.feedback])),
    new Map([['s1', 'first-response:s1'], ['s2', 'recovered:s2'], ['s3', 'first-response:s3']]))
})

test('one-person truncation increases output budget and succeeds without dropping the material', async () => {
  const budgets = []
  const api = load(async (payload, courseware, aiConfig, options = {}) => {
    assert.equal(courseware, material)
    assert.equal(payload.students.length, 1)
    budgets.push(options.maxOutputTokens)
    return budgets.length === 1 ? chat('{"feedbacks":', 'length') : completed([itemFor(payload.students[0])])
  })
  const result = await api.requestFeedbacks(payloadFor(1), material, config)
  assert.equal(result.feedbacks.length, 1)
  assert.equal(budgets.length, 2)
  assert.ok(budgets[0] >= 8000)
  assert.ok(budgets[1] > budgets[0])
  assert.ok(budgets[1] <= 16000)
})

test('an unrecoverable single student stops after at most three attempts and returns no fabricated result', async () => {
  let calls = 0
  const api = load(async () => {
    calls += 1
    return chat('{"feedbacks":', 'length')
  })
  await assert.rejects(api.requestFeedbacks(payloadFor(1), material, config))
  assert.ok(calls >= 2 && calls <= 3, `bounded attempts: ${calls}`)
})

test('exhausted nested missing-student recovery never regenerates completed ancestors', async () => {
  const calls = []
  const api = load(async (payload) => {
    calls.push(payload.students.map((student) => student.id))
    if (payload.students.length > 1) return completed([itemFor(payload.students[0])])
    return chat('{"feedbacks":', 'length')
  })
  await assert.rejects(api.requestFeedbacks(payloadFor(3), material, config),
    (error) => error.feedbackRecoveryExhausted === true)
  assert.deepEqual(calls.slice(0, 2), [['s1', 's2', 's3'], ['s2', 's3']])
  assert.ok(calls.length >= 4 && calls.length <= 5, `no ancestor retries: ${calls.length}`)
  assert.ok(calls.slice(2).every((batch) => batch.length === 1 && batch[0] === 's3'))
})

test('authentication failures propagate once instead of splitting or retrying the batch', async () => {
  let calls = 0
  const denied = Object.assign(new Error('AI 服务认证失败，请联系管理员检查 API 配置'), { status: 401 })
  const api = load(async () => { calls += 1; throw denied })
  await assert.rejects(api.requestFeedbackBatch(payloadFor(3), material, config), (error) => error === denied)
  assert.equal(calls, 1)
})

test('recursive recovery keeps the global provider concurrency at three and completes all 20 students', async () => {
  let active = 0
  let peak = 0
  const api = load(async (payload) => {
    active += 1
    peak = Math.max(peak, active)
    try {
      await new Promise((resolve) => setImmediate(resolve))
      return payload.students.length > 1 ? chat('invalid JSON') : completed([itemFor(payload.students[0])])
    } finally {
      active -= 1
    }
  })
  const result = await api.requestFeedbacks(payloadFor(20), material, config)
  assert.equal(result.feedbacks.length, 20)
  assert.ok(peak <= 3, `provider concurrency must stay bounded: ${peak}`)
  assert.equal(active, 0)
})

test('whole-class feedback keeps its group intact while recovering output truncation', async () => {
  const calls = []
  const payload = { ...payloadFor(5), feedbackScope: 'class' }
  const api = load(async (requested) => {
    calls.push(requested.students.map((student) => student.id))
    return calls.length === 1 ? chat('{"feedbacks":', 'length') : completed(requested.students.map((student) => itemFor(student)))
  })
  const result = await api.requestFeedbacks(payload, material, config)
  assert.equal(result.feedbacks.length, 5)
  assert.deepEqual(calls, [payload.students.map((student) => student.id), payload.students.map((student) => student.id)])
})

test('name matching rejects unknown explicit IDs and ambiguous names without consuming one result twice', () => {
  const api = load(async () => { throw new Error('provider must not be called') })
  const roster = [{ id: 'a', name: '同名学生' }, { id: 'b', name: '同名学生' }, { id: 'c', name: '独立姓名' }]
  const onlyUnknown = api.matchFeedbacksByStudent(roster, [{ studentId: 'wrong-id', name: '独立姓名', feedback: '不得误配' }])
  assert.equal(onlyUnknown.size, 0)
  const ambiguous = api.matchFeedbacksByStudent(roster, [{ name: '同名学生', feedback: '不能判断属于谁' }])
  assert.equal(ambiguous.size, 0)
  const matches = api.matchFeedbacksByStudent(roster, [
    { studentId: 'b', name: '同名学生', feedback: '仅属于b' },
    { name: '独立姓名', feedback: '唯一姓名可匹配' }
  ])
  assert.equal(matches.size, 2)
  assert.equal(matches.has('a'), false)
  assert.equal(matches.get('b').feedback, '仅属于b')
  assert.equal(matches.get('c').feedback, '唯一姓名可匹配')
  assert.equal(new Set(matches.values()).size, matches.size)
})
