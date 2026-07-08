const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { execFile } = require('child_process')
const { promisify } = require('util')
const express = require('express')
const multer = require('multer')
const AdmZip = require('adm-zip')
const pdfParse = require('pdf-parse')
const { fetch, ProxyAgent } = require('undici')
require('dotenv').config()

const app = express()
const execFileAsync = promisify(execFile)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024
  }
})

const PORT = Number(process.env.PORT || 5177)
const DEFAULT_PROVIDER = 'openai'
const ENV_PATH = path.join(__dirname, '.env')
const DATA_DIR = path.join(__dirname, 'data')
const USAGE_PATH = path.join(DATA_DIR, 'usage.json')
const ACCOUNTS_PATH = path.join(DATA_DIR, 'accounts.json')
const OCR_BINARY_PATH = path.join(__dirname, 'scripts', 'ocr_image')
const OCR_SCRIPT_PATH = path.join(__dirname, 'scripts', 'ocr_image.swift')
const PDFTOPPM_PATHS = [
  '/Users/icon/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm',
  '/Users/icon/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/bin/pdftoppm',
  '/Users/icon/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/bin/pdftoppm',
  '/opt/homebrew/bin/pdftoppm',
  '/usr/local/bin/pdftoppm'
]
const proxyUrl = trim(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY)
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : null
const PUBLIC_MODE = parseBoolean(process.env.PUBLIC_MODE)
const ACCESS_CODE = trim(process.env.ACCESS_CODE)
const DAILY_LIMIT = parseDailyLimit(process.env.DAILY_LIMIT)
const SESSION_COOKIE = 'course_feedback_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const QUESTION_RECOGNITION_BATCH_SIZE = 2
const DEFAULT_ACCOUNTS = [
  {
    id: 'admin-iconyang',
    username: 'iConYang',
    role: 'admin',
    active: true,
    dailyLimit: null,
    passwordSalt: 'b8c96bc65748fd9c492407d8cc8b22f4',
    passwordHash: '5f759b01dd37107af762b34634103bdb7673b6feccca4ebef2554e5653c09ec9'
  },
  {
    id: 'user-daijienuo',
    username: 'daijienuo',
    role: 'user',
    active: true,
    dailyLimit: DAILY_LIMIT,
    passwordSalt: 'c3ec09b2c243d19cf8950b6a2ca5fd69',
    passwordHash: '3766097707db5944e26b203f98e804fa47b36fd27cfc7b66c0e12ea7282b4847'
  }
]
const usageState = readUsageState()
const accountState = readAccountState()

app.use(express.json({ limit: '5mb' }))
app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/health', (req, res) => {
  const aiConfig = getAIConfig()
  const session = getAccessSession(req)

  res.json({
    ok: true,
    provider: aiConfig.provider,
    hasApiKey: Boolean(aiConfig.apiKey),
    model: aiConfig.model,
    hasProxy: Boolean(proxyAgent),
    publicMode: PUBLIC_MODE,
    accessRequired: isAccessRequired(),
    authenticated: Boolean(session),
    dailyLimit: getSessionDailyLimit(session),
    user: session ? getSafeSessionUser(session) : null,
    usage: session ? getUsageInfoForSession(session) : null
  })
})

app.get('/api/access/status', (req, res) => {
  const session = getAccessSession(req)

  res.json({
    publicMode: PUBLIC_MODE,
    accessRequired: isAccessRequired(),
    authenticated: Boolean(session),
    dailyLimit: getSessionDailyLimit(session),
    user: session ? getSafeSessionUser(session) : null,
    usage: session ? getUsageInfoForSession(session) : null
  })
})

app.post('/api/access/login', (req, res) => {
  if (!isAccessRequired()) {
    res.json({
      ok: true,
      publicMode: PUBLIC_MODE,
      accessRequired: false,
      authenticated: true,
      dailyLimit: DAILY_LIMIT,
      usage: null
    })
    return
  }

  const username = trim(req.body && req.body.username)
  const password = trim(req.body && req.body.password)

  const account = findAccountByUsername(username)

  if (!account || !account.active || !verifyPassword(password, account)) {
    res.status(401).json({ error: '账号或密码不正确' })
    return
  }

  const token = createSessionToken(account)
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    sameSite: 'Lax',
    secure: isSecureRequest(req)
  }))

  res.json({
    ok: true,
    publicMode: PUBLIC_MODE,
    accessRequired: true,
    authenticated: true,
    dailyLimit: getAccountDailyLimit(account),
    user: getSafeAccount(account),
    usage: getUsageInfoForAccount(account)
  })
})

app.post('/api/access/logout', (req, res) => {
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, '', {
    httpOnly: true,
    maxAge: 0,
    sameSite: 'Lax',
    secure: isSecureRequest(req)
  }))
  res.json({ ok: true })
})

app.get('/api/admin/users', requireAdminMiddleware, (req, res) => {
  res.json({
    users: getAccountsForAdmin()
  })
})

app.post('/api/admin/users', requireAdminMiddleware, (req, res) => {
  try {
    const account = createAccount(req.body || {})
    writeAccountState()
    res.json({
      ok: true,
      user: getAccountForAdmin(account)
    })
  } catch (error) {
    res.status(400).json({ error: error.message || '创建账号失败' })
  }
})

app.patch('/api/admin/users/:userId', requireAdminMiddleware, (req, res) => {
  try {
    const account = updateAccount(req.params.userId, req.body || {})
    writeAccountState()
    res.json({
      ok: true,
      user: getAccountForAdmin(account)
    })
  } catch (error) {
    res.status(400).json({ error: error.message || '保存账号失败' })
  }
})

app.post('/api/admin/users/:userId/reset-usage', requireAdminMiddleware, (req, res) => {
  try {
    const account = findAccountById(req.params.userId)
    if (!account) throw new Error('账号不存在')

    resetUsage(getUsageClientIdForAccount(account))
    res.json({
      ok: true,
      user: getAccountForAdmin(account)
    })
  } catch (error) {
    res.status(400).json({ error: error.message || '重置次数失败' })
  }
})

app.get('/api/config', (req, res) => {
  const aiConfig = getAIConfig()

  if (PUBLIC_MODE) {
    res.json({
      provider: aiConfig.provider,
      model: aiConfig.model,
      hasApiKey: Boolean(aiConfig.apiKey),
      publicMode: true
    })
    return
  }

  res.json({
    provider: aiConfig.provider,
    model: aiConfig.model,
    baseUrl: aiConfig.baseUrl,
    hasApiKey: Boolean(aiConfig.apiKey),
    proxyUrl,
    hasProxy: Boolean(proxyAgent)
  })
})

app.post('/api/config', (req, res) => {
  if (PUBLIC_MODE) {
    res.status(403).json({ error: '公开模式下不能在网页里修改 AI 配置' })
    return
  }

  const nextConfig = normalizeConfigInput(req.body || {})

  if (!nextConfig.provider) {
    res.status(400).json({ error: '请选择模型提供方' })
    return
  }

  if (nextConfig.provider === 'custom' && !nextConfig.baseUrl) {
    res.status(400).json({ error: '请填写 API 端点 URL' })
    return
  }

  updateEnvFile(nextConfig)
  res.json({
    ok: true,
    restartRequired: true
  })
})

app.post('/api/generate-feedback', requireAccessMiddleware, upload.fields([
  { name: 'courseware', maxCount: 1 },
  { name: 'pdfPageImage', maxCount: 500 }
]), async (req, res) => {
  try {
    const session = req.accessSession
    const coursewareFile = getUploadedFile(req, 'courseware')
    const pdfPageImages = getUploadedFiles(req, 'pdfPageImage')

    const usageClientId = getUsageClientId(session)
    const usageInfo = getUsageInfoForSession(session)
    if (!usageInfo.unlimited && usageInfo.remaining <= 0) {
      res.status(429).json({
        error: `今天的生成次数已用完。每日最多 ${usageInfo.limit} 次，请联系管理员或明天再试。`,
        usage: usageInfo
      })
      return
    }

    const payload = parsePayload(req.body.payload)
    validatePayload(payload, Boolean(coursewareFile))

    const aiConfig = getAIConfig()
    const courseware = coursewareFile ? await normalizeCourseware(coursewareFile, {
      clientPdfText: payload.clientPdfText,
      pdfPageImages,
      selectedPdfPages: payload.selectedPdfPages
    }) : null

    if (!aiConfig.apiKey) {
      const nextUsage = incrementUsage(usageClientId, usageInfo.limit, usageInfo.unlimited)
      res.json({
        demo: true,
        message: `当前未配置 ${aiConfig.keyName}，已返回演示反馈。`,
        usage: nextUsage,
        feedbacks: buildDemoFeedbacks(payload)
      })
      return
    }

    const aiResponse = await requestAI(payload, courseware, aiConfig)
    const nextUsage = incrementUsage(usageClientId, usageInfo.limit, usageInfo.unlimited)
    const parsed = parseFeedbackResponse(aiResponse, aiConfig.provider)

    res.json({
      provider: aiConfig.provider,
      model: aiConfig.model,
      debug: buildDebugSummary(payload, courseware),
      usage: nextUsage,
      feedbacks: normalizeFeedbacks(parsed.feedbacks, payload.students, payload)
    })
  } catch (error) {
    console.error(error)
    res.status(400).json({
      error: getUserFacingError(error)
    })
  }
})

