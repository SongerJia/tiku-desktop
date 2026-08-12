// XP / 激励 / 每日任务 / 复习到期统计模块。
// 从 db.js 拆出（拆分渐进一步）：依赖 sqlite，经 ctx 注入；方法互调走 this（合并后 this=api）。
module.exports = function gamifyModule(ctx) {
  const { sqlite, LOCAL_USER, uuid, descendantCategoryIds } = ctx

  return {
    logXp(xp, source, note = '') {
      sqlite.prepare('INSERT INTO xp_logs (user_id, xp, source, note, created_at, deleted, client_id) VALUES (?,?,?,?,?,0,?)')
        .run(LOCAL_USER, Math.round(xp) || 0, source || '', note || '', Date.now(), uuid())
      return { ok: true }
    },

    // 等级 = floor(sqrt(总XP/100))+1，每级所需 XP 递增（100/300/600/1000…）
    xpStats() {
      const total = sqlite.prepare('SELECT COALESCE(SUM(xp),0) AS n FROM xp_logs WHERE deleted=0').get().n
      const todayStart = new Date().setHours(0, 0, 0, 0)
      const today = sqlite.prepare('SELECT COALESCE(SUM(xp),0) AS n FROM xp_logs WHERE deleted=0 AND created_at>=?').get(todayStart).n
      const d = new Date()
      const dow = (d.getDay() + 6) % 7 // 周一=0
      const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime()
      const week = sqlite.prepare('SELECT COALESCE(SUM(xp),0) AS n FROM xp_logs WHERE deleted=0 AND created_at>=?').get(weekStart).n
      const level = Math.floor(Math.sqrt(total / 100)) + 1
      const curLevelBase = 100 * (level - 1) * (level - 1)
      const nextLevelBase = 100 * level * level
      // 近 8 周排行（自己 vs 历史周）
      const weeks = sqlite.prepare(
        `SELECT strftime('%Y-%W', datetime(created_at/1000,'unixepoch','localtime')) AS wk, SUM(xp) AS n
         FROM xp_logs WHERE deleted=0 GROUP BY wk ORDER BY wk DESC LIMIT 8`
      ).all()
      return {
        total, today, week,
        level,
        curLevelXp: total - curLevelBase,
        nextLevelXp: nextLevelBase - curLevelBase,
        levelPct: Math.min(100, Math.round((total - curLevelBase) / Math.max(1, nextLevelBase - curLevelBase) * 100)),
        weeks: weeks.map(w => ({ wk: w.wk, xp: w.n }))
      }
    },

    // ---- 复习到期统计（智能复习入口提示）----
    reviewDueStats(subjectId) {
      // 支持按科目统计到期错题（内容闭环跟科目走）；不传则全局
      let sql = "SELECT COUNT(*) AS n FROM wrong_books wb JOIN questions q ON q.id=wb.question_id " +
        "WHERE wb.user_id=? AND wb.status='wrong' AND wb.deleted=0 AND q.deleted=0 " +
        "AND (wb.next_review_at IS NULL OR wb.next_review_at<=?)"
      const params = [LOCAL_USER, Date.now()]
      if (subjectId) {
        const ids = descendantCategoryIds(subjectId)
        if (!ids.length) return { due: 0, estMinutes: 1 }
        sql += ' AND q.category_id IN (' + ids.map(() => '?').join(',') + ')'
        params.push(...ids)
      }
      const due = sqlite.prepare(sql).get(...params).n
      return { due, estMinutes: Math.max(1, Math.ceil(due / 10)) } // 按 10 题/分钟估
    },

    // 今日行为计数（每日任务用）：今日复习次数（复习模式答题）、今日阅读次数；subjectId 可选按科目过滤
    todayCounts(subjectId) {
      const todayStart = new Date().setHours(0, 0, 0, 0)
      const scope = subjectId ? ` AND q.category_id IN (${descendantCategoryIds(subjectId).map(() => '?').join(',')})` : ''
      const scopeParams = subjectId ? descendantCategoryIds(subjectId) : []
      let review = 0
      if (!subjectId || scopeParams.length) {
        review = sqlite.prepare(
          `SELECT COUNT(*) AS n FROM answer_records ar JOIN questions q ON q.id=ar.question_id
           WHERE ar.user_id=? AND ar.deleted=0 AND q.deleted=0 AND ar.created_at>=? AND ar.mode IN ('review-due','wrong','favorite')${scope}`
        ).get(LOCAL_USER, todayStart, ...scopeParams).n
      }
      const kbRead = sqlite.prepare("SELECT COUNT(*) AS n FROM xp_logs WHERE deleted=0 AND created_at>=? AND source='kbread'").get(todayStart).n
      return { review, kbRead }
    },

    // 每日任务 Quest：按「学习目标」动态生成任务（未设置的目标不显示），达标且当天未领过 XP 的自动发放（+20/个）
    // subjectId 传当前科目 → 读该科目目标（daily_goal_{id} 优先，全局 daily_goal 兜底）；不传 → 全局
    checkQuests(subjectId) {
      const todayStart = new Date().setHours(0, 0, 0, 0)
      const has = (note) => sqlite.prepare(
        "SELECT COUNT(*) AS n FROM xp_logs WHERE deleted=0 AND created_at>=? AND source='quest' AND note=?"
      ).get(todayStart, note).n > 0
      const s = this.getSummary(subjectId)
      const tc = this.todayCounts(subjectId)
      const goalOf = (type) => {
        const scoped = subjectId ? this.getSetting(`${type}_${subjectId}`) : null
        const v = scoped != null ? scoped : this.getSetting(type)
        return Number(v || 0)
      }
      const dailyGoal = goalOf('daily_goal')
      const reviewGoal = goalOf('review_goal')
      const readGoal = goalOf('read_goal')
      const tasks = []
      if (dailyGoal > 0) tasks.push({ key: 'quiz', name: `刷 ${dailyGoal} 题`, note: `刷${dailyGoal}题`, done: s.today >= dailyGoal })
      if (reviewGoal > 0) tasks.push({ key: 'review', name: `复习 ${reviewGoal} 条`, note: `复习${reviewGoal}条`, done: tc.review >= reviewGoal })
      if (readGoal > 0) tasks.push({ key: 'read', name: `阅读 ${readGoal} 篇`, note: `阅读${readGoal}篇`, done: tc.kbRead >= readGoal })
      const claimed = []
      tasks.forEach(t => {
        if (t.done && !has(t.note)) {
          this.logXp(20, 'quest', t.note)
          claimed.push(t.name)
        }
      })
      return { tasks: tasks.map(t => ({ key: t.key, name: t.name, done: t.done })), claimed }
    }
  }
}
