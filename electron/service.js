// 数据服务层（P2 下沉）：109 个纯 db 转发方法，跨端复用。
// Electron 的 IPC handler 与 APK 的 Capacitor 桥都调用本层——业务逻辑只写一份。
// 平台能力（对话框/打开外链/文件系统/加密 token/自动更新等 18 个）不在此层，
// 由各端实现同名方法：Electron 在 main.js，APK 用 Capacitor 插件。

// 纯 db 转发清单（方法名 = db 方法名，参数透传）
const PURE_DB_METHODS = [
  // 科目/题库
  'getCategories', 'getSubjects', 'getCurrentSubject', 'setCurrentSubject',
  'getQuestions', 'submitAnswer', 'getWrongBook', 'getFavorites',
  'toggleFavorite', 'setFavoriteGroup', 'getNote', 'saveNote', 'listNotes',
  'getNotedQuestionIds', 'getSummary', 'getActivityHeatmap', 'markMastered',
  'rateReview', 'getReviewCurve', 'getReasonAnalysis', 'getDailyBrief',
  'getDailyPuzzle', 'submitDailyPuzzle', 'getKbGraph', 'exportAllZip',
  // 数据管理
  'clearUserData', 'exportData', 'importData', 'importPreview',
  // 题库管理
  'listQuestions', 'addQuestion', 'updateQuestion', 'deleteQuestion',
  'getQuestionInfo', 'importQuestionBank', 'getBankStats', 'exportBank',
  'addCategory', 'renameCategory', 'deleteCategory', 'generatePaper',
  'listPapers', 'getPaper', 'deletePaper', 'getImage', 'setQuestionTags',
  'getQuestionById', 'listTags', 'getSimilarQuestions', 'batchUpdateQuestions',
  'batchDeleteQuestions',
  // 设置/成就
  'getSetting', 'setSetting', 'getAchievements',
  // 知识库
  'kbList', 'kbGet', 'kbUpdate', 'kbDelete', 'kbSetTags', 'kbTags',
  'kbLink', 'kbUnlink', 'kbLinksForQuestion', 'kbLinksForDoc', 'kbSearch',
  'kbRead', 'kbSuggestDocs', 'kbSuggestQuestions', 'kbBumpRead', 'kbSaveMd',
  // 学习/专注
  'xpStats', 'logXp', 'checkQuests', 'addFocusSession', 'focusStats',
  'getHighlightsForDoc', 'removeHighlight', 'getDocLinks', 'linkDocs',
  'unlinkDocs', 'setWrongReason', 'removeWrongBook',
  // 记忆卡
  'addCard', 'addCardFromQuestion', 'addCardFromHighlight', 'addCardSmart',
  'listCards', 'updateCard', 'deleteCard', 'rateCard', 'getCardReview',
  'cardsStats', 'saveResumeSession', 'getResumeSession', 'clearResumeSession',
  'reviewDueStats', 'saveKbScroll',
  // 备份/统计
  'listBackups', 'cleanupOrphanImages', 'cleanupOrphanAudio', 'getDbStatus',
  'getWeakPoints', 'getCategoryAccuracy', 'saveAudio', 'getAudioUrl',
  'exportWrongBook', 'exportNotes', 'getWeeklyReport', 'getMonthStats'
]

// 渲染层/IPC 方法名 → db 实际方法名的别名映射（P2 修复：清单沿用渲染层 API 名，
// 部分与 db 方法名不一致——kb* 缩写 vs 完整名、exportWrongBook/exportNotes 的 Markdown 后缀）
const DB_ALIASES = {
  kbList: 'getKbDocs',
  kbGet: 'getKbDoc',
  kbUpdate: 'updateKbDoc',
  kbDelete: 'deleteKbDoc',
  kbSetTags: 'setKbTags',
  kbTags: 'listKbTags',
  kbLink: 'linkKbDoc',
  kbUnlink: 'unlinkKbDoc',
  kbLinksForQuestion: 'getKbLinksForQuestion',
  kbLinksForDoc: 'getKbLinksForDoc',
  kbSearch: 'searchKb',
  kbRead: 'readKbFile',
  kbSuggestDocs: 'getSuggestedDocsForQuestion',
  kbSuggestQuestions: 'getSuggestedQuestionsForDoc',
  kbBumpRead: 'bumpKbRead',
  exportWrongBook: 'exportWrongBookMarkdown',
  exportNotes: 'exportNotesMarkdown'
}

// 创建数据服务：所有方法 = (...args) => db[realMethod](...args)
function createDataService(db) {
  const svc = {}
  for (const m of PURE_DB_METHODS) {
    const real = DB_ALIASES[m] || m
    svc[m] = (...args) => db[real](...args)
  }
  return svc
}

module.exports = { createDataService, PURE_DB_METHODS }