app.post('/api/rearrange/recognize', requireAccessMiddleware, upload.fields([
  { name: 'rearrangePageImage', maxCount: 12 },
  { name: 'sourceFile', maxCount: 3 }
]), async (req, res) => {
  try {
    const session = req.accessSession
    const usageClientId = getUsageClientId(session)
    const usageInfo = getUsageInfoForSession(session)

    if (!usageInfo.unlimited && usageInfo.remaining <= 0) {
      res.status(429).json({
        error: `今天的生成次数已用完。每日最多 ${usageInfo.limit} 次，请联系管理员或明天再试。`,
        usage: usageInfo
      })
      return
    }

    const payload = parsePayload(req.body.payload)
    const pageFiles = getUploadedFiles(req, 'rearrangePageImage')
    const sourceFiles = getUploadedFiles(req, 'sourceFile')

    if (!pageFiles.length && !sourceFiles.length) {
      throw new Error('请先上传 PDF、图片或 Word 文件')
    }

    const aiConfig = getAIConfig()
    const pages = await buildQuestionPageInputs(pageFiles)
    const docTexts = sourceFiles.map((file) => extractQuestionSourceText(file)).filter((item) => item.text)

    let questions
    if (!aiConfig.apiKey) {
      questions = buildDemoQuestions(payload, docTexts)
    } else {
      questions = await recognizeQuestionList(payload, pages, docTexts, aiConfig)
    }

    const nextUsage = incrementUsage(usageClientId, usageInfo.limit, usageInfo.unlimited)

    res.json({
      provider: aiConfig.provider,
      model: aiConfig.model,
      usage: nextUsage,
      questions: normalizeQuestions(questions)
    })
  } catch (error) {
    console.error(error)
    res.status(400).json({
      error: getUserFacingError(error)
    })
  }
})

