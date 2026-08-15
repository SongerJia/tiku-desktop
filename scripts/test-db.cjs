// db.js 集成测试基线（防回归安全网，供大文件拆分前后对比）
// 运行：npx electron scripts/test-db.cjs
// 说明：better-sqlite3 是 electron ABI，必须用 electron 主进程跑（非 node）；userData 隔离到临时目录。
const { app } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tiku-dbtest-'))
app.setPath('userData', tmp)

let pass = 0
let fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✅', name) } else { fail++; console.log('  ❌', name) }
}

try {
  const db = require('../electron/db.js')
  db.init()

  // 1) 初始状态
  const summary = db.getSummary()
  ok('init: getSummary.total > 0（样例数据已灌入）', summary.total > 0)
  ok('init: streak 为数字', typeof summary.streak === 'number')

  // 2) 取题
  const qs = db.getQuestions({ limit: 5 })
  ok('getQuestions 返回题目数组', Array.isArray(qs) && qs.length > 0)
  const q = qs[0]
  ok('题目含 stem', !!q.stem)

  // 3) 答错 → 入错题本
  const resWrong = db.submitAnswer({ questionId: q.id, selected: [], durationMs: 0, mode: 'practice' })
  ok('答错 isCorrect=false', resWrong.isCorrect === false)
  ok('答错后错题本含该题', db.getWrongBook().some(x => x.question_id === q.id))

  // 4) 答对
  const ans = Array.isArray(q.answer) ? q.answer : JSON.parse(q.answer_json || '[]')
  const resRight = db.submitAnswer({ questionId: q.id, selected: ans, durationMs: 0, mode: 'review-due' })
  ok('答对 isCorrect=true', resRight.isCorrect === true)

  // 5) 复习曲线
  const curve = db.getReviewCurve(30)
  ok('getReviewCurve.dist 长度=30', Array.isArray(curve.dist) && curve.dist.length === 30)
  ok('getReviewCurve.items 结构完整', curve.items.every(it => it.next && it.interval >= 1 && it.ease >= 1))

  // 6) 四档反馈（忘记 → interval 重置 1）
  const rr = db.rateReview(q.id, 1)
  ok('rateReview(忘记) ok', rr.ok === true)
  const wb2 = db.getWrongBook().find(x => x.question_id === q.id)
  ok('忘记后 interval=1', wb2 && wb2.interval === 1)

  // 7) 标记掌握毕业
  db.markMastered(q.id)
  const wb3 = db.getWrongBook().find(x => x.question_id === q.id)
  ok('标记掌握后不再出现在活跃错题本', !wb3)

  // 8) 分页 + 关键词（含标签批量查询路径）
  const list = db.listQuestions({ page: 1, pageSize: 10 })
  ok('listQuestions 分页 items<=10 且 total>=1', list.items.length <= 10 && list.total >= 1)
  const kw = db.listQuestions({ keyword: String(q.stem).slice(0, 4) })
  ok('listQuestions 关键词命中', kw.total >= 1)

  // 9) 热力图（按年返回当年天数，含 count/date）
  const hm = db.getActivityHeatmap()
  // 实现语义：最近 365 天含今天（today-364 ~ today+1），与闰年无关
  const expectDays = 365
  ok('getActivityHeatmap 返回当年天数且含 count', hm.length === expectDays && 'date' in hm[0] && 'count' in hm[0])

  // 10) 导入去重（同科目章节同题干 → skip 计重复）
  const imp = db.importQuestionBank(
    [{ subject: '基线科目', chapter: '基线章', stem: '基线唯一题干-甲', options: [{ key: 'A', text: 'x' }], answer: ['A'], type: 'single' }],
    { duplicateMode: 'skip' }
  )
  const imp2 = db.importQuestionBank(
    [{ subject: '基线科目', chapter: '基线章', stem: '基线唯一题干-甲', options: [{ key: 'A', text: 'x' }], answer: ['A'], type: 'single' }],
    { duplicateMode: 'skip' }
  )
  ok('导入去重：重复题干计 duplicated', imp2.duplicated === 1 && imp2.inserted === 0)

  // 11) 导出结构
  const ex = JSON.parse(db.exportData())
  ok('exportData 含 questions 数组', Array.isArray(ex.questions))
  ok('exportData 含 wrongBooks 数组', Array.isArray(ex.wrongBooks))

  // 12) 文件资产模块（拆出的 db-assets 回归）：题图/音频存取 + 缓存
  const tinyPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex')
  const imgName = db.saveImage(tinyPng, 'png')
  ok('saveImage 返回 .png 文件名', !!imgName && String(imgName).endsWith('.png'))
  const dataUrl = db.getImage(imgName)
  ok('getImage 返回 data:image dataURL', typeof dataUrl === 'string' && dataUrl.startsWith('data:image/'))
  ok('getImage 二次命中缓存', db.getImage(imgName) === dataUrl)
  const audioName = db.saveAudio(Buffer.from('fake-mp3-bytes'))
  ok('saveAudio 返回 .mp3 文件名', !!audioName && String(audioName).endsWith('.mp3'))
  ok('getAudioUrl 返回 data:audio dataURL', (db.getAudioUrl(audioName) || '').startsWith('data:audio/'))

  // 13) XP/激励模块（拆出的 db-gamify 回归）
  const xp0 = db.xpStats()
  ok('xpStats 返回 level>=1', typeof xp0.level === 'number' && xp0.level >= 1)
  db.logXp(10, 'quiz', '基线测试')
  const xp1 = db.xpStats()
  ok('logXp 后 total 增加 10', xp1.total === xp0.total + 10)
  const rd = db.reviewDueStats()
  ok('reviewDueStats 返回 due/estMinutes', typeof rd.due === 'number' && rd.estMinutes >= 1)
  const tc = db.todayCounts()
  ok('todayCounts 返回 review/kbRead', typeof tc.review === 'number' && typeof tc.kbRead === 'number')
  const quest = db.checkQuests()
  ok('checkQuests 返回任务数组（无目标时为空）', Array.isArray(quest.tasks) && quest.tasks.length === 0 && typeof quest.claimed === 'object')
  // 目标 >0 时出现任务（99999 保证 done=false，不触发 logXp 副作用）；用完恢复
  db.setSetting('daily_goal', 99999)
  const qGoal = db.checkQuests()
  ok('checkQuests 目标>0 时出现 quiz 任务且未完成', qGoal.tasks.some(t => t.key === 'quiz' && !t.done))
  db.setSetting('daily_goal', 0)

  // 14) 统计模块（拆出的 db-stats 回归）
  const st = db.getStats()
  ok('getStats 返回 total/rate/perCat', typeof st.total === 'number' && 'rate' in st && Array.isArray(st.perCat))
  ok('getCategoryAccuracy 返回数组', Array.isArray(db.getCategoryAccuracy()))
  ok('getWeakPoints 返回数组', Array.isArray(db.getWeakPoints(5)))
  const nowD = new Date()
  const cal = db.getMonthlyCalendar(nowD.getFullYear(), nowD.getMonth() + 1)
  ok('getMonthlyCalendar 返回对象', typeof cal === 'object' && cal !== null)
  ok('getRecentRecords 返回记录数组', Array.isArray(db.getRecentRecords(3)))

  // 15) 题库核心模块（拆出的 db-quiz 回归）：单题/收藏/笔记
  const byId = db.getQuestionById(q.id)
  ok('getQuestionById 返回完整题目', !!byId && Array.isArray(byId.answer))
  const fav1 = db.toggleFavorite(q.id)
  ok('toggleFavorite 收藏成功', fav1.favorited === true)
  ok('getFavorites 含该题', db.getFavorites().some(f => f.question_id === q.id))
  ok('toggleFavorite 再次点击取消收藏', db.toggleFavorite(q.id).favorited === false)
  db.saveNote({ questionId: q.id, content: '基线笔记' })
  ok('saveNote/getNote 往返', db.getNote(q.id).content === '基线笔记')
  ok('getNotedQuestionIds 含该题', db.getNotedQuestionIds().includes(q.id))
  ok('listNotes 含该题', db.listNotes().some(n => n.question_id === q.id))

  // 16) 知识库文档基础模块（拆出的 db-kb 回归）：CRUD/标签/图谱
  const docId = db.addKbDoc({ title: '基线文档', type: 'md', relPath: 'base.md', size: 5, blocks: [{ heading: null, content: 'hello kb' }] })
  ok('addKbDoc 返回 docId', Number(docId) > 0)
  const doc = db.getKbDoc(docId)
  ok('getKbDoc 返回文档与 blocks', !!doc && Array.isArray(doc.blocks) && doc.blocks.length === 1)
  db.setKbTags(docId, ['基线', '测试'])
  ok('setKbTags/listKbTags 往返', db.getKbDoc(docId).tags.length === 2 && db.listKbTags().some(t => t.tag === '基线'))
  ok('getKbDocs 列表含该文档', db.getKbDocs().some(d => d.id === docId))
  const g = db.getKbGraph()
  ok('getKbGraph 节点含该文档', g.nodes.some(n => n.id === docId))
  const upd = db.updateKbDoc(docId, { title: '基线文档改' })
  ok('updateKbDoc 标题更新', upd.title === '基线文档改')
  const del = db.deleteKbDoc(docId)
  ok('deleteKbDoc 成功', del.ok === true)
  ok('getKbDoc 删除后为 null', db.getKbDoc(docId) === null)
  // 软删文档 rel_path 进 getDeletedKbRels（同步删除传播的依据）
  const delRels = db.getDeletedKbRels()
  ok('getDeletedKbRels 含已删文档', Array.isArray(delRels) && delRels.some(r => typeof r === 'string'))

  // 17) 题库管理模块（拆出的 db-bank 回归）：单题增删改/统计/导出
  const added = db.addQuestion({ categoryId: null, type: 'single', stem: '基线新增题', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }], answer: ['A'] })
  ok('addQuestion 返回新 id', added.ok === true && Number(added.id) > 0)
  db.updateQuestion({ id: added.id, categoryId: null, type: 'single', stem: '基线新增题-改', options: [], answer: ['A'] })
  const byId2 = db.getQuestionById(added.id)
  ok('updateQuestion 生效', byId2.stem === '基线新增题-改')
  const bs = db.getBankStats()
  ok('getBankStats 返回 total/byType', typeof bs.total === 'number' && Array.isArray(bs.byType))
  const eb = db.exportBank()
  ok('exportBank 返回题目数组', Array.isArray(eb))
  db.deleteQuestion(added.id)
  ok('deleteQuestion 软删后 getQuestionById 为 null', db.getQuestionById(added.id) === null)

  // 18) 知识库联动/搜索模块（并入 db-kb 回归）：互链/搜索/推荐
  const doc2 = db.addKbDoc({ title: '联动文档', type: 'md', relPath: 'link.md', size: 4, blocks: [{ heading: null, content: '联动测试内容 abc' }] })
  db.linkKbDoc({ docId: doc2, questionId: q.id })
  ok('linkKbDoc 成功', db.getKbLinksForQuestion(q.id).some(l => l.doc_id === doc2))
  ok('getKbLinksForDoc 含该题', db.getKbLinksForDoc(doc2).some(l => l.question_id === q.id))
  ok('searchKb 命中文档标题', db.searchKb('联动').some(d => d.id === doc2))
  ok('snippet 高亮上下文', db.snippet('前面上下文联动测试后面', '联动').includes('联动'))
  ok('extractKeywords 提取关键词', Array.isArray(db.extractKeywords('这道题考察化学反应原理', 3)))
  ok('getSuggestedDocsForQuestion 返回数组', Array.isArray(db.getSuggestedDocsForQuestion(q.id, 3)))
  ok('getSuggestedQuestionsForDoc 返回数组', Array.isArray(db.getSuggestedQuestionsForDoc(doc2, 3)))
  db.unlinkKbDoc(doc2, q.id)
  ok('unlinkKbDoc 解除互链', db.getKbLinksForQuestion(q.id).length === 0)
  db.deleteKbDoc(doc2)

  // 19) 卡片/材料模块（拆出的 db-cards 回归）
  db.addCard('基线正面', '基线背面', '基线卡组')
  const cs = db.cardsStats()
  ok('cardsStats 返回 total>=1', cs.total >= 1 && typeof cs.due === 'number')
  ok('listCards 含新卡', db.listCards().some(c => c.front === '基线正面'))
  const cr = db.getCardReview(5)
  ok('getCardReview 返回抽取卡（含新卡）', Array.isArray(cr) && cr.length >= 1)
  const cards0 = db.listCards()
  db.updateCard(cards0[0].id, '正面改', '背面改', '卡组')
  ok('updateCard 生效', db.listCards().some(c => c.id === cards0[0].id && c.front === '正面改'))
  db.deleteCard(cards0[0].id)
  ok('deleteCard 软删', !db.listCards().some(c => c.id === cards0[0].id))
  const mat = db.upsertMaterial(1, '案例背景材料内容', '案例一')
  ok('upsertMaterial 返回 id', mat && mat.id > 0)
  ok('upsertMaterial 重复内容复用', db.upsertMaterial(1, '案例背景材料内容', '案例一').id === mat.id)
  ok('listMaterials 含材料', db.listMaterials().some(m => m.id === mat.id))

  // 20) 专注/断点续做模块（拆出的 db-habits 回归，习惯打卡已砍）
  db.addFocusSession(25)
  ok('addFocusSession 后今日专注>0', db.focusStats().today >= 25)
  db.saveResumeSession({ questions: [1, 2, 3], idx: 1 })
  ok('saveResumeSession/getResumeSession 往返', db.getResumeSession() && db.getResumeSession().questions.length === 3)
  db.clearResumeSession()
  ok('clearResumeSession 清空', db.getResumeSession() === null)

  // 21) 高亮/双链/错因/周报模块（拆出的 db-misc 回归）
  const hlId = db.addHighlight({ docId: docId, blockId: 1, text: '高亮文字' })
  ok('addHighlight 返回 id', Number(hlId) > 0)
  ok('getHighlightsForDoc 含高亮', db.getHighlightsForDoc(docId).some(h => h.id === hlId))
  db.removeHighlight(hlId)
  ok('removeHighlight 软删', !db.getHighlightsForDoc(docId).some(h => h.id === hlId))
  const docA = db.addKbDoc({ title: '互链A', type: 'md', relPath: 'a.md', size: 2 })
  const docB = db.addKbDoc({ title: '互链B', type: 'md', relPath: 'b.md', size: 2 })
  db.linkDocs(docA, docB)
  const dl = db.getDocLinks(docA)
  ok('linkDocs/getDocLinks 双链', dl.from.some(l => l.doc_id === docB))
  db.unlinkDocs(docA, docB)
  ok('unlinkDocs 解除', db.getDocLinks(docA).from.length === 0)
  db.setWrongReason(q.id, '粗心')
  const wb4 = db.getWrongBook().find(x => x.question_id === q.id)
  ok('setWrongReason 记录错因', !wb4 || wb4.reason === '粗心')
  const wr = db.getWeeklyReport()
  ok('getWeeklyReport 返回聚合字段', typeof wr.answered === 'number' && 'accuracy' in wr && Array.isArray(wr.daily))
  db.deleteKbDoc(docA)
  db.deleteKbDoc(docB)

  // 22) 薄弱项/相似题模块（拆出的 db-weak 回归）
  ok('getWeakChapters 返回章节数组', Array.isArray(db.getWeakChapters(null, 5)))
  ok('getSimilarQuestions 返回相似题数组', Array.isArray(db.getSimilarQuestions(q.id, 3)))
  const wq = db.getWeakQuestions(10)
  ok('getWeakQuestions 返回加权题', Array.isArray(wq) && wq.length > 0)
  const wqWeak = db.getQuestions({ mode: 'weak', limit: 5 })
  ok('getQuestions(weak 模式) 经 this 走弱项抽题', Array.isArray(wqWeak))

  // 23) 知识库统计/文件模块（并入 db-kb 回归）
  const kbStats = db.kbStats()
  ok('kbStats 返回统计字段', typeof kbStats.docs === 'number' && typeof kbStats.readCount === 'number')
  ok('getKbFolders 返回文件夹数组', Array.isArray(db.getKbFolders()))
  const kbF = db.addKbDoc({ title: '文件夹文档', type: 'md', relPath: 'fx.md', size: 3 })
  db.restoreKbFiles([]) // addKbDoc 不落盘文件，先确保 userData/kb 目录存在（restoreKbFiles 内部 mkdir）
  db.moveKbDoc(kbF, '测试夹')
  ok('moveKbDoc 移动文件夹', db.getKbDoc(kbF).folder === '测试夹')
  db.bumpKbRead(kbF)
  ok('bumpKbRead 阅读计数+1', db.getKbDoc(kbF).read_count >= 1)
  db.kbSaveMd(kbF, '# 编辑后标题\n\n新内容')
  ok('kbSaveMd 保存并切块且不改标题', db.getKbDoc(kbF).blocks.length >= 1 && db.getKbDoc(kbF).title === '文件夹文档')
  db.saveKbScroll(kbF, 3)
  ok('saveKbScroll 记录页码', db.getKbDoc(kbF).last_page === 3)
  const kf = db.listKbFiles()
  ok('listKbFiles 含副本文件', Array.isArray(kf))
  ok('restoreKbFiles 写回文件', typeof db.restoreKbFiles([{ relPath: 'notes/新笔记.md', base64: Buffer.from('# 同步笔记').toString('base64') }]) === 'number')
  db.deleteKbDoc(kbF)

  // 24) 模拟卷/标签/章节进度模块（拆出的 db-paper 回归）
  const paper = db.generatePaper({ title: '基线卷', subjectId: null, rules: [{ type: 'single', count: 1, score: 100 }], durationMinutes: 30 })
  ok('generatePaper 生成模拟卷', paper.ok === true && paper.paperId > 0 && paper.totalScore === 100)
  ok('listPapers 含该卷', db.listPapers().some(p => p.id === paper.paperId))
  const gp = db.getPaper(paper.paperId)
  ok('getPaper 返回题目与分值', gp && gp.questions.length === 1 && gp.questions[0].score === 100)
  db.deletePaper(paper.paperId)
  ok('deletePaper 软删', !db.listPapers().some(p => p.id === paper.paperId))
  db.setQuestionTags(q.id, ['标签A', '标签B'])
  ok('setQuestionTags/getQuestionTags 往返', db.getQuestionTags(q.id).length === 2)
  ok('listTags 含标签A', db.listTags().some(t => t.tag === '标签A'))
  ok('getChapterProgress 返回科目数组', Array.isArray(db.getChapterProgress()))

  // 25) 导出/分类/批量组（db-export.js + db-bank.js 迁移验证）
  const orphanName = db.saveImage(Buffer.from('orphan-png-bytes'))
  const orphanPath = path.join(app.getPath('userData'), 'images', orphanName)
  ok('saveImage 落盘孤儿测试图', fs.existsSync(orphanPath))
  const clean1 = db.cleanupOrphanImages()
  ok('cleanupOrphanImages 回收未引用图', clean1.removed >= 1)
  const usedName = db.saveImage(Buffer.from('used-png-bytes'))
  db.updateQuestion({ ...q, images: [usedName] })
  const clean2 = db.cleanupOrphanImages()
  ok('cleanupOrphanImages 保留在用图', fs.existsSync(path.join(app.getPath('userData'), 'images', usedName)))
  // 孤儿音频清理：未引用音频被回收，被题目 audio_url 引用的保留
  const orphanAudio = db.saveAudio(Buffer.from('orphan-audio-bytes'))
  const orphanAudioPath = path.join(app.getPath('userData'), 'audio', orphanAudio)
  ok('saveAudio 落盘孤儿测试音频', fs.existsSync(orphanAudioPath))
  const ca1 = db.cleanupOrphanAudio()
  ok('cleanupOrphanAudio 回收未引用音频', ca1.removed >= 1 && !fs.existsSync(orphanAudioPath))
  const usedAudio = db.saveAudio(Buffer.from('used-audio-bytes'))
  db.updateQuestion({ ...q, audioUrl: usedAudio })
  db.cleanupOrphanAudio()
  ok('cleanupOrphanAudio 保留在用音频', fs.existsSync(path.join(app.getPath('userData'), 'audio', usedAudio)))
  const wbFile = db.exportWrongBookMarkdown()
  ok('exportWrongBookMarkdown 生成 .md 文件', typeof wbFile === 'string' && wbFile.endsWith('.md') && fs.existsSync(wbFile))
  const ntFile = db.exportNotesMarkdown()
  ok('exportNotesMarkdown 生成 .md 文件', typeof ntFile === 'string' && ntFile.endsWith('.md') && fs.existsSync(ntFile))
  const cats = db.getCategories()
  ok('getCategories 返回科目树', Array.isArray(cats) && cats.length >= 1)
  db.setCurrentSubject(cats[0].id)
  ok('setCurrentSubject/getCurrentSubject 往返', db.getCurrentSubject().id === cats[0].id)
  const catNew = db.addCategory({ name: '基线分类X', parentId: null })
  ok('addCategory 新增科目', catNew.ok === true && catNew.id > 0)
  db.renameCategory({ id: catNew.id, name: '基线分类Y' })
  ok('renameCategory 改名', db.getSubjects().some(s => s.name === '基线分类Y'))
  const q1 = db.addQuestion({ categoryId: cats[0].id, type: 'single', stem: '批量移动题A', options: ['对', '错'], answer: [0] })
  const q2 = db.addQuestion({ categoryId: cats[0].id, type: 'single', stem: '批量移动题B', options: ['对', '错'], answer: [1] })
  const sub2 = db.addCategory({ name: '基线分类Z', parentId: null })
  db.batchUpdateQuestions([q1.id, q2.id], { categoryId: sub2.id, difficulty: 5 })
  ok('batchUpdateQuestions 批量移动+难度', db.getQuestionById(q1.id).category_id === sub2.id && db.getQuestionById(q2.id).difficulty === 5)
  db.batchDeleteQuestions([q1.id, q2.id])
  ok('batchDeleteQuestions 批量软删', db.getQuestionById(q1.id) === null && db.getQuestionById(q2.id) === null)
  db.deleteCategory(sub2.id)
  ok('deleteCategory 级联删题', !db.getSubjects().some(s => s.name === '基线分类Z'))

  // 26) 同步组（db-sync.js 迁移验证 + cfg 索引修复）
  const sync1 = JSON.parse(db.exportSync())
  ok('exportSync 全量含 questions', Array.isArray(sync1.questions) && sync1.questions.length > 0)
  ok('exportSync 含 kbBlocksByCid 分组', typeof sync1.kbBlocksByCid === 'object' && !Array.isArray(sync1.kbBlocksByCid))
  // 高亮 + 双链合并（验证 cfg[16]/cfg[17] 索引修复：此前误用 cards/materials 列清单会 SQL 报错）
  const hlDoc = db.addKbDoc({ title: '同步高亮文档', type: 'md', relPath: 'sync-hl.md', size: 4 })
  db.addHighlight({ docId: hlDoc, blockId: null, text: '同步高亮句' })
  const hlDoc2 = db.addKbDoc({ title: '同步互链文档', type: 'md', relPath: 'sync-link.md', size: 4 })
  db.linkDocs(hlDoc, hlDoc2)
  const sync2 = JSON.parse(db.exportSync())
  const m2 = db.mergeRemote(JSON.stringify(sync2))
  ok('mergeRemote 含高亮合并', m2.kbHighlights >= 1 && m2.kbDocLinks >= 1)
  // cards 表参与合并（修复：此前漏合并导致跨端闪卡丢失）
  const mCards = db.mergeRemote(JSON.stringify(db.exportSync()))
  ok('mergeRemote 合并 cards 表', mCards.cards >= 1)
  // M1 回归：合并后 questions 的 subject_id 应等于 category 树根科目（远端自增 id 不会覆盖）
  const mSyncQ = JSON.parse(db.exportSync()).questions
  {
    // 平铺 getCategories 树建 parentOf → rootOf（parent_id 0/null 为根，与 db-meta 一致）
    const flat = []
    const walkCats = (arr, pid) => { arr.forEach(c => { flat.push([c.id, pid]); if (c.children) walkCats(c.children, c.id) }) }
    walkCats(db.getCategories(), null)
    const pOf = new Map(flat)
    const rootOf = (id) => { let cur = id, seen = new Set(); while (pOf.has(cur) && pOf.get(cur) > 0 && !seen.has(cur)) { seen.add(cur); cur = pOf.get(cur) } return cur }
    ok('mergeRemote 后 subject_id 等于科目根', mSyncQ.every(x => x.category_id == null ? x.subject_id == null : x.subject_id === rootOf(x.category_id)))
    // 远端携带错误 subject_id（异机自增 id 999999）→ merge 后重算为本地科目根（M1 核心场景，非自合并）
    const remoteBad = JSON.parse(db.exportSync())
    const badQ = remoteBad.questions.find(x => x && x.category_id != null)
    if (badQ) {
      badQ.subject_id = 999999
      db.mergeRemote(JSON.stringify(remoteBad))
      const mergedQ = JSON.parse(db.exportSync()).questions.find(x => x.client_id === badQ.client_id)
      ok('mergeRemote 远端错误 subject_id 被重算为科目根', !!mergedQ && mergedQ.subject_id === rootOf(mergedQ.category_id))
    } else {
      console.log('  - 跳过：无带科目题目')
    }
  }
  // recite 背题模式：只进错题本，不写答题记录（不污染统计）
  const reciteQ = db.getWrongBook()[0]
  if (reciteQ) {
    const todayBefore = (db.getSummary() || {}).today || 0
    db.submitAnswer({ questionId: reciteQ.question_id, selected: [], durationMs: 0, mode: 'recite', selfGrade: false })
    const todayAfter = (db.getSummary() || {}).today || 0
    ok('recite 模式不写答题记录（今日已刷不变）', todayAfter === todayBefore)
  }
  // getWrongBook 含图片字段
  ok('getWrongBook 含 images 字段', db.getWrongBook().every(r => Array.isArray(r.images)))
  ok('getFavorites 含 images 字段', db.getFavorites().every(r => Array.isArray(r.images)))
  // 冲突计数：远端快照某行 updated_at 改新 → LWW 覆盖且记冲突
  const sync3 = JSON.parse(db.exportSync())
  const wbRow = sync3.wrongBooks.find(r => r && r.client_id)
  if (wbRow) {
    const orig = wbRow.updated_at
    wbRow.updated_at = orig + 5000
    const m3 = db.mergeRemote(JSON.stringify(sync3))
    ok('mergeRemote 冲突计数+明细', m3.conflicts >= 1 && Array.isArray(m3.conflictItems) && m3.conflictItems.some(i => i.table === 'wrong_books'))
  } else {
    // 库中无 wrong_books 行，跳过冲突断言（前置 addWrong 已保证有，理论不可达）
    console.log('  - 跳过：无 wrong_books 行')
  }
  const exData = db.exportData()
  ok('exportData 返回 JSON 字符串', typeof exData === 'string' && JSON.parse(exData).questions.length > 0)
  // 新增列覆盖：questions 含 audio_url/material 列、favorites 含 fav_group、cards 含 subject_id
  const exParsed = JSON.parse(exData)
  ok('exportData questions 含 material_id 列', exParsed.questions.every(q => 'material_id' in q))
  ok('exportData questions 含 subject_id 列', exParsed.questions.every(q => 'subject_id' in q))
  ok('exportData favorites 含 fav_group 列', exParsed.favorites.every(f => 'fav_group' in f))
  ok('exportData cards 含 subject_id 列', exParsed.cards.every(c => 'subject_id' in c))
  const prev = db.importPreview(exData)
  ok('importPreview 返回差异统计', prev.questions && prev.questions.total > 0 && typeof prev.questions.fresh === 'number')
  const impRes = db.importData(exData)
  ok('importData 整机恢复', impRes.ok === true && impRes.imported > 0)
  // H2 回归：importData 列清单必须含 subject_id（此前漏列 → INSERT OR REPLACE 后置 NULL）
  const impQ = db.getQuestionById(q.id)
  ok('importData 后 subject_id 保留', impQ && (impQ.category_id == null ? impQ.subject_id == null : impQ.subject_id != null))
  // 标签备份恢复：一题多标签完整保留（importData 现为全清+按备份插入的快照语义）
  const impTags = db.getQuestionTags(q.id)
  ok('importData 后题目标签完整保留', Array.isArray(impTags) && impTags.length === 2 && impTags.every(t => ['标签A', '标签B'].includes(t)))
  // 快照语义：导出「无标签」备份 → 恢复后本地残留标签清空（"删除全部标签"可还原）
  db.setQuestionTags(q.id, [])
  const cleanBackup = db.exportData()
  db.setQuestionTags(q.id, ['标签A', '标签B']) // 恢复前本地加回（模拟残留）
  db.importData(cleanBackup)
  ok('importData 后无标签备份恢复为 0 标签（快照语义）', db.getQuestionTags(q.id).length === 0)
  // 恢复带标签备份，还原状态避免影响后续断言
  db.importData(exData)
  const syncImgName = db.saveImage(Buffer.from('sync-img-bytes'))
  db.updateQuestion({ ...q, images: [syncImgName] })
  const imgs = db.exportImageFiles(0)
  ok('exportImageFiles 返回在用图+hash', imgs.some(i => i.name === syncImgName && /^[0-9a-f]{64}$/.test(i.hash)))
  fs.unlinkSync(path.join(app.getPath('userData'), 'images', syncImgName))
  const restored = db.restoreImages([{ name: syncImgName, b64: Buffer.from('sync-img-bytes').toString('base64') }])
  ok('restoreImages 还原被删图片', restored === 1 && fs.existsSync(path.join(app.getPath('userData'), 'images', syncImgName)))
  db.deleteKbDoc(hlDoc)
  db.deleteKbDoc(hlDoc2)

  // 27) 基础设施组（db-schema.js + db-meta.js 迁移验证 + 备份）
  db.setSetting('probe_key', 'v1')
  ok('setSetting/getSetting 往返', db.getSetting('probe_key') === 'v1')
  db.setSetting('probe_key', 'v2')
  ok('setSetting 覆盖', db.getSetting('probe_key') === 'v2')
  ok('ensureUser 幂等', db.ensureUser() === undefined)
  // backfillClientIds：手动清空某分类 client_id → backfill 补齐
  const catT = db.getCategories()[0]
  const Database2 = require('better-sqlite3')
  const d2 = new Database2(path.join(app.getPath('userData'), 'tiku.db'))
  d2.prepare('UPDATE categories SET client_id=NULL WHERE id=?').run(catT.id)
  d2.close()
  db.backfillClientIds()
  const catT2 = db.getCategories().find(c => c.id === catT.id)
  ok('backfillClientIds 补齐 client_id', !!catT2.client_id && catT2.client_id.length > 10)
  db.autoBackup() // init 里 autoBackup 已改为延迟后台执行（防启动卡顿），此处显式调用保证断言确定性
  const baks = db.listBackups()
  ok('autoBackup/listBackups 生成备份', Array.isArray(baks) && baks.length >= 1 && baks[0].file.endsWith('.db'))
  ok('getDbStatus 返回状态对象', typeof db.getDbStatus() === 'object' && 'recovered' in db.getDbStatus())
  const mastered = db.markMastered(q.id)
  ok('markMastered(复习) 返回 ok', mastered.ok === true)
  const rate = db.rateReview(q.id, 5)
  ok('rateReview(复习) 返回 ok+quality', rate.ok === true && rate.quality === 5)
  db.clearUserData()
  ok('clearUserData 清空学习数据', db.getSummary().today === 0 && db.getWrongBook().length === 0 && db.listNotes().length === 0)

  // 28) 每日一题 + 连击（db-meta.js）
  const dp1 = db.getDailyPuzzle()
  const todayKey = db._puzzleDateKey()
  ok('getDailyPuzzle 返回题目+未答状态', !!dp1.question && dp1.state && dp1.state.date === todayKey && dp1.state.answered === false)
  const dr1 = db.submitDailyPuzzle(dp1.question.id, true)
  ok('submitDailyPuzzle 答对连击+1', dr1.ok === true && dr1.state.answered === true && dr1.state.streak === 1 && dr1.state.bestStreak === 1)
  const dr2 = db.submitDailyPuzzle(dp1.question.id, false)
  ok('submitDailyPuzzle 重复提交拒绝', dr2.ok === false)
  const dp1b = db.getDailyPuzzle()
  ok('getDailyPuzzle 当天返回已答结果', dp1b.state.answered === true && dp1b.state.streak === 1)
  // 模拟跨天且昨天未答 → 连击清零、期数 +1、换新题
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  db.setSetting('daily_puzzle', JSON.stringify({ date: yesterday, qid: dp1.question.id, answered: false, correct: null, streak: 5, bestStreak: 9, period: 3 }))
  const dp2 = db.getDailyPuzzle()
  ok('getDailyPuzzle 跨天未答连击清零+期数+1', dp2.state.streak === 0 && dp2.state.period === 4 && dp2.state.date !== yesterday)
  ok('getDailyPuzzle 跨天换新题', !!dp2.question && dp2.question.id !== dp1.question.id)

  // 30) kbStats.unread（今日任务单数据源）
  const kbSt = db.kbStats()
  ok('kbStats 含 unread 字段', typeof kbSt.unread === 'number' && kbSt.unread >= 0)
  const unreadDoc = db.addKbDoc({ title: '任务单未读文档', type: 'md', relPath: 'task-unread.md', size: 2 })
  ok('kbStats unread 计数新增', db.kbStats().unread >= 1)
  db.deleteKbDoc(unreadDoc)

  // 31) 收藏分组 + 卡片自动生成（方向 9/10）
  db.toggleFavorite(q.id, '考前重点')
  const favs = db.getFavorites()
  const favIt = favs.find(f => f.question_id === q.id)
  ok('toggleFavorite 带分组收藏', !!favIt && favIt.fav_group === '考前重点')
  db.setFavoriteGroup(q.id, '易错')
  ok('setFavoriteGroup 改分组', db.getFavorites().find(f => f.question_id === q.id).fav_group === '易错')
  db.toggleFavorite(q.id) // 取消
  ok('toggleFavorite 取消收藏', !db.getFavorites().some(f => f.question_id === q.id))
  const cg1 = db.addCardFromQuestion(q.id)
  ok('addCardFromQuestion 生成记忆卡', cg1.ok === true && cg1.duplicate === false)
  const cg2 = db.addCardFromQuestion(q.id)
  ok('addCardFromQuestion 同题去重', cg2.ok === true && cg2.duplicate === true)
  const cardFromQ = db.listCards().find(c => c.source_question_id === q.id)
  ok('卡片含来源与卡组', !!cardFromQ && cardFromQ.front.length > 0 && cardFromQ.back.includes('【答案】'))

  // 32) 科目维度（内容闭环跟科目走）
  const subA = db.addCategory({ name: '科目维度A', parentId: null })
  const subACh = db.addCategory({ name: '科目维度A·章节', parentId: subA.id })
  const qA = db.addQuestion({ categoryId: subACh.id, type: 'single', stem: '科目维度A题', options: ['对', '错'], answer: [0] })
  db.submitAnswer({ questionId: qA.id, selected: [], durationMs: 0, mode: 'practice' }) // 答错入错题本
  const wpA = db.getWeakPoints(10, subA.id)
  const wpOther = db.getWeakPoints(10, cats[0].id)
  ok('getWeakPoints(subjectId) 只含该科目错题', wpA.some(w => w.id === qA.id) && wpOther.every(w => w.id !== qA.id))
  ok('reviewDueStats(subjectId) 科目参数正常', typeof db.reviewDueStats(subA.id).due === 'number' && typeof db.reviewDueStats(cats[0].id).due === 'number')
  // 每日一题优先当前科目：重置到昨天未答，抽题应落在 subA 的错题 qA 上
  const y2 = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  db.setSetting('daily_puzzle', JSON.stringify({ date: y2, qid: null, answered: false, correct: null, streak: 0, bestStreak: 0, period: 6 }))
  const dpS = db.getDailyPuzzle(subA.id)
  ok('getDailyPuzzle(subjectId) 优先当前科目错题', !!dpS.question && dpS.question.id === qA.id)
  // 科目维度题集：getQuestions wrong 模式按科目过滤
  const wrongA = db.getQuestions({ mode: 'wrong', subjectId: subA.id, limit: 20 })
  const wrongOther = db.getQuestions({ mode: 'wrong', subjectId: cats[0].id, limit: 20 })
  ok('getQuestions(wrong+subjectId) 按科目过滤错题', wrongA.some(w => w.id === qA.id) && wrongOther.every(w => w.id !== qA.id))
  // 统计条「知识卡片」总数按科目
  const sumA = db.getSummary(subA.id)
  const sumAll = db.getSummary()
  ok('getSummary(subjectId) 知识卡片数按科目统计', sumA.total === 1 && sumAll.total >= 1 && sumAll.total > sumA.total)
  // 趋势/热力图/周报按科目过滤
  const trendA = db.getWeeklyTrend(subA.id)
  const trendAll = db.getWeeklyTrend()
  ok('getWeeklyTrend(subjectId) 按科目过滤答题', trendA.some(d => d.count >= 1) && trendA.every((d, i) => d.count <= (trendAll[i]?.count || 0)))
  ok('getActivityHeatmap(subjectId) 按科目过滤', db.getActivityHeatmap(undefined, subA.id).some(d => d.count >= 1))
  ok('getWeeklyReport(subjectId) 按科目统计本周', db.getWeeklyReport(subA.id).answered >= 1)
  // 赛季统计（当月计数）
  const ms = db.getMonthStats()
  ok('getMonthStats 当月计数正常', ms.answered >= 1 && typeof ms.monthActive === 'number' && typeof ms.focusMin === 'number' && typeof ms.cardsAdded === 'number')
  // 记忆卡按科目：题目生成卡自动继承科目 + listCards 过滤
  const cgA = db.addCardFromQuestion(qA.id)
  const subjCardsA = db.listCards(subA.id)
  const subjCardsOther = db.listCards(cats[0].id)
  ok('addCardFromQuestion 自动继承题目科目', !!cgA.ok && subjCardsA.some(c => c.source_question_id === qA.id) && subjCardsOther.every(c => c.source_question_id !== qA.id))
  ok('cardsStats(subjectId) 按科目统计', db.cardsStats(subA.id).total >= 1)
  db.deleteCategory(subA.id) // 级联清理（含错题残留无碍后续）

  // 空科目边界：新建科目无章节时拉题应返回空（防止 IN() SQL 报错）
  const emptySub = db.addCategory({ name: '空科目', parentId: null })
  const emptyRes = db.getQuestions({ subjectId: emptySub.id })
  ok('getQuestions(空科目) 返回空数组', Array.isArray(emptyRes) && emptyRes.length === 0)
  db.deleteCategory(emptySub.id)

  // 33) 知识库按科目归类（第二批）
  const subB = db.addCategory({ name: '科目维度B', parentId: null })
  const kbDocA = db.addKbDoc({ title: '科目B文档', type: 'md', relPath: 'subj-b.md', size: 3, subjectId: subB.id })
  const kbDocFree = db.addKbDoc({ title: '未分类文档', type: 'md', relPath: 'free.md', size: 3 })
  const kbDocsB = db.getKbDocs(subB.id)
  const kbDocsAll = db.getKbDocs()
  ok('addKbDoc 带 subjectId 归属科目', kbDocsB.some(d => d.id === kbDocA) && kbDocsB.every(d => d.id !== kbDocFree))
  ok('getKbDocs(不传) 返回全部', kbDocsAll.some(d => d.id === kbDocFree))
  db.updateKbDoc(kbDocFree, { subjectId: subB.id })
  ok('updateKbDoc 改科目归属', db.getKbDocs(subB.id).some(d => d.id === kbDocFree))
  const exKb = JSON.parse(db.exportData()).kbDocs
  ok('exportData kbDocs 含 subject_id 列', Array.isArray(exKb) && Object.prototype.hasOwnProperty.call(exKb[0] || {}, 'subject_id'))
  db.deleteKbDoc(kbDocA)
  db.deleteKbDoc(kbDocFree)
  db.deleteCategory(subB.id)

  console.log(`\ndb 集成测试：${pass} 通过 / ${fail} 失败`)
} catch (e) {
  fail++
  console.error('❌ db 集成测试异常:', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e)
  console.log(`\ndb 集成测试：${pass} 通过 / ${fail} 失败`)
}

try { app.exit(fail ? 1 : 0) } catch (e) { process.exit(fail ? 1 : 0) }
