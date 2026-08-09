// 模拟卷组卷 / 标签系统 / 章节进度模块。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/LOCAL_USER/uuid + descendantCategoryIds/questionCid 私有函数。
module.exports = function paperModule(ctx) {
  const { sqlite, LOCAL_USER, uuid, descendantCategoryIds, questionCid } = ctx

  return {
    // ============ 模拟卷组卷 ============
    // rules: [{ type, count, difficulty?, score? }]；按题型+可选难度从指定范围随机抽题，
    // 每题分值默认 100/总题数，rule.score 指定则用指定值。返回 paperId。
    generatePaper({ title, subjectId = null, chapterIds = [], rules = [], durationMinutes = 90 } = {}) {
      const now = Date.now()
      if (!rules || !rules.length) throw new Error('请至少设置一道题')
      const totalCount = rules.reduce((s, r) => s + (Number(r.count) || 0), 0)
      if (!totalCount) throw new Error('请至少设置一道题')

      let scopeIds = []
      if (Array.isArray(chapterIds) && chapterIds.length) scopeIds = chapterIds.map(Number)
      else if (subjectId) scopeIds = descendantCategoryIds(Number(subjectId))

      const picked = []
      for (const rule of rules) {
        const t = rule.type
        const cnt = Number(rule.count) || 0
        if (!cnt) continue
        let sql = 'SELECT id, type FROM questions WHERE deleted=0 AND type=?'
        const params = [t]
        if (scopeIds.length) {
          sql += ' AND category_id IN (' + scopeIds.map(() => '?').join(',') + ')'
          params.push(...scopeIds)
        }
        if (rule.difficulty) { sql += ' AND difficulty=?'; params.push(rule.difficulty) }
        const pool = sqlite.prepare(sql).all(...params)
        if (pool.length < cnt) throw new Error(`「${t}」题型题目不足：库内仅 ${pool.length} 道，需要 ${cnt} 道`)
        const shuffled = pool.slice()
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
        }
        picked.push(...shuffled.slice(0, cnt))
      }

      const insPaper = sqlite.prepare('INSERT INTO papers (user_id,title,subject_id,duration_minutes,total_score,rules_json,created_at,updated_at,deleted,client_id) VALUES (?,?,?,?,?,?,?,?,0,?)')
      const insPQ = sqlite.prepare('INSERT INTO paper_questions (paper_id,seq,question_id,score,client_id,question_cid) VALUES (?,?,?,?,?,?)')

      // 计分：手动分值优先；未设分值的题（自动题）均摊到剩余分值 (100 - 手动总分)。
      // 最后把四舍五入误差抹平到最后一个自动题，保证卷面总分恰好为整数/小数无漂移。
      const manualScoreOf = (rule) => (rule.score && rule.score > 0) ? Number(rule.score) : null
      let manualTotal = 0
      const perTypeManual = {}
      for (const r of rules) {
        const sc = manualScoreOf(r)
        if (sc != null) { perTypeManual[r.type] = sc; manualTotal += sc * (Number(r.count) || 0) }
      }
      // 手动分值超 100 校验（防卷面总分 > 100 且自动题 0 分）
      if (manualTotal > 100) throw new Error('手动分值合计超过 100 分，请调整后重试')
      const autoCount = rules.filter(r => manualScoreOf(r) == null).reduce((s, r) => s + (Number(r.count) || 0), 0)
      const autoTotal = Math.max(0, Math.round((100 - manualTotal) * 10) / 10)
      const autoEach = autoCount ? Math.round((autoTotal / autoCount) * 10) / 10 : 0

      const scores = picked.map(p => (perTypeManual[p.type] != null ? perTypeManual[p.type] : autoEach))
      const target = Math.round((manualTotal + autoTotal) * 10) / 10
      const sum0 = Math.round(scores.reduce((s, x) => s + x, 0) * 10) / 10
      // 抹平误差到「最后一个自动题」：按 perTypeManual 标记找（而非按值相等判断，避免手动题恰等于 autoEach 时误调）
      let lastAutoIdx = -1
      for (let i = picked.length - 1; i >= 0; i--) {
        if (perTypeManual[picked[i].type] == null) { lastAutoIdx = i; break }
      }
      if (lastAutoIdx >= 0) {
        scores[lastAutoIdx] = Math.round((scores[lastAutoIdx] + (target - sum0)) * 10) / 10
      }

      const tx = sqlite.transaction(() => {
        let totalScore = 0
        const info = insPaper.run(LOCAL_USER, String(title || `模拟卷 ${new Date().toLocaleString('zh-CN')}`).slice(0, 80), subjectId ? Number(subjectId) : null, Number(durationMinutes) || 90, 0, JSON.stringify(rules), now, now, uuid())
        const paperId = info.lastInsertRowid
        picked.forEach((p, i) => {
          const sc = scores[i]
          totalScore += sc
          insPQ.run(paperId, i + 1, p.id, sc, uuid(), questionCid(p.id))
        })
        sqlite.prepare('UPDATE papers SET total_score=? WHERE id=?').run(target, paperId)
        return { paperId, totalScore: target }
      })
      const { paperId, totalScore } = tx()
      return { ok: true, paperId, count: picked.length, totalScore }
    },

    listPapers() {
      return sqlite.prepare(`SELECT p.id, p.title, p.subject_id, p.duration_minutes, p.total_score, p.created_at,
        (SELECT name FROM categories WHERE id=p.subject_id) AS subject_name,
        (SELECT COUNT(*) FROM paper_questions WHERE paper_id=p.id AND deleted=0) AS qCount
        FROM papers p WHERE p.deleted=0 ORDER BY p.created_at DESC`).all()
    },

    getPaper(id) {
      const p = sqlite.prepare('SELECT * FROM papers WHERE id=? AND deleted=0').get(id)
      if (!p) return null
      const pqs = sqlite.prepare(`SELECT pq.seq, pq.score, pq.question_id,
        q.type, q.stem, q.options_json, q.answer_json, q.analysis, q.keywords_json, q.images_json, q.difficulty
        FROM paper_questions pq JOIN questions q ON q.id=pq.question_id
        WHERE pq.paper_id=? AND pq.deleted=0 ORDER BY pq.seq`).all(id)
      return {
        id: p.id, title: p.title, subjectId: p.subject_id, durationMinutes: p.duration_minutes,
        totalScore: p.total_score, createdAt: p.created_at, rules: JSON.parse(p.rules_json || '[]'),
        questions: pqs.map(r => ({
          seq: r.seq, score: r.score, questionId: r.question_id,
          type: r.type, stem: r.stem,
          options: JSON.parse(r.options_json || '[]'),
          answer: JSON.parse(r.answer_json || '[]'),
          analysis: r.analysis,
          keywords: r.keywords_json ? JSON.parse(r.keywords_json) : [],
          images: r.images_json ? JSON.parse(r.images_json) : []
        }))
      }
    },

    deletePaper(id) {
      const now = Date.now()
      sqlite.prepare('UPDATE papers SET deleted=1, updated_at=? WHERE id=?').run(now, id)
      sqlite.prepare('UPDATE paper_questions SET deleted=1 WHERE paper_id=?').run(id)
      return { ok: true }
    },

    // ============ 标签系统 ============
    // 轻量本地优先：question_tags(question_id, tag)。跨设备同步随题目行一并传播（见 exportSync/mergeRemote）。
    setQuestionTags(questionId, tags) {
      const clean = Array.from(new Set((tags || []).map(t => String(t).trim()).filter(Boolean))).slice(0, 20)
      const del = sqlite.prepare('DELETE FROM question_tags WHERE question_id=?')
      const ins = sqlite.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (?,?)')
      const tx = sqlite.transaction(() => {
        del.run(questionId)
        clean.forEach(t => ins.run(questionId, t))
      })
      tx()
      return { ok: true, tags: clean }
    },

    getQuestionTags(questionId) {
      return sqlite.prepare('SELECT tag FROM question_tags WHERE question_id=? ORDER BY tag').all(questionId).map(r => r.tag)
    },

    // 所有标签 + 各标签题数（用于筛选 chips / 输入建议）
    listTags() {
      return sqlite.prepare('SELECT tag, COUNT(*) AS n FROM question_tags GROUP BY tag ORDER BY n DESC, tag').all()
    },

    // ============ 章节进度（我的 → 章节进度）============
    getChapterProgress() {
      const subjects = sqlite.prepare('SELECT id, name FROM categories WHERE deleted=0 AND (parent_id IS NULL OR parent_id=0) ORDER BY sort, id').all()
      const out = []
      for (const sub of subjects) {
        const chapters = sqlite.prepare('SELECT id, name FROM categories WHERE deleted=0 AND parent_id=? ORDER BY sort, id').all(sub.id)
        const list = chapters.map(ch => {
          const totalQ = sqlite.prepare('SELECT COUNT(*) AS n FROM questions WHERE deleted=0 AND category_id=?').get(ch.id).n
          const learned = sqlite.prepare('SELECT COUNT(DISTINCT question_id) AS n FROM answer_records WHERE user_id=? AND deleted=0 AND question_id IN (SELECT id FROM questions WHERE category_id=?)').get(LOCAL_USER, ch.id).n
          const stat = sqlite.prepare('SELECT COUNT(*) AS n, SUM(is_correct) AS c FROM answer_records ar JOIN questions q ON q.id=ar.question_id WHERE ar.user_id=? AND ar.deleted=0 AND q.category_id=?').get(LOCAL_USER, ch.id)
          const n = stat.n || 0
          const mastered = sqlite.prepare('SELECT COUNT(DISTINCT question_id) AS n FROM answer_records WHERE user_id=? AND deleted=0 AND is_correct=1 AND question_id IN (SELECT id FROM questions WHERE category_id=?)').get(LOCAL_USER, ch.id).n
          const wrong = sqlite.prepare("SELECT COUNT(*) AS n FROM wrong_books WHERE user_id=? AND status='wrong' AND deleted=0 AND question_id IN (SELECT id FROM questions WHERE category_id=?)").get(LOCAL_USER, ch.id).n
          return { id: ch.id, name: ch.name, totalQ: totalQ || 0, learned: learned || 0, answered: n, rate: n ? Math.round(((stat.c || 0) / n) * 100) : 0, mastered: mastered || 0, wrong: wrong || 0 }
        })
        out.push({ subjectId: sub.id, subjectName: sub.name, chapters: list })
      }
      return out
    }
  }
}