app.post('/api/rearrange/export-word', requireAccessMiddleware, (req, res) => {
  try {
    const title = trim(req.body && req.body.title) || '题卷重排'
    const questions = normalizeQuestions(req.body && req.body.questions)

    if (!questions.length) {
      throw new Error('没有可导出的题目')
    }

    const buffer = buildQuestionDocx(title, questions)
    const fileName = encodeURIComponent(`${title}.docx`)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`)
    res.send(buffer)
  } catch (error) {
    console.error(error)
    res.status(400).json({
      error: getUserFacingError(error)
    })
  }
})

app.listen(PORT, () => {
  console.log(`Course feedback web app running at http://localhost:${PORT}`)
})

function parsePayload(rawPayload) {
  if (!rawPayload) return {}

  try {
    return JSON.parse(rawPayload)
  } catch (error) {
    throw new Error('提交数据格式错误')
  }
}

function getUploadedFile(req, fieldName) {
  const files = req.files && req.files[fieldName]
  return Array.isArray(files) ? files[0] : null
}

function getUploadedFiles(req, fieldName) {
  const files = req.files && req.files[fieldName]
  return Array.isArray(files) ? files : []
}

function validatePayload(payload, hasCourseware = false) {
  if (!Array.isArray(payload.students) || payload.students.length === 0) {
    throw new Error('请先添加学生')
  }

  if (!payload.lessonTitle && !payload.courseNote && !hasCourseware) {
    throw new Error('请填写课程主题、补充课程内容或上传课件')
  }

  payload.students = payload.students
    .map((student, index) => ({
      id: trim(student.id) || `student-${index + 1}`,
      name: trim(student.name),
      performance: trim(student.performance) || '表现良好',
      remark: trim(student.remark),
      personality: trim(student.personality),
      habit: trim(student.habit)
    }))
    .filter((student) => student.name)

  if (!payload.students.length) {
    throw new Error('学生姓名不能为空')
  }
}

function getAIConfig() {
  const provider = trim(process.env.AI_PROVIDER || DEFAULT_PROVIDER).toLowerCase()

  if (provider === 'openai') {
    return {
      provider,
      apiKey: trim(process.env.OPENAI_API_KEY),
      keyName: 'OPENAI_API_KEY',
      model: trim(process.env.OPENAI_MODEL) || 'gpt-5.4-mini',
      baseUrl: trim(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
    }
  }

  if (provider === 'custom') {
    return {
      provider,
      apiKey: trim(process.env.CUSTOM_API_KEY),
      keyName: 'CUSTOM_API_KEY',
      model: trim(process.env.CUSTOM_MODEL) || 'gpt-3.5-turbo',
      baseUrl: trim(process.env.CUSTOM_BASE_URL).replace(/\/$/, '')
    }
  }

  return {
    provider: 'deepseek',
    apiKey: trim(process.env.DEEPSEEK_API_KEY),
    keyName: 'DEEPSEEK_API_KEY',
    model: trim(process.env.DEEPSEEK_MODEL) || 'deepseek-v4-flash',
    baseUrl: trim(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
  }
}

function normalizeConfigInput(input) {
  return {
    provider: trim(input.provider || 'custom').toLowerCase(),
    apiKey: trim(input.apiKey),
    model: trim(input.model),
    baseUrl: trim(input.baseUrl).replace(/\/$/, ''),
    proxyUrl: trim(input.proxyUrl)
  }
}

function updateEnvFile(nextConfig) {
  const currentEnv = readEnvMap()
  const provider = nextConfig.provider

  currentEnv.AI_PROVIDER = provider
  currentEnv.HTTPS_PROXY = nextConfig.proxyUrl || currentEnv.HTTPS_PROXY || ''

  if (provider === 'custom') {
    if (nextConfig.apiKey) currentEnv.CUSTOM_API_KEY = nextConfig.apiKey
    currentEnv.CUSTOM_MODEL = nextConfig.model || currentEnv.CUSTOM_MODEL || 'gpt-3.5-turbo'
    currentEnv.CUSTOM_BASE_URL = nextConfig.baseUrl || currentEnv.CUSTOM_BASE_URL || ''
  }

  if (provider === 'openai') {
    if (nextConfig.apiKey) currentEnv.OPENAI_API_KEY = nextConfig.apiKey
    currentEnv.OPENAI_MODEL = nextConfig.model || currentEnv.OPENAI_MODEL || 'gpt-5.4-mini'
    currentEnv.OPENAI_BASE_URL = nextConfig.baseUrl || currentEnv.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  }

  if (provider === 'deepseek') {
    if (nextConfig.apiKey) currentEnv.DEEPSEEK_API_KEY = nextConfig.apiKey
    currentEnv.DEEPSEEK_MODEL = nextConfig.model || currentEnv.DEEPSEEK_MODEL || 'deepseek-v4-flash'
    currentEnv.DEEPSEEK_BASE_URL = nextConfig.baseUrl || currentEnv.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  }

  writeEnvMap(currentEnv)
}

function readEnvMap() {
  const content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : ''
  const envMap = {}

  content.split(/\r?\n/).forEach((line) => {
    if (!line || line.trim().startsWith('#')) return
    const index = line.indexOf('=')
    if (index < 0) return
    envMap[line.slice(0, index)] = line.slice(index + 1)
  })

  return envMap
}

function writeEnvMap(envMap) {
  const order = [
    'PUBLIC_MODE',
    'ACCESS_CODE',
    'DAILY_LIMIT',
    'SESSION_SECRET',
    'AI_PROVIDER',
    'CUSTOM_API_KEY',
    'CUSTOM_MODEL',
    'CUSTOM_BASE_URL',
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'OPENAI_BASE_URL',
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_MODEL',
    'DEEPSEEK_BASE_URL',
    'HTTPS_PROXY',
    'PORT'
  ]
  const lines = []
  const written = new Set()

  order.forEach((key) => {
    if (!(key in envMap)) return
    lines.push(`${key}=${envMap[key]}`)
    written.add(key)
  })

  Object.keys(envMap).sort().forEach((key) => {
    if (written.has(key)) return
    lines.push(`${key}=${envMap[key]}`)
  })

  fs.writeFileSync(ENV_PATH, `${lines.join('\n')}\n`)
}

function isAccessRequired() {
  return PUBLIC_MODE
}

function requireAccess(req, res) {
  if (!isAccessRequired()) {
    return {
      clientId: getRequestFingerprint(req),
      role: 'user',
      dailyLimit: DAILY_LIMIT
    }
  }

  const session = getAccessSession(req)
  if (session) return session

  res.status(401).json({ error: '请先登录账号' })
  return null
}

function requireAccessMiddleware(req, res, next) {
  const session = requireAccess(req, res)
  if (!session) return

  req.accessSession = session
  next()
}

function requireAdminMiddleware(req, res, next) {
  const session = requireAccess(req, res)
  if (!session) return

  if (session.role !== 'admin') {
    res.status(403).json({ error: '只有管理员可以操作账号管理' })
    return
  }

  req.accessSession = session
  next()
}

function getAccessSession(req) {
  const cookies = parseCookies(req.headers.cookie || '')
  const token = cookies[SESSION_COOKIE]
  if (!token) return null

  return verifySessionToken(token)
}

function createSessionToken(account) {
  const payload = Buffer.from(JSON.stringify({
    accountId: account.id,
    username: account.username,
    role: account.role,
    createdAt: Date.now()
  })).toString('base64url')
  const signature = signTokenPayload(payload)
  return `${payload}.${signature}`
}

function verifySessionToken(token) {
  const [payload, signature] = String(token || '').split('.')
  if (!payload || !signature) return null

  if (!safeEqual(signature, signTokenPayload(payload))) return null

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!parsed.accountId) return null

    const age = Date.now() - Number(parsed.createdAt || 0)
    if (age < 0 || age > SESSION_MAX_AGE_SECONDS * 1000) return null

    const account = findAccountById(parsed.accountId)
    if (!account || !account.active) return null

    return {
      accountId: account.id,
      username: account.username,
      role: account.role,
      dailyLimit: getAccountDailyLimit(account)
    }
  } catch (error) {
    return null
  }
}

function signTokenPayload(payload) {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url')
}

function getSessionSecret() {
  const explicitSecret = trim(process.env.SESSION_SECRET)
  if (explicitSecret) return explicitSecret

  return crypto
    .createHash('sha256')
    .update([
      ACCESS_CODE,
      process.env.CUSTOM_API_KEY || '',
      process.env.OPENAI_API_KEY || '',
      'course-feedback-session'
    ].join('|'))
    .digest('hex')
}

function getSafeSessionUser(session) {
  return {
    id: session.accountId || '',
    username: session.username || '',
    role: session.role || 'user',
    isAdmin: session.role === 'admin',
    dailyLimit: session.role === 'admin' ? null : getSessionDailyLimit(session)
  }
}

function getSafeAccount(account) {
  return {
    id: account.id,
    username: account.username,
    role: account.role,
    isAdmin: account.role === 'admin',
    active: Boolean(account.active),
    dailyLimit: getAccountDailyLimit(account)
  }
}

function parseCookies(cookieHeader) {
  const cookies = {}

  String(cookieHeader || '').split(';').forEach((part) => {
    const index = part.indexOf('=')
    if (index < 0) return
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!key) return
    cookies[key] = decodeURIComponent(value)
  })

  return cookies
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push('Path=/')

  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${options.maxAge}`)

  return parts.join('; ')
}

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https'
}

function getRequestFingerprint(req) {
  const raw = [
    req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
    req.headers['user-agent'] || ''
  ].join('|')

  return crypto.createHash('sha256').update(raw).digest('hex')
}

function readAccountState() {
  try {
    const raw = fs.existsSync(ACCOUNTS_PATH) ? fs.readFileSync(ACCOUNTS_PATH, 'utf8') : ''
    const parsed = raw ? JSON.parse(raw) : null
    const state = parsed && Array.isArray(parsed.users) ? parsed : { users: [] }
    mergeDefaultAccounts(state)
    return state
  } catch (error) {
    return { users: DEFAULT_ACCOUNTS.map((account) => ({ ...account })) }
  }
}

function mergeDefaultAccounts(state) {
  DEFAULT_ACCOUNTS.forEach((defaultAccount) => {
    const existed = state.users.find((account) => account.username === defaultAccount.username)
    if (!existed) {
      state.users.push({
        ...defaultAccount,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    }
  })
}

function writeAccountState() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(ACCOUNTS_PATH, `${JSON.stringify(accountState, null, 2)}\n`)
}

function findAccountByUsername(username) {
  const normalized = trim(username).toLowerCase()
  return accountState.users.find((account) => trim(account.username).toLowerCase() === normalized)
}

function findAccountById(accountId) {
  return accountState.users.find((account) => account.id === accountId)
}

function verifyPassword(password, account) {
  if (!password || !account || !account.passwordSalt || !account.passwordHash) return false
  const hash = hashPassword(password, account.passwordSalt)
  return safeEqual(hash, account.passwordHash)
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 32).toString('hex')
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return {
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt)
  }
}

function createAccount(input) {
  const username = trim(input.username)
  const password = trim(input.password)
  const role = trim(input.role || 'user') === 'admin' ? 'admin' : 'user'

  if (!username) throw new Error('请填写账号名')
  if (!/^[A-Za-z0-9_@.-]{3,32}$/.test(username)) {
    throw new Error('账号名需为 3-32 位英文、数字或 _ @ . -')
  }
  if (findAccountByUsername(username)) throw new Error('账号已存在')
  if (!password || password.length < 6) throw new Error('密码至少 6 位')

  const account = {
    id: `user-${crypto.randomUUID()}`,
    username,
    role,
    active: input.active !== false,
    dailyLimit: role === 'admin' ? null : parseDailyLimit(input.dailyLimit || DAILY_LIMIT),
    ...createPasswordRecord(password),
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  accountState.users.push(account)
  return account
}

function updateAccount(accountId, input) {
  const account = findAccountById(accountId)
  if (!account) throw new Error('账号不存在')

  if ('active' in input) {
    if (account.role === 'admin' && input.active === false && getActiveAdminCount() <= 1) {
      throw new Error('至少需要保留一个启用的管理员账号')
    }
    account.active = Boolean(input.active)
  }

  if (account.role !== 'admin' && 'dailyLimit' in input) {
    account.dailyLimit = parseDailyLimit(input.dailyLimit || DAILY_LIMIT)
  }

  const nextPassword = trim(input.password)
  if (nextPassword) {
    if (nextPassword.length < 6) throw new Error('密码至少 6 位')
    Object.assign(account, createPasswordRecord(nextPassword))
  }

  account.updatedAt = Date.now()
  return account
}

function getActiveAdminCount() {
  return accountState.users.filter((account) => account.role === 'admin' && account.active).length
}

function getAccountsForAdmin() {
  return accountState.users
    .slice()
    .sort((left, right) => {
      if (left.role !== right.role) return left.role === 'admin' ? -1 : 1
      return left.username.localeCompare(right.username)
    })
    .map(getAccountForAdmin)
}

function getAccountForAdmin(account) {
  return {
    ...getSafeAccount(account),
    usage: getUsageInfoForAccount(account),
    createdAt: account.createdAt || null,
    updatedAt: account.updatedAt || null
  }
}

function getUsageClientId(session) {
  if (session.accountId) return `account:${session.accountId}`

  return session.clientId
}

function getUsageClientIdForAccount(account) {
  return `account:${account.id}`
}

function getSessionDailyLimit(session) {
  if (!session) return DAILY_LIMIT
  if (session.role === 'admin') return null
  return parseDailyLimit(session.dailyLimit || DAILY_LIMIT)
}

function getAccountDailyLimit(account) {
  if (!account || account.role === 'admin') return null
  return parseDailyLimit(account.dailyLimit || DAILY_LIMIT)
}

function getUsageInfoForSession(session) {
  return getUsageInfo(
    getUsageClientId(session),
    getSessionDailyLimit(session),
    session.role === 'admin'
  )
}

function getUsageInfoForAccount(account) {
  return getUsageInfo(
    getUsageClientIdForAccount(account),
    getAccountDailyLimit(account),
    account.role === 'admin'
  )
}

function getUsageInfo(clientId, limit = DAILY_LIMIT, unlimited = false) {
  const today = getTodayKey()
  const used = Number(usageState[today] && usageState[today][clientId] ? usageState[today][clientId] : 0)
  const safeLimit = unlimited ? null : parseDailyLimit(limit || DAILY_LIMIT)

  return {
    date: today,
    used,
    limit: safeLimit,
    unlimited,
    remaining: unlimited ? null : Math.max(0, safeLimit - used)
  }
}

function incrementUsage(clientId, limit = DAILY_LIMIT, unlimited = false) {
  const today = getTodayKey()
  cleanupUsageState(today)
  if (!usageState[today]) usageState[today] = {}
  usageState[today][clientId] = Number(usageState[today][clientId] || 0) + 1
  writeUsageState()
  return getUsageInfo(clientId, limit, unlimited)
}

function resetUsage(clientId) {
  const today = getTodayKey()
  if (usageState[today]) {
    usageState[today][clientId] = 0
    writeUsageState()
  }
}

function getTodayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

function readUsageState() {
  try {
    const raw = fs.existsSync(USAGE_PATH) ? fs.readFileSync(USAGE_PATH, 'utf8') : '{}'
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    return {}
  }
}

function writeUsageState() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(USAGE_PATH, `${JSON.stringify(usageState, null, 2)}\n`)
}

function cleanupUsageState(today) {
  Object.keys(usageState).forEach((date) => {
    if (date !== today) delete usageState[date]
  })
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

async function normalizeCourseware(file, options = {}) {
  const originalName = file.originalname || 'courseware'
  const mime = getMimeType(originalName, file.mimetype)
  const isImage = mime.startsWith('image/')
  const isPdf = mime === 'application/pdf'
  const pdfPageImages = Array.isArray(options.pdfPageImages) ? options.pdfPageImages : []
  const selectedPdfPages = normalizePageNumbers(options.selectedPdfPages)
  const clientPdfText = trim(options.clientPdfText)
  const shouldUseSelectedPdfPages = isPdf && (selectedPdfPages.length || pdfPageImages.length || clientPdfText)
  const extraction = shouldUseSelectedPdfPages
    ? { text: '', source: 'pdf-selected-pages', pageCount: selectedPdfPages.length || pdfPageImages.length }
    : (isImage
        ? { text: await extractImageText(file.buffer, originalName), source: 'image-ocr', pageCount: 1 }
        : await extractCoursewareText(file.buffer, originalName))
  const extractedText = shouldUseSelectedPdfPages
    ? clientPdfText
    : (extraction.text || clientPdfText)
  const extractionSource = extractedText && shouldUseSelectedPdfPages
    ? 'pdf-selected-pages'
    : (extraction.text ? extraction.source : (clientPdfText ? 'browser-pdf-text' : extraction.source))

  return {
    name: originalName,
    mime,
    buffer: file.buffer,
    extractedText,
    extractionSource,
    ocrPageCount: extraction.pageCount || pdfPageImages.length || 0,
    selectedPdfPages,
    isImage,
    dataUrl: isImage ? `data:${mime};base64,${file.buffer.toString('base64')}` : '',
    visionImages: pdfPageImages.map((imageFile) => ({
      name: imageFile.originalname || 'pdf-page.jpg',
      mime: getMimeType(imageFile.originalname || 'pdf-page.jpg', imageFile.mimetype || 'image/jpeg'),
      dataUrl: `data:${getMimeType(imageFile.originalname || 'pdf-page.jpg', imageFile.mimetype || 'image/jpeg')};base64,${imageFile.buffer.toString('base64')}`
    })),
    imageSendAttempted: false,
    imageSendSucceeded: false,
    imageFallbackUsed: false
  }
}

function normalizePageNumbers(pageNumbers) {
  const list = Array.isArray(pageNumbers) ? pageNumbers : []
  return Array.from(new Set(
    list
      .map((pageNumber) => Number(pageNumber))
      .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0)
  )).sort((left, right) => left - right)
}

function hasCoursewareVisionImages(courseware) {
  return Boolean(courseware && getCoursewareVisionImages(courseware).length)
}

function getCoursewareVisionImages(courseware) {
  if (!courseware) return []

  const images = []
  if (courseware.isImage && courseware.dataUrl) {
    images.push({ dataUrl: courseware.dataUrl })
  }

  if (Array.isArray(courseware.visionImages)) {
    courseware.visionImages.forEach((image) => {
      if (image && image.dataUrl) images.push(image)
    })
  }

  return images
}

async function requestAI(payload, courseware, aiConfig) {
  if (aiConfig.provider === 'openai') {
    return requestOpenAI(payload, courseware, aiConfig)
  }

  if (aiConfig.provider === 'custom') {
    return requestChatCompatible(payload, courseware, aiConfig)
  }

  return requestDeepSeek(payload, courseware, aiConfig)
}

async function requestOpenAI(payload, courseware, aiConfig) {
  if (hasCoursewareVisionImages(courseware)) {
    courseware.imageSendAttempted = true
  }

  const body = {
    model: aiConfig.model,
    instructions: buildSystemPrompt(),
    input: [
      {
        role: 'user',
        content: buildUserContent(payload, courseware)
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'course_feedback_result',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            feedbacks: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  studentId: { type: 'string' },
                  name: { type: 'string' },
                  feedback: { type: 'string' },
                  templateFields: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      courseContent: { type: 'string' },
                      courseKnowledgePoint: { type: 'string' },
                      performanceText: { type: 'string' },
                      personalizedRemark: { type: 'string' },
                      learningSuggestion: { type: 'string' }
                    },
                    required: [
                      'courseContent',
                      'courseKnowledgePoint',
                      'performanceText',
                      'personalizedRemark',
                      'learningSuggestion'
                    ]
                  }
                },
                required: ['studentId', 'name', 'feedback', 'templateFields']
              }
            }
          },
          required: ['feedbacks']
        }
      }
    }
  }

  const response = await fetch(`${aiConfig.baseUrl}/responses`, withProxy({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aiConfig.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }))

  const text = await response.text()
  let parsed

  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`AI 返回无法解析：${text.slice(0, 200)}`)
  }

  if (!response.ok) {
    const message = parsed.error && parsed.error.message ? parsed.error.message : text
    throw new Error(`AI 请求失败：${message}`)
  }

  if (hasCoursewareVisionImages(courseware)) {
    courseware.imageSendSucceeded = true
  }

  return parsed
}

async function requestDeepSeek(payload, courseware, aiConfig) {
  return requestChatCompatible(payload, courseware, aiConfig, {
    responseFormat: true,
    thinkingDisabled: true,
    providerLabel: 'DeepSeek'
  })
}

async function requestChatCompatible(payload, courseware, aiConfig, options = {}) {
  if (!aiConfig.baseUrl) {
    throw new Error('请先在 .env 里填写 CUSTOM_BASE_URL，也就是对方提供的 API 端点 URL。')
  }

  const includeImage = hasCoursewareVisionImages(courseware)

  try {
    if (includeImage) {
      courseware.imageSendAttempted = true
      const response = await sendChatCompatibleRequest(
        buildChatCompatibleUserContent(payload, courseware, { includeImage: true }),
        aiConfig,
        options
      )
      courseware.imageSendSucceeded = true
      return response
    }

    return sendChatCompatibleRequest(
      buildChatCompatibleUserContent(payload, courseware, { includeImage: false }),
      aiConfig,
      options
    )
  } catch (error) {
    if (!includeImage || !isLikelyImageRequestError(error)) throw error

    courseware.imageSendSucceeded = false
    courseware.imageFallbackUsed = true

    return sendChatCompatibleRequest(
      buildChatCompatibleUserContent(payload, courseware, { includeImage: false }),
      aiConfig,
      options
    )
  }
}

async function sendChatCompatibleRequest(userContent, aiConfig, options = {}) {
  const body = {
    model: aiConfig.model,
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt()
      },
      {
        role: 'user',
        content: userContent
      }
    ],
    temperature: 0.2,
    max_tokens: 8000,
    stream: false
  }

  if (options.responseFormat !== false) {
    body.response_format = {
      type: 'json_object'
    }
  }

  if (options.thinkingDisabled) {
    body.thinking = {
      type: 'disabled'
    }
  }

  const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, withProxy({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aiConfig.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }))

  const text = await response.text()
  let parsed

  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${options.providerLabel || 'AI'} 返回无法解析：${text.slice(0, 200)}`)
  }

  if (!response.ok) {
    const message = parsed.error && parsed.error.message ? parsed.error.message : text
    throw new Error(`${options.providerLabel || 'AI'} 请求失败：${message}`)
  }

  return parsed
}

