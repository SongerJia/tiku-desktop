// 元数据/初始化模块：backfillClientIds / ensureUser / seedIfEmpty / getSetting / setSetting / clearUserData。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/LOCAL_USER/uuid/sample。
module.exports = function metaModule(ctx) {
  const { sqlite, LOCAL_USER, uuid, sample, descendantCategoryIds } = ctx

  return {
  backfillClientIds() {
    const setCid = (table) => {
      const rows = sqlite.prepare(`SELECT id FROM ${table} WHERE client_id IS NULL OR client_id=''`).all()
      if (!rows.length) return
      const upd = sqlite.prepare(`UPDATE ${table} SET client_id=? WHERE id=?`)
      const tx = sqlite.transaction(() => rows.forEach(r => upd.run(uuid(), r.id)))
      tx()
    }
    ;['users', 'categories', 'questions', 'answer_records', 'wrong_books', 'favorites', 'notes', 'papers'].forEach(setCid)

    const fix = (table, fkCol, refTable, refCol) =>
      sqlite.prepare(`UPDATE ${table} SET ${fkCol}=(SELECT client_id FROM ${refTable} r WHERE r.id=${table}.${refCol})
                      WHERE ${fkCol} IS NULL AND ${refCol} IS NOT NULL`).run()
    fix('questions', 'category_cid', 'categories', 'category_id')
    fix('answer_records', 'question_cid', 'questions', 'question_id')
    fix('wrong_books', 'question_cid', 'questions', 'question_id')
    fix('favorites', 'question_cid', 'questions', 'question_id')
    fix('notes', 'question_cid', 'questions', 'question_id')
    fix('categories', 'parent_cid', 'categories', 'parent_id')

    // 科目归属回填：questions.subject_id 由 category 树向上推导到根科目（老库升级后列是 NULL，需补）
    // 幂等：只处理 IS NULL 的行；写入路径（导入/录题/移题）已同步维护该列
    const catRows = sqlite.prepare('SELECT id, parent_id FROM categories').all()
    const parentOf = new Map(catRows.map(r => [r.id, r.parent_id]))
    const rootOf = (id) => {
      let cur = id
      const seen = new Set()
      while (parentOf.has(cur) && parentOf.get(cur) != null && !seen.has(cur)) {
        seen.add(cur)
        cur = parentOf.get(cur)
      }
      return cur
    }
    const orphans = sqlite.prepare('SELECT id, category_id FROM questions WHERE subject_id IS NULL AND category_id IS NOT NULL').all()
    if (orphans.length) {
      const upd = sqlite.prepare('UPDATE questions SET subject_id=? WHERE id=?')
      const tx = sqlite.transaction(() => orphans.forEach(q => upd.run(rootOf(q.category_id), q.id)))
      tx()
    }
  },

  ensureUser() {
    const u = sqlite.prepare('SELECT id FROM users WHERE id=?').get(LOCAL_USER)
    if (!u) {
      sqlite.prepare('INSERT INTO users (id, name, created_at, updated_at, client_id) VALUES (?,?,?,?,?)')
        .run(LOCAL_USER, '本地用户', Date.now(), Date.now(), uuid())
    }
  },

  // 首次启动且题库为空时，灌入考证样例数据（二级建造师）。
  seedIfEmpty() {
    const count = sqlite.prepare('SELECT COUNT(*) AS n FROM categories').get().n
    if (count > 0) return
    const now = Date.now()
    const insC = sqlite.prepare('INSERT INTO categories (id,name,parent_id,level,stage,sort,updated_at,client_id) VALUES (?,?,?,?,?,?,?,?)')
    const insQ = sqlite.prepare('INSERT INTO questions (id,category_id,type,stem,options_json,answer_json,keywords_json,analysis,difficulty,source,updated_at,client_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    const tx = sqlite.transaction(() => {
      for (const c of sample.categories) {
        insC.run(c.id, c.name, c.parent_id ?? null, c.level, c.stage ?? null, c.sort ?? 0, now, uuid())
      }
      for (const q of sample.questions) {
        insQ.run(q.id, q.category_id, q.type, q.stem, JSON.stringify(q.options || []),
          JSON.stringify(q.answer || []), JSON.stringify(q.keywords || []),
          q.analysis, q.difficulty ?? 3, q.source ?? '样题', now, uuid())
      }
    })
    tx()
  },

  // 设置项（同步配置等轻量 KV）
  getSetting(key) {
    const r = sqlite.prepare('SELECT value FROM settings WHERE key=?').get(key)
    return r ? r.value : null
  },
  setSetting(key, value) {
    sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(key, String(value))
    return { ok: true }
  },

  // 返回两级分类树（科目 → 章节）
  // ---- 分类基础（科目/章节树 + 当前科目）已抽到 electron/db-bank.js（init 中合并）----

  // ---- 错题本/笔记导出 + 孤儿图片清理已抽到 electron/db-export.js（init 中合并）----

  // ---- 章节进度已抽到 electron/db-paper.js（init 中合并，此处于 2026-08-08 清除残留重复定义）----

  // ============ 题目批量操作 ============
  // patch: { categoryId, difficulty, addTags:[], setTags:[] }；软删兼容同步
  // ---- 题目批量操作已抽到 electron/db-bank.js（init 中合并）----

  // ---- 统计/趋势/成就方法已抽到 electron/db-stats.js（init 中合并）----,

  clearUserData() {
    sqlite.prepare('DELETE FROM answer_records WHERE user_id=?').run(LOCAL_USER)
    sqlite.prepare('DELETE FROM wrong_books WHERE user_id=?').run(LOCAL_USER)
    sqlite.prepare('DELETE FROM favorites WHERE user_id=?').run(LOCAL_USER)
    sqlite.prepare('DELETE FROM notes WHERE user_id=?').run(LOCAL_USER)
    sqlite.prepare('DELETE FROM xp_logs WHERE user_id=?').run(LOCAL_USER) // XP 根源（此前漏清，等级/累计 XP 残留）
    sqlite.prepare('DELETE FROM review_logs').run() // 复习轨迹日志（无 user_id 列）
    sqlite.prepare('DELETE FROM cards').run() // 记忆卡（学习数据，此前漏清）
    sqlite.prepare('DELETE FROM focus_sessions').run() // 番茄专注记录
    sqlite.prepare('DELETE FROM papers').run() // 模拟卷（学习数据，此前漏清）
    sqlite.prepare('DELETE FROM paper_questions').run()
    sqlite.prepare('DELETE FROM kb_highlights').run() // 文档高亮批注（学习反馈，此前漏清）
    sqlite.prepare('DELETE FROM kb_doc_links').run() // 文档双链
    sqlite.prepare('UPDATE users SET total_answered=0, correct_count=0, updated_at=? WHERE id=?').run(Date.now(), LOCAL_USER)
    // 每日一题连击/状态 + 断点续做：一并重置，避免旧状态与新学习数据混算
    sqlite.prepare("DELETE FROM settings WHERE key IN ('current_subject_id','daily_puzzle','resume_session')").run()
    return { ok: true }
  },

  // ============ 题库管理：录入 / 编辑 / 批量导入 ============

  // ---- 分类管理已抽到 electron/db-bank.js（init 中合并）----

  // ---- 题库管理方法（导入/列表/增删改/统计/导出）已抽到 electron/db-bank.js（init 中合并）----

  // ---- 同步/备份方法（导出/增量快照/图片/LWW 合并/导入恢复）已抽到 electron/db-sync.js（init 中合并）----

    // ============ 每日一题 + 连击（settings KV 存储，纯本地激励不进云同步） ============
    _puzzleDateKey() {
      const d = new Date()
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    },
    _puzzleRead() {
      try {
        const r = sqlite.prepare("SELECT value FROM settings WHERE key='daily_puzzle'").get()
        return r && r.value ? JSON.parse(r.value) : {}
      } catch (e) { return {} }
    },
    _puzzleSave(st) {
      sqlite.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('daily_puzzle',?)").run(JSON.stringify(st))
    },

    // 取今日题：当天已选过则返回原题（含已答结果）；跨天自动换新题，
    // 昨天未答则连击清零，期数 +1。选题优先近期错题，否则随机（全题型，主观题答完自评）。
    getDailyPuzzle(subjectId) {
      const today = this._puzzleDateKey()
      const st = this._puzzleRead()
      if (st.date === today && st.qid) {
        const q = this.getQuestionById(st.qid)
        if (q) { q.categoryName = this._puzzleCatName(q.category_id); return { question: q, state: st } }
        // 题被删了 → 重新选
      }
      if (st.date && !st.answered) st.streak = 0 // 昨天没答，连击清零
      const period = (st.period || 0) + 1
      const q = this._pickDailyQuestion(st.qid, subjectId)
      if (!q) return { question: null, state: { date: today, qid: null, answered: false, correct: null, streak: st.streak || 0, bestStreak: st.bestStreak || 0, period } }
      const ns = { date: today, qid: q.id, answered: false, correct: null, streak: st.streak || 0, bestStreak: st.bestStreak || 0, period, lastAnswerDate: st.lastAnswerDate || null }
      this._puzzleSave(ns)
      q.categoryName = this._puzzleCatName(q.category_id)
      return { question: q, state: ns }
    },

    // 提交今日作答：答对连击 +1（刷新最佳），答错不涨不清零；仅当天未答可提交。
    submitDailyPuzzle(questionId, correct) {
      const today = this._puzzleDateKey()
      const st = this._puzzleRead()
      if (!st.qid || String(st.qid) !== String(questionId)) return { ok: false, error: '不是今日题目' }
      if (st.answered) return { ok: false, error: '今日已作答' }
      st.answered = true
      st.correct = !!correct
      st.lastAnswerDate = today
      if (correct) {
        st.streak = (st.streak || 0) + 1
        st.bestStreak = Math.max(st.bestStreak || 0, st.streak)
      }
      this._puzzleSave(st)
      return { ok: true, state: st }
    },

    _pickDailyQuestion(excludeId, subjectId) {
      // 科目过滤片段：返回 { sql, params }
      const scopeSql = (alias) => {
        if (!subjectId) return { sql: '', params: [] }
        const ids = descendantCategoryIds(subjectId)
        if (!ids.length) return { sql: ' AND 1=0', params: [] }
        return { sql: ` AND ${alias}.category_id IN (${ids.map(() => '?').join(',')})`, params: ids }
      }
      // 1) 当前科目近期错题（主观题也合适，答完自评）
      let sql = "SELECT w.question_id FROM wrong_books w JOIN questions q ON q.id=w.question_id " +
        "WHERE w.user_id=? AND w.status='wrong' AND w.deleted=0 AND q.deleted=0"
      const params = [LOCAL_USER]
      const sc = scopeSql('q')
      sql += sc.sql
      params.push(...sc.params)
      sql += ' ORDER BY RANDOM() LIMIT 1'
      const wrong = sqlite.prepare(sql).get(...params)
      if (wrong) return sqlite.prepare('SELECT * FROM questions WHERE id=? AND deleted=0').get(wrong.question_id)
      // 2) 当前科目随机（排除当天已用）
      if (subjectId) {
        const ids = descendantCategoryIds(subjectId)
        if (ids.length) {
          let s2 = 'SELECT * FROM questions WHERE deleted=0 AND category_id IN (' + ids.map(() => '?').join(',') + ')'
          const p2 = [...ids]
          if (excludeId) { s2 += ' AND id<>?'; p2.push(excludeId) }
          s2 += ' ORDER BY RANDOM() LIMIT 1'
          const q2 = sqlite.prepare(s2).get(...p2)
          if (q2) return q2
        }
      }
      // 3) 全局回退（科目没题时）
      return excludeId
        ? sqlite.prepare('SELECT * FROM questions WHERE deleted=0 AND id<>? ORDER BY RANDOM() LIMIT 1').get(excludeId)
        : sqlite.prepare('SELECT * FROM questions WHERE deleted=0 ORDER BY RANDOM() LIMIT 1').get()
    },

    _puzzleCatName(categoryId) {
      if (!categoryId) return ''
      const r = sqlite.prepare('SELECT name FROM categories WHERE id=?').get(categoryId)
      return r ? r.name : ''
    }
  }
}
