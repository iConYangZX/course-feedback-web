const STORAGE_KEY = 'courseFeedback.web.classes'
const ONE_PROFILE_STORAGE_KEY = 'courseFeedback.web.oneProfiles'
const TEACHING_CACHE_KEY = 'courseFeedback.web.teachingData.cache'

const DEFAULT_TEMPLATE = [
  '家长您好，本次课程反馈如下：',
  '【课堂内容】',
  '（根据课件一句话总结）',
  '【学习重点】',
  '（根据课件内容简短，列1、2、3点）',
  '【课堂表现】',
  '（根据课件内容以及学生表现和备注写，300字左右）'
].join('\n')

const performanceOptions = ['表现优秀', '表现良好', '表现较差']
const classKeywordPositiveOptions = [
  '互动积极',
  '回答问题踊跃',
  '小组讨论热烈',
  '笔记整理认真',
  '思维活跃有深度',
  '课前预习充分',
  '课堂练习完成度高'
]
const classKeywordNegativeOptions = [
  '个别学生走神',
  '部分学生反应较慢',
  '互动参与度有待提高',
  '课前预习不充分',
  '纪律偶有松散',
  '作业完成质量参差不齐'
]
const classKeywordOptions = [...classKeywordPositiveOptions, ...classKeywordNegativeOptions]
const studentKeywordPositiveOptions = [
  '主动发言',
  '回答质量高',
  '笔记认真',
  '思路清晰',
  '步骤规范',
  '课堂练习完成度高'
]
const studentKeywordNegativeOptions = [
  '注意力波动',
  '反应较慢',
  '参与度待提高',
  '预习不充分',
  '作业质量不稳定',
  '计算细节易错'
]
const studentKeywordOptions = [...studentKeywordPositiveOptions, ...studentKeywordNegativeOptions]
const personalityKeywordGroups = {
  positive: ['表达积极', '思维活跃', '愿意尝试', '专注度高', '抗挫能力较好', '主动沟通', '学习态度认真'],
  negative: ['容易紧张', '信心不足', '表达偏少', '注意力易波动', '遇难题容易停顿', '依赖提示', '情绪受错题影响']
}
const habitKeywordGroups = {
  positive: ['步骤规范', '审题认真', '草稿清晰', '会主动检查', '错题整理及时', '计算过程完整', '能总结方法'],
  negative: ['审题易漏条件', '计算细节易错', '步骤跳跃', '书写不够规范', '检查意识不足', '速度偏慢', '错题复盘不充分']
}
const performanceClasses = {
  表现优秀: 'performance-excellent',
  表现良好: 'performance-good',
  表现较差: 'performance-poor'
}
const REARRANGE_MAX_FILES = 3
const REARRANGE_MAX_PAGE_IMAGES = 8
const PAPER_ANALYSIS_MAX_PAGE_IMAGES = 24
const PAPER_SCORE_MAX_PAGE_IMAGES = 8
const paperExamTypeOptions = ['出门测', '中段考试', '期中考试', '期末考试', '月考', '周测']