function buildSystemPrompt() {
  return [
    '你是一名严谨、温和、具体的课程反馈助手。',
    '你要根据老师提供的反馈模板、课程内容、课件和学生表现，为每个学生生成中文课后反馈。',
    '老师提供的反馈模板是最高优先级的输出格式；除非模板为空，否则必须按模板的段落、顺序、称呼方式和固定句生成。',
    '模板优先于默认字数限制；如果模板较长，可以适当超过 220 个汉字。',
    '反馈要像老师写给家长的文字，具体、自然、可直接复制发送。',
    '不能编造课件或课堂中没有依据的细节；课件信息不足时，用课程主题和老师备注生成稳妥反馈。',
    '每个学生反馈建议 120 到 220 个汉字。',
    '每一条反馈必须包含：1 个本节课/课件里的具体知识点，1 个该学生的课堂表现等级，若老师填写了备注则必须自然写入备注。',
    '一对一反馈里如果包含 personality 或 habit，要把它们作为长期档案背景，用自然、克制的方式融入建议，不要写得像诊断。',
    '不同学生的反馈必须根据 performance、remark、personality 和 habit 明显区分，不允许只替换姓名。'
  ].join('\n')
}

function buildUserContent(payload, courseware) {
  const content = [
    {
      type: 'input_text',
      text: [
        `课程类型：${payload.mode === 'oneOnOne' ? '一对一' : '班课'}`,
        `班级/课程：${payload.className || '未填写'}`,
        `年级：${payload.grade || '未填写'}`,
        `课程主题：${payload.lessonTitle || '未填写'}`,
        '',
        '老师提供的反馈模板：',
        payload.template || '请根据学生本节课表现生成反馈。',
        '',
        getTemplateRules(),
        '',
        '老师补充的课程内容：',
        payload.courseNote || '未填写',
        '',
        '学生表现数据 JSON：',
        JSON.stringify(payload.students, null, 2),
        '',
        '请严格返回 JSON，字段为 feedbacks，每项包含 studentId、name、feedback、templateFields。',
        'templateFields 必须包含 courseContent、courseKnowledgePoint、performanceText、personalizedRemark、learningSuggestion，用于程序填入老师模板。',
        'feedback 必须先套用老师模板，再结合课程内容、课件和该学生表现补全。',
        '每个 feedback 都必须明确体现对应学生的 performance；若 remark 非空，必须写入该学生 remark 的核心信息。',
        '一对一学生数据里若 personality 或 habit 非空，必须结合这些长期档案信息给出更贴合该学生的表达和建议。',
        '每个 feedback 至少写入 1 个本节课/课件中的具体知识点。',
        '不同学生不要套用完全相同的句子。',
        '返回 JSON 前逐条自检：每条 feedback 是否保留了模板结构和固定句；不符合就先重写再返回。'
      ].join('\n')
    }
  ]

  if (!courseware) return content

  if (courseware.extractedText) {
    const textLabel = getCoursewareTextLabel(courseware)

    content.push({
      type: 'input_text',
      text: [
        textLabel,
        courseware.extractedText
      ].join('\n')
    })
  }

  if (courseware.mime === 'application/pdf' && !courseware.selectedPdfPages.length) {
    content.push({
      type: 'input_file',
      filename: courseware.name,
      file_data: `data:${courseware.mime};base64,${courseware.buffer.toString('base64')}`
    })
  }

  if (courseware.mime.startsWith('image/')) {
    content.push({
      type: 'input_image',
      image_url: `data:${courseware.mime};base64,${courseware.buffer.toString('base64')}`,
      detail: 'auto'
    })
  }

  if (Array.isArray(courseware.visionImages)) {
    courseware.visionImages.forEach((image) => {
      content.push({
        type: 'input_image',
        image_url: image.dataUrl,
        detail: 'auto'
      })
    })
  }

  return content
}

