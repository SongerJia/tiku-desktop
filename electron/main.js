const { app, BrowserWindow, ipcMain, Menu, safeStorage, dialog, shell, Notification } = require('electron')
const pkg = require('../package.json')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const db = require('./db')
const { readXlsx, writeXlsx } = require('./xlsx-lite')
const syncGithub = require('./sync-github')
const { extractMd, extractPdf, uniqueRelPath } = require('./kbExtract')

// ---- 云同步 token 安全存储（加密落盘，不进 settings 表，避免明文） ----
const TOKEN_PATH = path.join(app.getPath('userData'), 'sync-token.enc')

function loadToken() {
  try {
    if (!fs.existsSync(TOKEN_PATH)) return null
    const buf = fs.readFileSync(TOKEN_PATH)
    if (safeStorage && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf)
    return buf.toString('utf8') // 无加密环境降级（沙箱/老系统），明文存储，仅本机
  } catch (e) {
    return null
  }
}

function saveToken(token) {
  try {
    if (!token) {
      if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH)
      return
    }
    const data = (safeStorage && safeStorage.isEncryptionAvailable())
      ? safeStorage.encryptString(token)
      : Buffer.from(token, 'utf8')
    fs.writeFileSync(TOKEN_PATH, data)
  } catch (e) {
    throw new Error('保存 token 失败：' + (e.message || String(e)))
  }
}

// 题库扁平行 → 导出用的二维数组（表头顺序与 bankParser.bankToMatrix 严格一致，
// 多端/导回导入都能对上列）。主进程是 CommonJS，bankParser 是 ESM，这里内联一份。
const EXPORT_HEADER = [
  '科目', '章节', '题型', '题干',
  '选项A', '选项B', '选项C', '选项D', '选项E', '选项F',
  '答案', '得分关键词', '解析', '难度', '来源'
]
function bankToMatrix(list) {
  const body = (list || []).map(q => {
    const opt = {}
    ;(q.options || []).forEach(o => { opt[o.key] = o.text })
    const noOpt = q.type === 'judge' || q.type === 'essay'
    return [
      q.subject || '',
      q.chapter || '',
      ({ single: '单选', multiple: '多选', judge: '判断', essay: '问答' })[q.type] || q.type,
      q.stem || '',
      noOpt ? '' : (opt.A || ''),
      noOpt ? '' : (opt.B || ''),
      noOpt ? '' : (opt.C || ''),
      noOpt ? '' : (opt.D || ''),
      noOpt ? '' : (opt.E || ''),
      noOpt ? '' : (opt.F || ''),
      (q.answer || []).join(''),
      (q.keywords || []).join('；'),
      q.analysis || '',
      q.difficulty == null ? 3 : q.difficulty,
      q.source || ''
    ]
  })
  return [EXPORT_HEADER, ...body]
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    resizable: true,
    title: '知识记忆小助手',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 隐藏系统默认菜单栏（File / Edit / View / Window / Help），让界面更像独立 App。
  // 开发调试需要 DevTools 时按 Ctrl+Shift+I（Windows/Linux）或 Cmd+Option+I（macOS）。
  Menu.setApplicationMenu(null)
}

app.whenReady().then(() => {
  db.init() // 打开 SQLite、建表、灌样例数据（仅首次）
  // Windows 通知需 AppUserModelID（打包后生效；开发模式走 Electron 默认）
  try { app.setAppUserModelId('com.songerjia.tiku-desktop') } catch (e) { /* 忽略 */ }
  createWindow()
  startReminderLoop()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// ---- 学习提醒（系统通知）：每天 remind_time 到点提醒一次 ----
const pad2 = n => String(n).padStart(2, '0')
const dateStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }

function checkReminder() {
  try {
    if (db.getSetting('remind_enabled') !== '1') return
    const time = db.getSetting('remind_time') || '21:00'
    const now = new Date()
    const hm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
    if (hm !== time) return
    if (db.getSetting('last_remind_date') === dateStr()) return
    const s = db.getSummary() || {}
    const goal = Number(db.getSetting('daily_goal') || 0)
    const body = `今日已刷 ${s.today || 0} 题${goal ? `，目标 ${goal} 题` : ''}；错题本待复习 ${s.wrongCount || 0} 题。`
    if (Notification.isSupported()) {
      new Notification({ title: '学习提醒 📚', body }).show()
      db.setSetting('last_remind_date', dateStr())
    }
  } catch (e) { /* 提醒失败静默，不影响主流程 */ }
}

function startReminderLoop() {
  try {
    checkReminder() // 启动即查一次（刚好到点也能触发）
    setInterval(checkReminder, 60 * 1000)
  } catch (e) { /* 忽略 */ }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    db.close()
    app.quit()
  }
})

