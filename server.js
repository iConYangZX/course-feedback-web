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
const MAX_UPLOAD_FILE_SIZE_BYTES = 20 * 1024 * 1024
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES
  }
})

const PORT = Number(process.env.PORT || 5177)
const DEFAULT_PROVIDER = 'openai'
const ENV_PATH = path.join(__dirname, '.env')
const LEGACY_DATA_DIR = path.join(__dirname, 'data')
const DATA_DIR = resolveDataDir()
const USAGE_PATH = path.join(DATA_DIR, 'usage.json')
const ACCOUNTS_PATH = path.join(DATA_DIR, 'accounts.json')
const FEEDBACK_DATA_PATH = path.join(DATA_DIR, 'feedback-data.json')
const MATERIAL_INDEX_PATH = path.join(DATA_DIR, 'materials.json')
const MATERIAL_FILES_DIR = path.join(DATA_DIR, 'material-files')
const LEGACY_USAGE_PATH = path.join(LEGACY_DATA_DIR, 'usage.json')
const LEGACY_ACCOUNTS_PATH = path.join(LEGACY_DATA_DIR, 'accounts.json')
const OCR_BINARY_PATH = path.join(__dirname, 'scripts', 'ocr_image')
const OCR_SCRIPT_PATH = path.join(__dirname, 'scripts', 'ocr_image.swift')
const PDFTOPPM_PATHS = [
  '/Users/icon/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm',
  '/Users/icon/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/bin/pdftoppm',
  '/Users/icon/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/bin/pdftoppm',
  '/opt/homebrew/bin/pdftoppm',
  '/usr/local/bin/pdftoppm'
]
const DATABASE_URL = trim(process.env.DATABASE_URL)
const proxyUrl = trim(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY)
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : null
const PUBLIC_MODE = parseBoolean(process.env.PUBLIC_MODE)
const ACCESS_CODE = trim(process.env.ACCESS_CODE)
const DAILY_LIMIT = parseDailyLimit(process.env.DAILY_LIMIT)
const SESSION_COOKIE = 'course_feedback_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
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
let databasePool = null
let usageState = {}
let accountState = { users: [] }
let feedbackDataState = { owners: {} }
let materialState = { items: [] }

app.use(express.json({ limit: '1mb' }))
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
    storage: getStorageStatus(),
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

app.post('/api/admin/users', requireAdminMiddleware, async (req, res) => {
  try {
    const account = createAccount(req.body || {})
    await writeAccountState()
    res.json({
      ok: true,
      user: getAccountForAdmin(account)
    })
  } catch (error) {
    res.status(400).json({ error: error.message || '创建账号失败' })
  }
})

app.patch('/api/admin/users/:userId', requireAdminMiddleware, async (req, res) => {
  try {
    const account = updateAccount(req.params.userId, req.body || {})
    await writeAccountState()
    res.json({
      ok: true,
      user: getAccountForAdmin(account)
    })
  } catch (error) {
    res.status(400).json({ error: error.message || '保存账号失败' })
  }
})

app.delete('/api/admin/users/:userId', requireAdminMiddleware, async (req, res) => {
  try {
    const account = deleteAccount(req.params.userId, req.accessSession)
    await writeAccountState()
    await clearUsageForClient(getUsageClientIdForAccount(account))
    res.json({
      ok: true,
      userId: account.id
    })
  } catch (error) {
    res.status(400).json({ error: error.message || '删除账号失败' })
  }
})

app.post('/api/admin/users/:userId/reset-usage', requireAdminMiddleware, async (req, res) => {
  try {
    const account = findAccountById(req.params.userId)
    if (!account) throw new Error('账号不存在')

    await resetUsage(getUsageClientIdForAccount(account))
    res.json({
      ok: true,
      user: getAccountForAdmin(account)
    })
  } catch (error) {
    res.status(400).json({ error: error.message || '重置次数失败' })
  }
})

app.get('/api/feedback-data', requireAccessMiddleware, (req, res) => {
  const ownerId = getDataOwnerId(req.accessSession)
  res.json({
    data: getFeedbackDataForOwner(ownerId),
    ownerId
  })
})

app.put('/api/feedback-data', requireAccessMiddleware, async (req, res) => {
  try {
    const ownerId = getDataOwnerId(req.accessSession)
    const current = getFeedbackDataForOwner(ownerId)
    const incoming = req.body && typeof req.body === 'object' ? req.body : {}
    const data = isolateFeedbackDataForOwner(ownerId, normalizeFeedbackData({
      ...current,
      ...incoming,
      quickOptions: {
        ...(current.quickOptions || {}),
        ...(incoming.quickOptions || {})
      }
    }))
    feedbackDataState.owners[ownerId] = data
    await writeFeedbackDataState()
    res.json({
      ok: true,
      data
    })
  } catch (error) {
    res.status(400).json({ error: error.message || '保存档案数据失败' })
  }
})

app.get('/api/teaching-data', requireAccessMiddleware, (req, res) => {
  const ownerId = getDataOwnerId(req.accessSession)
  res.json({
    data: getFeedbackDataForOwner(ownerId),
    ownerId
  })
})

app.put('/api/teaching-data', requireAccessMiddleware, async (req, res) => {
  try {
    const ownerId = getDataOwnerId(req.accessSession)
    const data = isolateFeedbackDataForOwner(ownerId, normalizeFeedbackData(req.body && req.body.data))
    data.updatedAt = Date.now()
    feedbackDataState.owners[ownerId] = data
    await writeFeedbackDataState()
    res.json({
      ok: true,
      data
    })
  } catch (error) {
    res.status(400).json({ error: error.message || '保存教学数据失败' })
  }
})

app.post('/api/materials', requireAccessMiddleware, upload.single('material'), async (req, res) => {
  try {
    if (!req.file) throw new Error('请先上传教材文件')

    const ownerId = getDataOwnerId(req.accessSession)
    const material = await saveUploadedMaterial(ownerId, req.file, req.body || {})
    res.json({
      ok: true,
      material: getSafeMaterial(material)
    })
  } catch (error) {
    const message = getMaterialUploadErrorMessage(error)
    const isInputError = message === '请先上传教材文件' || message.startsWith('教材目前支持')
    if (!isInputError) console.error('Failed to upload material', error)
    res.status(isInputError ? 400 : 500).json({ error: message })
  }
})

app.post('/api/teaching-data/ai-polish', requireAccessMiddleware, async (req, res) => {
  try {
    const usageClientId = getUsageClientId(req.accessSession)
    const usageInfo = getUsageInfoForSession(req.accessSession)
    if (!usageInfo.unlimited && usageInfo.remaining <= 0) {
      res.status(429).json({
        error: `今天的生成次数已用完。每日最多 ${usageInfo.limit} 次，请联系管理员或明天再试。`,
        usage: usageInfo
      })
      return
    }

    const text = trim(req.body && req.body.text)
    const context = trim(req.body && req.body.context)
    if (!text) throw new Error('请先输入需要润色的内容')

    const aiConfig = getAIConfig()
    let result
    let demo = false
    if (!aiConfig.apiKey) {
      demo = true
      result = buildDemoPolishText(text)
    } else {
      result = await requestTeachingTextAI(buildPolishPrompt(text, context), aiConfig)
    }

    const usage = await incrementUsage(usageClientId, usageInfo.limit, usageInfo.unlimited)
    res.json({
      ok: true,
      demo,
      text: result,
      usage
    })
  } catch (error) {
    console.error(error)
    res.status(400).json({ error: getUserFacingError(error) })
  }
})

app.post('/api/teaching-data/ai-analysis', requireAccessMiddleware, async (req, res) => {
  try {
    const usageClientId = getUsageClientId(req.accessSession)
    const usageInfo = getUsageInfoForSession(req.accessSession)
    if (!usageInfo.unlimited && usageInfo.remaining <= 0) {
      res.status(429).json({
        error: `今天的生成次数已用完。每日最多 ${usageInfo.limit} 次，请联系管理员或明天再试。`,
        usage: usageInfo
      })
      return
    }

    const subject = trim(req.body && req.body.subject)
    const target = trim(req.body && req.body.target)
    const analysisType = trim(req.body && req.body.analysisType) || 'student'
    const records = Array.isArray(req.body && req.body.records) ? req.body.records : []
    const profile = req.body && req.body.profile && typeof req.body.profile === 'object' ? req.body.profile : null
    if (!records.length && !profile) throw new Error('暂无可分析的数据')

    const aiConfig = getAIConfig()
    let result
    let demo = false
    if (!aiConfig.apiKey) {
      demo = true
      result = buildDemoAnalysisText(target || '学生', records)
    } else {
      result = await requestTeachingTextAI(buildAnalysisPrompt({
        subject,
        target,
        analysisType,
        records,
        profile
      }), aiConfig)
    }

    const usage = await incrementUsage(usageClientId, usageInfo.limit, usageInfo.unlimited)
    res.json({
      ok: true,
      demo,
      text: result,
      usage
    })
  } catch (error) {
    console.error(error)
    res.status(400).json({ error: getUserFacingError(error) })
  }
})

app.post('/api/teaching-data/paper-analysis', requireAccessMiddleware, upload.fields([
  { name: 'paperFile', maxCount: 1 },
  { name: 'paperPageImage', maxCount: 80 }
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
    const paperFile = getUploadedFile(req, 'paperFile')
    const pageImages = getUploadedFiles(req, 'paperPageImage')
    if (!paperFile) throw new Error('请先上传试卷文件')

    const aiConfig = getAIConfig()
    const paperCourseware = await normalizeCourseware(paperFile, {
      clientPdfText: payload.clientPdfText,
      pdfPageImages: pageImages,
      selectedPdfPages: payload.selectedPdfPages
    })

    let analysis
    let demo = false
    if (!aiConfig.apiKey) {
      demo = true
      analysis = buildDemoPaperAnalysis(payload, paperCourseware)
    } else {
      const aiResponse = await requestPaperAnalysis(payload, paperCourseware, aiConfig)
      analysis = normalizePaperAnalysis(parsePaperAnalysisResponse(aiResponse, aiConfig.provider), payload)
    }

    const usage = await incrementUsage(usageClientId, usageInfo.limit, usageInfo.unlimited)
    res.json({
      ok: true,
      demo,
      provider: aiConfig.provider,
      model: aiConfig.model,
      usage,
      analysis
    })
  } catch (error) {
    console.error(error)
    res.status(400).json({ error: getUserFacingError(error) })
  }
})

app.post('/api/teaching-data/paper-score-recognition', requireAccessMiddleware, upload.fields([
  { name: 'scoreFile', maxCount: 1 },
  { name: 'scorePageImage', maxCount: 20 }
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
    const scoreFile = getUploadedFile(req, 'scoreFile')
    const pageImages = getUploadedFiles(req, 'scorePageImage')
    if (!scoreFile) throw new Error('请先上传批改后的试卷图片或 PDF')

    const aiConfig = getAIConfig()
    const scoreCourseware = await normalizeCourseware(scoreFile, {
      clientPdfText: payload.clientPdfText,
      pdfPageImages: pageImages,
      selectedPdfPages: payload.selectedPdfPages
    })

    let scores
    let demo = false
    if (!aiConfig.apiKey) {
      demo = true
      scores = buildDemoPaperScoreRecognition(payload)
    } else {
      const aiResponse = await requestPaperScoreRecognition(payload, scoreCourseware, aiConfig)
      scores = normalizePaperScoreRecognition(parsePaperScoreRecognitionResponse(aiResponse, aiConfig.provider), payload)
    }

    const usage = await incrementUsage(usageClientId, usageInfo.limit, usageInfo.unlimited)
    res.json({
      ok: true,
      demo,
      usage,
      scores
    })
  } catch (error) {
    console.error(error)
    res.status(400).json({ error: getUserFacingError(error) })
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

app.post('/api/courseware-lectures', requireAccessMiddleware, upload.single('courseware'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '请先上传课件文件' })
      return
    }

    const courseware = await normalizeCourseware(req.file)
    const detection = detectTextCoursewareLectures(courseware.extractedText, {
      pageCount: courseware.ocrPageCount
    })

    res.json({
      lectures: detection.lectures,
      pageCount: detection.pageCount,
      extractionSource: courseware.extractionSource,
      textLength: trim(courseware.extractedText).length
    })
  } catch (error) {
    console.error(error)
    res.status(400).json({
      error: getUserFacingError(error)
    })
  }
})