function buildPlainPrompt(payload, courseware, options = {}) {
  const includeImage = options.includeImage !== false
  const coursewareLines = []

  if (courseware && courseware.extractedText) {
    coursewareLines.push(getCoursewareTextLabel(courseware))
    coursewareLines.push(courseware.extractedText)
    if (courseware.isImage && includeImage) {
      coursewareLines.push('图片本体也已作为视觉输入附在本消息中，请结合图片排版、题目和可见内容。')
    }
    if (!courseware.isImage && Array.isArray(courseware.visionImages) && courseware.visionImages.length && includeImage) {
      coursewareLines.push(`PDF ${getSelectedPdfPageLabel(courseware)}也已转成图片作为视觉输入附在本消息中，请结合图片页面里的题目和可见内容。`)
    }
  } else if (courseware && courseware.isImage) {
    coursewareLines.push(includeImage
      ? `老师上传了一张图片课件：${courseware.name}。图片已作为视觉输入附在本消息中，请直接阅读图片里的文字、题目、板书或页面内容。`
      : `老师上传了一张图片课件：${courseware.name}。当前没有识别到可用文字，请结合课程主题、补充内容、模板和学生表现生成稳妥反馈。`)
  } else if (courseware && Array.isArray(courseware.visionImages) && courseware.visionImages.length) {
    coursewareLines.push(includeImage
      ? `老师上传了 PDF 课件：${courseware.name}。系统已把 ${getSelectedPdfPageLabel(courseware)}转成图片并作为视觉输入附在本消息中，请直接阅读图片里的文字、题目、板书或页面内容。`
      : `老师上传了 PDF 课件：${courseware.name}。当前没有提取到可用文字，请结合课程主题、补充内容、模板和学生表现生成稳妥反馈。`)
  } else if (courseware) {
    coursewareLines.push(`老师上传了课件文件：${courseware.name}。当前接口没有提取到可用文字，请只结合课程主题、补充内容、模板和学生表现生成稳妥反馈。`)
  } else {
    coursewareLines.push('未上传课件。')
  }

  return [
    `课程类型：${payload.mode === 'oneOnOne' ? '一对一' : '班课'}`,
    `班级/课程：${payload.className || '未填写'}`,
    `年级：${payload.grade || '未填写'}`,
    `课程主题：${payload.lessonTitle || '未填写'}`,
    '',
    '老师提供的反馈模板：',
    payload.template || '请根据学生本节课表现生成反馈。',
    '',
    getTemplateRules(),
    '',
    '老师补充的课程内容：',
    payload.courseNote || '未填写',
    '',
    '课件内容：',
    coursewareLines.join('\n'),
    '',
    '学生表现数据 JSON：',
    JSON.stringify(payload.students, null, 2),
    '',
    '请严格返回 JSON，且只能返回 JSON，不要解释，不要使用 Markdown。',
    'JSON 格式必须是：{"feedbacks":[{"studentId":"...","name":"...","feedback":"...","templateFields":{"courseContent":"...","courseKnowledgePoint":"...","performanceText":"...","personalizedRemark":"...","learningSuggestion":"..."}}]}',
    'templateFields 会被程序填入老师模板，所以每个字段都必须针对该学生具体填写，不能空泛。',
    'feedback 必须先套用老师模板，再结合课程内容、课件和该学生表现补全。',
    '每个 feedback 都必须明确体现对应学生的 performance；若 remark 非空，必须写入该学生 remark 的核心信息。',
    '一对一学生数据里若 personality 或 habit 非空，必须结合这些长期档案信息给出更贴合该学生的表达和建议。',
    '每个 feedback 至少写入 1 个本节课/课件中的具体知识点。',
    '不同学生不要套用完全相同的句子。',
    '返回 JSON 前逐条自检：每条 feedback 是否保留了模板结构和固定句；不符合就先重写再返回。'
  ].join('\n')
}

function getTemplateRules() {
  return [
    '模板使用规则（必须遵守）：',
    '1. 反馈模板是每条 feedback 的正文骨架，不是参考风格。',
    '2. 必须尽量保留模板原有段落、句子顺序、称呼方式和固定文字；只替换模板里的占位符、括号提示或明显需要补充的位置。',
    '3. 常见占位符含义：{{学生姓名}}=当前学生姓名；{{课程内容}}/{{课程主题}}=课程主题、课件知识点和老师补充内容；{{课堂表现}}=该学生 performance；{{个性化备注}}/{{特殊情况}}=remark、personality 或 habit；{{学习建议}}=结合课堂表现给出的后续建议。',
    '4. 如果模板没有占位符，也必须按照模板原有句式和段落改写，不要另起一套反馈格式。',
    '5. 如果模板和默认字数要求冲突，以模板为准。'
  ].join('\n')
}

function getCoursewareTextLabel(courseware) {
  if (courseware.isImage) {
    return '从图片课件中识别到的文字如下，请优先结合这些内容生成反馈：'
  }

  if (courseware.extractionSource === 'pdf-selected-pages') {
    return `从 PDF ${getSelectedPdfPageLabel(courseware)}提取到的文字如下，请优先结合这些内容生成反馈：`
  }

  if (courseware.extractionSource === 'pdf-ocr') {
    return `从图片版 PDF 前 ${courseware.ocrPageCount || 0} 页识别到的文字如下，请优先结合这些内容生成反馈：`
  }

  return '从课件中提取到的文字如下，请优先结合这些内容生成反馈：'
}

function getSelectedPdfPageLabel(courseware) {
  const selectedPages = Array.isArray(courseware.selectedPdfPages) ? courseware.selectedPdfPages : []
  if (selectedPages.length) return `所选第 ${formatNumberRanges(selectedPages)} 页`

  const imageCount = Array.isArray(courseware.visionImages) ? courseware.visionImages.length : 0
  if (imageCount) return `所选 ${imageCount} 页`

  return '所选页面'
}

function formatNumberRanges(numbers) {
  const sortedNumbers = Array.from(new Set(numbers))
    .map((number) => Number(number))
    .filter((number) => Number.isInteger(number))
    .sort((left, right) => left - right)
  const ranges = []
  let start = null
  let end = null

  sortedNumbers.forEach((number) => {
    if (start === null) {
      start = number
      end = number
      return
    }

    if (number === end + 1) {
      end = number
      return
    }

    ranges.push(start === end ? String(start) : `${start}-${end}`)
    start = number
    end = number
  })

  if (start !== null) ranges.push(start === end ? String(start) : `${start}-${end}`)
  return ranges.join('、')
}

function buildChatCompatibleUserContent(payload, courseware, options = {}) {
  const includeImage = options.includeImage !== false
  const text = buildPlainPrompt(payload, courseware, { includeImage })
  const images = getCoursewareVisionImages(courseware)

  if (!includeImage || !images.length) {
    return text
  }

  return [
    {
      type: 'text',
      text
    },
    ...images.map((image) => ({
      type: 'image_url',
      image_url: {
        url: image.dataUrl
      }
    }))
  ]
}

async function buildQuestionPageInputs(pageFiles) {
  const pages = []

  for (const [index, file] of pageFiles.entries()) {
    const name = file.originalname || `page-${index + 1}.jpg`
    const mime = getMimeType(name, file.mimetype || 'image/jpeg')
    const ocrText = await extractImageText(file.buffer, name)

    pages.push({
      pageIndex: index,
      name,
      mime,
      ocrText,
      dataUrl: `data:${mime};base64,${file.buffer.toString('base64')}`
    })
  }

  return pages
}

async function recognizeQuestionList(payload, pages, docTexts, aiConfig) {
  const pageOcrTexts = pages
    .filter((page) => page.ocrText)
    .map((page) => ({
      name: page.name,
      text: truncateText(page.ocrText)
    }))
  const baseDocTexts = [...docTexts, ...pageOcrTexts]

  if (!pages.length) {
    const aiResponse = await requestQuestionRecognition(payload, [], baseDocTexts, aiConfig)
    return parseQuestionRecognitionResponse(aiResponse, aiConfig.provider).questions
  }

  const allQuestions = []
  const batches = chunkArray(pages, QUESTION_RECOGNITION_BATCH_SIZE)

  for (const [batchIndex, batchPages] of batches.entries()) {
    const batchPayload = {
      ...payload,
      pageBatchLabel: `第 ${batchIndex + 1}/${batches.length} 批`,
      pageBatchNames: batchPages.map((page) => page.name)
    }
    const batchDocTexts = [
      ...docTexts,
      ...batchPages
        .filter((page) => page.ocrText)
        .map((page) => ({
          name: page.name,
          text: truncateText(page.ocrText)
        }))
    ]
    const aiResponse = await requestQuestionRecognitionWithFallback(batchPayload, batchPages, batchDocTexts, aiConfig)
    const parsed = parseQuestionRecognitionResponse(aiResponse, aiConfig.provider)

    if (Array.isArray(parsed.questions)) {
      allQuestions.push(...parsed.questions)
    }
  }

  return allQuestions
}

async function requestQuestionRecognitionWithFallback(payload, pages, docTexts, aiConfig) {
  try {
    return await requestQuestionRecognition(payload, pages, docTexts, aiConfig)
  } catch (error) {
    const hasTextFallback = Array.isArray(docTexts) && docTexts.some((item) => item && item.text)
    if (!pages.length || !hasTextFallback || !isLikelyImageRequestError(error)) throw error

    return requestQuestionRecognition(payload, [], docTexts, aiConfig)
  }
}

async function requestQuestionRecognition(payload, pages, docTexts, aiConfig) {
  if (aiConfig.provider === 'openai') {
    return requestOpenAIQuestionRecognition(payload, pages, docTexts, aiConfig)
  }

  return requestChatQuestionRecognition(payload, pages, docTexts, aiConfig, {
    providerLabel: aiConfig.provider === 'deepseek' ? 'DeepSeek' : 'AI'
  })
}

