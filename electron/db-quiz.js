// 题库核心方法模块：取题 / 答题判分 / 错题本 / 收藏 / 笔记。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/LOCAL_USER/uuid + 两个依赖 sqlite 的私有函数；
// scheduleNextReview 来自 sm2；this 互调（logXp/getWeakQuestions）在合并后指向 api。
const { scheduleNextReview } = require('./sm2')

module.exports = function quizModule(ctx) {
  const { sqlite, LOCAL_USER, uuid, questionCid, descendantCategoryIds } = ctx

  return {
    getQuestionById(id) {
      const r = sqlite.prepare('SELECT * FROM questions WHERE id=? AND deleted=0').get(id)
      if (!r) return null
      return {
        ...r,
        options: JSON.parse(r.options_json || '[]'),
        answer: JSON.parse(r.answer_json || '[]'),
        keywords: r.keywords_json ? JSON.parse(r.keywords_json) : [],
        images: r.images_json ? JSON.parse(r.images_json) : [],
        tags: sqlite.prepare('SELECT tag FROM question_tags WHERE question_id=? ORDER BY tag').all(id).map(x => x.tag)
      }
    },

    getQuestions({ subjectId, categoryId, mode, limit, offset, keyword, tags } = {}) {
      // 弱点强化：按错题数/正确率加权返回最弱的题，不走普通筛选
      if (mode === 'weak') {
        return this.getWeakQuestions(limit ? Number(limit) : 30, subjectId, categoryId)
      }
      let sql = 'SELECT q.*, m.title AS material_title, m.content AS material_content FROM questions q LEFT JOIN materials m ON m.id=q.material_id WHERE q.deleted=0'
      const params = []
      if (categoryId) {
        sql += ' AND q.category_id=?'
        params.push(categoryId)
      } else if (subjectId) {
        const ids = descendantCategoryIds(subjectId)
        if (!ids.length) return []
        sql += ' AND q.category_id IN (' + ids.map(() => '?').join(',') + ')'
        params.push(...ids)
      }
      if (keyword) {
        sql += ' AND q.stem LIKE ?'
        params.push(`%${keyword}%`)
      }
      if (mode === 'wrong') {
        const ids = sqlite.prepare("SELECT question_id FROM wrong_books WHERE user_id=? AND status='wrong' AND deleted=0").all(LOCAL_USER).map(w => w.question_id)
        if (!ids.length) return []
        sql += ' AND q.id IN (' + ids.map(() => '?').join(',') + ')'
        params.push(...ids)
      } else if (mode === 'favorite') {
        const ids = sqlite.prepare('SELECT question_id FROM favorites WHERE user_id=? AND deleted=0').all(LOCAL_USER).map(f => f.question_id)
        if (!ids.length) return []
        sql += ' AND q.id IN (' + ids.map(() => '?').join(',') + ')'
        params.push(...ids)
      } else if (mode === 'unattempted') {
        sql += ' AND q.id NOT IN (SELECT question_id FROM answer_records WHERE user_id=? AND deleted=0)'
        params.push(LOCAL_USER)
      } else if (mode === 'review-due') {
        const ids = sqlite.prepare("SELECT question_id FROM wrong_books WHERE user_id=? AND status='wrong' AND deleted=0 AND (next_review_at IS NULL OR next_review_at<=?)")
          .all(LOCAL_USER, Date.now()).map(w => w.question_id)
        if (!ids.length) return []
        sql += ' AND q.id IN (' + ids.map(() => '?').join(',') + ')'
        params.push(...ids)
      }
      if (tags && tags.length) {
        // 按标签筛选：题目须带全部所选标签（AND 语义），通过 question_tags 子查询解析
        tags.forEach(t => {
          sql += ' AND q.id IN (SELECT question_id FROM question_tags WHERE tag=?)'
          params.push(t)
        })
      }
      sql += ' ORDER BY q.id ASC'
      if (limit) {
        sql += ' LIMIT ?'
        params.push(limit)
      }
      if (offset) {
        sql += ' OFFSET ?'
        params.push(offset)
      }
      const rows = sqlite.prepare(sql).all(...params)
      return rows.map(r => ({
        ...r,
        options: JSON.parse(r.options_json || '[]'),
        answer: JSON.parse(r.answer_json || '[]'),
        keywords: r.keywords_json ? JSON.parse(r.keywords_json) : [],
        images: r.images_json ? JSON.parse(r.images_json) : []
      }))
    },

    submitAnswer({ questionId, selected, durationMs, mode, selfGrade }) {
      const q = sqlite.prepare('SELECT * FROM questions WHERE id=?').get(questionId)
      if (!q) return { error: 'question not found' }

      const isEssay = q.type === 'essay'
      let correct
      if (isEssay) {
        correct = selfGrade === true
      } else {
        correct = JSON.stringify([...selected].sort()) === JSON.stringify([...JSON.parse(q.answer_json || '[]')].sort())
      }
      const now = Date.now()
      const qCid = q.client_id

      sqlite.prepare(`INSERT INTO answer_records
        (user_id, question_id, selected_json, is_correct, duration_ms, mode, self_graded, created_at, updated_at, client_id, question_cid)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(LOCAL_USER, questionId, JSON.stringify(selected), correct ? 1 : 0, durationMs || 0, mode || 'practice', isEssay ? 1 : 0, now, now, uuid(), qCid)

      sqlite.prepare('UPDATE users SET total_answered=total_answered+1, correct_count=correct_count+?, updated_at=? WHERE id=?')
        .run(correct ? 1 : 0, now, LOCAL_USER)

      // XP 埋点：答对 +10，答错 +2（事件行带 client_id，多端同步总量正确）
      this.logXp(correct ? 10 : 2, 'quiz', q.type)

      // 质量分：答错=2（失败，间隔重置）；答对=4（通过）；问答题按自评质量（1~5）。
      const quality = isEssay ? (correct ? 5 : 1) : (correct ? 4 : 2)
      if (!correct) {
        const sched = scheduleNextReview({ interval: 0, ease: 2.5 }, quality)
        sqlite.prepare(`INSERT INTO wrong_books (user_id, question_id, wrong_count, reviewed_count, status, next_review_at, ease, interval, updated_at, client_id, question_cid)
          VALUES (?,?,1,0,?,?,?,?,?,?,?)
          ON CONFLICT(user_id, question_id) DO UPDATE SET
            wrong_count=wrong_books.wrong_count+1,
            reviewed_count=0,
            status='wrong',
            next_review_at=excluded.next_review_at,
            ease=excluded.ease,
            interval=excluded.interval,
            updated_at=?`)
          .run(LOCAL_USER, questionId, 'wrong', sched.next, sched.ease, sched.interval, now, uuid(), qCid, now)
      } else {
        const wb = sqlite.prepare('SELECT id, reviewed_count, ease, interval FROM wrong_books WHERE user_id=? AND question_id=?').get(LOCAL_USER, questionId)
        if (wb) {
          const rc = (wb.reviewed_count || 0) + 1
          const graduated = rc >= 3
          const sched = scheduleNextReview({ interval: wb.interval || 0, ease: wb.ease || 2.5 }, quality)
          sqlite.prepare('UPDATE wrong_books SET reviewed_count=?, status=?, next_review_at=?, ease=?, interval=?, updated_at=? WHERE id=?')
            .run(rc, graduated ? 'mastered' : 'wrong', sched.next, sched.ease, sched.interval, now, wb.id)
        }
      }

      return {
        isCorrect: correct,
        analysis: q.analysis,
        answer: JSON.parse(q.answer_json || '[]'),
        options: JSON.parse(q.options_json || '[]'),
        keywords: q.keywords_json ? JSON.parse(q.keywords_json) : [],
        stem: q.stem,
        type: q.type,
        selfGraded: isEssay
      }
    },

    getWrongBook() {
      const rows = sqlite.prepare(`SELECT w.*, q.stem, q.type, q.options_json, q.answer_json, q.analysis
        FROM wrong_books w JOIN questions q ON q.id=w.question_id
        WHERE w.user_id=? AND w.status='wrong' AND w.deleted=0`).all(LOCAL_USER)
      return rows.map(r => ({
        ...r,
        options: JSON.parse(r.options_json),
        answer: JSON.parse(r.answer_json),
        images: r.images_json ? JSON.parse(r.images_json) : []
      }))
    },

    getFavorites() {
      const rows = sqlite.prepare(`SELECT f.*, q.stem, q.type, q.options_json, q.answer_json
        FROM favorites f JOIN questions q ON q.id=f.question_id
        WHERE f.user_id=? AND f.deleted=0`).all(LOCAL_USER)
      return rows.map(r => ({
        ...r,
        options: JSON.parse(r.options_json),
        answer: JSON.parse(r.answer_json),
        images: r.images_json ? JSON.parse(r.images_json) : []
      }))
    },

    toggleFavorite(questionId, group = '') {
      const ex = sqlite.prepare('SELECT id FROM favorites WHERE user_id=? AND question_id=? AND deleted=0').get(LOCAL_USER, questionId)
      if (ex) {
        sqlite.prepare('UPDATE favorites SET deleted=1, updated_at=? WHERE id=?').run(Date.now(), ex.id)
        return { favorited: false }
      }
      sqlite.prepare('INSERT INTO favorites (user_id, question_id, fav_group, created_at, updated_at, client_id, question_cid) VALUES (?,?,?,?,?,?,?)')
        .run(LOCAL_USER, questionId, String(group || '').trim(), Date.now(), Date.now(), uuid(), questionCid(questionId))
      return { favorited: true }
    },

    // 修改收藏分组（收藏面板分组管理）
    setFavoriteGroup(questionId, group) {
      sqlite.prepare('UPDATE favorites SET fav_group=?, updated_at=? WHERE user_id=? AND question_id=? AND deleted=0')
        .run(String(group || '').trim(), Date.now(), LOCAL_USER, questionId)
      return { ok: true }
    },

    // ============ 题目笔记 ============
    getNote(questionId) {
      const r = sqlite.prepare('SELECT content, updated_at FROM notes WHERE user_id=? AND question_id=? AND deleted=0')
        .get(LOCAL_USER, questionId)
      return r ? { content: r.content || '', updatedAt: r.updated_at } : { content: '', updatedAt: null }
    },

    saveNote({ questionId, content }) {
      const text = String(content == null ? '' : content).trim()
      const now = Date.now()
      if (!text) {
        sqlite.prepare('UPDATE notes SET content=?, deleted=1, updated_at=? WHERE user_id=? AND question_id=?')
          .run('', now, LOCAL_USER, questionId)
        return { ok: true, content: '', deleted: true }
      }
      sqlite.prepare(`INSERT INTO notes (user_id, question_id, content, created_at, updated_at, deleted, client_id, question_cid)
        VALUES (?,?,?,?,?,0,?,?)
        ON CONFLICT(user_id, question_id) DO UPDATE SET
          content=excluded.content,
          deleted=0,
          updated_at=excluded.updated_at`)
        .run(LOCAL_USER, questionId, text, now, now, uuid(), questionCid(questionId))
      return { ok: true, content: text, deleted: false }
    },

    listNotes() {
      return sqlite.prepare(`SELECT n.question_id, n.content, n.updated_at,
          q.stem, q.type, c.name AS category
        FROM notes n
        JOIN questions q ON q.id=n.question_id AND q.deleted=0
        LEFT JOIN categories c ON c.id=q.category_id
        WHERE n.user_id=? AND n.deleted=0 AND TRIM(IFNULL(n.content,''))<>''
        ORDER BY n.updated_at DESC`).all(LOCAL_USER)
    },

    getNotedQuestionIds() {
      return sqlite.prepare("SELECT question_id FROM notes WHERE user_id=? AND deleted=0 AND TRIM(IFNULL(content,''))<>''")
        .all(LOCAL_USER).map(r => r.question_id)
    },
  markMastered(questionId) {
    const q = sqlite.prepare('SELECT id, client_id FROM questions WHERE id=?').get(questionId)
    if (!q) return { error: 'question not found' }
    const now = Date.now()
    const qCid = q.client_id
    sqlite.prepare(`INSERT INTO answer_records
      (user_id, question_id, selected_json, is_correct, duration_ms, mode, self_graded, created_at, updated_at, client_id, question_cid)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(LOCAL_USER, questionId, '[]', 1, 0, 'master', 0, now, now, uuid(), qCid)
    const wb = sqlite.prepare('SELECT id FROM wrong_books WHERE user_id=? AND question_id=?').get(LOCAL_USER, questionId)
    const next = now + 365 * 86400000
    if (wb) {
      sqlite.prepare(`UPDATE wrong_books SET reviewed_count=3, status='mastered', next_review_at=?, ease=2.8, interval=365, updated_at=? WHERE id=?`)
        .run(next, now, wb.id)
    } else {
      sqlite.prepare(`INSERT INTO wrong_books (user_id, question_id, wrong_count, reviewed_count, status, next_review_at, ease, interval, updated_at, client_id, question_cid)
        VALUES (?,?,0,3,'mastered',?,?,?,?,?,?)`)
        .run(LOCAL_USER, questionId, next, 2.8, 365, now, uuid(), qCid)
    }
    return { ok: true }
  },

  // 四档复习反馈：忘记(1)/困难(3)/记得(4)/简单(5) → 按 SM-2 重新排期该题
  // quality<3 视为失败（重置间隔 + ease 降）；>=3 视为通过（间隔复利，连对 3 次毕业）
  rateReview(questionId, quality) {
    const q = sqlite.prepare('SELECT id, client_id FROM questions WHERE id=?').get(questionId)
    if (!q) return { error: 'question not found' }
    quality = Math.max(0, Math.min(5, Number(quality) == null ? 4 : quality))
    const now = Date.now()
    const qCid = q.client_id
    const wb = sqlite.prepare('SELECT id, reviewed_count, ease, interval FROM wrong_books WHERE user_id=? AND question_id=?').get(LOCAL_USER, questionId)
    if (quality < 3) {
      const sched = scheduleNextReview({ interval: wb ? (wb.interval || 0) : 0, ease: wb ? (wb.ease || 2.5) : 2.5 }, quality)
      if (wb) {
        sqlite.prepare(`UPDATE wrong_books SET reviewed_count=0, status='wrong', next_review_at=?, ease=?, interval=?, updated_at=? WHERE id=?`)
          .run(sched.next, sched.ease, sched.interval, now, wb.id)
      } else {
        sqlite.prepare(`INSERT INTO wrong_books (user_id, question_id, wrong_count, reviewed_count, status, next_review_at, ease, interval, updated_at, client_id, question_cid)
          VALUES (?,?,1,0,'wrong',?,?,?,?,?,?)`)
          .run(LOCAL_USER, questionId, sched.next, sched.ease, sched.interval, now, uuid(), qCid)
      }
    } else if (wb) {
      const rc = (wb.reviewed_count || 0) + 1
      const graduated = rc >= 3
      const sched = scheduleNextReview({ interval: wb.interval || 0, ease: wb.ease || 2.5 }, quality)
      sqlite.prepare('UPDATE wrong_books SET reviewed_count=?, status=?, next_review_at=?, ease=?, interval=?, updated_at=? WHERE id=?')
        .run(rc, graduated ? 'mastered' : 'wrong', sched.next, sched.ease, sched.interval, now, wb.id)
    }
    return { ok: true, quality }
  },
  }
}