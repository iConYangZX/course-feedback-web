const STORAGE_KEY = 'courseFeedback.web.classes'
const ONE_PROFILE_STORAGE_KEY = 'courseFeedback.web.oneProfiles'

const DEFAULT_TEMPLATE = [
  '亲爱的家长您好：',
  '{{学生姓名}}同学本节课主要学习了{{课程内容}}。',
  '课堂表现：{{课堂表现}}。',
  '个性化情况：{{个性化备注}}。',
  '后续建议：{{学习建议}}。',
  '整体来看，本节课反馈如下：'
].join('\n')

const performanceOptions = ['表现优秀', '表现良好', '表现较差']
const performanceClasses = {
  表现优秀: 'performance-excellent',
  表现良好: 'performance-good',
  表现较差: 'performance-poor'
}

const state = {
  mode: 'class',
  classes: [],
  oneProfiles: [],
  selectedClassId: '',
  selectedOneProfileId: '',
  editingClassId: '',
  editingOneProfileId: '',
  feedbacks: [],
  debug: null,
  oneLesson: {
    performance: '表现良好',
    remark: ''
  },
  access: {
    publicMode: false,
    accessRequired: false,
    authenticated: true,
    dailyLimit: 10,
    usage: null,
    user: null
  },
  adminUsers: [],
  pdfSelection: {
    fileKey: '',
    fileName: '',
    pageCount: 0,
    selectedPages: [],
    loading: false,
    isOpen: false,
    error: ''
  }
}

const els = {}

document.addEventListener('DOMContentLoaded', async () => {
  bindElements()
  loadClasses()
  loadOneProfiles()
  bindEvents()
  await checkAccessStatus()
  if (state.access.user && state.access.user.isAdmin) loadAdminUsers()
  checkServer()
  if (!state.access.publicMode) loadAIConfig()
  resetClassForm()
  resetOneProfileForm()
  fillClassForm(getSelectedClass())
  fillOneProfileForm(getSelectedOneProfile())
  render()
})

function bindElements() {
  Object.assign(els, {
    appShell: document.querySelector('#app'),
    accessGate: document.querySelector('#accessGate'),
    loginUsernameInput: document.querySelector('#loginUsernameInput'),
    loginPasswordInput: document.querySelector('#loginPasswordInput'),
    accessLoginBtn: document.querySelector('#accessLoginBtn'),
    accessMessage: document.querySelector('#accessMessage'),
    modeButtons: document.querySelectorAll('.mode-button'),
    adminEntry: document.querySelector('.admin-entry'),
    adminPanel: document.querySelector('#adminPanel'),
    refreshUsersBtn: document.querySelector('#refreshUsersBtn'),
    createUserBtn: document.querySelector('#createUserBtn'),
    newAccountUsernameInput: document.querySelector('#newAccountUsernameInput'),
    newAccountPasswordInput: document.querySelector('#newAccountPasswordInput'),
    newAccountLimitInput: document.querySelector('#newAccountLimitInput'),
    adminUserList: document.querySelector('#adminUserList'),
    configPanel: document.querySelector('#configPanel'),
    configProviderSelect: document.querySelector('#configProviderSelect'),
    configModelInput: document.querySelector('#configModelInput'),
    configBaseUrlInput: document.querySelector('#configBaseUrlInput'),
    configApiKeyInput: document.querySelector('#configApiKeyInput'),
    configProxyInput: document.querySelector('#configProxyInput'),
    configState: document.querySelector('#configState'),
    reloadConfigBtn: document.querySelector('#reloadConfigBtn'),
    saveConfigBtn: document.querySelector('#saveConfigBtn'),
    classList: document.querySelector('#classList'),
    oneProfileList: document.querySelector('#oneProfileList'),
    newClassBtn: document.querySelector('#newClassBtn'),
    newOneProfileBtn: document.querySelector('#newOneProfileBtn'),
    resetClassFormBtn: document.querySelector('#resetClassFormBtn'),
    resetOneProfileFormBtn: document.querySelector('#resetOneProfileFormBtn'),
    saveClassBtn: document.querySelector('#saveClassBtn'),
    saveOneProfileBtn: document.querySelector('#saveOneProfileBtn'),
    deleteClassBtn: document.querySelector('#deleteClassBtn'),
    deleteOneProfileBtn: document.querySelector('#deleteOneProfileBtn'),
    classNameInput: document.querySelector('#classNameInput'),
    gradeSelect: document.querySelector('#gradeSelect'),
    studentListInput: document.querySelector('#studentListInput'),
    templateInput: document.querySelector('#templateInput'),
    oneProfileNameInput: document.querySelector('#oneProfileNameInput'),
    oneProfileGradeSelect: document.querySelector('#oneProfileGradeSelect'),
    onePersonalityInput: document.querySelector('#onePersonalityInput'),
    oneHabitInput: document.querySelector('#oneHabitInput'),
    oneProfileTemplateInput: document.querySelector('#oneProfileTemplateInput'),
    oneProfileSummary: document.querySelector('#oneProfileSummary'),
    workspaceEyebrow: document.querySelector('#workspaceEyebrow'),
    workspaceTitle: document.querySelector('#workspaceTitle'),
    lessonTitleInput: document.querySelector('#lessonTitleInput'),
    coursewareInput: document.querySelector('#coursewareInput'),
    pdfPageSelectionBar: document.querySelector('#pdfPageSelectionBar'),
    pdfPageSelectionText: document.querySelector('#pdfPageSelectionText'),
    pdfPageSelectBtn: document.querySelector('#pdfPageSelectBtn'),
    pdfPageModal: document.querySelector('#pdfPageModal'),
    pdfPageModalTitle: document.querySelector('#pdfPageModalTitle'),
    pdfPageModalMeta: document.querySelector('#pdfPageModalMeta'),
    pdfPageGrid: document.querySelector('#pdfPageGrid'),
    pdfPageSelectAllBtn: document.querySelector('#pdfPageSelectAllBtn'),
    pdfPageSelectNoneBtn: document.querySelector('#pdfPageSelectNoneBtn'),
    pdfPageCancelBtn: document.querySelector('#pdfPageCancelBtn'),
    pdfPageConfirmBtn: document.querySelector('#pdfPageConfirmBtn'),
    pdfPageModalCloseBtn: document.querySelector('#pdfPageModalCloseBtn'),
    courseNoteInput: document.querySelector('#courseNoteInput'),
    studentCount: document.querySelector('#studentCount'),
    studentTable: document.querySelector('#studentTable'),
    generateBtn: document.querySelector('#generateBtn'),
    copyAllBtn: document.querySelector('#copyAllBtn'),
    resultNote: document.querySelector('#resultNote'),
    debugSummary: document.querySelector('#debugSummary'),
    resultList: document.querySelector('#resultList'),
    accountStatus: document.querySelector('#accountStatus'),
    usageStatus: document.querySelector('#usageStatus'),
    serverStatus: document.querySelector('#serverStatus'),
    logoutBtn: document.querySelector('#logoutBtn'),
    toast: document.querySelector('#toast')
  })
}