// 主进程全局错误日志（排错用，不弹出干扰）
process.on('uncaughtException', (e) => {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), `[${new Date().toISOString()}] uncaught: ${(e && e.stack) || e}\n`) } catch (err) {}
})
process.on('unhandledRejection', (reason) => {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), `[${new Date().toISOString()}] rejection: ${(reason && reason.stack) || reason}\n`) } catch (err) {}
})

// ---- 主进程 ↔ 渲染层 的 IPC 通道 ----
ipcMain.handle('getCategories', () => db.getCategories())
ipcMain.handle('getSubjects', () => db.getSubjects())
ipcMain.handle('getCurrentSubject', () => db.getCurrentSubject())
ipcMain.handle('setCurrentSubject', (e, id) => db.setCurrentSubject(id))
ipcMain.handle('getQuestions', (e, opts) => db.getQuestions(opts))
ipcMain.handle('submitAnswer', (e, payload) => db.submitAnswer(payload))
ipcMain.handle('getWrongBook', () => db.getWrongBook())
ipcMain.handle('getFavorites', () => db.getFavorites())
ipcMain.handle('toggleFavorite', (e, questionId) => db.toggleFavorite(questionId))
ipcMain.handle('getNote', (e, questionId) => db.getNote(questionId))
ipcMain.handle('saveNote', (e, payload) => db.saveNote(payload))
ipcMain.handle('listNotes', () => db.listNotes())
ipcMain.handle('getNotedQuestionIds', () => db.getNotedQuestionIds())
ipcMain.handle('getStats', () => db.getStats())
ipcMain.handle('getSummary', () => db.getSummary())
ipcMain.handle('getWeeklyTrend', () => db.getWeeklyTrend())
ipcMain.handle('getMonthlyCalendar', (e, year, month) => db.getMonthlyCalendar(year, month))
ipcMain.handle('getRecentRecords', (e, limit) => db.getRecentRecords(limit))
ipcMain.handle('clearUserData', () => db.clearUserData())
ipcMain.handle('exportData', () => db.exportData())
ipcMain.handle('importData', (e, json) => db.importData(json))

// ---- 题库管理 ----
ipcMain.handle('listQuestions', (e, opts) => db.listQuestions(opts))
ipcMain.handle('addQuestion', (e, q) => db.addQuestion(q))
ipcMain.handle('updateQuestion', (e, q) => db.updateQuestion(q))
ipcMain.handle('deleteQuestion', (e, id) => db.deleteQuestion(id))
ipcMain.handle('importQuestionBank', (e, rows, opts) => db.importQuestionBank(rows, opts))
ipcMain.handle('getBankStats', () => db.getBankStats())
ipcMain.handle('exportBank', (e, subjectId) => db.exportBank(subjectId))
ipcMain.handle('addCategory', (e, payload) => db.addCategory(payload))
ipcMain.handle('renameCategory', (e, payload) => db.renameCategory(payload))
ipcMain.handle('deleteCategory', (e, id) => db.deleteCategory(id))

// ---- 模拟卷组卷 / 题目图片 ----
ipcMain.handle('generatePaper', (e, payload) => db.generatePaper(payload))
ipcMain.handle('listPapers', () => db.listPapers())
ipcMain.handle('getPaper', (e, id) => db.getPaper(id))
ipcMain.handle('deletePaper', (e, id) => db.deletePaper(id))
ipcMain.handle('saveImage', (e, buf, ext) => {
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  return db.saveImage(buffer, ext)
})
ipcMain.handle('getImage', (e, name) => db.getImage(name))