async function requestOpenAIQuestionRecognition(payload, pages, docTexts, aiConfig) {
  const content = buildQuestionRecognitionContent(payload, pages, docTexts, 'responses')
  const body = {
    model: aiConfig.model,
    instructions: buildQuestionRecognitionSystemPrompt(),
    input: [
      {
        role: 'user',
        content
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'question_rearrange_result',
        strict: true,
        schema: getQuestionRecognitionJsonSchema()
      }
    }
  }

  const response = await fetch(`${aiConfig.baseUrl}/responses`, withProxy({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aiConfig.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }))
  const text = await response.text()
  const parsed = parseProviderResponseJson(text, 'AI')
  if (!response.ok) {
    const message = parsed.error && parsed.error.message ? parsed.error.message : text
    throw new Error(`AI 请求失败：${message}`)
  }
  return parsed
}

async function requestChatQuestionRecognition(payload, pages, docTexts, aiConfig, options = {}) {
  const body = {
    model: aiConfig.model,
    messages: [
      {
        role: 'system',
        content: buildQuestionRecognitionSystemPrompt()
      },
      {
        role: 'user',
        content: buildQuestionRecognitionContent(payload, pages, docTexts, 'chat')
      }
    ],
    temperature: 0.1,
    max_tokens: 8000,
    stream: false,
    response_format: {
      type: 'json_object'
    }
  }

  const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, withProxy({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aiConfig.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }))
  const text = await response.text()
  const parsed = parseProviderResponseJson(text, options.providerLabel || 'AI')
  if (!response.ok) {
    const message = parsed.error && parsed.error.message ? parsed.error.message : text
    throw new Error(`${options.providerLabel || 'AI'} 请求失败：${message}`)
  }
  return parsed
}

function buildQuestionRecognitionSystemPrompt() {
  return [
    '你是一名严谨的试卷题目结构化助手。',
    '你要从老师上传的试卷页面或 Word 文本中识别题目，并整理成可重新排版的结构化 JSON。',
    '必须尽量保留原题文字、数学符号、编号、选项顺序和题目含义。',
    '如果页面中有图形、表格、函数图像、几何图或统计图，请在 figureNote 中用简短中文描述，不要编造图中没有的信息。',
    '如果无法确定答案或解析，可以留空。',
    '只返回 JSON，不要使用 Markdown，不要解释。'
  ].join('\n')
}

function buildQuestionRecognitionContent(payload, pages, docTexts, target) {
  const text = [
    `试卷标题：${payload.title || '未命名试卷'}`,
    `上传文件：${Array.isArray(payload.files) ? payload.files.map((file) => file.name).join('、') : '未填写'}`,
    `当前识别批次：${payload.pageBatchLabel || '全部页面'}`,
    `当前发送页面：${Array.isArray(payload.pageBatchNames) && payload.pageBatchNames.length ? payload.pageBatchNames.join('、') : (pages.length ? pages.map((page) => page.name).join('、') : '无')}`,
    '',
    '识别要求：',
    '1. 将试卷拆分成独立题目。',
    '2. 每道题返回 number、stemMarkdown、options、figureNote、answer、analysis。',
    '3. 选择题选项放入 options 数组，每个选项保留 A. / B. / C. / D. 等标记。',
    '4. 非选择题 options 为空数组。',
    '5. stemMarkdown 可以包含简单 LaTeX 或普通数学符号，但不要添加题目里没有的内容。',
    '6. 如果题目跨页，请合并成一道题。',
    '',
    'Word 文本内容：',
    docTexts.length
      ? docTexts.map((item) => `文件：${item.name}\n${item.text}`).join('\n\n---\n\n')
      : '无',
    '',
    '请严格返回 JSON，格式为：',
    '{"questions":[{"id":"q1","number":"1","stemMarkdown":"题干","options":["A. ...","B. ..."],"figureNote":"","answer":"","analysis":""}],"warnings":[]}'
  ].join('\n')

  if (target === 'responses') {
    const content = [{ type: 'input_text', text }]
    pages.forEach((page) => {
      content.push({
        type: 'input_image',
        image_url: page.dataUrl,
        detail: 'high'
      })
    })
    return content
  }

  if (!pages.length) return text

  return [
    { type: 'text', text },
    ...pages.map((page) => ({
      type: 'image_url',
      image_url: {
        url: page.dataUrl
      }
    }))
  ]
}

function getQuestionRecognitionJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            number: { type: 'string' },
            stemMarkdown: { type: 'string' },
            options: {
              type: 'array',
              items: { type: 'string' }
            },
            figureNote: { type: 'string' },
            answer: { type: 'string' },
            analysis: { type: 'string' }
          },
          required: ['id', 'number', 'stemMarkdown', 'options', 'figureNote', 'answer', 'analysis']
        }
      },
      warnings: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['questions', 'warnings']
  }
}

function parseQuestionRecognitionResponse(response, provider) {
  if (provider === 'deepseek' || provider === 'custom') {
    const content = response.choices && response.choices[0] && response.choices[0].message
      ? response.choices[0].message.content
      : ''
    return parseJsonText(content)
  }

  if (response.output_text) {
    return parseJsonText(response.output_text)
  }

  const output = Array.isArray(response.output) ? response.output : []
  const text = output.flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((part) => part.text || '')
    .filter(Boolean)
    .join('\n')

  return parseJsonText(text)
}

function extractQuestionSourceText(file) {
  const name = file.originalname || 'source'
  const mime = getMimeType(name, file.mimetype)

  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return {
      name,
      text: truncateText(extractDocxText(file.buffer))
    }
  }

  if (mime === 'text/plain' || mime === 'text/markdown') {
    return {
      name,
      text: truncateText(file.buffer.toString('utf8'))
    }
  }

  return {
    name,
    text: ''
  }
}

function chunkArray(list, size) {
  const chunkSize = Math.max(1, Number(size) || 1)
  const chunks = []

  for (let index = 0; index < list.length; index += chunkSize) {
    chunks.push(list.slice(index, index + chunkSize))
  }

  return chunks
}

function normalizeQuestions(questions) {
  const list = Array.isArray(questions) ? questions : []
  return list.map((question, index) => {
    const item = question && typeof question === 'object' ? question : {}
    const options = Array.isArray(item.options)
      ? item.options.map((option) => trim(option)).filter(Boolean)
      : []

    return {
      id: trim(item.id) || `q-${index + 1}`,
      number: trim(item.number) || String(index + 1),
      stemMarkdown: trim(item.stemMarkdown || item.stem),
      options,
      figureNote: trim(item.figureNote || item.figureDescription),
      answer: trim(item.answer),
      analysis: trim(item.analysis)
    }
  }).filter((question) => question.stemMarkdown || question.options.length || question.figureNote)
}

function buildDemoQuestions(payload, docTexts) {
  const text = docTexts.map((item) => item.text).join('\n').trim()
  if (text) {
    return [{
      id: 'demo-q1',
      number: '1',
      stemMarkdown: text.slice(0, 180),
      options: [],
      figureNote: '',
      answer: '',
      analysis: ''
    }]
  }

  return [{
    id: 'demo-q1',
    number: '1',
    stemMarkdown: `${payload.title || '本试卷'}示例题：请根据上传页面识别题干内容。`,
    options: ['A. 选项一', 'B. 选项二', 'C. 选项三', 'D. 选项四'],
    figureNote: '演示模式未调用 AI。',
    answer: '',
    analysis: ''
  }]
}

function buildQuestionDocx(title, questions) {
  const zip = new AdmZip()

  zip.addFile('[Content_Types].xml', Buffer.from(buildDocxContentTypes(), 'utf8'))
  zip.addFile('_rels/.rels', Buffer.from(buildDocxRootRels(), 'utf8'))
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(buildDocxDocumentRels(), 'utf8'))
  zip.addFile('word/styles.xml', Buffer.from(buildQuestionStylesXml(), 'utf8'))
  zip.addFile('word/document.xml', Buffer.from(buildQuestionDocumentXml(title, questions), 'utf8'))

  return zip.toBuffer()
}