function bindEvents() {
  els.accessLoginBtn.addEventListener('click', loginWithAccessCode)
  els.loginPasswordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loginWithAccessCode()
  })
  els.loginUsernameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') els.loginPasswordInput.focus()
  })
  els.logoutBtn.addEventListener('click', logout)
  els.refreshUsersBtn.addEventListener('click', loadAdminUsers)
  els.createUserBtn.addEventListener('click', createAdminUser)
  els.adminUserList.addEventListener('click', handleAdminUserAction)

  els.modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode
      state.feedbacks = []
      state.debug = null
      render()
    })
  })

  els.newClassBtn.addEventListener('click', () => {
    resetClassForm()
    els.classNameInput.focus()
    showToast('可以建立新班级了')
  })

  els.newOneProfileBtn.addEventListener('click', () => {
    resetOneProfileForm()
    els.oneProfileNameInput.focus()
    showToast('可以建立新学生档案了')
  })

  els.resetClassFormBtn.addEventListener('click', resetClassForm)
  els.resetOneProfileFormBtn.addEventListener('click', resetOneProfileForm)
  els.saveClassBtn.addEventListener('click', saveClass)
  els.saveOneProfileBtn.addEventListener('click', saveOneProfile)
  els.reloadConfigBtn.addEventListener('click', loadAIConfig)
  els.saveConfigBtn.addEventListener('click', saveAIConfig)
  els.deleteClassBtn.addEventListener('click', deleteSelectedClass)
  els.deleteOneProfileBtn.addEventListener('click', deleteSelectedOneProfile)
  els.generateBtn.addEventListener('click', generateFeedback)
  els.copyAllBtn.addEventListener('click', copyAllFeedbacks)
  els.coursewareInput.addEventListener('change', handleCoursewareChange)
  els.pdfPageSelectBtn.addEventListener('click', openPdfPageSelection)
  els.pdfPageSelectAllBtn.addEventListener('click', selectAllPdfPages)
  els.pdfPageSelectNoneBtn.addEventListener('click', clearPdfPages)
  els.pdfPageCancelBtn.addEventListener('click', cancelPdfPageSelection)
  els.pdfPageConfirmBtn.addEventListener('click', confirmPdfPageSelection)
  els.pdfPageModalCloseBtn.addEventListener('click', closePdfPageModal)
  els.pdfPageModal.addEventListener('click', (event) => {
    if (event.target === els.pdfPageModal) closePdfPageModal()
  })
  els.pdfPageGrid.addEventListener('change', updatePdfPageSelectionFromGrid)

  els.classList.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-action="delete-class"]')
    if (deleteButton) {
      deleteClassById(deleteButton.dataset.id)
      return
    }

    const selectButton = event.target.closest('[data-action="select-class"]')
    if (!selectButton) return

    state.selectedClassId = selectButton.dataset.id
    state.feedbacks = []
    state.debug = null
    fillClassForm(getSelectedClass())
    render()
  })

  els.oneProfileList.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-action="delete-one-profile"]')
    if (deleteButton) {
      deleteOneProfileById(deleteButton.dataset.id)
      return
    }

    const selectButton = event.target.closest('[data-action="select-one-profile"]')
    if (!selectButton) return

    state.selectedOneProfileId = selectButton.dataset.id
    state.feedbacks = []
    state.debug = null
    fillOneProfileForm(getSelectedOneProfile())
    resetOneLesson()
    render()
  })

  els.studentTable.addEventListener('change', (event) => {
    if (event.target.matches('[data-field="performance"]')) {
      updateWorkingStudentField(Number(event.target.dataset.index), 'performance', event.target.value)
    }
  })

  els.studentTable.addEventListener('input', (event) => {
    if (event.target.matches('[data-field="remark"]')) {
      updateWorkingStudentField(Number(event.target.dataset.index), 'remark', event.target.value)
    }
  })

  els.resultList.addEventListener('click', (event) => {
    const copyButton = event.target.closest('[data-action="copy-feedback"]')
    if (!copyButton) return

    const item = state.feedbacks[Number(copyButton.dataset.index)]
    if (item) copyText(item.feedback, `${item.name} 的反馈已复制`)
  })
}

async function checkAccessStatus() {
  try {
    const response = await fetch('/api/access/status')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '读取访问状态失败')

    updateAccessState(data)
  } catch (error) {
    state.access.publicMode = false
    state.access.accessRequired = false
    state.access.authenticated = true
  }

  renderAccessState()
}

function updateAccessState(data = {}) {
  if ('publicMode' in data) state.access.publicMode = Boolean(data.publicMode)
  if ('accessRequired' in data) state.access.accessRequired = Boolean(data.accessRequired)
  if ('authenticated' in data) state.access.authenticated = Boolean(data.authenticated)
  if ('dailyLimit' in data && Number.isFinite(Number(data.dailyLimit))) {
    state.access.dailyLimit = Number(data.dailyLimit)
  }
  if ('usage' in data) state.access.usage = data.usage || null
  if ('user' in data) state.access.user = data.user || null
}

function renderAccessState() {
  const locked = state.access.accessRequired && !state.access.authenticated
  const isAdmin = Boolean(state.access.user && state.access.user.isAdmin)

  els.accessGate.classList.toggle('hidden', !locked)
  els.appShell.classList.toggle('locked', locked)
  els.configPanel.classList.toggle('hidden', state.access.publicMode)
  els.adminEntry.classList.toggle('hidden', !isAdmin)
  els.logoutBtn.classList.toggle('hidden', !state.access.authenticated || locked)
  renderAccountStatus()
  renderUsageStatus()

  if (!isAdmin && state.mode === 'admin') {
    state.mode = 'class'
    render()
  }

  if (locked) {
    window.setTimeout(() => els.loginUsernameInput.focus(), 50)
  }
}

function renderAccountStatus() {
  if (!state.access.authenticated || !state.access.user) {
    els.accountStatus.classList.add('hidden')
    els.accountStatus.textContent = ''
    return
  }

  els.accountStatus.classList.remove('hidden')
  els.accountStatus.textContent = state.access.user.isAdmin
    ? `${state.access.user.username} · 管理员`
    : `${state.access.user.username} · 普通用户`
}

