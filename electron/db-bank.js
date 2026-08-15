// 题库管理模块：导入去重 / 列表分页搜索 / 单题增删改 / 统计 / 导出。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/LOCAL_USER/uuid + 依赖 sqlite 的私有函数 categoryCid/descendantCategoryIds；
// this 互调（upsertCategoryByName/upsertMaterial）合并后指向 api。
module.exports = function bankModule(ctx) {
  const { sqlite, LOCAL_USER, uuid, categoryCid, descendantCategoryIds } = ctx

  return {
    importQuestionBank(rows, opts = {}) {
      // duplicateMode: 'skip' 跳过重复（默认）| 'update' 覆盖更新同题干 | 'all' 全部新增
      const { defaultSubjectId = null, defaultCategoryId = null } = opts
      const duplicateMode = opts.duplicateMode || (opts.skipDuplicate === false ? 'all' : 'skip')
      const now = Date.now()
      const insQ = sqlite.prepare(`INSERT INTO questions
        (category_id,type,stem,options_json,answer_json,keywords_json,analysis,difficulty,source,images_json,audio_url,material_id,material_cid,updated_at,client_id,category_cid,subject_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      const dupStmt = sqlite.prepare('SELECT id FROM questions WHERE category_id=? AND stem=? AND deleted=0')
      const updQ = sqlite.prepare(`UPDATE questions SET type=?,options_json=?,answer_json=?,keywords_json=?,analysis=?,difficulty=?,source=?,audio_url=?,images_json=?,material_id=?,material_cid=?,category_cid=?,subject_id=?,updated_at=? WHERE id=?`)
      let inserted = 0
      let duplicated = 0
      let updated = 0
      let skipped = 0
      const touched = new Set()
      const tx = sqlite.transaction(() => {
        for (const r of rows || []) {
          let subjectId = defaultSubjectId
          if (r.subject) subjectId = this.upsertCategoryByName(r.subject, null, 1)
          if (!subjectId) { skipped++; continue }
          // 章节落点：文件有章节列用该章节；否则用指定的默认章节（题库管理带入）；再否则挂科目下
          let categoryId = r.chapter ? this.upsertCategoryByName(r.chapter, subjectId, 2) : (defaultCategoryId || subjectId)
          // 材料题：按 科目+内容 去重建材料实体，题目引用它（material_cid 供跨设备解析）
          const mat = r.material ? this.upsertMaterial(subjectId, r.material) : null
          const dup = dupStmt.get(categoryId, r.stem)
          if (dup) {
            if (duplicateMode === 'skip') { duplicated++; continue }
            if (duplicateMode === 'update') {
              updQ.run(
                r.type, JSON.stringify(r.options || []), JSON.stringify(r.answer || []),
                JSON.stringify(r.keywords || []), r.analysis || '', r.difficulty || 3,
                r.source || '导入', r.audio || '', JSON.stringify(r.images || []),
                mat ? mat.id : null, r.material_cid || null, r.category_cid || null, subjectId, now, dup.id
              )
              updated++
              continue
            }
          }
          insQ.run(
            categoryId, r.type, r.stem,
            JSON.stringify(r.options || []), JSON.stringify(r.answer || []),
            JSON.stringify(r.keywords || []),
            r.analysis || '', r.difficulty || 3, r.source || '导入',
            JSON.stringify(r.images || []), r.audio || '',
            mat ? mat.id : null, mat ? mat.cid : null, now,
            uuid(), categoryCid(categoryId), subjectId
          )
          inserted++
          touched.add(subjectId)
        }
      })
      tx()
      return { ok: true, inserted, duplicated, updated, skipped, subjects: Array.from(touched) }
    },

    listQuestions({ subjectId = null, categoryId = null, keyword = '', page = 1, pageSize = 20, tags = null } = {}) {
      let where = 'q.deleted=0'
      const params = []
      if (categoryId) {
        where += ' AND q.category_id=?'
        params.push(categoryId)
      } else if (subjectId) {
        const ids = descendantCategoryIds(subjectId)
        if (!ids.length) return { total: 0, page: 1, pageSize, items: [] }
        where += ' AND q.category_id IN (' + ids.map(() => '?').join(',') + ')'
        params.push(...ids)
      }
      if (keyword) {
        // 搜索域：题干 + 解析 + 关键词（去掉 options_json——选项 JSON 含 HTML 标签易误命中；LIKE 子串匹配）
        const kw = `%${keyword}%`
        where += ' AND (q.stem LIKE ? OR q.analysis LIKE ? OR q.keywords_json LIKE ?)'
        params.push(kw, kw, kw)
      }
      if (tags && tags.length) {
        // 标签筛选：题目须带全部所选标签（AND 语义）
        tags.forEach(t => {
          where += ' AND q.id IN (SELECT question_id FROM question_tags WHERE tag=?)'
          params.push(t)
        })
      }
      const total = sqlite.prepare(`SELECT COUNT(*) AS n FROM questions q WHERE ${where}`).get(...params).n
      const size = Math.max(1, pageSize)
      const cur = Math.max(1, page)
      const rows = sqlite.prepare(
        `SELECT q.*, c.name AS category_name FROM questions q
         LEFT JOIN categories c ON c.id = q.category_id
         WHERE ${where} ORDER BY q.id DESC LIMIT ? OFFSET ?`
      ).all(...params, size, (cur - 1) * size)
      // 批量取标签（避免逐题 N+1）：一次 IN 查询后按 question_id 分组
      const tagMap = {}
      if (rows.length) {
        const ids = rows.map(r => r.id)
        const ph = ids.map(() => '?').join(',')
        sqlite.prepare(`SELECT question_id, tag FROM question_tags WHERE question_id IN (${ph}) ORDER BY tag`)
          .all(...ids)
          .forEach(tr => { (tagMap[tr.question_id] || (tagMap[tr.question_id] = [])).push(tr.tag) })
      }
      return {
        total,
        page: cur,
        pageSize: size,
        items: rows.map(r => ({
          ...r,
          options: JSON.parse(r.options_json || '[]'),
          answer: JSON.parse(r.answer_json || '[]'),
          keywords: r.keywords_json ? JSON.parse(r.keywords_json) : [],
          images: r.images_json ? JSON.parse(r.images_json) : [],
          tags: tagMap[r.id] || []
        }))
      }
    },

    addQuestion(q) {
      // 手动录题：科目归属 = 章节所属的根科目（category 树向上）
      const subjectId = (() => {
        if (q.categoryId == null) return null
        let cur = Number(q.categoryId)
        const seen = new Set()
        const rows = sqlite.prepare('SELECT id, parent_id FROM categories').all()
        const parentOf = new Map(rows.map(r => [r.id, r.parent_id]))
        while (parentOf.has(cur) && parentOf.get(cur) > 0 && !seen.has(cur)) {
          seen.add(cur)
          cur = parentOf.get(cur)
        }
        return cur
      })()
      const info = sqlite.prepare(`INSERT INTO questions
        (category_id,type,stem,options_json,answer_json,keywords_json,analysis,difficulty,source,images_json,audio_url,updated_at,client_id,category_cid,subject_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(q.categoryId, q.type, q.stem, JSON.stringify(q.options || []),
          JSON.stringify(q.answer || []), JSON.stringify(q.keywords || []),
          q.analysis || '', q.difficulty || 3,
          q.source || '手动录入', JSON.stringify(q.images || []),
          q.audioUrl || '', Date.now(), uuid(), categoryCid(q.categoryId), subjectId)
      return { ok: true, id: info.lastInsertRowid }
    },

    updateQuestion(q) {
      const subjectId = (() => {
        if (q.categoryId == null) return null
        let cur = Number(q.categoryId)
        const seen = new Set()
        const rows = sqlite.prepare('SELECT id, parent_id FROM categories').all()
        const parentOf = new Map(rows.map(r => [r.id, r.parent_id]))
        while (parentOf.has(cur) && parentOf.get(cur) > 0 && !seen.has(cur)) {
          seen.add(cur)
          cur = parentOf.get(cur)
        }
        return cur
      })()
      sqlite.prepare(`UPDATE questions SET category_id=?,type=?,stem=?,options_json=?,
        answer_json=?,keywords_json=?,analysis=?,difficulty=?,source=?,images_json=?,audio_url=?,updated_at=?,category_cid=?,subject_id=? WHERE id=?`)
        .run(q.categoryId, q.type, q.stem, JSON.stringify(q.options || []),
          JSON.stringify(q.answer || []), JSON.stringify(q.keywords || []),
          q.analysis || '', q.difficulty || 3,
          q.source || '手动录入', JSON.stringify(q.images || []),
          q.audioUrl || '', Date.now(), categoryCid(q.categoryId), subjectId, q.id)
      return { ok: true }
    },

    deleteQuestion(id) {
      sqlite.prepare('UPDATE questions SET deleted=1, updated_at=? WHERE id=?').run(Date.now(), id)
      // 题目软删后其标签仍留在 question_tags（listTags 会展示已删题标签、点击筛出空列表）→ 一并清理
      sqlite.prepare('DELETE FROM question_tags WHERE question_id=?').run(id)
      return { ok: true }
    },

    // 题目详情聚合：题目本体 + 章节路径 + 标签 + 状态（收藏/错题/记忆卡/历史正确率）
    getQuestionInfo(id) {
      const q = sqlite.prepare(
        `SELECT q.*, c.name AS category_name, c.parent_id AS cat_parent
         FROM questions q LEFT JOIN categories c ON c.id = q.category_id
         WHERE q.id=? AND q.deleted=0`
      ).get(id)
      if (!q) return { ok: false, error: '题目不存在' }
      // 章节路径：从所属分类向上找父级（科目 › 章节）；guard 防树环（同步合并可能引入环）
      const path = []
      let pid = q.cat_parent
      if (q.category_name) path.unshift(q.category_name)
      let guard = 0
      while (pid && guard++ < 10) {
        const p = sqlite.prepare('SELECT name, parent_id FROM categories WHERE id=?').get(pid)
        if (!p) break
        path.unshift(p.name)
        pid = p.parent_id
      }
      // 标签
      const tags = sqlite.prepare('SELECT tag FROM question_tags WHERE question_id=? ORDER BY tag').all(id).map(r => r.tag)
      // 收藏
      const fav = sqlite.prepare('SELECT fav_group FROM favorites WHERE user_id=? AND question_id=? AND deleted=0').get(LOCAL_USER, id)
      // 错题本
      const wb = sqlite.prepare(
        `SELECT wrong_count, reviewed_count, status, reason, next_review_at FROM wrong_books
         WHERE user_id=? AND question_id=? AND deleted=0`
      ).get(LOCAL_USER, id)
      // 记忆卡（题目来源卡）
      const card = sqlite.prepare('SELECT review_count, review_lapses FROM cards WHERE source_question_id=? AND deleted=0 LIMIT 1').get(id)
      // 历史答题
      const ar = sqlite.prepare(
        'SELECT COUNT(*) AS n, COALESCE(SUM(is_correct),0) AS c FROM answer_records WHERE user_id=? AND question_id=? AND deleted=0'
      ).get(LOCAL_USER, id)
      const answered = ar.n || 0
      return {
        ok: true,
        question: {
          id: q.id, categoryId: q.category_id, type: q.type, stem: q.stem, options_json: q.options_json,
          answer_json: q.answer_json, analysis: q.analysis, difficulty: q.difficulty,
          categoryPath: path, tags
        },
        status: {
          favorited: !!fav,
          favGroup: fav ? fav.fav_group : '',
          wrong: !!wb,
          wrongCount: wb ? wb.wrong_count : 0,
          reviewedCount: wb ? wb.reviewed_count : 0,
          wbStatus: wb ? wb.status : '',
          reason: wb ? (wb.reason || '') : '',
          nextReviewAt: wb ? wb.next_review_at : 0,
          hasCard: !!card,
          cardReviewCount: card ? card.review_count : 0,
          cardLapses: card ? card.review_lapses : 0,
          answered, correctRate: answered ? Math.round((ar.c / answered) * 100) : 0
        }
      }
    },

    getBankStats() {
      const total = sqlite.prepare('SELECT COUNT(*) AS n FROM questions WHERE deleted=0').get().n
      const byType = sqlite.prepare('SELECT type, COUNT(*) AS n FROM questions WHERE deleted=0 GROUP BY type').all()
      // 科目题数：收集科目全部子孙分类（3 级分类不漏节内题目）
      const qCountByCat = new Map(sqlite.prepare('SELECT category_id, COUNT(*) AS n FROM questions WHERE deleted=0 GROUP BY category_id').all().map(r => [r.category_id, r.n]))
      const subjects = sqlite.prepare('SELECT id, name, sort FROM categories WHERE deleted=0 AND (parent_id IS NULL OR parent_id=0) ORDER BY sort, id').all()
      const bySubject = subjects.map(s => {
        let n = 0
        for (const id of descendantCategoryIds(s.id)) n += qCountByCat.get(id) || 0
        return { id: s.id, name: s.name, n }
      })
      const categories = sqlite.prepare('SELECT COUNT(*) AS n FROM categories WHERE deleted=0').get().n
      return { total, categories, byType, bySubject }
    },

    exportBank(subjectId = null) {
      let where = 'q.deleted=0'
      const params = []
      if (subjectId) {
        const ids = descendantCategoryIds(subjectId)
        if (!ids.length) return []
        where += ' AND q.category_id IN (' + ids.map(() => '?').join(',') + ')'
        params.push(...ids)
      }
      const rows = sqlite.prepare(
        `SELECT q.*, c.name AS chapter_name, c.parent_id AS chapter_parent,
                p.name AS parent_name FROM questions q
         LEFT JOIN categories c ON c.id = q.category_id
         LEFT JOIN categories p ON p.id = c.parent_id
         WHERE ${where} ORDER BY q.category_id, q.id`
      ).all(...params)
      return rows.map(r => ({
        subject: r.parent_name || r.chapter_name || '',
        chapter: r.parent_name ? r.chapter_name : '',
        type: r.type,
        stem: r.stem,
        options: JSON.parse(r.options_json || '[]'),
        answer: JSON.parse(r.answer_json || '[]'),
        keywords: r.keywords_json ? JSON.parse(r.keywords_json) : [],
        analysis: r.analysis || '',
        difficulty: r.difficulty || 3,
        source: r.source || ''
      }))
    },

    // ============ 分类基础（科目/章节树 + 当前科目） ============
    // 返回两级分类树（科目 → 章节）
    getCategories() {
      const rows = sqlite.prepare('SELECT * FROM categories WHERE deleted=0 ORDER BY level, sort, id').all()
      const map = {}
      const roots = []
      rows.forEach(r => { map[r.id] = { ...r, children: [] } })
      rows.forEach(r => {
        if (r.parent_id && map[r.parent_id]) map[r.parent_id].children.push(map[r.id])
        else roots.push(map[r.id])
      })
      return roots
    },

    getSubjects() {
      return sqlite.prepare('SELECT id, name, level, stage, sort FROM categories WHERE deleted=0 AND (parent_id IS NULL OR parent_id=0) ORDER BY sort, id').all()
    },

    getCurrentSubject() {
      const row = sqlite.prepare("SELECT value FROM settings WHERE key='current_subject_id'").get()
      if (!row || !row.value) {
        const first = sqlite.prepare('SELECT id, name FROM categories WHERE deleted=0 AND (parent_id IS NULL OR parent_id=0) ORDER BY sort, id LIMIT 1').get()
        return first || { id: null, name: '请选择科目' }
      }
      const sub = sqlite.prepare('SELECT id, name FROM categories WHERE id=? AND deleted=0').get(row.value)
      return sub || { id: null, name: '请选择科目' }
    },

    setCurrentSubject(id) {
      sqlite.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('current_subject_id', ?)").run(id)
      return { ok: true }
    },

    // ============ 分类管理（录入/改名/删除） ============
    upsertCategoryByName(name, parentId = null, level = 1) {
      const trimmed = String(name == null ? '' : name).trim()
      if (!trimmed) return null
      const found = parentId
        ? sqlite.prepare('SELECT id FROM categories WHERE name=? AND parent_id=? AND deleted=0').get(trimmed, parentId)
        : sqlite.prepare('SELECT id FROM categories WHERE name=? AND (parent_id IS NULL OR parent_id=0) AND deleted=0').get(trimmed)
      if (found) return found.id
      const sortRow = parentId
        ? sqlite.prepare('SELECT COALESCE(MAX(sort),0) AS s FROM categories WHERE parent_id=?').get(parentId)
        : sqlite.prepare('SELECT COALESCE(MAX(sort),0) AS s FROM categories WHERE parent_id IS NULL OR parent_id=0').get()
      const info = sqlite.prepare('INSERT INTO categories (name,parent_id,level,sort,updated_at,client_id,parent_cid) VALUES (?,?,?,?,?,?,?)')
        .run(trimmed, parentId, level, (sortRow ? sortRow.s : 0) + 1, Date.now(), uuid(), parentId ? categoryCid(parentId) : null)
      return info.lastInsertRowid
    },

    addCategory({ name, parentId = null }) {
      const id = this.upsertCategoryByName(name, parentId, parentId ? 2 : 1)
      return { ok: !!id, id }
    },

    renameCategory({ id, name }) {
      sqlite.prepare('UPDATE categories SET name=?, updated_at=? WHERE id=?').run(String(name).trim(), Date.now(), id)
      return { ok: true }
    },

    deleteCategory(id) {
      const ids = descendantCategoryIds(id)
      const ph = ids.map(() => '?').join(',')
      const now = Date.now()
      const tx = sqlite.transaction(() => {
        sqlite.prepare(`UPDATE categories SET deleted=1, updated_at=? WHERE id IN (${ph})`).run(now, ...ids)
        sqlite.prepare(`UPDATE questions SET deleted=1, updated_at=? WHERE category_id IN (${ph})`).run(now, ...ids)
        sqlite.prepare(`DELETE FROM question_tags WHERE question_id IN (SELECT id FROM questions WHERE category_id IN (${ph}))`).run(...ids)
        // 科目/章节删除后关联内容不随之删除，但归属清空（内容保留可继续用，避免孤儿不可达）
        // kb_docs.subject_id 存科目根 id、category_id 存章节 id；cards/materials/papers 只有 subject_id
        sqlite.prepare(`UPDATE kb_docs SET subject_id=NULL, category_id=NULL, updated_at=? WHERE subject_id IN (${ph}) OR category_id IN (${ph})`).run(now, ...ids, ...ids)
        // cards 同 kb_docs：科目+章节归属都清（此前只清 subject_id，删章节后 category_id 残留）
        sqlite.prepare(`UPDATE cards SET subject_id=NULL, category_id=NULL, updated_at=? WHERE subject_id IN (${ph}) OR category_id IN (${ph})`).run(now, ...ids, ...ids)
        sqlite.prepare(`UPDATE materials SET subject_id=NULL, updated_at=? WHERE subject_id IN (${ph})`).run(now, ...ids)
        sqlite.prepare(`UPDATE papers SET subject_id=NULL, updated_at=? WHERE subject_id IN (${ph})`).run(now, ...ids)
      })
      tx()
      return { ok: true, removedCategories: ids.length }
    },

    // ============ 题目批量操作 ============
    // patch: { categoryId, difficulty, addTags:[], setTags:[] }；软删兼容同步
    batchUpdateQuestions(ids, patch = {}) {
      const list = (ids || []).map(Number).filter(Boolean)
      if (!list.length) return { ok: true, updated: 0 }
      const now = Date.now()
      // 批量移题：科目归属联动更新（新章节的根科目）——parentOf 一次构建循环复用（原实现每题全表重扫）
      let newSubject = null
      if (patch.categoryId != null) {
        let cur = Number(patch.categoryId)
        const seen = new Set()
        const rows = sqlite.prepare('SELECT id, parent_id FROM categories').all()
        const parentOf = new Map(rows.map(r => [r.id, r.parent_id]))
        while (parentOf.has(cur) && parentOf.get(cur) > 0 && !seen.has(cur)) {
          seen.add(cur)
          cur = parentOf.get(cur)
        }
        newSubject = cur
      }
      const tx = sqlite.transaction(() => {
        for (const id of list) {
          if (patch.categoryId != null) {
            // 批量移题：科目归属联动更新（新章节的根科目）
            sqlite.prepare('UPDATE questions SET category_id=?, category_cid=?, subject_id=?, updated_at=? WHERE id=?')
              .run(Number(patch.categoryId), categoryCid(Number(patch.categoryId)), newSubject, now, id)
          }
          if (patch.difficulty != null) {
            sqlite.prepare('UPDATE questions SET difficulty=?, updated_at=? WHERE id=?')
              .run(Number(patch.difficulty), now, id)
          }
          if (Array.isArray(patch.setTags)) {
            this.setQuestionTags(id, patch.setTags)
          } else if (Array.isArray(patch.addTags) && patch.addTags.length) {
            const cur = this.getQuestionTags(id)
            this.setQuestionTags(id, cur.concat(patch.addTags))
          }
        }
      })
      tx()
      return { ok: true, updated: list.length }
    },

    batchDeleteQuestions(ids) {
      const list = (ids || []).map(Number).filter(Boolean)
      if (!list.length) return { ok: true, deleted: 0 }
      const now = Date.now()
      const tx = sqlite.transaction(() => {
        for (const id of list) {
          sqlite.prepare('UPDATE questions SET deleted=1, updated_at=? WHERE id=?').run(now, id)
        }
      })
      tx()
      return { ok: true, deleted: list.length }
    }
  }
}
