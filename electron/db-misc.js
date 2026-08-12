// 高亮批注 / 文档双链 / 错题原因 / 学习周报 模块（杂项聚合）。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/LOCAL_USER/uuid；this 互调（getSummary/kbStats/xpStats）合并后指向 api。
module.exports = function miscModule(ctx) {
  const { sqlite, LOCAL_USER, uuid, descendantCategoryIds } = ctx

  return {
    getHighlightsForDoc(docId) {
      return sqlite.prepare('SELECT * FROM kb_highlights WHERE doc_id=? AND deleted=0 ORDER BY created_at DESC').all(docId)
    },

    addHighlight({ docId, blockId = null, text = '', note = '', color = 'yellow' }) {
      const now = Date.now()
      const info = sqlite.prepare('INSERT INTO kb_highlights (doc_id, block_id, text, note, color, created_at, updated_at, deleted, client_id) VALUES (?,?,?,?,?,?,?,0,?)')
        .run(docId, blockId, String(text || '').slice(0, 500), note || '', color || 'yellow', now, now, uuid())
      return info.lastInsertRowid
    },

    removeHighlight(id) {
      sqlite.prepare('UPDATE kb_highlights SET deleted=1 WHERE id=?').run(id)
      return { ok: true }
    },

    // ---- 文档 ↔ 文档 双链 ----
    getDocLinks(docId) {
      const out = { from: [], to: [] }
      const a = sqlite.prepare('SELECT l.to_doc_id AS doc_id, l.note, d.title FROM kb_doc_links l JOIN kb_docs d ON d.id=l.to_doc_id WHERE l.from_doc_id=? AND d.deleted=0').all(docId)
      const b = sqlite.prepare('SELECT l.from_doc_id AS doc_id, l.note, d.title FROM kb_doc_links l JOIN kb_docs d ON d.id=l.from_doc_id WHERE l.to_doc_id=? AND d.deleted=0').all(docId)
      out.from = a
      out.to = b
      return out
    },

    linkDocs(fromDocId, toDocId) {
      sqlite.prepare('INSERT OR IGNORE INTO kb_doc_links (from_doc_id, to_doc_id, note, created_at, client_id) VALUES (?,?,?,?,?)')
        .run(fromDocId, toDocId, '', Date.now(), uuid())
      return { ok: true }
    },

    unlinkDocs(fromDocId, toDocId) {
      sqlite.prepare('DELETE FROM kb_doc_links WHERE (from_doc_id=? AND to_doc_id=?) OR (from_doc_id=? AND to_doc_id=?)')
        .run(fromDocId, toDocId, toDocId, fromDocId)
      return { ok: true }
    },

    // ---- 错题原因标签 ----
    setWrongReason(questionId, reason) {
      sqlite.prepare("UPDATE wrong_books SET reason=?, updated_at=? WHERE user_id=? AND question_id=? AND deleted=0")
        .run(String(reason || '').trim(), Date.now(), LOCAL_USER, questionId)
      return { ok: true }
    },

    // ---- 学习周报（聚合近 7 天，前端拼 HTML 导出 PDF）----
    getWeeklyReport(subjectId) {
      const now = new Date()
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime()
      let qSql = 'SELECT COUNT(*) AS n, COALESCE(SUM(ar.is_correct),0) AS c FROM answer_records ar WHERE ar.user_id=? AND ar.deleted=0 AND ar.created_at>=?'
      const qParams = [LOCAL_USER, weekStart]
      if (subjectId) {
        const ids = descendantCategoryIds(subjectId)
        if (ids.length) {
          qSql = 'SELECT COUNT(*) AS n, COALESCE(SUM(ar.is_correct),0) AS c FROM answer_records ar JOIN questions q ON q.id=ar.question_id WHERE ar.user_id=? AND ar.deleted=0 AND q.deleted=0 AND ar.created_at>=? AND q.category_id IN (' + ids.map(() => '?').join(',') + ')'
          qParams.push(...ids)
        } else {
          qSql = 'SELECT 0 AS n, 0 AS c'
          qParams = []
        }
      }
      const q = sqlite.prepare(qSql).get(...qParams)
      const xp = sqlite.prepare('SELECT COALESCE(SUM(xp),0) AS n FROM xp_logs WHERE deleted=0 AND created_at>=?').get(weekStart).n
      const focus = sqlite.prepare('SELECT COALESCE(SUM(minutes),0) AS n FROM focus_sessions WHERE deleted=0 AND created_at>=?').get(weekStart).n
      const review = sqlite.prepare('SELECT COUNT(*) AS n FROM review_logs WHERE created_at>=?').get(weekStart).n
      const s = this.getSummary(subjectId)
      const kb = this.kbStats()
      const x = this.xpStats()
      // 近 7 天每日答题数（按科目过滤）
      const daily = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
        const start = d.setHours(0, 0, 0, 0)
        const end = start + 86400000
        let dSql = 'SELECT COUNT(*) AS n FROM answer_records ar WHERE ar.user_id=? AND ar.deleted=0 AND ar.created_at>=? AND ar.created_at<?'
        const dParams = [LOCAL_USER, start, end]
        if (subjectId) {
          const ids = descendantCategoryIds(subjectId)
          if (ids.length) {
            dSql = 'SELECT COUNT(*) AS n FROM answer_records ar JOIN questions q ON q.id=ar.question_id WHERE ar.user_id=? AND ar.deleted=0 AND q.deleted=0 AND ar.created_at>=? AND ar.created_at<? AND q.category_id IN (' + ids.map(() => '?').join(',') + ')'
            dParams.push(...ids)
          } else {
            dSql = 'SELECT 0 AS n'
            dParams = []
          }
        }
        const n = sqlite.prepare(dSql).get(...dParams).n
        daily.push({ date: `${d.getMonth() + 1}/${d.getDate()}`, n })
      }
      return {
        weekStart,
        answered: q.n || 0,
        correct: q.c || 0,
        accuracy: q.n ? Math.round((q.c / q.n) * 100) : 0,
        xp: xp,
        level: x.level,
        totalXp: x.total,
        focus,
        review,
        wrongActive: s.wrongCount,
        mastered: s.mastered,
        totalAnswered: s.learned || s.totalAnswered || 0,
        kbDocs: kb.docs,
        kbLinks: kb.links,
        kbRead: kb.readCount,
        daily
      }
    }
  }
}
