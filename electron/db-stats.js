// 学习统计 / 趋势 / 成就指标模块。
// 从 db.js 拆出（拆分渐进一步）：依赖 sqlite，经 ctx 注入；this 互调（getSummary/kbStats/getSetting）在合并后指向 api。
module.exports = function statsModule(ctx) {
  const { sqlite, LOCAL_USER, uuid, descendantCategoryIds } = ctx

  return {
    getStats() {
      const overall = sqlite.prepare('SELECT COUNT(*) AS n, SUM(is_correct) AS c FROM answer_records WHERE user_id=? AND deleted=0').get(LOCAL_USER)
      const total = overall.n || 0
      const correct = overall.c || 0
      const rate = total ? Math.round((correct / total) * 100) : 0

      const perCat = sqlite.prepare(`SELECT cat.name AS cat, COUNT(*) AS n, SUM(ar.is_correct) AS c
        FROM answer_records ar
        JOIN questions q ON q.id=ar.question_id
        JOIN categories cat ON cat.id=q.category_id
        WHERE ar.user_id=? AND ar.deleted=0
        GROUP BY cat.id`).all(LOCAL_USER)
        .map(r => ({ ...r, rate: r.n ? Math.round(((r.c || 0) / r.n) * 100) : 0 }))

      const wrongCount = sqlite.prepare("SELECT COUNT(*) AS n FROM wrong_books WHERE user_id=? AND status='wrong' AND deleted=0").get(LOCAL_USER).n
      const favCount = sqlite.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id=? AND deleted=0').get(LOCAL_USER).n

      return { total, correct, rate, wrongCount, favCount, perCat }
    },

    // 薄弱点 TopN：错题本中 wrong_count 最高、且临近复习的题目（精准定位该补的短板）
    getWeakPoints(limit = 5, subjectId) {
      let sql = `
        SELECT q.id, q.stem, q.category_id, c.name AS cat,
               wb.wrong_count, wb.reviewed_count, wb.ease, wb.interval, wb.next_review_at
        FROM wrong_books wb
        JOIN questions q ON q.id = wb.question_id
        LEFT JOIN categories c ON c.id = q.category_id
        WHERE wb.user_id = ? AND wb.status = 'wrong' AND wb.deleted = 0 AND q.deleted = 0`
      const params = [LOCAL_USER]
      if (subjectId) {
        const ids = descendantCategoryIds(subjectId)
        if (!ids.length) return []
        sql += ' AND q.category_id IN (' + ids.map(() => '?').join(',') + ')'
        params.push(...ids)
      }
      sql += ' ORDER BY wb.wrong_count DESC, wb.next_review_at ASC LIMIT ?'
      params.push(limit)
      const rows = sqlite.prepare(sql).all(...params)
      return rows.map(r => ({
        ...r,
        stem: (r.stem || '').replace(/\s+/g, ' ').slice(0, 60)
      }))
    },

    // 全科目正确率排行（用于薄弱章节对比）：返回 [{cat, n, c, rate}] 按正确率升序
    getCategoryAccuracy(subjectId) {
      let sql = `SELECT cat.name AS cat, COUNT(*) AS n, SUM(ar.is_correct) AS c
        FROM answer_records ar
        JOIN questions q ON q.id=ar.question_id
        JOIN categories cat ON cat.id=q.category_id
        WHERE ar.user_id=? AND ar.deleted=0 AND cat.level=2`
      const params = [LOCAL_USER]
      if (subjectId) {
        const ids = descendantCategoryIds(subjectId)
        if (!ids.length) return []
        sql += ' AND cat.id IN (' + ids.map(() => '?').join(',') + ')'
        params.push(...ids)
      }
      sql += ' GROUP BY cat.id'
      const rows = sqlite.prepare(sql).all(...params)
      return rows
        .map(r => ({ cat: r.cat, n: r.n, c: r.c || 0, rate: r.n ? Math.round((r.c || 0) / r.n * 100) : 0 }))
        .sort((a, b) => a.rate - b.rate)
    },

    // 游戏化成就所需的全部原始指标（成就定义在前端，按阈值派生「已解锁」状态）
    getAchievements() {
      const s = this.getSummary()
      const totalAnswered = sqlite.prepare('SELECT COUNT(*) AS n FROM answer_records WHERE user_id=? AND deleted=0').get(LOCAL_USER).n
      const correctCount = sqlite.prepare('SELECT COUNT(*) AS n FROM answer_records WHERE user_id=? AND deleted=0 AND is_correct=1').get(LOCAL_USER).n
      const essayCount = sqlite.prepare(
        "SELECT COUNT(*) AS n FROM answer_records ar JOIN questions q ON q.id=ar.question_id WHERE ar.user_id=? AND ar.deleted=0 AND q.type='essay'"
      ).get(LOCAL_USER).n
      const papersCount = sqlite.prepare('SELECT COUNT(*) AS n FROM papers WHERE deleted=0').get().n
      const notesCount = sqlite.prepare("SELECT COUNT(*) AS n FROM notes WHERE user_id=? AND deleted=0 AND TRIM(IFNULL(content,''))<>''").get(LOCAL_USER).n
      const tagsUsed = sqlite.prepare('SELECT COUNT(DISTINCT tag) AS n FROM question_tags').get().n
      const favCount = sqlite.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id=? AND deleted=0').get(LOCAL_USER).n
      const kb = this.kbStats()
      return {
        streak: s.streak, today: s.today, activeDays: s.activeDays,
        totalAnswered, mastered: s.mastered, wrongCount: s.wrongCount,
        correctCount, essayCount,
        papersCount, notesCount, tagsUsed, favCount,
        kbDocs: kb.docs, kbBlocks: kb.blocks, kbLinks: kb.links, kbReadCount: kb.readCount,
        dailyGoal: Number(this.getSetting('daily_goal') || 0)
      }
    },

    getSummary(subjectId) {
      // 内容/行为维度：传当前科目 → 题数/已学/掌握/今日/错题都按该科目过滤（首页科目视图）；不传 → 全局
      const scopeSql = (alias, cols = 'COUNT(*) AS n') => {
        if (!subjectId) return { sql: '', params: [] }
        const ids = descendantCategoryIds(subjectId)
        if (!ids.length) return { sql: ' AND 1=0', params: [] }
        return {
          sql: ` AND ${alias}.category_id IN (${ids.map(() => '?').join(',')})`,
          params: ids
        }
      }
      let total = 0
      if (subjectId) {
        const ids = descendantCategoryIds(subjectId)
        if (ids.length) {
          total = sqlite.prepare(`SELECT COUNT(*) AS n FROM questions WHERE deleted=0 AND category_id IN (${ids.map(() => '?').join(',')})`).get(...ids).n
        }
      } else {
        total = sqlite.prepare('SELECT COUNT(*) AS n FROM questions WHERE deleted=0').get().n
      }
      const sc = scopeSql('q')
      const learned = sqlite.prepare(`SELECT COUNT(DISTINCT ar.question_id) AS n FROM answer_records ar JOIN questions q ON q.id=ar.question_id WHERE ar.user_id=? AND ar.deleted=0 AND q.deleted=0${sc.sql}`).get(LOCAL_USER, ...sc.params).n
      const mastered = sqlite.prepare(`SELECT COUNT(DISTINCT ar.question_id) AS n FROM answer_records ar JOIN questions q ON q.id=ar.question_id WHERE ar.user_id=? AND ar.deleted=0 AND q.deleted=0 AND ar.is_correct=1${sc.sql}`).get(LOCAL_USER, ...sc.params).n
      const todayStart = new Date().setHours(0, 0, 0, 0)
      const today = sqlite.prepare(`SELECT COUNT(*) AS n FROM answer_records ar JOIN questions q ON q.id=ar.question_id WHERE ar.user_id=? AND ar.deleted=0 AND q.deleted=0 AND ar.created_at>=?${sc.sql}`).get(LOCAL_USER, todayStart, ...sc.params).n
      const wrongCount = sqlite.prepare(`SELECT COUNT(*) AS n FROM wrong_books wb JOIN questions q ON q.id=wb.question_id WHERE wb.user_id=? AND wb.status='wrong' AND wb.deleted=0 AND q.deleted=0${sc.sql}`).get(LOCAL_USER, ...sc.params).n

      const localDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const dayRows = sqlite.prepare("SELECT DISTINCT DATE(created_at/1000, 'unixepoch', 'localtime') AS day FROM answer_records WHERE user_id=? AND deleted=0").all(LOCAL_USER)
      const daySet = new Set(dayRows.map(r => r.day))
      const activeDays = daySet.size
      let streak = 0
      const cursor = new Date()
      cursor.setHours(0, 0, 0, 0)
      if (!daySet.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1)
      for (let i = 0; ; i++) {
        const d = new Date(cursor)
        d.setDate(cursor.getDate() - i)
        if (daySet.has(localDateKey(d))) streak++
        else break
      }

      // 正确率口径：真实答题（排除背题 recite / 卡片 card / 问答题自评 self_graded），带科目过滤
      const accSql = (ts) => `SELECT COUNT(*) AS n, SUM(CASE WHEN ar.is_correct=1 THEN 1 ELSE 0 END) AS c
        FROM answer_records ar JOIN questions q ON q.id=ar.question_id
        WHERE ar.user_id=? AND ar.deleted=0 AND q.deleted=0 AND ar.mode NOT IN ('recite','card') AND ar.self_graded=0
        AND ar.created_at>=?${sc.sql}`
      const accAll = sqlite.prepare(accSql(0)).get(LOCAL_USER, 0, ...sc.params)
      const accuracy = accAll.n ? Math.round((accAll.c / accAll.n) * 100) : 0
      // 本周/上周正确率对比（周一为周起点）
      const d0 = new Date()
      const dow = (d0.getDay() + 6) % 7
      const weekStart = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - dow).getTime()
      const weekAcc = sqlite.prepare(accSql(weekStart)).get(LOCAL_USER, weekStart, ...sc.params)
      const prevStart = weekStart - 7 * 86400000
      const prevAcc = sqlite.prepare(accSql(prevStart)).get(LOCAL_USER, prevStart, ...sc.params)
      const weekAccuracy = weekAcc.n ? Math.round((weekAcc.c / weekAcc.n) * 100) : 0
      const prevWeekAccuracy = prevAcc.n ? Math.round((prevAcc.c / prevAcc.n) * 100) : 0

      return { total, learned, mastered, today, wrongCount, activeDays, streak, accuracy, weekAccuracy, prevWeekAccuracy, weekDelta: weekAccuracy - prevWeekAccuracy }
    },

    getWeeklyTrend(subjectId) {
      const days = []
      const now = new Date()
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now)
        d.setDate(d.getDate() - i)
        d.setHours(0, 0, 0, 0)
        const start = d.getTime()
        const end = start + 24 * 60 * 60 * 1000
        let sql = 'SELECT COUNT(*) AS n FROM answer_records ar WHERE ar.user_id=? AND ar.deleted=0 AND ar.created_at>=? AND ar.created_at<?'
        const params = [LOCAL_USER, start, end]
        if (subjectId) {
          const ids = descendantCategoryIds(subjectId)
          if (!ids.length) { days.push({ date: d.toISOString().slice(0, 10), count: 0 }); continue }
          sql = 'SELECT COUNT(*) AS n FROM answer_records ar JOIN questions q ON q.id=ar.question_id WHERE ar.user_id=? AND ar.deleted=0 AND q.deleted=0 AND ar.created_at>=? AND ar.created_at<? AND q.category_id IN (' + ids.map(() => '?').join(',') + ')'
          params.push(...ids)
        }
        const row = sqlite.prepare(sql).get(...params)
        days.push({ date: d.toISOString().slice(0, 10), count: row.n || 0 })
      }
      return days
    },

    getMonthlyCalendar(year, month, subjectId) {
      const start = new Date(year, month - 1, 1).getTime()
      const end = new Date(year, month, 1).getTime()
      let sql = `SELECT DATE(ar.created_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS n
        FROM answer_records ar
        WHERE ar.user_id=? AND ar.deleted=0 AND ar.created_at>=? AND ar.created_at<?`
      const params = [LOCAL_USER, start, end]
      if (subjectId) {
        const ids = descendantCategoryIds(subjectId)
        if (!ids.length) return {}
        sql += ' AND ar.question_id IN (SELECT id FROM questions WHERE deleted=0 AND category_id IN (' + ids.map(() => '?').join(',') + '))'
        params.push(...ids)
      }
      sql += ' GROUP BY day'
      const rows = sqlite.prepare(sql).all(...params)
      const map = {}
      rows.forEach(r => { map[r.day] = r.n })
      return map
    },

    // 近 N 天每日答题量（学习日历热力图数据源）。返回 [{date:'YYYY-MM-DD', count, isToday}]，含今天。
    getActivityHeatmap(days = 120, subjectId) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const start = today.getTime() - (days - 1) * 86400000
      let aSql = `SELECT DATE(ar.created_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS n
        FROM answer_records ar WHERE ar.user_id=? AND ar.deleted=0 AND ar.created_at>=?`
      const aParams = [LOCAL_USER, start]
      if (subjectId) {
        const ids = descendantCategoryIds(subjectId)
        if (!ids.length) { return [] }
        aSql += ' AND ar.question_id IN (SELECT id FROM questions WHERE deleted=0 AND category_id IN (' + ids.map(() => '?').join(',') + '))'
        aParams.push(...ids)
      }
      aSql += ' GROUP BY day'
      const rows = sqlite.prepare(aSql).all(...aParams)
      const map = {}
      rows.forEach(r => { map[r.day] = r.n })
      const out = []
      for (let i = 0; i < days; i++) {
        const d = new Date(start + i * 86400000)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        out.push({ date: key, count: map[key] || 0, isToday: i === days - 1 })
      }
      return out
    },

    // 复习节奏（记忆曲线数据）：未来 N 天到期分布 + 在复习错题的逐题节奏
    getReviewCurve(days = 30) {
      const now = Date.now()
      const rows = sqlite.prepare(`SELECT id, question_id, next_review_at, ease, interval, reviewed_count, status
        FROM wrong_books WHERE user_id=? AND deleted=0 AND status='wrong' AND next_review_at>?`)
        .all(LOCAL_USER, now)
      const dayMs = 86400000
      const dist = []
      for (let i = 0; i < days; i++) {
        const s = now + i * dayMs
        const e = s + dayMs
        dist.push({ date: new Date(s).toISOString().slice(0, 10), count: rows.filter(r => r.next_review_at >= s && r.next_review_at < e).length })
      }
      const items = rows.map(r => ({
        questionId: r.question_id,
        next: new Date(r.next_review_at).toISOString().slice(0, 10),
        interval: r.interval,
        ease: Math.round(r.ease * 100) / 100,
        reviewed: r.reviewed_count
      })).sort((a, b) => a.next.localeCompare(b.next))
      return { dist, items }
    },

    getRecentRecords(limit = 5) {
      return sqlite.prepare(`SELECT ar.*, q.stem
        FROM answer_records ar JOIN questions q ON q.id=ar.question_id
        WHERE ar.user_id=? AND ar.deleted=0
        ORDER BY ar.created_at DESC LIMIT ?`).all(LOCAL_USER, limit)
    },

    // 赛季统计：当月各维度计数（赛季成就按月判定，次月 1 日自动重置进度）
    getMonthStats() {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      const answered = sqlite.prepare('SELECT COUNT(*) AS n FROM answer_records WHERE user_id=? AND deleted=0 AND created_at>=?').get(LOCAL_USER, monthStart).n
      const monthActive = sqlite.prepare("SELECT COUNT(DISTINCT DATE(created_at/1000,'unixepoch','localtime')) AS n FROM answer_records WHERE user_id=? AND deleted=0 AND created_at>=?").get(LOCAL_USER, monthStart).n
      const reviewed = sqlite.prepare('SELECT COUNT(*) AS n FROM review_logs WHERE created_at>=?').get(monthStart).n
      const focusMin = sqlite.prepare('SELECT COALESCE(SUM(minutes),0) AS n FROM focus_sessions WHERE deleted=0 AND created_at>=?').get(monthStart).n
      const cardsAdded = sqlite.prepare('SELECT COUNT(*) AS n FROM cards WHERE deleted=0 AND created_at>=?').get(monthStart).n
      return { answered, monthActive, reviewed, focusMin, cardsAdded }
    }
  }
}
