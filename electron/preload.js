const { contextBridge, ipcRenderer } = require('electron')

// 只暴露白名单方法给渲染层，避免直接暴露 node/electron 能力（安全）。
contextBridge.exposeInMainWorld('electronAPI', {
  getCategories: () => ipcRenderer.invoke('getCategories'),
  getSubjects: () => ipcRenderer.invoke('getSubjects'),
  getCurrentSubject: () => ipcRenderer.invoke('getCurrentSubject'),
  setCurrentSubject: (id) => ipcRenderer.invoke('setCurrentSubject', id),
  getQuestions: (opts) => ipcRenderer.invoke('getQuestions', opts),
  submitAnswer: (payload) => ipcRenderer.invoke('submitAnswer', payload),
  getWrongBook: () => ipcRenderer.invoke('getWrongBook'),
  getFavorites: () => ipcRenderer.invoke('getFavorites'),
  toggleFavorite: (questionId) => ipcRenderer.invoke('toggleFavorite', questionId),
  getStats: () => ipcRenderer.invoke('getStats'),
  getSummary: () => ipcRenderer.invoke('getSummary'),
  getChapterProgress: (subjectId) => ipcRenderer.invoke('getChapterProgress', subjectId),
  getWeeklyTrend: () => ipcRenderer.invoke('getWeeklyTrend'),
  getMonthlyCalendar: (year, month) => ipcRenderer.invoke('getMonthlyCalendar', year, month),
  getRecentRecords: (limit) => ipcRenderer.invoke('getRecentRecords', limit),
  clearUserData: () => ipcRenderer.invoke('clearUserData'),
  exportData: () => ipcRenderer.invoke('exportData'),
  importData: (json) => ipcRenderer.invoke('importData', json),

  // 题库管理
  listQuestions: (opts) => ipcRenderer.invoke('listQuestions', opts),
  addQuestion: (q) => ipcRenderer.invoke('addQuestion', q),
  updateQuestion: (q) => ipcRenderer.invoke('updateQuestion', q),
  deleteQuestion: (id) => ipcRenderer.invoke('deleteQuestion', id),
  importQuestionBank: (rows, opts) => ipcRenderer.invoke('importQuestionBank', rows, opts),
  getBankStats: () => ipcRenderer.invoke('getBankStats'),
  exportBank: (subjectId) => ipcRenderer.invoke('exportBank', subjectId),
  exportExcel: (subjectId) => ipcRenderer.invoke('exportExcel', subjectId),
  exportExcelTemplate: () => ipcRenderer.invoke('exportExcelTemplate'),
  addCategory: (payload) => ipcRenderer.invoke('addCategory', payload),
  renameCategory: (payload) => ipcRenderer.invoke('renameCategory', payload),
  deleteCategory: (id) => ipcRenderer.invoke('deleteCategory', id),
  parseSheet: (buf) => ipcRenderer.invoke('parseSheet', buf)
})
