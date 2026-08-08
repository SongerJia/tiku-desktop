// 卡片记忆 + 材料题模块。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/uuid；this 互调（logXp）合并后指向 api。
module.exports = function cardsModule(ctx) {
  const { sqlite, uuid } = ctx

  return {
    addCard(front, back, category) {
      const now = Date.now()
      sqlite.prepare('INSERT INTO cards (front, back, category, created_at, updated_at, deleted, client_id) VALUES (?,?,?,?,?,0,?)')
        .run(String(front || '').trim(), String(back || '').trim(), String(category || '').trim(), now, now, uuid())
      this.logXp(2, 'card', 'new')
      return { ok: true }
    },

    // 从题目一键生成记忆卡（方向 10）：正面=题干（截断），背面=答案+解析，卡组=章节名；同题去重。
    addCardFromQuestion(questionId) {
      const q = this.getQuestionById(Number(questionId))
      if (!q) return { ok: false, error: '题目不存在' }
      const dup = sqlite.prepare('SELECT id FROM cards WHERE source_question_id=? AND deleted=0').get(q.id)
      if (dup) return { ok: true, duplicate: true, cardId: dup.id }
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
      const now = Date.now()
      sqlite.prepare('INSERT INTO cards (front, back, category, source_question_id, created_at, updated_at, deleted, client_id) VALUES (?,?,?,?,?,?,0,?)')
        .run(front, back, category, q.id, now, now, uuid())
      this.logXp(2, 'card', 'new')
      return { ok: true, duplicate: false, cardId: sqlite.prepare('SELECT last_insert_rowid() AS id').get().id }
    },

    listCards() {
      const dueNow = Date.now()
      return sqlite.prepare(
        `SELECT c.*, (c.review_at IS NULL OR c.review_at<=?) AS due, c.review_lapses AS lapses
         FROM cards c WHERE c.deleted=0 ORDER BY c.created_at DESC`
      ).all(dueNow)
    },

    updateCard(id, front, back, category) {
      sqlite.prepare('UPDATE cards SET front=?, back=?, category=?, updated_at=? WHERE id=? AND deleted=0')
        .run(String(front || '').trim(), String(back || '').trim(), String(category || '').trim(), Date.now(), id)
      return { ok: true }
    },

    deleteCard(id) {
      sqlite.prepare('UPDATE cards SET deleted=1, updated_at=? WHERE id=?').run(Date.now(), id)
      return { ok: true }
    },

    // 单词卡复习抽取：到期卡优先（含新卡），最多 limit 张
    getCardReview(limit = 10) {
      const now = Date.now()
      const due = sqlite.prepare(
        `SELECT * FROM cards WHERE deleted=0 AND review_count>0 AND (review_at IS NULL OR review_at<=?)
         ORDER BY (review_lapses>0) DESC, review_at IS NULL DESC, review_at ASC LIMIT ?`
      ).all(now, limit)
      const pool = due.length < limit
        ? due.concat(sqlite.prepare(
            `SELECT * FROM cards WHERE deleted=0 AND review_count=0 ORDER BY RANDOM() LIMIT ?`
          ).all(limit - due.length))
        : due
      return pool.map(c => ({ id: c.id, front: c.front, back: c.back, category: c.category }))
    },

    cardsStats() {
      const now = Date.now()
      const total = sqlite.prepare('SELECT COUNT(*) AS n FROM cards WHERE deleted=0').get().n
      const due = sqlite.prepare('SELECT COUNT(*) AS n FROM cards WHERE deleted=0 AND (review_at IS NULL OR review_at<=?)').get(now).n
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