app.post('/api/generate-feedback', requireAccessMiddleware, upload.fields([
  { name: 'courseware', maxCount: 12 },
  { name: 'exitTest', maxCount: 1 },
  { name: 'pdfPageImage', maxCount: 1000 }
]), async (req, res) => {
  try {
    const session = req.accessSession
    const coursewareFiles = getUploadedFiles(req, 'courseware')
    const coursewareFile = coursewareFiles[0] || null
    const exitTestFile = getUploadedFile(req, 'exitTest')
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
    const storedMaterialFile = !coursewareFiles.length && payload.materialId
      ? await getStoredMaterialFile(session, payload.materialId)
      : null
    validatePayload(payload, Boolean(coursewareFiles.length || storedMaterialFile))

    const aiConfig = getAIConfig()
    const courseware = await normalizeCoursewareUploads(coursewareFiles, storedMaterialFile, payload, pdfPageImages)
    const exitTestCourseware = exitTestFile ? await normalizeCourseware(exitTestFile, {
      selectedPdfPages: payload.exitTest && payload.exitTest.selectedPdfPages
    }) : null
    if (exitTestCourseware) payload.exitTestFile = buildUploadedFileSummary(exitTestCourseware)

    if (!aiConfig.apiKey) {
      const nextUsage = await incrementUsage(usageClientId, usageInfo.limit, usageInfo.unlimited)
      res.json({
        demo: true,
        message: `当前未配置 ${aiConfig.keyName}，已返回演示反馈。`,
        usage: nextUsage,
        feedbacks: buildDemoFeedbacks(payload)
      })
      return
    }

    const aiResponse = await requestAI(payload, courseware, aiConfig)
    const nextUsage = await incrementUsage(usageClientId, usageInfo.limit, usageInfo.unlimited)
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

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error)
    return
  }

  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `单个文件不能超过 ${Math.floor(MAX_UPLOAD_FILE_SIZE_BYTES / 1024 / 1024)}MB`
      : `文件上传失败：${error.message}`
    res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: message })
    return
  }

  console.error('Unhandled request error', error)
  res.status(500).json({ error: '服务器处理文件时出错，请稍后重试' })
})

