const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { setTimeout: pause } = require('node:timers/promises')

async function openServer(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

async function freePort() {
  const probe = http.createServer()
  const port = await openServer(probe)
  await new Promise((resolve) => probe.close(resolve))
  return port
}

test('the real feedback route preserves six successes, charges no partial attempt, and charges once for the three recovered students', { timeout: 30000 }, async (t) => {
  const projectDir = path.join(__dirname, '..')
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-route-partial-'))
  let child
  let childOutput = ''
  let providerRecovered = false
  const requests = []
  const roster = Array.from({ length: 9 }, (_, index) => ({
    id: `s${index + 1}`, name: `合成接口学生${index + 1}`, performance: '表现良好', remark: ''
  }))
  const upstream = http.createServer(async (req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const content = body.messages.find((item) => item.role === 'user').content
      const prompt = typeof content === 'string' ? content : content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
      const requested = roster.filter((student) => new RegExp(`"id"\\s*:\\s*"${student.id}"`).test(prompt))
      requests.push({ ids: requested.map((student) => student.id), recovered: providerRecovered, stream: body.stream })
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
      if (!providerRecovered && requested.some((student) => student.id === 's4')) {
        res.end(JSON.stringify({ error: { message: 'Upstream HTTP/2 stream failed', type: 'upstream_error' } }))
        return
      }
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        feedbacks: requested.map((student) => ({
          studentId: student.id, name: student.name,
          feedback: `${student.name}已理解分数的含义，课堂表现良好。PROVIDER_VALID_${student.id}`
        }))
      }) } }] }))
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: error.message } }))
    }
  })
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }
    upstream.closeAllConnections()
    if (upstream.listening) await new Promise((resolve) => upstream.close(resolve))
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  // Seed isolated files so the app cannot migrate or modify real local records.
  await Promise.all(Object.entries({
    'usage.json': {}, 'accounts.json': { users: [] },
    'feedback-data.json': { owners: {} }, 'materials.json': { items: [] }
  }).map(([name, value]) => fs.writeFile(path.join(dataDir, name), JSON.stringify(value))))
  const providerPort = await openServer(upstream)
  const appPort = await freePort()
  child = spawn(process.execPath, ['server.js'], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: String(appPort), DATA_DIR: dataDir, DATABASE_URL: '', PUBLIC_MODE: 'false',
      AI_PROVIDER: 'custom', CUSTOM_API_KEY: 'synthetic-local-test-key',
      CUSTOM_MODEL: 'synthetic-local-test-model', CUSTOM_BASE_URL: `http://127.0.0.1:${providerPort}`,
      OPENAI_API_KEY: '', DEEPSEEK_API_KEY: '', DAILY_LIMIT: '10',
      SESSION_SECRET: 'synthetic-local-test-session',
      HTTPS_PROXY: '', HTTP_PROXY: '', ALL_PROXY: '',
      https_proxy: '', http_proxy: '', all_proxy: '',
      NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
      NODE_OPTIONS: '', NODE_USE_ENV_PROXY: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (chunk) => { childOutput = (childOutput + chunk).slice(-8000) })
  child.stderr.on('data', (chunk) => { childOutput = (childOutput + chunk).slice(-8000) })
  const baseUrl = `http://127.0.0.1:${appPort}`
  let ready = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Test app exited: ${childOutput}`)
    try {
      const response = await globalThis.fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) })
      const health = await response.json()
      if (health.ok) {
        assert.equal(health.publicMode, false)
        assert.equal(health.storage.mode, 'file')
        assert.equal(health.storage.dataDir, dataDir)
        assert.equal(health.hasProxy, false)
        ready = true
        break
      }
    } catch {}
    await pause(50)
  }
  assert.equal(ready, true, `Test app failed to start: ${childOutput}`)

  const generate = async (selected, generationRequestId) => {
    // Native FormData must be paired with native fetch, not a different Undici
    // package's fetch implementation.
    const form = new FormData()
    form.append('payload', JSON.stringify({
      generationRequestId, students: selected, mode: 'class', feedbackScope: 'individual',
      lessonTitle: '分数的意义', courseNote: '一份合成测试课件', template: ''
    }))
    form.append('courseware', new Blob(['分数表示整体的一部分，请保留该知识点。'], { type: 'text/plain' }), 'synthetic-courseware.txt')
    const response = await globalThis.fetch(`${baseUrl}/api/generate-feedback`, {
      method: 'POST', body: form, headers: { 'user-agent': 'feedback-route-integration-test' }, signal: AbortSignal.timeout(10000)
    })
    assert.equal(response.status, 200)
    const result = JSON.parse(await response.text())
    assert.equal(result.error, undefined)
    return result
  }

  const initial = await generate(roster, 'synthetic-full-class')
  assert.equal(initial.partial, true)
  assert.deepEqual(initial.feedbacks.map((item) => item.studentId), ['s1', 's2', 's3', 's7', 's8', 's9'])
  assert.deepEqual(initial.failedStudents.map((item) => item.studentId), ['s4', 's5', 's6'])
  assert.equal(initial.usage.used, 0)
  assert.equal(initial.usage.remaining, 10)
  assert.ok(initial.feedbacks.every((item) => item.feedback.includes(`PROVIDER_VALID_${item.studentId}`)))
  assert.equal(requests.filter((request) => request.ids.includes('s1')).length, 1)
  assert.equal(requests.filter((request) => request.ids.includes('s7')).length, 1)

  providerRecovered = true
  const recovered = await generate(roster.filter((student) => ['s4', 's5', 's6'].includes(student.id)), 'synthetic-recover-missing')
  assert.equal(recovered.partial, false)
  assert.deepEqual(recovered.feedbacks.map((item) => item.studentId), ['s4', 's5', 's6'])
  assert.deepEqual(recovered.failedStudents, [])
  assert.equal(recovered.usage.used, 1)
  assert.equal(recovered.usage.remaining, 9)
  assert.ok(recovered.feedbacks.every((item) => item.feedback.includes(`PROVIDER_VALID_${item.studentId}`)))
  assert.deepEqual(requests.filter((request) => request.recovered).map((request) => request.ids), [['s4', 's5', 's6']])
  const savedUsage = JSON.parse(await fs.readFile(path.join(dataDir, 'usage.json'), 'utf8'))
  assert.deepEqual(Object.values(savedUsage).flatMap((day) => Object.values(day)), [1])
})