function renderUsageStatus() {
  if (!state.access.publicMode || !state.access.authenticated || !state.access.usage) {
    els.usageStatus.classList.add('hidden')
    els.usageStatus.textContent = ''
    return
  }

  const usage = state.access.usage
  const used = Number(usage.used || 0)
  if (usage.unlimited) {
    els.usageStatus.classList.remove('hidden')
    els.usageStatus.classList.remove('exhausted')
    els.usageStatus.textContent = `今日已生成 ${used} 次 · 不限次数`
    return
  }

  const limit = Number(usage.limit || state.access.dailyLimit || 10)
  const remaining = Math.max(0, Number(usage.remaining ?? (limit - used)))

  els.usageStatus.classList.remove('hidden')
  els.usageStatus.classList.toggle('exhausted', remaining <= 0)
  els.usageStatus.textContent = `今日剩余 ${remaining} / ${limit} 次`
}

function showAccessMessage(message) {
  els.accessMessage.textContent = message || ''
}

async function loginWithAccessCode() {
  const username = els.loginUsernameInput.value.trim()
  const password = els.loginPasswordInput.value.trim()

  if (!username || !password) {
    showAccessMessage('请先输入账号和密码')
    return
  }

  els.accessLoginBtn.disabled = true
  showAccessMessage('正在验证...')

  try {
    const response = await fetch('/api/access/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    })
    const data = await response.json()

    if (!response.ok) throw new Error(data.error || '邀请码验证失败')

    updateAccessState({
      publicMode: data.publicMode ?? state.access.publicMode,
      accessRequired: data.accessRequired ?? state.access.accessRequired,
      authenticated: true,
      dailyLimit: data.dailyLimit,
      usage: data.usage,
      user: data.user
    })
    els.loginPasswordInput.value = ''
    showAccessMessage('')
    renderAccessState()
    if (state.access.user && state.access.user.isAdmin) loadAdminUsers()
    checkServer()
    showToast('已进入系统')
  } catch (error) {
    state.access.authenticated = false
    renderAccessState()
    showAccessMessage(error.message || '登录失败')
  } finally {
    els.accessLoginBtn.disabled = false
  }
}

async function logout() {
  try {
    await fetch('/api/access/logout', { method: 'POST' })
  } catch (error) {
    // Ignore network errors; the next status check will correct the UI.
  }

  state.access.authenticated = false
  state.access.user = null
  state.access.usage = null
  state.mode = 'class'
  render()
}

async function loadAdminUsers() {
  if (!state.access.user || !state.access.user.isAdmin) return

  try {
    const response = await fetch('/api/admin/users')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '读取账户失败')

    state.adminUsers = Array.isArray(data.users) ? data.users : []
    renderAdminUsers()
  } catch (error) {
    showToast(error.message || '读取账户失败')
  }
}

async function createAdminUser() {
  const payload = {
    username: els.newAccountUsernameInput.value.trim(),
    password: els.newAccountPasswordInput.value.trim(),
    dailyLimit: Number(els.newAccountLimitInput.value || 10),
    role: 'user',
    active: true
  }

  if (!payload.username || !payload.password) {
    showToast('请填写新账号和初始密码')
    return
  }

  try {
    els.createUserBtn.disabled = true
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '创建账号失败')

    els.newAccountUsernameInput.value = ''
    els.newAccountPasswordInput.value = ''
    els.newAccountLimitInput.value = '10'
    showToast('账号已创建')
    await loadAdminUsers()
  } catch (error) {
    showToast(error.message || '创建账号失败')
  } finally {
    els.createUserBtn.disabled = false
  }
}

async function handleAdminUserAction(event) {
  const button = event.target.closest('[data-admin-action]')
  if (!button) return

  const userId = button.dataset.id
  const action = button.dataset.adminAction
  const row = button.closest('.admin-user-card')
  const user = state.adminUsers.find((item) => item.id === userId)
  if (!row || !user) return

  if (action === 'save-user') {
    await saveAdminUser(row, user)
  }

  if (action === 'reset-usage') {
    await resetAdminUserUsage(user)
  }
}

async function saveAdminUser(row, user) {
  const payload = {
    active: row.querySelector('[data-admin-field="active"]').checked
  }

  const limitInput = row.querySelector('[data-admin-field="dailyLimit"]')
  const passwordInput = row.querySelector('[data-admin-field="password"]')

  if (!user.isAdmin) {
    payload.dailyLimit = Number(limitInput.value || 10)
  }

  if (passwordInput.value.trim()) {
    payload.password = passwordInput.value.trim()
  }

  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '保存账号失败')

    showToast('账号已保存')
    await loadAdminUsers()
  } catch (error) {
    showToast(error.message || '保存账号失败')
  }
}

