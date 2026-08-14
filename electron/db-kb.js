// 知识库文档基础模块：文件读写 / 文档 CRUD / 标签 / 互链图谱。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/uuid；this 互调（kbDir/getKbDoc/getKbLinksForDoc）合并后指向 api。
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { extractMd } = require('./kbExtract')

module.exports = function kbModule(ctx) {
  const { sqlite, uuid, app } = ctx

  return {
    // 校验知识库相对路径（安全）：拒绝 '..' / 绝对路径 / Windows 盘符。
    // rel_path 来自同步导入的远端清单（不可信），读写删前必须过此校验，防越界访问
    safeRelPath(rel) {
      const r = String(rel || '').replace(/\\/g, '/')
      if (!r || r.includes('..') || r.startsWith('/') || /^[a-zA-Z]:/.test(r)) return null
      return r
    },

    readKbFile(id) {
      const doc = sqlite.prepare('SELECT rel_path FROM kb_docs WHERE id=? AND deleted=0').get(id)
      if (!doc) return { ok: false, error: '文档不存在' }
      const rel = this.safeRelPath(doc.rel_path)
      if (!rel) return { ok: false, error: '路径非法' }
      try {
        const full = path.join(this.kbDir(), rel)
        if (!fs.existsSync(full)) return { ok: false, error: '文件缺失（副本可能被手动移动）' }
        return { ok: true, base64: fs.readFileSync(full).toString('base64') }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },

    findKbDocByHash(hash) {
      if (!hash) return null
      return sqlite.prepare('SELECT id, title, type FROM kb_docs WHERE hash=? AND deleted=0 LIMIT 1').get(hash) || null
    },

    // id 是科目还是章节：categories 里 parent_id 为空/0 = 科目，有父 = 章节；查不到返回 null
    categoryKind(id) {
      if (id == null) return null
      const row = sqlite.prepare('SELECT parent_id FROM categories WHERE id=? AND deleted=0').get(id)
      if (!row) return null
      return row.parent_id ? 'chapter' : 'subject'
    },

    addKbDoc({ title, type = 'md', relPath, size = 0, hash, blocks = [], subjectId = null, categoryId = null }) {
      const now = Date.now()
      const tx = sqlite.transaction(() => {
        const info = sqlite.prepare(
          'INSERT INTO kb_docs (title, type, rel_path, size, hash, subject_id, category_id, created_at, updated_at, deleted, client_id) VALUES (?,?,?,?,?,?,?,?,?,0,?)'
        ).run(title, type, relPath, size, hash || null, subjectId || null, categoryId || null, now, now, uuid())
        const docId = info.lastInsertRowid
        const ins = sqlite.prepare(
          'INSERT INTO kb_blocks (doc_id, seq, heading, content, char_start, char_end) VALUES (?,?,?,?,?,?)'
        )
        ;(blocks || []).forEach((b, i) => {
          ins.run(docId, i, b.heading || null, String(b.content || ''), b.charStart ?? null, b.charEnd ?? null)
        })
        return docId
      })
      return tx()
    },

    // 知识库互链图谱：节点=文档，边=有效互链（两端文档都存在）
    // 节点带归属字段（subject/category/tags）供前端按维度着色；支持范围过滤（跟随顶部选择器 + 标签）
    getKbGraph({ subjectId, tag } = {}) {
      let where = 'd.deleted=0'
      const params = []
      if (subjectId) {
        // 同 getKbDocs 口径：科目 → subject_id 过滤；章节 → category_id 过滤
        const kind = this.categoryKind(subjectId)
        if (kind === 'subject') { where += ' AND d.subject_id=?'; params.push(subjectId) }
        else if (kind === 'chapter') { where += ' AND d.category_id=?'; params.push(subjectId) }
      }
      if (tag) { where += ' AND d.id IN (SELECT doc_id FROM kb_tags WHERE tag=?)'; params.push(tag) }
      const nodes = sqlite.prepare(`SELECT d.id, d.title, d.type, d.folder, d.subject_id, d.category_id FROM kb_docs d WHERE ${where}`).all(...params)
        .map(d => ({
          id: d.id, title: d.title, type: d.type, folder: d.folder || '',
          subjectId: d.subject_id, categoryId: d.category_id,
          tags: sqlite.prepare('SELECT tag FROM kb_tags WHERE doc_id=?').all(d.id).map(t => t.tag)
        }))
      const idSet = new Set(nodes.map(n => n.id))
      const links = sqlite.prepare('SELECT from_doc_id, to_doc_id FROM kb_doc_links').all()
        .filter(l => idSet.has(l.from_doc_id) && idSet.has(l.to_doc_id))
      return { nodes, links }
    },

    // 软删文档的 rel_path 列表（同步时用于远端文件删除/下载排除）
    getDeletedKbRels() {
      return sqlite.prepare("SELECT rel_path FROM kb_docs WHERE deleted=1 AND rel_path IS NOT NULL AND rel_path != ''").all().map(r => r.rel_path)
    },

    getKbDocs(subjectId) {
      // subjectId 传科目 id → 按 subject_id 过滤；传章节 id → 按 category_id 过滤；不传/undefined → 全部
      const kind = this.categoryKind(subjectId)
      const rows = (kind
        ? (kind === 'subject'
          ? sqlite.prepare('SELECT * FROM kb_docs WHERE deleted=0 AND subject_id=? ORDER BY updated_at DESC').all(subjectId)
          : sqlite.prepare('SELECT * FROM kb_docs WHERE deleted=0 AND category_id=? ORDER BY updated_at DESC').all(subjectId))
        : sqlite.prepare('SELECT * FROM kb_docs WHERE deleted=0 ORDER BY updated_at DESC').all())
      const tagStmt = sqlite.prepare('SELECT tag FROM kb_tags WHERE doc_id=? ORDER BY tag')
      const linkStmt = sqlite.prepare('SELECT COUNT(*) AS n FROM kb_links WHERE doc_id=?')
      return rows.map(r => ({
        ...r,
        tags: tagStmt.all(r.id).map(t => t.tag),
        linkCount: linkStmt.get(r.id).n
      }))
    },

    getKbDoc(id) {
      const doc = sqlite.prepare('SELECT * FROM kb_docs WHERE id=? AND deleted=0').get(id)
      if (!doc) return null
      doc.tags = sqlite.prepare('SELECT tag FROM kb_tags WHERE doc_id=? ORDER BY tag').all(id).map(t => t.tag)
      doc.blocks = sqlite.prepare('SELECT id, seq, heading, content FROM kb_blocks WHERE doc_id=? ORDER BY seq').all(id)
      doc.links = this.getKbLinksForDoc(id)
      return doc
    },

    updateKbDoc(id, patch = {}) {
      const cur = sqlite.prepare('SELECT * FROM kb_docs WHERE id=? AND deleted=0').get(id)
      if (!cur) return null
      const title = patch.title != null ? String(patch.title) : cur.title
      const hash = patch.hash != null ? String(patch.hash) : cur.hash
      const size = patch.size != null ? Number(patch.size) : cur.size
      const subjectId = patch.subjectId !== undefined ? (patch.subjectId || null) : cur.subject_id
      const categoryId = patch.categoryId !== undefined ? (patch.categoryId || null) : cur.category_id
      sqlite.prepare('UPDATE kb_docs SET title=?, hash=?, size=?, subject_id=?, category_id=?, updated_at=? WHERE id=?')
        .run(title, hash, size, subjectId, categoryId, Date.now(), id)
      return this.getKbDoc(id)
    },

    deleteKbDoc(id) {
      const doc = sqlite.prepare('SELECT * FROM kb_docs WHERE id=?').get(id)
      if (!doc) return { ok: false }
      const now = Date.now()
      const tx = sqlite.transaction(() => {
        // 软删除：保留行（deleted=1 + updated_at），删除标记随快照同步传播到其他端
        sqlite.prepare('UPDATE kb_docs SET deleted=1, updated_at=? WHERE id=?').run(now, id)
        // 子表：kb_links/kb_tags/kb_blocks 均无 deleted 列 → 物理删（合并时按远端文档重建兜底）
        sqlite.prepare('DELETE FROM kb_links WHERE doc_id=?').run(id)
        sqlite.prepare('DELETE FROM kb_tags WHERE doc_id=?').run(id)
        sqlite.prepare('DELETE FROM kb_blocks WHERE doc_id=?').run(id)
        // 高亮有 deleted 列 → 软删（此前漏处理，残留行经 mergeRemote LWW 继续跨端传播）
        sqlite.prepare('UPDATE kb_highlights SET deleted=1, updated_at=? WHERE doc_id=?').run(now, id)
        // 文档间双链：双向清理（无 deleted 列 → 物理删）
        sqlite.prepare('DELETE FROM kb_doc_links WHERE from_doc_id=? OR to_doc_id=?').run(id, id)
      })
      tx()
      try {
        const rel = this.safeRelPath(doc.rel_path)
        if (rel) fs.unlinkSync(path.join(this.kbDir(), rel))
      } catch (e) { /* 副本文件可能已被手动删除，忽略 */ }
      return { ok: true }
    },

    // 高亮 → 记忆卡（E-2）：正面=高亮文本（截断 80），背面=原文+文档标题，卡组=文档标题；front 相同视为重复
    addCardFromHighlight(highlightId) {
      const h = sqlite.prepare('SELECT * FROM kb_highlights WHERE id=? AND deleted=0').get(highlightId)
      if (!h) return { ok: false, error: '高亮不存在' }
      const text = String(h.text || '').trim()
      if (!text) return { ok: false, error: '高亮内容为空' }
      const doc = sqlite.prepare('SELECT title, subject_id FROM kb_docs WHERE id=?').get(h.doc_id)
      const title = (doc && doc.title) || '知识库'
      const front = text.slice(0, 80)
      const dup = sqlite.prepare('SELECT id FROM cards WHERE front=? AND deleted=0').get(front)
      if (dup) return { ok: true, duplicate: true, cardId: dup.id }
      const back = ['【原文】' + text, '【来源】' + title].join('\n')
      const now = Date.now()
      const info = sqlite.prepare('INSERT INTO cards (front, back, category, subject_id, created_at, updated_at, deleted, client_id) VALUES (?,?,?,?,?,?,0,?)')
        .run(front, back, title, (doc && doc.subject_id) || null, now, now, uuid())
      try { this.logXp(2, 'card', 'highlight') } catch (e) { /* XP 失败不影响转卡 */ }
      return { ok: true, duplicate: false, cardId: info.lastInsertRowid }
    },

    setKbTags(docId, tags = []) {
      const tx = sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM kb_tags WHERE doc_id=?').run(docId)
        const ins = sqlite.prepare('INSERT OR IGNORE INTO kb_tags (doc_id, tag) VALUES (?,?)')
        tags.map(t => String(t).trim()).filter(Boolean).forEach(t => ins.run(docId, t))
      })
      tx()
      return this.getKbDoc(docId)
    },

    listKbTags() {
      return sqlite.prepare('SELECT tag, COUNT(*) AS n FROM kb_tags GROUP BY tag ORDER BY tag').all()
    },

    // ---- 题目 ↔ 文档 联动（kb_links）----
    linkKbDoc({ docId, questionId, blockId = null, note = '' }) {
      sqlite.prepare('INSERT OR IGNORE INTO kb_links (doc_id, block_id, question_id, note, created_at) VALUES (?,?,?,?,?)')
        .run(docId, blockId, questionId, note || '', Date.now())
      return { ok: true }
    },

    unlinkKbDoc(docId, questionId) {
      sqlite.prepare('DELETE FROM kb_links WHERE doc_id=? AND question_id=?').run(docId, questionId)
      return { ok: true }
    },

    getKbLinksForQuestion(questionId) {
      return sqlite.prepare(
        `SELECT l.id, l.doc_id, l.block_id, l.note, l.created_at, d.title, d.type, d.rel_path
         FROM kb_links l JOIN kb_docs d ON d.id=l.doc_id
         WHERE l.question_id=? AND d.deleted=0 ORDER BY l.created_at DESC`
      ).all(questionId)
    },

    getKbLinksForDoc(docId) {
      const rows = sqlite.prepare('SELECT id, question_id, block_id, note, created_at FROM kb_links WHERE doc_id=? ORDER BY created_at DESC').all(docId)
      const qStmt = sqlite.prepare('SELECT stem FROM questions WHERE id=? AND deleted=0')
      return rows.map(r => {
        const q = qStmt.get(r.question_id)
        return { ...r, stemPreview: q ? String(q.stem || '').slice(0, 60) : '' }
      })
    },

    // ---- 全文搜索（LIKE，中英文子串）----
    searchKb(query, limit = 20) {
      const kw = String(query || '').trim()
      if (!kw) return []
      const like = '%' + kw.replace(/[%_\\]/g, m => '\\' + m) + '%'
      const docs = sqlite.prepare(
        `SELECT id, title, type, rel_path, folder, updated_at FROM kb_docs
         WHERE deleted=0 AND (title LIKE ? ESCAPE '\\' OR id IN (SELECT doc_id FROM kb_blocks WHERE content LIKE ? ESCAPE '\\'))
         ORDER BY updated_at DESC LIMIT ?`
      ).all(like, like, limit)
      const blockStmt = sqlite.prepare(
        `SELECT id, seq, heading, content FROM kb_blocks WHERE doc_id=? AND content LIKE ? ESCAPE '\\' ORDER BY seq LIMIT 3`
      )
      return docs.map(d => ({
        ...d,
        matchedBlocks: blockStmt.all(d.id, like).map(b => ({
          blockId: b.id,
          heading: b.heading,
          snippet: this.snippet(b.content, kw, 80)
        }))
      }))
    },

    snippet(text, kw, len = 80) {
      const t = String(text || '')
      const i = t.toLowerCase().indexOf(String(kw).toLowerCase())
      if (i < 0) return t.slice(0, len)
      const start = Math.max(0, i - 40)
      return (start > 0 ? '…' : '') + t.slice(start, start + len) + (start + len < t.length ? '…' : '')
    },

    // ---- L2 联动推荐（零 ML：共享标签 + 关键词 LIKE，排除已关联）----
    // 从文本里提取关键词：连续中文（≥2 字）+ 英文词（≥3 字母），去停用词与重复。
    extractKeywords(text, max = 6) {
      const t = String(text || '')
      const stop = new Set([
        '下列', '关于', '正确', '错误', '说法', '描述', '属于', '不是', '什么', '为什么', '如何',
        '以下', '哪个', '哪些', '情况', '中的', '一种', '可以', '需要', '应该', '必须', '可能',
        '进行', '表示', '包括', '具有', '以及', '对于', '一个', '没有', '说明', '判断', '选择',
        '的是', '的是', '是的', '时候', '过程', '方式', '方法', '特点', '主要', '的是的'
      ])
      const tokens = (t.match(/[\u4e00-\u9fa5]{2,}/g) || []).concat(t.match(/[A-Za-z]{3,}/g) || [])
      const seen = new Set()
      const out = []
      tokens.forEach(tok => {
        if (stop.has(tok) || tok.length < 2) return
        const k = tok.toLowerCase()
        if (seen.has(k)) return
        seen.add(k)
        out.push(k)
      })
      return out.slice(0, max)
    },

    // 题目 → 推荐文档（共享标签优先，题干关键词命中块其次）
    getSuggestedDocsForQuestion(questionId, limit = 5) {
      const q = sqlite.prepare('SELECT stem FROM questions WHERE id=? AND deleted=0').get(questionId)
      if (!q) return []
      const out = []
      const seen = new Set()
      const push = (r, reason) => {
        if (seen.has(r.id)) return
        seen.add(r.id)
        out.push({ id: r.id, title: r.title, type: r.type, rel_path: r.rel_path, updated_at: r.updated_at, heading: r.heading || null, reason })
      }
      const byTag = sqlite.prepare(
        `SELECT DISTINCT d.id, d.title, d.type, d.rel_path, d.updated_at FROM kb_docs d
         JOIN kb_tags kt ON kt.doc_id=d.id
         JOIN question_tags qt ON qt.tag=kt.tag
         WHERE qt.question_id=? AND d.deleted=0
         AND d.id NOT IN (SELECT doc_id FROM kb_links WHERE question_id=?)`
      ).all(questionId, questionId)
      byTag.forEach(r => push(r, '标签匹配'))
      if (out.length < limit) {
        const kws = this.extractKeywords(q.stem, 6)
        const hit = new Map()
        const rowStmt = sqlite.prepare(
          `SELECT d.id, d.title, d.type, d.rel_path, d.updated_at, b.heading FROM kb_blocks b
           JOIN kb_docs d ON d.id=b.doc_id
           WHERE d.deleted=0 AND d.id NOT IN (SELECT doc_id FROM kb_links WHERE question_id=?) AND b.content LIKE ? ESCAPE '\\'`
        )
        kws.forEach(kw => {
          if (out.length + hit.size >= limit) return
          rowStmt.all(questionId, '%' + kw.replace(/[%_\\]/g, m => '\\' + m) + '%').forEach(r => {
            if (!hit.has(r.id)) hit.set(r.id, r)
          })
        })
        hit.forEach(r => push(r, '关键词命中'))
      }
      return out.slice(0, limit)
    },

    // 文档 → 推荐题目（共享标签反向优先，文档块关键词命中题干其次）
    getSuggestedQuestionsForDoc(docId, limit = 5) {
      const doc = sqlite.prepare('SELECT id FROM kb_docs WHERE id=? AND deleted=0').get(docId)
      if (!doc) return []
      const out = []
      const seen = new Set()
      const catStmt = sqlite.prepare('SELECT name FROM categories WHERE id=?')
      const push = (r, reason) => {
        if (seen.has(r.id)) return
        seen.add(r.id)
        out.push({ id: r.id, stem: r.stem, type: r.type, category_id: r.category_id, categoryName: catStmt.get(r.category_id) ? catStmt.get(r.category_id).name : '', reason })
      }
      const byTag = sqlite.prepare(
        `SELECT DISTINCT q.id, q.stem, q.type, q.category_id FROM questions q
         JOIN question_tags qt ON qt.question_id=q.id
         JOIN kb_tags kt ON kt.tag=qt.tag
         WHERE kt.doc_id=? AND q.deleted=0
         AND q.id NOT IN (SELECT question_id FROM kb_links WHERE doc_id=?)`
      ).all(docId, docId)
      byTag.forEach(r => push(r, '标签匹配'))
      if (out.length < limit) {
        const blocks = sqlite.prepare('SELECT content FROM kb_blocks WHERE doc_id=? ORDER BY seq LIMIT 30').all(docId)
        const seenKw = new Set()
        const kws = []
        blocks.forEach(b => this.extractKeywords(b.content, 8).forEach(k => {
          if (!seenKw.has(k)) { seenKw.add(k); kws.push(k) }
        }))
        const hit = new Map()
        const rowStmt = sqlite.prepare(
          `SELECT id, stem, type, category_id FROM questions
           WHERE deleted=0 AND id NOT IN (SELECT question_id FROM kb_links WHERE doc_id=?) AND stem LIKE ? ESCAPE '\\'`
        )
        kws.slice(0, 10).forEach(kw => {
          if (hit.size >= limit) return
          rowStmt.all(docId, '%' + kw.replace(/[%_\\]/g, m => '\\' + m) + '%').forEach(r => {
            if (!hit.has(r.id)) hit.set(r.id, r)
          })
        })
        hit.forEach(r => push(r, '关键词命中'))
      }
      return out.slice(0, limit)
    },

    // ---- 知识库文件目录 / 统计 / 文件夹 / 阅读埋点 / MD 编辑 / 滚动记忆 ----
    kbDir() {
      return path.join(app.getPath('userData'), 'kb')
    },

    kbStats() {
      const docs = sqlite.prepare('SELECT COUNT(*) AS n FROM kb_docs WHERE deleted=0').get().n
      const blocks = sqlite.prepare('SELECT COUNT(*) AS n FROM kb_blocks').get().n
      const links = sqlite.prepare('SELECT COUNT(*) AS n FROM kb_links').get().n
      const tags = sqlite.prepare('SELECT COUNT(DISTINCT tag) AS n FROM kb_tags').get().n
      const readCount = sqlite.prepare('SELECT COALESCE(SUM(read_count),0) AS n FROM kb_docs WHERE deleted=0').get().n
      const unread = sqlite.prepare('SELECT COUNT(*) AS n FROM kb_docs WHERE deleted=0 AND (read_count IS NULL OR read_count=0)').get().n
      const folders = sqlite.prepare("SELECT COUNT(DISTINCT folder) AS n FROM kb_docs WHERE deleted=0 AND folder<>''").get().n
      return { docs, blocks, links, tags, readCount, unread, folders }
    },

    // 移动文档到文件夹（folder 为空串=未分类）
    moveKbDoc(id, folder) {
      sqlite.prepare('UPDATE kb_docs SET folder=?, updated_at=? WHERE id=? AND deleted=0')
        .run(String(folder || '').trim(), Date.now(), id)
      return this.getKbDoc(id)
    },

    // 阅读埋点：打开阅读页 +1（同时给 5 XP，供每日任务「阅读」判定）。
    // 防刷：同文档当天只记一次 XP（read_count 照常累加真实阅读次数），防反复开关文档刷 XP/刷阅读任务
    bumpKbRead(id) {
      sqlite.prepare('UPDATE kb_docs SET read_count=read_count+1 WHERE id=? AND deleted=0').run(id)
      const doc = sqlite.prepare('SELECT title FROM kb_docs WHERE id=? AND deleted=0').get(id)
      const d = new Date()
      const dayKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      const key = 'kbread_today'
      let st = { date: dayKey, ids: [] }
      try { st = Object.assign(st, JSON.parse(this.getSetting(key) || '{}')) } catch (e) { /* 损坏重置 */ }
      if (st.date !== dayKey) st = { date: dayKey, ids: [] }
      if (!st.ids.includes(id)) {
        st.ids.push(id)
        this.setSetting(key, JSON.stringify(st))
        this.logXp(5, 'kbread', doc ? doc.title : '')
      }
      return { ok: true }
    },

    // MD 在线编辑保存：写回副本文件 + 重新切块 + 更新 hash/size/updated_at
    kbSaveMd(id, content) {
      const doc = sqlite.prepare('SELECT * FROM kb_docs WHERE id=? AND deleted=0').get(id)
      if (!doc) return { ok: false, error: '文档不存在' }
      if (doc.type !== 'md') return { ok: false, error: '仅 MD 文档支持在线编辑' }
      const rel = this.safeRelPath(doc.rel_path)
      if (!rel) return { ok: false, error: '路径非法' }
      try {
        const text = String(content || '')
        const full = path.join(this.kbDir(), rel)
        const buf = Buffer.from(text, 'utf8')
        fs.writeFileSync(full, buf)
        const blocks = extractMd(text)
        const now = Date.now()
        const hash = crypto.createHash('sha1').update(buf).digest('hex')
        const tx = sqlite.transaction(() => {
          sqlite.prepare('DELETE FROM kb_blocks WHERE doc_id=?').run(id)
          const ins = sqlite.prepare('INSERT INTO kb_blocks (doc_id, seq, heading, content, char_start, char_end) VALUES (?,?,?,?,?,?)')
          blocks.forEach((b, i) => ins.run(id, i, b.heading || null, b.content, b.charStart ?? null, b.charEnd ?? null))
          sqlite.prepare('UPDATE kb_docs SET size=?, hash=?, updated_at=? WHERE id=?').run(buf.length, hash, now, id)
        })
        tx()
        return { ok: true, blocks: blocks.length }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },

    // ---- PDF 阅读位置记忆 ----
    saveKbScroll(docId, page) {
      sqlite.prepare('UPDATE kb_docs SET last_page=? WHERE id=? AND deleted=0').run(Math.max(0, Math.round(page || 0)), docId)
      return { ok: true }
    },

    // ---- 知识库文件 base64 存取（备份/同步用）----
    listKbFiles() {
      const dir = this.kbDir()
      if (!fs.existsSync(dir)) return []
      const out = []
      // 递归扫描（笔记在 kb/notes/ 子目录，非递归会丢文件）
      const walk = (d, prefix) => {
        for (const name of fs.readdirSync(d)) {
          const full = path.join(d, name)
          const rel = prefix ? prefix + '/' + name : name
          if (fs.statSync(full).isFile()) {
            try { out.push({ relPath: rel, base64: fs.readFileSync(full).toString('base64') }) } catch (e) { /* 跳过 */ }
          } else if (fs.statSync(full).isDirectory()) {
            walk(full, rel)
          }
        }
      }
      walk(dir, '')
      return out
    },

    // 写回知识库文件（供备份导入 / 同步还原）
    restoreKbFiles(files) {
      const dir = this.kbDir()
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      let n = 0
      for (const f of files || []) {
        if (!f || !f.relPath) continue
        const rel = String(f.relPath).replace(/\\/g, '/')
        // 防穿越：拒绝 '..' 与绝对路径
        if (!rel || rel.includes('..') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) continue
        try {
          const full = path.join(dir, rel)
          // 文件存在也以远端快照为准覆盖（原：仅不存在才写 → 远端新内容永不落盘，DB hash 与磁盘不一致回滚循环）
          if (f.base64) {
            fs.mkdirSync(path.dirname(full), { recursive: true })
            fs.writeFileSync(full, Buffer.from(f.base64, 'base64'))
            n++
          }
        } catch (e) { /* 单个失败不影响整体 */ }
      }
      return n
    }
  }
}
