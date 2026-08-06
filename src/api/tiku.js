// 渲染层（Vue）通过 preload 暴露的 window.electronAPI 与主进程通信。
// 这里包一层，组件里直接 import { tiku } 调用即可。
export const tiku = {
  getCategories: () => window.electronAPI.getCategories(),
  getSubjects: () => window.electronAPI.getSubjects(),
  getCurrentSubject: () => window.electronAPI.getCurrentSubject(),
  setCurrentSubject: (id) => window.electronAPI.setCurrentSubject(id),
  getQuestions: (opts) => window.electronAPI.getQuestions(opts),
  submitAnswer: (payload) => window.electronAPI.submitAnswer(payload),
  getWrongBook: () => window.electronAPI.getWrongBook(),
  getFavorites: () => window.electronAPI.getFavorites(),
  toggleFavorite: (questionId) => window.electronAPI.toggleFavorite(questionId),
  getNote: (questionId) => window.electronAPI.getNote(questionId),
  saveNote: (payload) => window.electronAPI.saveNote(payload),
  listNotes: () => window.electronAPI.listNotes(),
  getNotedQuestionIds: () => window.electronAPI.getNotedQuestionIds(),
  getStats: () => window.electronAPI.getStats(),
  getSummary: () => window.electronAPI.getSummary(),
  getChapterProgress: (subjectId) => window.electronAPI.getChapterProgress(subjectId),
  getWeeklyTrend: () => window.electronAPI.getWeeklyTrend(),
  getMonthlyCalendar: (year, month) => window.electronAPI.getMonthlyCalendar(year, month),
  getRecentRecords: (limit) => window.electronAPI.getRecentRecords(limit),
  clearUserData: () => window.electronAPI.clearUserData(),
  exportData: () => window.electronAPI.exportData(),
  importData: (json) => window.electronAPI.importData(json),

  // 云同步（GitHub Gist）
  syncGetConfig: () => window.electronAPI.syncGetConfig(),
  syncConnect: (token) => window.electronAPI.syncConnect(token),
  syncDisconnect: () => window.electronAPI.syncDisconnect(),
  syncNow: () => window.electronAPI.syncNow(),

  // ---- 题库管理 ----
  listQuestions: (opts) => window.electronAPI.listQuestions(opts),
  addQuestion: (q) => window.electronAPI.addQuestion(q),
  updateQuestion: (q) => window.electronAPI.updateQuestion(q),
  deleteQuestion: (id) => window.electronAPI.deleteQuestion(id),
  importQuestionBank: (rows, opts) => window.electronAPI.importQuestionBank(rows, opts),
  getBankStats: () => window.electronAPI.getBankStats(),
  exportBank: (subjectId) => window.electronAPI.exportBank(subjectId),
  exportExcel: (subjectId) => window.electronAPI.exportExcel(subjectId),
  exportExcelTemplate: () => window.electronAPI.exportExcelTemplate(),
  addCategory: (payload) => window.electronAPI.addCategory(payload),
  renameCategory: (payload) => window.electronAPI.renameCategory(payload),
  deleteCategory: (id) => window.electronAPI.deleteCategory(id),
  // 模拟卷组卷 / 题目图片
  generatePaper: (payload) => window.electronAPI.generatePaper(payload),
  listPapers: () => window.electronAPI.listPapers(),
  getPaper: (id) => window.electronAPI.getPaper(id),
  deletePaper: (id) => window.electronAPI.deletePaper(id),
  saveImage: (buf, ext) => window.electronAPI.saveImage(buf, ext),
  getImage: (name) => window.electronAPI.getImage(name),
  parseSheet: (buf) => window.electronAPI.parseSheet(buf)
}
