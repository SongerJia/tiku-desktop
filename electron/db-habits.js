// 习惯打卡 / 专注番茄 / 每日回顾 / 断点续做模块。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/LOCAL_USER/uuid；this 互调（setSetting/getSetting/logXp/listHabits）合并后指向 api。
module.exports = function habitsModule(ctx) {
  const { sqlite, LOCAL_USER, uuid } = ctx

  return {
    // ---- 练习断点续做：退出练习时保存会话，下次可继续 ----
    saveResumeSession(payload) {
      this.setSetting('resume_session', JSON.stringify({ ...payload, savedAt: Date.now() }))
      return { ok: true }
    },
    getResumeSession() {
      try {
        const raw = this.getSetting('resume_session')
        if (!raw) return null
        const s = JSON.parse(raw)
        if (!s || !Array.isArray(s.questions) || !s.questions.length) return null
        return s
      } catch (e) { return null }
    },
    clearResumeSession() {
      this.setSetting('resume_session', '')
      return { ok: true }
    },

    // 每日回顾：到期错题（复用智能复习调度）+ 知识库随机块
    getDailyReview(limit = 8) {
      const due = sqlite.prepare(
        "SELECT w.question_id, w.next_review_at, q.stem, q.options_json, q.answer_json, q.analysis, q.type, c.name AS category_name FROM wrong_books w " +
        "JOIN questions q ON q.id=w.question_id LEFT JOIN categories c ON c.id=q.category_id WHERE w.user_id=? AND w.status='wrong' AND w.deleted=0 " +
        "AND (w.next_review_at IS NULL OR w.next_review_at<=?) " +
        "ORDER BY (w.wrong_count>=3) DESC, w.next_review_at IS NULL DESC, w.next_review_at ASC LIMIT ?"
      ).all(LOCAL_USER, Date.now(), Math.ceil(limit / 2))
      // 知识块：到期块优先（复习过且到期的先出），不够再随机补从未复习过的新块
      const blockLimit = Math.floor(limit / 2)
      const dueBlocks = sqlite.prepare(
        `SELECT b.id AS block_id, b.heading, b.content, d.id AS doc_id, d.title AS doc_title
         FROM kb_blocks b JOIN kb_docs d ON d.id=b.doc_id
         WHERE d.deleted=0 AND b.review_count>0 AND (b.review_at IS NULL OR b.review_at<=?)
         ORDER BY (b.review_lapses>0) DESC, b.review_at IS NULL DESC, b.review_at ASC LIMIT ?`
      ).all(Date.now(), blockLimit)
      const blocks = dueBlocks.length < blockLimit
        ? dueBlocks.concat(sqlite.prepare(
            `SELECT b.id AS block_id, b.heading, b.content, d.id AS doc_id, d.title AS doc_title
             FROM kb_blocks b JOIN kb_docs d ON d.id=b.doc_id
             WHERE d.deleted=0 AND b.review_count=0 ORDER BY RANDOM() LIMIT ?`
          ).all(blockLimit - dueBlocks.length))
        : dueBlocks
      return {
        questions: due.map(r => ({ questionId: r.question_id, stem: r.stem, type: r.type, options: JSON.parse(r.options_json || '[]'), answer: JSON.parse(r.answer_json || '[]'), analysis: r.analysis || '', categoryName: r.category_name || '' })),
        blocks: blocks.map(b => ({ blockId: b.block_id, docId: b.doc_id, docTitle: b.doc_title, heading: b.heading, content: b.content }))
      }
    },

    // 记录每日回顾结果（答对/想起来 = result 1）并给 XP
    logReview(itemType, itemId, result) {
      sqlite.prepare('INSERT INTO review_logs (item_type, item_id, result, created_at, client_id) VALUES (?,?,?,?,?)')
        .run(itemType, itemId, result ? 1 : 0, Date.now(), uuid())
      if (itemType === 'block' || itemType === 'card') {
        // 知识块/单词卡间隔调度：记住 → 3 天后见；忘记 → 1 天后见（缩短间隔重来）
        const table = itemType === 'card' ? 'cards' : 'kb_blocks'
        const now = Date.now()
        const rc = sqlite.prepare(`SELECT review_count FROM ${table} WHERE id=?`).get(itemId)
        const n = (rc && rc.review_count || 0) + 1
        const interval = result ? 3 : 1
        sqlite.prepare(`UPDATE ${table} SET review_at=?, review_count=?, review_lapses=review_lapses+? WHERE id=?`)
          .run(now + interval * 86400000, n, result ? 0 : 1, itemId)
      }
      if (result) this.logXp(5, 'review', itemType)
      return { ok: true }
    },

    // 专注番茄：完成一个 session 记分钟 + XP（2 XP/分钟）
    addFocusSession(minutes) {
      sqlite.prepare('INSERT INTO focus_sessions (minutes, started_at, created_at, deleted, client_id) VALUES (?,?,?,0,?)')
        .run(Math.max(1, Math.round(minutes)) || 25, Date.now(), Date.now(), uuid())
      this.logXp(Math.max(1, Math.round(minutes)) * 2, 'focus', minutes + 'min')
      return { ok: true }
    },

    focusStats() {
      const todayStart = new Date().setHours(0, 0, 0, 0)
      const today = sqlite.prepare('SELECT COALESCE(SUM(minutes),0) AS n FROM focus_sessions WHERE deleted=0 AND created_at>=?').get(todayStart).n
      const weekStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - ((new Date().getDay() + 6) % 7)).getTime()
      const week = sqlite.prepare('SELECT COALESCE(SUM(minutes),0) AS n FROM focus_sessions WHERE deleted=0 AND created_at>=?').get(weekStart).n
      return { today, week }
    },

    // ---- 习惯打卡（多目标）----
    listHabits() {
      const rows = sqlite.prepare('SELECT * FROM habits WHERE deleted=0 ORDER BY sort, id').all()
      const today = new Date().toISOString().slice(0, 10)
      const checkStmt = sqlite.prepare('SELECT check_date FROM habit_checks WHERE habit_id=? ORDER BY check_date DESC')
      const streakStmt = sqlite.prepare('SELECT check_date FROM habit_checks WHERE habit_id=?')
      return rows.map(h => {
        const dates = new Set(streakStmt.all(h.id).map(r => r.check_date))
        let streak = 0
        const d = new Date()
        while (dates.has(d.toISOString().slice(0, 10))) { streak++; d.setDate(d.getDate() - 1) }
        const week = []
        const w = new Date()
        for (let i = 6; i >= 0; i--) { const dt = new Date(w); dt.setDate(w.getDate() - i); week.push(dates.has(dt.toISOString().slice(0, 10))) }
        return { ...h, checkedToday: dates.has(today), streak, total: dates.size, week }
      })
    },

    addHabit(name, icon = '✅') {
      const now = Date.now()
      const info = sqlite.prepare('INSERT INTO habits (name, icon, sort, created_at, updated_at, deleted, client_id) VALUES (?,?,?,?,?,0,?)')
        .run(String(name || '').trim() || '新习惯', icon || '✅', 0, now, now, uuid())
      return info.lastInsertRowid
    },

    updateHabit(id, patch = {}) {
      const cur = sqlite.prepare('SELECT * FROM habits WHERE id=? AND deleted=0').get(id)
      if (!cur) return null
      sqlite.prepare('UPDATE habits SET name=?, icon=?, updated_at=? WHERE id=?')
        .run(patch.name ?? cur.name, patch.icon ?? cur.icon, Date.now(), id)
      return this.listHabits()
    },

    deleteHabit(id) {
      const tx = sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM habit_checks WHERE habit_id=?').run(id)
        sqlite.prepare('UPDATE habits SET deleted=1 WHERE id=?').run(id)
      })
      tx()
      return { ok: true }
    },

    checkHabit(habitId, dateStr) {
      const date = dateStr || new Date().toISOString().slice(0, 10)
      const info = sqlite.prepare('INSERT OR IGNORE INTO habit_checks (habit_id, check_date, created_at, client_id) VALUES (?,?,?,?)')
        .run(habitId, date, Date.now(), uuid())
      if (info.changes > 0) this.logXp(5, 'habit', 'check') // 当天首次打卡 +5 XP
      return { ok: true }
    },

    uncheckHabit(habitId, dateStr) {
      const date = dateStr || new Date().toISOString().slice(0, 10)
      sqlite.prepare('DELETE FROM habit_checks WHERE habit_id=? AND check_date=?').run(habitId, date)
      return { ok: true }
    }
  }
}