const state = {
  mode: 'class',
  classes: [],
  oneProfiles: [],
  selectedClassId: '',
  selectedOneProfileId: '',
  editingClassId: '',
  editingOneProfileId: '',
  feedbacks: [],
  lastGeneratedPayload: null,
  debug: null,
  oneLesson: {
    performance: '表现良好',
    remark: ''
  },
  classSchedule: {
    selectedDate: getLocalDateKey(new Date()),
    calendarMonth: getMonthKey(new Date()),
    timeSlot: '',
    calendarOpen: false
  },
  exitTest: {
    mode: 'percent',
    totalScore: 100,
    scores: {},
    fileKey: '',
    lectures: [],
    selectedLectureIndex: '',
    detectingLectures: false
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
  coursewareFiles: [],
  classTextbook: {
    fileKey: '',
    lectures: []
  },
  pdfSelection: {
    items: [],
    activeFileKey: '',
    fileKey: '',
    fileName: '',
    pageCount: 0,
    selectedPages: [],
    lectures: [],
    selectedLectureIndex: '',
    loading: false,
    isOpen: false,
    error: ''
  },
  rearrange: {
    files: [],
    questions: [],
    busy: false,
    status: '等待上传文件'
  },
  teaching: {
    loading: false,
    loaded: false,
    saving: false,
    tab: 'classData',
    data: createEmptyTeachingData(),
    selectedClassId: '',
    selectedModuleId: '',
    selectedScoreClassId: '',
    selectedScoreStudent: '',
    selectedOneProfileId: '',
    scoreMode: 'percent',
    paper: createEmptyPaperState(),
    aiResult: '',
    aiBusy: false
  },
  pendingTeachingApplication: null
}

const els = {}

function createEmptyPaperState() {
  return {
    scope: 'class',
    file: null,
    fileName: '',
    fileKey: '',
    busy: false,
    status: '等待上传试卷',
    analysis: null,
    selectedClassId: '',
    selectedProfileId: '',
    singleStudentName: '',
    examType: '出门测',
    excludedStudentIds: [],
    scoreImageStatus: {},
    scores: {},
    selectedReportStudentId: '',
    report: null
  }
}

function createEmptyTeachingData() {
  return {
    classes: [],
    courseModules: [],
    scoreRecords: [],
    feedbackHistory: [],
    oneProfiles: [],
    paperAnalyses: [],
    quickOptions: {
      performance: studentKeywordOptions,
      performancePositive: studentKeywordPositiveOptions,
      performanceNegative: studentKeywordNegativeOptions,
      classPerformance: classKeywordOptions,
      classPerformancePositive: classKeywordPositiveOptions,
      classPerformanceNegative: classKeywordNegativeOptions,
      homework: ['完成课本对应章节习题', '预习下一节内容', '整理课堂笔记', '完成同步练习对应章节', '重点复习课堂难点', '完成预习导学案'],
      teaching: ['下次课先做错题回顾', '加强计算规范训练', '增加同类型题变式练习', '用口述方式检查知识理解']
    },
    updatedAt: Date.now()
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  bindElements()
  loadClasses()
  loadOneProfiles()
  bindEvents()
  await checkAccessStatus()
  if (state.access.authenticated) await loadFeedbackDataFromServer()
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
    teachingPanel: document.querySelector('#teachingPanel'),
    teachingTabs: document.querySelectorAll('.teaching-tab'),
    teachingContent: document.querySelector('#teachingContent'),
    teachingRefreshBtn: document.querySelector('#teachingRefreshBtn'),
    teachingSyncBtn: document.querySelector('#teachingSyncBtn'),
    teachingPrintBtn: document.querySelector('#teachingPrintBtn'),
    teachingScreenshotBtn: document.querySelector('#teachingScreenshotBtn'),
    teachingRestoreInput: document.querySelector('#teachingRestoreInput'),
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
    classMaterialModeSelect: document.querySelector('#classMaterialModeSelect'),
    classTextbookField: document.querySelector('#classTextbookField'),
    classTextbookInput: document.querySelector('#classTextbookInput'),
    classTextbookFileName: document.querySelector('#classTextbookFileName'),
    classTextbookStatus: document.querySelector('#classTextbookStatus'),
    oneProfileNameInput: document.querySelector('#oneProfileNameInput'),
    oneProfileGradeSelect: document.querySelector('#oneProfileGradeSelect'),
    onePersonalityInput: document.querySelector('#onePersonalityInput'),
    oneHabitInput: document.querySelector('#oneHabitInput'),
    onePersonalityPositiveList: document.querySelector('#onePersonalityPositiveList'),
    onePersonalityNegativeList: document.querySelector('#onePersonalityNegativeList'),
    oneHabitPositiveList: document.querySelector('#oneHabitPositiveList'),
    oneHabitNegativeList: document.querySelector('#oneHabitNegativeList'),
    oneFeedbackTemplateField: document.querySelector('#oneFeedbackTemplateField'),
    oneProfileTemplateInput: document.querySelector('#oneProfileTemplateInput'),
    oneProfileSummary: document.querySelector('#oneProfileSummary'),
    workspaceEyebrow: document.querySelector('#workspaceEyebrow'),
    workspaceTitle: document.querySelector('#workspaceTitle'),
    lessonTitleInput: document.querySelector('#lessonTitleInput'),
    coursewareField: document.querySelector('#coursewareField'),
    coursewareInput: document.querySelector('#coursewareInput'),
    coursewareFileName: document.querySelector('#coursewareFileName'),
    classSchedulePanel: document.querySelector('#classSchedulePanel'),
    classDateToggleBtn: document.querySelector('#classDateToggleBtn'),
    classDateSelectedText: document.querySelector('#classDateSelectedText'),
    classCalendarPopup: document.querySelector('#classCalendarPopup'),
    classCalendarPrevBtn: document.querySelector('#classCalendarPrevBtn'),
    classCalendarNextBtn: document.querySelector('#classCalendarNextBtn'),
    classCalendarTitle: document.querySelector('#classCalendarTitle'),
    classCalendarGrid: document.querySelector('#classCalendarGrid'),
    classTimeSlotSelect: document.querySelector('#classTimeSlotSelect'),
    classLectureField: document.querySelector('#classLectureField'),
    classLectureSelect: document.querySelector('#classLectureSelect'),
    feedbackFormatSelect: document.querySelector('#feedbackFormatSelect'),
    feedbackScopeSelect: document.querySelector('#feedbackScopeSelect'),
    scoreDisplayField: document.querySelector('#scoreDisplayField'),
    showAllScoresSelect: document.querySelector('#showAllScoresSelect'),
    classFeedbackTemplateField: document.querySelector('#classFeedbackTemplateField'),
    classFeedbackOptions: document.querySelector('#classFeedbackOptions'),
    classPositiveKeywordList: document.querySelector('#classPositiveKeywordList'),
    classKeywordList: document.querySelector('#classKeywordList'),
    classRemarkInput: document.querySelector('#classRemarkInput'),
    homeworkInput: document.querySelector('#homeworkInput'),
    pdfPageSelectionBar: document.querySelector('#pdfPageSelectionBar'),
    pdfPageSelectionText: document.querySelector('#pdfPageSelectionText'),
    pdfPageSelectBtn: document.querySelector('#pdfPageSelectBtn'),
    pdfPageModal: document.querySelector('#pdfPageModal'),
    pdfPageModalTitle: document.querySelector('#pdfPageModalTitle'),
    pdfPageModalMeta: document.querySelector('#pdfPageModalMeta'),
    pdfPageGrid: document.querySelector('#pdfPageGrid'),
    pdfLecturePicker: document.querySelector('#pdfLecturePicker'),
    pdfLectureSelect: document.querySelector('#pdfLectureSelect'),
    pdfPageSelectAllBtn: document.querySelector('#pdfPageSelectAllBtn'),
    pdfPageSelectNoneBtn: document.querySelector('#pdfPageSelectNoneBtn'),
    pdfPageCancelBtn: document.querySelector('#pdfPageCancelBtn'),
    pdfPageConfirmBtn: document.querySelector('#pdfPageConfirmBtn'),
    pdfPageModalCloseBtn: document.querySelector('#pdfPageModalCloseBtn'),
    courseNoteInput: document.querySelector('#courseNoteInput'),
    exitTestPanel: document.querySelector('#exitTestPanel'),
    exitTestInput: document.querySelector('#exitTestInput'),
    exitTestFileName: document.querySelector('#exitTestFileName'),
    exitTestLectureField: document.querySelector('#exitTestLectureField'),
    exitTestLectureSelect: document.querySelector('#exitTestLectureSelect'),
    exitTestModeSelect: document.querySelector('#exitTestModeSelect'),
    exitTestTotalField: document.querySelector('#exitTestTotalField'),
    exitTestTotalInput: document.querySelector('#exitTestTotalInput'),
    exitTestCount: document.querySelector('#exitTestCount'),
    exitTestTable: document.querySelector('#exitTestTable'),
    studentToolbar: document.querySelector('.student-toolbar'),
    studentCount: document.querySelector('#studentCount'),
    studentTable: document.querySelector('#studentTable'),
    generateBtn: document.querySelector('#generateBtn'),
    copyAllBtn: document.querySelector('#copyAllBtn'),
    resultNote: document.querySelector('#resultNote'),
    debugSummary: document.querySelector('#debugSummary'),
    teachingApplyBar: document.querySelector('#teachingApplyBar'),
    applyTeachingDataBtn: document.querySelector('#applyTeachingDataBtn'),
    resultList: document.querySelector('#resultList'),
    imageReportPanel: document.querySelector('#imageReportPanel'),
    imageReportPreview: document.querySelector('#imageReportPreview'),
    downloadImageReportBtn: document.querySelector('#downloadImageReportBtn'),
    rearrangePanel: document.querySelector('#rearrangePanel'),
    rearrangeStatus: document.querySelector('#rearrangeStatus'),
    rearrangeTitleInput: document.querySelector('#rearrangeTitleInput'),
    rearrangeUploadBtn: document.querySelector('#rearrangeUploadBtn'),
    rearrangeFileInput: document.querySelector('#rearrangeFileInput'),
    rearrangeFileList: document.querySelector('#rearrangeFileList'),
    recognizeQuestionsBtn: document.querySelector('#recognizeQuestionsBtn'),
    exportQuestionsBtn: document.querySelector('#exportQuestionsBtn'),
    rearrangeEmpty: document.querySelector('#rearrangeEmpty'),
    questionEditorList: document.querySelector('#questionEditorList'),
    questionPreviewPaper: document.querySelector('#questionPreviewPaper'),
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
  if (els.teachingRefreshBtn) els.teachingRefreshBtn.addEventListener('click', loadTeachingData)
  if (els.teachingSyncBtn) els.teachingSyncBtn.addEventListener('click', syncTeachingProfiles)
  if (els.teachingPrintBtn) els.teachingPrintBtn.addEventListener('click', () => window.print())
  if (els.teachingScreenshotBtn) els.teachingScreenshotBtn.addEventListener('click', captureTeachingPanel)
  if (els.teachingRestoreInput) els.teachingRestoreInput.addEventListener('change', restoreTeachingBackup)
  els.teachingTabs.forEach((button) => {
    button.addEventListener('click', () => {
      state.teaching.tab = button.dataset.teachingTab
      renderTeachingPanel()
    })
  })
  if (els.teachingContent) {
    els.teachingContent.addEventListener('click', handleTeachingClick)
    els.teachingContent.addEventListener('input', handleTeachingInput)
    els.teachingContent.addEventListener('change', handleTeachingChange)
  }

  els.modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode
      state.feedbacks = []
      state.lastGeneratedPayload = null
      state.debug = null
      state.pendingTeachingApplication = null
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
  if (els.applyTeachingDataBtn) els.applyTeachingDataBtn.addEventListener('click', applyFeedbackToTeachingData)
  els.coursewareInput.addEventListener('change', handleCoursewareChange)
  if (els.pdfPageSelectionBar) {
    els.pdfPageSelectionBar.addEventListener('change', handleCoursewareSelectionChange)
    els.pdfPageSelectionBar.addEventListener('click', handleCoursewareSelectionClick)
  }
  if (els.classMaterialModeSelect) els.classMaterialModeSelect.addEventListener('change', renderClassMaterialControls)
  if (els.classTextbookInput) els.classTextbookInput.addEventListener('change', handleClassTextbookChange)
  if (els.exitTestInput) els.exitTestInput.addEventListener('change', handleExitTestFileChange)
  if (els.exitTestLectureSelect) els.exitTestLectureSelect.addEventListener('change', () => {
    state.exitTest.selectedLectureIndex = els.exitTestLectureSelect.value
  })
  if (els.classDateToggleBtn) els.classDateToggleBtn.addEventListener('click', toggleClassCalendar)
  if (els.classCalendarPrevBtn) els.classCalendarPrevBtn.addEventListener('click', () => shiftClassCalendarMonth(-1))
  if (els.classCalendarNextBtn) els.classCalendarNextBtn.addEventListener('click', () => shiftClassCalendarMonth(1))
  if (els.classCalendarGrid) els.classCalendarGrid.addEventListener('click', handleClassCalendarClick)
  if (els.classTimeSlotSelect) els.classTimeSlotSelect.addEventListener('change', () => {
    state.classSchedule.timeSlot = els.classTimeSlotSelect.value
  })
  if (els.feedbackScopeSelect) els.feedbackScopeSelect.addEventListener('change', () => {
    state.feedbacks = []
    state.lastGeneratedPayload = null
    state.debug = null
    state.pendingTeachingApplication = null
    renderFeedbackModeControls()
    renderResults()
  })
  if (els.feedbackFormatSelect) els.feedbackFormatSelect.addEventListener('change', () => {
    renderFeedbackModeControls()
    renderResults()
  })
  if (els.showAllScoresSelect) els.showAllScoresSelect.addEventListener('change', () => {
    if (isImageFeedbackMode() && state.feedbacks.length) renderImageReport()
  })
  if (els.classPositiveKeywordList) els.classPositiveKeywordList.addEventListener('click', handleClassKeywordClick)
  if (els.classKeywordList) els.classKeywordList.addEventListener('click', handleClassKeywordClick)
  ;[
    els.onePersonalityPositiveList,
    els.onePersonalityNegativeList,
    els.oneHabitPositiveList,
    els.oneHabitNegativeList
  ].forEach((list) => {
    if (list) list.addEventListener('click', handleOneProfileKeywordClick)
  })
  if (els.downloadImageReportBtn) els.downloadImageReportBtn.addEventListener('click', downloadImageReport)
  if (els.imageReportPreview) els.imageReportPreview.addEventListener('click', handleImageReportPreviewClick)
  if (els.exitTestModeSelect) els.exitTestModeSelect.addEventListener('change', handleExitTestModeChange)
  if (els.exitTestTotalInput) els.exitTestTotalInput.addEventListener('input', () => {
    state.exitTest.totalScore = Number(els.exitTestTotalInput.value || 100)
  })
  if (els.exitTestTable) {
    els.exitTestTable.addEventListener('input', handleExitTestInput)
    els.exitTestTable.addEventListener('change', handleExitTestInput)
  }
  if (els.pdfPageSelectBtn) els.pdfPageSelectBtn.addEventListener('click', openPdfPageSelection)
  if (els.pdfPageSelectAllBtn) els.pdfPageSelectAllBtn.addEventListener('click', selectAllPdfPages)
  if (els.pdfPageSelectNoneBtn) els.pdfPageSelectNoneBtn.addEventListener('click', clearPdfPages)
  if (els.pdfPageCancelBtn) els.pdfPageCancelBtn.addEventListener('click', cancelPdfPageSelection)
  if (els.pdfPageConfirmBtn) els.pdfPageConfirmBtn.addEventListener('click', confirmPdfPageSelection)
  if (els.pdfPageModalCloseBtn) els.pdfPageModalCloseBtn.addEventListener('click', closePdfPageModal)
  if (els.pdfPageModal) els.pdfPageModal.addEventListener('click', (event) => {
    if (event.target === els.pdfPageModal) closePdfPageModal()
  })
  if (els.pdfPageGrid) els.pdfPageGrid.addEventListener('change', updatePdfPageSelectionFromGrid)
  if (els.pdfPageGrid) els.pdfPageGrid.addEventListener('click', handlePdfPageGridClick)
  if (els.pdfLectureSelect) els.pdfLectureSelect.addEventListener('change', applySelectedPdfLecture)
  els.rearrangeUploadBtn.addEventListener('click', () => els.rearrangeFileInput.click())
  els.rearrangeTitleInput.addEventListener('input', renderQuestionPreview)
  els.rearrangeFileInput.addEventListener('change', (event) => {
    setRearrangeFiles(event.target.files)
  })
  els.recognizeQuestionsBtn.addEventListener('click', recognizeQuestions)
  els.exportQuestionsBtn.addEventListener('click', exportQuestionsToWord)
  els.questionEditorList.addEventListener('input', updateQuestionFromEditor)

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
    if (event.target.matches('[data-field="keyword"]') && event.target.value) {
      appendStudentKeyword(Number(event.target.dataset.index), event.target.value)
      event.target.value = ''
      renderStudentTable()
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
    if (!item) return

    copyText(item.feedback, `${item.name} 的反馈已复制`)
    copyButton.textContent = '已复制'
    copyButton.classList.add('copied')
    clearTimeout(copyButton.resetTimer)
    copyButton.resetTimer = setTimeout(() => {
      copyButton.textContent = '复制'
      copyButton.classList.remove('copied')
    }, 1400)
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
    await loadFeedbackDataFromServer()
    fillClassForm(getSelectedClass())
    fillOneProfileForm(getSelectedOneProfile())
    render()
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

  if (action === 'delete-user') {
    await deleteAdminUser(user)
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

async function deleteAdminUser(user) {
  if (state.access.user && state.access.user.id === user.id) {
    showToast('不能删除当前登录的管理员账号')
    return
  }

  const confirmed = window.confirm(`确定删除账号 ${user.username} 吗？删除后该账号将无法登录。`)
  if (!confirmed) return

  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE'
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '删除账号失败')

    state.adminUsers = state.adminUsers.filter((item) => item.id !== user.id)
    renderAdminUsers()
    showToast('账号已删除')
  } catch (error) {
    showToast(error.message || '删除账号失败')
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
          <button class="secondary-button danger-button" data-admin-action="delete-user" data-id="${escapeHtml(user.id)}" type="button">删除账号</button>
        </div>
      </article>
    `
  }).join('')
}

function loadTeachingCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(TEACHING_CACHE_KEY) || 'null')
    if (cached && typeof cached === 'object') {
      state.teaching.data = normalizeTeachingDataClient(cached)
    }
  } catch (error) {
    state.teaching.data = createEmptyTeachingData()
  }
}

async function loadTeachingData() {
  if (!state.access.authenticated || (state.access.accessRequired && !state.access.user)) return

  state.teaching.loading = true
  renderTeachingPanel()

  try {
    const response = await fetch('/api/teaching-data')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '读取教学数据失败')

    state.teaching.data = normalizeTeachingDataClient(data.data)
    mergePrimaryIntoTeachingData()
    persistTeachingCache()
    renderTeachingPanel()
  } catch (error) {
    mergePrimaryIntoTeachingData()
    renderTeachingPanel()
    showToast(error.message || '读取教学数据失败，已使用本机缓存')
  } finally {
    state.teaching.loaded = true
    state.teaching.loading = false
    renderTeachingPanel()
  }
}

function persistTeachingCache() {
  localStorage.setItem(TEACHING_CACHE_KEY, JSON.stringify(state.teaching.data))
}

async function syncTeachingProfiles() {
  mergePrimaryIntoTeachingData()
  await saveTeachingData()
  renderTeachingPanel()
}

async function saveTeachingData(options = {}) {
  state.teaching.data.updatedAt = Date.now()
  persistTeachingCache()

  if (options.localOnly) return

  try {
    state.teaching.saving = true
    const response = await fetch('/api/teaching-data', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: state.teaching.data })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '保存教学数据失败')

    state.teaching.data = normalizeTeachingDataClient(data.data)
    persistTeachingCache()
    if (!options.silent) showToast('教学数据已保存')
  } catch (error) {
    showToast(error.message || '教学数据暂存到本机，稍后可重试同步')
  } finally {
    state.teaching.saving = false
    renderTeachingPanel()
  }
}

function scheduleTeachingSave() {
  persistTeachingCache()
  clearTimeout(scheduleTeachingSave.timer)
  scheduleTeachingSave.timer = setTimeout(() => saveTeachingData({ silent: true }), 500)
}

function saveTeachingFromPrimaryData() {
  mergePrimaryIntoTeachingData()
  saveTeachingData({ silent: true })
}

function normalizeTeachingDataClient(input) {
  const fallback = createEmptyTeachingData()
  const source = input && typeof input === 'object' ? input : {}
  const quickOptions = source.quickOptions && typeof source.quickOptions === 'object'
    ? source.quickOptions
    : {}

  return {
    ...fallback,
    classes: Array.isArray(source.classes) ? source.classes : [],
    courseModules: Array.isArray(source.courseModules) ? source.courseModules : [],
    scoreRecords: Array.isArray(source.scoreRecords) ? source.scoreRecords : [],
    feedbackHistory: Array.isArray(source.feedbackHistory) ? source.feedbackHistory : [],
    oneProfiles: Array.isArray(source.oneProfiles) ? source.oneProfiles : [],
    paperAnalyses: Array.isArray(source.paperAnalyses) ? source.paperAnalyses : [],
    quickOptions: {
      ...fallback.quickOptions,
      ...quickOptions
    },
    updatedAt: Number(source.updatedAt || Date.now())
  }
}

function mergePrimaryIntoTeachingData() {
  const data = state.teaching.data
  const classMap = new Map((data.classes || []).map((item) => [item.id, item]))
  state.classes.forEach((classInfo) => {
    classMap.set(classInfo.id, {
      ...(classMap.get(classInfo.id) || {}),
      id: classInfo.id,
      name: classInfo.name,
      grade: classInfo.grade,
      template: classInfo.template,
      materialMode: classInfo.materialMode || 'lesson',
      textbook: classInfo.textbook || null,
      students: classInfo.students.map((student) => ({
        id: student.id,
        name: student.name,
        note: student.remark || '',
        performance: student.performance || '表现良好'
      })),
      updatedAt: classInfo.updatedAt || Date.now()
    })
  })
  data.classes = Array.from(classMap.values())

  const oneMap = new Map((data.oneProfiles || []).map((item) => [item.id, item]))
  state.oneProfiles.forEach((profile) => {
    oneMap.set(profile.id, {
      ...(oneMap.get(profile.id) || {}),
      ...profile
    })
  })
  data.oneProfiles = Array.from(oneMap.values())
}

function renderTeachingPanel() {
  if (!els.teachingPanel || !els.teachingContent) return

  const isPaperTool = state.mode === 'paperAnalysis'
  const headingEyebrow = els.teachingPanel.querySelector('.panel-heading .eyebrow')
  const headingTitle = els.teachingPanel.querySelector('.panel-heading h1')
  const tabsBar = els.teachingPanel.querySelector('.teaching-tabs')

  if (headingEyebrow) headingEyebrow.textContent = isPaperTool ? 'Paper Analysis' : 'Teaching Data'
  if (headingTitle) headingTitle.textContent = isPaperTool ? '试卷分析' : '教学数据'
  if (tabsBar) tabsBar.classList.toggle('hidden', isPaperTool)
  if (els.teachingSyncBtn) els.teachingSyncBtn.classList.toggle('hidden', isPaperTool)
  if (els.teachingPrintBtn) els.teachingPrintBtn.classList.toggle('hidden', isPaperTool)
  if (els.teachingScreenshotBtn) els.teachingScreenshotBtn.classList.toggle('hidden', isPaperTool)

  els.teachingTabs.forEach((button) => {
    button.classList.toggle('active', button.dataset.teachingTab === state.teaching.tab)
  })

  if (state.teaching.loading) {
    els.teachingContent.innerHTML = '<div class="student-empty">正在读取教学数据...</div>'
    return
  }

  if (isPaperTool) {
    renderTeachingPaperAnalysis()
    return
  }

  if (!['classData', 'oneData'].includes(state.teaching.tab)) state.teaching.tab = 'classData'
  if (state.teaching.tab === 'classData') renderTeachingClassData()
  if (state.teaching.tab === 'oneData') renderTeachingOneData()
  if (state.teaching.tab === 'classData' || state.teaching.tab === 'oneData') return

  if (state.teaching.tab === 'roster') renderTeachingRoster()
  if (state.teaching.tab === 'courses') renderTeachingCourses()
  if (state.teaching.tab === 'scores') renderTeachingScores()
  if (state.teaching.tab === 'history') renderTeachingHistory()
  if (state.teaching.tab === 'one') renderTeachingOneProfiles()
  if (state.teaching.tab === 'backup') renderTeachingBackup()
}

function renderTeachingClassData() {
  mergePrimaryIntoTeachingData()
  const classes = state.teaching.data.classes || []
  const selected = classes.find((item) => item.id === state.teaching.selectedClassId) || classes[0]
  if (selected && !state.teaching.selectedClassId) state.teaching.selectedClassId = selected.id

  if (!classes.length) {
    els.teachingContent.innerHTML = `
      <section class="teaching-card">
        <div class="teaching-title">班课教学数据</div>
        <div class="student-empty">暂无班级档案。请先在反馈栏建立班级，或点击顶部“同步档案”。</div>
      </section>
    `
    return
  }

  const sessionDates = selected ? getClassSessionDates(selected.id) : []
  els.teachingContent.innerHTML = `
    <div class="teaching-grid sidebar-layout">
      <section class="teaching-card">
        <div class="result-head">
          <div>
            <div class="teaching-title">班课</div>
            <div class="teaching-meta">${classes.length} 个班级 · 已同步反馈档案</div>
          </div>
        </div>
        <div class="teaching-pill-list">
          ${classes.map((classInfo) => `
            <button class="teaching-pill ${selected && classInfo.id === selected.id ? 'active' : ''}" data-teaching-action="select-data-class" data-id="${escapeHtml(classInfo.id)}" type="button">${escapeHtml(classInfo.name)}</button>
          `).join('')}
        </div>
      </section>
      <section class="teaching-card">
        ${selected ? renderClassTeachingDataDetail(selected, sessionDates) : '<div class="student-empty">请选择班级</div>'}
      </section>
    </div>
  `
}

function renderClassTeachingDataDetail(classInfo, sessionDates) {
  const students = classInfo.students || []
  return `
    <div class="result-head">
      <div>
        <div class="teaching-title">${escapeHtml(classInfo.name)} · ${escapeHtml(classInfo.grade || '')}</div>
        <div class="teaching-meta">上课 ${sessionDates.length} 次 · ${students.length} 名学生</div>
      </div>
    </div>
    <section class="teaching-subsection">
      <div class="teaching-title">上课次数记录</div>
      ${renderDateList(sessionDates)}
    </section>
    <section class="teaching-subsection">
      <div class="teaching-title">学生单独档案</div>
      <div class="teaching-list">
        ${students.map((student) => renderClassStudentTeachingCard(classInfo, student)).join('') || '<div class="student-empty">暂无学生名单</div>'}
      </div>
    </section>
  `
}

function renderClassStudentTeachingCard(classInfo, student) {
  const exitScores = getStudentScoreRows(classInfo.id, student, 'class', 'exitTest')
  const paperScores = getStudentScoreRows(classInfo.id, student, 'class', 'paperAnalysis')
  const feedbacks = getStudentFeedbackRows(classInfo.id, student)
  const attendanceDates = getStudentAttendanceDates(classInfo.id, student)

  return `
    <article class="teaching-card compact-card">
      <div class="result-head">
        <div>
          <div class="teaching-title">${escapeHtml(student.name)}</div>
          <div class="teaching-meta">到课 ${attendanceDates.length} 次 · 出门测 ${exitScores.length} 条 · 试卷分析 ${paperScores.length} 条 · 反馈 ${feedbacks.length} 条</div>
        </div>
      </div>
      <div class="teaching-data-columns">
        <div>
          <strong>出门测成绩</strong>
          ${renderTeachingScoreRows(exitScores)}
        </div>
        <div>
          <strong>试卷分析结果</strong>
          ${renderTeachingScoreRows(paperScores)}
        </div>
        <div>
          <strong>反馈记录</strong>
          ${renderFeedbackRows(feedbacks)}
        </div>
        <div>
          <strong>到课次数</strong>
          ${renderDateList(attendanceDates)}
        </div>
      </div>
      ${renderStudentRecordDeleteMenu({ scope: 'class', classId: classInfo.id, studentId: student.id, studentName: student.name })}
    </article>
  `
}

function renderTeachingOneData() {
  mergePrimaryIntoTeachingData()
  const profiles = state.teaching.data.oneProfiles || []
  const selected = profiles.find((item) => item.id === state.teaching.selectedOneProfileId) || profiles[0]
  if (selected && !state.teaching.selectedOneProfileId) state.teaching.selectedOneProfileId = selected.id

  if (!profiles.length) {
    els.teachingContent.innerHTML = `
      <section class="teaching-card">
        <div class="teaching-title">一对一教学数据</div>
        <div class="student-empty">暂无一对一档案。请先在反馈栏建立学生档案，或点击顶部“同步档案”。</div>
      </section>
    `
    return
  }

  els.teachingContent.innerHTML = `
    <div class="teaching-grid sidebar-layout">
      <section class="teaching-card">
        <div class="result-head">
          <div>
            <div class="teaching-title">一对一</div>
            <div class="teaching-meta">${profiles.length} 个学生档案</div>
          </div>
        </div>
        <div class="teaching-pill-list">
          ${profiles.map((profile) => `
            <button class="teaching-pill ${selected && profile.id === selected.id ? 'active' : ''}" data-teaching-action="select-data-one" data-id="${escapeHtml(profile.id)}" type="button">${escapeHtml(profile.name)}</button>
          `).join('')}
        </div>
      </section>
      <section class="teaching-card">
        ${selected ? renderOneTeachingDataDetail(selected) : '<div class="student-empty">请选择学生</div>'}
      </section>
    </div>
  `
}

function renderOneTeachingDataDetail(profile) {
  const feedbacks = getOneFeedbackRows(profile)
  const exitScores = getStudentScoreRows('', { id: profile.id, name: profile.name }, 'oneOnOne', 'exitTest')
  const paperScores = getStudentScoreRows('', { id: profile.id, name: profile.name }, 'oneOnOne', 'paperAnalysis')
  const attendanceDates = getOneAttendanceDates(profile)

  return `
    <div class="result-head">
      <div>
        <div class="teaching-title">${escapeHtml(profile.name)} · ${escapeHtml(profile.grade || '')}</div>
        <div class="teaching-meta">到课 ${attendanceDates.length} 次 · 出门测 ${exitScores.length} 条 · 试卷分析 ${paperScores.length} 条 · 反馈 ${feedbacks.length} 条</div>
      </div>
    </div>
    <div class="teaching-data-columns">
      <div>
        <strong>出门测成绩</strong>
        ${renderTeachingScoreRows(exitScores)}
      </div>
      <div>
        <strong>试卷分析结果</strong>
        ${renderTeachingScoreRows(paperScores)}
      </div>
      <div>
        <strong>反馈记录</strong>
        ${renderFeedbackRows(feedbacks)}
      </div>
      <div>
        <strong>到课次数</strong>
        ${renderDateList(attendanceDates)}
      </div>
    </div>
    ${renderStudentRecordDeleteMenu({ scope: 'oneOnOne', profileId: profile.id, studentId: profile.id, studentName: profile.name })}
  `
}

function getClassSessionDates(classId) {
  return uniqueSortedDates((state.teaching.data.feedbackHistory || [])
    .filter((item) => item.mode === 'class' && item.classId === classId)
    .map(getTeachingRecordDate))
}

function getStudentFeedbackRows(classId, student) {
  return (state.teaching.data.feedbackHistory || [])
    .filter((item) => item.mode === 'class' && item.classId === classId)
    .filter((item) => !isStudentExcluded(item.feedbackExclusions, student))
    .filter((item) => {
      if (item.feedbackScope === 'class') return true
      return (item.feedbacks || []).some((feedback) => (
        (student.id && feedback.studentId === student.id) || feedback.name === student.name
      ))
    })
    .map((item) => ({
      date: getTeachingRecordDate(item),
      text: `${formatTeachingDate(getTeachingRecordDate(item))}    进行${getFeedbackFormatLabel(item)}`
    }))
    .sort(compareTeachingRows)
}

function getOneFeedbackRows(profile) {
  return (state.teaching.data.feedbackHistory || [])
    .filter((item) => item.mode === 'oneOnOne')
    .filter((item) => !isStudentExcluded(item.feedbackExclusions, { id: profile.id, name: profile.name }))
    .filter((item) => item.profileId === profile.id || item.studentName === profile.name || (item.feedbacks || []).some((feedback) => feedback.name === profile.name))
    .map((item) => ({
      date: getTeachingRecordDate(item),
      text: `${formatTeachingDate(getTeachingRecordDate(item))}    进行${getFeedbackFormatLabel(item)}`
    }))
    .sort(compareTeachingRows)
}

function getStudentAttendanceDates(classId, student) {
  return uniqueSortedDates((state.teaching.data.feedbackHistory || [])
    .filter((item) => item.mode === 'class' && item.classId === classId)
    .filter((item) => !isStudentExcluded(item.attendanceExclusions, student))
    .filter((item) => {
      if (item.feedbackScope === 'class') return true
      return (item.feedbacks || []).some((feedback) => (
        (student.id && feedback.studentId === student.id) || feedback.name === student.name
      ))
    })
    .map(getTeachingRecordDate))
}

function getOneAttendanceDates(profile) {
  const student = { id: profile.id, name: profile.name }
  return uniqueSortedDates((state.teaching.data.feedbackHistory || [])
    .filter((item) => item.mode === 'oneOnOne')
    .filter((item) => !isStudentExcluded(item.attendanceExclusions, student))
    .filter((item) => item.profileId === profile.id || item.studentName === profile.name || (item.feedbacks || []).some((feedback) => feedback.name === profile.name))
    .map(getTeachingRecordDate))
}

function isStudentExcluded(exclusions, student) {
  return Array.isArray(exclusions) && exclusions.some((item) => (
    (student.id && item.studentId === student.id) || item.name === student.name
  ))
}

function getStudentScoreRows(classId, student, scope, recordType = '') {
  return (state.teaching.data.scoreRecords || [])
    .filter((record) => record.scope === scope)
    .filter((record) => !recordType || getTeachingScoreRecordType(record) === recordType)
    .filter((record) => scope === 'class' ? record.classId === classId : (record.profileId === student.id || record.studentName === student.name))
    .flatMap((record) => {
      const matched = (record.students || []).filter((score) => (
        (student.id && (score.studentId === student.id || score.id === student.id)) || score.name === student.name
      ))
      return matched.map((score) => ({
        date: record.date || getLocalDateKey(new Date(record.createdAt || Date.now())),
        text: `${formatTeachingDate(record.date)}    ${record.title || '出门测'}：${formatTeachingScore(score, record)}`
      }))
    })
    .sort(compareTeachingRows)
}

function getTeachingScoreRecordType(record) {
  if (record.recordType === 'paperAnalysis') return 'paperAnalysis'
  if (record.recordType === 'exitTest') return 'exitTest'
  if (String(record.sourceFeedbackId || '').startsWith('paper-report')) return 'paperAnalysis'
  return 'exitTest'
}

function renderTeachingScoreRows(rows) {
  if (!rows.length) return '<div class="teaching-empty-line">暂无成绩</div>'
  return `<ul class="teaching-data-list">${rows.map((row) => `<li>${escapeHtml(row.text)}</li>`).join('')}</ul>`
}

function renderStudentRecordDeleteMenu(options) {
  const attrs = [
    `data-scope="${escapeHtml(options.scope)}"`,
    `data-class-id="${escapeHtml(options.classId || '')}"`,
    `data-profile-id="${escapeHtml(options.profileId || '')}"`,
    `data-student-id="${escapeHtml(options.studentId || '')}"`,
    `data-student-name="${escapeHtml(options.studentName || '')}"`
  ].join(' ')

  return `
    <details class="teaching-delete-menu">
      <summary>删除记录</summary>
      <div class="teaching-delete-actions">
        <button class="list-delete-button" data-teaching-action="delete-student-scores" ${attrs} type="button">删除出门测成绩</button>
        <button class="list-delete-button" data-teaching-action="delete-student-paper-results" ${attrs} type="button">删除试卷分析结果</button>
        <button class="list-delete-button" data-teaching-action="delete-student-feedbacks" ${attrs} type="button">删除反馈记录</button>
        <button class="list-delete-button" data-teaching-action="delete-student-attendance" ${attrs} type="button">删除到课次数</button>
      </div>
    </details>
  `
}

function renderFeedbackRows(rows) {
  if (!rows.length) return '<div class="teaching-empty-line">暂无反馈记录</div>'
  return `<ul class="teaching-data-list">${rows.map((row) => `<li>${escapeHtml(row.text)}</li>`).join('')}</ul>`
}

function renderDateList(dates) {
  const normalized = uniqueSortedDates(dates)
  if (!normalized.length) return '<div class="teaching-empty-line">暂无记录</div>'
  return `<ul class="teaching-data-list">${normalized.map((date) => `<li>${escapeHtml(formatTeachingDate(date))}</li>`).join('')}</ul>`
}

function uniqueSortedDates(dates) {
  return Array.from(new Set((dates || []).filter(Boolean))).sort((left, right) => String(left).localeCompare(String(right)))
}

function compareTeachingRows(left, right) {
  return String(left.date).localeCompare(String(right.date))
}

function getTeachingRecordDate(item) {
  return item.lessonDate || getLocalDateKey(new Date(item.createdAt || Date.now()))
}

function getFeedbackFormatLabel(item) {
  const format = item.feedbackFormat === 'image' ? '图片式' : '文字式'
  const scope = item.feedbackScope === 'class' ? '班级反馈' : '个性化反馈'
  return `${format}${scope}`
}

function formatTeachingScore(score, record) {
  if (record.mode === 'grade') return score.grade || '-'
  const hasScore = score.score !== null && score.score !== '' && typeof score.score !== 'undefined'
  const value = hasScore && Number.isFinite(Number(score.score)) ? Number(score.score) : '-'
  return `${value}/${record.totalScore || 100}`
}

function formatTeachingDate(dateValue) {
  const raw = String(dateValue || '').trim()
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) return `${match[1]}-${Number(match[2])}-${Number(match[3])}`

  const date = raw ? new Date(raw) : new Date()
  if (Number.isNaN(date.getTime())) return raw
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function renderTeachingRoster() {
  const data = state.teaching.data
  els.teachingContent.innerHTML = `
    <div class="teaching-grid two">
      <section class="teaching-card">
        <div class="result-head">
          <div>
            <div class="teaching-title">班级花名册</div>
            <div class="teaching-meta">${data.classes.length} 个班级</div>
          </div>
          <button class="secondary-button compact-button" data-teaching-action="sync-primary" type="button">同步现有档案</button>
        </div>
        <div class="form-grid two">
          <label class="field"><span>班级名称</span><input data-teaching-field="newClassName" type="text" placeholder="例如：清北4班" /></label>
          <label class="field"><span>年级</span><select data-teaching-field="newClassGrade"><option>初一</option><option>初二</option><option>初三</option><option selected>高一</option><option>高二</option><option>高三</option></select></label>
        </div>
        <label class="field"><span>学生名单</span><textarea data-teaching-field="newClassStudents" rows="5" placeholder="每行一个学生，也可以用逗号分隔"></textarea></label>
        <div class="panel-actions"><button class="primary-button" data-teaching-action="add-class" type="button">新增花名册</button></div>
      </section>
      <section class="teaching-card">
        <div class="teaching-title">常用课堂关键词</div>
        <div class="form-grid two">
          <label class="field"><span>班级亮点关键词</span><textarea data-teaching-quick="classPerformancePositive" rows="4">${escapeHtml((data.quickOptions.classPerformancePositive || classKeywordPositiveOptions).join('\n'))}</textarea></label>
          <label class="field"><span>班级需改进关键词</span><textarea data-teaching-quick="classPerformanceNegative" rows="4">${escapeHtml((data.quickOptions.classPerformanceNegative || classKeywordNegativeOptions).join('\n'))}</textarea></label>
        </div>
        <div class="form-grid two">
          <label class="field"><span>个性化亮点关键词</span><textarea data-teaching-quick="performancePositive" rows="4">${escapeHtml((data.quickOptions.performancePositive || studentKeywordPositiveOptions).join('\n'))}</textarea></label>
          <label class="field"><span>个性化需改进关键词</span><textarea data-teaching-quick="performanceNegative" rows="4">${escapeHtml((data.quickOptions.performanceNegative || studentKeywordNegativeOptions).join('\n'))}</textarea></label>
        </div>
      </section>
    </div>
    <div class="teaching-list">
      ${data.classes.length ? data.classes.map(renderTeachingClassCard).join('') : '<div class="student-empty">暂无花名册，可以从现有班级同步，或在上方新增。</div>'}
    </div>
  `
}

function renderTeachingClassCard(classInfo) {
  const students = Array.isArray(classInfo.students) ? classInfo.students : []
  return `
    <article class="teaching-card" data-teaching-class-id="${escapeHtml(classInfo.id)}">
      <div class="result-head">
        <div>
          <div class="teaching-title">${escapeHtml(classInfo.name)} · ${escapeHtml(classInfo.grade || '')}</div>
          <div class="teaching-meta">${students.length} 名学生${classInfo.textbook ? ` · ${escapeHtml(classInfo.textbook.name || '已绑定教材')}` : ''}</div>
        </div>
        <button class="list-delete-button" data-teaching-action="delete-class" data-id="${escapeHtml(classInfo.id)}" type="button">删除</button>
      </div>
      <label class="field"><span>花名册</span><textarea data-teaching-field="classStudents" data-id="${escapeHtml(classInfo.id)}" rows="4">${escapeHtml(students.map((student) => student.name).join('\n'))}</textarea></label>
    </article>
  `
}

function renderTeachingCourses() {
  const modules = state.teaching.data.courseModules
  const selected = modules.find((item) => item.id === state.teaching.selectedModuleId) || modules[0]
  if (selected && !state.teaching.selectedModuleId) state.teaching.selectedModuleId = selected.id

  els.teachingContent.innerHTML = `
    <div class="teaching-grid sidebar-layout">
      <section class="teaching-card">
        <div class="result-head"><div class="teaching-title">课程模块</div><button class="icon-action" data-teaching-action="add-module" type="button">+</button></div>
        <div class="teaching-pill-list">
          ${modules.length ? modules.map((module) => `
            <button class="teaching-pill ${module.id === state.teaching.selectedModuleId ? 'active' : ''}" data-teaching-action="select-module" data-id="${escapeHtml(module.id)}" type="button">${escapeHtml(module.name)}</button>
          `).join('') : '<div class="student-empty compact-empty">暂无模块</div>'}
        </div>
        <div class="panel-actions stretch">
          <button class="secondary-button compact-button" data-teaching-action="export-courses" type="button">导出课程</button>
          <button class="secondary-button compact-button" data-teaching-action="import-courses" type="button">导入课程</button>
        </div>
      </section>
      <section class="teaching-card">
        ${selected ? renderCourseEditor(selected) : '<div class="student-empty">点击 + 新增课程模块。</div>'}
      </section>
    </div>
  `
}

function renderCourseEditor(module) {
  const lecturesText = (module.lectures || [])
    .map((lecture) => [lecture.title, lecture.content, lecture.keyPoints, lecture.notes].join(' | '))
    .join('\n')
  const chaptersText = JSON.stringify(module.chapters || [], null, 2)

  return `
    <div class="result-head">
      <div class="teaching-title">编辑课程内容</div>
      <button class="list-delete-button" data-teaching-action="delete-module" data-id="${escapeHtml(module.id)}" type="button">删除模块</button>
    </div>
    <label class="field"><span>模块名称</span><input data-course-field="name" data-id="${escapeHtml(module.id)}" type="text" value="${escapeHtml(module.name)}" /></label>
    <label class="field"><span>讲次内容（一行一讲：标题 | 知识点 | 重难点 | 注意事项）</span><textarea data-course-field="lectures" data-id="${escapeHtml(module.id)}" rows="8">${escapeHtml(lecturesText)}</textarea></label>
    <label class="field"><span>章节/节/课时 JSON</span><textarea data-course-field="chapters" data-id="${escapeHtml(module.id)}" rows="8">${escapeHtml(chaptersText)}</textarea></label>
    <div class="panel-actions">
      <button class="secondary-button" data-teaching-action="fill-course-note" data-id="${escapeHtml(module.id)}" type="button">填入当前反馈</button>
      <button class="primary-button" data-teaching-action="save-course" data-id="${escapeHtml(module.id)}" type="button">保存课程</button>
    </div>
  `
}

function renderTeachingScores() {
  const classes = state.teaching.data.classes || []
  const selectedClass = classes.find((item) => item.id === state.teaching.selectedScoreClassId) || classes[0]
  if (selectedClass && !state.teaching.selectedScoreClassId) state.teaching.selectedScoreClassId = selectedClass.id

  const records = getScoreRecordsForClass(selectedClass && selectedClass.id)
  els.teachingContent.innerHTML = `
    <div class="teaching-grid two">
      <section class="teaching-card">
        <div class="teaching-title">新增成绩记录</div>
        <div class="form-grid two">
          <label class="field"><span>班级</span><select data-teaching-field="scoreClass">${classes.map((item) => `<option value="${escapeHtml(item.id)}" ${selectedClass && item.id === selectedClass.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
          <label class="field"><span>成绩模式</span><select data-teaching-field="scoreMode"><option value="percent" ${state.teaching.scoreMode === 'percent' ? 'selected' : ''}>百分制</option><option value="grade" ${state.teaching.scoreMode === 'grade' ? 'selected' : ''}>等级制</option></select></label>
        </div>
        <div class="form-grid three">
          <label class="field"><span>名称</span><input data-teaching-field="scoreTitle" type="text" placeholder="例如：第3讲易优精练" /></label>
          <label class="field"><span>日期</span><input data-teaching-field="scoreDate" type="date" value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label class="field"><span>总分</span><input data-teaching-field="scoreTotal" type="number" min="1" value="100" ${state.teaching.scoreMode === 'grade' ? 'disabled' : ''} /></label>
        </div>
        <div class="score-entry-list">
          ${selectedClass ? renderScoreRows(selectedClass) : '<div class="student-empty">请先建立班级花名册。</div>'}
        </div>
        <div class="panel-actions"><button class="primary-button" data-teaching-action="save-score" type="button">保存成绩</button></div>
      </section>
      <section class="teaching-card">
        ${renderClassStats(selectedClass, records)}
      </section>
    </div>
  `
  drawTeachingTrendChart(selectedClass, records)
}

function renderScoreRows(classInfo) {
  const students = Array.isArray(classInfo.students) ? classInfo.students : []
  return students.map((student) => `
    <div class="score-entry-row" data-score-student="${escapeHtml(student.name)}">
      <div class="student-name">${escapeHtml(student.name)}</div>
      ${state.teaching.scoreMode === 'grade'
        ? '<select data-score-field="grade"><option value="">-</option><option>A</option><option>B</option><option>C</option><option>D</option></select>'
        : '<input data-score-field="score" type="number" min="0" placeholder="分数" />'}
      <input data-score-field="note" type="text" placeholder="备注" />
    </div>
  `).join('')
}

function renderClassStats(classInfo, records) {
  if (!classInfo) return '<div class="student-empty">暂无班级。</div>'
  if (!records.length) return '<div class="student-empty">该班级暂无成绩记录。</div>'

  const latest = records[records.length - 1]
  const scores = latest.mode === 'percent'
    ? latest.students.map((student) => Number(student.score)).filter(Number.isFinite)
    : []
  const avg = scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : '-'
  const max = scores.length ? Math.max(...scores) : '-'
  const min = scores.length ? Math.min(...scores) : '-'

  return `
    <div class="result-head">
      <div>
        <div class="teaching-title">${escapeHtml(classInfo.name)} 成绩统计</div>
        <div class="teaching-meta">${records.length} 条记录</div>
      </div>
      <button class="secondary-button compact-button" data-teaching-action="analyze-class" data-id="${escapeHtml(classInfo.id)}" type="button">AI 分析</button>
    </div>
    <div class="stats-grid">
      <div><strong>${avg}</strong><span>平均分</span></div>
      <div><strong>${max}</strong><span>最高分</span></div>
      <div><strong>${min}</strong><span>最低分</span></div>
      <div><strong>${records.length}</strong><span>测评次数</span></div>
    </div>
    <canvas id="teachingScoreChart" class="score-chart" width="680" height="260"></canvas>
    <div class="teaching-analysis">${escapeHtml(state.teaching.aiResult || '')}</div>
  `
}

function renderTeachingPaperAnalysis() {
  const paper = getTeachingPaperState()
  const classes = getPaperAvailableClasses()
  const profiles = state.teaching.data.oneProfiles || []
  const selectedClass = getPaperSelectedClass()
  const selectedProfile = getPaperSelectedProfile()
  const questions = getPaperQuestions()
  const allStudents = getPaperAllStudents()
  const students = getPaperStudents(allStudents)

  els.teachingContent.innerHTML = `
    <div class="teaching-grid two">
      <section class="teaching-card paper-setup-card">
        <div class="result-head">
          <div>
            <div class="teaching-title">试卷分析</div>
            <div class="teaching-meta">上传试卷后，AI 会识别题号、分值、难度和知识点。</div>
          </div>
          <button class="secondary-button compact-button paper-sync-button" data-teaching-action="sync-primary" type="button">同步档案</button>
        </div>
        <div class="paper-target-grid">
          <label class="field">
            <span>分析对象</span>
            <select data-paper-field="scope">
              <option value="class" ${paper.scope === 'class' ? 'selected' : ''}>班课</option>
              <option value="one" ${paper.scope === 'one' ? 'selected' : ''}>一对一</option>
              <option value="single" ${paper.scope === 'single' ? 'selected' : ''}>单独建档</option>
            </select>
          </label>
          <label class="field ${paper.scope === 'class' ? '' : 'hidden'}">
            <span>选择班级</span>
            <select data-paper-field="classId">
              ${classes.length ? classes.map((classInfo) => `<option value="${escapeHtml(classInfo.id)}" ${selectedClass && selectedClass.id === classInfo.id ? 'selected' : ''}>${escapeHtml(classInfo.name)} · ${escapeHtml(classInfo.grade || '')}</option>`).join('') : '<option value="">暂无班级</option>'}
            </select>
          </label>
          <label class="field">
            <span>考试类型</span>
            <select data-paper-field="examType">
              ${paperExamTypeOptions.map((type) => `<option value="${escapeHtml(type)}" ${paper.examType === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}
            </select>
          </label>
          <label class="field ${paper.scope === 'one' ? '' : 'hidden'}">
            <span>选择学生档案</span>
            <select data-paper-field="profileId">
              ${profiles.length ? profiles.map((profile) => `<option value="${escapeHtml(profile.id)}" ${selectedProfile && selectedProfile.id === profile.id ? 'selected' : ''}>${escapeHtml(profile.name)} · ${escapeHtml(profile.grade || '')}</option>`).join('') : '<option value="">暂无一对一档案</option>'}
            </select>
          </label>
          <label class="field ${paper.scope === 'single' ? '' : 'hidden'}">
            <span>学生姓名</span>
            <input data-paper-field="singleStudentName" type="text" value="${escapeHtml(paper.singleStudentName)}" placeholder="例如：王同学" />
          </label>
        </div>
        ${renderPaperStudentPreview(allStudents, students, paper.scope)}
        <label class="field paper-file-field">
          <span>上传试卷</span>
          <input class="hidden" data-paper-field="file" type="file" accept=".pdf,.docx,.pptx,.txt,.md,image/*" />
          <div class="paper-file-control">
            <span class="paper-file-button">选择文件</span>
            <span class="paper-file-name">${escapeHtml(paper.fileName || '未选择文件')}</span>
          </div>
        </label>
        <div class="paper-upload-status">
          <span>${escapeHtml(paper.status || '')}</span>
        </div>
        <div class="panel-actions">
          <button class="primary-button" data-teaching-action="analyze-paper" type="button" ${paper.busy || !paper.file ? 'disabled' : ''}>${paper.busy ? 'AI 分析中...' : 'AI 深度分析试卷'}</button>
          <button class="secondary-button" data-teaching-action="reset-paper" type="button">清空本次分析</button>
        </div>
      </section>
      <section class="teaching-card">
        ${renderPaperAnalysisSummary(paper.analysis, questions)}
      </section>
    </div>
    ${paper.analysis ? renderPaperScoreEntry(students, questions) : ''}
    ${paper.report ? renderPaperReportArea() : ''}
  `
}

function renderPaperAnalysisSummary(analysis, questions) {
  if (!analysis) {
    return `
      <div class="teaching-title">分析结果</div>
      <div class="student-empty">试卷上传并分析后，会在这里显示题型结构、总分、知识点和录分入口。</div>
    `
  }

  const totalScore = getPaperTotalScore(questions)
  const sections = Array.isArray(analysis.sections) ? analysis.sections : []
  return `
    <div class="result-head">
      <div>
        <div class="teaching-title">${escapeHtml(analysis.title || '未命名试卷')}</div>
        <div class="teaching-meta">${sections.length} 个题型 · ${questions.length} 道题 · 卷面分 ${formatPaperNumber(totalScore)}</div>
      </div>
    </div>
    <div class="paper-section-list">
      ${sections.map((section) => `
        <div class="paper-section-item">
          <strong>${escapeHtml(section.title || '未命名题型')}</strong>
          <span>${Array.isArray(section.questions) ? section.questions.length : 0} 题</span>
        </div>
      `).join('')}
    </div>
    <div class="teaching-analysis">${escapeHtml(analysis.summary || 'AI 已完成试卷结构识别，请在下方录入学生得分。')}</div>
  `
}

function renderPaperStudentPreview(allStudents, activeStudents, scope) {
  if (scope !== 'class') return ''
  const activeIds = new Set(activeStudents.map((student) => student.id))

  return `
    <div class="paper-student-preview">
      <div class="paper-student-preview-head">
        <strong>学生名单</strong>
        <span>参与 ${activeStudents.length} / ${allStudents.length} 人</span>
      </div>
      ${allStudents.length
        ? `<div class="paper-student-chip-list">${allStudents.map((student) => {
            const active = activeIds.has(student.id)
            return `<button class="paper-student-chip ${active ? 'active' : 'excluded'}" data-teaching-action="toggle-paper-student" data-student-id="${escapeHtml(student.id)}" type="button">${escapeHtml(student.name)}</button>`
          }).join('')}</div>`
        : '<div class="student-empty compact-empty">当前班级暂无学生，请先在班级档案里添加学生，或点击“同步现有档案”。</div>'}
    </div>
  `
}

function renderPaperScoreEntry(students, questions) {
  if (!students.length) {
    return '<section class="teaching-card"><div class="student-empty">请先选择班级/一对一档案，或填写单独建档学生姓名。</div></section>'
  }

  if (!questions.length) {
    return '<section class="teaching-card"><div class="student-empty">AI 暂未识别到题目，请换一份更清晰的试卷重试。</div></section>'
  }

  return `
    <section class="teaching-card">
      <div class="result-head">
        <div>
          <div class="teaching-title">逐题得分录入</div>
          <div class="teaching-meta">${students.length} 名学生 · ${questions.length} 道题；下拉选项由 AI 识别的题分自动生成。</div>
        </div>
        <button class="primary-button compact-button" data-teaching-action="generate-paper-report" type="button">生成 PDF 文档</button>
      </div>
      <div class="paper-score-scroll">
        <table class="paper-score-table">
          <thead>
            <tr>
              <th class="paper-sticky-col">学生</th>
              ${questions.map((question) => `<th title="${escapeHtml(question.knowledge || '')}">${escapeHtml(question.number)}<small>${formatPaperNumber(question.score)}分</small></th>`).join('')}
              <th>批改图</th>
              <th>总分</th>
            </tr>
          </thead>
          <tbody>
            ${students.map((student) => `
              <tr>
                <td class="paper-sticky-col">${escapeHtml(student.name)}</td>
                ${questions.map((question) => `
                  <td>
                    <select data-paper-score data-student-id="${escapeHtml(student.id)}" data-question-key="${escapeHtml(question.key)}" aria-label="${escapeHtml(student.name)}第${escapeHtml(question.number)}题得分">
                      ${renderPaperScoreOptions(question, getPaperScoreValue(student.id, question.key))}
                    </select>
                  </td>
                `).join('')}
                <td class="paper-score-image-cell">
                  <label class="paper-score-upload">
                    <input class="hidden" data-paper-score-image data-student-id="${escapeHtml(student.id)}" type="file" accept=".pdf,image/*" />
                    <span>上传</span>
                  </label>
                  <small>${escapeHtml(getPaperScoreImageStatus(student.id))}</small>
                </td>
                <td class="paper-total-cell">${formatPaperNumber(getPaperStudentTotal(student.id, questions))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `
}

function renderPaperReportArea() {
  const paper = getTeachingPaperState()
  const reports = Array.isArray(paper.report && paper.report.students) ? paper.report.students : []
  const isClass = paper.report && paper.report.scope === 'class'
  const applied = Boolean(paper.report && paper.report.applied)

  if (isClass) {
    return `
      <section class="teaching-card">
        <div class="result-head">
          <div>
            <div class="teaching-title">学生 PDF 文档已准备</div>
            <div class="teaching-meta">班课会为每个学生生成一份单独的试卷分析 PDF，不合并成全班预览。</div>
          </div>
          <button class="primary-button compact-button" data-teaching-action="apply-paper-report" type="button" ${applied ? 'disabled' : ''}>${applied ? '已应用' : '确认应用到教学数据'}</button>
        </div>
        <div class="paper-pdf-ready">
          <strong>${escapeHtml(paper.report.title || '试卷分析')}</strong>
          <span>${escapeHtml(paper.report.targetName || '')} · ${reports.length} 份学生文档 · 卷面分 ${formatPaperNumber(paper.report.totalScore)}</span>
          <div>点击学生姓名按钮会直接下载该学生的 PDF 文件。</div>
          <div class="paper-pdf-doc-list">
            ${reports.map((studentReport) => `
              <button class="secondary-button compact-button" data-teaching-action="export-paper-pdf" data-student-id="${escapeHtml(studentReport.id)}" type="button">${escapeHtml(studentReport.name)} PDF</button>
            `).join('')}
          </div>
        </div>
      </section>
    `
  }

  return `
    <section class="teaching-card">
      <div class="result-head">
        <div>
          <div class="teaching-title">PDF 文档已准备</div>
          <div class="teaching-meta">${reports.length} 名学生 · ${isClass ? '班课 PDF 已包含每题平均分' : '一对一/单独分析不显示班级平均分'}。</div>
        </div>
        <div class="panel-actions inline-actions">
          <button class="primary-button compact-button" data-teaching-action="apply-paper-report" type="button" ${applied ? 'disabled' : ''}>${applied ? '已应用' : '确认应用到教学数据'}</button>
          <button class="secondary-button compact-button" data-teaching-action="export-paper-pdf" type="button">下载 PDF</button>
        </div>
      </div>
      <div class="paper-pdf-ready">
        <strong>${escapeHtml(paper.report.title || '试卷分析')}</strong>
        <span>${escapeHtml(paper.report.targetName || '')} · 卷面分 ${formatPaperNumber(paper.report.totalScore)}</span>
        <div>点击右上角按钮会直接下载 PDF 文件。</div>
      </div>
    </section>
  `
}

function renderPaperClassOverview(report) {
  const rows = (report.students || [])
    .slice()
    .sort((left, right) => right.total - left.total)

  return `
    <div class="paper-class-overview">
      <div>
        <strong>${escapeHtml(report.targetName || '班级')} 试卷总览</strong>
        <span>平均分 ${formatPaperNumber(report.classAverageTotal)} / ${formatPaperNumber(report.totalScore)}</span>
      </div>
      <div class="paper-rank-list">
        ${rows.map((row, index) => `<span>${index + 1}. ${escapeHtml(row.name)} ${formatPaperNumber(row.total)}</span>`).join('')}
      </div>
    </div>
  `
}

function renderPaperStudentReport(studentReport, report) {
  const showAverage = report.scope === 'class'
  const colSpan = showAverage ? 7 : 6
  const percent = report.totalScore ? Math.round((studentReport.total / report.totalScore) * 100) : 0

  return `
    <article class="paper-analysis-sheet">
      <header class="paper-sheet-head">
        <div>
          <p>${escapeHtml(report.title || '试卷分析')}</p>
          <h2>${escapeHtml(studentReport.name)} 试卷分析</h2>
        </div>
        <div class="paper-score-badge">
          <strong>${formatPaperNumber(studentReport.total)}</strong>
          <span>/ ${formatPaperNumber(report.totalScore)} 分 · ${percent}%</span>
        </div>
      </header>
      <table class="paper-analysis-table">
        <thead>
          <tr>
            <th>题号</th>
            <th>难度系数</th>
            <th>详细知识点</th>
            <th>题分</th>
            <th>得分</th>
            ${showAverage ? '<th>平均分</th>' : ''}
            <th>卷面分</th>
          </tr>
        </thead>
        <tbody>
          ${report.sections.map((section) => `
            <tr class="paper-section-row"><td colspan="${colSpan}">${escapeHtml(section.title)}</td></tr>
            ${section.questions.map((question) => renderPaperReportQuestionRow(question, studentReport, report, showAverage)).join('')}
          `).join('')}
        </tbody>
      </table>
      ${renderPaperWrongAdvice(studentReport)}
      <div class="paper-final-summary">
        <h3>最终试卷总结分析</h3>
        <p>${escapeHtml(studentReport.summary)}</p>
      </div>
    </article>
  `
}

function renderPaperReportQuestionRow(question, studentReport, report, showAverage) {
  const score = getPaperScoreFromReport(studentReport, question.key)
  const average = showAverage ? report.questionAverages[question.key] : null
  const scoreClass = Number(score) >= Number(question.score || 0) ? 'full' : (Number(score) > 0 ? 'partial' : 'empty')

  return `
    <tr>
      <td class="paper-question-number">${escapeHtml(question.number)}</td>
      <td>${escapeHtml(formatPaperDifficulty(question.difficulty))}</td>
      <td class="paper-knowledge-cell">${escapeHtml(question.knowledge || '待补充')}</td>
      <td>${formatPaperNumber(question.score)}</td>
      <td class="paper-earned ${scoreClass}">${formatPaperNumber(score)}</td>
      ${showAverage ? `<td class="paper-average-cell">${formatPaperNumber(average)}</td>` : ''}
      <td>${formatPaperNumber(report.totalScore)}</td>
    </tr>
  `
}

function renderPaperWrongAdvice(studentReport) {
  const wrongItems = studentReport.wrongQuestions || []
  if (!wrongItems.length) {
    return `
      <div class="paper-wrong-advice">
        <h3>错题分析与改进方案</h3>
        <p>本次录入结果没有明显失分题，后续可以用同类变式题保持手感。</p>
      </div>
    `
  }

  return `
    <div class="paper-wrong-advice">
      <h3>错题分析与改进方案</h3>
      ${wrongItems.map((item) => `
        <div class="paper-wrong-item">
          <strong>第 ${escapeHtml(item.number)} 题：${escapeHtml(item.knowledge || '相关知识点')}</strong>
          <p>${escapeHtml(item.analysis || '该题反映出对应知识点掌握还不够稳定。')}</p>
          <p><b>改进：</b>${escapeHtml(item.improvement || '建议先回看本题涉及的概念和关键步骤，再完成 2-3 道同类题进行巩固。')}</p>
        </div>
      `).join('')}
    </div>
  `
}

function renderPaperHistoryCard(item) {
  const createdAt = formatDateTime(item.createdAt)
  const students = Array.isArray(item.students) ? item.students : []
  return `
    <article class="teaching-card compact-card">
      <div class="result-head">
        <div>
          <div class="teaching-title">${escapeHtml(item.title || '试卷分析')}</div>
          <div class="teaching-meta">${createdAt} · ${escapeHtml(item.targetName || '')} · ${students.length} 名学生</div>
        </div>
        <button class="secondary-button compact-button" data-teaching-action="restore-paper-report" data-id="${escapeHtml(item.id)}" type="button">${item.scope === 'class' ? '打开列表' : '导出 PDF'}</button>
      </div>
    </article>
  `
}

function getTeachingPaperState() {
  if (!state.teaching.paper) state.teaching.paper = createEmptyPaperState()
  const paper = state.teaching.paper
  const classes = getPaperAvailableClasses()
  const profiles = state.teaching.data.oneProfiles || []

  if (paper.scope === 'class' && classes[0] && !classes.some((classInfo) => classInfo.id === paper.selectedClassId)) {
    paper.selectedClassId = classes[0].id
  }
  if (paper.scope === 'one' && !paper.selectedProfileId && profiles[0]) {
    paper.selectedProfileId = profiles[0].id
  }

  return paper
}

function getPaperAvailableClasses() {
  const primaryClasses = normalizePaperClassOptions(state.classes || [])
  if (primaryClasses.length) return primaryClasses
  return normalizePaperClassOptions(state.teaching.data.classes || [])
}

function normalizePaperClassOptions(classes) {
  const seen = new Set()
  return (Array.isArray(classes) ? classes : [])
    .map((classInfo) => {
      const source = classInfo && typeof classInfo === 'object' ? classInfo : {}
      const name = trimText(source.name)
      const grade = trimText(source.grade)
      const students = Array.isArray(source.students) ? source.students : []
      return {
        ...source,
        id: trimText(source.id) || `${name}-${grade}`,
        name,
        grade,
        students
      }
    })
    .filter((classInfo) => classInfo.name && classInfo.students.length)
    .filter((classInfo) => !/出门测|流程测试/i.test(classInfo.name))
    .filter((classInfo) => {
      const key = `${classInfo.name}::${classInfo.grade}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function getPaperSelectedClass() {
  const paper = getTeachingPaperState()
  const classes = getPaperAvailableClasses()
  return classes.find((item) => item.id === paper.selectedClassId) || classes[0] || null
}

function getPaperSelectedProfile() {
  const paper = getTeachingPaperState()
  const profiles = state.teaching.data.oneProfiles || []
  return profiles.find((item) => item.id === paper.selectedProfileId) || profiles[0] || null
}

function getPaperAllStudents() {
  const paper = getTeachingPaperState()
  if (paper.scope === 'class') {
    const classInfo = getPaperSelectedClass()
    return classInfo && Array.isArray(classInfo.students)
      ? classInfo.students.map((student, index) => ({
          id: student.id || `class-student-${index + 1}`,
          name: student.name
        })).filter((student) => student.name)
      : []
  }

  if (paper.scope === 'one') {
    const profile = getPaperSelectedProfile()
    return profile ? [{ id: profile.id, name: profile.name }] : []
  }

  const name = trimText(paper.singleStudentName) || '单独学生'
  return [{ id: 'single-paper-student', name }]
}

function getPaperStudents(allStudents = getPaperAllStudents()) {
  const paper = getTeachingPaperState()
  const excluded = new Set(Array.isArray(paper.excludedStudentIds) ? paper.excludedStudentIds : [])
  return allStudents.filter((student) => !excluded.has(student.id))
}

function getPaperQuestions(analysis = getTeachingPaperState().analysis) {
  if (!analysis) return []
  const sections = Array.isArray(analysis.sections) ? analysis.sections : []
  return sections.flatMap((section, sectionIndex) => (
    (Array.isArray(section.questions) ? section.questions : []).map((question, questionIndex) => ({
      ...question,
      sectionTitle: section.title || `题型 ${sectionIndex + 1}`,
      key: question.key || question.id || `${sectionIndex + 1}-${question.number || questionIndex + 1}`,
      number: question.number || String(questionIndex + 1),
      score: normalizePaperScore(question.score)
    }))
  ))
}

function getPaperSectionsWithQuestions(analysis) {
  const sections = Array.isArray(analysis && analysis.sections) ? analysis.sections : []
  return sections.map((section, sectionIndex) => ({
    title: section.title || `题型 ${sectionIndex + 1}`,
    questions: (Array.isArray(section.questions) ? section.questions : []).map((question, questionIndex) => ({
      ...question,
      sectionTitle: section.title || `题型 ${sectionIndex + 1}`,
      key: question.key || question.id || `${sectionIndex + 1}-${question.number || questionIndex + 1}`,
      number: question.number || String(questionIndex + 1),
      score: normalizePaperScore(question.score)
    }))
  })).filter((section) => section.questions.length)
}

function normalizePaperScore(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 1
}

function getPaperTotalScore(questions = getPaperQuestions()) {
  return questions.reduce((sum, question) => sum + normalizePaperScore(question.score), 0)
}

function getPaperScoreValue(studentId, questionKey) {
  const paper = getTeachingPaperState()
  const studentScores = paper.scores && paper.scores[studentId]
  const value = studentScores ? studentScores[questionKey] : ''
  if (value === undefined || value === null || value === '') {
    const question = getPaperQuestions().find((item) => item.key === questionKey)
    return question && shouldDefaultPaperQuestionFull(question) ? formatPaperNumber(question.score) : ''
  }
  return String(value)
}

function shouldDefaultPaperQuestionFull(question) {
  return /选择|单选|多选|填空/.test(String(question && question.sectionTitle || ''))
}

function getPaperStudentTotal(studentId, questions = getPaperQuestions()) {
  return questions.reduce((sum, question) => {
    const value = Number(getPaperScoreValue(studentId, question.key))
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
}

function renderPaperScoreOptions(question, selectedValue) {
  const maxScore = normalizePaperScore(question.score)
  const step = maxScore <= 10 && !Number.isInteger(maxScore) ? 0.5 : 1
  const options = ['<option value="">-</option>']
  const values = []

  for (let value = 0; value <= maxScore + 0.0001; value += step) {
    values.push(Number(value.toFixed(2)))
  }
  if (!values.includes(maxScore)) values.push(maxScore)

  Array.from(new Set(values)).sort((left, right) => left - right).forEach((value) => {
    const text = formatPaperNumber(value)
    options.push(`<option value="${text}" ${String(selectedValue) === text ? 'selected' : ''}>${text}</option>`)
  })

  return options.join('')
}

function generatePaperReport() {
  const paper = getTeachingPaperState()
  if (!paper.analysis) {
    showToast('请先让 AI 分析试卷')
    return
  }

  const students = getPaperStudents()
  const sections = getPaperSectionsWithQuestions(paper.analysis)
  const questions = sections.flatMap((section) => section.questions)

  if (!students.length || !questions.length) {
    showToast('请先选择学生并确认试卷题目')
    return
  }

  const totalScore = getPaperTotalScore(questions)
  const questionAverages = {}

  questions.forEach((question) => {
    const values = students
      .map((student) => Number(getPaperScoreValue(student.id, question.key)))
      .filter(Number.isFinite)
    questionAverages[question.key] = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0
  })

  const classAverageTotal = students.length
    ? students.reduce((sum, student) => sum + getPaperStudentTotal(student.id, questions), 0) / students.length
    : 0

  const report = {
    id: createId('paper-report'),
    scope: paper.scope,
    classId: paper.scope === 'class' ? paper.selectedClassId : '',
    profileId: paper.scope === 'one' ? paper.selectedProfileId : '',
    examType: paper.examType || '出门测',
    title: `${paper.examType || '出门测'} · ${paper.analysis.title || paper.fileName || '试卷分析'}`,
    fileName: paper.fileName,
    targetName: getPaperTargetName(),
    date: getLocalDateKey(new Date()),
    totalScore,
    classAverageTotal,
    sections,
    questionAverages,
    summary: paper.analysis.summary || '',
    students: students.map((student) => buildPaperStudentReport(student, sections, totalScore)),
    createdAt: Date.now()
  }

  paper.report = report
  renderTeachingPanel()
  if (report.scope === 'class') {
    showToast('每个学生的单独 PDF 文档已生成')
  } else {
    exportPaperReportPdf(report)
    showToast('PDF 文档已生成，可在打印窗口里另存为 PDF')
  }
}

function buildPaperStudentReport(student, sections, totalScore) {
  const questions = sections.flatMap((section) => section.questions)
  const scores = {}
  questions.forEach((question) => {
    const value = Number(getPaperScoreValue(student.id, question.key))
    scores[question.key] = Number.isFinite(value) ? value : 0
  })

  const total = questions.reduce((sum, question) => sum + scores[question.key], 0)
  const wrongQuestions = questions
    .filter((question) => scores[question.key] < normalizePaperScore(question.score))
    .map((question) => ({
      number: question.number,
      knowledge: question.knowledge,
      score: scores[question.key],
      maxScore: normalizePaperScore(question.score),
      analysis: question.analysis,
      improvement: question.improvement
    }))

  return {
    id: student.id,
    name: student.name,
    total,
    totalScore,
    scores,
    wrongQuestions,
    summary: buildPaperFinalSummary(student.name, total, totalScore, wrongQuestions)
  }
}

function buildPaperFinalSummary(studentName, total, totalScore, wrongQuestions) {
  const rate = totalScore ? total / totalScore : 0
  const level = rate >= 0.9
    ? '整体掌握较扎实'
    : (rate >= 0.75 ? '基础掌握较稳定，但仍有局部漏洞' : (rate >= 0.6 ? '基础框架已有，但关键题型还需要加强' : '本次试卷暴露出较多基础和方法问题'))
  const weakText = wrongQuestions.length
    ? `主要失分集中在${wrongQuestions.slice(0, 4).map((item) => `第${item.number}题`).join('、')}，建议按知识点先补概念，再做同类变式。`
    : '本次没有明显失分题，建议继续保持审题和书写规范，并适当做拓展题。'

  return `${studentName}本次得分 ${formatPaperNumber(total)}/${formatPaperNumber(totalScore)}，${level}。${weakText}`
}

function savePaperReportHistory(report) {
  if (!report) return
  const historyItem = {
    id: report.id,
    title: report.title,
    examType: report.examType,
    fileName: report.fileName,
    scope: report.scope,
    classId: report.classId || '',
    profileId: report.profileId || '',
    targetName: report.targetName,
    date: report.date || getLocalDateKey(new Date(report.createdAt || Date.now())),
    totalScore: report.totalScore,
    classAverageTotal: report.classAverageTotal,
    sections: report.sections,
    questionAverages: report.questionAverages,
    students: report.students,
    summary: report.summary,
    applied: Boolean(report.applied),
    createdAt: report.createdAt
  }
  state.teaching.data.paperAnalyses = [
    historyItem,
    ...(state.teaching.data.paperAnalyses || []).filter((item) => item.id !== historyItem.id)
  ].slice(0, 80)
}

async function applyPaperReportToTeachingData() {
  const paper = getTeachingPaperState()
  const report = paper.report
  if (!report || report.applied) return

  mergePrimaryIntoTeachingData()
  report.applied = true
  savePaperReportHistory(report)

  const scoreRecord = buildScoreRecordFromPaperReport(report)
  if (scoreRecord) {
    state.teaching.data.scoreRecords = [
      scoreRecord,
      ...(state.teaching.data.scoreRecords || []).filter((item) => item.sourceFeedbackId !== report.id)
    ]
  }

  await saveTeachingData({ silent: true })
  renderTeachingPanel()
  showToast('试卷分析已应用到教学数据')
}

function buildScoreRecordFromPaperReport(report) {
  if (!report || !['class', 'one'].includes(report.scope)) return null

  return {
    id: createId('score'),
    sourceFeedbackId: report.id,
    recordType: 'paperAnalysis',
    scope: report.scope === 'one' ? 'oneOnOne' : 'class',
    classId: report.scope === 'class' ? report.classId || '' : '',
    className: report.scope === 'class' ? report.targetName || '' : '',
    profileId: report.scope === 'one' ? report.profileId || '' : '',
    studentName: report.scope === 'one' && report.students && report.students[0] ? report.students[0].name : '',
    title: report.examType || '试卷分析',
    subject: report.title || '',
    date: report.date || getLocalDateKey(new Date(report.createdAt || Date.now())),
    mode: 'percent',
    totalScore: Number(report.totalScore || 100),
    students: (report.students || []).map((student) => ({
      studentId: student.id || '',
      name: student.name,
      score: Number(student.total),
      grade: '',
      note: ''
    })).filter((student) => student.name),
    createdAt: Date.now()
  }
}

function restorePaperReport(id) {
  const item = (state.teaching.data.paperAnalyses || []).find((history) => history.id === id)
  if (!item) return
  const paper = getTeachingPaperState()
  paper.report = {
    ...item,
    sections: Array.isArray(item.sections) ? item.sections : [],
    questionAverages: item.questionAverages || {},
    students: Array.isArray(item.students) ? item.students : []
  }
  paper.analysis = {
    title: item.title,
    sections: paper.report.sections,
    summary: item.summary
  }
  renderTeachingPanel()
  if (paper.report.scope === 'class') {
    showToast('已打开学生 PDF 列表')
  } else {
    exportPaperReportPdf(paper.report)
  }
}

function getPaperTargetName() {
  const paper = getTeachingPaperState()
  if (paper.scope === 'class') {
    const classInfo = getPaperSelectedClass()
    return classInfo ? classInfo.name : '班级'
  }
  if (paper.scope === 'one') {
    const profile = getPaperSelectedProfile()
    return profile ? profile.name : '一对一学生'
  }
  return trimText(paper.singleStudentName) || '单独学生'
}

function getPaperScoreFromReport(studentReport, questionKey) {
  const scores = studentReport && studentReport.scores ? studentReport.scores : {}
  const value = Number(scores[questionKey])
  return Number.isFinite(value) ? value : 0
}

function formatPaperDifficulty(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  if (number > 1) return (number / 100).toFixed(2)
  return number.toFixed(2)
}

function formatPaperNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, '')
}

function trimText(value) {
  return String(value || '').trim()
}

function renderTeachingHistory() {
  const history = state.teaching.data.feedbackHistory || []
  els.teachingContent.innerHTML = `
    <section class="teaching-card">
      <div class="result-head">
        <div>
          <div class="teaching-title">反馈历史记录</div>
          <div class="teaching-meta">${history.length} 条历史</div>
        </div>
        <button class="secondary-button compact-button" data-teaching-action="clear-history" type="button">清空历史</button>
      </div>
      <div class="teaching-list">
        ${history.length ? history.slice().reverse().map(renderHistoryCard).join('') : '<div class="student-empty">生成反馈后会自动保存到这里。</div>'}
      </div>
    </section>
  `
}

function renderHistoryCard(item) {
  const firstFeedback = item.feedbacks && item.feedbacks[0] ? item.feedbacks[0].feedback : ''
  return `
    <article class="teaching-card compact-card">
      <div class="result-head">
        <div>
          <div class="teaching-title">${escapeHtml(item.className || item.studentName || '未命名反馈')}</div>
          <div class="teaching-meta">${formatDateTime(item.createdAt)} · ${escapeHtml(item.lessonTitle || '未填写主题')}</div>
        </div>
        <div class="button-row">
          <button class="secondary-button compact-button" data-teaching-action="copy-history" data-id="${escapeHtml(item.id)}" type="button">复制</button>
          <button class="list-delete-button" data-teaching-action="delete-history" data-id="${escapeHtml(item.id)}" type="button">删除</button>
        </div>
      </div>
      <p class="result-text">${escapeHtml(firstFeedback || '暂无正文')}</p>
    </article>
  `
}

function renderTeachingOneProfiles() {
  const profiles = state.teaching.data.oneProfiles || []
  const selected = profiles.find((item) => item.id === state.teaching.selectedOneProfileId) || profiles[0]
  if (selected && !state.teaching.selectedOneProfileId) state.teaching.selectedOneProfileId = selected.id
  const records = selected ? getScoreRecordsForOneProfile(selected) : []

  els.teachingContent.innerHTML = `
    <div class="teaching-grid sidebar-layout">
      <section class="teaching-card">
        <div class="result-head"><div class="teaching-title">一对一长期档案</div><button class="icon-action" data-teaching-action="add-one-profile" type="button">+</button></div>
        <div class="teaching-pill-list">
          ${profiles.length ? profiles.map((profile) => `
            <button class="teaching-pill ${selected && profile.id === selected.id ? 'active' : ''}" data-teaching-action="select-one-profile" data-id="${escapeHtml(profile.id)}" type="button">${escapeHtml(profile.name)}</button>
          `).join('') : '<div class="student-empty compact-empty">暂无档案</div>'}
        </div>
      </section>
      <section class="teaching-card">
        ${selected ? renderOneLongProfile(selected, records) : '<div class="student-empty">点击 + 新增一对一档案。</div>'}
      </section>
    </div>
  `
  drawOneProfileTrendChart(records)
}

function renderOneLongProfile(profile, records) {
  return `
    <div class="result-head">
      <div>
        <div class="teaching-title">${escapeHtml(profile.name)} · ${escapeHtml(profile.grade || '')}</div>
        <div class="teaching-meta">${records.length} 条成绩记录</div>
      </div>
      <button class="secondary-button compact-button" data-teaching-action="analyze-one-profile" data-id="${escapeHtml(profile.id)}" type="button">AI 综合分析</button>
    </div>
    <div class="form-grid two">
      <label class="field"><span>平时性格</span><textarea data-one-field="personality" data-id="${escapeHtml(profile.id)}" rows="4">${escapeHtml(profile.personality || '')}</textarea></label>
      <label class="field"><span>做题习惯</span><textarea data-one-field="habit" data-id="${escapeHtml(profile.id)}" rows="4">${escapeHtml(profile.habit || '')}</textarea></label>
    </div>
    <canvas id="oneProfileTrendChart" class="score-chart" width="680" height="260"></canvas>
    <div class="teaching-analysis">${escapeHtml(state.teaching.aiResult || '')}</div>
  `
}

function renderTeachingBackup() {
  const data = state.teaching.data
  els.teachingContent.innerHTML = `
    <section class="teaching-card">
      <div class="teaching-title">全部数据备份 / 恢复</div>
      <div class="stats-grid">
        <div><strong>${data.classes.length}</strong><span>班级</span></div>
        <div><strong>${data.courseModules.length}</strong><span>课程模块</span></div>
        <div><strong>${data.scoreRecords.length}</strong><span>成绩记录</span></div>
        <div><strong>${data.feedbackHistory.length}</strong><span>反馈历史</span></div>
      </div>
      <label class="field"><span>课后作业快捷项</span><textarea data-teaching-quick="homework" rows="4">${escapeHtml((data.quickOptions.homework || []).join('\n'))}</textarea></label>
      <label class="field"><span>教学建议快捷项</span><textarea data-teaching-quick="teaching" rows="4">${escapeHtml((data.quickOptions.teaching || []).join('\n'))}</textarea></label>
      <div class="panel-actions">
        <button class="secondary-button" data-teaching-action="export-backup" type="button">导出全部备份</button>
        <button class="secondary-button" data-teaching-action="restore-backup" type="button">恢复备份</button>
        <button class="primary-button" data-teaching-action="save-teaching" type="button">保存到后端</button>
      </div>
    </section>
  `
}

async function handleTeachingClick(event) {
  const button = event.target.closest('[data-teaching-action]')
  if (!button) return

  const action = button.dataset.teachingAction
  const id = button.dataset.id || ''

  if (action === 'sync-primary') {
    await syncTeachingProfiles()
  }
  if (action === 'select-data-class') {
    state.teaching.selectedClassId = id
    renderTeachingPanel()
  }
  if (action === 'select-data-one') {
    state.teaching.selectedOneProfileId = id
    renderTeachingPanel()
  }
  if (action === 'add-class') addTeachingClass()
  if (action === 'delete-class') deleteTeachingClass(id)
  if (action === 'add-module') addTeachingModule()
  if (action === 'select-module') {
    state.teaching.selectedModuleId = id
    renderTeachingPanel()
  }
  if (action === 'delete-module') deleteTeachingModule(id)
  if (action === 'save-course') saveTeachingCourse(id)
  if (action === 'fill-course-note') fillCourseNoteFromModule(id)
  if (action === 'export-courses') exportTeachingCourses()
  if (action === 'import-courses') importTeachingCourses()
  if (action === 'save-score') saveTeachingScore()
  if (action === 'analyze-class') analyzeTeachingClass(id)
  if (action === 'analyze-paper') analyzePaperFile()
  if (action === 'generate-paper-report') generatePaperReport()
  if (action === 'apply-paper-report') applyPaperReportToTeachingData()
  if (action === 'export-paper-pdf') exportPaperReportPdf(null, button.dataset.studentId || '')
  if (action === 'toggle-paper-student') togglePaperStudent(button.dataset.studentId || '')
  if (action === 'restore-paper-report') restorePaperReport(id)
  if (action === 'reset-paper') {
    state.teaching.paper = createEmptyPaperState()
    renderTeachingPanel()
  }
  if (action === 'clear-history') clearTeachingHistory()
  if (action === 'copy-history') copyTeachingHistory(id)
  if (action === 'delete-history') deleteTeachingHistory(id)
  if (action === 'delete-student-scores') deleteStudentTeachingRecords(button, 'scores')
  if (action === 'delete-student-paper-results') deleteStudentTeachingRecords(button, 'paper')
  if (action === 'delete-student-feedbacks') deleteStudentTeachingRecords(button, 'feedbacks')
  if (action === 'delete-student-attendance') deleteStudentTeachingRecords(button, 'attendance')
  if (action === 'add-one-profile') addTeachingOneProfile()
  if (action === 'select-one-profile') {
    state.teaching.selectedOneProfileId = id
    renderTeachingPanel()
  }
  if (action === 'analyze-one-profile') analyzeOneTeachingProfile(id)
  if (action === 'export-backup') exportTeachingBackup()
  if (action === 'restore-backup') els.teachingRestoreInput.click()
  if (action === 'save-teaching') saveTeachingData()
}

function handleTeachingInput(event) {
  if (event.target.matches('[data-teaching-quick]')) {
    const key = event.target.dataset.teachingQuick
    state.teaching.data.quickOptions[key] = parseLines(event.target.value)
    scheduleTeachingSave()
  }
  if (event.target.matches('[data-teaching-field="classStudents"]')) {
    const classInfo = state.teaching.data.classes.find((item) => item.id === event.target.dataset.id)
    if (classInfo) {
      classInfo.students = parseLines(event.target.value).map((name) => ({ id: createId('stu'), name }))
      scheduleTeachingSave()
    }
  }
  if (event.target.matches('[data-one-field]')) {
    const profile = state.teaching.data.oneProfiles.find((item) => item.id === event.target.dataset.id)
    if (profile) {
      profile[event.target.dataset.oneField] = event.target.value
      scheduleTeachingSave()
    }
  }
  if (event.target.matches('[data-paper-field="singleStudentName"]')) {
    const paper = getTeachingPaperState()
    paper.singleStudentName = event.target.value
    paper.report = null
  }
}

function handleTeachingChange(event) {
  if (event.target.matches('[data-paper-field]')) {
    handlePaperFieldChange(event.target)
  }
  if (event.target.matches('[data-paper-score]')) {
    handlePaperScoreChange(event.target)
  }
  if (event.target.matches('[data-paper-score-image]')) {
    recognizePaperStudentScores(event.target)
  }
  if (event.target.matches('[data-teaching-field="scoreClass"]')) {
    state.teaching.selectedScoreClassId = event.target.value
    renderTeachingPanel()
  }
  if (event.target.matches('[data-teaching-field="scoreMode"]')) {
    state.teaching.scoreMode = event.target.value
    renderTeachingPanel()
  }
}

function handlePaperFieldChange(target) {
  const paper = getTeachingPaperState()
  const field = target.dataset.paperField

  if (field === 'scope') {
    paper.scope = target.value || 'class'
    paper.excludedStudentIds = []
    paper.report = null
    renderTeachingPanel()
    return
  }

  if (field === 'classId') {
    paper.selectedClassId = target.value
    paper.excludedStudentIds = []
    paper.report = null
    renderTeachingPanel()
    return
  }

  if (field === 'profileId') {
    paper.selectedProfileId = target.value
    paper.excludedStudentIds = []
    paper.report = null
    renderTeachingPanel()
    return
  }

  if (field === 'examType') {
    paper.examType = target.value || '出门测'
    paper.report = null
    renderTeachingPanel()
    return
  }

  if (field === 'file') {
    const file = target.files && target.files[0]
    paper.file = file || null
    paper.fileName = file ? file.name : ''
    paper.fileKey = file ? getFileKey(file) : ''
    paper.analysis = null
    paper.report = null
    paper.scores = {}
    paper.status = file ? `已选择：${file.name}` : '等待上传试卷'
    renderTeachingPanel()
  }
}

function handlePaperScoreChange(target) {
  const paper = getTeachingPaperState()
  const studentId = target.dataset.studentId
  const questionKey = target.dataset.questionKey
  if (!studentId || !questionKey) return

  if (!paper.scores[studentId]) paper.scores[studentId] = {}
  paper.scores[studentId][questionKey] = target.value
  paper.report = null

  const totalCell = target.closest('tr') && target.closest('tr').querySelector('.paper-total-cell')
  if (totalCell) {
    totalCell.textContent = formatPaperNumber(getPaperStudentTotal(studentId))
  }
}

function getPaperScoreImageStatus(studentId) {
  const statusMap = getTeachingPaperState().scoreImageStatus || {}
  return statusMap[studentId] || ''
}

async function recognizePaperStudentScores(input) {
  const file = input.files && input.files[0]
  const studentId = input.dataset.studentId
  const student = getPaperStudents().find((item) => item.id === studentId)
  const questions = getPaperQuestions()

  if (!file || !student || !questions.length) return

  const paper = getTeachingPaperState()
  if (!paper.scoreImageStatus) paper.scoreImageStatus = {}
  paper.scoreImageStatus[studentId] = 'AI 识别中...'
  paper.report = null
  renderTeachingPanel()

  try {
    const formData = await buildPaperScoreRecognitionFormData(file, student, questions)
    const response = await fetch('/api/teaching-data/paper-score-recognition', {
      method: 'POST',
      body: formData
    })
    const data = await response.json()

    if (response.status === 401) {
      updateAccessState({ authenticated: false })
      renderAccessState()
      throw new Error(data.error || '请先登录账号')
    }

    if (response.status === 429) {
      updateAccessState({ usage: data.usage || state.access.usage })
      renderAccessState()
      throw new Error(data.error || '今日生成次数已用完')
    }

    if (!response.ok) throw new Error(data.error || '批改图识别失败')

    if (data.usage) {
      updateAccessState({ usage: data.usage })
      renderAccessState()
    }

    applyRecognizedPaperScores(studentId, data.scores || {}, questions)
    paper.scoreImageStatus[studentId] = data.demo ? '演示识别已填入' : 'AI 已填入'
    showToast(`${student.name} 的批改图分数已填入，可继续手动修改`)
  } catch (error) {
    paper.scoreImageStatus[studentId] = error.message || '识别失败'
    showToast(error.message || '批改图识别失败')
  } finally {
    input.value = ''
    renderTeachingPanel()
  }
}

async function buildPaperScoreRecognitionFormData(file, student, questions) {
  const formData = new FormData()
  const payload = {
    title: getTeachingPaperState().analysis ? getTeachingPaperState().analysis.title : '试卷分析',
    examType: getTeachingPaperState().examType || '出门测',
    student,
    questions: questions.map((question) => ({
      key: question.key,
      number: question.number,
      sectionTitle: question.sectionTitle,
      knowledge: question.knowledge,
      score: question.score
    }))
  }

  if (isPdfFile(file)) {
    await appendPaperScorePdfData(formData, file, payload)
  }

  formData.append('payload', JSON.stringify(payload))
  formData.append('scoreFile', file, file.name)
  return formData
}

async function appendPaperScorePdfData(formData, file, payload) {
  if (!window.pdfjsLib) return

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const pageCount = pdf.numPages || 0
  const imagePageCount = Math.min(pageCount, PAPER_SCORE_MAX_PAGE_IMAGES)
  const textParts = []

  payload.selectedPdfPages = Array.from({ length: pageCount }, (item, index) => index + 1)
  payload.pdfPageCount = pageCount
  payload.imagePageCount = imagePageCount

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent().catch(() => null)
    if (textContent && Array.isArray(textContent.items)) {
      const pageText = textContent.items.map((item) => item.str || '').join(' ').replace(/\s+/g, ' ').trim()
      if (pageText) textParts.push(`第 ${pageNumber} 页：${pageText}`)
    }

    if (pageNumber <= imagePageCount) {
      const blob = await renderPdfPageToImageBlob(page, { maxEdge: 1600, quality: 0.76 })
      if (blob) formData.append('scorePageImage', blob, `${file.name}-page-${pageNumber}.jpg`)
    }
  }

  if (textParts.length) payload.clientPdfText = textParts.join('\n').slice(0, 30000)
}

function applyRecognizedPaperScores(studentId, scores, questions) {
  const paper = getTeachingPaperState()
  if (!paper.scores[studentId]) paper.scores[studentId] = {}

  questions.forEach((question) => {
    const rawValue = scores[question.key] ?? scores[question.number]
    const value = Number(rawValue)
    if (!Number.isFinite(value)) return
    paper.scores[studentId][question.key] = formatPaperNumber(Math.max(0, Math.min(normalizePaperScore(question.score), value)))
  })
}

function togglePaperStudent(studentId) {
  if (!studentId) return
  const paper = getTeachingPaperState()
  const excluded = new Set(Array.isArray(paper.excludedStudentIds) ? paper.excludedStudentIds : [])
  if (excluded.has(studentId)) excluded.delete(studentId)
  else excluded.add(studentId)
  paper.excludedStudentIds = Array.from(excluded)
  paper.report = null
  renderTeachingPanel()
}

async function analyzePaperFile() {
  const paper = getTeachingPaperState()
  if (!paper.file) {
    showToast('请先上传试卷文件')
    return
  }

  try {
    paper.busy = true
    paper.status = '正在准备试卷内容...'
    renderTeachingPanel()

    const formData = await buildPaperAnalysisFormData(paper.file)
    paper.status = 'AI 正在深度分析试卷...'
    renderTeachingPanel()

    const response = await fetch('/api/teaching-data/paper-analysis', {
      method: 'POST',
      body: formData
    })
    const data = await response.json()

    if (response.status === 401) {
      updateAccessState({ authenticated: false })
      renderAccessState()
      throw new Error(data.error || '请先登录账号')
    }

    if (response.status === 429) {
      updateAccessState({ usage: data.usage || state.access.usage })
      renderAccessState()
      throw new Error(data.error || '今日生成次数已用完')
    }

    if (!response.ok) throw new Error(data.error || '试卷分析失败')

    if (data.usage) {
      updateAccessState({ usage: data.usage })
      renderAccessState()
    }

    paper.analysis = normalizePaperAnalysisClient(data.analysis)
    paper.scores = {}
    paper.report = null
    paper.status = data.demo ? '演示分析已生成' : 'AI 分析完成'
    showToast(data.demo ? '当前未配置 AI，已生成演示试卷分析' : '试卷分析完成')
  } catch (error) {
    paper.status = error.message || '试卷分析失败'
    showToast(error.message || '试卷分析失败')
  } finally {
    paper.busy = false
    renderTeachingPanel()
  }
}

async function buildPaperAnalysisFormData(file) {
  const formData = new FormData()
  const payload = {
    title: file.name.replace(/\.[^.]+$/, ''),
    fileName: file.name,
    scope: getTeachingPaperState().scope,
    examType: getTeachingPaperState().examType || '出门测'
  }

  if (isPdfFile(file)) {
    await appendPaperPdfData(formData, file, payload)
  }

  formData.append('payload', JSON.stringify(payload))
  formData.append('paperFile', file, file.name)
  return formData
}

async function appendPaperPdfData(formData, file, payload) {
  if (!window.pdfjsLib) {
    showToast('PDF 解析组件未加载，将按普通 PDF 上传')
    return
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  const paper = getTeachingPaperState()
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const pageCount = pdf.numPages || 0
  const imagePageCount = Math.min(pageCount, PAPER_ANALYSIS_MAX_PAGE_IMAGES)
  const textParts = []

  payload.selectedPdfPages = Array.from({ length: pageCount }, (item, index) => index + 1)
  payload.pdfPageCount = pageCount
  payload.imagePageCount = imagePageCount

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    paper.status = `正在读取 PDF 第 ${pageNumber}/${pageCount} 页`
    renderTeachingPanel()
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent().catch(() => null)
    if (textContent && Array.isArray(textContent.items)) {
      const pageText = textContent.items.map((item) => item.str || '').join(' ').replace(/\s+/g, ' ').trim()
      if (pageText) textParts.push(`第 ${pageNumber} 页：${pageText}`)
    }

    if (pageNumber <= imagePageCount) {
      const blob = await renderPdfPageToImageBlob(page, { maxEdge: 1600, quality: 0.76 })
      if (blob) formData.append('paperPageImage', blob, `${file.name}-page-${pageNumber}.jpg`)
    }
  }

  if (textParts.length) {
    payload.clientPdfText = textParts.join('\n').slice(0, 50000)
  }
}

function normalizePaperAnalysisClient(input) {
  const source = input && typeof input === 'object' ? input : {}
  let sections = Array.isArray(source.sections) ? source.sections : []
  if (!sections.length && Array.isArray(source.questions)) {
    sections = [{ title: '试卷题目', questions: source.questions }]
  }

  sections = sections.map((section, sectionIndex) => ({
    id: section.id || `paper-section-${sectionIndex + 1}`,
    title: section.title || `题型 ${sectionIndex + 1}`,
    questions: (Array.isArray(section.questions) ? section.questions : []).map((question, questionIndex) => ({
      id: question.id || `paper-q-${sectionIndex + 1}-${questionIndex + 1}`,
      key: question.key || question.id || `${sectionIndex + 1}-${question.number || questionIndex + 1}`,
      number: String(question.number || questionIndex + 1),
      difficulty: question.difficulty,
      knowledge: question.knowledge || question.knowledgePoint || question.point || '',
      score: normalizePaperScore(question.score || question.points || 1),
      analysis: question.analysis || '',
      improvement: question.improvement || question.suggestion || ''
    })).filter((question) => question.number)
  })).filter((section) => section.questions.length)

  if (!sections.length) {
    sections = [{
      id: 'paper-section-demo',
      title: '试卷题目',
      questions: [{
        id: 'paper-q-1',
        key: '1-1',
        number: '1',
        difficulty: 0.75,
        knowledge: '待识别知识点',
        score: 1,
        analysis: 'AI 暂未识别出完整题目，可重新上传清晰文件。',
        improvement: '建议确认试卷清晰度后再次分析。'
      }]
    }]
  }

  return {
    title: source.title || '试卷分析',
    totalScore: Number(source.totalScore || getPaperTotalScore(sections.flatMap((section) => section.questions))) || 0,
    sections,
    summary: source.summary || ''
  }
}

async function exportPaperReportPdf(report = null, studentId = '') {
  const activeReport = report || (getTeachingPaperState().report)
  if (!activeReport) {
    showToast('请先生成试卷分析 PDF')
    return
  }

  const students = Array.isArray(activeReport.students) ? activeReport.students : []
  const selectedStudent = studentId
    ? students.find((student) => student.id === studentId)
    : null
  if (studentId && !selectedStudent) {
    showToast('没有找到这个学生的分析文档')
    return
  }

  const exportStudents = selectedStudent ? [selectedStudent] : students
  if (activeReport.scope === 'class' && !selectedStudent) {
    showToast('请选择某个学生下载单独 PDF')
    return
  }

  try {
    await ensureJsPdfReady()
    if (!window.html2canvas) throw new Error('截图组件未加载，请刷新后重试')

    for (const studentReport of exportStudents) {
      await downloadPaperStudentPdf(activeReport, studentReport)
    }
    showToast('PDF 已下载')
  } catch (error) {
    showToast(error.message || 'PDF 下载失败')
  }
}

async function ensureJsPdfReady() {
  if (window.jspdf && window.jspdf.jsPDF) return
  await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('PDF 组件加载失败，请刷新后重试')
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find((script) => script.src === src)
    if (existing) {
      existing.addEventListener('load', resolve, { once: true })
      existing.addEventListener('error', reject, { once: true })
      if (existing.dataset.loaded === 'true') resolve()
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.onload = () => {
      script.dataset.loaded = 'true'
      resolve()
    }
    script.onerror = reject
    document.head.appendChild(script)
  })
}

async function downloadPaperStudentPdf(report, studentReport) {
  const sheet = buildPaperReportSheetElement(report, studentReport)
  document.body.appendChild(sheet.wrapper)

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

  const canvas = await window.html2canvas(sheet.node, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true
  })
  sheet.wrapper.remove()

  const { jsPDF } = window.jspdf
  const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 24
  const targetWidth = pageWidth - margin * 2
  const targetHeight = pageHeight - margin * 2
  const scale = targetWidth / canvas.width
  const sliceHeight = Math.max(1, Math.floor(targetHeight / scale))
  let sourceY = 0
  let pageIndex = 0

  while (sourceY < canvas.height) {
    const height = Math.min(sliceHeight, canvas.height - sourceY)
    const sliceCanvas = document.createElement('canvas')
    sliceCanvas.width = canvas.width
    sliceCanvas.height = height
    const context = sliceCanvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height)
    context.drawImage(canvas, 0, sourceY, canvas.width, height, 0, 0, canvas.width, height)

    if (pageIndex > 0) pdf.addPage()
    const imageData = sliceCanvas.toDataURL('image/jpeg', 0.94)
    pdf.addImage(imageData, 'JPEG', margin, margin, targetWidth, height * scale)
    sourceY += height
    pageIndex += 1
  }

  pdf.save(`${sanitizeFileName(studentReport.name)}试卷分析报告.pdf`)
}

function buildPaperReportSheetElement(report, studentReport) {
  const wrapper = document.createElement('div')
  wrapper.className = 'paper-pdf-render-root'
  wrapper.innerHTML = renderPaperStudentReport(studentReport, report)
  return {
    wrapper,
    node: wrapper.querySelector('.paper-analysis-sheet')
  }
}

function sanitizeFileName(value) {
  return String(value || '学生')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '')
    .trim() || '学生'
}

function addTeachingClass() {
  const name = getTeachingInputValue('newClassName')
  const grade = getTeachingInputValue('newClassGrade') || '高一'
  const students = parseLines(getTeachingInputValue('newClassStudents')).map((studentName) => ({
    id: createId('stu'),
    name: studentName
  }))
  if (!name || !students.length) {
    showToast('请填写班级名称和学生名单')
    return
  }

  state.teaching.data.classes.unshift({
    id: createId('class'),
    name,
    grade,
    students,
    materialMode: 'lesson',
    updatedAt: Date.now()
  })
  saveTeachingData()
}

function deleteTeachingClass(id) {
  const classInfo = state.teaching.data.classes.find((item) => item.id === id)
  if (!classInfo || !window.confirm(`确定删除“${classInfo.name}”吗？`)) return
  state.teaching.data.classes = state.teaching.data.classes.filter((item) => item.id !== id)
  saveTeachingData()
}

function addTeachingModule() {
  const name = window.prompt('请输入课程模块名称，例如：高一数学必修一')
  if (!name || !name.trim()) return
  const module = {
    id: createId('module'),
    name: name.trim(),
    lectures: [],
    chapters: [],
    updatedAt: Date.now()
  }
  state.teaching.data.courseModules.unshift(module)
  state.teaching.selectedModuleId = module.id
  saveTeachingData()
}

function deleteTeachingModule(id) {
  const module = state.teaching.data.courseModules.find((item) => item.id === id)
  if (!module || !window.confirm(`确定删除“${module.name}”吗？`)) return
  state.teaching.data.courseModules = state.teaching.data.courseModules.filter((item) => item.id !== id)
  state.teaching.selectedModuleId = ''
  saveTeachingData()
}

function saveTeachingCourse(id) {
  const module = state.teaching.data.courseModules.find((item) => item.id === id)
  if (!module) return

  const nameInput = els.teachingContent.querySelector(`[data-course-field="name"][data-id="${cssEscape(id)}"]`)
  const lecturesInput = els.teachingContent.querySelector(`[data-course-field="lectures"][data-id="${cssEscape(id)}"]`)
  const chaptersInput = els.teachingContent.querySelector(`[data-course-field="chapters"][data-id="${cssEscape(id)}"]`)
  module.name = nameInput.value.trim() || module.name
  module.lectures = parseLectureLines(lecturesInput.value)
  try {
    module.chapters = JSON.parse(chaptersInput.value || '[]')
  } catch (error) {
    showToast('章节 JSON 格式不正确')
    return
  }
  module.updatedAt = Date.now()
  saveTeachingData()
}

function fillCourseNoteFromModule(id) {
  const module = state.teaching.data.courseModules.find((item) => item.id === id)
  const lecture = module && module.lectures && module.lectures[0]
  if (!lecture) {
    showToast('这个模块还没有讲次内容')
    return
  }

  els.courseNoteInput.value = [
    lecture.content ? `【知识点】\n${lecture.content}` : '',
    lecture.keyPoints ? `【重难点】\n${lecture.keyPoints}` : '',
    lecture.notes ? `【注意事项】\n${lecture.notes}` : ''
  ].filter(Boolean).join('\n')
  state.mode = 'class'
  render()
  showToast('已填入当前反馈内容')
}

function saveTeachingScore() {
  const classInfo = state.teaching.data.classes.find((item) => item.id === state.teaching.selectedScoreClassId)
  if (!classInfo) {
    showToast('请先选择班级')
    return
  }

  const record = {
    id: createId('score'),
    scope: 'class',
    classId: classInfo.id,
    className: classInfo.name,
    title: getTeachingInputValue('scoreTitle') || '课堂测评',
    date: getTeachingInputValue('scoreDate') || new Date().toISOString().slice(0, 10),
    mode: state.teaching.scoreMode,
    totalScore: state.teaching.scoreMode === 'grade' ? null : Number(getTeachingInputValue('scoreTotal') || 100),
    students: Array.from(els.teachingContent.querySelectorAll('[data-score-student]')).map((row) => ({
      name: row.dataset.scoreStudent,
      score: state.teaching.scoreMode === 'grade' ? null : Number(row.querySelector('[data-score-field="score"]').value || NaN),
      grade: state.teaching.scoreMode === 'grade' ? row.querySelector('[data-score-field="grade"]').value : '',
      note: row.querySelector('[data-score-field="note"]').value.trim()
    })),
    createdAt: Date.now()
  }

  state.teaching.data.scoreRecords.push(record)
  saveTeachingData()
}

async function analyzeTeachingClass(classId) {
  const classInfo = state.teaching.data.classes.find((item) => item.id === classId)
  const records = getScoreRecordsForClass(classId)
  if (!classInfo || !records.length) {
    showToast('暂无可分析的成绩记录')
    return
  }
  await requestTeachingAnalysis({
    analysisType: 'class',
    target: classInfo.name,
    records
  })
}

async function analyzeOneTeachingProfile(profileId) {
  const profile = state.teaching.data.oneProfiles.find((item) => item.id === profileId)
  if (!profile) return
  const records = getScoreRecordsForOneProfile(profile)
  await requestTeachingAnalysis({
    analysisType: 'student',
    target: profile.name,
    profile,
    records
  })
}

async function requestTeachingAnalysis(payload) {
  try {
    state.teaching.aiBusy = true
    state.teaching.aiResult = 'AI 正在分析...'
    renderTeachingPanel()
    const response = await fetch('/api/teaching-data/ai-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'AI 分析失败')
    if (data.usage) {
      updateAccessState({ usage: data.usage })
      renderAccessState()
    }
    state.teaching.aiResult = data.text || ''
  } catch (error) {
    state.teaching.aiResult = ''
    showToast(error.message || 'AI 分析失败')
  } finally {
    state.teaching.aiBusy = false
    renderTeachingPanel()
  }
}

function clearTeachingHistory() {
  if (!window.confirm('确定清空全部反馈历史吗？')) return
  state.teaching.data.feedbackHistory = []
  saveTeachingData()
}

function copyTeachingHistory(id) {
  const item = state.teaching.data.feedbackHistory.find((history) => history.id === id)
  if (!item) return
  const text = (item.feedbacks || []).map((feedback) => `${feedback.name}\n${feedback.feedback}`).join('\n\n')
  copyText(text, '历史反馈已复制')
}

function deleteTeachingHistory(id) {
  state.teaching.data.feedbackHistory = state.teaching.data.feedbackHistory.filter((item) => item.id !== id)
  saveTeachingData()
}

function deleteStudentTeachingRecords(button, type) {
  const student = {
    id: button.dataset.studentId || '',
    name: button.dataset.studentName || ''
  }
  const scope = button.dataset.scope || 'class'
  const classId = button.dataset.classId || ''
  const profileId = button.dataset.profileId || ''
  const label = type === 'scores' ? '出门测成绩' : (type === 'paper' ? '试卷分析结果' : (type === 'feedbacks' ? '反馈记录' : '到课次数'))
  const confirmed = window.confirm(`确认删除 ${student.name} 的${label}吗？`)
  if (!confirmed) return

  if (type === 'scores' || type === 'paper') {
    const recordType = type === 'paper' ? 'paperAnalysis' : 'exitTest'
    state.teaching.data.scoreRecords = (state.teaching.data.scoreRecords || [])
      .map((record) => {
        if (!isTeachingRecordForTarget(record, scope, classId, profileId)) return record
        if (getTeachingScoreRecordType(record) !== recordType) return record
        return {
          ...record,
          students: (record.students || []).filter((score) => !isSameTeachingStudent(score, student))
        }
      })
      .filter((record) => (record.students || []).length)
  }

  if (type === 'feedbacks') {
    state.teaching.data.feedbackHistory = (state.teaching.data.feedbackHistory || [])
      .map((record) => {
        if (!isTeachingRecordForTarget(record, scope, classId, profileId)) return record
        if (record.feedbackScope === 'class') {
          return {
            ...record,
            feedbackExclusions: addStudentExclusion(record.feedbackExclusions, student)
          }
        }
        return {
          ...record,
          feedbacks: (record.feedbacks || []).filter((feedback) => !isSameTeachingStudent(feedback, student))
        }
      })
      .filter((record) => record.feedbackScope === 'class' || (record.feedbacks || []).length)
  }

  if (type === 'attendance') {
    state.teaching.data.feedbackHistory = (state.teaching.data.feedbackHistory || [])
      .map((record) => {
        if (!isTeachingRecordForTarget(record, scope, classId, profileId)) return record
        return {
          ...record,
          attendanceExclusions: addStudentExclusion(record.attendanceExclusions, student)
        }
      })
  }

  saveTeachingData()
  renderTeachingPanel()
  showToast(`已删除${label}`)
}

function isTeachingRecordForTarget(record, scope, classId, profileId) {
  if (scope === 'oneOnOne') {
    if (record.scope !== 'oneOnOne' && record.mode !== 'oneOnOne') return false
    return !profileId || record.profileId === profileId
  }

  if (record.scope !== 'class' && record.mode !== 'class') return false
  return !classId || record.classId === classId
}

function isSameTeachingStudent(recordStudent, student) {
  return (student.id && (recordStudent.studentId === student.id || recordStudent.id === student.id))
    || recordStudent.name === student.name
}

function addStudentExclusion(exclusions, student) {
  const list = Array.isArray(exclusions) ? exclusions.slice() : []
  if (!isStudentExcluded(list, student)) {
    list.push({ studentId: student.id || '', name: student.name || '' })
  }
  return list
}

function addTeachingOneProfile() {
  const name = window.prompt('请输入一对一学生姓名')
  if (!name || !name.trim()) return
  const profile = {
    id: createId('one'),
    name: name.trim(),
    grade: '高一',
    personality: '',
    habit: '',
    template: DEFAULT_TEMPLATE,
    updatedAt: Date.now()
  }
  state.teaching.data.oneProfiles.unshift(profile)
  state.teaching.selectedOneProfileId = profile.id
  saveTeachingData()
}

function exportTeachingBackup() {
  downloadJson(state.teaching.data, `教学系统备份-${new Date().toISOString().slice(0, 10)}.json`)
}

function exportTeachingCourses() {
  downloadJson(state.teaching.data.courseModules, '课程数据.json')
}

function importTeachingCourses() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      state.teaching.data.courseModules = Array.isArray(parsed) ? parsed : []
      await saveTeachingData()
    } catch (error) {
      showToast('课程数据导入失败')
    }
  })
  input.click()
}

async function restoreTeachingBackup() {
  const file = els.teachingRestoreInput.files && els.teachingRestoreInput.files[0]
  if (!file) return
  try {
    const parsed = JSON.parse(await file.text())
    state.teaching.data = normalizeTeachingDataClient(parsed)
    await saveTeachingData()
    showToast('备份已恢复')
  } catch (error) {
    showToast('备份文件无法读取')
  } finally {
    els.teachingRestoreInput.value = ''
  }
}

async function captureTeachingPanel() {
  if (!window.html2canvas || !els.teachingPanel) {
    showToast('截图组件未加载，请刷新后重试')
    return
  }
  const canvas = await window.html2canvas(els.teachingPanel, { scale: 2, backgroundColor: '#ffffff' })
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `教学数据-${Date.now()}.png`)
  }, 'image/png')
}

async function applyFeedbackToTeachingData() {
  const pending = state.pendingTeachingApplication
  if (!pending || pending.applied || pending.applying) return

  pending.applying = true
  renderTeachingApplyBar()

  try {
    if (!state.teaching.loaded) await loadTeachingData()
    mergePrimaryIntoTeachingData()

    const entry = buildFeedbackHistoryEntry(pending.payload, pending.feedbacks, pending.createdAt)
    state.teaching.data.feedbackHistory = [
      entry,
      ...(state.teaching.data.feedbackHistory || []).filter((item) => item.id !== entry.id)
    ].slice(0, 500)

    const scoreRecord = buildScoreRecordFromFeedbackEntry(entry)
    if (scoreRecord) {
      state.teaching.data.scoreRecords = [
        scoreRecord,
        ...(state.teaching.data.scoreRecords || []).filter((item) => item.sourceFeedbackId !== entry.id)
      ]
    }

    await saveTeachingData({ silent: true })
    pending.applied = true
    showToast('已应用到教学数据')
    if (state.mode === 'teaching') renderTeachingPanel()
  } catch (error) {
    showToast(error.message || '应用教学数据失败')
  } finally {
    pending.applying = false
    renderTeachingApplyBar()
  }
}

function buildFeedbackHistoryEntry(payload, feedbacks, createdAt = Date.now()) {
  return {
    id: createId('history'),
    mode: payload.mode,
    classId: payload.classId || '',
    feedbackScope: payload.feedbackScope || 'individual',
    feedbackFormat: payload.feedbackFormat || 'text',
    className: payload.className,
    profileId: payload.profileId || '',
    studentName: payload.mode === 'oneOnOne' && payload.students && payload.students[0] ? payload.students[0].name : '',
    lessonTitle: payload.lessonTitle,
    lessonDate: payload.lessonDate || getLocalDateKey(new Date(createdAt)),
    lessonDateText: payload.lessonDateText || '',
    courseNote: payload.courseNote,
    exitTest: payload.exitTest || null,
    feedbacks,
    createdAt
  }
}

function buildScoreRecordFromFeedbackEntry(entry) {
  const exitTest = entry.exitTest
  if (!exitTest || !Array.isArray(exitTest.students) || !exitTest.students.length) return null

  const mode = exitTest.mode === 'grade' ? 'grade' : 'percent'
  return {
    id: createId('score'),
    sourceFeedbackId: entry.id,
    recordType: 'exitTest',
    scope: entry.mode,
    classId: entry.classId || '',
    className: entry.className || '',
    profileId: entry.profileId || '',
    studentName: entry.studentName || '',
    title: exitTest.selectedLecture ? `出门测 · ${exitTest.selectedLecture}` : '出门测',
    subject: entry.lessonTitle || '',
    date: entry.lessonDate || getLocalDateKey(new Date(entry.createdAt)),
    mode,
    totalScore: mode === 'grade' ? null : Number(exitTest.totalScore || 100),
    students: exitTest.students.map((student) => ({
      studentId: student.id || student.studentId || '',
      name: student.name,
      score: mode === 'grade' ? null : Number(student.score),
      grade: mode === 'grade' ? student.grade : '',
      note: student.note || ''
    })).filter((student) => student.name),
    createdAt: Date.now()
  }
}

function getScoreRecordsForClass(classId) {
  return (state.teaching.data.scoreRecords || [])
    .filter((record) => record.classId === classId)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
}

function getScoreRecordsForOneProfile(profile) {
  return (state.teaching.data.scoreRecords || [])
    .filter((record) => record.profileId === profile.id
      || record.studentName === profile.name
      || (Array.isArray(record.students) && record.students.some((student) => student.name === profile.name)))
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
}

function drawTeachingTrendChart(classInfo, records) {
  const canvas = document.querySelector('#teachingScoreChart')
  if (!canvas || !classInfo || !records.length) return
  drawScoreChart(canvas, records.map((record) => ({
    label: String(record.date || '').slice(5),
    value: getRecordAverageRate(record)
  })).filter((item) => Number.isFinite(item.value)), `${classInfo.name} 平均得分率`)
}

function drawOneProfileTrendChart(records) {
  const canvas = document.querySelector('#oneProfileTrendChart')
  if (!canvas) return
  drawScoreChart(canvas, records.map((record) => ({
    label: String(record.date || '').slice(5),
    value: getRecordAverageRate(record)
  })).filter((item) => Number.isFinite(item.value)), '一对一成绩趋势')
}

function drawScoreChart(canvas, points, title) {
  const context = canvas.getContext('2d')
  const width = canvas.width
  const height = canvas.height
  const pad = 42
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#343854'
  context.font = 'bold 14px sans-serif'
  context.fillText(title, pad, 24)
  context.strokeStyle = '#e0e4f6'
  context.lineWidth = 1
  for (let i = 0; i <= 5; i += 1) {
    const y = pad + ((height - pad * 2) / 5) * i
    context.beginPath()
    context.moveTo(pad, y)
    context.lineTo(width - pad, y)
    context.stroke()
    context.fillStyle = '#707690'
    context.font = '11px sans-serif'
    context.fillText(`${100 - i * 20}%`, 6, y + 4)
  }
  if (points.length < 2) {
    context.fillStyle = '#707690'
    context.fillText('至少两条百分制记录后显示趋势', pad, height / 2)
    return
  }
  const step = (width - pad * 2) / Math.max(1, points.length - 1)
  context.beginPath()
  context.strokeStyle = '#6860cf'
  context.lineWidth = 2.5
  points.forEach((point, index) => {
    const x = pad + index * step
    const y = pad + (height - pad * 2) * (1 - point.value / 100)
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.stroke()
  points.forEach((point, index) => {
    const x = pad + index * step
    const y = pad + (height - pad * 2) * (1 - point.value / 100)
    context.fillStyle = '#6860cf'
    context.beginPath()
    context.arc(x, y, 4, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#343854'
    context.font = '11px sans-serif'
    context.fillText(point.label, x - 14, height - 10)
  })
}

function getRecordAverageRate(record) {
  if (!record || record.mode === 'grade') return NaN
  const total = Number(record.totalScore || 100)
  const scores = (record.students || []).map((student) => Number(student.score)).filter(Number.isFinite)
  if (!scores.length || !total) return NaN
  const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length
  return Math.max(0, Math.min(100, (avg / total) * 100))
}

function parseLectureLines(text) {
  return String(text || '').split(/\n+/).map((line, index) => {
    const [title = '', content = '', keyPoints = '', notes = ''] = line.split('|').map((part) => part.trim())
    return {
      id: createId('lecture'),
      lecture: index + 1,
      title: title || `第 ${index + 1} 讲`,
      content,
      keyPoints,
      notes
    }
  }).filter((lecture) => lecture.title || lecture.content)
}

function getTeachingInputValue(field) {
  const input = els.teachingContent.querySelector(`[data-teaching-field="${field}"]`)
  return input ? input.value.trim() : ''
}

function parseLines(text) {
  return String(text || '')
    .split(/[\n,，;；、]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function downloadJson(data, fileName) {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), fileName)
}

function formatDateTime(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date()
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function cssEscape(value) {
  if (window.CSS && window.CSS.escape) return window.CSS.escape(value)
  return String(value).replace(/"/g, '\\"')
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

function persistClasses(options = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.classes))
  if (!options.localOnly) scheduleFeedbackDataSync()
}

function persistOneProfiles(options = {}) {
  localStorage.setItem(ONE_PROFILE_STORAGE_KEY, JSON.stringify(state.oneProfiles))
  if (!options.localOnly) scheduleFeedbackDataSync()
}

async function loadFeedbackDataFromServer() {
  if (!state.access.authenticated) return

  try {
    const response = await fetch('/api/feedback-data')
    if (response.status === 404) return
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '读取档案数据失败')

    const remote = data.data || {}
    const localHadData = state.classes.length || state.oneProfiles.length
    state.classes = mergeRecordsById(state.classes, Array.isArray(remote.classes) ? remote.classes : [])
    state.oneProfiles = mergeRecordsById(state.oneProfiles, Array.isArray(remote.oneProfiles) ? remote.oneProfiles : [])

    if (!state.selectedClassId && state.classes.length) state.selectedClassId = state.classes[0].id
    if (!state.selectedOneProfileId && state.oneProfiles.length) state.selectedOneProfileId = state.oneProfiles[0].id

    persistClasses({ localOnly: true })
    persistOneProfiles({ localOnly: true })
    if (localHadData) await saveFeedbackDataToServer({ silent: true })
  } catch (error) {
    showToast(error.message || '档案数据暂时使用本机缓存')
  }
}

function mergeRecordsById(localRecords, remoteRecords) {
  const records = new Map()

  remoteRecords.forEach((record) => {
    if (record && record.id) records.set(record.id, record)
  })

  localRecords.forEach((record) => {
    if (!record || !record.id) return
    const existed = records.get(record.id)
    if (!existed || Number(record.updatedAt || 0) >= Number(existed.updatedAt || 0)) {
      records.set(record.id, mergeRecordPreservingMaterial(record, existed))
    }
  })

  return Array.from(records.values())
}

function mergeRecordPreservingMaterial(record, existed) {
  if (!existed || record.textbook) return record
  if (record.materialMode === 'lesson') return record
  if (!existed.textbook) return record

  return {
    ...record,
    materialMode: record.materialMode || existed.materialMode || 'book',
    textbook: existed.textbook
  }
}

function scheduleFeedbackDataSync() {
  if (!state.access.authenticated) return
  clearTimeout(scheduleFeedbackDataSync.timer)
  scheduleFeedbackDataSync.timer = setTimeout(() => {
    saveFeedbackDataToServer({ silent: true })
  }, 500)
}

async function saveFeedbackDataToServer(options = {}) {
  if (!state.access.authenticated) return false

  try {
    const response = await fetch('/api/feedback-data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classes: state.classes,
        oneProfiles: state.oneProfiles
      })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '保存档案数据失败')

    if (!options.silent) showToast('档案已同步到正式数据库')
    return true
  } catch (error) {
    if (!options.silent) showToast(error.message || '档案同步失败')
    return false
  }
}

function render() {
  renderMode()
  renderClassList()
  renderOneProfileList()
  renderWorkspace()
  renderOneProfileSummary()
  renderOneProfileKeywordControls()
  renderClassSchedule()
  renderExitTestTable()
  renderStudentTable()
  renderResults()
  renderRearrange()
  renderPdfPageSelection()
  renderClassMaterialControls()
  renderClassLectureSelect()
  renderFeedbackModeControls()
  renderAccessState()
  updateAllFilePickers()
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

  const isToolMode = state.mode === 'admin' || state.mode === 'rearrange' || state.mode === 'teaching' || state.mode === 'paperAnalysis'
  document.querySelector('#feedbackPanel').classList.toggle('hidden', isToolMode)
  document.querySelector('#resultsPanel').classList.toggle('hidden', isToolMode)
  els.adminPanel.classList.toggle('hidden', state.mode !== 'admin')
  els.rearrangePanel.classList.toggle('hidden', state.mode !== 'rearrange')
  if (els.teachingPanel) els.teachingPanel.classList.toggle('hidden', state.mode !== 'teaching' && state.mode !== 'paperAnalysis')

  if (state.mode === 'admin' && state.access.user && state.access.user.isAdmin) {
    renderAdminUsers()
    if (!state.adminUsers.length) loadAdminUsers()
  }

  if (state.mode === 'teaching' || state.mode === 'paperAnalysis') {
    renderTeachingPanel()
    if (!state.teaching.loading && !state.teaching.loaded) loadTeachingData()
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

function renderClassSchedule() {
  if (!els.classSchedulePanel || !els.classCalendarGrid || !els.classCalendarTitle) return

  const shouldShow = state.mode === 'class' || state.mode === 'oneOnOne'
  els.classSchedulePanel.classList.toggle('hidden', !shouldShow)
  if (!shouldShow) return

  const monthDate = getDateFromMonthKey(state.classSchedule.calendarMonth)
  const todayKey = getLocalDateKey(new Date())
  const selectedDate = state.classSchedule.selectedDate
  const days = buildCalendarDays(monthDate)

  if (els.classDateSelectedText) {
    els.classDateSelectedText.textContent = selectedDate ? formatChineseDate(selectedDate) : '暂不填写'
  }
  if (els.classDateToggleBtn) {
    els.classDateToggleBtn.setAttribute('aria-expanded', state.classSchedule.calendarOpen ? 'true' : 'false')
  }
  if (els.classCalendarPopup) {
    els.classCalendarPopup.classList.toggle('hidden', !state.classSchedule.calendarOpen)
  }
  els.classCalendarTitle.textContent = `${monthDate.getFullYear()}年${monthDate.getMonth() + 1}月`
  if (els.classTimeSlotSelect) els.classTimeSlotSelect.value = state.classSchedule.timeSlot || ''
  els.classCalendarGrid.innerHTML = days.map((day) => {
    const dateKey = getLocalDateKey(day.date)
    const classes = [
      'calendar-day',
      day.inMonth ? '' : 'outside',
      dateKey === todayKey ? 'today' : '',
      dateKey === selectedDate ? 'active' : ''
    ].filter(Boolean).join(' ')

    return `<button class="${classes}" data-date="${dateKey}" type="button">${day.date.getDate()}</button>`
  }).join('')
}

function toggleClassCalendar() {
  state.classSchedule.calendarOpen = !state.classSchedule.calendarOpen
  renderClassSchedule()
}

function shiftClassCalendarMonth(delta) {
  state.classSchedule.calendarMonth = shiftMonthKey(state.classSchedule.calendarMonth, delta)
  state.classSchedule.calendarOpen = true
  renderClassSchedule()
}

function handleClassCalendarClick(event) {
  const button = event.target.closest('[data-date]')
  if (!button) return

  state.classSchedule.selectedDate = button.dataset.date
  state.classSchedule.calendarMonth = getMonthKey(getDateFromKey(button.dataset.date))
  state.classSchedule.calendarOpen = false
  renderClassSchedule()
}

function buildCalendarDays(monthDate) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const mondayOffset = (firstDay.getDay() + 6) % 7
  const startDate = new Date(firstDay)
  startDate.setDate(firstDay.getDate() - mondayOffset)

  return Array.from({ length: 42 }, (item, index) => {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + index)
    return {
      date,
      inMonth: date.getMonth() === monthDate.getMonth()
    }
  })
}

function getLocalDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getMonthKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function getDateFromKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number)
  if (!year || !month || !day) return new Date()
  return new Date(year, month - 1, day)
}

function getDateFromMonthKey(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number)
  if (!year || !month) return new Date()
  return new Date(year, month - 1, 1)
}

function shiftMonthKey(monthKey, delta) {
  const date = getDateFromMonthKey(monthKey)
  date.setMonth(date.getMonth() + delta)
  return getMonthKey(date)
}

function formatChineseDate(dateKey) {
  const date = getDateFromKey(dateKey)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${getChineseWeekday(date)}）`
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
  const shouldHideClassStudents = state.mode === 'class'
    && els.feedbackScopeSelect
    && els.feedbackScopeSelect.value === 'class'

  if (els.studentToolbar) els.studentToolbar.classList.toggle('hidden', shouldHideClassStudents)
  if (els.studentTable) els.studentTable.classList.toggle('hidden', shouldHideClassStudents)
  if (shouldHideClassStudents) {
    els.studentTable.innerHTML = ''
    return
  }

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
      <select data-index="${index}" data-field="keyword">
        <option value="">选择关键词</option>
        <optgroup label="好的关键词">
          ${getStudentKeywordGroups().positive.map((option) => `
            <option value="${option}">${option}</option>
          `).join('')}
        </optgroup>
        <optgroup label="需改进关键词">
          ${getStudentKeywordGroups().negative.map((option) => `
            <option value="${option}">${option}</option>
          `).join('')}
        </optgroup>
      </select>
      <textarea data-index="${index}" data-field="remark" placeholder="备注特殊情况">${escapeHtml(student.remark || '')}</textarea>
      <span></span>
    </div>
  `).join('')
}

function renderExitTestTable() {
  if (!els.exitTestPanel || !els.exitTestTable) return

  const students = getExitTestStudents()
  const shouldShow = state.mode === 'class'
  els.exitTestPanel.classList.toggle('hidden', !shouldShow)
  if (!shouldShow) return
  renderExitTestLectureSelect()
  if (els.exitTestCount) els.exitTestCount.textContent = `${students.length} 人`
  if (els.exitTestTotalField) els.exitTestTotalField.classList.toggle('hidden', state.exitTest.mode === 'grade')
  if (els.exitTestModeSelect) els.exitTestModeSelect.value = state.exitTest.mode
  if (els.exitTestTotalInput) els.exitTestTotalInput.value = String(state.exitTest.totalScore || 100)

  if (!students.length) {
    els.exitTestTable.innerHTML = state.mode === 'oneOnOne'
      ? '<div class="student-empty">选择或保存学生档案后，可以在这里填写出门测成绩。</div>'
      : '<div class="student-empty">保存班级后，可以在这里填写每位学生的出门测成绩。</div>'
    return
  }

  els.exitTestTable.innerHTML = students.map((student) => {
    const score = state.exitTest.scores[student.id] || {}
    return `
      <div class="exit-test-row ${state.exitTest.mode === 'grade' ? 'grade-mode' : 'score-mode'}" data-student-id="${escapeHtml(student.id)}">
        <div class="student-name">${escapeHtml(student.name)}</div>
        ${state.exitTest.mode === 'grade'
          ? `<select data-exit-field="grade" aria-label="${escapeHtml(student.name)}出门测等级">
              <option value="">选择等级</option>
              ${['A', 'B', 'C', 'D'].map((grade) => `<option value="${grade}" ${score.grade === grade ? 'selected' : ''}>${grade}</option>`).join('')}
            </select>`
          : `<input data-exit-field="score" type="number" min="0" max="${state.exitTest.totalScore || 100}" value="${escapeHtml(score.score ?? '')}" placeholder="填写分数" aria-label="${escapeHtml(student.name)}出门测分数" />`}
        <input data-exit-field="note" type="text" value="${escapeHtml(score.note || '')}" placeholder="可选：错因或特殊情况" />
      </div>
    `
  }).join('')
}

function getExitTestStudents() {
  const selectedClass = getSelectedClass()
  return state.mode === 'class' && selectedClass ? selectedClass.students : []
}

function handleExitTestModeChange() {
  if (!els.exitTestModeSelect) return
  state.exitTest.mode = els.exitTestModeSelect.value === 'grade' ? 'grade' : 'percent'
  renderExitTestTable()
}

function renderExitTestLectureSelect() {
  if (!els.exitTestLectureField || !els.exitTestLectureSelect) return

  const shouldShow = state.mode === 'class'
    && state.exitTest.lectures.length > 1
  els.exitTestLectureField.classList.toggle('hidden', !shouldShow)

  if (!shouldShow) {
    els.exitTestLectureSelect.innerHTML = ''
    return
  }

  els.exitTestLectureSelect.innerHTML = [
    '<option value="">请选择出门测讲次</option>',
    ...state.exitTest.lectures.map((lecture, index) => (
      `<option value="${index}" ${String(index) === state.exitTest.selectedLectureIndex ? 'selected' : ''}>${escapeHtml(lecture.title || `第 ${index + 1} 讲`)}（第 ${lecture.startPage}-${lecture.endPage} 页）</option>`
    ))
  ].join('')
}

async function handleExitTestFileChange() {
  updateFilePicker(els.exitTestInput, els.exitTestFileName)
  resetExitTestLectureSelection()

  const file = els.exitTestInput && els.exitTestInput.files
    ? els.exitTestInput.files[0]
    : null

  if (!file || !isPdfFile(file)) {
    renderExitTestLectureSelect()
    return
  }

  state.exitTest.fileKey = getFileKey(file)
  state.exitTest.detectingLectures = true
  renderExitTestLectureSelect()

  try {
    const lectures = await detectPdfLecturesFromFile(file)
    state.exitTest.lectures = lectures.length > 1 ? lectures : []
    state.exitTest.selectedLectureIndex = state.exitTest.lectures.length > 1 ? '0' : ''
    if (state.exitTest.lectures.length > 1) {
      showToast(`出门测检测到 ${state.exitTest.lectures.length} 个讲次，请选择本节课对应讲次`)
    }
  } catch (error) {
    state.exitTest.lectures = []
    state.exitTest.selectedLectureIndex = ''
  } finally {
    state.exitTest.detectingLectures = false
    renderExitTestLectureSelect()
  }
}

function resetExitTestLectureSelection() {
  state.exitTest.fileKey = ''
  state.exitTest.lectures = []
  state.exitTest.selectedLectureIndex = ''
  state.exitTest.detectingLectures = false
}

function handleExitTestInput(event) {
  const field = event.target.dataset.exitField
  if (!field) return

  const row = event.target.closest('[data-student-id]')
  if (!row) return

  const studentId = row.dataset.studentId
  if (!state.exitTest.scores[studentId]) state.exitTest.scores[studentId] = {}
  state.exitTest.scores[studentId][field] = event.target.value
}

function renderResults() {
  const imageMode = isImageFeedbackMode()
  els.copyAllBtn.disabled = !state.feedbacks.length
  els.resultNote.textContent = state.feedbacks.length
    ? (imageMode ? `${state.feedbacks.length} 张图片反馈报告已生成 · 下方可逐张查看和导出` : `${state.feedbacks.length} 条反馈 · 全部已展开`)
    : '生成后会显示在这里'
  renderTeachingApplyBar()
  if (els.debugSummary) {
    els.debugSummary.classList.add('hidden')
    els.debugSummary.innerHTML = ''
  }

  if (!state.feedbacks.length) {
    els.resultList.classList.remove('hidden')
    els.resultList.innerHTML = '<div class="result-empty">完成录入后点击“AI 生成反馈”。</div>'
    if (els.imageReportPanel) els.imageReportPanel.classList.add('hidden')
    return
  }

  els.resultList.classList.toggle('hidden', imageMode)
  if (imageMode) {
    els.resultList.innerHTML = ''
    renderImageReport()
    return
  }

  if (els.imageReportPanel) els.imageReportPanel.classList.add('hidden')
  els.resultList.innerHTML = state.feedbacks.map((item, index) => `
    <article class="result-card">
      <div class="result-head">
        <div class="result-name-group">
          <span class="result-index">${index + 1}</span>
          <div class="result-name">${escapeHtml(item.name)}</div>
        </div>
        <button class="copy-button" data-action="copy-feedback" data-index="${index}" type="button">复制</button>
      </div>
      <p class="result-text">${escapeHtml(item.feedback)}</p>
    </article>
  `).join('')
}

function normalizeGeneratedFeedbacksForPayload(feedbacks, payload = {}) {
  const source = Array.isArray(feedbacks) ? feedbacks : []
  const students = Array.isArray(payload.students) ? payload.students : []
  if (payload.feedbackScope === 'class' || !students.length) return source

  const usedIndexes = new Set()
  const sharedFeedback = source.find((item) => item && item.templateFields)
  const sharedFields = sharedFeedback ? sharedFeedback.templateFields : {}

  return students.map((student, studentIndex) => {
    let matchIndex = source.findIndex((item, index) => (
      !usedIndexes.has(index)
      && item
      && item.studentId
      && item.studentId === student.id
    ))

    if (matchIndex < 0) {
      matchIndex = source.findIndex((item, index) => (
        !usedIndexes.has(index)
        && item
        && item.name
        && item.name === student.name
      ))
    }

    if (matchIndex < 0 && source[studentIndex] && !usedIndexes.has(studentIndex)) {
      matchIndex = studentIndex
    }

    if (matchIndex >= 0) {
      usedIndexes.add(matchIndex)
      const matched = source[matchIndex]
      return {
        ...matched,
        studentId: student.id,
        name: student.name
      }
    }

    return buildMissingGeneratedFeedback(student, payload, sharedFields)
  })
}

function buildMissingGeneratedFeedback(student, payload = {}, sharedFields = {}) {
  const courseContent = String(sharedFields.courseContent || payload.lessonTitle || '本节课围绕课件核心内容进行学习。').trim()
  const courseKnowledgePoint = String(sharedFields.courseKnowledgePoint || '1、理解本节课的核心知识点。\n2、掌握重点方法并完成对应练习。').trim()
  const performanceText = [
    `${student.name}同学本节课${student.performance || '表现良好'}`,
    student.remark || '',
    student.exitTestScore ? `出门测成绩为${student.exitTestScore}` : ''
  ].filter(Boolean).join('，')
  const learningSuggestion = student.performance === '表现较差'
    ? '建议课后回顾基础概念和典型例题，完成订正后再进行同类题巩固。'
    : (student.performance === '表现优秀'
        ? '建议继续保持课堂参与度，并尝试更有挑战的变式题。'
        : '建议课后及时整理课堂重点和错题，保持稳定练习节奏。')

  return {
    studentId: student.id,
    name: student.name,
    feedback: [
      '【课程内容】',
      courseContent,
      '【核心重点】',
      courseKnowledgePoint,
      '【课堂表现】',
      `${performanceText}。${learningSuggestion}`
    ].join('\n'),
    templateFields: {
      courseContent,
      courseKnowledgePoint,
      performanceText,
      personalizedRemark: student.remark || '本节课整体状态稳定',
      learningSuggestion,
      subject: String(sharedFields.subject || '').trim()
    }
  }
}

function renderTeachingApplyBar() {
  if (!els.teachingApplyBar || !els.applyTeachingDataBtn) return

  const pending = state.pendingTeachingApplication
  const shouldShow = Boolean(pending && state.feedbacks.length)
  els.teachingApplyBar.classList.toggle('hidden', !shouldShow)
  els.applyTeachingDataBtn.disabled = !shouldShow || pending.applying || pending.applied
  els.applyTeachingDataBtn.textContent = pending && pending.applied
    ? '已应用到教学数据'
    : (pending && pending.applying ? '正在应用...' : '确认应用到教学数据')
}

function isImageFeedbackMode() {
  return (state.mode === 'class' || state.mode === 'oneOnOne')
    && els.feedbackFormatSelect
    && els.feedbackFormatSelect.value === 'image'
}

function renderImageReport(payload = null) {
  if (!els.imageReportPanel || !els.imageReportPreview) return

  const shouldShow = isImageFeedbackMode()
    && state.feedbacks.length

  els.imageReportPanel.classList.toggle('hidden', !shouldShow)
  if (!shouldShow) {
    els.imageReportPreview.innerHTML = ''
    return
  }

  const selectedClass = getSelectedClass()
  const selectedProfile = getSelectedOneProfile()
  const reportPayload = payload
    || state.lastGeneratedPayload
    || (state.pendingTeachingApplication && state.pendingTeachingApplication.payload)
    || buildGeneratePayload()
    || {}
  const reportDate = reportPayload.lessonDate ? getDateFromKey(reportPayload.lessonDate) : new Date()
  const lessonTitle = (reportPayload.lessonTitle || els.lessonTitleInput.value.trim() || '').trim()
  const homeworkText = reportPayload.homework || (els.homeworkInput ? els.homeworkInput.value.trim() : '')
  const students = Array.isArray(reportPayload.students) && reportPayload.students.length
    ? reportPayload.students
    : (state.mode === 'oneOnOne'
        ? getWorkingStudents()
        : (selectedClass ? selectedClass.students : []))
  const reportScores = buildReportScoreRows(students, reportPayload.exitTest)
  const isClassOverall = reportPayload.feedbackScope === 'class'
  const individualFeedbacks = normalizeGeneratedFeedbacksForPayload(state.feedbacks, reportPayload)
  const reportItems = isClassOverall
    ? [{
        name: reportPayload.className || (selectedClass && selectedClass.name) || '班级整体',
        feedback: state.feedbacks.map((item) => item.feedback).join('\n\n'),
        templateFields: state.feedbacks[0] && state.feedbacks[0].templateFields,
        scope: 'class'
      }]
    : individualFeedbacks.map((item) => ({
        studentId: item.studentId,
        name: item.name,
        feedback: item.feedback,
        templateFields: item.templateFields,
        scope: 'individual'
      }))

  els.imageReportPreview.innerHTML = reportItems.map((item, index) => `
    <div class="image-report-preview-item">
      <div class="image-report-preview-head">
        <div class="image-report-preview-title">
          <span>${reportItems.length > 1 ? `第 ${index + 1} 张` : '图片反馈'}</span>
          <strong>${escapeHtml(item.name || `报告${index + 1}`)}</strong>
        </div>
        <button class="secondary-button compact-button" data-action="copy-image-report" data-report-index="${index}" type="button">复制图片</button>
      </div>
      ${renderImageReportSheet({
        item,
        index,
        reportDate,
        reportPayload,
        lessonTitle,
        homeworkText,
        reportScores,
        selectedClass,
        selectedProfile
      })}
    </div>
  `).join('')
}

function renderImageReportSheet(options) {
  const {
    item,
    index,
    reportDate,
    reportPayload,
    lessonTitle,
    homeworkText,
    reportScores,
    selectedClass,
    selectedProfile
  } = options
  const reportSections = parseFeedbackReportSections(item.feedback)
  const templateFields = item.templateFields && typeof item.templateFields === 'object' ? item.templateFields : {}
  const subjectText = normalizeSubjectText(reportSections.subject || templateFields.subject || '')
  const courseContentText = normalizeImageReportCourseText(
    reportSections.courseContent
      || templateFields.courseContent
      || getManualCourseNoteForImageReport()
      || '本节课围绕课件核心内容进行学习。'
  )
  const focusText = normalizeReportText(
    reportSections.studyFocus
      || templateFields.courseKnowledgePoint
      || '1、理解本节课课件中的核心知识点。\n2、掌握课件中的重点方法与应用要求。'
  )
  const primaryPerformanceText = String(
    reportSections.performance
      || templateFields.performanceText
      || item.feedback
      || '本节课整体课堂秩序较好，学生能跟随老师完成主要学习任务。'
  )
  const performanceDetails = [
    primaryPerformanceText,
    templateFields.personalizedRemark && !primaryPerformanceText.includes(templateFields.personalizedRemark)
      ? templateFields.personalizedRemark
      : '',
    templateFields.learningSuggestion && !primaryPerformanceText.includes(templateFields.learningSuggestion)
      ? `后续建议：${templateFields.learningSuggestion}`
      : ''
  ].filter(Boolean)
  const performanceText = normalizeReportText(performanceDetails.join('\n\n'))
  const isIndividual = item.scope !== 'class'
  const showAllScores = isIndividual
    && state.mode === 'class'
    && (reportPayload.showAllScoresInIndividualReports || (els.showAllScoresSelect && els.showAllScoresSelect.value === 'all'))
  const scoreRows = isIndividual
    ? (showAllScores
        ? sortReportScoreRows(reportScores)
        : reportScores.filter((score) => {
            if (item.studentId && score.studentId) return score.studentId === item.studentId
            return score.name === item.name
          }))
    : sortReportScoreRows(reportScores)
  const hasScoreRows = scoreRows.length > 0
  const numericScores = scoreRows.map((score) => Number(score.score)).filter(Number.isFinite)
  const avg = numericScores.length
    ? (numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length).toFixed(1)
    : '-'
  const max = numericScores.length ? Math.max(...numericScores) : '-'
  const min = numericScores.length ? Math.min(...numericScores) : '-'
  const rate = numericScores.length ? `${(scoreRows.reduce((sum, score) => sum + Number(score.rate || 0), 0) / scoreRows.length).toFixed(1)}%` : '-'
  const className = reportPayload.className || (selectedClass && selectedClass.name) || ''
  const studentName = state.mode === 'oneOnOne'
    ? ((selectedProfile && selectedProfile.name) || item.name || reportPayload.className || '')
    : item.name

  return `
    <article class="report-sheet image-report-sheet" id="${index === 0 ? 'imageReportSheet' : `imageReportSheet-${index}`}" data-image-report-sheet data-report-name="${escapeHtml(studentName || item.name || `报告${index + 1}`)}">
      <header class="report-header">
        <div></div>
        <h2>${subjectText ? `${escapeHtml(subjectText)}课程反馈报告` : '课程反馈报告'}</h2>
        <div class="report-brand">
          <strong>升学帮</strong>
          <span>教学有章法 提分有路径</span>
        </div>
      </header>
      <div class="report-meta">
        <div>日期：${reportDate.getFullYear()}年${reportDate.getMonth() + 1}月${reportDate.getDate()}日（${getChineseWeekday(reportDate)}）</div>
        ${reportPayload.timeSlot ? `<div>时段：${escapeHtml(reportPayload.timeSlot)}</div>` : ''}
        ${isIndividual ? `<div>学生：${escapeHtml(studentName)}</div>` : `<div>班级：${escapeHtml(className || item.name)}</div>`}
        ${isIndividual && className && state.mode === 'class' ? `<div>班级：${escapeHtml(className)}</div>` : ''}
        ${lessonTitle ? `<div>课程主题：${escapeHtml(lessonTitle)}</div>` : ''}
      </div>
      <section>
        <h3>【课程内容】</h3>
        <div class="report-paragraph">${formatReportText(courseContentText)}</div>
      </section>
      <section>
        <h3>【核心重点】</h3>
        <div class="report-paragraph">${formatReportText(normalizeReportListLines(focusText))}</div>
      </section>
      <section>
        <h3>【课堂表现】</h3>
        <div class="report-paragraph">${formatReportText(performanceText)}</div>
      </section>
      ${homeworkText ? `<section>
        <h3>【课后作业】</h3>
        <div class="report-paragraph">${formatReportText(homeworkText)}</div>
      </section>` : ''}
      ${hasScoreRows ? `<section>
        <h3>【出门测成绩${showAllScores ? '（全班）' : ''}】</h3>
        <table class="report-table">
          <thead><tr><th>姓名</th><th>成绩</th><th>正确率</th></tr></thead>
          <tbody>
            ${scoreRows.map((score) => `<tr><td>${escapeHtml(score.name)}</td><td>${escapeHtml(score.displayScore || score.score || '—')}</td><td>${score.rate !== null ? `${Number(score.rate).toFixed(1)}%` : '—'}</td></tr>`).join('')}
          </tbody>
        </table>
        ${isIndividual ? '' : `<p>平均分：${avg} 最高分：${max} 最低分：${min} 得分率：${rate}</p>`}
      </section>` : ''}
      <footer>以上为本次课程反馈，如有疑问欢迎沟通。</footer>
    </article>
  `
}

function parseFeedbackReportSections(text) {
  const sections = {
    courseContent: '',
    studyFocus: '',
    performance: '',
    subject: ''
  }
  const source = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/家长您好[，,。]?\s*本次[^：:]*反馈如下[：:]?/g, '')
    .trim()

  if (!source) return sections

  const matches = Array.from(source.matchAll(/【([^】]+)】/g))
  if (!matches.length) {
    sections.performance = source
    return sections
  }

  matches.forEach((match, index) => {
    const title = match[1].trim()
    const start = match.index + match[0].length
    const end = matches[index + 1] ? matches[index + 1].index : source.length
    const content = normalizeReportText(source.slice(start, end))

    if (/课堂内容|课程内容/.test(title)) sections.courseContent = content
    if (/学习重点|课程重点|核心重点/.test(title)) sections.studyFocus = content
    if (/课堂表现|学生表现/.test(title)) sections.performance = content
    if (/科目|学科/.test(title)) sections.subject = content
  })

  if (!sections.performance) {
    sections.performance = normalizeReportText(source.replace(/【[^】]+】/g, '\n'))
  }

  return sections
}

function normalizeReportText(text) {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*[：:，,。；;]\s*/, '')
    .trim()
}

function formatReportText(text) {
  const normalized = normalizeReportText(text)
  if (!normalized) return ''

  return escapeHtml(normalized)
    .replace(/\n{2,}/g, '<br><br>')
    .replace(/\n/g, '<br>')
}

function normalizeReportListLines(text) {
  return normalizeReportText(text)
    .replace(/\s+([1-9][0-9]*[、.．])/g, '\n$1')
    .replace(/([。；;])\s*([1-9][0-9]*[、.．])/g, '$1\n$2')
}

function normalizeImageReportCourseText(text) {
  const normalized = normalizeReportText(text)
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(上课日期|上课时段|课后作业|班级\/共性备注|教材讲次)[：:]/.test(line))
    .map((line) => line.replace(/^[1-9][0-9]*[、.．]\s*/, '').trim())
    .join(' ')

  return normalized || '本节课围绕课件核心内容进行学习。'
}

function normalizeSubjectText(text) {
  return normalizeReportText(text)
    .replace(/[【】]/g, '')
    .replace(/^(科目|学科)[：:]/, '')
    .trim()
    .slice(0, 12)
}

function getManualCourseNoteForImageReport() {
  return els.courseNoteInput ? els.courseNoteInput.value.trim() : ''
}

function extractReportLines(text) {
  return String(text || '')
    .replace(/\s+([1-9][0-9]*[.、])/g, '\n$1')
    .split(/[\n。；;]/)
    .map((line) => line.replace(/[【】]/g, '').trim())
    .filter((line) => line && !/^课后作业/.test(line) && !/^班级/.test(line))
    .slice(0, 6)
}

function buildReportScoreRows(students, exitTest = null) {
  if (exitTest && Array.isArray(exitTest.students) && exitTest.students.length) {
    return exitTest.students.map((student) => {
      if (exitTest.mode === 'grade') {
        return {
          name: student.name,
          studentId: student.id,
          score: null,
          displayScore: student.grade || '—',
          rate: null
        }
      }

      return {
        name: student.name,
        studentId: student.id,
        score: Number(student.score),
        displayScore: `${student.score}/${exitTest.totalScore || 100}`,
        rate: exitTest.totalScore ? (Number(student.score) / Number(exitTest.totalScore)) * 100 : null
      }
    })
  }

  return []
}

function sortReportScoreRows(rows) {
  const gradeRank = {
    A: 4,
    B: 3,
    C: 2,
    D: 1
  }

  return [...rows].sort((left, right) => {
    const leftScore = Number(left.score)
    const rightScore = Number(right.score)
    const leftHasScore = Number.isFinite(leftScore)
    const rightHasScore = Number.isFinite(rightScore)

    if (leftHasScore || rightHasScore) {
      if (!leftHasScore) return 1
      if (!rightHasScore) return -1
      return rightScore - leftScore
    }

    const leftGrade = gradeRank[String(left.displayScore || '').trim().toUpperCase()] || 0
    const rightGrade = gradeRank[String(right.displayScore || '').trim().toUpperCase()] || 0
    if (leftGrade !== rightGrade) return rightGrade - leftGrade

    return String(left.name || '').localeCompare(String(right.name || ''), 'zh-Hans-CN')
  })
}

async function downloadImageReport() {
  const sheets = Array.from(document.querySelectorAll('[data-image-report-sheet]'))
  if (!sheets.length) {
    showToast('还没有图片反馈报告')
    return
  }
  if (!window.html2canvas) {
    showToast('截图组件未加载，请刷新后重试')
    return
  }

  for (const [index, sheet] of sheets.entries()) {
    const blob = await renderImageReportBlob(sheet)
    if (blob) {
      const name = sheet.dataset.reportName || `报告${index + 1}`
      downloadBlob(blob, `${sanitizeFileName(name)}课程反馈报告.png`)
    }
  }
}

async function handleImageReportPreviewClick(event) {
  const button = event.target.closest('[data-action="copy-image-report"]')
  if (!button) return

  const item = button.closest('.image-report-preview-item')
  const sheet = item ? item.querySelector('[data-image-report-sheet]') : null
  await copyImageReport(sheet, button)
}

async function copyImageReport(sheet, button = null) {
  if (!sheet) {
    showToast('还没有可复制的图片反馈')
    return
  }

  if (!window.html2canvas) {
    showToast('截图组件未加载，请刷新后重试')
    return
  }

  if (!navigator.clipboard || !navigator.clipboard.write || !window.ClipboardItem) {
    showToast('当前浏览器不支持直接复制图片，请先导出图片')
    return
  }

  const reportName = sheet.dataset.reportName || '图片反馈'
  const blobPromise = renderImageReportBlob(sheet)
  const originalText = button ? button.textContent : ''
  if (button) {
    button.disabled = true
    button.textContent = '复制中'
  }

  try {
    await navigator.clipboard.write([
      new window.ClipboardItem({ 'image/png': blobPromise })
    ])
    showToast('图片已复制')
  } catch (error) {
    const blob = await blobPromise.catch(() => null)
    if (blob) {
      try {
        await navigator.clipboard.write([
          new window.ClipboardItem({ 'image/png': blob })
        ])
        showToast('图片已复制')
      } catch (fallbackError) {
        downloadBlob(blob, `${sanitizeFileName(reportName)}课程反馈报告.png`)
        showToast('当前浏览器不允许直接复制图片，已自动下载')
      }
    } else {
      showToast('当前浏览器不允许直接复制图片，请使用导出图片')
    }
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = originalText || '复制图片'
    }
  }
}

async function renderImageReportBlob(sheet) {
  const canvas = await window.html2canvas(sheet, { scale: 2, backgroundColor: '#ffffff' })
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

function getChineseWeekday(date) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
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

function setRearrangeFiles(fileList) {
  const files = Array.from(fileList || [])
  if (!files.length) return

  if (files.length > REARRANGE_MAX_FILES) {
    showToast(`一次最多上传 ${REARRANGE_MAX_FILES} 个文件`)
    return
  }

  const unsupported = files.find((file) => !isSupportedQuestionFile(file))
  if (unsupported) {
    showToast(`不支持 ${unsupported.name}，请上传 PDF、DOCX、PNG 或 JPG`)
    return
  }

  state.rearrange.files = files
  state.rearrange.questions = []
  state.rearrange.status = `已选择 ${files.length} 个文件`
  renderRearrange()
}

function renderRearrange() {
  if (!els.rearrangePanel) return

  els.rearrangeStatus.textContent = state.rearrange.status || '等待上传文件'
  els.recognizeQuestionsBtn.disabled = state.rearrange.busy || !state.rearrange.files.length
  els.exportQuestionsBtn.disabled = state.rearrange.busy || !state.rearrange.questions.length
  els.recognizeQuestionsBtn.textContent = state.rearrange.busy ? '处理中...' : 'AI 识别题目'

  els.rearrangeFileList.innerHTML = state.rearrange.files.length
    ? state.rearrange.files.map((file) => `<span class="file-chip">${escapeHtml(file.name)}</span>`).join('')
    : '<span class="file-chip">未选择文件</span>'

  renderQuestionEditor()
  renderQuestionPreview()
}

function renderQuestionEditor() {
  if (!state.rearrange.questions.length) {
    els.rearrangeEmpty.classList.remove('hidden')
    els.questionEditorList.innerHTML = ''
    return
  }

  els.rearrangeEmpty.classList.add('hidden')
  els.questionEditorList.innerHTML = state.rearrange.questions.map((question, index) => `
    <article class="question-editor-card" data-question-index="${index}">
      <div class="question-editor-head">
        <label class="field">
          <span>题号</span>
          <input data-question-field="number" type="text" value="${escapeHtml(question.number || String(index + 1))}" />
        </label>
        <label class="field">
          <span>图形说明</span>
          <input data-question-field="figureNote" type="text" value="${escapeHtml(question.figureNote || '')}" placeholder="可选：例如函数图像、几何图形等" />
        </label>
        <label class="field">
          <span>选项排版</span>
          <select data-question-field="optionLayout">
            ${renderOptionLayoutOptions(question.optionLayout)}
          </select>
        </label>
      </div>
      <label class="field">
        <span>题干</span>
        <textarea data-question-field="stemMarkdown" rows="5">${escapeHtml(question.stemMarkdown || '')}</textarea>
      </label>
      <label class="field">
        <span>选项（每行一个）</span>
        <textarea data-question-field="options" rows="4">${escapeHtml((question.options || []).join('\n'))}</textarea>
      </label>
      <label class="field">
        <span>图形 SVG（AI生成，可选）</span>
        <textarea data-question-field="figureSvg" rows="4" placeholder="<svg viewBox=&quot;0 0 320 200&quot;>...</svg>">${escapeHtml(question.figureSvg || '')}</textarea>
      </label>
    </article>
  `).join('')
}

function renderQuestionPreview() {
  const title = els.rearrangeTitleInput.value.trim() || '未命名试卷'

  if (!state.rearrange.questions.length) {
    els.questionPreviewPaper.innerHTML = '<div class="empty-paper">识别完成后在这里预览排版</div>'
    return
  }

  els.questionPreviewPaper.innerHTML = [
    `<h2 class="preview-title">${escapeHtml(title)}</h2>`,
    ...state.rearrange.questions.map((question, index) => `
      <article class="preview-question">
        <div class="preview-question-title">${escapeHtml(question.number || String(index + 1))}. ${escapeHtml(question.stemMarkdown || '')}</div>
        ${Array.isArray(question.options) && question.options.length ? `
          <div class="preview-options ${getOptionLayoutClass(question.optionLayout, question.options)}">
            ${question.options.map((option) => `<div>${escapeHtml(option)}</div>`).join('')}
          </div>
        ` : ''}
        ${question.figureNote ? `<div class="preview-note">图形说明：${escapeHtml(question.figureNote)}</div>` : ''}
        ${renderSafeQuestionSvg(question.figureSvg)}
      </article>
    `)
  ].join('')

  renderQuestionMath()
}

function renderSafeQuestionSvg(svgText) {
  const svg = sanitizeQuestionSvg(svgText)
  if (!svg) return ''
  return `<div class="question-figure">${svg}</div>`
}

function renderOptionLayoutOptions(value) {
  const selectedValue = normalizeOptionLayout(value)
  const options = [
    ['inline', '一行'],
    ['two-column', '两列'],
    ['one-column', '单列']
  ]

  return options.map(([optionValue, label]) => (
    `<option value="${optionValue}" ${optionValue === selectedValue ? 'selected' : ''}>${label}</option>`
  )).join('')
}

function getOptionLayoutClass(value, options = []) {
  return `layout-${normalizeOptionLayout(value || inferOptionLayout(options))}`
}

function normalizeOptionLayout(value) {
  const raw = String(value || '').trim()
  if (['inline', 'two-column', 'one-column'].includes(raw)) return raw
  if (['一行', '横排'].includes(raw)) return 'inline'
  if (['两列', '双列'].includes(raw)) return 'two-column'
  if (['单列', '逐行'].includes(raw)) return 'one-column'
  return ''
}

function inferOptionLayout(options = []) {
  const list = Array.isArray(options) ? options.filter(Boolean) : []
  if (!list.length) return 'one-column'

  const maxLength = Math.max(...list.map((option) => String(option || '').length))
  const totalLength = list.reduce((sum, option) => sum + String(option || '').length, 0)

  if (list.length <= 4 && maxLength <= 16 && totalLength <= 72) return 'inline'
  if (maxLength <= 32) return 'two-column'
  return 'one-column'
}

function sanitizeQuestionSvg(svgText) {
  const source = String(svgText || '').trim()
  if (!source || !source.toLowerCase().startsWith('<svg')) return ''

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(source, 'image/svg+xml')
    const svg = doc.querySelector('svg')
    if (!svg || doc.querySelector('parsererror')) return ''

    const allowedTags = new Set(['svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text'])
    const allowedAttrs = new Set([
      'xmlns', 'viewBox', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
      'd', 'points', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
      'stroke-linejoin', 'font-size', 'font-family', 'text-anchor', 'dominant-baseline',
      'transform', 'opacity'
    ])

    Array.from(svg.querySelectorAll('*')).forEach((node) => {
      if (!allowedTags.has(node.tagName)) {
        node.remove()
        return
      }

      Array.from(node.attributes).forEach((attr) => {
        if (attr.name.startsWith('on') || !allowedAttrs.has(attr.name)) {
          node.removeAttribute(attr.name)
        }
      })
    })

    Array.from(svg.attributes).forEach((attr) => {
      if (attr.name.startsWith('on') || !allowedAttrs.has(attr.name)) {
        svg.removeAttribute(attr.name)
      }
    })

    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 320 200')

    return new XMLSerializer().serializeToString(svg)
  } catch (error) {
    return ''
  }
}

function renderQuestionMath() {
  if (!window.MathJax || !window.MathJax.typesetPromise || !els.questionPreviewPaper) return

  window.MathJax.typesetPromise([els.questionPreviewPaper]).catch(() => {})
}

function updateQuestionFromEditor(event) {
  const field = event.target.dataset.questionField
  if (!field) return

  const card = event.target.closest('[data-question-index]')
  if (!card) return

  const index = Number(card.dataset.questionIndex)
  const question = state.rearrange.questions[index]
  if (!question) return

  if (field === 'options') {
    question.options = event.target.value
      .split(/\n+/)
      .map((option) => option.trim())
      .filter(Boolean)
  } else {
    question[field] = event.target.value
  }

  renderQuestionPreview()
}

async function recognizeQuestions() {
  if (!state.rearrange.files.length) {
    showToast('请先上传试卷文件')
    return
  }

  setRearrangeBusy(true, '正在准备文件...')

  try {
    const formData = await buildQuestionRecognizeFormData()
    setRearrangeBusy(true, 'AI 正在识别题目...')

    const response = await fetch('/api/rearrange/recognize', {
      method: 'POST',
      body: formData
    })
    const data = await readJsonResponse(response, '题目识别失败')

    if (response.status === 401) {
      updateAccessState({ authenticated: false })
      renderAccessState()
      throw new Error(data.error || '请先登录账号')
    }

    if (response.status === 429) {
      updateAccessState({ usage: data.usage || state.access.usage })
      renderAccessState()
      throw new Error(data.error || '今天的生成次数已用完')
    }

    if (!response.ok || data.error) throw new Error(data.error || '题目识别失败')

    if (data.usage) {
      updateAccessState({ usage: data.usage })
      renderAccessState()
    }

    state.rearrange.questions = Array.isArray(data.questions)
      ? data.questions.map(normalizeQuestion)
      : []
    state.rearrange.status = state.rearrange.questions.length
      ? `已识别 ${state.rearrange.questions.length} 道题`
      : '没有识别到题目，请换更清晰的文件试试'
    renderRearrange()
    showToast('题目识别完成')
  } catch (error) {
    state.rearrange.status = error.message || '题目识别失败'
    showToast(error.message || '题目识别失败')
  } finally {
    setRearrangeBusy(false)
  }
}

async function buildQuestionRecognizeFormData() {
  const formData = new FormData()
  const payload = {
    title: els.rearrangeTitleInput.value.trim() || '未命名试卷',
    files: state.rearrange.files.map((file) => ({
      name: file.name,
      type: file.type || getFileTypeFromName(file.name),
      size: file.size
    }))
  }
  let pageCount = 0

  for (const file of state.rearrange.files) {
    if (isPdfFile(file)) {
      const count = await appendPdfQuestionPages(formData, file, pageCount)
      pageCount += count
    } else if (pageCount < REARRANGE_MAX_PAGE_IMAGES && (file.type.startsWith('image/') || /\.(png|jpe?g)$/i.test(file.name))) {
      await appendImageQuestionPage(formData, file, pageCount)
      pageCount += 1
    } else {
      formData.append('sourceFile', file, file.name)
    }
  }

  payload.pageCount = pageCount
  formData.append('payload', JSON.stringify(payload))
  return formData
}

async function appendPdfQuestionPages(formData, file, startIndex) {
  if (!window.pdfjsLib) throw new Error('PDF 解析组件加载失败，请刷新页面重试')

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const remaining = Math.max(0, REARRANGE_MAX_PAGE_IMAGES - startIndex)
  const pageTotal = Math.min(pdf.numPages, remaining)

  if (!pageTotal) return 0

  for (let pageNumber = 1; pageNumber <= pageTotal; pageNumber += 1) {
    state.rearrange.status = `正在读取 PDF 第 ${pageNumber}/${pageTotal} 页`
    renderRearrange()
    const page = await pdf.getPage(pageNumber)
    const blob = await renderPdfPageToImageBlob(page, { maxEdge: 1600, quality: 0.7 })
    formData.append('rearrangePageImage', blob, `${file.name}-page-${startIndex + pageNumber}.jpg`)
  }

  return pageTotal
}

async function appendImageQuestionPage(formData, file, pageIndex) {
  state.rearrange.status = `正在压缩图片：${file.name}`
  renderRearrange()
  const blob = await imageFileToJpegBlob(file)
  formData.append('rearrangePageImage', blob, `${file.name}-page-${pageIndex + 1}.jpg`)
}

async function imageFileToJpegBlob(file) {
  const image = await loadImageFromUrl(URL.createObjectURL(file))
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight, 1))
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvasToBlob(canvas, 'image/jpeg', 0.72)
}

async function readJsonResponse(response, fallbackMessage) {
  const text = await response.text()

  try {
    return JSON.parse(text)
  } catch (error) {
    const isHtml = /^\s*</.test(text)
    const message = isHtml
      ? `${fallbackMessage}：测试版后端接口没有返回 JSON，请确认部署已更新为 Node 后端服务。`
      : `${fallbackMessage}：${text.slice(0, 160) || '接口返回为空'}`

    return { error: message }
  }
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    image.src = url
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

function setRearrangeBusy(isBusy, status) {
  state.rearrange.busy = isBusy
  if (status) state.rearrange.status = status
  renderRearrange()
}

async function exportQuestionsToWord() {
  if (!state.rearrange.questions.length) {
    showToast('还没有可导出的题目')
    return
  }

  setRearrangeBusy(true, '正在生成 Word...')

  try {
    const response = await fetch('/api/rearrange/export-word', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: els.rearrangeTitleInput.value.trim() || '未命名试卷',
        questions: state.rearrange.questions
      })
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || '导出 Word 失败')
    }

    const blob = await response.blob()
    downloadBlob(blob, `${els.rearrangeTitleInput.value.trim() || '题卷重排'}.docx`)
    state.rearrange.status = 'Word 已导出'
    showToast('Word 已导出')
  } catch (error) {
    state.rearrange.status = error.message || '导出 Word 失败'
    showToast(error.message || '导出 Word 失败')
  } finally {
    setRearrangeBusy(false)
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function normalizeQuestion(question, index = 0) {
  const item = question && typeof question === 'object' ? question : {}
  const options = Array.isArray(item.options)
    ? item.options.map((option) => String(option || '').trim()).filter(Boolean)
    : []

  return {
    id: item.id || createId('question'),
    number: String(item.number || index + 1),
    stemMarkdown: String(item.stemMarkdown || item.stem || '').trim(),
    options,
    figureNote: String(item.figureNote || item.figureDescription || '').trim(),
    figureSvg: String(item.figureSvg || item.svg || item.figure || '').trim(),
    optionLayout: normalizeOptionLayout(item.optionLayout || item.optionsLayout || item.layout)
      || inferOptionLayout(options),
    answer: String(item.answer || '').trim(),
    analysis: String(item.analysis || '').trim()
  }
}

function isSupportedQuestionFile(file) {
  const lowerName = String(file.name || '').toLowerCase()
  return file.type.startsWith('image/')
    || lowerName.endsWith('.pdf')
    || lowerName.endsWith('.docx')
    || lowerName.endsWith('.png')
    || lowerName.endsWith('.jpg')
    || lowerName.endsWith('.jpeg')
}

function getFileTypeFromName(name) {
  const lowerName = String(name || '').toLowerCase()
  if (lowerName.endsWith('.pdf')) return 'application/pdf'
  if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lowerName.endsWith('.png')) return 'image/png'
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/octet-stream'
}

function renderClassMaterialControls() {
  if (!els.classMaterialModeSelect) return

  const selectedClass = getSelectedClass()
  const isBookSetup = els.classMaterialModeSelect.value === 'book'
  const isBookFeedback = state.mode === 'class'
    && selectedClass
    && selectedClass.materialMode === 'book'
    && selectedClass.textbook

  if (els.classTextbookField) els.classTextbookField.classList.toggle('hidden', !isBookSetup)
  if (els.classTextbookStatus) els.classTextbookStatus.classList.toggle('hidden', !isBookSetup)
  if (els.coursewareField) els.coursewareField.classList.toggle('hidden', Boolean(isBookFeedback))
  if (els.coursewareInput) {
    els.coursewareInput.disabled = Boolean(isBookFeedback)
  }
  renderClassLectureSelect()
}

function renderClassLectureSelect() {
  if (!els.classLectureField || !els.classLectureSelect) return

  const selectedClass = getSelectedClass()
  const textbook = selectedClass && selectedClass.materialMode === 'book' ? selectedClass.textbook : null
  const lectures = textbook && Array.isArray(textbook.lectures) ? textbook.lectures : []
  const shouldShow = state.mode === 'class' && selectedClass && selectedClass.materialMode === 'book' && lectures.length

  els.classLectureField.classList.toggle('hidden', !shouldShow)
  if (!shouldShow) {
    els.classLectureSelect.innerHTML = ''
    return
  }

  els.classLectureSelect.innerHTML = [
    '<option value="">请选择讲次</option>',
    ...lectures.map((lecture, index) => (
      `<option value="${index}">${escapeHtml(lecture.title || `第 ${index + 1} 讲`)}（第 ${lecture.startPage}-${lecture.endPage} 页）</option>`
    ))
  ].join('')
}

async function handleClassTextbookChange() {
  const file = els.classTextbookInput && els.classTextbookInput.files
    ? els.classTextbookInput.files[0]
    : null
  updateFilePicker(els.classTextbookInput, els.classTextbookFileName)
  if (!file) {
    state.classTextbook = { fileKey: '', lectures: [] }
    return
  }
  if (!els.classTextbookStatus) return

  if (!isPdfFile(file)) {
    state.classTextbook = { fileKey: getFileKey(file), lectures: [] }
    els.classTextbookStatus.textContent = `已选择：${file.name}。保存班级时会上传为整本教材。`
    return
  }

  els.classTextbookStatus.textContent = '正在检测教材讲次...'

  try {
    const lectures = await detectPdfLecturesFromFile(file)
    state.classTextbook = { fileKey: getFileKey(file), lectures }
    els.classTextbookStatus.textContent = lectures.length
      ? `已选择：${file.name}，检测到 ${lectures.length} 个讲次，保存班级后可直接选择。`
      : `已选择：${file.name}，未检测到明显讲次，保存后默认读取整本教材。`
  } catch (error) {
    state.classTextbook = { fileKey: getFileKey(file), lectures: [] }
    els.classTextbookStatus.textContent = `已选择：${file.name}，讲次检测失败，保存后仍可作为整本教材使用。`
  }
}

async function uploadClassTextbook(file) {
  const cachedLectures = state.classTextbook.fileKey === getFileKey(file)
    ? state.classTextbook.lectures
    : null
  const lectures = Array.isArray(cachedLectures)
    ? cachedLectures
    : (isPdfFile(file) ? await detectPdfLecturesFromFile(file).catch(() => []) : [])
  const materialId = createMaterialUploadId()

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const formData = new FormData()
    formData.append('material', file, file.name)
    formData.append('lectures', JSON.stringify(lectures))
    formData.append('materialId', materialId)

    let response
    try {
      response = await fetch('/api/materials', {
        method: 'POST',
        body: formData
      })
    } catch (error) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 900))
        continue
      }
      throw new Error('无法连接教材服务器，请刷新页面后重试')
    }

    const responseText = await response.text()
    let data = {}
    try {
      data = responseText ? JSON.parse(responseText) : {}
    } catch (error) {
      data = {}
    }

    if (response.ok && !data.error && data.material) return data.material

    const retryable = [500, 502, 503, 504].includes(response.status)
    if (retryable && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 900))
      continue
    }

    throw new Error(data.error || getMaterialUploadStatusMessage(response.status))
  }

  throw new Error('教材上传失败，请刷新页面后重试')
}

function createMaterialUploadId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `mat-${window.crypto.randomUUID()}`
  }
  return `mat-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getMaterialUploadStatusMessage(status) {
  if (status === 401) return '登录状态已失效，请重新登录后上传教材'
  if (status === 413) return '教材文件超过服务器允许的大小'
  if ([502, 503, 504].includes(status)) return '教材服务器正在重启，请稍后重试'
  if (status >= 500) return '教材保存到数据库失败，请稍后重试'
  return `教材上传失败（错误码 ${status || '未知'}）`
}

async function detectPdfLecturesFromFile(file) {
  if (!window.pdfjsLib) return []

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const lectures = await detectPdfLectures(pdf)

  if (lectures.length) return lectures

  return [{
    key: 'full-book',
    title: '整本教材',
    startPage: 1,
    endPage: pdf.numPages || 1
  }]
}

function renderFeedbackModeControls() {
  if (!els.feedbackScopeSelect) return

  const isClassScope = state.mode === 'class' && els.feedbackScopeSelect.value === 'class'
  const isImageFormat = isImageFeedbackMode()
  const isClassIndividualImage = state.mode === 'class' && !isClassScope && isImageFormat

  const studentTable = els.studentTable
  if (els.studentToolbar) els.studentToolbar.classList.toggle('hidden', isClassScope)
  if (studentTable) studentTable.classList.toggle('hidden', isClassScope)
  if (els.scoreDisplayField) els.scoreDisplayField.classList.toggle('hidden', !isClassIndividualImage)
  if (els.classFeedbackTemplateField) els.classFeedbackTemplateField.classList.toggle('hidden', state.mode !== 'class' || isImageFormat)
  if (els.oneFeedbackTemplateField) els.oneFeedbackTemplateField.classList.toggle('hidden', state.mode !== 'oneOnOne' || isImageFormat)
  if (els.classFeedbackOptions) els.classFeedbackOptions.classList.toggle('hidden', !isClassScope)
  if (els.classPositiveKeywordList) {
    els.classPositiveKeywordList.innerHTML = getClassKeywordGroups().positive.map((keyword) => (
      `<button class="keyword-chip positive" data-keyword="${escapeHtml(keyword)}" type="button">${escapeHtml(keyword)}</button>`
    )).join('')
  }
  if (els.classKeywordList) {
    els.classKeywordList.innerHTML = getClassKeywordGroups().negative.map((keyword) => (
      `<button class="keyword-chip negative" data-keyword="${escapeHtml(keyword)}" type="button">${escapeHtml(keyword)}</button>`
    )).join('')
  }
  if (els.imageReportPanel) {
    els.imageReportPanel.classList.toggle('hidden', !isImageFormat || !state.feedbacks.length)
  }
  if (isImageFormat && state.feedbacks.length) renderImageReport()
}

function getClassKeywordGroups() {
  const quickOptions = state.teaching.data.quickOptions || {}
  return {
    positive: getKeywordList(quickOptions.classPerformancePositive, classKeywordPositiveOptions),
    negative: getKeywordList(quickOptions.classPerformanceNegative, classKeywordNegativeOptions)
  }
}

function getStudentKeywordGroups() {
  const quickOptions = state.teaching.data.quickOptions || {}
  return {
    positive: getKeywordList(quickOptions.performancePositive, studentKeywordPositiveOptions),
    negative: getKeywordList(quickOptions.performanceNegative, studentKeywordNegativeOptions)
  }
}

function getKeywordList(list, fallback) {
  return Array.isArray(list) && list.length ? list : fallback
}

function handleClassKeywordClick(event) {
  const button = event.target.closest('[data-keyword]')
  if (!button || !els.classRemarkInput) return

  const keyword = button.dataset.keyword
  button.classList.toggle('active')

  const current = new Set(els.classRemarkInput.value
    .split(/[、,，；;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean))

  if (button.classList.contains('active')) {
    current.add(keyword)
  } else {
    current.delete(keyword)
  }

  els.classRemarkInput.value = Array.from(current).join('、')
}

function renderOneProfileKeywordControls() {
  renderKeywordButtons(els.onePersonalityPositiveList, personalityKeywordGroups.positive, 'positive', 'personality')
  renderKeywordButtons(els.onePersonalityNegativeList, personalityKeywordGroups.negative, 'negative', 'personality')
  renderKeywordButtons(els.oneHabitPositiveList, habitKeywordGroups.positive, 'positive', 'habit')
  renderKeywordButtons(els.oneHabitNegativeList, habitKeywordGroups.negative, 'negative', 'habit')
}

function renderKeywordButtons(container, keywords, tone, target) {
  if (!container) return
  container.innerHTML = keywords.map((keyword) => (
    `<button class="keyword-chip ${tone}" data-profile-keyword="${escapeHtml(keyword)}" data-profile-target="${target}" type="button">${escapeHtml(keyword)}</button>`
  )).join('')
}

function handleOneProfileKeywordClick(event) {
  const button = event.target.closest('[data-profile-keyword]')
  if (!button) return

  const target = button.dataset.profileTarget
  const textarea = target === 'habit' ? els.oneHabitInput : els.onePersonalityInput
  if (!textarea) return

  appendKeywordToTextarea(textarea, button.dataset.profileKeyword)
  button.classList.add('active')
}

function appendKeywordToTextarea(textarea, keyword) {
  const current = String(textarea.value || '').trim()
  const parts = current
    .split(/[、,，；;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (!parts.includes(keyword)) parts.push(keyword)
  textarea.value = parts.join('、')
}

function resetClassForm() {
  state.editingClassId = ''
  state.classTextbook = { fileKey: '', lectures: [] }
  els.classNameInput.value = ''
  els.gradeSelect.value = '高一'
  els.studentListInput.value = ''
  els.templateInput.value = DEFAULT_TEMPLATE
  if (els.classMaterialModeSelect) els.classMaterialModeSelect.value = 'lesson'
  if (els.classTextbookInput) els.classTextbookInput.value = ''
  updateFilePicker(els.classTextbookInput, els.classTextbookFileName)
  if (els.classTextbookStatus) {
    els.classTextbookStatus.textContent = '选择 PDF 后会自动检测第几讲；其他文档会作为整本教材保存。'
  }
  renderClassMaterialControls()
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
  state.classTextbook = { fileKey: '', lectures: [] }
  els.classNameInput.value = classInfo.name
  els.gradeSelect.value = classInfo.grade
  els.studentListInput.value = classInfo.students.map((student) => student.name).join('\n')
  els.templateInput.value = classInfo.template || DEFAULT_TEMPLATE
  if (els.classMaterialModeSelect) els.classMaterialModeSelect.value = classInfo.materialMode || 'lesson'
  if (els.classTextbookInput) els.classTextbookInput.value = ''
  updateFilePicker(els.classTextbookInput, els.classTextbookFileName)
  if (els.classTextbookStatus) {
    const lectureCount = classInfo.textbook && Array.isArray(classInfo.textbook.lectures)
      ? classInfo.textbook.lectures.length
      : 0
    els.classTextbookStatus.textContent = classInfo.textbook
      ? `已保存教材：${classInfo.textbook.name || '整本教材'}${lectureCount ? `，检测到 ${lectureCount} 个讲次` : ''}`
      : '选择 PDF 后会自动检测第几讲；其他文档会作为整本教材保存。'
  }
  renderClassMaterialControls()
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

async function saveClass() {
  const name = els.classNameInput.value.trim()
  const grade = els.gradeSelect.value
  const studentNames = parseStudentText(els.studentListInput.value)
  const template = els.templateInput.value.trim()
  const materialMode = els.classMaterialModeSelect ? els.classMaterialModeSelect.value : 'lesson'

  if (!name) {
    showToast('请输入班级名称')
    return
  }

  if (!studentNames.length) {
    showToast('请导入学生名单')
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

  let textbook = oldClass && oldClass.textbook ? oldClass.textbook : null
  const textbookFile = els.classTextbookInput && els.classTextbookInput.files
    ? els.classTextbookInput.files[0]
    : null

  if (materialMode === 'book' && textbookFile) {
    try {
      els.saveClassBtn.disabled = true
      els.saveClassBtn.textContent = '正在保存教材...'
      textbook = await uploadClassTextbook(textbookFile)
    } catch (error) {
      showToast(error.message || '教材上传失败')
      els.saveClassBtn.disabled = false
      els.saveClassBtn.textContent = '保存班级'
      return
    }
  }

  if (materialMode === 'book' && !textbook) {
    showToast('请选择并上传整本教材，或改为每节课单独上传讲义')
    els.saveClassBtn.disabled = false
    els.saveClassBtn.textContent = '保存班级'
    return
  }

  const classInfo = {
    id: oldClass ? oldClass.id : createId('class'),
    name,
    grade,
    students,
    template: template || (oldClass && oldClass.template) || DEFAULT_TEMPLATE,
    materialMode,
    textbook: materialMode === 'book' ? textbook : null,
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
  els.saveClassBtn.disabled = true
  els.saveClassBtn.textContent = '正在同步档案...'
  const synced = await saveFeedbackDataToServer({ silent: true })
  render()
  showToast(synced ? '班级已保存并同步' : '班级已保存在本机，数据库同步失败，请稍后再试')
  els.saveClassBtn.disabled = false
  els.saveClassBtn.textContent = '保存班级'
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

  const oldProfile = state.editingOneProfileId
    ? state.oneProfiles.find((item) => item.id === state.editingOneProfileId)
    : null

  const profile = {
    id: oldProfile ? oldProfile.id : createId('one'),
    name,
    grade,
    personality,
    habit,
    template: template || (oldProfile && oldProfile.template) || DEFAULT_TEMPLATE,
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

  const files = payload.materialId ? [] : getSelectedCoursewareFiles()
  const exitTestFile = els.exitTestInput && els.exitTestInput.files
    ? els.exitTestInput.files[0]
    : null

  setGenerating(true)

  try {
    payload.coursewareMeta = []
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      if (isPdfFile(file)) {
        els.generateBtn.textContent = `正在读取 PDF ${index + 1}/${files.length}`
        await appendPdfPreviewData(formData, file, payload, index)
      } else {
        const item = (state.pdfSelection.items || []).find((entry) => entry.fileKey === getFileKey(file))
        payload.coursewareMeta[index] = {
          fileIndex: index,
          fileName: file.name,
          selectedPdfPages: item ? buildCoursewareSelectedPagesFromRange(item) : [],
          clientPdfText: ''
        }
      }
      formData.append('courseware', file)
    }
    els.generateBtn.textContent = 'AI 生成中...'

    formData.append('payload', JSON.stringify(payload))
    if (exitTestFile && payload.exitTest) formData.append('exitTest', exitTestFile)

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

    state.feedbacks = normalizeGeneratedFeedbacksForPayload(data.feedbacks, payload)
    state.lastGeneratedPayload = payload
    state.debug = data.debug || null
    state.pendingTeachingApplication = {
      id: createId('pending-teaching'),
      payload,
      feedbacks: state.feedbacks,
      createdAt: Date.now(),
      applying: false,
      applied: false
    }
    renderResults()
    renderImageReport(payload)
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

    const selectedLecture = getSelectedTextbookLecture(selectedClass)
    const hasStoredMaterial = Boolean(selectedClass && selectedClass.materialMode === 'book' && selectedClass.textbook)
    if (!lessonTitle && !courseNote && !hasSelectedCoursewareFiles() && !hasStoredMaterial) {
      showToast('请填写课程主题、补充内容或导入课件')
      return null
    }

    if (hasStoredMaterial && !selectedLecture && Array.isArray(selectedClass.textbook.lectures) && selectedClass.textbook.lectures.length) {
      showToast('请选择整本教材中的讲次')
      return null
    }

    const currentTemplate = els.templateInput.value.trim() || selectedClass.template
    const feedbackScope = els.feedbackScopeSelect ? els.feedbackScopeSelect.value : 'individual'
    const feedbackFormat = els.feedbackFormatSelect ? els.feedbackFormatSelect.value : 'text'
    const showAllScoresInIndividualReports = els.showAllScoresSelect && els.showAllScoresSelect.value === 'all'
    const classRemark = els.classRemarkInput ? els.classRemarkInput.value.trim() : ''
    const homework = els.homeworkInput ? els.homeworkInput.value.trim() : ''
    const schedule = buildClassSchedulePayload()
    const exitTest = buildExitTestPayload(selectedClass)
    if (exitTest === false) return null
    const lectureNote = selectedLecture
      ? `教材讲次：${selectedLecture.title || '所选讲次'}（第 ${selectedLecture.startPage}-${selectedLecture.endPage} 页）`
      : ''
    const classStudents = feedbackScope === 'class'
      ? [{
          id: `${selectedClass.id}-class-summary`,
          name: selectedClass.name,
          performance: '班级整体反馈',
          remark: classRemark || '请根据班级关键词和课程内容生成整班反馈'
        }]
      : selectedClass.students.map((student) => ({
          ...student,
          exitTestScore: exitTest ? getExitTestScoreText(exitTest, student.name) : ''
        }))

    return {
      mode: 'class',
      feedbackScope,
      feedbackFormat,
      showAllScoresInIndividualReports,
      classId: selectedClass.id,
      className: selectedClass.name,
      grade: selectedClass.grade,
      template: currentTemplate,
      lessonTitle,
      lessonDate: schedule.date,
      lessonDateText: schedule.dateText,
      timeSlot: schedule.timeSlot,
      courseNote: [
        schedule.dateText ? `上课日期：${schedule.dateText}` : '',
        schedule.timeSlot ? `上课时段：${schedule.timeSlot}` : '',
        lectureNote,
        courseNote,
        homework ? `课后作业：${homework}` : '',
        classRemark ? `班级/共性备注：${classRemark}` : ''
      ]
        .filter(Boolean)
        .join('\n'),
      classRemark,
      homework,
      ...(exitTest ? { exitTest } : {}),
      materialId: hasStoredMaterial ? selectedClass.textbook.id : '',
      selectedPdfPages: selectedLecture ? buildPageRange(selectedLecture.startPage, selectedLecture.endPage) : [],
      students: classStudents
    }
  }

  const selectedProfile = getSelectedOneProfile()

  if (!selectedProfile) {
    showToast('请先选择或保存学生档案')
    return null
  }

  if (!lessonTitle && !courseNote && !hasSelectedCoursewareFiles()) {
    showToast('请填写课程主题、补充内容或导入课件')
    return null
  }

  const currentTemplate = els.oneProfileTemplateInput.value.trim()
    || selectedProfile.template
    || DEFAULT_TEMPLATE
  const schedule = buildClassSchedulePayload()
  const feedbackFormat = els.feedbackFormatSelect ? els.feedbackFormatSelect.value : 'text'

  return {
    mode: 'oneOnOne',
    feedbackScope: 'individual',
    feedbackFormat,
    profileId: selectedProfile.id,
    className: `${selectedProfile.name} 一对一`,
    grade: selectedProfile.grade,
    template: currentTemplate,
    lessonTitle,
    lessonDate: schedule.date,
    lessonDateText: schedule.dateText,
    timeSlot: schedule.timeSlot,
    courseNote: [
      schedule.dateText ? `上课日期：${schedule.dateText}` : '',
      schedule.timeSlot ? `上课时段：${schedule.timeSlot}` : '',
      courseNote
    ].filter(Boolean).join('\n'),
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

function isWordFile(fileOrName) {
  const name = typeof fileOrName === 'string' ? fileOrName : String(fileOrName && fileOrName.name || '')
  return /\.(doc|docx)$/i.test(name)
}

function isTextCoursewareFile(fileOrName) {
  const name = typeof fileOrName === 'string' ? fileOrName : String(fileOrName && fileOrName.name || '')
  return /\.(doc|docx|pptx|txt|md)$/i.test(name)
}

function isImageCoursewareFile(fileOrName) {
  const file = typeof fileOrName === 'string' ? null : fileOrName
  const name = typeof fileOrName === 'string' ? fileOrName : String(fileOrName && fileOrName.name || '')
  const type = String(file && file.type || '')
  return type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(name)
}

function supportsCoursewarePageRange(item) {
  return Boolean(item && (item.isPdf || item.isTextDocument))
}

async function handleCoursewareChange() {
  const addedFiles = els.coursewareInput && els.coursewareInput.files
    ? Array.from(els.coursewareInput.files)
    : []
  addCoursewareFiles(addedFiles)
  if (els.coursewareInput) els.coursewareInput.value = ''
  const files = getCoursewareFiles()
  const pdfFiles = files.filter(isPdfFile)
  updateFilePicker(els.coursewareInput, els.coursewareFileName)
  syncCoursewareSelectionItems(files)
  renderPdfPageSelection()

  if (pdfFiles.length) {
    await loadPdfPageSelections(pdfFiles, false)
    syncCoursewareSelectionItems(files)
    renderPdfPageSelection()
  }

  const textFiles = files.filter((file) => isTextCoursewareFile(file))
  await detectCoursewareTextLectures(textFiles)
  syncCoursewareSelectionItems(files)
  renderPdfPageSelection()
}

function getCoursewareFile() {
  return els.coursewareInput.files && els.coursewareInput.files[0]
}

function getCoursewareFiles() {
  return Array.isArray(state.coursewareFiles) ? state.coursewareFiles : []
}

function addCoursewareFiles(files) {
  const existed = new Map(getCoursewareFiles().map((file) => [getFileKey(file), file]))
  files.forEach((file) => existed.set(getFileKey(file), file))
  state.coursewareFiles = Array.from(existed.values())
}

function getSelectedCoursewareFiles() {
  const items = Array.isArray(state.pdfSelection.items) ? state.pdfSelection.items : []
  const includedByKey = new Map(items.map((item) => [item.fileKey, item.included !== false]))
  return getCoursewareFiles().filter((file) => includedByKey.get(getFileKey(file)) !== false)
}

function hasSelectedCoursewareFiles() {
  return getSelectedCoursewareFiles().length > 0
}

function getFileKey(file) {
  if (!file) return ''
  return [file.name, file.size, file.lastModified].join(':')
}

function resetPdfPageSelection() {
  state.pdfSelection = {
    items: [],
    activeFileKey: '',
    fileKey: '',
    fileName: '',
    pageCount: 0,
    selectedPages: [],
    lectures: [],
    selectedLectureIndex: '',
    loading: false,
    isOpen: false,
    error: ''
  }
}

async function loadPdfPageSelection(file, openWhenReady = false) {
  try {
    const item = await loadPdfSelectionItem(file)
    state.pdfSelection = {
      ...item,
      items: [item],
      activeFileKey: item.fileKey,
      isOpen: openWhenReady && (item.lectures.length > 1 || item.pageCount > 40)
    }
    renderPdfPageSelection()

    if (openWhenReady && item.lectures.length > 1) {
      showToast(`检测到 ${item.lectures.length} 个讲次，请选择要读取的讲次`)
    } else if (openWhenReady && item.pageCount > 40) {
      showToast('未检测到多讲，已默认读取全文；页数较多时可手动改页码')
    } else if (openWhenReady) {
      showToast('未检测到多讲，默认读取整个 PDF')
    }
  } catch (error) {
    state.pdfSelection.error = error.message || 'PDF 页面读取失败'
    renderPdfPageSelection()
    showToast(state.pdfSelection.error)
  }
}

async function loadPdfPageSelections(files, openWhenReady = false) {
  if (!window.pdfjsLib) {
    showToast('PDF 解析组件加载失败，请刷新页面重试')
    renderPdfPageSelection()
    return
  }

  const previousItems = new Map((state.pdfSelection.items || []).map((item) => [item.fileKey, item]))
  state.pdfSelection = {
    items: files.map((file) => ({
      fileKey: getFileKey(file),
      fileName: file.name,
      pageCount: 0,
      selectedPages: [],
      lectures: [],
      selectedLectureIndex: '',
      loading: true,
      error: ''
    })),
    activeFileKey: files[0] ? getFileKey(files[0]) : '',
    fileKey: files[0] ? getFileKey(files[0]) : '',
    fileName: files[0] ? files[0].name : '',
    pageCount: 0,
    selectedPages: [],
    lectures: [],
    selectedLectureIndex: '',
    loading: true,
    isOpen: false,
    error: ''
  }
  renderPdfPageSelection()

  try {
    const items = []
    for (const file of files) {
      items.push(await loadPdfSelectionItem(file))
    }
    const loaded = new Map(items.map((item) => [item.fileKey, item]))
    const mergedItems = getCoursewareFiles().map((file) => {
      const fileKey = getFileKey(file)
      return createCoursewareSelectionItem(file, {
        ...(previousItems.get(fileKey) || {}),
        ...(loaded.get(fileKey) || {})
      })
    })
    const active = mergedItems.find((item) => item.fileKey === state.pdfSelection.activeFileKey && item.isPdf)
      || mergedItems.find((item) => item.isPdf)
      || {}
    state.pdfSelection = {
      ...state.pdfSelection,
      ...active,
      items: mergedItems,
      activeFileKey: active.fileKey || '',
      loading: false,
      isOpen: Boolean(openWhenReady)
    }
    renderPdfPageSelection()

    if (openWhenReady) showToast(`已读取 ${items.length} 个 PDF，请逐个确认页码范围`)
  } catch (error) {
    state.pdfSelection.loading = false
    state.pdfSelection.error = error.message || 'PDF 页面读取失败'
    renderPdfPageSelection()
    showToast(state.pdfSelection.error)
  }
}

async function loadPdfSelectionItem(file) {
  if (!window.pdfjsLib) throw new Error('PDF 解析组件加载失败，请刷新页面重试')
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const pageCount = pdf.numPages
  const lectures = await detectPdfLectures(pdf)
  const firstLecture = lectures[0]
  const selectedPages = firstLecture
    ? buildPageRange(firstLecture.startPage, firstLecture.endPage)
    : Array.from({ length: pageCount }, (item, index) => index + 1)
  return {
    fileKey: getFileKey(file),
    fileName: file.name,
    isPdf: true,
    isWord: false,
    included: true,
    pageCount,
    selectedPages,
    lectures,
    selectedLectureIndex: firstLecture ? '0' : '',
    rangeStartPage: selectedPages[0] || 1,
    rangeEndPage: selectedPages[selectedPages.length - 1] || pageCount || '',
    loading: false,
    isOpen: false,
    error: ''
  }
}

async function detectCoursewareTextLectures(files) {
  const candidates = files
    .map((file) => ({
      file,
      item: (state.pdfSelection.items || []).find((entry) => entry.fileKey === getFileKey(file))
    }))
    .filter(({ item }) => item && !item.lectureDetectionDone && !item.loading)

  if (!candidates.length) return

  candidates.forEach(({ item }) => {
    item.loading = true
    item.error = ''
  })
  renderPdfPageSelection()

  for (const { file } of candidates) {
    const fileKey = getFileKey(file)
    const item = (state.pdfSelection.items || []).find((entry) => entry.fileKey === fileKey)
    if (!item) continue

    try {
      const formData = new FormData()
      formData.append('courseware', file)
      const response = await fetch('/api/courseware-lectures', {
        method: 'POST',
        body: formData
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '讲次识别失败')

      const nextItem = (state.pdfSelection.items || []).find((entry) => entry.fileKey === fileKey)
      if (!nextItem) continue

      nextItem.lectures = Array.isArray(data.lectures) ? data.lectures : []
      nextItem.pageCount = Number(data.pageCount || 0)
      nextItem.loading = false
      nextItem.lectureDetectionDone = true
      nextItem.error = ''

      if (nextItem.lectures.length > 1 && !nextItem.selectedLectureIndex && !nextItem.selectedPages.length) {
        applyCoursewareLectureSelection(nextItem, '0')
      }
    } catch (error) {
      const nextItem = (state.pdfSelection.items || []).find((entry) => entry.fileKey === fileKey)
      if (nextItem) {
        nextItem.loading = false
        nextItem.lectureDetectionDone = true
        nextItem.error = '未能自动识别讲次，可手动输入页码'
      }
    }
    renderPdfPageSelection()
  }
}

async function openPdfPageSelection() {
  const pdfFiles = getCoursewareFiles().filter(isPdfFile)
  const file = pdfFiles[0]
  if (!file) return

  if (!state.pdfSelection.items.length) {
    await loadPdfPageSelections(pdfFiles, true)
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
  state.coursewareFiles = []
  els.coursewareInput.value = ''
  updateFilePicker(els.coursewareInput, els.coursewareFileName)
  resetPdfPageSelection()
  renderPdfPageSelection()
  showToast('已取消上传文件')
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
  state.pdfSelection.selectedLectureIndex = ''
  syncActivePdfSelectionItem()
  renderPdfPageSelection()
}

function clearPdfPages() {
  state.pdfSelection.selectedPages = state.pdfSelection.pageCount ? [1] : []
  state.pdfSelection.selectedLectureIndex = ''
  syncActivePdfSelectionItem()
  renderPdfPageSelection()
}

function updatePdfPageSelectionFromGrid(event) {
  if (!event.target.matches('[data-pdf-range-field]')) return

  syncPdfPageRangeInputs()
  renderPdfPageSelection()
}

function handlePdfPageGridClick(event) {
  const button = event.target.closest('[data-pdf-file-key]')
  if (!button) return
  setActivePdfSelection(button.dataset.pdfFileKey)
  renderPdfPageSelection()
}

function syncCoursewareSelectionItems(files = getCoursewareFiles()) {
  const existed = new Map((state.pdfSelection.items || []).map((item) => [item.fileKey, item]))
  const nextItems = files.map((file) => createCoursewareSelectionItem(file, existed.get(getFileKey(file))))
  const active = nextItems.find((item) => item.fileKey === state.pdfSelection.activeFileKey && item.isPdf)
    || nextItems.find((item) => item.isPdf)
  state.pdfSelection.items = nextItems
  if (active) {
    state.pdfSelection = {
      ...state.pdfSelection,
      ...active,
      activeFileKey: active.fileKey
    }
  }
}

function createCoursewareSelectionItem(file, previous = null) {
  const fileKey = getFileKey(file)
  const isPdf = isPdfFile(file)
  const isTextDocument = isTextCoursewareFile(file)
  const rangeStartPage = previous && previous.rangeStartPage !== undefined
    ? previous.rangeStartPage
    : (previous && previous.wordStartPage !== undefined ? previous.wordStartPage : '')
  const rangeEndPage = previous && previous.rangeEndPage !== undefined
    ? previous.rangeEndPage
    : (previous && previous.wordEndPage !== undefined ? previous.wordEndPage : '')

  return {
    ...(previous || {}),
    fileKey,
    fileName: file.name,
    isPdf,
    isWord: isWordFile(file),
    isTextDocument,
    isImage: isImageCoursewareFile(file),
    included: previous ? previous.included !== false : true,
    rangeStartPage,
    rangeEndPage,
    wordStartPage: rangeStartPage || 1,
    wordEndPage: rangeEndPage || '',
    pageCount: Number(previous && previous.pageCount || 0),
    selectedPages: Array.isArray(previous && previous.selectedPages) ? previous.selectedPages.slice() : [],
    lectures: Array.isArray(previous && previous.lectures) ? previous.lectures.slice() : [],
    selectedLectureIndex: previous && previous.selectedLectureIndex !== undefined ? previous.selectedLectureIndex : '',
    loading: Boolean(previous && previous.loading),
    lectureDetectionDone: Boolean(previous && previous.lectureDetectionDone),
    error: previous && previous.error ? previous.error : ''
  }
}

function handleCoursewareSelectionChange(event) {
  const isRelevantControl = event.target.matches('[data-courseware-include]')
    || event.target.matches('[data-courseware-range]')
    || event.target.matches('[data-courseware-lecture]')
  if (!isRelevantControl) return

  if (event.target.matches('[data-courseware-include]')) {
    const fileKey = event.target.dataset.coursewareInclude
    const item = (state.pdfSelection.items || []).find((entry) => entry.fileKey === fileKey)
    if (item) item.included = event.target.checked
  }
  if (event.target.matches('[data-courseware-range]')) {
    const fileKey = event.target.dataset.coursewareRange
    const item = (state.pdfSelection.items || []).find((entry) => entry.fileKey === fileKey)
    if (item) {
      if (event.target.dataset.rangeField === 'start') item.rangeStartPage = normalizeRangeInputValue(event.target.value)
      if (event.target.dataset.rangeField === 'end') item.rangeEndPage = normalizeRangeInputValue(event.target.value)
      item.wordStartPage = item.rangeStartPage || 1
      item.wordEndPage = item.rangeEndPage || ''
      item.selectedLectureIndex = ''
      item.selectedPages = buildCoursewareSelectedPagesFromRange(item)
    }
  }
  if (event.target.matches('[data-courseware-lecture]')) {
    const fileKey = event.target.dataset.coursewareLecture
    const item = (state.pdfSelection.items || []).find((entry) => entry.fileKey === fileKey)
    if (item) {
      applyCoursewareLectureSelection(item, event.target.value)
    }
  }
  renderPdfPageSelection()
}

function handleCoursewareSelectionClick(event) {
  const removeButton = event.target.closest('[data-courseware-remove]')
  if (removeButton) {
    removeCoursewareFile(removeButton.dataset.coursewareRemove)
    renderPdfPageSelection()
    return
  }
}

function removeCoursewareFile(fileKey) {
  state.coursewareFiles = getCoursewareFiles().filter((file) => getFileKey(file) !== fileKey)
  state.pdfSelection.items = (state.pdfSelection.items || []).filter((item) => item.fileKey !== fileKey)
  const active = state.pdfSelection.items.find((item) => item.isPdf)
  if (active) {
    state.pdfSelection = {
      ...state.pdfSelection,
      ...active,
      activeFileKey: active.fileKey,
      isOpen: false
    }
  }
  else {
    state.pdfSelection = {
      ...state.pdfSelection,
      activeFileKey: '',
      fileKey: '',
      fileName: '',
      pageCount: 0,
      selectedPages: [],
      lectures: [],
      selectedLectureIndex: '',
      loading: false,
      isOpen: false,
      error: ''
    }
  }
  updateFilePicker(els.coursewareInput, els.coursewareFileName)
}

function normalizeRangeInputValue(value) {
  if (value === '' || value === null || value === undefined) return ''
  const number = Math.max(1, Math.floor(Number(value) || 1))
  return Number.isFinite(number) ? number : ''
}

function buildWordSelectedPages(item) {
  return buildCoursewareSelectedPagesFromRange(item)
}

function buildCoursewareSelectedPagesFromRange(item) {
  if (!supportsCoursewarePageRange(item)) return []

  const start = normalizeRangeInputValue(item.rangeStartPage)
  const end = normalizeRangeInputValue(item.rangeEndPage)
  const pageCount = Math.max(0, Number(item.pageCount || 0))

  if (!start && !end) return []

  const left = start || 1
  const right = end || pageCount || left
  return buildPageRange(Math.min(left, right), Math.max(left, right))
}

function applyCoursewareLectureSelection(item, selectedValue) {
  if (selectedValue === '' || selectedValue === null || selectedValue === undefined) {
    item.selectedLectureIndex = ''
    item.selectedPages = buildCoursewareSelectedPagesFromRange(item)
    return
  }

  const index = Number(selectedValue)
  const lecture = Array.isArray(item.lectures) && Number.isInteger(index)
    ? item.lectures[index]
    : null

  if (!lecture) {
    item.selectedLectureIndex = ''
    item.selectedPages = buildCoursewareSelectedPagesFromRange(item)
    return
  }

  item.selectedLectureIndex = String(index)
  item.rangeStartPage = lecture.startPage
  item.rangeEndPage = lecture.endPage
  item.wordStartPage = lecture.startPage
  item.wordEndPage = lecture.endPage
  item.selectedPages = buildPageRange(lecture.startPage, lecture.endPage)
}

function setActivePdfSelection(fileKey) {
  syncActivePdfSelectionItem()
  const item = (state.pdfSelection.items || []).find((entry) => entry.fileKey === fileKey)
  if (!item) return

  state.pdfSelection = {
    ...state.pdfSelection,
    ...item,
    activeFileKey: item.fileKey,
    isOpen: true
  }
}

function syncActivePdfSelectionItem() {
  const items = Array.isArray(state.pdfSelection.items) ? state.pdfSelection.items : []
  const index = items.findIndex((item) => item.fileKey === state.pdfSelection.activeFileKey)
  if (index < 0) return
  state.pdfSelection.items[index] = {
    ...items[index],
    fileKey: state.pdfSelection.fileKey,
    fileName: state.pdfSelection.fileName,
    pageCount: state.pdfSelection.pageCount,
    selectedPages: state.pdfSelection.selectedPages.slice(),
    lectures: state.pdfSelection.lectures.slice(),
    selectedLectureIndex: state.pdfSelection.selectedLectureIndex,
    rangeStartPage: state.pdfSelection.rangeStartPage || '',
    rangeEndPage: state.pdfSelection.rangeEndPage || '',
    loading: state.pdfSelection.loading,
    error: state.pdfSelection.error
  }
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
  state.pdfSelection.selectedLectureIndex = ''
  state.pdfSelection.rangeStartPage = left
  state.pdfSelection.rangeEndPage = right
  syncActivePdfSelectionItem()
}

function renderPdfPageSelection() {
  if (!els.pdfPageSelectionBar || !els.pdfPageModal) return

  syncCoursewareSelectionItems()
  const hasFiles = Boolean(getCoursewareFiles().length)

  els.pdfPageSelectionBar.classList.toggle('hidden', !hasFiles)

  if (hasFiles) {
    els.pdfPageSelectionText.innerHTML = renderCoursewareSelectionList()
  }
  if (els.pdfPageSelectBtn) els.pdfPageSelectBtn.classList.add('hidden')

  renderPdfPageModal()
}

function renderCoursewareSelectionList() {
  const items = state.pdfSelection.items || []
  return `
    <div class="courseware-selection-list">
      ${items.map((item) => {
        const selectionMeta = getCoursewareSelectionMeta(item)
        return `
        <div class="courseware-selection-item" data-included="${item.included === false ? 'false' : 'true'}">
          <label class="courseware-selection-check" title="是否让 AI 读取此文件">
            <input data-courseware-include="${escapeHtml(item.fileKey)}" type="checkbox" aria-label="读取 ${escapeHtml(item.fileName)}" ${item.included === false ? '' : 'checked'} />
            <span>读取</span>
          </label>
          <div class="courseware-selection-main">
            <span class="courseware-selection-name" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</span>
            <span class="courseware-selection-meta" title="${escapeHtml(selectionMeta)}">${escapeHtml(selectionMeta)}</span>
          </div>
          <div class="courseware-selection-lecture">${renderCoursewareLectureControl(item)}</div>
          <div class="courseware-selection-range">${renderCoursewareRangeControl(item)}</div>
          <button class="list-delete-button" data-courseware-remove="${escapeHtml(item.fileKey)}" type="button">移除</button>
        </div>
      `}).join('')}
    </div>
  `
}

function renderCoursewareLectureControl(item) {
  const lectures = Array.isArray(item.lectures) ? item.lectures : []
  if (!supportsCoursewarePageRange(item)) return '<div class="courseware-selection-placeholder"></div>'
  if (item.loading) return '<div class="courseware-selection-loading">正在识别讲次...</div>'
  if (item.error && supportsCoursewarePageRange(item)) {
    return `<div class="courseware-selection-loading">${escapeHtml(item.error)}</div>`
  }
  if (lectures.length <= 1) return '<div class="courseware-selection-placeholder">未检测到多讲</div>'

  return `
    <label class="courseware-lecture-select">
      <span>按讲次</span>
      <select data-courseware-lecture="${escapeHtml(item.fileKey)}">
        <option value="">手动输入页码</option>
        ${lectures.map((lecture, index) => {
          const selected = String(index) === String(item.selectedLectureIndex) ? ' selected' : ''
          return `<option value="${index}"${selected}>${escapeHtml(getPdfLectureOptionLabel(lecture))}</option>`
        }).join('')}
      </select>
    </label>
  `
}

function renderCoursewareRangeControl(item) {
  if (!supportsCoursewarePageRange(item)) {
    return '<div class="courseware-selection-placeholder">将读取全文</div>'
  }

  const startValue = getCoursewareRangeInputValue(item, 'start')
  const endValue = getCoursewareRangeInputValue(item, 'end')
  const maxAttribute = item.pageCount ? ` max="${escapeHtml(item.pageCount)}"` : ''

  return `
    <div class="courseware-word-range">
      <span>手动页码</span>
      <input data-courseware-range="${escapeHtml(item.fileKey)}" data-range-field="start" type="number" min="1"${maxAttribute} value="${escapeHtml(startValue)}" placeholder="开始" />
      <span>-</span>
      <input data-courseware-range="${escapeHtml(item.fileKey)}" data-range-field="end" type="number" min="1"${maxAttribute} value="${escapeHtml(endValue)}" placeholder="结束" />
      <span>页</span>
    </div>
  `
}

function getCoursewareRangeInputValue(item, field) {
  const value = field === 'start' ? item.rangeStartPage : item.rangeEndPage
  if (value !== '' && value !== null && value !== undefined) return value

  if (item.isPdf && Array.isArray(item.selectedPages) && item.selectedPages.length) {
    return field === 'start'
      ? item.selectedPages[0]
      : item.selectedPages[item.selectedPages.length - 1]
  }

  return ''
}

function getCoursewareSelectionMeta(item) {
  if (item.loading) return '正在识别讲次'
  if (item.error) return item.error
  if (item.isPdf) return getPdfReadSummary(item)
  if (supportsCoursewarePageRange(item)) {
    const lecture = getSelectedCoursewareLecture(item)
    if (lecture) return `读取 ${lecture.title}（约第 ${lecture.startPage}-${lecture.endPage} 页）`
    const selectedPages = Array.isArray(item.selectedPages) ? item.selectedPages : []
    if (selectedPages.length) return `将读取约第 ${formatPageRanges(selectedPages)} 页`
    return item.pageCount ? `将读取全文（约 ${item.pageCount} 页）` : '将读取全文'
  }
  return '将读取全文'
}

function getSelectedCoursewareLecture(item) {
  if (!item || item.selectedLectureIndex === '' || item.selectedLectureIndex === null || item.selectedLectureIndex === undefined) {
    return null
  }
  const index = Number(item && item.selectedLectureIndex)
  if (!Number.isInteger(index)) return null
  return Array.isArray(item.lectures) ? item.lectures[index] : null
}

function renderPdfPageModal() {
  const selection = state.pdfSelection
  els.pdfPageModal.classList.toggle('hidden', !selection.isOpen)

  if (!selection.isOpen) return

  els.pdfPageModalTitle.textContent = selection.fileName || '选择 PDF 页面'
  els.pdfPageModalMeta.textContent = getPdfModalMeta(selection)

  els.pdfPageSelectAllBtn.disabled = selection.loading || !selection.pageCount
  els.pdfPageSelectNoneBtn.disabled = selection.loading || !selection.pageCount
  els.pdfPageConfirmBtn.disabled = selection.loading || !selection.selectedPages.length
  renderPdfLecturePicker(selection)

  if (selection.loading) {
    els.pdfPageGrid.innerHTML = '<div class="student-empty">正在读取 PDF 页面并检测讲次...</div>'
    return
  }

  if (selection.error) {
    els.pdfPageGrid.innerHTML = `<div class="student-empty">${escapeHtml(selection.error)}</div>`
    return
  }

  const startPage = selection.selectedPages[0] || 1
  const endPage = selection.selectedPages[selection.selectedPages.length - 1] || selection.pageCount || 1
  els.pdfPageGrid.innerHTML = `
    ${renderPdfFileTabs(selection)}
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

function renderPdfFileTabs(selection) {
  const items = Array.isArray(selection.items) ? selection.items : []
  if (items.length <= 1) return ''

  return `
    <div class="pdf-file-tabs">
      ${items.map((item, index) => `
        <button class="teaching-pill ${item.fileKey === selection.activeFileKey ? 'active' : ''}" data-pdf-file-key="${escapeHtml(item.fileKey)}" type="button">${index + 1}. ${escapeHtml(item.fileName)}</button>
      `).join('')}
    </div>
  `
}

function renderPdfLecturePicker(selection) {
  if (!els.pdfLecturePicker || !els.pdfLectureSelect) return

  const shouldShow = !selection.loading && !selection.error && selection.lectures.length > 1
  els.pdfLecturePicker.classList.toggle('hidden', !shouldShow)

  if (!shouldShow) {
    els.pdfLectureSelect.innerHTML = ''
    return
  }

  els.pdfLectureSelect.innerHTML = [
    '<option value="">手动选择页码范围</option>',
    ...selection.lectures.map((lecture, index) => {
      const selected = String(index) === selection.selectedLectureIndex ? ' selected' : ''
      return `<option value="${index}"${selected}>${escapeHtml(getPdfLectureOptionLabel(lecture))}</option>`
    })
  ].join('')
}

function applySelectedPdfLecture() {
  if (els.pdfLectureSelect.value === '') {
    state.pdfSelection.selectedLectureIndex = ''
    syncActivePdfSelectionItem()
    renderPdfPageSelection()
    return
  }

  const index = Number(els.pdfLectureSelect.value)
  const lecture = state.pdfSelection.lectures[index]

  if (!lecture) {
    state.pdfSelection.selectedLectureIndex = ''
    syncActivePdfSelectionItem()
    renderPdfPageSelection()
    return
  }

  state.pdfSelection.selectedLectureIndex = String(index)
  state.pdfSelection.selectedPages = buildPageRange(lecture.startPage, lecture.endPage)
  state.pdfSelection.rangeStartPage = lecture.startPage
  state.pdfSelection.rangeEndPage = lecture.endPage
  syncActivePdfSelectionItem()
  renderPdfPageSelection()
}

function getSelectedPdfLecture(selection = state.pdfSelection) {
  if (!selection || selection.selectedLectureIndex === '' || selection.selectedLectureIndex === null || selection.selectedLectureIndex === undefined) {
    return null
  }
  const index = Number(selection.selectedLectureIndex)
  return Number.isInteger(index) ? selection.lectures[index] : null
}

function getPdfReadSummary(selection) {
  const selectedCount = selection.selectedPages.length
  const totalCount = selection.pageCount

  if (selection.error) return selection.error
  if (!selectedCount) return '未选择页面'

  const lecture = getSelectedPdfLecture(selection)
  if (lecture) {
    return `读取 ${lecture.title}（第 ${formatPageRanges(selection.selectedPages)} 页，${selectedCount}/${totalCount || '?'} 页）`
  }

  if (totalCount && selectedCount === totalCount) {
    return `读取全文（共 ${totalCount} 页）`
  }

  return `读取第 ${formatPageRanges(selection.selectedPages)} 页（${selectedCount}/${totalCount || '?'} 页）`
}

function getPdfModalMeta(selection) {
  if (selection.loading) return '正在读取 PDF，并检测是否包含“第一讲、第二讲”等多讲结构...'
  if (selection.error) return selection.error
  if (selection.lectures.length > 1) {
    return `共 ${selection.pageCount} 页，检测到 ${selection.lectures.length} 个讲次；可选择讲次，也可以手动输入开始页和结束页。`
  }
  if (selection.pageCount > 40) {
    return `共 ${selection.pageCount} 页，未检测到多讲，已默认读取全文；页数较多时建议确认页码范围。`
  }
  return `共 ${selection.pageCount} 页，未检测到多讲，默认读取整个 PDF。`
}

async function detectPdfLectures(pdf) {
  const headings = []
  const pageCount = pdf.numPages || 0

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    try {
      const page = await pdf.getPage(pageNumber)
      const textContent = await page.getTextContent().catch(() => null)
      const heading = detectLectureHeading(extractPdfPageLines(textContent), pageNumber)
      if (heading) headings.push(heading)
    } catch (error) {
      // A single unreadable page should not block feedback generation.
    }
  }

  return buildLecturePageRanges(headings, pageCount)
}

function extractPdfPageLines(textContent) {
  const items = Array.isArray(textContent && textContent.items) ? textContent.items : []
  const positionedItems = items
    .map((item) => {
      const transform = Array.isArray(item.transform) ? item.transform : []
      return {
        text: String(item.str || '').trim(),
        x: Number(transform[4]) || 0,
        y: Number(transform[5]) || 0
      }
    })
    .filter((item) => item.text)

  positionedItems.sort((left, right) => {
    const yDelta = right.y - left.y
    return Math.abs(yDelta) > 3 ? yDelta : left.x - right.x
  })

  const lines = []

  positionedItems.forEach((item) => {
    const lastLine = lines[lines.length - 1]
    if (!lastLine || Math.abs(lastLine.y - item.y) > 3) {
      lines.push({
        y: item.y,
        items: [item]
      })
      return
    }

    lastLine.items.push(item)
  })

  return lines.map((line) => line.items
    .sort((left, right) => left.x - right.x)
    .map((item) => item.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim())
    .filter(Boolean)
}

function detectLectureHeading(pageLines, pageNumber) {
  const lines = pageLines
    .map((line) => String(line || '').replace(/　/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const topLines = lines.slice(0, 40)
  const candidates = topLines
    .map((line) => matchLectureHeadingLine(line, pageNumber))
    .filter(Boolean)

  if (!candidates.length) return null

  const uniqueKeys = new Set(candidates.map((candidate) => candidate.key))
  const looksLikeContents = topLines.slice(0, 12).some((line) => /目录|contents/i.test(line))
    || uniqueKeys.size > 1

  if (looksLikeContents) return null

  return candidates[0]
}

function matchLectureHeadingLine(line, pageNumber) {
  if (!line || line.length > 140) return null

  const chineseMatch = line.match(/第\s*([零〇一二两三四五六七八九十百\d]{1,8})\s*(讲|课)\s*[:：、，.．\-—_ ]*\s*(.{0,70})$/)
  if (chineseMatch) {
    return buildLectureHeading({
      pageNumber,
      rawNumber: chineseMatch[1],
      unit: chineseMatch[2],
      marker: `第${chineseMatch[1]}${chineseMatch[2]}`,
      title: chineseMatch[3]
    })
  }

  const lessonMatch = line.match(/\b(Lesson|Lecture)\s*([0-9]{1,3})\s*[:：.．\-—_ ]*\s*(.{0,70})$/i)
  if (lessonMatch) {
    return buildLectureHeading({
      pageNumber,
      rawNumber: lessonMatch[2],
      unit: lessonMatch[1],
      marker: `${lessonMatch[1]} ${lessonMatch[2]}`,
      title: lessonMatch[3]
    })
  }

  const topicMatch = line.match(/专题\s*([零〇一二两三四五六七八九十百\d]{1,8})\s*[:：、，.．\-—_ ]*\s*(.{0,70})$/)
  if (topicMatch) {
    return buildLectureHeading({
      pageNumber,
      rawNumber: topicMatch[1],
      unit: '专题',
      marker: `专题${topicMatch[1]}`,
      title: topicMatch[2]
    })
  }

  return null
}

function buildLectureHeading({ pageNumber, rawNumber, unit, marker, title }) {
  const normalizedNumber = normalizeLectureNumber(rawNumber)
  const cleanTitle = cleanLectureHeadingTitle(title)
  const headingTitle = cleanTitle ? `${marker} ${cleanTitle}` : marker

  return {
    pageNumber,
    number: normalizedNumber,
    unit,
    key: normalizedNumber ? `${unit}-${normalizedNumber}` : `${unit}-${marker}`,
    title: headingTitle
  }
}

function cleanLectureHeadingTitle(value) {
  let title = String(value || '').replace(/\s+/g, ' ').trim()
  const nextHeadingIndex = title.search(/\s第\s*[零〇一二两三四五六七八九十百\d]{1,8}\s*(讲|课)/)
  if (nextHeadingIndex > 0) title = title.slice(0, nextHeadingIndex)

  return title
    .replace(/\.{2,}\s*\d{1,4}\s*$/, '')
    .replace(/[·•∙]{2,}\s*\d{1,4}\s*$/, '')
    .replace(/\s+(?:P\.?\s*)?\d{1,4}\s*$/i, '')
    .replace(/^[：:、，,.\-—_]+/, '')
    .trim()
    .slice(0, 52)
}

function normalizeLectureNumber(value) {
  const raw = String(value || '').trim()
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Number(raw)

  return chineseNumberToNumber(raw)
}

function chineseNumberToNumber(value) {
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
    return hundreds * 100 + chineseNumberToNumber(restText)
  }
  if (text.includes('十')) {
    const [tensText, onesText = ''] = text.split('十')
    const tens = tensText ? map[tensText] || 0 : 1
    const ones = onesText ? map[onesText] || 0 : 0
    return tens * 10 + ones
  }
  return map[text] || 0
}

function buildLecturePageRanges(headings, pageCount) {
  const lectures = []

  headings
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .forEach((heading) => {
      const previous = lectures[lectures.length - 1]
      if (previous && previous.key === heading.key) return
      if (lectures.some((lecture) => lecture.key === heading.key)) return

      lectures.push({
        key: heading.key,
        title: heading.title,
        startPage: heading.pageNumber,
        endPage: pageCount
      })
    })

  if (lectures.length <= 1) return []

  return lectures.map((lecture, index) => ({
    ...lecture,
    endPage: lectures[index + 1] ? Math.max(lecture.startPage, lectures[index + 1].startPage - 1) : pageCount
  }))
}

function getPdfLectureOptionLabel(lecture) {
  return `${lecture.title}（第 ${lecture.startPage}-${lecture.endPage} 页）`
}

function getSelectedPdfPages(file, pageCount) {
  const fileKey = getFileKey(file)
  const item = (state.pdfSelection.items || []).find((entry) => entry.fileKey === fileKey)
  const selectedPages = item ? item.selectedPages : (state.pdfSelection.fileKey === fileKey ? state.pdfSelection.selectedPages : [])
  if (selectedPages && selectedPages.length) {
    return selectedPages
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

async function appendPdfPreviewData(formData, file, payload, fileIndex = 0) {
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

  if (!Array.isArray(payload.coursewareMeta)) payload.coursewareMeta = []
  payload.coursewareMeta[fileIndex] = {
    fileIndex,
    fileName: file.name,
    selectedPdfPages: selectedPages,
    clientPdfText: ''
  }

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
      formData.append('pdfPageImage', imageBlob, `courseware-${fileIndex}-page-${pageNumber}.jpg`)
    }
  }

  const extractedText = textParts
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()

  if (extractedText) {
    payload.coursewareMeta[fileIndex].clientPdfText = extractedText.slice(0, 30000)
    if (fileIndex === 0) payload.clientPdfText = extractedText.slice(0, 30000)
  }
}

async function renderPdfPageToImageBlob(page, options = {}) {
  const baseViewport = page.getViewport({ scale: 1 })
  const maxScale = options.maxScale || 1.8
  const maxEdge = options.maxEdge || 1400
  const quality = options.quality || 0.82
  const scale = Math.min(maxScale, maxEdge / Math.max(baseViewport.width, 1))
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

  return canvasToBlob(canvas, 'image/jpeg', quality)
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

function getSelectedTextbookLecture(classInfo = getSelectedClass()) {
  if (!classInfo || !classInfo.textbook || !Array.isArray(classInfo.textbook.lectures)) return null
  const index = Number(els.classLectureSelect && els.classLectureSelect.value)
  if (!Number.isInteger(index)) return null
  return classInfo.textbook.lectures[index] || null
}

function buildClassSchedulePayload() {
  const date = state.classSchedule.selectedDate || getLocalDateKey(new Date())
  const timeSlot = els.classTimeSlotSelect ? els.classTimeSlotSelect.value : state.classSchedule.timeSlot
  state.classSchedule.timeSlot = timeSlot || ''

  return {
    date,
    dateText: formatChineseDate(date),
    timeSlot: timeSlot || ''
  }
}

function buildExitTestPayload(classInfo) {
  const students = classInfo && Array.isArray(classInfo.students) ? classInfo.students : []
  const mode = state.exitTest.mode === 'grade' ? 'grade' : 'percent'
  const totalScore = Math.max(1, Number(els.exitTestTotalInput && els.exitTestTotalInput.value || state.exitTest.totalScore || 100))
  const file = els.exitTestInput && els.exitTestInput.files ? els.exitTestInput.files[0] : null
  const selectedLecture = getSelectedExitTestLecture()
  const hasAnyScoreInput = students.some((student) => {
    const saved = state.exitTest.scores[student.id] || {}
    return mode === 'grade'
      ? Boolean(String(saved.grade || '').trim() || String(saved.note || '').trim())
      : Boolean(String(saved.score ?? '').trim() || String(saved.note || '').trim())
  })
  const hasExitTestData = Boolean(file || hasAnyScoreInput)

  if (!hasExitTestData) return null

  if (file && state.exitTest.lectures.length > 1 && !selectedLecture) {
    showToast('请选择出门测文件中的讲次')
    return false
  }

  if (!students.length) {
    return {
      mode,
      totalScore: mode === 'grade' ? null : totalScore,
      fileName: file ? file.name : '',
      selectedLecture: selectedLecture ? selectedLecture.title || '' : '',
      selectedPdfPages: selectedLecture ? buildPageRange(selectedLecture.startPage, selectedLecture.endPage) : [],
      students: []
    }
  }

  const rows = students.map((student) => {
    const saved = state.exitTest.scores[student.id] || {}
    return {
      id: student.id,
      name: student.name,
      score: mode === 'percent' ? normalizeScoreValue(saved.score) : null,
      grade: mode === 'grade' ? String(saved.grade || '').trim() : '',
      note: String(saved.note || '').trim()
    }
  })

  const missing = rows.find((row) => mode === 'grade' ? !row.grade : row.score === null)
  if (missing) {
    showToast(`请填写 ${missing.name} 的出门测${mode === 'grade' ? '等级' : '成绩'}`)
    return false
  }

  const sortedStudents = rows.slice().sort((left, right) => compareExitTestRows(left, right, mode))

  return {
    mode,
    totalScore: mode === 'grade' ? null : totalScore,
    fileName: file ? file.name : '',
    selectedLecture: selectedLecture ? selectedLecture.title || '' : '',
    selectedPdfPages: selectedLecture ? buildPageRange(selectedLecture.startPage, selectedLecture.endPage) : [],
    students: sortedStudents
  }
}

function getSelectedExitTestLecture() {
  if (!state.exitTest.lectures.length) return null
  const index = Number(state.exitTest.selectedLectureIndex)
  if (!Number.isInteger(index)) return null
  return state.exitTest.lectures[index] || null
}

function normalizeScoreValue(value) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function compareExitTestRows(left, right, mode) {
  if (mode === 'grade') {
    const order = { A: 4, B: 3, C: 2, D: 1 }
    return (order[right.grade] || 0) - (order[left.grade] || 0)
  }

  return Number(right.score || 0) - Number(left.score || 0)
}

function getExitTestScoreText(exitTest, studentName) {
  const row = exitTest && Array.isArray(exitTest.students)
    ? exitTest.students.find((item) => item.name === studentName)
    : null
  if (!row) return ''
  if (exitTest.mode === 'grade') return `${row.grade} 等`
  return `${row.score}/${exitTest.totalScore}`
}

function updateAllFilePickers() {
  updateFilePicker(els.classTextbookInput, els.classTextbookFileName)
  updateFilePicker(els.coursewareInput, els.coursewareFileName)
  updateFilePicker(els.exitTestInput, els.exitTestFileName)
}

function updateFilePicker(input, nameElement) {
  if (!input || !nameElement) return

  const files = input === els.coursewareInput ? getCoursewareFiles() : (input.files ? Array.from(input.files) : [])
  const file = files[0]
  const picker = input.closest('.file-picker')
  nameElement.textContent = files.length > 1 ? `${files.length} 个文件` : (file ? file.name : '未选择任何文件')
  if (picker) picker.classList.toggle('has-file', Boolean(file))
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

function appendStudentKeyword(index, keyword) {
  const students = getWorkingStudents()
  const student = students[index]
  if (!student || !keyword) return

  const remark = String(student.remark || '').trim()
  const keywords = new Set(String(student.keywords || '')
    .split(/[、,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean))
  keywords.add(keyword)
  student.keywords = Array.from(keywords).join('、')
  student.remark = remark.includes(keyword)
    ? remark
    : [remark, keyword].filter(Boolean).join('；')

  if (state.mode === 'oneOnOne') {
    state.oneLesson.remark = student.remark
    return
  }

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