// ---- 标签 / 薄弱分析 / 相似题 / 批量操作 / 设置 ----
ipcMain.handle('setQuestionTags', (e, questionId, tags) => db.setQuestionTags(questionId, tags))
ipcMain.handle('getQuestionTags', (e, questionId) => db.getQuestionTags(questionId))
ipcMain.handle('getQuestionById', (e, id) => db.getQuestionById(id))
ipcMain.handle('listTags', () => db.listTags())
ipcMain.handle('getWeakChapters', (e, subjectId, limit) => db.getWeakChapters(subjectId, limit))
ipcMain.handle('getSimilarQuestions', (e, questionId, limit) => db.getSimilarQuestions(questionId, limit))
ipcMain.handle('getWeakQuestions', (e, limit, subjectId, categoryId) => db.getWeakQuestions(limit, subjectId, categoryId))
ipcMain.handle('batchUpdateQuestions', (e, ids, patch) => db.batchUpdateQuestions(ids, patch))
ipcMain.handle('batchDeleteQuestions', (e, ids) => db.batchDeleteQuestions(ids))
ipcMain.handle('getSetting', (e, key) => db.getSetting(key))
ipcMain.handle('setSetting', (e, key, value) => db.setSetting(key, value))
ipcMain.handle('getAchievements', () => db.getAchievements())

// ---- 个人知识库（kb_*）：导入编排 + IPC ----
// 导入策略：原件复制进 userData/kb/（副本，绝不改原件）；同 hash 去重；
// MD 按标题切块；PDF 用 pdfjs 抽文本，无文本层时降级（空块 + error，靠文件名/标签兜底）。
async function importKbPaths(filePaths) {
  const dir = path.join(app.getPath('userData'), 'kb')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const results = []
  for (const src of filePaths || []) {
    try {
      const ext = (path.extname(src) || '').toLowerCase().replace('.', '')
      if (ext !== 'md' && ext !== 'pdf') {
        results.push({ ok: false, file: src, error: '仅支持 md / pdf 文档' })
        continue
      }
      const title = path.basename(src, path.extname(src))
      const raw = fs.readFileSync(src)
      const hash = crypto.createHash('sha1').update(raw).digest('hex')
      const dup = db.findKbDocByHash(hash)
      if (dup) {
        results.push({ ok: true, duplicated: true, docId: dup.id, title: dup.title, type: dup.type })
        continue
      }
      const rel = uniqueRelPath(dir, title, ext)
      fs.copyFileSync(src, path.join(dir, rel))
      let blocks = []
      let error = null
      if (ext === 'md') {
        blocks = extractMd(raw.toString('utf8'))
      } else {
        const r = await extractPdf(src)
        blocks = r.blocks || []
        error = r.error
      }
      const docId = db.addKbDoc({ title, type: ext, relPath: rel, size: raw.length, hash, blocks })
      results.push({ ok: true, docId, title, type: ext, blocks: blocks.length, error })
    } catch (e) {
      results.push({ ok: false, file: src, error: String((e && e.message) || e) })
    }
  }
  return results
}

