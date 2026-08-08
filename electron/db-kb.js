// 知识库文档基础模块：文件读写 / 文档 CRUD / 标签 / 互链图谱。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/uuid；this 互调（kbDir/getKbDoc/getKbLinksForDoc）合并后指向 api。
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { extractMd } = require('./kbExtract')

module.exports = function kbModule(ctx) {
  const { sqlite, uuid, app } = ctx

  return {
    readKbFile(id) {
      const doc = sqlite.prepare('SELECT rel_path FROM kb_docs WHERE id=? AND deleted=0').get(id)
      if (!doc) return { ok: false, error: '文档不存在' }
      try {
        const full = path.join(this.kbDir(), doc.rel_path)
        if (!fs.existsSync(full)) return { ok: false, error: '文件缺失（副本可能被手动移动）' }
        return { ok: true, base64: fs.readFileSync(full).toString('base64') }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },

    // 文档笔记：独立 MD 文档，命名固定 = 原文档标题 + '笔记'；已存在则复用，否则创建空笔记
    getKbNote(docId) {
      const doc = sqlite.prepare('SELECT id, title FROM kb_docs WHERE id=? AND deleted=0').get(docId)
      if (!doc) return { ok: false, error: '文档不存在' }
      // 防套娃：文档本身已是笔记（标题以「笔记」结尾）时直接返回自身，不再生成「笔记笔记」
      if (/笔记$/.test(String(doc.title))) {
        return { ok: true, noteId: doc.id, title: doc.title, created: false }
      }
      const noteTitle = String(doc.title) + '笔记'
      const existing = sqlite.prepare(
        "SELECT id FROM kb_docs WHERE title=? AND type='md' AND deleted=0 ORDER BY id LIMIT 1"
      ).get(noteTitle)
      if (existing) return { ok: true, noteId: existing.id, title: noteTitle, created: false }
      // 创建空 MD 笔记（rel_path 放 notes/ 子目录，避免与导入文档冲突；folder 留空归未分类，不在知识库单列）
      const rel = 'notes/' + Date.now() + '-' + uuid().slice(0, 8) + '.md'
      const dir = this.kbDir()
      fs.mkdirSync(path.join(dir, 'notes'), { recursive: true })
      fs.writeFileSync(path.join(dir, rel), '# ' + noteTitle + '\n\n')
      const now = Date.now()
      const buf = fs.readFileSync(path.join(dir, rel))
      const info = sqlite.prepare(
        'INSERT INTO kb_docs (title, type, rel_path, size, hash, folder, created_at, updated_at, deleted, client_id) VALUES (?,?,?,?,?,?,?,?,0,?)'
      ).run(noteTitle, 'md', rel, buf.length, crypto.createHash('sha1').update(buf).digest('hex'), '', now, now, uuid())
      return { ok: true, noteId: Number(info.lastInsertRowid), title: noteTitle, created: true }
    },

    findKbDocByHash(hash) {
      if (!hash) return null
      return sqlite.prepare('SELECT id, title, type FROM kb_docs WHERE hash=? AND deleted=0 LIMIT 1').get(hash) || null
    },

    addKbDoc({ title, type = 'md', relPath, size = 0, hash, blocks = [], subjectId = null }) {
      const now = Date.now()
      const tx = sqlite.transaction(() => {
        const info = sqlite.prepare(
          'INSERT INTO kb_docs (title, type, rel_path, size, hash, subject_id, created_at, updated_at, deleted, client_id) VALUES (?,?,?,?,?,?,?,?,0,?)'
        ).run(title, type, relPath, size, hash || null, subjectId || null, now, now, uuid())
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
    getKbGraph() {
      const nodes = sqlite.prepare('SELECT id, title, type, folder FROM kb_docs WHERE deleted=0').all()
        .map(d => ({ id: d.id, title: d.title, type: d.type, folder: d.folder || '' }))
      const idSet = new Set(nodes.map(n => n.id))
      const links = sqlite.prepare('SELECT from_doc_id, to_doc_id FROM kb_doc_links').all()
        .filter(l => idSet.has(l.from_doc_id) && idSet.has(l.to_doc_id))
      return { nodes, links }
    },

    getKbDocs(subjectId) {
      // subjectId 传具体科目 id → 只返回该科目文档；不传/undefined → 全部
      const rows = (subjectId
        ? sqlite.prepare('SELECT * FROM kb_docs WHERE deleted=0 AND subject_id=? ORDER BY updated_at DESC').all(subjectId)
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
      sqlite.prepare('UPDATE kb_docs SET title=?, hash=?, size=?, subject_id=?, updated_at=? WHERE id=?')
        .run(title, hash, size, subjectId, Date.now(), id)
      return this.getKbDoc(id)
    },

    deleteKbDoc(id) {
      const doc = sqlite.prepare('SELECT * FROM kb_docs WHERE id=?').get(id)
      if (!doc) return { ok: false }
      const tx = sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM kb_links WHERE doc_id=?').run(id)
        sqlite.prepare('DELETE FROM kb_tags WHERE doc_id=?').run(id)
        sqlite.prepare('DELETE FROM kb_blocks WHERE doc_id=?').run(id)
        sqlite.prepare('DELETE FROM kb_docs WHERE id=?').run(id)
      })
      tx()
      try {
        if (doc.rel_path) fs.unlinkSync(path.join(this.kbDir(), doc.rel_path))
      } catch (e) { /* 副本文件可能已被手动删除，忽略 */ }
      return { ok: true }
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
        `SELECT id, title, type, rel_path, updated_at FROM kb_docs
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

    // 文件夹：全部文件夹及其文档数（含"未分类"）
    getKbFolders() {
      const rows = sqlite.prepare(
        "SELECT folder, COUNT(*) AS n FROM kb_docs WHERE deleted=0 GROUP BY folder ORDER BY folder"
      ).all()
      return rows.map(r => ({ folder: r.folder || '未分类', n: r.n }))
    },

    // 移动文档到文件夹（folder 为空串=未分类）
    moveKbDoc(id, folder) {
      sqlite.prepare('UPDATE kb_docs SET folder=?, updated_at=? WHERE id=? AND deleted=0')
        .run(String(folder || '').trim(), Date.now(), id)
      return this.getKbDoc(id)
    },

    // 阅读埋点：打开阅读页 +1（同时给 5 XP，供每日任务「阅读」判定）
    bumpKbRead(id) {
      sqlite.prepare('UPDATE kb_docs SET read_count=read_count+1 WHERE id=? AND deleted=0').run(id)
      const doc = sqlite.prepare('SELECT title FROM kb_docs WHERE id=? AND deleted=0').get(id)
      this.logXp(5, 'kbread', doc ? doc.title : '')
      return { ok: true }
    },

    // MD 在线编辑保存：写回副本文件 + 重新切块 + 更新 hash/size/updated_at
    kbSaveMd(id, content) {
      const doc = sqlite.prepare('SELECT * FROM kb_docs WHERE id=? AND deleted=0').get(id)
      if (!doc) return { ok: false, error: '文档不存在' }
      if (doc.type !== 'md') return { ok: false, error: '仅 MD 文档支持在线编辑' }
      try {
        const text = String(content || '')
        const full = path.join(this.kbDir(), doc.rel_path)
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
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name)
        if (!fs.statSync(full).isFile()) continue
        try { out.push({ relPath: name, base64: fs.readFileSync(full).toString('base64') }) } catch (e) { /* 跳过 */ }
      }
      return out
    },

    // 写回知识库文件（供备份导入 / 同步还原）
    restoreKbFiles(files) {
      const dir = this.kbDir()
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      let n = 0
      for (const f of files || []) {
        if (!f || !f.relPath) continue
        try {
          const full = path.join(dir, path.basename(String(f.relPath)))
          if (!fs.existsSync(full) && f.base64) {
            fs.writeFileSync(full, Buffer.from(f.base64, 'base64'))
            n++
          }
        } catch (e) { /* 单个失败不影响整体 */ }
      }
      return n
    }
  }
}
