// 薄弱项分析 / 相似题 / 弱点抽题模块。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/LOCAL_USER/descendantCategoryIds；getWeakQuestions 被 getQuestions(weak 模式) 经 this 调用。
module.exports = function weakModule(ctx) {
  const { sqlite, LOCAL_USER, descendantCategoryIds } = ctx

  return {
    getWeakChapters(subjectId = null, limit = 5) {
      const sql = subjectId
        ? 'SELECT id FROM categories WHERE deleted=0 AND parent_id=? ORDER BY sort, id'
        : 'SELECT id FROM categories WHERE deleted=0 AND parent_id IS NOT NULL AND parent_id!=0 ORDER BY sort, id'
      const chapters = sqlite.prepare(sql).all(...(subjectId ? [subjectId] : []))
      const result = []
      for (const ch of chapters) {
        const cat = sqlite.prepare('SELECT name FROM categories WHERE id=?').get(ch.id)
        const stat = sqlite.prepare(`SELECT COUNT(*) AS n, SUM(is_correct) AS c
          FROM answer_records ar JOIN questions q ON q.id=ar.question_id
          WHERE ar.user_id=? AND ar.deleted=0 AND q.category_id=?`).get(LOCAL_USER, ch.id)
        const totalQ = sqlite.prepare('SELECT COUNT(*) AS n FROM questions WHERE deleted=0 AND category_id=?').get(ch.id).n
        const wrong = sqlite.prepare("SELECT COUNT(*) AS n FROM wrong_books WHERE user_id=? AND status='wrong' AND deleted=0 AND question_id IN (SELECT id FROM questions WHERE category_id=?)").get(LOCAL_USER, ch.id).n
        const n = stat.n || 0
        result.push({
          id: ch.id, name: cat.name, totalQ: totalQ || 0, answered: n,
          correct: stat.c || 0, rate: n ? Math.round(((stat.c || 0) / n) * 100) : 0, wrong
        })
      }
      result.sort((a, b) => (a.rate - b.rate) || (b.wrong - a.wrong))
      return result.slice(0, limit)
    },

    // 相似题：同章节、排除自身的其他题（弱关联：同知识点不同问法）
    getSimilarQuestions(questionId, limit = 3) {
      const q = sqlite.prepare('SELECT category_id, type FROM questions WHERE id=? AND deleted=0').get(questionId)
      if (!q) return []
      const rows = sqlite.prepare(`SELECT id, type, stem, options_json, answer_json, analysis, images_json
        FROM questions WHERE deleted=0 AND category_id=? AND id<>? ORDER BY id DESC LIMIT ?`)
        .all(q.category_id, questionId, limit)
      return rows.map(r => ({
        id: r.id, type: r.type, stem: r.stem,
        options: JSON.parse(r.options_json || '[]'),
        answer: JSON.parse(r.answer_json || '[]'),
        analysis: r.analysis,
        images: r.images_json ? JSON.parse(r.images_json) : []
      }))
    },

    // 弱点抽题：错题数高 + 正确率低的题优先（(1-正确率)*错题数 加权；未做过的题给基础权重）
    getWeakQuestions(limit = 30, subjectId = null, categoryId = null) {
      let scope = 'q.deleted=0'
      const params = []
      if (categoryId) { scope += ' AND q.category_id=?'; params.push(categoryId) }
      else if (subjectId) {
        const ids = descendantCategoryIds(Number(subjectId))
        if (!ids.length) return []
        scope += ' AND q.category_id IN (' + ids.map(() => '?').join(',') + ')'
        params.push(...ids)
      }
      const rows = sqlite.prepare(`SELECT q.*,
          COALESCE((SELECT wrong_count FROM wrong_books w WHERE w.user_id=? AND w.question_id=q.id AND w.deleted=0 ORDER BY w.wrong_count DESC LIMIT 1),0) AS wc,
          COALESCE((SELECT SUM(is_correct) FROM answer_records ar WHERE ar.user_id=? AND ar.question_id=q.id AND ar.deleted=0),0) AS cor,
          COALESCE((SELECT COUNT(*) FROM answer_records ar WHERE ar.user_id=? AND ar.question_id=q.id AND ar.deleted=0),0) AS tot
        FROM questions q WHERE ${scope}`).all(LOCAL_USER, LOCAL_USER, LOCAL_USER, ...params)
      const scored = rows.map(r => {
        const tot = r.tot || 0
        const rate = tot ? (r.cor || 0) / tot : 0
        const weakness = (1 - rate) * (Number(r.wc) || 0) + (tot === 0 ? 2 : 0)
        return {
          ...r,
          options: JSON.parse(r.options_json || '[]'),
          answer: JSON.parse(r.answer_json || '[]'),
          keywords: r.keywords_json ? JSON.parse(r.keywords_json) : [],
          images: r.images_json ? JSON.parse(r.images_json) : [],
          _weak: weakness
        }
      })
      scored.sort((a, b) => b._weak - a._weak)
      return scored.slice(0, limit)
    }
  }
}