async function resetAdminUserUsage(user) {
  const confirmed = window.confirm(`确定重置 ${user.username} 今日使用次数吗？`)
  if (!confirmed) return

  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/reset-usage`, {
      method: 'POST'
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '重置次数失败')

    showToast('今日次数已重置')
    await loadAdminUsers()
  } catch (error) {
    showToast(error.message || '重置次数失败')
  }
}

function renderAdminUsers() {
  if (!els.adminUserList) return

  if (!state.adminUsers.length) {
    els.adminUserList.innerHTML = '<div class="student-empty">暂无账户数据，点击刷新试试。</div>'
    return
  }

  els.adminUserList.innerHTML = state.adminUsers.map((user) => {
    const usage = user.usage || {}
    const usageText = usage.unlimited
      ? `今日已用 ${usage.used || 0} 次 / 不限次数`
      : `今日已用 ${usage.used || 0} 次，剩余 ${usage.remaining || 0} / ${usage.limit || user.dailyLimit || 10} 次`
    const roleText = user.isAdmin ? '管理员' : '普通用户'
    const statusText = user.active ? '启用中' : '已停用'

    return `
      <article class="admin-user-card">
        <div class="admin-user-head">
          <div>
            <div class="admin-user-name">${escapeHtml(user.username)}</div>
            <div class="admin-user-meta">${roleText} · ${statusText} · ${escapeHtml(usageText)}</div>
          </div>
          <button class="secondary-button" data-admin-action="reset-usage" data-id="${escapeHtml(user.id)}" type="button">重置今日次数</button>
        </div>
        <div class="form-grid three admin-user-controls">
          <label class="field checkbox-field">
            <span>账号状态</span>
            <label class="inline-check">
              <input data-admin-field="active" type="checkbox" ${user.active ? 'checked' : ''} />
              启用
            </label>
          </label>
          <label class="field">
            <span>每日次数</span>
            <input data-admin-field="dailyLimit" type="number" min="1" value="${user.dailyLimit || ''}" ${user.isAdmin ? 'disabled placeholder="不限"' : ''} />
          </label>
          <label class="field">
            <span>重设密码</span>
            <input data-admin-field="password" type="text" placeholder="留空则不修改" />
          </label>
        </div>
        <div class="panel-actions">
          <button class="primary-button" data-admin-action="save-user" data-id="${escapeHtml(user.id)}" type="button">保存账号</button>
        </div>
      </article>
    `
  }).join('')
}

async function checkServer() {
  try {
    const response = await fetch('/api/health')
    const data = await response.json()
    updateAccessState(data)

    els.serverStatus.classList.toggle('ready', data.hasApiKey)
    els.serverStatus.classList.toggle('demo', !data.hasApiKey)
    const providerName = getProviderName(data.provider)
    els.serverStatus.textContent = data.hasApiKey
      ? `后端已连接，当前使用：${providerName} / ${data.model}`
      : `后端已连接，未配置 ${providerName} API Key，生成时会返回演示反馈。`
    renderAccessState()
  } catch (error) {
    els.serverStatus.textContent = '后端未连接，请先启动本地服务。'
  }
}

async function loadAIConfig() {
  if (state.access.publicMode) {
    renderAccessState()
    return
  }

  try {
    const response = await fetch('/api/config')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '读取配置失败')

    els.configProviderSelect.value = data.provider || 'custom'
    els.configModelInput.value = data.model || ''
    els.configBaseUrlInput.value = data.baseUrl || ''
    els.configApiKeyInput.value = ''
    els.configProxyInput.value = data.proxyUrl || ''
    els.configState.textContent = data.hasApiKey ? '已保存密钥' : '未保存密钥'
    els.configState.classList.toggle('ready', data.hasApiKey)
    els.configState.classList.toggle('demo', !data.hasApiKey)
    checkServer()
  } catch (error) {
    showToast(error.message || '读取配置失败')
  }
}

async function saveAIConfig() {
  const payload = {
    provider: els.configProviderSelect.value,
    model: els.configModelInput.value.trim(),
    baseUrl: els.configBaseUrlInput.value.trim(),
    apiKey: els.configApiKeyInput.value.trim(),
    proxyUrl: els.configProxyInput.value.trim()
  }

  if (payload.provider === 'custom' && !payload.baseUrl) {
    showToast('请填写 API 端点 URL')
    return
  }

  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    const data = await response.json()

    if (!response.ok) throw new Error(data.error || '保存配置失败')

    els.configApiKeyInput.value = ''
    showToast('配置已保存，需要重启服务后生效')
    loadAIConfig()
  } catch (error) {
    showToast(error.message || '保存配置失败')
  }
}

function getProviderName(provider) {
  if (provider === 'deepseek') return 'DeepSeek'
  if (provider === 'custom') return '自定义接口'
  return 'OpenAI'
}

function loadClasses() {
  try {
    const classes = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    state.classes = Array.isArray(classes) ? classes : []
  } catch (error) {
    state.classes = []
  }

  if (!state.selectedClassId && state.classes.length) {
    state.selectedClassId = state.classes[0].id
  }
}

function loadOneProfiles() {
  try {
    const profiles = JSON.parse(localStorage.getItem(ONE_PROFILE_STORAGE_KEY) || '[]')
    state.oneProfiles = Array.isArray(profiles) ? profiles : []
  } catch (error) {
    state.oneProfiles = []
  }

  if (!state.selectedOneProfileId && state.oneProfiles.length) {
    state.selectedOneProfileId = state.oneProfiles[0].id
  }
}

function persistClasses() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.classes))
}

function persistOneProfiles() {
  localStorage.setItem(ONE_PROFILE_STORAGE_KEY, JSON.stringify(state.oneProfiles))
}

function render() {
  renderMode()
  renderClassList()
  renderOneProfileList()
  renderWorkspace()
  renderOneProfileSummary()
  renderStudentTable()
  renderResults()
  renderPdfPageSelection()
  renderAccessState()
}

function renderMode() {
  els.modeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === state.mode)
  })

  document.querySelectorAll('.class-only').forEach((element) => {
    element.classList.toggle('hidden', state.mode !== 'class')
  })

  document.querySelectorAll('.one-only').forEach((element) => {
    element.classList.toggle('hidden', state.mode !== 'oneOnOne')
  })

  document.querySelector('#feedbackPanel').classList.toggle('hidden', state.mode === 'admin')
  document.querySelector('#resultsPanel').classList.toggle('hidden', state.mode === 'admin')
  els.adminPanel.classList.toggle('hidden', state.mode !== 'admin')

  if (state.mode === 'admin' && state.access.user && state.access.user.isAdmin) {
    renderAdminUsers()
    if (!state.adminUsers.length) loadAdminUsers()
  }
}

function renderClassList() {
  if (!state.classes.length) {
    els.classList.innerHTML = '<div class="student-empty">还没有班级，先在右侧建立一个。</div>'
    return
  }

  els.classList.innerHTML = state.classes.map((classInfo) => `
    <div class="class-item ${classInfo.id === state.selectedClassId ? 'active' : ''}">
      <button class="class-item-main" data-action="select-class" data-id="${classInfo.id}" type="button">
        <div class="class-item-top">
          <div class="class-item-name">${escapeHtml(classInfo.name)}</div>
          <div class="class-item-grade">${escapeHtml(classInfo.grade)}</div>
        </div>
        <div class="class-item-meta">${classInfo.students.length} 名学生</div>
      </button>
      <button class="list-delete-button" data-action="delete-class" data-id="${classInfo.id}" type="button">删除</button>
    </div>
  `).join('')
}

function renderOneProfileList() {
  if (!state.oneProfiles.length) {
    els.oneProfileList.innerHTML = '<div class="student-empty">还没有学生档案，先建立一个。</div>'
    return
  }

  els.oneProfileList.innerHTML = state.oneProfiles.map((profile) => `
    <div class="class-item ${profile.id === state.selectedOneProfileId ? 'active' : ''}">
      <button class="class-item-main" data-action="select-one-profile" data-id="${profile.id}" type="button">
        <div class="class-item-top">
          <div class="class-item-name">${escapeHtml(profile.name)}</div>
          <div class="class-item-grade">${escapeHtml(profile.grade)}</div>
        </div>
        <div class="class-item-meta">${escapeHtml(getProfileMeta(profile))}</div>
      </button>
      <button class="list-delete-button" data-action="delete-one-profile" data-id="${profile.id}" type="button">删除</button>
    </div>
  `).join('')
}

function renderWorkspace() {
  const selectedClass = getSelectedClass()
  const selectedProfile = getSelectedOneProfile()

  if (state.mode === 'class') {
    els.workspaceEyebrow.textContent = 'Class Feedback'
    els.workspaceTitle.textContent = selectedClass ? `${selectedClass.name} 反馈` : '选择或建立班级'
    els.deleteClassBtn.disabled = !selectedClass
  } else {
    els.workspaceEyebrow.textContent = 'One-on-One Feedback'
    els.workspaceTitle.textContent = selectedProfile ? `${selectedProfile.name} 本节课反馈` : '选择或建立学生档案'
    els.deleteOneProfileBtn.disabled = !selectedProfile
  }
}

function renderOneProfileSummary() {
  if (!els.oneProfileSummary) return

  const profile = getSelectedOneProfile()

  if (!profile) {
    els.oneProfileSummary.innerHTML = '<div class="profile-summary-empty">请先在左侧选择或建立学生档案。</div>'
    return
  }

  els.oneProfileSummary.innerHTML = `
    <div>
      <div class="profile-summary-name">${escapeHtml(profile.name)} · ${escapeHtml(profile.grade)}</div>
      <div class="profile-summary-meta">性格：${escapeHtml(profile.personality || '未填写')}</div>
      <div class="profile-summary-meta">做题习惯：${escapeHtml(profile.habit || '未填写')}</div>
    </div>
  `
}

function renderStudentTable() {
  const students = getWorkingStudents()
  els.studentCount.textContent = `${students.length} 人`

  if (!students.length) {
    els.studentTable.innerHTML = state.mode === 'oneOnOne'
      ? '<div class="student-empty">暂无学生。请先选择或保存一个学生档案。</div>'
      : '<div class="student-empty">暂无学生。班课请先保存班级。</div>'
    return
  }

  els.studentTable.innerHTML = students.map((student, index) => `
    <div class="student-row">
      <div class="student-name" title="${escapeHtml(student.name)}">${escapeHtml(student.name)}</div>
      <select class="${performanceClasses[student.performance] || ''}" data-index="${index}" data-field="performance">
        ${performanceOptions.map((option) => `
          <option value="${option}" ${option === student.performance ? 'selected' : ''}>${option}</option>
        `).join('')}
      </select>
      <textarea data-index="${index}" data-field="remark" placeholder="备注特殊情况">${escapeHtml(student.remark || '')}</textarea>
      <span></span>
    </div>
  `).join('')
}

function renderResults() {
  els.copyAllBtn.disabled = !state.feedbacks.length
  els.resultNote.textContent = state.feedbacks.length ? `${state.feedbacks.length} 条反馈` : '生成后会显示在这里'
  renderDebugSummary()

  if (!state.feedbacks.length) {
    els.resultList.innerHTML = '<div class="result-empty">完成录入后点击“AI 生成反馈”。</div>'
    return
  }

  els.resultList.innerHTML = state.feedbacks.map((item, index) => `
    <article class="result-card">
      <div class="result-head">
        <div class="result-name">${escapeHtml(item.name)}</div>
        <button class="copy-button" data-action="copy-feedback" data-index="${index}" type="button">复制</button>
      </div>
      <p class="result-text">${escapeHtml(item.feedback)}</p>
    </article>
  `).join('')
}

function renderDebugSummary() {
  if (!els.debugSummary) return

  const debug = state.debug
  if (!debug || !state.feedbacks.length) {
    els.debugSummary.classList.add('hidden')
    els.debugSummary.innerHTML = ''
    return
  }

  const coursewareStatus = getCoursewareStatus(debug)

  els.debugSummary.classList.remove('hidden')
  els.debugSummary.innerHTML = [
    '<div class="debug-title">发送摘要</div>',
    '<div class="debug-grid">',
    `<span>学生：${debug.studentCount || 0} 人</span>`,
    `<span>备注：${debug.remarksCount || 0} 条</span>`,
    `<span>表现：${escapeHtml(formatPerformanceCounts(debug.performanceCounts))}</span>`,
    `<span>课件：${escapeHtml(coursewareStatus)}</span>`,
    '</div>',
    debug.coursewareTextPreview
      ? `<div class="debug-preview">课件文字预览：${escapeHtml(debug.coursewareTextPreview)}</div>`
      : ''
  ].join('')
}

function resetClassForm() {
  state.editingClassId = ''
  els.classNameInput.value = ''
  els.gradeSelect.value = '高一'
  els.studentListInput.value = ''
  els.templateInput.value = DEFAULT_TEMPLATE
}

function resetOneProfileForm() {
  state.editingOneProfileId = ''
  els.oneProfileNameInput.value = ''
  els.oneProfileGradeSelect.value = '高一'
  els.onePersonalityInput.value = ''
  els.oneHabitInput.value = ''
  els.oneProfileTemplateInput.value = DEFAULT_TEMPLATE
}

function resetOneLesson() {
  state.oneLesson = {
    performance: '表现良好',
    remark: ''
  }
}

function fillClassForm(classInfo) {
  if (!classInfo) {
    resetClassForm()
    return
  }

  state.editingClassId = classInfo.id
  els.classNameInput.value = classInfo.name
  els.gradeSelect.value = classInfo.grade
  els.studentListInput.value = classInfo.students.map((student) => student.name).join('\n')
  els.templateInput.value = classInfo.template || DEFAULT_TEMPLATE
}

function fillOneProfileForm(profile) {
  if (!profile) {
    resetOneProfileForm()
    return
  }

  state.editingOneProfileId = profile.id
  els.oneProfileNameInput.value = profile.name
  els.oneProfileGradeSelect.value = profile.grade
  els.onePersonalityInput.value = profile.personality || ''
  els.oneHabitInput.value = profile.habit || ''
  els.oneProfileTemplateInput.value = profile.template || DEFAULT_TEMPLATE
}

function saveClass() {
  const name = els.classNameInput.value.trim()
  const grade = els.gradeSelect.value
  const studentNames = parseStudentText(els.studentListInput.value)
  const template = els.templateInput.value.trim()

  if (!name) {
    showToast('请输入班级名称')
    return
  }

  if (!studentNames.length) {
    showToast('请导入学生名单')
    return
  }

  if (!template) {
    showToast('请输入反馈模板')
    return
  }

  const oldClass = state.editingClassId
    ? state.classes.find((item) => item.id === state.editingClassId)
    : null

  const students = studentNames.map((studentName) => {
    const existed = oldClass && oldClass.students.find((student) => student.name === studentName)
    return existed || {
      id: createId('stu'),
      name: studentName,
      performance: '表现良好',
      remark: ''
    }
  })

  const classInfo = {
    id: oldClass ? oldClass.id : createId('class'),
    name,
    grade,
    students,
    template,
    updatedAt: Date.now()
  }

  if (oldClass) {
    state.classes = state.classes.map((item) => item.id === oldClass.id ? classInfo : item)
  } else {
    state.classes.unshift(classInfo)
  }

  state.selectedClassId = classInfo.id
  state.editingClassId = classInfo.id
  state.feedbacks = []
  persistClasses()
  render()
  showToast('班级已保存')
}

function saveOneProfile() {
  const name = els.oneProfileNameInput.value.trim()
  const grade = els.oneProfileGradeSelect.value
  const personality = els.onePersonalityInput.value.trim()
  const habit = els.oneHabitInput.value.trim()
  const template = els.oneProfileTemplateInput.value.trim()

  if (!name) {
    showToast('请输入学生姓名')
    return
  }

  if (!template) {
    showToast('请输入反馈模板')
    return
  }

  const oldProfile = state.editingOneProfileId
    ? state.oneProfiles.find((item) => item.id === state.editingOneProfileId)
    : null

  const profile = {
    id: oldProfile ? oldProfile.id : createId('one'),
    name,
    grade,
    personality,
    habit,
    template,
    updatedAt: Date.now()
  }

  if (oldProfile) {
    state.oneProfiles = state.oneProfiles.map((item) => item.id === oldProfile.id ? profile : item)
  } else {
    state.oneProfiles.unshift(profile)
  }

  state.selectedOneProfileId = profile.id
  state.editingOneProfileId = profile.id
  state.feedbacks = []
  persistOneProfiles()
  render()
  showToast('学生档案已保存')
}

function deleteSelectedClass() {
  const selectedClass = getSelectedClass()
  if (!selectedClass) return

  deleteClassById(selectedClass.id)
}

function deleteClassById(classId) {
  const classInfo = state.classes.find((item) => item.id === classId)
  if (!classInfo) return

  const confirmed = window.confirm(`确定删除“${classInfo.name}”吗？`)
  if (!confirmed) return

  state.classes = state.classes.filter((item) => item.id !== classInfo.id)
  state.selectedClassId = state.classes[0] ? state.classes[0].id : ''
  state.editingClassId = state.selectedClassId
  state.feedbacks = []
  state.debug = null
  persistClasses()
  fillClassForm(getSelectedClass())
  render()
  showToast('班级已删除')
}

function deleteSelectedOneProfile() {
  const selectedProfile = getSelectedOneProfile()
  if (!selectedProfile) return

  deleteOneProfileById(selectedProfile.id)
}

function deleteOneProfileById(profileId) {
  const profile = state.oneProfiles.find((item) => item.id === profileId)
  if (!profile) return

  const confirmed = window.confirm(`确定删除“${profile.name}”的档案吗？`)
  if (!confirmed) return

  state.oneProfiles = state.oneProfiles.filter((item) => item.id !== profile.id)
  state.selectedOneProfileId = state.oneProfiles[0] ? state.oneProfiles[0].id : ''
  state.editingOneProfileId = state.selectedOneProfileId
  state.feedbacks = []
  state.debug = null
  resetOneLesson()
  persistOneProfiles()
  fillOneProfileForm(getSelectedOneProfile())
  render()
  showToast('学生档案已删除')
}

async function generateFeedback() {
  const payload = buildGeneratePayload()

  if (!payload) return

  const formData = new FormData()

  const file = els.coursewareInput.files && els.coursewareInput.files[0]

  setGenerating(true)

  try {
    if (file && isPdfFile(file)) {
      els.generateBtn.textContent = '正在读取 PDF...'
      await appendPdfPreviewData(formData, file, payload)
      els.generateBtn.textContent = 'AI 生成中...'
    }

    formData.append('payload', JSON.stringify(payload))
    if (file) formData.append('courseware', file)

    const response = await fetch('/api/generate-feedback', {
      method: 'POST',
      body: formData
    })
    const data = await response.json()

    if (response.status === 401) {
      updateAccessState({ authenticated: false })
      renderAccessState()
      showAccessMessage(data.error || '请先登录账号')
      throw new Error(data.error || '请先登录账号')
    }

    if (response.status === 429) {
      updateAccessState({ usage: data.usage || state.access.usage })
      renderAccessState()
      throw new Error(data.error || '今天的生成次数已用完')
    }

    if (!response.ok || data.error) {
      throw new Error(data.error || '生成失败')
    }

    if (data.usage) {
      updateAccessState({ usage: data.usage })
      renderAccessState()
    }

    state.feedbacks = Array.isArray(data.feedbacks) ? data.feedbacks : []
    state.debug = data.debug || null
    renderResults()
    showToast(data.demo ? (data.message || '已生成演示反馈，配置 API Key 后会调用 AI') : '反馈已生成')
    document.querySelector('#resultsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (error) {
    showToast(error.message || '生成失败')
  } finally {
    setGenerating(false)
  }
}

function buildGeneratePayload() {
  const lessonTitle = els.lessonTitleInput.value.trim()
  const courseNote = els.courseNoteInput.value.trim()

  if (state.mode === 'class') {
    const selectedClass = getSelectedClass()

    if (!selectedClass) {
      showToast('请先建立或选择班级')
      return null
    }

    if (!lessonTitle && !courseNote && !els.coursewareInput.files.length) {
      showToast('请填写课程主题、补充内容或导入课件')
      return null
    }

    const currentTemplate = els.templateInput.value.trim() || selectedClass.template

    return {
      mode: 'class',
      className: selectedClass.name,
      grade: selectedClass.grade,
      template: currentTemplate,
      lessonTitle,
      courseNote,
      students: selectedClass.students
    }
  }

  const selectedProfile = getSelectedOneProfile()

  if (!selectedProfile) {
    showToast('请先选择或保存学生档案')
    return null
  }

  if (!lessonTitle && !courseNote && !els.coursewareInput.files.length) {
    showToast('请填写课程主题、补充内容或导入课件')
    return null
  }

  const currentTemplate = els.oneProfileTemplateInput.value.trim()
    || selectedProfile.template
    || DEFAULT_TEMPLATE

  return {
    mode: 'oneOnOne',
    className: `${selectedProfile.name} 一对一`,
    grade: selectedProfile.grade,
    template: currentTemplate,
    lessonTitle,
    courseNote,
    students: [{
      id: selectedProfile.id,
      name: selectedProfile.name,
      performance: state.oneLesson.performance,
      remark: state.oneLesson.remark,
      personality: els.onePersonalityInput.value.trim() || selectedProfile.personality,
      habit: els.oneHabitInput.value.trim() || selectedProfile.habit
    }]
  }
}

function setGenerating(isGenerating) {
  els.generateBtn.disabled = isGenerating
  els.generateBtn.textContent = isGenerating ? 'AI 生成中...' : 'AI 生成反馈'
}

function isPdfFile(file) {
  return file && (
    file.type === 'application/pdf'
    || String(file.name || '').toLowerCase().endsWith('.pdf')
  )
}

async function handleCoursewareChange() {
  const file = getCoursewareFile()
  resetPdfPageSelection()

  if (file && isPdfFile(file)) {
    await loadPdfPageSelection(file, true)
    return
  }

  renderPdfPageSelection()
}

function getCoursewareFile() {
  return els.coursewareInput.files && els.coursewareInput.files[0]
}

function getFileKey(file) {
  if (!file) return ''
  return [file.name, file.size, file.lastModified].join(':')
}

function resetPdfPageSelection() {
  state.pdfSelection = {
    fileKey: '',
    fileName: '',
    pageCount: 0,
    selectedPages: [],
    loading: false,
    isOpen: false,
    error: ''
  }
}

async function loadPdfPageSelection(file, openWhenReady = false) {
  if (!window.pdfjsLib) {
    showToast('PDF 解析组件加载失败，请刷新页面重试')
    renderPdfPageSelection()
    return
  }

  state.pdfSelection = {
    fileKey: getFileKey(file),
    fileName: file.name,
    pageCount: 0,
    selectedPages: [],
    loading: true,
    isOpen: true,
    error: ''
  }
  renderPdfPageSelection()

  try {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
    const pageCount = pdf.numPages

    state.pdfSelection.pageCount = pageCount
    state.pdfSelection.selectedPages = Array.from({ length: pageCount }, (item, index) => index + 1)
    state.pdfSelection.loading = false
    state.pdfSelection.isOpen = openWhenReady
    renderPdfPageSelection()
  } catch (error) {
    state.pdfSelection.loading = false
    state.pdfSelection.error = error.message || 'PDF 页面读取失败'
    renderPdfPageSelection()
    showToast(state.pdfSelection.error)
  }
}

async function openPdfPageSelection() {
  const file = getCoursewareFile()
  if (!file || !isPdfFile(file)) return

  if (state.pdfSelection.fileKey !== getFileKey(file) || !state.pdfSelection.pageCount) {
    await loadPdfPageSelection(file, true)
    return
  }

  state.pdfSelection.isOpen = true
  renderPdfPageSelection()
}

function closePdfPageModal() {
  state.pdfSelection.isOpen = false
  renderPdfPageSelection()
}

function cancelPdfPageSelection() {
  els.coursewareInput.value = ''
  resetPdfPageSelection()
  renderPdfPageSelection()
  showToast('已取消上传 PDF')
}

function confirmPdfPageSelection() {
  syncPdfPageRangeInputs()

  if (!state.pdfSelection.selectedPages.length) {
    showToast('请至少选择 1 页 PDF')
    return
  }

  closePdfPageModal()
}

function selectAllPdfPages() {
  const pageCount = state.pdfSelection.pageCount
  state.pdfSelection.selectedPages = Array.from({ length: pageCount }, (item, index) => index + 1)
  renderPdfPageSelection()
}

function clearPdfPages() {
  state.pdfSelection.selectedPages = state.pdfSelection.pageCount ? [1] : []
  renderPdfPageSelection()
}

function updatePdfPageSelectionFromGrid(event) {
  if (!event.target.matches('[data-pdf-range-field]')) return

  syncPdfPageRangeInputs()
  renderPdfPageSelection()
}

function syncPdfPageRangeInputs() {
  const startInput = els.pdfPageGrid.querySelector('[data-pdf-range-field="start"]')
  const endInput = els.pdfPageGrid.querySelector('[data-pdf-range-field="end"]')
  if (!startInput || !endInput) return

  const pageCount = state.pdfSelection.pageCount
  const startPage = clampPageNumber(startInput && startInput.value, pageCount)
  const endPage = clampPageNumber(endInput && endInput.value, pageCount)
  const left = Math.min(startPage, endPage)
  const right = Math.max(startPage, endPage)

  state.pdfSelection.selectedPages = buildPageRange(left, right)
}

function renderPdfPageSelection() {
  if (!els.pdfPageSelectionBar || !els.pdfPageModal) return

  const file = getCoursewareFile()
  const hasPdf = Boolean(file && isPdfFile(file))

  els.pdfPageSelectionBar.classList.toggle('hidden', !hasPdf)

  if (hasPdf) {
    const selectedCount = state.pdfSelection.selectedPages.length
    const totalCount = state.pdfSelection.pageCount
    const summary = state.pdfSelection.loading
      ? `${file.name}：正在读取页面...`
      : `${file.name}：${selectedCount ? `读取第 ${formatPageRanges(state.pdfSelection.selectedPages)} 页（${selectedCount}/${totalCount || '?'} 页）` : '未选择页面'}`

    els.pdfPageSelectionText.textContent = summary
    els.pdfPageSelectBtn.disabled = state.pdfSelection.loading
  }

  renderPdfPageModal()
}

function renderPdfPageModal() {
  const selection = state.pdfSelection
  els.pdfPageModal.classList.toggle('hidden', !selection.isOpen)

  if (!selection.isOpen) return

  els.pdfPageModalTitle.textContent = selection.fileName || '选择 PDF 页面'
  els.pdfPageModalMeta.textContent = selection.loading
    ? '正在读取 PDF...'
    : (selection.error || `共 ${selection.pageCount} 页，当前读取第 ${formatPageRanges(selection.selectedPages)} 页（${selection.selectedPages.length} 页）`)

  els.pdfPageSelectAllBtn.disabled = selection.loading || !selection.pageCount
  els.pdfPageSelectNoneBtn.disabled = selection.loading || !selection.pageCount
  els.pdfPageConfirmBtn.disabled = selection.loading || !selection.selectedPages.length

  if (selection.loading) {
    els.pdfPageGrid.innerHTML = '<div class="student-empty">正在读取 PDF 页面...</div>'
    return
  }

  if (selection.error) {
    els.pdfPageGrid.innerHTML = `<div class="student-empty">${escapeHtml(selection.error)}</div>`
    return
  }

  const startPage = selection.selectedPages[0] || 1
  const endPage = selection.selectedPages[selection.selectedPages.length - 1] || selection.pageCount || 1
  els.pdfPageGrid.innerHTML = `
    <div class="pdf-page-range">
      <label class="field pdf-page-range-field">
        <span>开始页</span>
        <input data-pdf-range-field="start" type="number" min="1" max="${selection.pageCount}" value="${startPage}" />
      </label>
      <label class="field pdf-page-range-field">
        <span>结束页</span>
        <input data-pdf-range-field="end" type="number" min="1" max="${selection.pageCount}" value="${endPage}" />
      </label>
    </div>
  `
}

function getSelectedPdfPages(file, pageCount) {
  if (state.pdfSelection.fileKey === getFileKey(file)) {
    return state.pdfSelection.selectedPages
      .filter((pageNumber) => pageNumber >= 1 && pageNumber <= pageCount)
      .sort((left, right) => left - right)
  }

  return Array.from({ length: pageCount }, (item, index) => index + 1)
}

function clampPageNumber(value, pageCount) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.min(Math.max(1, Math.floor(number)), Math.max(1, pageCount))
}

function buildPageRange(startPage, endPage) {
  const length = Math.max(0, endPage - startPage + 1)
  return Array.from({ length }, (item, index) => startPage + index)
}

function formatPageRanges(pages) {
  const sortedPages = Array.from(new Set(pages)).sort((left, right) => left - right)
  const ranges = []
  let start = null
  let end = null

  sortedPages.forEach((pageNumber) => {
    if (start === null) {
      start = pageNumber
      end = pageNumber
      return
    }

    if (pageNumber === end + 1) {
      end = pageNumber
      return
    }

    ranges.push(start === end ? String(start) : `${start}-${end}`)
    start = pageNumber
    end = pageNumber
  })

  if (start !== null) ranges.push(start === end ? String(start) : `${start}-${end}`)
  return ranges.join('、')
}

async function appendPdfPreviewData(formData, file, payload) {
  if (!window.pdfjsLib) {
    showToast('PDF 解析组件加载失败，将按普通 PDF 上传')
    return
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const selectedPages = getSelectedPdfPages(file, pdf.numPages)
  const textParts = []

  if (!selectedPages.length) {
    throw new Error('请至少选择 1 页 PDF')
  }

  payload.selectedPdfPages = selectedPages

  for (let index = 0; index < selectedPages.length; index += 1) {
    const pageNumber = selectedPages[index]
    els.generateBtn.textContent = `正在读取 PDF ${index + 1}/${selectedPages.length}`
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent().catch(() => null)
    if (textContent && Array.isArray(textContent.items)) {
      textParts.push(`第 ${pageNumber} 页：${textContent.items.map((item) => item.str || '').join(' ')}`)
    }

    const imageBlob = await renderPdfPageToImageBlob(page)
    if (imageBlob) {
      formData.append('pdfPageImage', imageBlob, `${file.name}-page-${pageNumber}.jpg`)
    }
  }

  const extractedText = textParts
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()

  if (extractedText) {
    payload.clientPdfText = extractedText.slice(0, 30000)
  }
}

async function renderPdfPageToImageBlob(page) {
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = Math.min(1.8, 1400 / Math.max(baseViewport.width, 1))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({
    canvasContext: context,
    viewport
  }).promise

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82)
  })
}

function copyAllFeedbacks() {
  if (!state.feedbacks.length) {
    showToast('还没有可复制的反馈')
    return
  }

  const text = state.feedbacks
    .map((item) => `${item.name}\n${item.feedback}`)
    .join('\n\n')

  copyText(text, '全部反馈已复制')
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(message)
  } catch (error) {
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
    showToast(message)
  }
}

function getSelectedClass() {
  return state.classes.find((item) => item.id === state.selectedClassId)
}

function getSelectedOneProfile() {
  return state.oneProfiles.find((item) => item.id === state.selectedOneProfileId)
}

function getWorkingStudents() {
  if (state.mode === 'oneOnOne') {
    const profile = getSelectedOneProfile()
    if (!profile) return []

    return [{
      id: profile.id,
      name: profile.name,
      performance: state.oneLesson.performance,
      remark: state.oneLesson.remark
    }]
  }

  const selectedClass = getSelectedClass()
  return selectedClass ? selectedClass.students : []
}

function updateWorkingStudentField(index, field, value) {
  if (!Number.isInteger(index)) return

  if (state.mode === 'oneOnOne') {
    if (index !== 0 || !(field in state.oneLesson)) return
    state.oneLesson[field] = value
    return
  }

  const students = getWorkingStudents()
  const student = students[index]
  if (!student) return

  student[field] = value
  persistClasses()
}

function getProfileMeta(profile) {
  const parts = []
  if (profile.personality) parts.push('性格已填')
  if (profile.habit) parts.push('习惯已填')
  return parts.length ? parts.join(' / ') : '档案待补充'
}

function parseStudentText(text) {
  return String(text || '')
    .split(/[\n,，;；、\t]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index)
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatPerformanceCounts(counts = {}) {
  return performanceOptions
    .map((option) => `${option} ${counts[option] || 0}`)
    .join(' / ')
}

function getCoursewareStatus(debug) {
  if (!debug.coursewareName) return '未上传课件'

  if (!debug.coursewareIsImage) {
    if (debug.coursewareVisionImageCount && debug.coursewareSentAsImage) {
      const selectedPages = Array.isArray(debug.coursewareSelectedPdfPages) && debug.coursewareSelectedPdfPages.length
        ? `第 ${formatPageRanges(debug.coursewareSelectedPdfPages)} 页`
        : `${debug.coursewareVisionImageCount} 页`
      return `${debug.coursewareName}（PDF ${selectedPages}已转图片发送，提取 ${debug.coursewareTextLength || 0} 个文字）`
    }

    if (debug.coursewareExtractionSource === 'pdf-ocr') {
      return `${debug.coursewareName}（图片版 PDF 已 OCR 识别 ${debug.coursewareOcrPageCount || 0} 页，${debug.coursewareTextLength || 0} 个文字）`
    }

    return `${debug.coursewareName}（已提取 ${debug.coursewareTextLength || 0} 个文字）`
  }

  if (debug.coursewareSentAsImage) {
    return `${debug.coursewareName}（图片已作为视觉输入发送）`
  }

  if (debug.coursewareImageFallbackUsed && debug.coursewareTextLength) {
    return `${debug.coursewareName}（图片接口不稳定，已改用识别出的 ${debug.coursewareTextLength} 个文字）`
  }

  if (debug.coursewareTextLength) {
    return `${debug.coursewareName}（已识别 ${debug.coursewareTextLength} 个图片文字）`
  }

  return `${debug.coursewareName}（图片已上传，但没有识别到清晰文字）`
}

function showToast(message) {
  els.toast.textContent = message
  els.toast.classList.add('show')
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => {
    els.toast.classList.remove('show')
  }, 2200)
}