ipcMain.handle('kbImportFiles', async (e, paths) => {
  let filePaths = paths && paths.length ? paths : null
  if (!filePaths) {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win, {
      title: '导入知识文档',
      filters: [{ name: '知识文档', extensions: ['md', 'pdf'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (res.canceled || !res.filePaths.length) return []
    filePaths = res.filePaths
  }
  return importKbPaths(filePaths)
})
ipcMain.handle('kbList', () => db.getKbDocs())
ipcMain.handle('kbGet', (e, id) => db.getKbDoc(id))
ipcMain.handle('kbUpdate', (e, id, patch) => db.updateKbDoc(id, patch))
ipcMain.handle('kbDelete', (e, id) => db.deleteKbDoc(id))
ipcMain.handle('kbSetTags', (e, docId, tags) => db.setKbTags(docId, tags))
ipcMain.handle('kbTags', () => db.listKbTags())
ipcMain.handle('kbLink', (e, payload) => db.linkKbDoc(payload))
ipcMain.handle('kbUnlink', (e, docId, questionId) => db.unlinkKbDoc(docId, questionId))
ipcMain.handle('kbLinksForQuestion', (e, questionId) => db.getKbLinksForQuestion(questionId))
ipcMain.handle('kbLinksForDoc', (e, docId) => db.getKbLinksForDoc(docId))
ipcMain.handle('kbSearch', (e, query, limit) => db.searchKb(query, limit))
ipcMain.handle('kbStats', () => db.kbStats())
ipcMain.handle('kbRead', (e, id) => db.readKbFile(id))
ipcMain.handle('kbSuggestDocs', (e, questionId, limit) => db.getSuggestedDocsForQuestion(questionId, limit))
ipcMain.handle('kbSuggestQuestions', (e, docId, limit) => db.getSuggestedQuestionsForDoc(docId, limit))
ipcMain.handle('kbFolders', () => db.getKbFolders())
ipcMain.handle('kbMove', (e, docId, folder) => db.moveKbDoc(docId, folder))
ipcMain.handle('kbBumpRead', (e, id) => db.bumpKbRead(id))
ipcMain.handle('kbSaveMd', (e, id, content) => db.kbSaveMd(id, content))
// ---- 反馈层（XP/每日任务/回顾/专注/习惯/高亮/双链/错题原因）----
ipcMain.handle('xpStats', () => db.xpStats())
ipcMain.handle('checkQuests', () => db.checkQuests())
ipcMain.handle('todayCounts', () => db.todayCounts())
ipcMain.handle('getDailyReview', (e, limit) => db.getDailyReview(limit))
ipcMain.handle('logReview', (e, itemType, itemId, result) => db.logReview(itemType, itemId, result))
ipcMain.handle('addFocusSession', (e, minutes) => db.addFocusSession(minutes))
ipcMain.handle('focusStats', () => db.focusStats())
ipcMain.handle('listHabits', () => db.listHabits())
ipcMain.handle('addHabit', (e, name, icon) => db.addHabit(name, icon))
ipcMain.handle('updateHabit', (e, id, patch) => db.updateHabit(id, patch))
ipcMain.handle('deleteHabit', (e, id) => db.deleteHabit(id))
ipcMain.handle('checkHabit', (e, habitId, dateStr) => db.checkHabit(habitId, dateStr))
ipcMain.handle('uncheckHabit', (e, habitId, dateStr) => db.uncheckHabit(habitId, dateStr))
ipcMain.handle('getHighlightsForDoc', (e, docId) => db.getHighlightsForDoc(docId))
ipcMain.handle('addHighlight', (e, payload) => db.addHighlight(payload))
ipcMain.handle('removeHighlight', (e, id) => db.removeHighlight(id))
ipcMain.handle('getDocLinks', (e, docId) => db.getDocLinks(docId))
ipcMain.handle('linkDocs', (e, fromDocId, toDocId) => db.linkDocs(fromDocId, toDocId))
ipcMain.handle('unlinkDocs', (e, fromDocId, toDocId) => db.unlinkDocs(fromDocId, toDocId))
ipcMain.handle('setWrongReason', (e, questionId, reason) => db.setWrongReason(questionId, reason))
ipcMain.handle('addCard', (e, front, back, category) => db.addCard(front, back, category))
ipcMain.handle('listCards', () => db.listCards())
ipcMain.handle('updateCard', (e, id, front, back, category) => db.updateCard(id, front, back, category))
ipcMain.handle('deleteCard', (e, id) => db.deleteCard(id))
ipcMain.handle('getCardReview', (e, limit) => db.getCardReview(limit))
ipcMain.handle('cardsStats', () => db.cardsStats())

ipcMain.handle('saveResumeSession', (e, p) => db.saveResumeSession(p))
ipcMain.handle('getResumeSession', () => db.getResumeSession())
ipcMain.handle('clearResumeSession', () => db.clearResumeSession())
ipcMain.handle('xpDetail', () => db.xpDetail())
ipcMain.handle('reviewDueStats', () => db.reviewDueStats())
ipcMain.handle('saveKbScroll', (e, docId, page) => db.saveKbScroll(docId, page))
ipcMain.handle('listBackups', () => db.listBackups())
ipcMain.handle('restoreBackup', (e, file) => {
  const r = db.restoreBackup(file)
  if (r.ok) setTimeout(() => { try { app.relaunch(); app.exit(0) } catch (err) { app.exit(0) } }, 600)
  return r
})
ipcMain.handle('getWeeklyReport', () => db.getWeeklyReport())
ipcMain.handle('getChapterProgress', () => db.getChapterProgress())
ipcMain.handle('getVersion', () => ({ name: pkg.productName || '知识记忆小助手', version: pkg.version }))
ipcMain.handle('openExternal', (e, url) => { try { shell.openExternal(String(url)) } catch (err) {} })
// 知识库导出：选目录 → 复制全部原件 + 写 manifest.json（元数据/标签/联动摘要）
ipcMain.handle('kbExport', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const res = await dialog.showOpenDialog(win, {
    title: '选择知识库导出目录',
    properties: ['openDirectory', 'createDirectory']
  })
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true }
  const target = res.filePaths[0]
  const srcDir = db.kbDir()
  const docCount = db.getKbDocs().length
  let files = 0
  if (fs.existsSync(srcDir)) {
    for (const name of fs.readdirSync(srcDir)) {
      const full = path.join(srcDir, name)
      if (!fs.statSync(full).isFile()) continue
      fs.copyFileSync(full, path.join(target, name))
      files++
    }
  }
  const manifest = {
    exportedAt: Date.now(),
    docs: db.getKbDocs(),
    tags: db.listKbTags(),
    stats: db.kbStats(),
    note: '本目录为知识库文档导出：文件为原件副本，manifest.json 含元数据/标签/联动摘要，可直接导入知识库或手动归档'
  }
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return { ok: true, files, docs: docCount, target }
})
// 用系统默认程序打开 KB 原件（扫描版 PDF 等无法内嵌预览的场景兜底）
ipcMain.handle('kbOpen', (e, id) => {
  const doc = db.getKbDoc(id)
  if (!doc) return { ok: false, error: '文档不存在' }
  const full = path.join(db.kbDir(), doc.rel_path)
  if (!fs.existsSync(full)) return { ok: false, error: '文件缺失' }
  shell.openPath(full)
  return { ok: true }
})

// Excel 解析放主进程（Node 侧）：渲染层把文件读成 Uint8Array 传过来。
// 用零依赖的 xlsx-lite（Node 内置 zlib + 手写 zip/CRC32）解析，不再依赖 xlsx 包。
ipcMain.handle('parseSheet', (e, buf) => {
  try {
    const matrix = readXlsx(Buffer.from(buf))
    // 取第一个非空工作表的二维数组；readXlsx 已按 sheet 返回数组，这里统一成二维矩阵
    const rows = Array.isArray(matrix) && Array.isArray(matrix[0]) ? matrix : (matrix && matrix.rows ? matrix.rows : [])
    if (!rows.length) return []
    // 与 CSV 保持一致：数字答案统一转字符串，避免 "1" 被当数字
    return rows.map(r => (Array.isArray(r) ? r : []).map(c => (c == null ? '' : String(c))))
  } catch (err) {
    throw new Error('Excel 解析失败：' + (err.message || String(err)))
  }
})

// 导出 Excel：主进程用零依赖 xlsx-lite 生成 .xlsx，返回 base64（渲染层转 blob 下载）
ipcMain.handle('exportExcel', (e, subjectId) => {
  const rows = db.exportBank(subjectId || null)
  if (!rows || !rows.length) return null
  const matrix = bankToMatrix(rows)
  const buf = writeXlsx(matrix, { sheetName: '题库' })
  return Buffer.from(buf).toString('base64')
})

// 下载 Excel 导入模板：含表头 + 4 行示例（单选/多选/判断/问答各 1 行）
const TEMPLATE_SAMPLE_ROWS = [
  EXPORT_HEADER,
  ['建设工程法规', '基本法律知识', '单选', '根据《民法典》，下列不属于法人应当具备条件的是？',
   '依法成立', '有必要的财产或者经费', '有自己的名称、组织机构和场所', '必须营利', '', '',
   'D', '', '法人并不以营利为必要条件，非营利法人同样具有法人资格。', 2, '教材例题'],
  ['建设工程施工管理', '施工组织设计', '多选', '施工组织设计一般应包括的内容有（ ）。',
   '工程概况', '施工部署', '施工进度计划', '施工准备与资源配置计划', '', '',
   'ABCD', '', '施工组织设计通常包括上述内容及主要施工方法、平面布置、管理计划等。', 3, '教材例题'],
  ['建设工程法规', '施工许可法律制度', '判断', '建设单位未取得施工许可证擅自施工的，责令停止施工，可以并处以罚款。（ ）',
   '', '', '', '', '', '', '对', '', '依据《建筑法》第六十四条。', 1, '教材例题'],
  ['建设工程施工管理', '施工管理基础', '问答', '简述施工进度计划编制的主要步骤，并说明关键控制点。',
   '', '', '', '', '', '',
   '①收集资料 ②划分施工过程 ③计算工程量 ④确定持续时间 ⑤编制初始计划 ⑥检查与优化 ⑦交底与动态调整。关键控制点是持续时间估算与关键线路识别。',
   '收集资料；划分施工过程；计算工程量；持续时间；网络图；关键线路；资源均衡；动态调整',
   '本题考查施工进度计划编制流程。', 4, '教材例题']
]
ipcMain.handle('exportExcelTemplate', () => {
  const buf = writeXlsx(TEMPLATE_SAMPLE_ROWS, { sheetName: '题库导入模板' })
  return Buffer.from(buf).toString('base64')
})

// ---- 云同步（GitHub Gist，零后端） ----
// 安全原则：token 只存本机加密文件，绝不回传渲染层；配置只读不回写 token。
ipcMain.handle('syncGetConfig', () => {
  const token = loadToken()
  return {
    connected: !!token,
    login: db.getSetting('sync_login') || '',
    gistId: db.getSetting('sync_gist_id') || '',
    lastSync: Number(db.getSetting('sync_last_sync') || 0)
  }
})

ipcMain.handle('syncConnect', async (e, token) => {
  const t = (token || '').trim()
  if (!t) throw new Error('请输入 GitHub Token')
  const u = await syncGithub.validateToken(t) // 不通会抛错，连接失败不存 token
  saveToken(t)
  db.setSetting('sync_login', u.login)
  return { login: u.login, name: u.name }
})

ipcMain.handle('syncDisconnect', () => {
  saveToken(null)
  db.setSetting('sync_gist_id', '')
  db.setSetting('sync_login', '')
  db.setSetting('sync_last_sync', '')
  return { ok: true }
})

// 同步编排：pull 合并 → push 全量（收敛模型，保证多设备最终一致）
ipcMain.handle('syncNow', async () => {
  const token = loadToken()
  if (!token) throw new Error('未连接 GitHub，请先在「云同步」中连接')
  let gistId = db.getSetting('sync_gist_id')

  // 1) 拉远端并合并进本地（若无 gistId 说明还没建过，跳过 pull）
  let merge = null
  if (gistId) {
    const g = await syncGithub.getGist(token, gistId)
    if (g.content) merge = db.mergeRemote(g.content)
  }

  // 2) 导出本地全量快照并推送
  const local = db.exportSync()
  if (!gistId) {
    const r = await syncGithub.createGist(token, local)
    gistId = r.gistId
    db.setSetting('sync_gist_id', gistId)
  } else {
    await syncGithub.updateGist(token, gistId, local)
  }

  const now = Date.now()
  db.setSetting('sync_last_sync', String(now))
  return { ok: true, lastSync: now, gistId, merge }
})