initializeStorage()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Course feedback web app running at http://localhost:${PORT}`)
    })
  })
  .catch((error) => {
    console.error('Failed to initialize storage', error)
    process.exit(1)
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

  payload.generationInstruction = trim(payload.generationInstruction).slice(0, 1200)

  payload.students = payload.students
    .map((student, index) => ({
      id: trim(student.id) || `student-${index + 1}`,
      name: trim(student.name),
      performance: trim(student.performance) || '表现良好',
      remark: trim(student.remark),
      keywords: trim(student.keywords),
      exitTestScore: trim(student.exitTestScore),
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
    'DATA_DIR',
    'DATABASE_URL',
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

function resolveDataDir() {
  const configuredDir = trim(process.env.DATA_DIR || process.env.RENDER_DATA_DIR)
  if (configuredDir) return path.resolve(configuredDir)

  if (process.env.RENDER && isWritableDirectory('/var/data')) {
    return '/var/data'
  }

  return LEGACY_DATA_DIR
}

function isWritableDirectory(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return false
    fs.accessSync(dirPath, fs.constants.W_OK)
    return true
  } catch (error) {
    return false
  }
}

async function initializeStorage() {
  usageState = readUsageState()
  accountState = readAccountState()
  feedbackDataState = readFeedbackDataState()
  materialState = readMaterialState()

  if (!DATABASE_URL) {
    if (removeAdminCopiesOfUserClasses()) await writeFeedbackDataState()
    const materialsMigrated = await migrateLegacyMaterialStorage()
    if (materialsMigrated) await writeMaterialState()
    return
  }

  databasePool = createDatabasePool()
  await ensureDatabaseSchema()

  const databaseAccounts = await readDatabaseState('accounts')
  if (databaseAccounts && Array.isArray(databaseAccounts.users)) {
    accountState = databaseAccounts
    if (mergeDefaultAccounts(accountState)) {
      await writeDatabaseState('accounts', accountState)
    }
  } else {
    await writeDatabaseState('accounts', accountState)
  }

  const databaseUsage = await readDatabaseState('usage')
  if (databaseUsage && typeof databaseUsage === 'object' && !Array.isArray(databaseUsage)) {
    usageState = databaseUsage
  } else {
    await writeDatabaseState('usage', usageState)
  }

  const databaseFeedbackData = await readDatabaseState('feedback-data')
  if (databaseFeedbackData && typeof databaseFeedbackData === 'object' && !Array.isArray(databaseFeedbackData)) {
    feedbackDataState = normalizeFeedbackDataState(databaseFeedbackData)
  } else {
    await writeDatabaseState('feedback-data', feedbackDataState)
  }

  if (removeAdminCopiesOfUserClasses()) {
    await writeFeedbackDataState()
  }

  const databaseMaterials = await readDatabaseState('materials')
  let shouldSeedMaterialState = false
  if (databaseMaterials && typeof databaseMaterials === 'object' && Array.isArray(databaseMaterials.items)) {
    materialState = databaseMaterials
  } else {
    shouldSeedMaterialState = true
  }

  const materialsMigrated = await migrateLegacyMaterialStorage()
  if (materialsMigrated || shouldSeedMaterialState) {
    try {
      await writeMaterialState()
    } catch (error) {
      console.error('Failed to persist migrated material metadata', error)
    }
  }
}

function createDatabasePool() {
  let Pool

  try {
    ;({ Pool } = require('pg'))
  } catch (error) {
    throw new Error('已配置 DATABASE_URL，但缺少 pg 依赖。请重新部署以安装数据库依赖。')
  }

  return new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  })
}

async function ensureDatabaseSchema() {
  await databasePool.query(`
    create table if not exists app_state (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    )
  `)

  await databasePool.query(`
    create table if not exists course_materials (
      id text primary key,
      owner_id text not null,
      original_name text not null,
      mime text not null,
      size bigint not null,
      data bytea not null,
      lectures jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now()
    )
  `)

  await databasePool.query(`
    create index if not exists course_materials_owner_id_idx
    on course_materials (owner_id)
  `)
}

async function readDatabaseState(key) {
  const result = await databasePool.query('select value from app_state where key = $1', [key])
  if (!result.rows.length) return null
  return result.rows[0].value
}

async function writeDatabaseState(key, value) {
  if (!databasePool) return

  await databasePool.query(`
    insert into app_state (key, value, updated_at)
    values ($1, $2::jsonb, now())
    on conflict (key)
    do update set value = excluded.value, updated_at = now()
  `, [key, JSON.stringify(value)])
}

function getStorageStatus() {
  return {
    mode: databasePool ? 'database' : 'file',
    databaseConfigured: Boolean(DATABASE_URL),
    databaseConnected: Boolean(databasePool),
    dataDir: DATA_DIR,
    persistent: databasePool ? true : DATA_DIR !== LEGACY_DATA_DIR
  }
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
    const { raw, migrated } = readStateFile(ACCOUNTS_PATH, LEGACY_ACCOUNTS_PATH)
    const parsed = raw ? JSON.parse(raw) : null
    const state = parsed && Array.isArray(parsed.users) ? parsed : { users: [] }
    const changed = mergeDefaultAccounts(state)
    if (migrated || changed) writeJsonState(ACCOUNTS_PATH, state)
    return state
  } catch (error) {
    const state = { users: DEFAULT_ACCOUNTS.map((account) => ({ ...account })) }
    writeJsonState(ACCOUNTS_PATH, state)
    return state
  }
}

function mergeDefaultAccounts(state) {
  let changed = false

  DEFAULT_ACCOUNTS.forEach((defaultAccount) => {
    const existed = state.users.find((account) => account.username === defaultAccount.username)
    if (!existed) {
      state.users.push({
        ...defaultAccount,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      changed = true
    }
  })

  return changed
}

async function writeAccountState() {
  writeJsonState(ACCOUNTS_PATH, accountState)
  await writeDatabaseState('accounts', accountState)
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

function deleteAccount(accountId, session = {}) {
  const index = accountState.users.findIndex((account) => account.id === accountId)
  if (index < 0) throw new Error('账号不存在')

  const account = accountState.users[index]
  if (account.id === session.accountId) throw new Error('不能删除当前登录的管理员账号')
  if (account.role === 'admin' && account.active && getActiveAdminCount() <= 1) {
    throw new Error('至少需要保留一个启用的管理员账号')
  }

  accountState.users.splice(index, 1)
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

async function incrementUsage(clientId, limit = DAILY_LIMIT, unlimited = false) {
  const today = getTodayKey()
  cleanupUsageState(today)
  if (!usageState[today]) usageState[today] = {}
  usageState[today][clientId] = Number(usageState[today][clientId] || 0) + 1
  await writeUsageState()
  return getUsageInfo(clientId, limit, unlimited)
}

async function resetUsage(clientId) {
  const today = getTodayKey()
  if (usageState[today]) {
    usageState[today][clientId] = 0
    await writeUsageState()
  }
}

async function clearUsageForClient(clientId) {
  Object.keys(usageState).forEach((date) => {
    if (usageState[date]) delete usageState[date][clientId]
  })
  await writeUsageState()
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
    const { raw, migrated } = readStateFile(USAGE_PATH, LEGACY_USAGE_PATH, '{}')
    const parsed = JSON.parse(raw)
    const state = parsed && typeof parsed === 'object' ? parsed : {}
    if (migrated) writeJsonState(USAGE_PATH, state)
    return state
  } catch (error) {
    return {}
  }
}

async function writeUsageState() {
  writeJsonState(USAGE_PATH, usageState)
  await writeDatabaseState('usage', usageState)
}

function readFeedbackDataState() {
  try {
    const raw = fs.existsSync(FEEDBACK_DATA_PATH) ? fs.readFileSync(FEEDBACK_DATA_PATH, 'utf8') : '{"owners":{}}'
    return normalizeFeedbackDataState(JSON.parse(raw))
  } catch (error) {
    return { owners: {} }
  }
}

function normalizeFeedbackDataState(input) {
  const source = input && typeof input === 'object' ? input : {}
  const owners = source.owners && typeof source.owners === 'object' ? source.owners : {}
  const nextOwners = {}

  Object.entries(owners).forEach(([ownerId, data]) => {
    nextOwners[ownerId] = normalizeFeedbackData(data)
  })

  return { owners: nextOwners }
}

async function writeFeedbackDataState() {
  writeJsonState(FEEDBACK_DATA_PATH, feedbackDataState)
  await writeDatabaseState('feedback-data', feedbackDataState)
}

function getDataOwnerId(session = {}) {
  return session.accountId ? `account:${session.accountId}` : getUsageClientId(session)
}

function getFeedbackDataForOwner(ownerId) {
  return isolateFeedbackDataForOwner(ownerId, feedbackDataState.owners[ownerId] || {})
}

function getAdminOwnerIds() {
  return new Set(
    accountState.users
      .filter((account) => account && account.role === 'admin')
      .map((account) => `account:${account.id}`)
  )
}

function getNonAdminClassIds() {
  const adminOwnerIds = getAdminOwnerIds()
  const classIds = new Set()

  Object.entries(feedbackDataState.owners).forEach(([ownerId, data]) => {
    if (adminOwnerIds.has(ownerId)) return
    ;(data && data.classes || []).forEach((classInfo) => {
      if (classInfo && classInfo.id) classIds.add(classInfo.id)
    })
  })

  return classIds
}

function isolateFeedbackDataForOwner(ownerId, input) {
  const data = normalizeFeedbackData(input)
  if (!getAdminOwnerIds().has(ownerId)) return data

  const nonAdminClassIds = getNonAdminClassIds()
  if (!nonAdminClassIds.size) return data

  const allowedClassIds = new Set(
    data.classes
      .filter((classInfo) => !nonAdminClassIds.has(classInfo.id))
      .map((classInfo) => classInfo.id)
  )
  const isAllowedRecord = (record) => !record.classId || allowedClassIds.has(record.classId)

  return {
    ...data,
    classes: data.classes.filter((classInfo) => allowedClassIds.has(classInfo.id)),
    scoreRecords: data.scoreRecords.filter(isAllowedRecord),
    feedbackHistory: data.feedbackHistory.filter(isAllowedRecord),
    paperAnalyses: data.paperAnalyses.filter(isAllowedRecord)
  }
}

function removeAdminCopiesOfUserClasses() {
  const adminIds = getAdminOwnerIds()
  if (!adminIds.size) return false

  const userClassIds = new Set()
  Object.entries(feedbackDataState.owners).forEach(([ownerId, data]) => {
    if (adminIds.has(ownerId)) return
    ;(data.classes || []).forEach((classInfo) => {
      if (classInfo && classInfo.id) userClassIds.add(classInfo.id)
    })
  })

  if (!userClassIds.size) return false

  let changed = false
  adminIds.forEach((ownerId) => {
    const data = feedbackDataState.owners[ownerId]
    if (!data || !Array.isArray(data.classes)) return

    const removedIds = new Set(
      data.classes
        .filter((classInfo) => classInfo && userClassIds.has(classInfo.id))
        .map((classInfo) => classInfo.id)
    )
    if (!removedIds.size) return

    data.classes = data.classes.filter((classInfo) => !removedIds.has(classInfo.id))
    data.scoreRecords = (data.scoreRecords || []).filter((record) => !removedIds.has(record.classId))
    data.feedbackHistory = (data.feedbackHistory || []).filter((record) => !removedIds.has(record.classId))
    data.paperAnalyses = (data.paperAnalyses || []).filter((record) => !removedIds.has(record.classId))
    data.updatedAt = Date.now()
    changed = true
  })

  return changed
}

function normalizeFeedbackData(input) {
  const source = input && typeof input === 'object' ? input : {}
  const quickOptions = source.quickOptions && typeof source.quickOptions === 'object' ? source.quickOptions : {}
  const performancePositiveFallback = ['主动发言', '回答质量高', '笔记认真', '思路清晰', '步骤规范', '课堂练习完成度高']
  const performanceNegativeFallback = ['注意力波动', '反应较慢', '参与度待提高', '预习不充分', '作业质量不稳定', '计算细节易错']
  const classPerformancePositiveFallback = ['互动积极', '回答问题踊跃', '小组讨论热烈', '笔记整理认真', '思维活跃有深度', '课前预习充分', '课堂练习完成度高']
  const classPerformanceNegativeFallback = ['个别学生走神', '部分学生反应较慢', '互动参与度有待提高', '课前预习不充分', '纪律偶有松散', '作业完成质量参差不齐']

  return {
    classes: normalizeFeedbackClasses(source.classes),
    oneProfiles: normalizeFeedbackOneProfiles(source.oneProfiles),
    courseModules: normalizeCourseModules(source.courseModules),
    scoreRecords: normalizeScoreRecords(source.scoreRecords),
    feedbackHistory: normalizeFeedbackHistory(source.feedbackHistory),
    paperAnalyses: normalizePaperAnalysisHistory(source.paperAnalyses),
    quickOptions: {
      performancePositive: normalizeStringList(quickOptions.performancePositive, performancePositiveFallback),
      performanceNegative: normalizeStringList(quickOptions.performanceNegative, performanceNegativeFallback),
      performance: normalizeStringList(quickOptions.performance, [...performancePositiveFallback, ...performanceNegativeFallback]),
      classPerformancePositive: normalizeStringList(quickOptions.classPerformancePositive, classPerformancePositiveFallback),
      classPerformanceNegative: normalizeStringList(quickOptions.classPerformanceNegative, classPerformanceNegativeFallback),
      classPerformance: normalizeStringList(quickOptions.classPerformance, [...classPerformancePositiveFallback, ...classPerformanceNegativeFallback]),
      homework: normalizeStringList(quickOptions.homework, [
        '完成课本对应章节习题',
        '预习下一节内容',
        '整理课堂笔记',
        '完成同步练习对应章节',
        '重点复习课堂难点',
        '完成预习导学案'
      ]),
      teaching: normalizeStringList(quickOptions.teaching, [
        '下次课先做错题回顾',
        '加强计算规范训练',
        '增加同类型题变式练习',
        '用口述方式检查知识理解'
      ])
    },
    updatedAt: Number(source.updatedAt || Date.now())
  }
}

function normalizeFeedbackClasses(classes) {
  return Array.isArray(classes) ? classes.map((item) => {
    const source = item && typeof item === 'object' ? item : {}
    return {
      id: trim(source.id) || `class-${crypto.randomUUID()}`,
      name: trim(source.name) || '未命名班级',
      grade: trim(source.grade) || '高一',
      template: trim(source.template),
      materialMode: trim(source.materialMode) === 'book' ? 'book' : 'lesson',
      textbook: source.textbook && typeof source.textbook === 'object' ? getSafeMaterial(source.textbook) : null,
      students: normalizeFeedbackStudents(source.students),
      updatedAt: Number(source.updatedAt || Date.now())
    }
  }) : []
}

function normalizeFeedbackStudents(students) {
  return Array.isArray(students) ? students
    .map((student) => {
      if (typeof student === 'string') {
        return {
          id: `stu-${crypto.randomUUID()}`,
          name: trim(student),
          performance: '表现良好',
          remark: ''
        }
      }
      const source = student && typeof student === 'object' ? student : {}
      return {
        id: trim(source.id) || `stu-${crypto.randomUUID()}`,
        name: trim(source.name),
        performance: trim(source.performance) || '表现良好',
        remark: trim(source.remark),
        keywords: trim(source.keywords)
      }
    })
    .filter((student) => student.name) : []
}

function normalizeFeedbackOneProfiles(profiles) {
  return Array.isArray(profiles) ? profiles.map((item) => {
    const source = item && typeof item === 'object' ? item : {}
    return {
      id: trim(source.id) || `one-${crypto.randomUUID()}`,
      name: trim(source.name) || '未命名学生',
      grade: trim(source.grade) || '高一',
      personality: trim(source.personality),
      habit: trim(source.habit),
      template: trim(source.template),
      updatedAt: Number(source.updatedAt || Date.now())
    }
  }) : []
}

function readMaterialState() {
  try {
    const raw = fs.existsSync(MATERIAL_INDEX_PATH) ? fs.readFileSync(MATERIAL_INDEX_PATH, 'utf8') : '{"items":[]}'
    const parsed = JSON.parse(raw)
    return parsed && Array.isArray(parsed.items) ? parsed : { items: [] }
  } catch (error) {
    return { items: [] }
  }
}

async function writeMaterialState() {
  writeJsonState(MATERIAL_INDEX_PATH, materialState)
  await writeDatabaseState('materials', materialState)
}

function getMaterialUploadErrorMessage(error) {
  const message = trim(error && error.message)
  const code = trim(error && error.code)

  if (message === '请先上传教材文件' || message.startsWith('教材目前支持')) return message
  if (code === '57014' || /timeout|timed out|超时/i.test(message)) {
    return '教材写入数据库超时，请稍后重试'
  }
  if (code === 'ENOSPC') return '服务器临时存储空间不足，请联系管理员'
  if (/connection|connect|ECONN|数据库/i.test(message)) {
    return '教材数据库连接失败，请稍后重试'
  }
  return '教材保存到数据库失败，请稍后重试'
}

async function migrateLegacyMaterialStorage() {
  let migrated = false

  for (const material of materialState.items) {
    if (!material || !material.dataBase64) continue

    const buffer = Buffer.from(material.dataBase64, 'base64')
    if (!buffer.length) continue

    try {
      Object.assign(material, getMaterialStorageMetadata(material))
      await writeMaterialBlob(material, buffer)
      delete material.dataBase64
      migrated = true
    } catch (error) {
      console.error(`Failed to migrate material ${trim(material.id) || 'unknown'}`, error)
    }
  }

  return migrated
}

async function saveUploadedMaterial(ownerId, file, input = {}) {
  const originalName = normalizeUploadFileName(file.originalname, 'material.pdf')
  const lowerName = originalName.toLowerCase()
  if (!/\.(pdf|docx|pptx|txt|md|png|jpg|jpeg|webp)$/i.test(lowerName)) {
    throw new Error('教材目前支持 PDF、Word、PPT、文本或图片文件')
  }

  const requestedMaterialId = trim(input.materialId)
  const requestedIdIsValid = /^mat-[a-z0-9-]{8,}$/i.test(requestedMaterialId)
  const requestedIdOwner = requestedIdIsValid
    ? materialState.items.find((item) => item.id === requestedMaterialId)
    : null
  const material = {
    id: requestedIdIsValid && (!requestedIdOwner || requestedIdOwner.ownerId === ownerId)
      ? requestedMaterialId
      : `mat-${crypto.randomUUID()}`,
    ownerId,
    originalName,
    mime: getMimeType(originalName, file.mimetype || 'application/octet-stream'),
    size: file.size,
    lectures: parseMaterialLectures(input.lectures),
    createdAt: Date.now()
  }

  const previousItems = materialState.items.slice()
  const existed = previousItems.some((item) => item.id === material.id)

  await writeMaterialBlob(material, file.buffer)
  materialState.items = materialState.items.filter((item) => item.id !== material.id)
  materialState.items.push(material)

  try {
    await writeMaterialState()
  } catch (error) {
    materialState.items = previousItems
    if (!existed) await deleteMaterialBlob(material.id).catch(() => {})
    throw error
  }

  return material
}

async function writeMaterialBlob(material, buffer) {
  const metadata = getMaterialStorageMetadata(material)

  if (databasePool) {
    await databasePool.query(`
      insert into course_materials (
        id, owner_id, original_name, mime, size, data, lectures, created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      on conflict (id)
      do update set
        owner_id = excluded.owner_id,
        original_name = excluded.original_name,
        mime = excluded.mime,
        size = excluded.size,
        data = excluded.data,
        lectures = excluded.lectures,
        created_at = excluded.created_at
    `, [
      metadata.id,
      metadata.ownerId,
      metadata.originalName,
      metadata.mime,
      metadata.size,
      buffer,
      JSON.stringify(metadata.lectures),
      new Date(metadata.createdAt)
    ])
    return
  }

  fs.mkdirSync(MATERIAL_FILES_DIR, { recursive: true })
  fs.writeFileSync(getMaterialFilePath(metadata.id), buffer)
}

async function readMaterialBlob(material) {
  if (material.dataBase64) return Buffer.from(material.dataBase64, 'base64')

  if (databasePool) {
    const result = await databasePool.query(`
      select data
      from course_materials
      where id = $1 and owner_id = $2
      limit 1
    `, [material.id, material.ownerId])
    return result.rows.length ? result.rows[0].data : null
  }

  const filePath = getMaterialFilePath(material.id)
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
}

async function deleteMaterialBlob(materialId) {
  if (databasePool) {
    await databasePool.query('delete from course_materials where id = $1', [materialId])
    return
  }

  const filePath = getMaterialFilePath(materialId)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

function getMaterialStorageMetadata(material = {}) {
  return {
    id: trim(material.id) || `mat-${crypto.randomUUID()}`,
    ownerId: trim(material.ownerId),
    originalName: normalizeUploadFileName(material.originalName || material.name, 'material.pdf'),
    mime: trim(material.mime) || getMimeType(material.originalName || material.name, 'application/octet-stream'),
    size: Math.max(0, Number(material.size || 0)),
    lectures: parseMaterialLectures(material.lectures),
    createdAt: Number(material.createdAt || Date.now())
  }
}

function getMaterialFilePath(materialId) {
  const safeId = trim(materialId).replace(/[^a-z0-9_-]/gi, '_')
  return path.join(MATERIAL_FILES_DIR, safeId || 'material')
}

function parseMaterialLectures(rawLectures) {
  if (!rawLectures) return []
  const source = typeof rawLectures === 'string' ? parseJsonText(rawLectures) : rawLectures
  const list = Array.isArray(source) ? source : []

  return list.map((lecture, index) => ({
    key: trim(lecture && lecture.key) || `lecture-${index + 1}`,
    title: trim(lecture && lecture.title) || `第 ${index + 1} 讲`,
    startPage: Math.max(1, Number(lecture && lecture.startPage) || 1),
    endPage: Math.max(1, Number(lecture && lecture.endPage) || Number(lecture && lecture.startPage) || 1)
  }))
}

async function getStoredMaterialFile(session, materialId) {
  const ownerId = getDataOwnerId(session)
  const material = materialState.items.find((item) => item.id === materialId && item.ownerId === ownerId)

  if (!material) {
    throw new Error('没有找到班级教材，请重新上传')
  }

  const buffer = await readMaterialBlob(material)
  if (!buffer || !buffer.length) throw new Error('没有找到班级教材，请重新上传')

  return {
    originalname: normalizeUploadFileName(material.originalName || material.name, 'material.pdf'),
    mimetype: material.mime,
    buffer
  }
}

function getSafeMaterial(material = {}) {
  const safeName = normalizeUploadFileName(material.name || material.originalName, '整本教材')
  return {
    id: trim(material.id),
    name: safeName,
    mime: trim(material.mime),
    size: Number(material.size || 0),
    lectures: Array.isArray(material.lectures) ? material.lectures.map((lecture, index) => ({
      key: trim(lecture && lecture.key) || `lecture-${index + 1}`,
      title: trim(lecture && lecture.title) || `第 ${index + 1} 讲`,
      startPage: Math.max(1, Number(lecture && lecture.startPage) || 1),
      endPage: Math.max(1, Number(lecture && lecture.endPage) || Number(lecture && lecture.startPage) || 1)
    })) : [],
    createdAt: Number(material.createdAt || Date.now())
  }
}

function readStateFile(primaryPath, legacyPath, emptyValue = '') {
  if (fs.existsSync(primaryPath)) {
    return {
      raw: fs.readFileSync(primaryPath, 'utf8'),
      migrated: false
    }
  }

  if (primaryPath !== legacyPath && fs.existsSync(legacyPath)) {
    return {
      raw: fs.readFileSync(legacyPath, 'utf8'),
      migrated: true
    }
  }

  return {
    raw: emptyValue,
    migrated: false
  }
}

function writeJsonState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`)
}

function cleanupUsageState(today) {
  Object.keys(usageState).forEach((date) => {
    if (date !== today) delete usageState[date]
  })
}

function normalizeTeachingClasses(classes) {
  return Array.isArray(classes) ? classes.map((item) => {
    const source = item && typeof item === 'object' ? item : {}
    return {
      id: trim(source.id) || `class-${crypto.randomUUID()}`,
      name: trim(source.name) || '未命名班级',
      grade: trim(source.grade) || '高一',
      template: trim(source.template),
      note: trim(source.note),
      materialMode: trim(source.materialMode) === 'book' ? 'book' : 'lesson',
      textbook: normalizeTeachingTextbook(source.textbook),
      students: normalizeTeachingStudents(source.students),
      updatedAt: Number(source.updatedAt || Date.now())
    }
  }) : []
}

function normalizeTeachingTextbook(textbook) {
  if (!textbook || typeof textbook !== 'object') return null
  const source = textbook
  const id = trim(source.id)
  const name = trim(source.name || source.originalName)
  if (!id && !name) return null

  return {
    id,
    name: name || '已上传教材',
    mime: trim(source.mime),
    size: Number(source.size || 0),
    lectures: parseMaterialLectures(source.lectures),
    createdAt: Number(source.createdAt || Date.now())
  }
}

function normalizeTeachingStudents(students) {
  return Array.isArray(students) ? students
    .map((student) => {
      if (typeof student === 'string') {
        return {
          id: `stu-${crypto.randomUUID()}`,
          name: trim(student),
          note: ''
        }
      }
      const source = student && typeof student === 'object' ? student : {}
      return {
        id: trim(source.id) || `stu-${crypto.randomUUID()}`,
        name: trim(source.name),
        note: trim(source.note)
      }
    })
    .filter((student) => student.name) : []
}

function normalizeTeachingOneProfiles(profiles) {
  return Array.isArray(profiles) ? profiles.map((item) => {
    const source = item && typeof item === 'object' ? item : {}
    return {
      id: trim(source.id) || `one-${crypto.randomUUID()}`,
      name: trim(source.name) || '未命名学生',
      grade: trim(source.grade) || '高一',
      personality: trim(source.personality),
      habit: trim(source.habit),
      template: trim(source.template),
      note: trim(source.note),
      updatedAt: Number(source.updatedAt || Date.now())
    }
  }) : []
}

function normalizeCourseModules(modules) {
  return Array.isArray(modules) ? modules.map((item) => {
    const source = item && typeof item === 'object' ? item : {}
    return {
      id: trim(source.id) || `module-${crypto.randomUUID()}`,
      name: trim(source.name) || '未命名模块',
      lectures: normalizeLectures(source.lectures),
      chapters: normalizeChapters(source.chapters),
      updatedAt: Number(source.updatedAt || Date.now())
    }
  }) : []
}

function normalizeLectures(lectures) {
  return Array.isArray(lectures) ? lectures.map((item, index) => {
    const source = item && typeof item === 'object' ? item : {}
    return {
      id: trim(source.id) || `lecture-${crypto.randomUUID()}`,
      lecture: Number(source.lecture || index + 1),
      title: trim(source.title) || `第 ${index + 1} 讲`,
      content: trim(source.content),
      keyPoints: trim(source.keyPoints),
      notes: trim(source.notes)
    }
  }) : []
}

function normalizeChapters(chapters) {
  return Array.isArray(chapters) ? chapters.map((item, index) => {
    const source = item && typeof item === 'object' ? item : {}
    return {
      id: trim(source.id) || `chapter-${crypto.randomUUID()}`,
      chapter: Number(source.chapter || index + 1),
      title: trim(source.title) || `第 ${index + 1} 章`,
      sections: normalizeSections(source.sections)
    }
  }) : []
}

function normalizeSections(sections) {
  return Array.isArray(sections) ? sections.map((item, index) => {
    const source = item && typeof item === 'object' ? item : {}
    return {
      id: trim(source.id) || `section-${crypto.randomUUID()}`,
      section: Number(source.section || index + 1),
      title: trim(source.title) || `第 ${index + 1} 节`,
      lessons: normalizeLessons(source.lessons)
    }
  }) : []
}

function normalizeLessons(lessons) {
  return Array.isArray(lessons) ? lessons.map((item, index) => {
    const source = item && typeof item === 'object' ? item : {}
    return {
      id: trim(source.id) || `lesson-${crypto.randomUUID()}`,
      lesson: Number(source.lesson || index + 1),
      title: trim(source.title) || `第 ${index + 1} 课时`,
      content: trim(source.content),
      keyPoints: trim(source.keyPoints),
      notes: trim(source.notes)
    }
  }) : []
}

function normalizeScoreRecords(records) {
  return Array.isArray(records) ? records.map((item) => {
    const source = item && typeof item === 'object' ? item : {}
    const mode = trim(source.mode) === 'grade' ? 'grade' : 'percent'
    return {
      id: trim(source.id) || `score-${crypto.randomUUID()}`,
      sourceFeedbackId: trim(source.sourceFeedbackId),
      recordType: trim(source.recordType) === 'paperAnalysis' ? 'paperAnalysis' : 'exitTest',
      scope: trim(source.scope) === 'oneOnOne' ? 'oneOnOne' : 'class',
      classId: trim(source.classId),
      className: trim(source.className),
      profileId: trim(source.profileId),
      studentName: trim(source.studentName),
      title: trim(source.title) || '课堂测评',
      subject: trim(source.subject),
      date: trim(source.date) || getTodayKey(),
      mode,
      totalScore: mode === 'grade' ? null : Math.max(1, Number(source.totalScore || 100)),
      students: Array.isArray(source.students) ? source.students.map((student) => {
        const studentSource = student && typeof student === 'object' ? student : {}
        const absent = Boolean(studentSource.absent)
        return {
          studentId: trim(studentSource.studentId),
          name: trim(studentSource.name),
          absent,
          score: absent || studentSource.score === '' || studentSource.score === null ? null : Number(studentSource.score),
          grade: absent ? '' : trim(studentSource.grade),
          note: trim(studentSource.note)
        }
      }).filter((student) => student.name) : [],
      createdAt: Number(source.createdAt || Date.now())
    }
  }) : []
}

function normalizeFeedbackHistory(history) {
  return Array.isArray(history) ? history.map((item) => {
    const source = item && typeof item === 'object' ? item : {}
    return {
      id: trim(source.id) || `history-${crypto.randomUUID()}`,
      mode: trim(source.mode) === 'oneOnOne' ? 'oneOnOne' : 'class',
      classId: trim(source.classId),
      className: trim(source.className),
      profileId: trim(source.profileId),
      studentName: trim(source.studentName),
      lessonTitle: trim(source.lessonTitle),
      lessonDate: trim(source.lessonDate),
      lessonDateText: trim(source.lessonDateText),
      feedbackScope: trim(source.feedbackScope) === 'class' ? 'class' : 'individual',
      feedbackFormat: trim(source.feedbackFormat) === 'image' ? 'image' : 'text',
      showScoreRateStatisticsInImage: source.showScoreRateStatisticsInImage !== false,
      courseNote: trim(source.courseNote),
      exitTest: source.exitTest && typeof source.exitTest === 'object' ? source.exitTest : null,
      feedbackExclusions: normalizeStudentExclusions(source.feedbackExclusions),
      attendanceExclusions: normalizeStudentExclusions(source.attendanceExclusions),
      feedbacks: Array.isArray(source.feedbacks) ? source.feedbacks.map((feedback) => ({
        studentId: trim(feedback && feedback.studentId),
        name: trim(feedback && feedback.name),
        feedback: trim(feedback && feedback.feedback)
      })).filter((feedback) => feedback.name || feedback.feedback) : [],
      createdAt: Number(source.createdAt || Date.now())
    }
  }) : []
}

function normalizeStudentExclusions(exclusions) {
  return Array.isArray(exclusions) ? exclusions.map((item) => ({
    studentId: trim(item && item.studentId),
    name: trim(item && item.name)
  })).filter((item) => item.studentId || item.name) : []
}

function normalizePaperAnalysisHistory(history) {
  return Array.isArray(history) ? history.map((item) => {
    const source = item && typeof item === 'object' ? item : {}
    return {
      id: trim(source.id) || `paper-${crypto.randomUUID()}`,
      title: trim(source.title) || '试卷分析',
      examType: trim(source.examType),
      fileName: trim(source.fileName),
      scope: ['class', 'one', 'single'].includes(trim(source.scope)) ? trim(source.scope) : 'single',
      classId: trim(source.classId),
      profileId: trim(source.profileId),
      targetName: trim(source.targetName),
      date: trim(source.date),
      totalScore: Number(source.totalScore || 0),
      classAverageTotal: Number(source.classAverageTotal || 0),
      sections: Array.isArray(source.sections) ? source.sections : [],
      questionAverages: source.questionAverages && typeof source.questionAverages === 'object' ? source.questionAverages : {},
      students: Array.isArray(source.students) ? source.students : [],
      summary: trim(source.summary),
      applied: Boolean(source.applied),
      createdAt: Number(source.createdAt || Date.now())
    }
  }).slice(0, 80) : []
}

function normalizeStringList(list, fallback = []) {
  const source = Array.isArray(list) && list.length ? list : fallback
  return source.map((item) => trim(item)).filter(Boolean).slice(0, 60)
}

async function requestTeachingTextAI(prompt, aiConfig) {
  if (aiConfig.provider === 'openai') {
    return requestOpenAIText(prompt, aiConfig)
  }

  return requestChatText(prompt, aiConfig, {
    providerLabel: aiConfig.provider === 'deepseek' ? 'DeepSeek' : 'AI'
  })
}

async function requestOpenAIText(prompt, aiConfig) {
  const body = {
    model: aiConfig.model,
    instructions: '你是一名专业、温和、具体的教学分析助手。请直接输出中文正文，不要使用 Markdown 表格。',
    input: prompt
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

  if (parsed.output_text) return trim(parsed.output_text)

  const output = Array.isArray(parsed.output) ? parsed.output : []
  return trim(output.flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((part) => part.text || '')
    .filter(Boolean)
    .join('\n')) || 'AI 暂未返回内容'
}

async function requestChatText(prompt, aiConfig, options = {}) {
  if (!aiConfig.baseUrl) {
    throw new Error('请先填写 API 端点 URL')
  }

  const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, withProxy({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aiConfig.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: aiConfig.model,
      messages: [
        {
          role: 'system',
          content: '你是一名专业、温和、具体的教学分析助手。请直接输出中文正文，不要使用 Markdown 表格。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.35,
      max_tokens: 1200,
      stream: false
    })
  }))

  const text = await response.text()
  const parsed = parseProviderResponseJson(text, options.providerLabel || 'AI')
  if (!response.ok) {
    const message = parsed.error && parsed.error.message ? parsed.error.message : text
    throw new Error(`${options.providerLabel || 'AI'} 请求失败：${message}`)
  }

  return trim(parsed.choices && parsed.choices[0] && parsed.choices[0].message
    ? parsed.choices[0].message.content
    : '') || 'AI 暂未返回内容'
}

function buildPolishPrompt(text, context) {
  return [
    '请把下面老师记录的课堂表现或教学建议润色成可直接写进家长反馈的中文表达。',
    '要求：保留原意，不夸大，不编造；语气专业、温和、具体；输出 120-220 字左右。',
    context ? `课程/学生背景：${context}` : '',
    '',
    '原始内容：',
    text
  ].filter(Boolean).join('\n')
}

function buildAnalysisPrompt(input) {
  const recordsText = JSON.stringify(input.records || [], null, 2).slice(0, 12000)
  const profileText = input.profile ? JSON.stringify(input.profile, null, 2) : '无'

  return [
    `请对${input.target || '学生/班级'}做教学分析。`,
    `分析类型：${input.analysisType === 'class' ? '班级整体' : '单个学生/一对一长期档案'}`,
    `科目/模块：${input.subject || '未填写'}`,
    '',
    '学生长期档案：',
    profileText,
    '',
    '成绩与反馈记录 JSON：',
    recordsText,
    '',
    '请输出：1. 整体表现判断；2. 成绩趋势；3. 可能薄弱点；4. 下次课建议；5. 可布置的具体任务。控制在 300 字以内。'
  ].join('\n')
}

function buildDemoPolishText(text) {
  return [
    '课堂表现整体较稳定，能够跟随老师完成主要学习任务。',
    `老师记录的重点情况是：${text}`,
    '后续建议继续保持课堂参与度，并在课后通过错题整理和同类题复盘巩固关键方法。'
  ].join('')
}

function buildDemoAnalysisText(target, records = []) {
  return [
    `${target} 近期共有 ${records.length} 条记录。整体看，学习状态需要结合课堂表现和测评结果持续观察。`,
    '建议下次课先回顾最近一次薄弱点，再安排 2-3 道同类变式题检查迁移能力；课后以错题复盘和基础概念口述为主，避免只做机械刷题。'
  ].join('')
}

async function requestPaperAnalysis(payload, courseware, aiConfig) {
  if (aiConfig.provider === 'openai') {
    return requestOpenAIPaperAnalysis(payload, courseware, aiConfig)
  }

  return requestChatPaperAnalysis(payload, courseware, aiConfig, {
    providerLabel: aiConfig.provider === 'deepseek' ? 'DeepSeek' : 'AI',
    thinkingDisabled: aiConfig.provider === 'deepseek'
  })
}

async function requestOpenAIPaperAnalysis(payload, courseware, aiConfig) {
  const body = {
    model: aiConfig.model,
    instructions: buildPaperAnalysisSystemPrompt(),
    input: [
      {
        role: 'user',
        content: buildPaperAnalysisContent(payload, courseware, 'responses')
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'paper_deep_analysis',
        strict: true,
        schema: getPaperAnalysisJsonSchema()
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

async function requestChatPaperAnalysis(payload, courseware, aiConfig, options = {}) {
  if (!aiConfig.baseUrl) throw new Error('请先填写 API 端点 URL')

  const includeImage = hasCoursewareVisionImages(courseware)
  const body = {
    model: aiConfig.model,
    messages: [
      {
        role: 'system',
        content: buildPaperAnalysisSystemPrompt()
      },
      {
        role: 'user',
        content: buildPaperAnalysisContent(payload, courseware, includeImage ? 'chat' : 'text')
      }
    ],
    temperature: 0.12,
    max_tokens: 8000,
    stream: false,
    response_format: {
      type: 'json_object'
    }
  }

  if (options.thinkingDisabled) {
    body.thinking = {
      type: 'disabled'
    }
  }

  try {
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
  } catch (error) {
    if (!includeImage || !isLikelyImageRequestError(error)) throw error
    body.messages[1].content = buildPaperAnalysisContent(payload, courseware, 'text')
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
}

function buildPaperAnalysisSystemPrompt() {
  return [
    '你是一名严谨的试卷结构分析和教学诊断助手。',
    '你要阅读老师上传的试卷/PDF/图片/Word 内容，提取题型结构、每道题题号、题分、难度系数、详细知识点，并给出针对每一道题的错题分析和改进方案。',
    '难度系数使用 0.00 到 1.00 的小数，越接近 1 表示越容易，越接近 0 表示越难。',
    '详细知识点要具体到可教学的粒度，例如“二次函数图像与最值”“三角形全等判定 SAS”“数列递推与通项”。',
    '题分必须是数字；如果原卷未明确标注题分，请根据题型和卷面结构合理估计，选择题/填空题常见 3-5 分，解答题常见 8-15 分。',
    '题型标题要按试卷原结构输出，例如“一、单选题”“二、填空题”“三、解答题”。',
    '不要输出学生得分，学生得分由老师后续录入。',
    '只返回 JSON，不要使用 Markdown，不要解释。'
  ].join('\n')
}

function buildPaperAnalysisContent(payload, courseware, target) {
  const text = [
    `试卷标题：${payload.title || payload.fileName || '未命名试卷'}`,
    `考试类型：${payload.examType || '未填写'}`,
    `上传文件：${payload.fileName || (courseware && courseware.name) || '未填写'}`,
    payload.pdfPageCount ? `PDF 页数：${payload.pdfPageCount}` : '',
    payload.imagePageCount ? `已转图片页数：${payload.imagePageCount}` : '',
    '',
    '请完成深度分析，严格返回以下 JSON 结构：',
    '{"title":"试卷标题","totalScore":100,"sections":[{"id":"s1","title":"一、单选题","questions":[{"id":"q1","number":"1","difficulty":0.82,"knowledge":"集合的基本运算","score":5,"analysis":"错因分析","improvement":"改进方案"}]}],"summary":"整张试卷的结构、重点和整体教学建议"}',
    '',
    buildPaperCoursewareText(courseware, target !== 'text')
  ].filter(Boolean).join('\n')

  const images = getCoursewareVisionImages(courseware)
  if (target === 'responses') {
    return [
      { type: 'input_text', text },
      ...images.map((image) => ({
        type: 'input_image',
        image_url: image.dataUrl,
        detail: 'high'
      }))
    ]
  }

  if (target === 'chat' && images.length) {
    return [
      { type: 'text', text },
      ...images.map((image) => ({
        type: 'image_url',
        image_url: {
          url: image.dataUrl
        }
      }))
    ]
  }

  return text
}

function buildPaperCoursewareText(courseware, includeImage) {
  if (!courseware) return '未读取到试卷内容。'
  const lines = []
  if (courseware.extractedText) {
    lines.push('试卷文字识别内容：')
    lines.push(truncateText(courseware.extractedText, 50000))
  }
  if (includeImage && hasCoursewareVisionImages(courseware)) {
    lines.push('试卷页面图片也已随消息发送，请结合图片中的题目、公式、图形和表格。')
  }
  if (!lines.length) {
    lines.push(`试卷文件：${courseware.name}。当前未提取到可用文字，请尽量结合文件/图片内容分析。`)
  }
  return lines.join('\n')
}

function getPaperAnalysisJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      totalScore: { type: 'number' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            questions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  number: { type: 'string' },
                  difficulty: { type: 'number' },
                  knowledge: { type: 'string' },
                  score: { type: 'number' },
                  analysis: { type: 'string' },
                  improvement: { type: 'string' }
                },
                required: ['id', 'number', 'difficulty', 'knowledge', 'score', 'analysis', 'improvement']
              }
            }
          },
          required: ['id', 'title', 'questions']
        }
      },
      summary: { type: 'string' }
    },
    required: ['title', 'totalScore', 'sections', 'summary']
  }
}

function parsePaperAnalysisResponse(response, provider) {
  if (provider === 'deepseek' || provider === 'custom') {
    const content = response.choices && response.choices[0] && response.choices[0].message
      ? response.choices[0].message.content
      : ''
    return parseJsonText(content)
  }

  if (response.output_text) return parseJsonText(response.output_text)

  const output = Array.isArray(response.output) ? response.output : []
  const text = output.flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((part) => part.text || '')
    .filter(Boolean)
    .join('\n')

  return parseJsonText(text)
}

function normalizePaperAnalysis(input, payload = {}) {
  const source = input && typeof input === 'object' ? input : {}
  let sections = Array.isArray(source.sections) ? source.sections : []
  if (!sections.length && Array.isArray(source.questions)) {
    sections = [{ id: 's1', title: '试卷题目', questions: source.questions }]
  }

  const normalizedSections = sections.map((section, sectionIndex) => {
    const questions = Array.isArray(section.questions) ? section.questions : []
    return {
      id: trim(section.id) || `s-${sectionIndex + 1}`,
      title: trim(section.title) || `题型 ${sectionIndex + 1}`,
      questions: questions.map((question, questionIndex) => normalizePaperQuestion(question, sectionIndex, questionIndex))
        .filter((question) => question.number)
    }
  }).filter((section) => section.questions.length)

  const safeSections = normalizedSections.length ? normalizedSections : buildDemoPaperAnalysis(payload, null).sections
  const totalScore = Number(source.totalScore)
  const computedTotal = safeSections.flatMap((section) => section.questions)
    .reduce((sum, question) => sum + question.score, 0)

  return {
    title: trim(source.title) || trim(payload.title) || '试卷分析',
    totalScore: Number.isFinite(totalScore) && totalScore > 0 ? totalScore : computedTotal,
    sections: safeSections,
    summary: trim(source.summary) || '本试卷已完成结构化分析，可结合学生逐题得分查看薄弱题型和后续改进方向。'
  }
}

function normalizePaperQuestion(question, sectionIndex, questionIndex) {
  const source = question && typeof question === 'object' ? question : {}
  const score = Number(source.score || source.points || source.fullScore || 1)
  const difficulty = Number(source.difficulty)
  return {
    id: trim(source.id) || `q-${sectionIndex + 1}-${questionIndex + 1}`,
    key: trim(source.key) || `${sectionIndex + 1}-${trim(source.number) || questionIndex + 1}`,
    number: trim(source.number) || String(questionIndex + 1),
    difficulty: Number.isFinite(difficulty) ? Math.max(0, Math.min(1, difficulty > 1 ? difficulty / 100 : difficulty)) : 0.75,
    knowledge: trim(source.knowledge || source.knowledgePoint || source.point) || '待补充知识点',
    score: Number.isFinite(score) && score > 0 ? score : 1,
    analysis: trim(source.analysis) || '该题主要考查对应知识点的理解和迁移，失分通常来自概念不清、步骤不完整或计算细节。',
    improvement: trim(source.improvement || source.suggestion) || '建议先复盘本题关键条件和方法，再完成 2-3 道同类变式题巩固。'
  }
}

function buildDemoPaperAnalysis(payload = {}, courseware = null) {
  const title = trim(payload.title) || (courseware && courseware.name) || '示例试卷'
  const sections = [
    {
      id: 's1',
      title: '一、单选题',
      questions: [
        { id: 'q1', key: '1-1', number: '1', difficulty: 0.92, knowledge: '基础概念辨析', score: 5, analysis: '错因多为概念边界不清或审题遗漏关键词。', improvement: '整理概念对照表，并用 3 道基础题检查辨析能力。' },
        { id: 'q2', key: '1-2', number: '2', difficulty: 0.84, knowledge: '公式直接应用', score: 5, analysis: '容易在代入公式时漏写条件或计算出错。', improvement: '训练公式适用条件和代入步骤，保留关键过程。' },
        { id: 'q3', key: '1-3', number: '3', difficulty: 0.76, knowledge: '图表信息读取', score: 5, analysis: '失分通常来自图表横纵信息对应不准确。', improvement: '先标注图表变量，再列式判断。' }
      ]
    },
    {
      id: 's2',
      title: '二、填空题',
      questions: [
        { id: 'q4', key: '2-4', number: '4', difficulty: 0.68, knowledge: '关键条件转化', score: 5, analysis: '该题需要把文字条件转成数学表达，过程跳步容易失分。', improvement: '练习“条件-式子-结论”的三栏整理法。' },
        { id: 'q5', key: '2-5', number: '5', difficulty: 0.61, knowledge: '综合计算与检验', score: 5, analysis: '常见问题是计算后没有回代检验，导致答案不完整。', improvement: '每题最后增加回代检查和单位/范围检查。' }
      ]
    },
    {
      id: 's3',
      title: '三、解答题',
      questions: [
        { id: 'q6', key: '3-6', number: '6', difficulty: 0.52, knowledge: '综合建模与规范书写', score: 10, analysis: '解答题既看思路也看步骤，失分集中在关键理由缺失。', improvement: '按“设、列、解、答”补全步骤，并训练规范表达。' }
      ]
    }
  ]

  return {
    title,
    totalScore: 35,
    sections,
    summary: '演示模式下生成了示例试卷结构。正式配置 AI 后，系统会读取上传试卷并输出真实题号、题分、知识点和每题改进建议。'
  }
}

async function requestPaperScoreRecognition(payload, courseware, aiConfig) {
  if (aiConfig.provider === 'openai') {
    return requestOpenAIPaperScoreRecognition(payload, courseware, aiConfig)
  }

  return requestChatPaperScoreRecognition(payload, courseware, aiConfig, {
    providerLabel: aiConfig.provider === 'deepseek' ? 'DeepSeek' : 'AI',
    thinkingDisabled: aiConfig.provider === 'deepseek'
  })
}

async function requestOpenAIPaperScoreRecognition(payload, courseware, aiConfig) {
  const body = {
    model: aiConfig.model,
    instructions: buildPaperScoreRecognitionSystemPrompt(),
    input: [
      {
        role: 'user',
        content: buildPaperScoreRecognitionContent(payload, courseware, 'responses')
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'paper_score_recognition',
        strict: true,
        schema: getPaperScoreRecognitionJsonSchema()
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

async function requestChatPaperScoreRecognition(payload, courseware, aiConfig, options = {}) {
  if (!aiConfig.baseUrl) throw new Error('请先填写 API 端点 URL')

  const includeImage = hasCoursewareVisionImages(courseware)
  const body = {
    model: aiConfig.model,
    messages: [
      {
        role: 'system',
        content: buildPaperScoreRecognitionSystemPrompt()
      },
      {
        role: 'user',
        content: buildPaperScoreRecognitionContent(payload, courseware, includeImage ? 'chat' : 'text')
      }
    ],
    temperature: 0.05,
    max_tokens: 4000,
    stream: false,
    response_format: {
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
  const parsed = parseProviderResponseJson(text, options.providerLabel || 'AI')
  if (!response.ok) {
    const message = parsed.error && parsed.error.message ? parsed.error.message : text
    throw new Error(`${options.providerLabel || 'AI'} 请求失败：${message}`)
  }
  return parsed
}

function buildPaperScoreRecognitionSystemPrompt() {
  return [
    '你是一名批改试卷得分识别助手。',
    '你要阅读老师上传的已批改试卷图片或 PDF，只识别每道题已经批改出的得分。',
    '老师会提供题号、题分、题目 key。请把识别到的得分填回对应 key。',
    '如果某题看不清、没有批改痕迹或无法确定，不要猜测，可以不返回该题。',
    '得分必须是数字，不能超过该题题分，不能小于 0。',
    '只返回 JSON，不要解释。'
  ].join('\n')
}

function buildPaperScoreRecognitionContent(payload, courseware, target) {
  const questions = Array.isArray(payload.questions) ? payload.questions : []
  const text = [
    `试卷标题：${payload.title || '试卷分析'}`,
    `考试类型：${payload.examType || '未填写'}`,
    `学生：${payload.student && payload.student.name ? payload.student.name : '未填写'}`,
    '',
    '题目清单 JSON：',
    JSON.stringify(questions.map((question) => ({
      key: question.key,
      number: question.number,
      sectionTitle: question.sectionTitle,
      score: question.score,
      knowledge: question.knowledge
    })), null, 2),
    '',
    '请识别上传批改图中每道题的实际得分，返回格式：',
    '{"scores":[{"key":"1-1","number":"1","score":5}],"warnings":[]}',
    '',
    buildPaperCoursewareText(courseware, target !== 'text')
  ].filter(Boolean).join('\n')

  const images = getCoursewareVisionImages(courseware)
  if (target === 'responses') {
    return [
      { type: 'input_text', text },
      ...images.map((image) => ({
        type: 'input_image',
        image_url: image.dataUrl,
        detail: 'high'
      }))
    ]
  }

  if (target === 'chat' && images.length) {
    return [
      { type: 'text', text },
      ...images.map((image) => ({
        type: 'image_url',
        image_url: {
          url: image.dataUrl
        }
      }))
    ]
  }

  return text
}

function getPaperScoreRecognitionJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string' },
            number: { type: 'string' },
            score: { type: 'number' }
          },
          required: ['key', 'number', 'score']
        }
      },
      warnings: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['scores', 'warnings']
  }
}

function parsePaperScoreRecognitionResponse(response, provider) {
  if (provider === 'deepseek' || provider === 'custom') {
    const content = response.choices && response.choices[0] && response.choices[0].message
      ? response.choices[0].message.content
      : ''
    return parseJsonText(content)
  }

  if (response.output_text) return parseJsonText(response.output_text)

  const output = Array.isArray(response.output) ? response.output : []
  const text = output.flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((part) => part.text || '')
    .filter(Boolean)
    .join('\n')

  return parseJsonText(text)
}

function normalizePaperScoreRecognition(input, payload = {}) {
  const questions = Array.isArray(payload.questions) ? payload.questions : []
  const maxScoreMap = new Map(questions.map((question) => [trim(question.key), Number(question.score || 0)]))
  const numberKeyMap = new Map(questions.map((question) => [trim(question.number), trim(question.key)]))
  const sourceScores = Array.isArray(input && input.scores) ? input.scores : []
  const scores = {}

  sourceScores.forEach((item) => {
    const key = trim(item && item.key) || numberKeyMap.get(trim(item && item.number))
    if (!key) return
    const maxScore = maxScoreMap.get(key)
    const value = Number(item && item.score)
    if (!Number.isFinite(value)) return
    scores[key] = Math.max(0, Math.min(Number.isFinite(maxScore) && maxScore > 0 ? maxScore : value, value))
  })

  return scores
}

function buildDemoPaperScoreRecognition(payload = {}) {
  const questions = Array.isArray(payload.questions) ? payload.questions : []
  const scores = {}
  questions.forEach((question) => {
    scores[question.key || question.number] = Number(question.score || 0)
  })
  return scores
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

async function normalizeCourseware(file, options = {}) {
  const originalName = normalizeUploadFileName(file.originalname, 'courseware')
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
  const rawExtractedText = shouldUseSelectedPdfPages
    ? clientPdfText
    : (extraction.text || clientPdfText)
  const extractedText = !isPdf && selectedPdfPages.length
    ? sliceTextByApproxPages(rawExtractedText, selectedPdfPages)
    : rawExtractedText
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

function sliceTextByApproxPages(text, selectedPages) {
  const source = trim(text)
  if (!source || !selectedPages.length) return source

  const pageSize = 1400
  const chunks = []
  for (let index = 0; index < source.length; index += pageSize) {
    chunks.push(source.slice(index, index + pageSize))
  }
  return selectedPages
    .map((pageNumber) => chunks[pageNumber - 1])
    .filter(Boolean)
    .join('\n')
    .trim() || source
}

function detectTextCoursewareLectures(text, options = {}) {
  const source = trim(text)
  const pageSize = 1400
  const estimatedPageCount = Math.max(1, Number(options.pageCount || 0), Math.ceil(source.length / pageSize) || 1)
  if (!source) {
    return {
      lectures: [],
      pageCount: estimatedPageCount
    }
  }

  const headings = []
  const lines = source.split(/\r?\n/)
  let offset = 0
  let sawContentsNearStart = false

  lines.forEach((rawLine) => {
    const raw = String(rawLine || '')
    const lineStart = offset
    offset += raw.length + 1

    const normalizedLine = raw.replace(/　/g, ' ').replace(/\s+/g, ' ').trim()
    if (!normalizedLine) return
    if (lineStart < pageSize * 3 && /目录|contents/i.test(normalizedLine)) sawContentsNearStart = true

    const pageLabelMatch = normalizedLine.match(/^第\s*(\d{1,4})\s*页\s*[:：、，.\-—_ ]*(.*)$/)
    const explicitPage = pageLabelMatch ? Number(pageLabelMatch[1]) : 0
    const contentLine = pageLabelMatch ? pageLabelMatch[2] : normalizedLine
    const pageNumber = explicitPage || Math.min(estimatedPageCount, Math.floor(lineStart / pageSize) + 1)
    const heading = matchTextLectureHeadingLine(contentLine, pageNumber)
      || matchTextLectureHeadingLine(normalizedLine, pageNumber)

    if (!heading) return

    const looksLikeContentsLine = sawContentsNearStart
      && lineStart < pageSize * 3
      && (/\.{2,}|…{2,}|[·•∙]{2,}|\s+\d{1,4}$/.test(normalizedLine))
    if (looksLikeContentsLine) return

    headings.push({
      ...heading,
      offset: lineStart
    })
  })

  return {
    lectures: buildTextLecturePageRanges(headings, estimatedPageCount),
    pageCount: estimatedPageCount
  }
}

function matchTextLectureHeadingLine(line, pageNumber) {
  if (!line || line.length > 160) return null

  const chineseMatch = line.match(/第\s*([零〇一二两三四五六七八九十百\d]{1,8})\s*(讲|课|章|节)\s*[:：、，.．\-—_ ]*\s*(.{0,80})$/)
  if (chineseMatch) {
    return buildTextLectureHeading({
      pageNumber,
      rawNumber: chineseMatch[1],
      unit: chineseMatch[2],
      marker: `第${chineseMatch[1]}${chineseMatch[2]}`,
      title: chineseMatch[3]
    })
  }

  const lessonMatch = line.match(/\b(Lesson|Lecture)\s*([0-9]{1,3})\s*[:：.．\-—_ ]*\s*(.{0,80})$/i)
  if (lessonMatch) {
    return buildTextLectureHeading({
      pageNumber,
      rawNumber: lessonMatch[2],
      unit: lessonMatch[1],
      marker: `${lessonMatch[1]} ${lessonMatch[2]}`,
      title: lessonMatch[3]
    })
  }

  const topicMatch = line.match(/专题\s*([零〇一二两三四五六七八九十百\d]{1,8})\s*[:：、，.．\-—_ ]*\s*(.{0,80})$/)
  if (topicMatch) {
    return buildTextLectureHeading({
      pageNumber,
      rawNumber: topicMatch[1],
      unit: '专题',
      marker: `专题${topicMatch[1]}`,
      title: topicMatch[2]
    })
  }

  return null
}

function buildTextLectureHeading({ pageNumber, rawNumber, unit, marker, title }) {
  const normalizedNumber = normalizeTextLectureNumber(rawNumber)
  const cleanTitle = cleanTextLectureHeadingTitle(title)
  const headingTitle = cleanTitle ? `${marker} ${cleanTitle}` : marker

  return {
    pageNumber,
    number: normalizedNumber,
    unit,
    key: normalizedNumber ? `${unit}-${normalizedNumber}` : `${unit}-${marker}`,
    title: headingTitle
  }
}

function cleanTextLectureHeadingTitle(value) {
  let title = String(value || '').replace(/\s+/g, ' ').trim()
  const nextHeadingIndex = title.search(/\s第\s*[零〇一二两三四五六七八九十百\d]{1,8}\s*(讲|课|章|节)/)
  if (nextHeadingIndex > 0) title = title.slice(0, nextHeadingIndex)

  return title
    .replace(/\.{2,}\s*\d{1,4}\s*$/, '')
    .replace(/…{2,}\s*\d{1,4}\s*$/, '')
    .replace(/[·•∙]{2,}\s*\d{1,4}\s*$/, '')
    .replace(/\s+(?:P\.?\s*)?\d{1,4}\s*$/i, '')
    .replace(/^[：:、，,.\-—_]+/, '')
    .trim()
    .slice(0, 60)
}

function normalizeTextLectureNumber(value) {
  const raw = String(value || '').trim()
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Number(raw)
  return chineseTextNumberToNumber(raw)
}

function chineseTextNumberToNumber(value) {
  const map = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  }
  const text = String(value || '').replace(/[零〇]/g, '')
  if (!text) return 0
  if (text.includes('百')) {
    const [hundredsText, restText = ''] = text.split('百')
    const hundreds = hundredsText ? map[hundredsText] || 0 : 1
    return hundreds * 100 + chineseTextNumberToNumber(restText)
  }
  if (text.includes('十')) {
    const [tensText, onesText = ''] = text.split('十')
    const tens = tensText ? map[tensText] || 0 : 1
    const ones = onesText ? map[onesText] || 0 : 0
    return tens * 10 + ones
  }
  return map[text] || 0
}

function buildTextLecturePageRanges(headings, pageCount) {
  const lectures = []

  headings
    .sort((left, right) => left.pageNumber - right.pageNumber || left.offset - right.offset)
    .forEach((heading) => {
      const previous = lectures[lectures.length - 1]
      if (previous && previous.key === heading.key) return
      const duplicatedIndex = lectures.findIndex((lecture) => lecture.key === heading.key)
      if (duplicatedIndex >= 0) {
        const duplicated = lectures[duplicatedIndex]
        const duplicatedLooksLikeContents = Number(duplicated.offset || 0) < 4200
          && Number(heading.offset || 0) > Number(duplicated.offset || 0)
        if (duplicatedLooksLikeContents) {
          lectures[duplicatedIndex] = {
            ...duplicated,
            startPage: Math.max(1, Math.min(pageCount, heading.pageNumber)),
            endPage: pageCount,
            offset: heading.offset
          }
        }
        return
      }

      lectures.push({
        key: heading.key,
        title: heading.title,
        startPage: Math.max(1, Math.min(pageCount, heading.pageNumber)),
        endPage: pageCount,
        offset: heading.offset
      })
    })

  if (lectures.length <= 1) return []

  return lectures.map((lecture, index) => ({
    key: lecture.key,
    title: lecture.title,
    startPage: lecture.startPage,
    endPage: lectures[index + 1] ? Math.max(lecture.startPage, lectures[index + 1].startPage - 1) : pageCount
  }))
}

async function normalizeCoursewareUploads(files, storedMaterialFile, payload = {}, pdfPageImages = []) {
  const uploadFiles = Array.isArray(files) ? files : []
  if (!uploadFiles.length && storedMaterialFile) {
    return normalizeCourseware(storedMaterialFile, {
      clientPdfText: payload.clientPdfText,
      pdfPageImages,
      selectedPdfPages: payload.selectedPdfPages
    })
  }

  const metaList = Array.isArray(payload.coursewareMeta) ? payload.coursewareMeta : []
  const coursewares = []
  for (let index = 0; index < uploadFiles.length; index += 1) {
    const file = uploadFiles[index]
    const meta = metaList[index] && typeof metaList[index] === 'object' ? metaList[index] : {}
    const fileImages = pdfPageImages.filter((imageFile) => String(imageFile.originalname || '').startsWith(`courseware-${index}-`))
    coursewares.push(await normalizeCourseware(file, {
      clientPdfText: meta.clientPdfText,
      pdfPageImages: fileImages,
      selectedPdfPages: meta.selectedPdfPages
    }))
  }

  if (coursewares.length <= 1) return coursewares[0] || null
  return combineCoursewares(coursewares)
}

function combineCoursewares(coursewares) {
  const valid = coursewares.filter(Boolean)
  return {
    name: valid.map((item) => item.name).join('、'),
    mime: 'application/x-multiple-courseware',
    buffer: Buffer.alloc(0),
    extractedText: valid.map((item, index) => [
      `【课件 ${index + 1}：${item.name}】`,
      item.extractedText || '未提取到可用文字，请结合图片或文件内容分析。'
    ].join('\n')).join('\n\n'),
    extractionSource: 'multiple-courseware',
    ocrPageCount: valid.reduce((sum, item) => sum + Number(item.ocrPageCount || 0), 0),
    selectedPdfPages: [],
    isImage: false,
    dataUrl: '',
    visionImages: valid.flatMap((item) => getCoursewareVisionImages(item)),
    imageSendAttempted: false,
    imageSendSucceeded: false,
    imageFallbackUsed: false,
    files: valid
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
                      learningSuggestion: { type: 'string' },
                      subject: { type: 'string' }
                    },
                    required: [
                      'courseContent',
                      'courseKnowledgePoint',
                      'performanceText',
                      'personalizedRemark',
                      'learningSuggestion',
                      'subject'
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
    '必须严格按学生数据里的 studentId 和 name 一一对应生成反馈，不能把一个学生的姓名、表现或备注写到另一个学生的反馈里。',
    '每条反馈正文只能出现当前这一个学生的姓名；不要提到其他学生姓名。',
    '老师提供的反馈模板是最高优先级的输出格式；除非模板为空，否则必须按模板的段落、顺序、称呼方式和固定句生成。',
    '模板优先于默认字数限制；如果模板较长，可以适当超过 220 个汉字。',
    '反馈要像老师写给家长的文字，具体、自然、可直接复制发送。',
    '不能编造课件或课堂中没有依据的细节；课件信息不足时，用课程主题和老师备注生成稳妥反馈。',
    '每个学生反馈建议 120 到 220 个汉字。',
    '每一条反馈必须包含：1 个本节课/课件里的具体知识点，1 个该学生的课堂表现等级，若老师填写了备注则必须自然写入备注。',
    '学生 remark、特殊情况和具体表现必须融入【课堂表现】的同一个连续段落，不能在课堂表现之后另起一行或另起一段重复说明。',
    '学生或班级选择的 keywords 也必须改写成自然语句并融入【课堂表现】同一段；不能单独输出“关键词”“表现关键词”标题，也不能把关键词原样另起一行罗列。',
    'templateFields.performanceText 必须已经包含该学生 remark 的核心信息；personalizedRemark 只用于结构化记录，不能作为独立段落再次输出。',
    '如果老师提供了“本次生成要求”，只在当前请求中按其调整语气、详略、重点和写法；不得因此违反模板、事实准确性、学生姓名对应和必填结构。',
    '如果反馈类型是班级整体反馈，请面向整个班级生成课堂表现总结，不要写成单个学生逐条反馈。',
    '如果提供了上课日期，可以自然使用；如果上课时段为空或未填写，任何文字反馈和图片报告文案都不要出现时段，也不要自行编造时段。',
    '如果提供了出门测成绩，必须写入反馈：个性化学生反馈只写当前学生自己的成绩；班级整体反馈要按从高到低列出全班所有学生成绩。',
    '出门测标记 absent/请假的学生只显示“请假”，不得写成 0 分，也不得计入平均分、最高分、最低分或得分率。',
    '如果提供了出门测文件内容，请结合文件里的测试知识点、题型或讲次内容评价学习情况；不要只写分数。',
    '如果反馈呈现形式是图片报告文案，请语言更适合放入报告里的“课堂表现”段落，结构清晰、少寒暄。',
    '如果反馈正文、标题或模板字段涉及科目/学科，必须根据上传课件、讲义或试卷内容判断正确科目；不能默认写数学。无法可靠判断科目时，不要主动写具体科目。',
    '一对一反馈里如果包含 personality 或 habit，要把它们作为长期档案背景，用自然、克制的方式融入建议，不要写得像诊断。',
    '所有未填写、未上传、为空的内容都视为不存在，反馈正文里不要提及这些空内容，也不要用“未填写”“未上传”等字样。',
    '不同学生的反馈必须根据 performance、keywords、remark、personality 和 habit 明显区分，不允许只替换姓名。'
  ].join('\n')
}

function buildUserContent(payload, courseware) {
  const exitTestPromptText = formatExitTestSummary(payload)
  const content = [
    {
      type: 'input_text',
      text: [
        `课程类型：${payload.mode === 'oneOnOne' ? '一对一' : '班课'}`,
        `反馈类型：${payload.feedbackScope === 'class' ? '班级整体反馈' : '个性化学生反馈'}`,
        `反馈呈现形式：${payload.feedbackFormat === 'image' ? '图片报告文案' : '文字反馈'}`,
        payload.className ? `班级/课程：${payload.className}` : '',
        payload.grade ? `年级：${payload.grade}` : '',
        payload.lessonTitle ? `课程主题：${payload.lessonTitle}` : '',
        (payload.lessonDateText || payload.lessonDate) ? `上课日期：${payload.lessonDateText || payload.lessonDate}` : '',
        payload.timeSlot ? `上课时段：${payload.timeSlot}` : '',
        '',
        '老师提供的反馈模板：',
        payload.template || '请根据学生本节课表现生成反馈。',
        '',
        getTemplateRules(),
        '',
        payload.generationInstruction
          ? `老师对本次生成的临时要求（仅本次有效）：\n${payload.generationInstruction}`
          : '',
        '',
        payload.courseNote ? `老师补充的课程内容：\n${payload.courseNote}` : '',
        payload.classRemark ? `班级/共性备注：${payload.classRemark}` : '',
        payload.homework ? `课后作业：${payload.homework}` : '',
        '',
        exitTestPromptText ? `出门测信息：\n${exitTestPromptText}` : '',
        '',
        '学生表现数据 JSON：',
        JSON.stringify(payload.students, null, 2),
        '',
        '请严格返回 JSON，字段为 feedbacks，每项包含 studentId、name、feedback、templateFields。',
        'studentId 必须原样使用学生表现数据 JSON 中对应学生的 id，name 必须原样使用对应学生的 name。',
        'templateFields 必须包含 courseContent、courseKnowledgePoint、performanceText、personalizedRemark、learningSuggestion、subject；subject 是根据课件判断的科目，无法判断时填空字符串。',
        payload.feedbackFormat === 'image'
          ? '图片报告文案必须包含从课件深度解析得到的【课程内容】和【学习重点】：【课程内容】用一句不带编号、不列点的完整句子总结本节课件；【学习重点】用 1、2、3 分行列出核心重点。不要用上课日期、时段、课后作业或“教材讲次”替代课程内容。'
          : '',
        'feedback 必须先套用老师模板，再结合课程内容、课件和该学生表现补全。',
        '生成每个学生 feedback 前先核对：正文里只能出现当前学生姓名，不能出现其他学生姓名。',
        '每个 feedback 都必须明确体现对应学生的 performance；keywords 与 remark 非空时，必须把其核心信息改写成自然语句并融入【课堂表现】同一段，不能另起一行、单列关键词或重复。',
        '一对一学生数据里若 personality 或 habit 非空，必须结合这些长期档案信息给出更贴合该学生的表达和建议。',
        '每个 feedback 至少写入 1 个本节课/课件中的具体知识点。',
        '不同学生不要套用完全相同的句子。',
        '返回 JSON 前逐条自检：每条 feedback 是否保留了模板结构和固定句；不符合就先重写再返回。'
      ].filter(Boolean).join('\n')
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
  }
  const exitTestPromptText = formatExitTestSummary(payload)

  return [
    `课程类型：${payload.mode === 'oneOnOne' ? '一对一' : '班课'}`,
    `反馈类型：${payload.feedbackScope === 'class' ? '班级整体反馈' : '个性化学生反馈'}`,
    `反馈呈现形式：${payload.feedbackFormat === 'image' ? '图片报告文案' : '文字反馈'}`,
    payload.className ? `班级/课程：${payload.className}` : '',
    payload.grade ? `年级：${payload.grade}` : '',
    payload.lessonTitle ? `课程主题：${payload.lessonTitle}` : '',
    (payload.lessonDateText || payload.lessonDate) ? `上课日期：${payload.lessonDateText || payload.lessonDate}` : '',
    payload.timeSlot ? `上课时段：${payload.timeSlot}` : '',
    '',
    '老师提供的反馈模板：',
    payload.template || '请根据学生本节课表现生成反馈。',
    '',
    getTemplateRules(),
    '',
    payload.generationInstruction
      ? `老师对本次生成的临时要求（仅本次有效）：\n${payload.generationInstruction}`
      : '',
    '',
    payload.courseNote ? `老师补充的课程内容：\n${payload.courseNote}` : '',
    payload.classRemark ? `班级/共性备注：${payload.classRemark}` : '',
    payload.homework ? `课后作业：${payload.homework}` : '',
    '',
    exitTestPromptText ? `出门测信息：\n${exitTestPromptText}` : '',
    '',
    coursewareLines.length ? `课件内容：\n${coursewareLines.join('\n')}` : '',
    '',
    '学生表现数据 JSON：',
    JSON.stringify(payload.students, null, 2),
    '',
    '请严格返回 JSON，且只能返回 JSON，不要解释，不要使用 Markdown。',
    'JSON 格式必须是：{"feedbacks":[{"studentId":"...","name":"...","feedback":"...","templateFields":{"courseContent":"...","courseKnowledgePoint":"...","performanceText":"...","personalizedRemark":"...","learningSuggestion":"...","subject":"..."}}]}',
    'studentId 必须原样使用学生表现数据 JSON 中对应学生的 id，name 必须原样使用对应学生的 name。',
    'templateFields 会被程序填入老师模板，所以每个字段都必须针对该学生具体填写，不能空泛；如果能从课件判断科目，请在 templateFields.subject 写入正确科目。',
    payload.feedbackFormat === 'image'
      ? '图片报告文案必须包含从课件深度解析得到的【课程内容】和【学习重点】：【课程内容】用一句不带编号、不列点的完整句子总结本节课件；【学习重点】用 1、2、3 分行列出核心重点。不要用上课日期、时段、课后作业或“教材讲次”替代课程内容。'
      : '',
    'feedback 必须先套用老师模板，再结合课程内容、课件和该学生表现补全。',
    '生成每个学生 feedback 前先核对：正文里只能出现当前学生姓名，不能出现其他学生姓名。',
    '每个 feedback 都必须明确体现对应学生的 performance；keywords 与 remark 非空时，必须把其核心信息改写成自然语句并融入【课堂表现】同一段，不能另起一行、单列关键词或重复。',
    '一对一学生数据里若 personality 或 habit 非空，必须结合这些长期档案信息给出更贴合该学生的表达和建议。',
    '每个 feedback 至少写入 1 个本节课/课件中的具体知识点。',
    '不同学生不要套用完全相同的句子。',
    '返回 JSON 前逐条自检：每条 feedback 是否保留了模板结构和固定句；不符合就先重写再返回。'
  ].filter(Boolean).join('\n')
}

function formatExitTestSummary(payload = {}) {
  const exitTest = payload.exitTest && typeof payload.exitTest === 'object' ? payload.exitTest : null
  const lines = []

  if (exitTest) {
    lines.push(`成绩制度：${exitTest.mode === 'grade' ? '等级制 A/B/C/D' : `分数制，满分 ${exitTest.totalScore || 100}`}`)
    if (exitTest.fileName) lines.push(`出门测文件：${exitTest.fileName}`)
    if (exitTest.selectedLecture) lines.push(`出门测讲次：${exitTest.selectedLecture}`)

    const students = Array.isArray(exitTest.students) ? exitTest.students : []
    if (students.length) {
      lines.push('学生成绩：')
      students.forEach((student) => {
        if (student.absent) {
          lines.push(`- ${student.name}：请假（不计入成绩统计）${student.note ? `；${student.note}` : ''}`)
        } else if (exitTest.mode === 'grade') {
          lines.push(`- ${student.name}：${student.grade || '-'}${student.note ? `；${student.note}` : ''}`)
        } else {
          lines.push(`- ${student.name}：${student.score ?? '-'}/${exitTest.totalScore || 100}${student.note ? `；${student.note}` : ''}`)
        }
      })
    }
  }

  const fileSummary = payload.exitTestFile && typeof payload.exitTestFile === 'object' ? payload.exitTestFile : null
  if (fileSummary && fileSummary.extractedText) {
    lines.push('出门测文件识别内容：')
    lines.push(fileSummary.extractedText)
  }

  return lines.length ? lines.join('\n') : ''
}

function buildUploadedFileSummary(courseware) {
  return {
    name: courseware.name,
    mime: courseware.mime,
    extractionSource: courseware.extractionSource,
    selectedPdfPages: courseware.selectedPdfPages,
    extractedText: courseware.extractedText ? courseware.extractedText.slice(0, 8000) : ''
  }
}

function getTemplateRules() {
  return [
    '模板使用规则（必须遵守）：',
    '1. 反馈模板是每条 feedback 的正文骨架，不是参考风格。',
    '2. 必须尽量保留模板原有段落、句子顺序、称呼方式和固定文字；只替换模板里的占位符、括号提示或明显需要补充的位置。',
    '3. 常见占位符含义：{{学生姓名}}=当前学生姓名；{{课程内容}}/{{课程主题}}=课程主题、课件知识点和老师补充内容；{{课堂表现}}=该学生 performance、keywords 和 remark 融合后的自然段；{{个性化备注}}/{{特殊情况}}=remark、personality 或 habit；{{学习建议}}=结合课堂表现给出的后续建议。',
    '4. 如果模板没有占位符，也必须按照模板原有句式和段落改写，不要另起一套反馈格式。',
    '5. 如果模板和默认字数要求冲突，以模板为准。'
  ].join('\n')
}

function getCoursewareTextLabel(courseware) {
  if (courseware.mime === 'application/x-multiple-courseware') {
    return '老师上传了多个课件/讲义。每个文件内容如下，请逐个分析后综合生成反馈：'
  }
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

  const repairedText = repairJsonLatexBackslashes(cleanText)
  const parsed = tryParseJson(cleanText) || tryParseJson(repairedText)
  if (parsed) return parsed

  const jsonText = extractFirstJsonObject(cleanText)
  if (jsonText) {
    const extracted = tryParseJson(jsonText) || tryParseJson(repairJsonLatexBackslashes(jsonText))
    if (extracted) return extracted
  }

  return { feedbacks: [], questions: [], scores: [] }
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

function repairJsonLatexBackslashes(text) {
  return String(text || '').replace(
    /(^|[^\\])\\(frac|dfrac|tfrac|sqrt|left|right|times|cdot|leq|le|ge|geq|neq|approx|infty|pi|theta|alpha|beta|gamma|Delta|sum|int|tan|sin|cos|log|ln|text|overline|angle|parallel|perp|rangle|langle|begin|end)/g,
    '$1\\\\$2'
  )
}

function buildNonJsonAIResponseMessage(text, providerLabel) {
  const preview = String(text || '').replace(/\s+/g, ' ').slice(0, 220)
  return `${providerLabel || 'AI'} 返回内容无法解析，请稍后重试。返回片段：${preview}`
}

function normalizeFeedbacks(feedbacks, students, payload = {}) {
  const list = Array.isArray(feedbacks) ? feedbacks : []
  const matchedByStudentId = matchFeedbacksByStudent(students, list)

  return students.map((student) => {
    const matched = matchedByStudentId.get(student.id)
    const fallback = buildFallbackFeedback(student, payload)
    const modelFeedback = trim(matched && matched.feedback) || fallback
    const templateFields = normalizeTemplateFields(matched && matched.templateFields, student, payload, modelFeedback)
    const templatedFeedback = applyFeedbackTemplate(payload.template, student, payload, matched, modelFeedback)
    const integratedFeedback = normalizeFeedbackPerformanceParagraph(
      templatedFeedback || modelFeedback,
      templateFields.performanceText,
      student
    )
    const feedback = sanitizeFeedbackStudentNames(integratedFeedback, student, students)

    return {
      studentId: student.id,
      name: student.name,
      feedback,
      templateFields
    }
  })
}

function matchFeedbacksByStudent(students, feedbacks) {
  const matches = new Map()
  const usedItems = new Set()
  const studentIds = new Set(students.map((student) => student.id).filter(Boolean))

  students.forEach((student) => {
    const itemIndex = feedbacks.findIndex((feedback, index) => {
      return !usedItems.has(index) && trim(feedback && feedback.studentId) === student.id
    })

    if (itemIndex < 0) return
    matches.set(student.id, feedbacks[itemIndex])
    usedItems.add(itemIndex)
  })

  students.forEach((student) => {
    if (matches.has(student.id)) return

    const itemIndex = feedbacks.findIndex((feedback, index) => {
      if (usedItems.has(index)) return false

      const feedbackStudentId = trim(feedback && feedback.studentId)
      if (feedbackStudentId && studentIds.has(feedbackStudentId)) return false

      return trim(feedback && feedback.name) === student.name
    })

    if (itemIndex < 0) return

    matches.set(student.id, feedbacks[itemIndex])
    usedItems.add(itemIndex)
  })

  return matches
}

function sanitizeFeedbackStudentNames(feedback, currentStudent, students) {
  let text = trim(feedback)
  if (!text) return text

  const currentName = trim(currentStudent && currentStudent.name)
  if (!currentName) return text

  students
    .map((student) => trim(student && student.name))
    .filter((name) => name && name !== currentName && name.length >= 2)
    .sort((left, right) => right.length - left.length)
    .forEach((name) => {
      text = text.replace(new RegExp(escapeRegExp(name), 'g'), currentName)
    })

  return text
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildDemoFeedbacks(payload) {
  return normalizeFeedbacks([], payload.students, payload)
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
  const personalizedRemark = trim(fields.personalizedRemark) || personalizedFallback
  let performanceText = trim(fields.performanceText) || performanceFallback
  performanceText = mergeStudentRemarkIntoPerformance(performanceText, student.keywords)
  performanceText = mergeStudentRemarkIntoPerformance(performanceText, student.remark)

  return {
    courseContent: trim(fields.courseContent) || courseContentFallback,
    courseKnowledgePoint: trim(fields.courseKnowledgePoint) || courseContentFallback,
    performanceText,
    personalizedRemark,
    learningSuggestion: trim(fields.learningSuggestion) || buildAdviceFallback(student),
    subject: trim(fields.subject),
    modelFeedback: trim(modelFeedback)
  }
}

function normalizeFeedbackPerformanceParagraph(feedback, performanceText, student = {}) {
  const source = trim(feedback)
  if (!source) return source

  const extractedDetails = []
  let normalizedSource = source.replace(
    /【(?:表现关键词|课堂关键词|关键词|班级亮点关键词|班级需改进关键词|特殊情况|个性化备注|学生情况|备注)】([\s\S]*?)(?=【[^】]+】|$)/g,
    (section, content) => {
      if (trim(content)) extractedDetails.push(content)
      return ''
    }
  )

  normalizedSource = normalizedSource.replace(
    /(?:^|\n)\s*(?:表现关键词|课堂关键词|关键词|班级亮点关键词|班级需改进关键词|特殊情况|个性化备注|学生情况|备注)\s*[：:]\s*([^\n]*)/g,
    (section, content) => {
      if (trim(content)) extractedDetails.push(content)
      return ''
    }
  )

  const headingMatch = /【(?:课堂表现|学生表现)】/.exec(normalizedSource)
  const hasStructuredSections = /【[^】]+】/.test(normalizedSource)
  const mergeDetails = (base) => {
    let result = base
    ;[...extractedDetails, student.keywords, student.remark].forEach((detail) => {
      result = mergeStudentRemarkIntoPerformance(result, detail)
    })
    return result
  }

  if (!headingMatch) {
    const detailText = [...extractedDetails, student.keywords, student.remark]
      .map((detail) => trim(detail))
      .filter(Boolean)

    if (!detailText.length) return normalizedSource.trim()

    if (hasStructuredSections) {
      const performanceBody = mergeDetails(trim(performanceText) || '本节课课堂表现稳定')
      return [normalizedSource.trim(), '【课堂表现】', performanceBody]
        .filter(Boolean)
        .join('\n')
        .trim()
    }

    return mergeDetails(normalizedSource.trim() || performanceText)
  }

  const bodyStart = headingMatch.index + headingMatch[0].length
  const remaining = normalizedSource.slice(bodyStart)
  const nextHeadingOffset = remaining.search(/【[^】]+】/)
  const body = nextHeadingOffset >= 0 ? remaining.slice(0, nextHeadingOffset) : remaining
  const suffix = nextHeadingOffset >= 0 ? remaining.slice(nextHeadingOffset) : ''
  const mergedBody = mergeDetails(dedupeFeedbackParagraph(body) || performanceText)

  return [
    normalizedSource.slice(0, bodyStart).trimEnd(),
    mergedBody,
    suffix.trimStart()
  ].filter(Boolean).join('\n').trim()
}

function dedupeFeedbackParagraph(value) {
  const tokens = normalizeInlineFeedbackText(value).split(/([，,；;。！？!?]+)/)
  const seenParts = new Set()
  const output = []

  for (let index = 0; index < tokens.length; index += 2) {
    const part = trim(tokens[index])
    const punctuation = tokens[index + 1] || ''
    const comparable = normalizeFeedbackComparisonText(part)
    if (!part || (comparable && seenParts.has(comparable))) continue
    if (comparable) seenParts.add(comparable)
    output.push(`${part}${punctuation}`)
  }

  return normalizeInlineFeedbackText(output.join(' '))
    .replace(/\s+([，,；;。！？!?])/g, '$1')
    .replace(/([，,；;。！？!?])\s+/g, '$1')
    .replace(/[，,；;]$/, '。')
}

function mergeStudentRemarkIntoPerformance(performanceText, studentRemark) {
  const base = normalizeInlineFeedbackText(performanceText)
  const remark = normalizeInlineFeedbackText(studentRemark)
  if (!remark) return base

  const missingRemarkParts = remark
    .split(/[，,；;。！？!?]+/)
    .map((part) => trim(part))
    .filter(Boolean)
    .filter((part) => !isFeedbackDetailCovered(base, part))
  if (!missingRemarkParts.length) return base

  const missingRemark = missingRemarkParts.join('，')
  const integratedRemark = /^(课堂|本节课|该生|学生)/.test(missingRemark)
    ? missingRemark
    : `课堂中，${missingRemark}`
  return `${ensureChineseSentence(base)}${ensureChineseSentence(integratedRemark)}`
}

function normalizeInlineFeedbackText(value) {
  return trim(value)
    .replace(/\s*\r?\n+\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
}

function isFeedbackDetailCovered(text, detail) {
  const source = normalizeFeedbackComparisonText(text)
  const target = normalizeFeedbackComparisonText(detail)
  if (!target) return false
  if (source.includes(target)) return true

  const prefixLength = Math.min(target.length, Math.max(6, Math.floor(target.length * 0.55)))
  return target.length >= 6 && source.includes(target.slice(0, prefixLength))
}

function normalizeFeedbackComparisonText(value) {
  return normalizeInlineFeedbackText(value)
    .replace(/[，,。；;：:！？!?、（）()“”\"'\s]/g, '')
    .replace(/(?:本次|本节课|课堂中|课堂上|再)/g, '')
}

function ensureChineseSentence(value) {
  const text = normalizeInlineFeedbackText(value)
  if (!text) return ''
  return /[。！？!?]$/.test(text) ? text : `${text}。`
}

function getTemplateValue(key, fields, student, payload, modelFeedback) {
  const normalizedKey = trim(key).replace(/\s+/g, '')

  if (['学生姓名', '姓名', '学生'].includes(normalizedKey)) return student.name
  if (['年级'].includes(normalizedKey)) return payload.grade || ''
  if (['科目', '学科'].includes(normalizedKey)) return fields.subject || ''
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
  if (normalizedKey.includes('科目') || normalizedKey.includes('学科')) return fields.subject || ''
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
  const courseNote = sanitizeCourseNoteForCourseContent(payload.courseNote)
  return [
    payload.lessonTitle ? `“${payload.lessonTitle}”` : '',
    courseNote
  ].filter(Boolean).join('，') || '本节课重点内容'
}

function sanitizeCourseNoteForCourseContent(courseNote = '') {
  return String(courseNote || '')
    .split(/\r?\n/)
    .map((line) => trim(line))
    .filter(Boolean)
    .filter((line) => !/^(上课日期|上课时段|课后作业|班级\/共性备注|教材讲次)[：:]/.test(line))
    .join('\n')
}

function buildPerformanceFallback(student) {
  let performanceText = student.performance || '表现良好'
  performanceText = mergeStudentRemarkIntoPerformance(performanceText, student.keywords)
  return mergeStudentRemarkIntoPerformance(performanceText, student.remark)
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
  const schedule = buildFallbackScheduleText(payload)
  const performanceText = ensureChineseSentence(buildPerformanceFallback(student))
  const exitTestText = getFallbackExitTestText(student, payload)
  const advice = student.performance === '表现较差'
    ? '后续建议先把基础概念和典型题步骤补扎实，课后用少量高频题巩固。'
    : '后续建议继续整理本节课重点和错题，保持稳定练习节奏。'

  return `${student.name}同学${schedule}${lesson}${performanceText}${exitTestText}${advice}`
}

function buildFallbackScheduleText(payload = {}) {
  if (!payload.lessonDateText && !payload.lessonDate && !payload.timeSlot) return ''

  const dateText = payload.lessonDateText || payload.lessonDate || ''
  return payload.timeSlot
    ? `本次上课时间为${dateText} ${payload.timeSlot}，`
    : `本次上课日期为${dateText}，`
}

function getFallbackExitTestText(student, payload = {}) {
  if (student.exitTestScore === '请假') return '本次出门测请假，成绩不计入班级统计。'
  if (student.exitTestScore) return `出门测成绩为${student.exitTestScore}。`

  const rows = payload.exitTest && Array.isArray(payload.exitTest.students)
    ? payload.exitTest.students
    : []
  const row = rows.find((item) => item.name === student.name)
  if (!row) return ''
  if (row.absent) return '本次出门测请假，成绩不计入班级统计。'
  if (payload.exitTest.mode === 'grade') return row.grade ? `出门测等级为${row.grade}。` : ''
  return row.score !== null && row.score !== undefined && row.score !== ''
    ? `出门测成绩为${row.score}/${payload.exitTest.totalScore || 100}。`
    : ''
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
  if (fs.existsSync(OCR_BINARY_PATH)) {
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
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\s*\/>/g, ' ')
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

function normalizeUploadFileName(value, fallback = 'file') {
  const rawName = trim(value) || fallback
  const decodedName = Buffer.from(rawName, 'latin1').toString('utf8')

  if (!decodedName || decodedName.includes('�')) return rawName
  return getMojibakeScore(decodedName) < getMojibakeScore(rawName) ? decodedName : rawName
}

function getMojibakeScore(value) {
  return (String(value || '').match(/[ÃÂÄÅÆÇÈÉÒÓÔÕÖØÙÚÛÜÝÞßà-ÿ�]/g) || []).length
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
