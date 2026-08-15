// 卡片记忆 + 材料题模块。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/uuid；this 互调（logXp）合并后指向 api。
module.exports = function cardsModule(ctx) {
  const { sqlite, uuid } = ctx

  return {
    addCard(front, back, category, subjectId = null, categoryId = null, phonetic = '', audioUrl = '') {
      const now = Date.now()
      sqlite.prepare('INSERT INTO cards (front, back, category, subject_id, category_id, phonetic, audio_url, created_at, updated_at, deleted, client_id) VALUES (?,?,?,?,?,?,?,?,?,0,?)')
        .run(String(front || '').trim(), String(back || '').trim(), String(category || '').trim(), subjectId || null, categoryId || null, String(phonetic || '').trim(), String(audioUrl || '').trim(), now, now, uuid())
      this.logXp(2, 'card', 'new')
      return { ok: true }
    },

    // 题目 category_id 向上找顶级科目 id（category 树的根）
    _rootSubjectOf(categoryId) {
      let id = categoryId
      let guard = 0
      while (id && guard++ < 10) {
        const row = sqlite.prepare('SELECT id, parent_id FROM categories WHERE id=? AND deleted=0').get(id)
        if (!row) break
        if (!row.parent_id) return row.id
        id = row.parent_id
      }
      return null
    },

    // 从题目一键生成记忆卡（方向 10）：正面=题干（截断），背面=答案+解析，卡组=章节名；同题去重；自动继承题目科目。
    addCardFromQuestion(questionId) {
      const q = this.getQuestionById(Number(questionId))
      if (!q) return { ok: false, error: '题目不存在' }
      const front = String(q.stem || '').trim().slice(0, 80)
      if (!front) return { ok: false, error: '题干为空' }
      const ans = Array.isArray(q.answer) && q.answer.length ? '【答案】' + q.answer.join('、') : ''
      const analysis = q.analysis ? '【解析】' + q.analysis : ''
      const back = [ans, analysis].filter(Boolean).join('\n') || '（无答案，自行补充）'
      let category = ''
      if (q.category_id) {
        const c = sqlite.prepare('SELECT name FROM categories WHERE id=?').get(q.category_id)
        if (c) category = c.name
      }
      const subjectId = q.category_id ? this._rootSubjectOf(q.category_id) : null
      const categoryId = q.category_id || null
      // 智能关联：同题已有卡 → 复用；否则按正面内容查重 → 有则关联题目出处（不新建），无则新建
      return this.addCardSmart({
        front, back, category, subjectId, categoryId,
        sourceQuestionId: q.id,
        sourceQuestionStem: String(q.stem || '').trim()
      })
    },

    // 智能转卡核心：按内容查重 → 已存在则关联出处（source_question_id/source_doc_id），不存在则新建。
    // opts: { front, back, category, subjectId, categoryId, phonetic, audioUrl, sourceQuestionId, sourceQuestionStem, sourceDocId, sourceDocTitle }
    // 返回 { ok, duplicate, cardId, matched: true } —— matched=true 表示命中已有卡（前端提示"已关联"）
    addCardSmart(opts = {}) {
      const now = Date.now()
      const front = String(opts.front || '').trim()
      if (!front) return { ok: false, error: '正面内容为空' }
      // 1) 同源去重（题目）：同一道题只允许一张卡
      if (opts.sourceQuestionId) {
        const dup = sqlite.prepare('SELECT id FROM cards WHERE source_question_id=? AND deleted=0').get(opts.sourceQuestionId)
        if (dup) return { ok: true, duplicate: true, cardId: dup.id, matched: true }
        // 软删复活
        const tomb = sqlite.prepare('SELECT id FROM cards WHERE source_question_id=? AND deleted=1 ORDER BY id DESC LIMIT 1').get(opts.sourceQuestionId)
        if (tomb) {
          sqlite.prepare('UPDATE cards SET deleted=0, updated_at=? WHERE id=?').run(now, tomb.id)
          return { ok: true, duplicate: true, cardId: tomb.id, matched: true }
        }
      }
      // 2) 内容查重（front 完全相等）：已有同内容的卡 → 关联出处（题目或文档），不新建
      const byFront = sqlite.prepare('SELECT id FROM cards WHERE front=? AND deleted=0 ORDER BY id ASC LIMIT 1').get(front)
      if (byFront) {
        const sets = []
        const params = []
        if (opts.sourceQuestionId) { sets.push('source_question_id=?'); params.push(opts.sourceQuestionId) }
        if (opts.sourceDocId) { sets.push('source_doc_id=?'); params.push(opts.sourceDocId) }
        if (sets.length) {
          params.push(now, byFront.id)
          sqlite.prepare(`UPDATE cards SET ${sets.join(',')}, updated_at=? WHERE id=?`).run(...params)
        }
        return { ok: true, duplicate: true, cardId: byFront.id, matched: true }
      }
      // 3) 新建
      const category = String(opts.category || '').trim()
      const phonetic = String(opts.phonetic || '').trim()
      const audioUrl = String(opts.audioUrl || '').trim()
      const back = String(opts.back || '').trim() || '（自行补充）'
      const info = sqlite.prepare(`INSERT INTO cards
        (front, back, category, subject_id, category_id, phonetic, audio_url, source_question_id, source_doc_id, created_at, updated_at, deleted, client_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)`)
        .run(front, back, category, opts.subjectId || null, opts.categoryId || null, phonetic, audioUrl,
          opts.sourceQuestionId || null, opts.sourceDocId || null, now, now, uuid())
      this.logXp(2, 'card', 'new')
      return { ok: true, duplicate: false, cardId: info.lastInsertRowid, matched: false }
    },

    // 从文档高亮转卡（E-2）：正面=高亮文本，背面=原文+文档标题；内容查重→关联文档出处或新建
    addCardFromHighlight(highlightId, extra = {}) {
      const h = sqlite.prepare('SELECT * FROM kb_highlights WHERE id=? AND deleted=0').get(highlightId)
      if (!h) return { ok: false, error: '高亮不存在' }
      const text = String(h.text || '').trim()
      if (!text) return { ok: false, error: '高亮内容为空' }
      const doc = sqlite.prepare('SELECT title, subject_id FROM kb_docs WHERE id=?').get(h.doc_id)
      const title = (doc && doc.title) || '知识库'
      const front = text.slice(0, 80)
      const back = ['【原文】' + text, '【来源】' + title].join('\n')
      return this.addCardSmart({
        front,
        back,
        category: title,
        subjectId: (doc && doc.subject_id) || null,
        phonetic: extra.phonetic || '',
        audioUrl: extra.audioUrl || '',
        sourceDocId: h.doc_id,
        sourceDocTitle: title
      })
    },

    // 记忆卡列表：支持 科目 / 章节 维度筛选（管理弹窗与首页共用）；返回章节名供展示
    listCards({ subjectId, categoryId } = {}) {
      const dueNow = Date.now()
      let where = 'c.deleted=0'
      const params = []
      if (subjectId) { where += ' AND c.subject_id=?'; params.push(subjectId) }
      if (categoryId) { where += ' AND c.category_id=?'; params.push(categoryId) }
      return sqlite.prepare(
        `SELECT c.*, cat.name AS category_name, (c.review_at IS NULL OR c.review_at<=?) AS due, c.review_lapses AS lapses
         FROM cards c LEFT JOIN categories cat ON cat.id=c.category_id
         WHERE ${where} ORDER BY c.created_at DESC`
      ).all(dueNow, ...params)
    },

    updateCard(id, front, back, category, subjectId, categoryId, phonetic, audioUrl) {
      sqlite.prepare('UPDATE cards SET front=?, back=?, category=?, subject_id=?, category_id=?, phonetic=?, audio_url=?, updated_at=? WHERE id=? AND deleted=0')
        .run(String(front || '').trim(), String(back || '').trim(), String(category || '').trim(), subjectId ?? null, categoryId ?? null, String(phonetic || '').trim(), String(audioUrl || '').trim(), Date.now(), id)
      return { ok: true }
    },

    deleteCard(id) {
      sqlite.prepare('UPDATE cards SET deleted=1, updated_at=? WHERE id=?').run(Date.now(), id)
      return { ok: true }
    },

    // 卡片复习评级：记住 → 3 天后见；忘记 → 1 天后见（缩短间隔重来），记 5 XP
    rateCard(cardId, felt) {
      const now = Date.now()
      const rc = sqlite.prepare('SELECT review_count FROM cards WHERE id=? AND deleted=0').get(cardId)
      if (!rc) return { ok: false, error: 'card not found' }
      const n = (rc.review_count || 0) + 1
      const interval = felt ? 3 : 1
      sqlite.prepare('UPDATE cards SET review_at=?, review_count=?, review_lapses=review_lapses+?, updated_at=? WHERE id=?')
        .run(now + interval * 86400000, n, felt ? 0 : 1, now, cardId)
      if (felt) this.logXp(5, 'card', 'review')
      return { ok: true }
    },

    // 单词卡复习抽取：到期卡优先（含新卡），最多 limit 张；subjectId 限定科目范围
    getCardReview(limit = 10, subjectId) {
      const now = Date.now()
      const where = subjectId ? ' AND subject_id=?' : ''
      const params = subjectId ? [subjectId] : []
      const due = sqlite.prepare(
        `SELECT * FROM cards WHERE deleted=0 AND review_count>0 AND (review_at IS NULL OR review_at<=?)${where}
         ORDER BY (review_lapses>0) DESC, review_at IS NULL DESC, review_at ASC LIMIT ?`
      ).all(now, ...params, limit)
      const pool = due.length < limit
        ? due.concat(sqlite.prepare(
            `SELECT * FROM cards WHERE deleted=0 AND review_count=0${where} ORDER BY RANDOM() LIMIT ?`
          ).all(...params, limit - due.length))
        : due
      return pool.map(c => ({ id: c.id, front: c.front, back: c.back, category: c.category, phonetic: c.phonetic || '', audio_url: c.audio_url || '' }))
    },

    cardsStats({ subjectId, categoryId } = {}) {
      const now = Date.now()
      let where = ''
      const params = []
      if (subjectId) { where += ' AND subject_id=?'; params.push(subjectId) }
      if (categoryId) { where += ' AND category_id=?'; params.push(categoryId) }
      const total = sqlite.prepare('SELECT COUNT(*) AS n FROM cards WHERE deleted=0' + where).get(...params).n
      const due = sqlite.prepare('SELECT COUNT(*) AS n FROM cards WHERE deleted=0 AND (review_at IS NULL OR review_at<=?)' + where).get(now, ...params).n
      return { total, due }
    },

    // ============ 材料题（案例题背景材料）============
    // 按 科目+内容 精确匹配复用；不存在则新建。返回材料 id（内容为空返回 null）
    upsertMaterial(subjectId, content, title = '') {
      const c = String(content || '').trim()
      if (!c) return null
      const ex = sqlite.prepare('SELECT id, client_id FROM materials WHERE deleted=0 AND subject_id=? AND content=?').get(subjectId, c)
      if (ex) return { id: ex.id, cid: ex.client_id }
      const now = Date.now()
      const cid = uuid()
      const info = sqlite.prepare('INSERT INTO materials (title, content, subject_id, created_at, updated_at, deleted, client_id) VALUES (?,?,?,?,?,0,?)')
        .run(String(title || '').trim(), c, subjectId, now, now, cid)
      return { id: info.lastInsertRowid, cid }
    },

    listMaterials() {
      return sqlite.prepare(
        `SELECT m.*, (SELECT COUNT(*) FROM questions q WHERE q.material_id=m.id AND q.deleted=0) AS qCount
         FROM materials m WHERE m.deleted=0 ORDER BY m.updated_at DESC`
      ).all()
    }
  }
}
