const { app, BrowserWindow, ipcMain, Menu, safeStorage, dialog, shell, Notification } = require('electron')
const pkg = require('../package.json')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

// 打包版使用独立数据目录，与开发版隔离：
// 开发机上的测试科目/文档/历史数据不会随安装版首启带入；首次运行即干净初始状态。
// 迁移历史数据：旧版本「我的 → 数据管理 → 导出备份」→ 安装版「恢复备份」。
if (app.isPackaged) {
  try { app.setPath('userData', path.join(app.getPath('appData'), '知识记忆小助手-正式版')) } catch (e) {}
}

const db = require('./db')
const { readXlsx, writeXlsx } = require('./xlsx-lite')
const ghRepo = require('./sync-github-repo')
const syncRunner = require('./sync-runner')
const runner = syncRunner(db)
const { extractMd, extractPdf, uniqueRelPath } = require('./kbExtract')
const logger = require('./logger')

// ---- 继承 git 代理通道（必须在 app ready 前生效）----
// 用户网络常见「git 能 push 但 Node 直连不通」：把 git 全局代理喂给 Chromium 网络栈，
// 让同步与 git 走同一条通道（系统代理由 net.fetch 自动继承，这里只补 git 手动配置的）。
try {
  const { execSync } = require('child_process')
  const proxy = (execSync('git config --global --get http.proxy', { encoding: 'utf8', timeout: 4000 }) ||
    execSync('git config --global --get https.proxy', { encoding: 'utf8', timeout: 4000 }) || '').trim()
  if (proxy) app.commandLine.appendSwitch('proxy-server', proxy.replace(/^https?:\/\//, ''))
} catch (e) { /* 无 git 代理配置，忽略 */ }

// ---- 自动更新（electron-updater）：仅打包版启用；发现新版本自动下载，退出时安装 ----
function setupAutoUpdater() {
  try {
    if (!app.isPackaged) { logger.info('auto-updater: 开发模式跳过'); return }
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-available', (info) => {
      logger.info('auto-updater: 发现新版本', info && info.version)
      try {
        if (Notification.isSupported()) {
          new Notification({ title: '发现新版本 🚀', body: `v${info.version} 已开始下载，完成后退出应用即自动安装。` }).show()
        }
      } catch (e) { /* 忽略 */ }
    })
    autoUpdater.on('update-downloaded', (info) => {
      try {
        if (Notification.isSupported()) {
          new Notification({ title: '更新已就绪 ✅', body: `v${info.version} 下载完成，退出应用后将自动安装。` }).show()
        }
      } catch (e) { /* 忽略 */ }
    })
    autoUpdater.on('error', (e) => logger.error('auto-updater 失败', e && e.message))
    setTimeout(() => { try { autoUpdater.checkForUpdates() } catch (e) {} }, 10000)
    setInterval(() => { try { autoUpdater.checkForUpdates() } catch (e) {} }, 6 * 3600 * 1000)
    logger.info('auto-updater: 已启用')
  } catch (e) {
    logger.error('auto-updater 未启用', e && e.message)
  }
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
ipcMain.handle('toggleFavorite', (e, questionId, group) => db.toggleFavorite(questionId, group))
ipcMain.handle('setFavoriteGroup', (e, questionId, group) => db.setFavoriteGroup(questionId, group))
ipcMain.handle('getNote', (e, questionId) => db.getNote(questionId))
ipcMain.handle('saveNote', (e, payload) => db.saveNote(payload))
ipcMain.handle('listNotes', () => db.listNotes())
ipcMain.handle('getNotedQuestionIds', () => db.getNotedQuestionIds())
ipcMain.handle('getSummary', (e, subjectId) => db.getSummary(subjectId))
ipcMain.handle('getWeeklyTrend', (e, subjectId) => db.getWeeklyTrend(subjectId))
ipcMain.handle('getMonthlyCalendar', (e, year, month, subjectId) => db.getMonthlyCalendar(year, month, subjectId))
ipcMain.handle('getActivityHeatmap', (e, days, subjectId) => db.getActivityHeatmap(days, subjectId))
ipcMain.handle('markMastered', (e, questionId) => db.markMastered(questionId))
ipcMain.handle('rateReview', (e, questionId, quality) => db.rateReview(questionId, quality))
ipcMain.handle('getReviewCurve', (e, days) => db.getReviewCurve(days))
ipcMain.handle('exportAllZip', () => db.exportAllZip())
ipcMain.handle('getKbGraph', () => db.getKbGraph())
ipcMain.handle('getDailyPuzzle', (e, subjectId) => db.getDailyPuzzle(subjectId))
ipcMain.handle('submitDailyPuzzle', (e, questionId, correct) => db.submitDailyPuzzle(questionId, correct))
ipcMain.handle('getGoalContract', () => db.getGoalContract())
ipcMain.handle('setGoalContract', (e, cfg) => db.setGoalContract(cfg))
ipcMain.handle('claimGoalReward', () => db.claimGoalReward())
ipcMain.handle('clearUserData', () => db.clearUserData())
ipcMain.handle('exportData', () => db.exportData())
ipcMain.handle('importData', (e, json) => db.importData(json))
ipcMain.handle('importPreview', (e, json) => db.importPreview(json))

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
async function importKbPaths(filePaths, subjectId) {
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
      const docId = db.addKbDoc({ title, type: ext, relPath: rel, size: raw.length, hash, blocks, subjectId: subjectId || null })
      results.push({ ok: true, docId, title, type: ext, blocks: blocks.length, error })
    } catch (e) {
      results.push({ ok: false, file: src, error: String((e && e.message) || e) })
    }
  }
  return results
}

