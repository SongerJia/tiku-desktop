// 专注番茄 / 断点续做模块（习惯打卡已砍：XP 通胀 + 与学习主线脱节；每日回顾已砍：并入智能复习体系）。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/LOCAL_USER/uuid；this 互调（setSetting/getSetting/logXp）合并后指向 api。
module.exports = function habitsModule(ctx) {
  const { sqlite, uuid } = ctx

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
    }
  }
}