function buildQuestionDocumentXml(title, questions) {
  const paragraphs = [
    buildDocxParagraph(title || '题卷重排', {
      style: 'Title',
      align: 'center',
      bold: true,
      size: 32,
      after: 260
    })
  ]

  questions.forEach((question, index) => {
    const number = trim(question.number) || String(index + 1)
    const stemLines = splitDocxLines(question.stemMarkdown)
    const firstStemLine = stemLines.shift() || ''

    paragraphs.push(buildDocxParagraph(`${number}. ${firstStemLine}`.trim(), {
      style: 'Question',
      bold: true,
      after: stemLines.length ? 80 : 120
    }))

    stemLines.forEach((line) => {
      paragraphs.push(buildDocxParagraph(line, {
        indent: 420,
        after: 80
      }))
    })

    ;(question.options || []).forEach((option) => {
      paragraphs.push(buildDocxParagraph(cleanQuestionDocText(option), {
        indent: 420,
        after: 80
      }))
    })

    if (question.figureNote) {
      paragraphs.push(buildDocxParagraph(`图形说明：${cleanQuestionDocText(question.figureNote)}`, {
        indent: 420,
        color: '666666',
        after: 80
      }))
    }

    if (question.answer) {
      paragraphs.push(buildDocxParagraph(`答案：${cleanQuestionDocText(question.answer)}`, {
        indent: 420,
        after: 80
      }))
    }

    if (question.analysis) {
      paragraphs.push(buildDocxParagraph(`解析：${cleanQuestionDocText(question.analysis)}`, {
        indent: 420,
        after: 80
      }))
    }

    if (index < questions.length - 1) {
      paragraphs.push(buildDocxParagraph('', { after: 120 }))
    }
  })

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:linePitch="312"/>
    </w:sectPr>
  </w:body>
</w:document>`
}

function buildDocxParagraph(text, options = {}) {
  const cleanText = cleanQuestionDocText(text)
  const paragraphProperties = buildDocxParagraphProperties(options)

  if (!cleanText) {
    return `<w:p>${paragraphProperties}</w:p>`
  }

  return `<w:p>${paragraphProperties}<w:r>${buildDocxRunProperties(options)}<w:t xml:space="preserve">${escapeDocxXml(cleanText)}</w:t></w:r></w:p>`
}

function buildDocxParagraphProperties(options = {}) {
  const props = []

  if (options.style) props.push(`<w:pStyle w:val="${escapeDocxXml(options.style)}"/>`)
  if (options.align) props.push(`<w:jc w:val="${escapeDocxXml(options.align)}"/>`)
  if (options.indent) props.push(`<w:ind w:left="${Math.max(0, Number(options.indent) || 0)}"/>`)

  const after = Number.isFinite(Number(options.after)) ? Number(options.after) : 120
  props.push(`<w:spacing w:after="${Math.max(0, after)}" w:line="312" w:lineRule="auto"/>`)

  return props.length ? `<w:pPr>${props.join('')}</w:pPr>` : ''
}

function buildDocxRunProperties(options = {}) {
  const props = [
    '<w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial" w:cs="Arial"/>'
  ]
  const size = Math.max(18, Number(options.size) || 22)

  props.push(`<w:sz w:val="${size}"/>`)
  props.push(`<w:szCs w:val="${size}"/>`)
  if (options.bold) props.push('<w:b/><w:bCs/>')
  if (options.color) props.push(`<w:color w:val="${escapeDocxXml(options.color)}"/>`)

  return `<w:rPr>${props.join('')}</w:rPr>`
}

function splitDocxLines(text) {
  return cleanQuestionDocText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function cleanQuestionDocText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '[图示]')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeDocxXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildDocxContentTypes() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`
}

function buildDocxRootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
}

function buildDocxDocumentRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
}

function buildQuestionStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial" w:cs="Arial"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:spacing w:after="120" w:line="312" w:lineRule="auto"/>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:after="260"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:bCs/>
      <w:sz w:val="32"/>
      <w:szCs w:val="32"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Question">
    <w:name w:val="Question"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:bCs/>
    </w:rPr>
  </w:style>
</w:styles>`
}

function buildDebugSummary(payload, courseware) {
  const remarksCount = payload.students.filter((student) => student.remark).length
  const performanceCounts = payload.students.reduce((counts, student) => {
    counts[student.performance] = (counts[student.performance] || 0) + 1
    return counts
  }, {})

  return {
    studentCount: payload.students.length,
    remarksCount,
    performanceCounts,
    coursewareName: courseware ? courseware.name : '',
    coursewareMime: courseware ? courseware.mime : '',
    coursewareIsImage: Boolean(courseware && courseware.isImage),
    coursewareImageAttempted: Boolean(courseware && courseware.imageSendAttempted),
    coursewareSentAsImage: Boolean(courseware && courseware.imageSendSucceeded),
    coursewareImageFallbackUsed: Boolean(courseware && courseware.imageFallbackUsed),
    coursewareVisionImageCount: courseware && Array.isArray(courseware.visionImages) ? courseware.visionImages.length : 0,
    coursewareSelectedPdfPages: courseware && Array.isArray(courseware.selectedPdfPages) ? courseware.selectedPdfPages : [],
    coursewareExtractionSource: courseware ? courseware.extractionSource : '',
    coursewareOcrPageCount: courseware ? courseware.ocrPageCount : 0,
    coursewareTextLength: courseware && courseware.extractedText ? courseware.extractedText.length : 0,
    coursewareTextPreview: courseware && courseware.extractedText ? courseware.extractedText.slice(0, 180) : ''
  }
}

function isLikelyImageRequestError(error) {
  const message = error && error.message ? error.message.toLowerCase() : ''
  return message.includes('<!doctype html')
    || message.includes('image')
    || message.includes('unsupported')
    || message.includes('invalid')
    || message.includes('无法解析')
}

function parseFeedbackResponse(response, provider) {
  if (provider === 'deepseek' || provider === 'custom') {
    const content = response.choices && response.choices[0] && response.choices[0].message
      ? response.choices[0].message.content
      : ''

    return parseJsonText(content)
  }

  if (response.output_text) {
    return parseJsonText(response.output_text)
  }

  const output = Array.isArray(response.output) ? response.output : []
  const text = output.flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((part) => part.text || '')
    .filter(Boolean)
    .join('\n')

  return parseJsonText(text)
}

function parseJsonText(text) {
  const cleanText = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/```$/i, '')
    .trim()

  const parsed = tryParseJson(cleanText)
  if (parsed) return parsed

  const jsonText = extractFirstJsonObject(cleanText)
  if (jsonText) {
    const extracted = tryParseJson(jsonText)
    if (extracted) return extracted
  }

  return { feedbacks: [], questions: [] }
}

function parseProviderResponseJson(text, providerLabel) {
  const parsed = tryParseJson(text)
  if (parsed) return parsed

  throw new Error(buildNonJsonAIResponseMessage(text, providerLabel))
}

function tryParseJson(text) {
  try {
    return JSON.parse(String(text || '').trim())
  } catch (error) {
    return null
  }
}

function extractFirstJsonObject(text) {
  const source = String(text || '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')

  if (start < 0 || end <= start) return ''
  return source.slice(start, end + 1)
}

function buildNonJsonAIResponseMessage(text, providerLabel) {
  const rawText = String(text || '')
  const plainText = rawText
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const snippet = (plainText || rawText).slice(0, 160)

  if (/^\s*</.test(rawText)) {
    return `${providerLabel} 接口没有返回 JSON，通常是 API 地址、模型渠道或图片识别能力不匹配。请检查测试版 AI 配置，或减少 PDF 页数后重试。`
  }

  return `${providerLabel} 返回无法解析：${snippet || '空响应'}`
}

function normalizeFeedbacks(feedbacks, students, payload = {}) {
  const list = Array.isArray(feedbacks) ? feedbacks : []

  return students.map((student) => {
    const matched = list.find((item) => item.studentId === student.id || item.name === student.name)
    const fallback = buildFallbackFeedback(student, payload)
    const modelFeedback = trim(matched && matched.feedback) || fallback
    const templatedFeedback = applyFeedbackTemplate(payload.template, student, payload, matched, modelFeedback)

    return {
      studentId: student.id,
      name: student.name,
      feedback: templatedFeedback || modelFeedback
    }
  })
}

function buildDemoFeedbacks(payload) {
  return payload.students.map((student) => ({
    studentId: student.id,
    name: student.name,
    feedback: applyFeedbackTemplate(payload.template, student, payload, null, buildFallbackFeedback(student, payload))
      || buildFallbackFeedback(student, payload)
  }))
}

function applyFeedbackTemplate(template, student, payload, aiItem, modelFeedback) {
  const rawTemplate = trim(template)
  if (!rawTemplate || !hasTemplatePlaceholder(rawTemplate)) return ''

  const fields = normalizeTemplateFields(aiItem && aiItem.templateFields, student, payload, modelFeedback)

  return rawTemplate.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, key) => {
    return getTemplateValue(key, fields, student, payload, modelFeedback) || ''
  }).trim()
}

function hasTemplatePlaceholder(template) {
  return /\{\{\s*[^}]+?\s*\}\}/.test(template)
}

function normalizeTemplateFields(rawFields = {}, student, payload = {}, modelFeedback = '') {
  const fields = rawFields && typeof rawFields === 'object' ? rawFields : {}
  const courseContentFallback = buildCourseContentFallback(payload)
  const performanceFallback = buildPerformanceFallback(student)
  const personalizedFallback = buildPersonalizedFallback(student)

  return {
    courseContent: trim(fields.courseContent) || courseContentFallback,
    courseKnowledgePoint: trim(fields.courseKnowledgePoint) || courseContentFallback,
    performanceText: trim(fields.performanceText) || performanceFallback,
    personalizedRemark: trim(fields.personalizedRemark) || personalizedFallback,
    learningSuggestion: trim(fields.learningSuggestion) || buildAdviceFallback(student),
    modelFeedback: trim(modelFeedback)
  }
}

function getTemplateValue(key, fields, student, payload, modelFeedback) {
  const normalizedKey = trim(key).replace(/\s+/g, '')

  if (['学生姓名', '姓名', '学生'].includes(normalizedKey)) return student.name
  if (['年级'].includes(normalizedKey)) return payload.grade || ''
  if (['班级', '班级名称', '课程'].includes(normalizedKey)) return payload.className || ''
  if (['课程主题', '主题'].includes(normalizedKey)) return payload.lessonTitle || fields.courseContent
  if (['课程内容', '本节课内容'].includes(normalizedKey)) return fields.courseContent
  if (['知识点', '具体知识点', '课件知识点'].includes(normalizedKey)) return fields.courseKnowledgePoint
  if (['课堂表现', '表现', '课堂状态'].includes(normalizedKey)) return fields.performanceText
  if (['个性化备注', '特殊情况', '备注', '学生情况'].includes(normalizedKey)) return fields.personalizedRemark
  if (['学习建议', '后续建议', '建议', '提升建议'].includes(normalizedKey)) return fields.learningSuggestion
  if (['完整反馈', '反馈内容'].includes(normalizedKey)) return fields.modelFeedback || modelFeedback

  if (normalizedKey.includes('姓名')) return student.name
  if (normalizedKey.includes('年级')) return payload.grade || ''
  if (normalizedKey.includes('班级')) return payload.className || ''
  if (normalizedKey.includes('主题')) return payload.lessonTitle || fields.courseContent
  if (normalizedKey.includes('内容')) return fields.courseContent
  if (normalizedKey.includes('知识')) return fields.courseKnowledgePoint
  if (normalizedKey.includes('表现') || normalizedKey.includes('状态')) return fields.performanceText
  if (normalizedKey.includes('备注') || normalizedKey.includes('情况')) return fields.personalizedRemark
  if (normalizedKey.includes('建议') || normalizedKey.includes('提升')) return fields.learningSuggestion

  return fields.modelFeedback || modelFeedback
}