ipcMain.handle('kbImportFiles', async (e, paths, subjectId) => {
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
  return importKbPaths(filePaths, subjectId)
})
ipcMain.handle('kbList', (e, subjectId) => db.getKbDocs(subjectId))
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
ipcMain.handle('kbGetNote', (e, docId) => db.getKbNote(docId))
// ---- 反馈层（XP/每日任务/回顾/专注/习惯/高亮/双链/错题原因）----
ipcMain.handle('xpStats', () => db.xpStats())
ipcMain.handle('logXp', (e, xp, source, note) => db.logXp(xp, source, note))
ipcMain.handle('checkQuests', () => db.checkQuests())
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
ipcMain.handle('removeHighlight', (e, id) => db.removeHighlight(id))
ipcMain.handle('getDocLinks', (e, docId) => db.getDocLinks(docId))
ipcMain.handle('linkDocs', (e, fromDocId, toDocId) => db.linkDocs(fromDocId, toDocId))
ipcMain.handle('unlinkDocs', (e, fromDocId, toDocId) => db.unlinkDocs(fromDocId, toDocId))
ipcMain.handle('setWrongReason', (e, questionId, reason) => db.setWrongReason(questionId, reason))
ipcMain.handle('addCard', (e, front, back, category, subjectId) => db.addCard(front, back, category, subjectId))
ipcMain.handle('addCardFromQuestion', (e, questionId) => db.addCardFromQuestion(questionId))
ipcMain.handle('listCards', (e, subjectId) => db.listCards(subjectId))
ipcMain.handle('updateCard', (e, id, front, back, category, subjectId) => db.updateCard(id, front, back, category, subjectId))
ipcMain.handle('deleteCard', (e, id) => db.deleteCard(id))
ipcMain.handle('getCardReview', (e, limit, subjectId) => db.getCardReview(limit, subjectId))
ipcMain.handle('cardsStats', (e, subjectId) => db.cardsStats(subjectId))

ipcMain.handle('saveResumeSession', (e, p) => db.saveResumeSession(p))
ipcMain.handle('getResumeSession', () => db.getResumeSession())
ipcMain.handle('clearResumeSession', () => db.clearResumeSession())
ipcMain.handle('xpDetail', () => db.xpDetail())
ipcMain.handle('reviewDueStats', (e, subjectId) => db.reviewDueStats(subjectId))
ipcMain.handle('saveKbScroll', (e, docId, page) => db.saveKbScroll(docId, page))
ipcMain.handle('listBackups', () => db.listBackups())
ipcMain.handle('cleanupOrphanImages', () => db.cleanupOrphanImages())
ipcMain.handle('getDbStatus', () => db.getDbStatus())
ipcMain.handle('getWeakPoints', (e, limit, subjectId) => db.getWeakPoints(limit, subjectId))
ipcMain.handle('getCategoryAccuracy', (e, subjectId) => db.getCategoryAccuracy(subjectId))
ipcMain.handle('saveAudio', (e, buf, ext) => db.saveAudio(buf, ext))
ipcMain.handle('getAudioUrl', (e, name) => db.getAudioUrl(name))
ipcMain.handle('exportWrongBook', () => db.exportWrongBookMarkdown())
ipcMain.handle('exportNotes', () => db.exportNotesMarkdown())
ipcMain.handle('openPath', (e, p) => { try { shell.openPath(p) } catch (err) { logger.error('openPath 失败 ' + (err && err.message)) } })
ipcMain.handle('restoreBackup', (e, file) => {
  const r = db.restoreBackup(file)
  if (r.ok) setTimeout(() => { try { app.relaunch(); app.exit(0) } catch (err) { app.exit(0) } }, 600)
  return r
})
ipcMain.handle('getWeeklyReport', (e, subjectId) => db.getWeeklyReport(subjectId))
ipcMain.handle('getMonthStats', () => db.getMonthStats())
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

// ---- GitHub 仓库同步（唯一后端：数据快照 + 知识库文档 + 题目图片）----
ipcMain.handle('ghGetConfig', () => ({
  token: db.getSetting('gh_token') || '',
  owner: db.getSetting('gh_owner') || '',
  repo: db.getSetting('gh_repo') || '',
  lastSync: Number(db.getSetting('gh_last_sync') || 0)
}))
ipcMain.handle('ghSaveConfig', (e, cfg) => {
  db.setSetting('gh_token', String(cfg.token || '').trim())
  db.setSetting('gh_owner', String(cfg.owner || '').trim())
  db.setSetting('gh_repo', String(cfg.repo || '').trim())
  return { ok: true }
})
ipcMain.handle('ghTest', async (e, cfg) => {
  await ghRepo.testConnection({ token: cfg.token, owner: cfg.owner, repo: cfg.repo })
  return { ok: true }
})
ipcMain.handle('ghSync', async () => {
  const ghCfg = {
    token: db.getSetting('gh_token') || '',
    owner: db.getSetting('gh_owner') || '',
    repo: db.getSetting('gh_repo') || ''
  }
  if (!ghCfg.token || !ghCfg.owner || !ghCfg.repo) throw new Error('请先完成 GitHub 仓库配置')
  const r = await runner.sync(ghCfg)
  db.setSetting('gh_last_sync', String(Date.now()))
  return r
})