function buildCourseContentFallback(payload = {}) {
  return [
    payload.lessonTitle ? `“${payload.lessonTitle}”` : '',
    payload.courseNote ? payload.courseNote : ''
  ].filter(Boolean).join('，') || '本节课重点内容'
}

function buildPerformanceFallback(student) {
  const remark = student.remark ? `，${student.remark}` : ''
  return `${student.performance || '表现良好'}${remark}`
}

function buildPersonalizedFallback(student) {
  return [
    student.remark,
    student.personality ? `平时性格：${student.personality}` : '',
    student.habit ? `做题习惯：${student.habit}` : ''
  ].filter(Boolean).join('；') || '本节课整体状态稳定'
}

function buildAdviceFallback(student) {
  if (student.performance === '表现较差') {
    return '建议课后先回到基础概念和典型例题，按步骤完成订正，再做少量同类题巩固。'
  }

  if (student.performance === '表现优秀') {
    return '建议继续保持课堂参与度，课后整理本节课关键方法，并尝试更有挑战的变式题。'
  }

  return '建议课后及时整理本节课重点和错题，保持稳定练习节奏。'
}

function buildFallbackFeedback(student, payload = {}) {
  const lesson = payload.lessonTitle ? `本节课围绕“${payload.lessonTitle}”展开，` : '本节课整体学习状态较为清晰，'
  const remark = student.remark ? `课堂中特别需要关注的是：${student.remark}。` : ''
  const advice = student.performance === '表现较差'
    ? '后续建议先把基础概念和典型题步骤补扎实，课后用少量高频题巩固。'
    : '后续建议继续整理本节课重点和错题，保持稳定练习节奏。'

  return `${student.name}同学${lesson}${student.performance}。${remark}${advice}`
}

async function extractCoursewareText(buffer, fileName) {
  const lowerName = String(fileName || '').toLowerCase()

  if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) {
    return {
      text: truncateText(buffer.toString('utf8')),
      source: 'plain-text',
      pageCount: 0
    }
  }

  if (lowerName.endsWith('.docx')) {
    return {
      text: truncateText(extractDocxText(buffer)),
      source: 'docx-text',
      pageCount: 0
    }
  }

  if (lowerName.endsWith('.pptx')) {
    return {
      text: truncateText(extractPptxText(buffer)),
      source: 'pptx-text',
      pageCount: 0
    }
  }

  if (lowerName.endsWith('.pdf')) {
    return extractPdfText(buffer)
  }

  return {
    text: '',
    source: 'unsupported',
    pageCount: 0
  }
}

async function extractImageText(buffer, fileName) {
  const ocrCommand = getOcrCommand()

  if (!ocrCommand) {
    return ''
  }

  const extension = path.extname(String(fileName || '')).toLowerCase() || '.png'
  const tempPath = path.join(
    os.tmpdir(),
    `course-feedback-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`
  )

  try {
    fs.writeFileSync(tempPath, buffer)
    const result = await execFileAsync(ocrCommand.command, [...ocrCommand.args, tempPath], {
      timeout: 25000,
      maxBuffer: 1024 * 1024
    })

    return truncateText(result.stdout || '')
  } catch (error) {
    return ''
  } finally {
    try {
      fs.unlinkSync(tempPath)
    } catch (error) {
      // Temp cleanup failure does not affect feedback generation.
    }
  }
}

async function extractPdfImageText(buffer) {
  const pdftoppmPath = getPdftoppmPath()
  const ocrCommand = getOcrCommand()

  if (!pdftoppmPath || !ocrCommand) {
    return {
      text: '',
      pageCount: 0
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'course-feedback-pdf-'))
  const pdfPath = path.join(tempDir, 'courseware.pdf')
  const outputPrefix = path.join(tempDir, 'page')

  try {
    fs.writeFileSync(pdfPath, buffer)

    await execFileAsync(pdftoppmPath, [
      '-png',
      '-r',
      '180',
      '-f',
      '1',
      '-l',
      '12',
      pdfPath,
      outputPrefix
    ], {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    })

    const pageFiles = fs.readdirSync(tempDir)
      .filter((name) => /^page-\d+\.png$/.test(name))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))

    const pageTexts = []

    for (const [index, pageFile] of pageFiles.entries()) {
      const pagePath = path.join(tempDir, pageFile)
      const text = await runOcrOnImageFile(pagePath)
      if (text) pageTexts.push(`第${index + 1}页：${text}`)
    }

    return {
      text: truncateText(pageTexts.join('\n\n')),
      pageCount: pageFiles.length
    }
  } catch (error) {
    return {
      text: '',
      pageCount: 0
    }
  } finally {
    fs.rmSync(tempDir, {
      recursive: true,
      force: true
    })
  }
}

async function runOcrOnImageFile(imagePath) {
  const ocrCommand = getOcrCommand()

  if (!ocrCommand) return ''

  try {
    const result = await execFileAsync(ocrCommand.command, [...ocrCommand.args, imagePath], {
      timeout: 25000,
      maxBuffer: 1024 * 1024
    })

    return String(result.stdout || '').trim()
  } catch (error) {
    return ''
  }
}

function getOcrCommand() {
  if (process.platform === 'darwin' && fs.existsSync(OCR_BINARY_PATH)) {
    return {
      command: OCR_BINARY_PATH,
      args: []
    }
  }

  if (fs.existsSync('/usr/bin/swift') && fs.existsSync(OCR_SCRIPT_PATH)) {
    return {
      command: '/usr/bin/swift',
      args: [OCR_SCRIPT_PATH]
    }
  }

  return null
}

function getPdftoppmPath() {
  return PDFTOPPM_PATHS.find((candidate) => fs.existsSync(candidate)) || ''
}

async function extractPdfText(buffer) {
  let embeddedText = ''

  try {
    const result = await pdfParse(buffer)
    embeddedText = truncateText(result.text || '')
  } catch (error) {
    embeddedText = ''
  }

  if (embeddedText.length >= 40) {
    return {
      text: embeddedText,
      source: 'pdf-text',
      pageCount: 0
    }
  }

  const ocrResult = await extractPdfImageText(buffer)

  if (ocrResult.text) {
    return {
      text: ocrResult.text,
      source: 'pdf-ocr',
      pageCount: ocrResult.pageCount
    }
  }

  return {
    text: embeddedText,
    source: embeddedText ? 'pdf-text-short' : 'pdf-empty',
    pageCount: 0
  }
}

function extractDocxText(buffer) {
  try {
    const zip = new AdmZip(buffer)
    const entry = zip.getEntry('word/document.xml')

    if (!entry) return ''
    return xmlToText(entry.getData().toString('utf8'))
  } catch (error) {
    return ''
  }
}

function extractPptxText(buffer) {
  try {
    const zip = new AdmZip(buffer)
    const entries = zip.getEntries()
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName, 'zh-Hans-CN', { numeric: true }))

    return entries
      .map((entry, index) => {
        const text = xmlToText(entry.getData().toString('utf8'))
        return text ? `第${index + 1}页：${text}` : ''
      })
      .filter(Boolean)
      .join('\n')
  } catch (error) {
    return ''
  }
}

function xmlToText(xml) {
  return String(xml || '')
    .replace(/<a:br\s*\/>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim()
}

function truncateText(text) {
  const cleanText = String(text || '').trim()
  const maxLength = 22000

  if (cleanText.length <= maxLength) return cleanText
  return `${cleanText.slice(0, maxLength)}\n\n[课件内容较长，后文已截断]`
}

function getMimeType(name, fallback) {
  const lowerName = String(name || '').toLowerCase()

  if (lowerName.endsWith('.pdf')) return 'application/pdf'
  if (lowerName.endsWith('.txt')) return 'text/plain'
  if (lowerName.endsWith('.md')) return 'text/markdown'
  if (lowerName.endsWith('.png')) return 'image/png'
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerName.endsWith('.webp')) return 'image/webp'
  if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lowerName.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

  return fallback || 'application/octet-stream'
}

function trim(value) {
  return String(value || '').trim()
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(trim(value).toLowerCase())
}

function parseDailyLimit(value) {
  const limit = Number(value || 10)
  if (!Number.isFinite(limit)) return 10
  return Math.max(1, Math.floor(limit))
}

function withProxy(options) {
  if (!proxyAgent) return options
  return {
    ...options,
    dispatcher: proxyAgent
  }
}

function getUserFacingError(error) {
  const message = error && error.message ? error.message : ''
  const causeCode = error && error.cause && error.cause.code ? error.cause.code : ''

  if (message.includes('fetch failed') || causeCode === 'UND_ERR_CONNECT_TIMEOUT') {
    return '连接 AI 服务超时。你的配置已读取到，但当前网络访问 api.openai.com 不通，请开启可访问 OpenAI 的网络/代理后重试。'
  }

  return message || '生成失败'
}
