// 同步/备份模块：全量导出、ZIP 备份、增量快照、图片独立导出、LWW 合并、导入恢复。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/LOCAL_USER/uuid；
// 依赖 db-cols(EXPORT_COLS)/db-assets(clearImageCache)/sync-merge(lwwMerge, applyFk)/logger；
// this 互调（listKbFiles/restoreKbFiles/backfillClientIds）合并后指向 api。
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { app } = require('electron')
const { lwwMerge, applyFk } = require('./sync-merge')
const { EXPORT_COLS } = require('./db-cols')
const assets = require('./db-assets')
const logger = require('./logger')

module.exports = function syncModule(ctx) {
  const { sqlite, LOCAL_USER, uuid } = ctx

  return {
    exportData() {
      const dump = (table, cols) => {
        // 部分表（kb_blocks/kb_tags/kb_links、materials 等）没有 deleted 列：动态检测避免 SQL 报错
        const hasDel = cols ? cols.includes('deleted')
          : sqlite.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'deleted')
        const sel = cols ? cols.join(',') : '*'
        return sqlite.prepare(`SELECT ${sel} FROM ${table} WHERE ${hasDel ? 'deleted=0' : '1=1'}`).all()
      }
      const COLS = EXPORT_COLS // 列清单已抽到 electron/db-cols.js 统一维护
      // 知识库原件文件：全部 base64 内嵌（md/pdf 都随备份走，保证换机完整迁移）
      const kbFiles = this.listKbFiles()
      return JSON.stringify({
        version: 2,
        exportedAt: Date.now(),
        categories: dump('categories', COLS.categories),
        questions: dump('questions', COLS.questions),
        answerRecords: dump('answer_records', COLS.answerRecords),
        wrongBooks: dump('wrong_books', COLS.wrongBooks),
        favorites: dump('favorites', COLS.favorites),
        notes: dump('notes', COLS.notes),
        papers: dump('papers', COLS.papers),
        paperQuestions: dump('paper_questions', COLS.paperQuestions),
        kbDocs: dump('kb_docs', COLS.kbDocs),
        kbBlocks: dump('kb_blocks', COLS.kbBlocks),
        kbTags: dump('kb_tags', COLS.kbTags),
        kbLinks: dump('kb_links', COLS.kbLinks),
        kbFiles,
        xpLogs: dump('xp_logs'),
        habits: dump('habits'),
        habitChecks: dump('habit_checks'),
        reviewLogs: dump('review_logs'),
        focusSessions: dump('focus_sessions'),
        kbHighlights: dump('kb_highlights'),
        kbDocLinks: dump('kb_doc_links'),
        cards: dump('cards'),
        materials: dump('materials')
      }, null, 2)
    },

    // 全量数据导出 ZIP（零依赖 STORE 打包）：题库 JSON + 图片 + 音频 + 知识库 → userData/exports
    exportAllZip() {
      const { makeZip } = require('./zip')
      const root = app.getPath('userData')
      const files = []
      files.push({ path: 'tiku-data.json', data: Buffer.from(JSON.stringify(this.exportData(), null, 2)) })
      const addDir = (rel, zipPath) => {
        const dir = path.join(root, rel)
        if (!fs.existsSync(dir)) return
        const walk = (d, zp) => {
          for (const name of fs.readdirSync(d)) {
            const full = path.join(d, name)
            try {
              const st = fs.statSync(full)
              if (st.isFile()) files.push({ path: zp + '/' + name, data: fs.readFileSync(full) })
              else if (st.isDirectory()) walk(full, zp + '/' + name)
            } catch (e) { /* 单文件失败跳过 */ }
          }
        }
        walk(dir, zipPath || rel)
      }
      addDir('images', 'images')
      addDir('audio', 'audio')
      addDir('kb', 'kb')
      const outDir = path.join(root, 'exports')
      try { if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true }) } catch (e) {}
      const name = `知识记忆小助手-全量备份-${new Date().toISOString().slice(0, 10)}.zip`
      const out = path.join(outDir, name)
      try { fs.writeFileSync(out, makeZip(files)) } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
      return { ok: true, path: out, size: fs.statSync(out).size, files: files.length }
    },

    exportSync(since = 0) {
      const full = !since
      const eventTables = new Set(['xp_logs', 'habit_checks', 'review_logs', 'focus_sessions'])
      const dump = (table) => {
        if (full) return sqlite.prepare(`SELECT * FROM ${table}`).all()
        const col = eventTables.has(table) ? 'created_at' : 'updated_at'
        return sqlite.prepare(`SELECT * FROM ${table} WHERE ${col} > ? OR ${col} IS NULL`).all(since)
      }

      // 标签：按题目 client_id 携带（question_tags 本身无 client_id）
      const questionTags = (() => {
        if (full) return sqlite.prepare(
          `SELECT qt.tag AS tag, q.client_id AS question_cid
           FROM question_tags qt JOIN questions q ON q.id=qt.question_id
           WHERE q.deleted=0`
        ).all()
        const qcids = sqlite.prepare(`SELECT client_id FROM questions WHERE updated_at > ? OR updated_at IS NULL`).all(since).map(r => r.client_id)
        if (!qcids.length) return []
        const ph = qcids.map(() => '?').join(',')
        return sqlite.prepare(
          `SELECT qt.tag AS tag, q.client_id AS question_cid
           FROM question_tags qt JOIN questions q ON q.id=qt.question_id
           WHERE q.deleted=0 AND q.client_id IN (${ph})`
        ).all(...qcids)
      })()

      // 图片二进制不再内嵌快照：由 exportImageFiles() 单独导出为独立 Gist 文件（见同步编排层），
      // 快照 JSON 仅保留结构化数据，体积大幅瘦身；拉取时按清单按需还原、未变更跳过重传。

      // 知识库：kb_docs（含 client_id）+ 子表按 doc client_id 分组 + MD 文件 base64（PDF 只带 rel_path）
      const kbDocs = dump('kb_docs')
      const incDocCids = new Set(kbDocs.map(d => d.client_id))
      const inIncDocs = (cid) => full || incDocCids.has(cid)
      const kbBlocksByCid = {}
      const kbTagsByCid = {}
      const kbLinksByCid = {}
      const buildDocScoped = (sql, dest) => {
        sqlite.prepare(sql).all().forEach(r => {
          const cid = r.doc_cid
          delete r.doc_cid
          delete r.id
          if (!inIncDocs(cid)) return
          ;(dest[cid] = dest[cid] || []).push(r)
        })
      }
      buildDocScoped('SELECT b.*, d.client_id AS doc_cid FROM kb_blocks b JOIN kb_docs d ON d.id=b.doc_id', kbBlocksByCid)
      buildDocScoped('SELECT t.tag, d.client_id AS doc_cid FROM kb_tags t JOIN kb_docs d ON d.id=t.doc_id', kbTagsByCid)
      buildDocScoped('SELECT l.block_id, l.note, l.created_at, d.client_id AS doc_cid, q.client_id AS question_cid ' +
        'FROM kb_links l JOIN kb_docs d ON d.id=l.doc_id JOIN questions q ON q.id=l.question_id', kbLinksByCid)
      const kbFiles = (() => {
        const files = this.listKbFiles().filter(f => /\.md$/i.test(f.relPath))
        if (full) return files
        const relToCid = new Map(kbDocs.map(d => [d.rel_path, d.client_id]))
        return files.filter(f => relToCid.has(f.relPath) && inIncDocs(relToCid.get(f.relPath)))
      })()

      // 反馈层：高亮/文档双链的 doc 引用转 client_id 携带（多端 id 会错位）
      const kbHighlights = sqlite.prepare(
        'SELECT h.*, d.client_id AS doc_cid FROM kb_highlights h JOIN kb_docs d ON d.id=h.doc_id'
      ).all().filter(r => inIncDocs(r.doc_cid)).map(r => { delete r.doc_id; return r })
      const kbDocLinks = sqlite.prepare(
        'SELECT l.note, l.created_at, l.client_id, a.client_id AS from_cid, b.client_id AS to_cid FROM kb_doc_links l ' +
        'JOIN kb_docs a ON a.id=l.from_doc_id JOIN kb_docs b ON b.id=l.to_doc_id'
      ).all().filter(r => inIncDocs(r.from_cid) || inIncDocs(r.to_cid))

      return JSON.stringify({
        version: 4,
        kind: 'sync',
        exportedAt: Date.now(),
        categories: dump('categories'),
        questions: dump('questions'),
        answerRecords: dump('answer_records'),
        wrongBooks: dump('wrong_books'),
        favorites: dump('favorites'),
        notes: dump('notes'),
        papers: dump('papers'),
        paperQuestions: dump('paper_questions'),
        questionTags,
        kbDocs,
        kbBlocksByCid,
        kbTagsByCid,
        kbLinksByCid,
        kbFiles,
        xpLogs: dump('xp_logs'),
        habits: dump('habits'),
        habitChecks: dump('habit_checks'),
        reviewLogs: dump('review_logs'),
        focusSessions: dump('focus_sessions'),
        cards: dump('cards'),
        kbHighlights,
        kbDocLinks
      }, null, 2)
    },

    // 图片二进制单独导出（不再内嵌快照 JSON）：返回在用图片的 {name, buffer, hash}。
    // 增量模式（since>0）：仅含「增量题目」引用的图；全量：含全部在用图。
    // 二进制走独立 Gist 文件，快照 JSON 瘦身；hash 供同步编排层识别未变更图片跳过重传。
    exportImageFiles(since = 0) {
      const full = !since
      const imgDir = path.join(app.getPath('userData'), 'images')
      if (!fs.existsSync(imgDir)) return []
      const rows = full
        ? sqlite.prepare("SELECT images_json FROM questions WHERE deleted=0 AND images_json IS NOT NULL AND images_json<>'[]'").all()
        : sqlite.prepare("SELECT images_json FROM questions WHERE updated_at > ? OR updated_at IS NULL").all(since)
      const names = new Set()
      rows.forEach(r => { try { JSON.parse(r.images_json || '[]').forEach(n => names.add(String(n))) } catch (e) {} })
      const out = []
      for (const n of names) {
        const base = path.basename(n)
        const fullP = path.join(imgDir, base)
        try {
          if (!fs.existsSync(fullP)) continue
          const buf = fs.readFileSync(fullP)
          out.push({ name: base, buffer: buf, hash: crypto.createHash('sha256').update(buf).digest('hex') })
        } catch (e) { /* 单图失败不影响整体 */ }
      }
      return out
    },

    // 还原图片二进制（来自远端独立图片文件，已解码为 {name, b64}）。
    // 已存在的同名文件不覆盖，避免重复写盘；换设备后用 getImage 不裂图。
    restoreImages(images) {
      assets.clearImageCache() // 图片文件变更后清空缓存，避免读到旧 dataURL
      if (!Array.isArray(images) || !images.length) return 0
      const imgDir = path.join(app.getPath('userData'), 'images')
      try { if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true }) } catch (e) {}
      let n = 0
      for (const im of images) {
        if (!im || !im.name) continue
        const full = path.join(imgDir, path.basename(String(im.name)))
        try {
          if (!fs.existsSync(full) && im.b64) { fs.writeFileSync(full, Buffer.from(im.b64, 'base64')); n++ }
        } catch (e) { /* 单图失败不影响整体 */ }
      }
      return n
    },

    // 合并远端快照到本地：按 client_id upsert，updated_at 较新者胜（LWW），
    mergeRemote(jsonStr) {
      const remote = JSON.parse(jsonStr)
      const kbFilesToRestore = [] // 远端胜出的 MD 文件，tx 后统一写回
      // 各表写入列（client_id 是身份键，不参与 UPDATE 覆盖）
      const cfg = [
        { table: 'categories', cols: ['name', 'parent_id', 'level', 'stage', 'sort', 'client_id', 'parent_cid', 'updated_at', 'deleted'] },
        { table: 'questions', cols: ['category_id', 'type', 'stem', 'options_json', 'answer_json', 'keywords_json', 'analysis', 'difficulty', 'source', 'images_json', 'audio_url', 'material_id', 'material_cid', 'client_id', 'category_cid', 'updated_at', 'deleted'] },
        { table: 'answer_records', cols: ['user_id', 'question_id', 'selected_json', 'is_correct', 'duration_ms', 'mode', 'self_graded', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'] },
        { table: 'wrong_books', cols: ['user_id', 'question_id', 'wrong_count', 'reviewed_count', 'ease', 'interval', 'next_review_at', 'weak_point', 'reason', 'status', 'client_id', 'question_cid', 'updated_at', 'deleted'] },
        { table: 'favorites', cols: ['user_id', 'question_id', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'] },
        { table: 'notes', cols: ['user_id', 'question_id', 'content', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'] },
        { table: 'papers', cols: ['title', 'subject_id', 'duration_minutes', 'total_score', 'rules_json', 'created_at', 'client_id', 'updated_at', 'deleted'] },
        { table: 'paper_questions', cols: ['paper_id', 'seq', 'question_id', 'score', 'client_id', 'question_cid', 'deleted'] },
        { table: 'kb_docs', cols: ['title', 'type', 'rel_path', 'size', 'hash', 'folder', 'read_count', 'created_at', 'updated_at', 'deleted', 'client_id'] },
        // 反馈层（批次功能新增，全部 LWW）
        { table: 'xp_logs', cols: ['user_id', 'xp', 'source', 'note', 'created_at', 'deleted', 'client_id'] },
        { table: 'habits', cols: ['name', 'icon', 'sort', 'created_at', 'updated_at', 'deleted', 'client_id'] },
        { table: 'habit_checks', cols: ['habit_id', 'check_date', 'created_at', 'client_id'], orIgnore: true },
        { table: 'review_logs', cols: ['item_type', 'item_id', 'result', 'created_at', 'client_id'] },
        { table: 'focus_sessions', cols: ['minutes', 'started_at', 'created_at', 'deleted', 'client_id'] },
        { table: 'cards', cols: ['front', 'back', 'category', 'review_at', 'review_count', 'review_lapses', 'created_at', 'updated_at', 'deleted', 'client_id'] },
        { table: 'materials', cols: ['title', 'content', 'subject_id', 'created_at', 'updated_at', 'deleted', 'client_id'] },
        { table: 'kb_highlights', cols: ['doc_id', 'block_id', 'text', 'note', 'color', 'created_at', 'updated_at', 'deleted', 'client_id'] },
        { table: 'kb_doc_links', cols: ['from_doc_id', 'to_doc_id', 'note', 'created_at', 'client_id'], orIgnore: true }
      ]

      let syncConflicts = 0 // 冲突数：同 client_id 双端都有且 updated_at 不同（LWW 按时间戳覆盖）
      const syncConflictItems = [] // 冲突明细（表 + 行标识 + 双端时间戳）
      const makeUpsert = (table, cols, orIgnore = false) => {
        const getByCid = sqlite.prepare(`SELECT * FROM ${table} WHERE client_id=?`)
        const insCols = cols
        const insPh = cols.map(() => '?').join(',')
        const updCols = cols.filter(c => c !== 'client_id')
        const updPh = updCols.map(c => `${c}=?`).join(',')
        const insert = sqlite.prepare(`INSERT ${orIgnore ? 'OR IGNORE' : ''} INTO ${table} (${insCols.join(',')}) VALUES (${insPh})`)
        const update = sqlite.prepare(`UPDATE ${table} SET ${updPh} WHERE client_id=?`)
        const hasTs = cols.includes('updated_at')
        return (r) => {
          if (!r.client_id) r.client_id = uuid() // 兜底：远端缺 client_id 时补一个
          const ex = getByCid.get(r.client_id)
          if (ex) {
            if (hasTs && r.updated_at && ex.updated_at && Number(r.updated_at) !== Number(ex.updated_at)) {
              syncConflicts++
              syncConflictItems.push({ table, key: String(r.client_id).slice(0, 8), localAt: ex.updated_at, remoteAt: r.updated_at })
            }
            update.run(...updCols.map(c => r[c]), r.client_id)
            return ex.id
          }
          const info = insert.run(...cols.map(c => r[c]))
          return info.lastInsertRowid
        }
      }

      const readAll = (table) => sqlite.prepare(`SELECT * FROM ${table}`).all()

      const tx = sqlite.transaction(() => {
        // 1) categories
        const catUpsert = makeUpsert('categories', cfg[0].cols)
        const catMerged = lwwMerge(readAll('categories'), remote.categories || [])
        const catCidToId = new Map()
        for (const r of catMerged) catCidToId.set(r.client_id, catUpsert(r))

        // 1.5) materials（案例题背景材料，独立合并建 cid→id 映射，questions 引用它）
        const matUpsert = makeUpsert('materials', cfg[15].cols)
        const matMerged = lwwMerge(readAll('materials'), remote.materials || [])
        const matCidToId = new Map()
        for (const r of matMerged) matCidToId.set(r.client_id, matUpsert(r))

        // 2) questions（依赖 categories + materials）
        const qUpsert = makeUpsert('questions', cfg[1].cols)
        const qMerged = lwwMerge(readAll('questions'), remote.questions || [])
        applyFk(qMerged, 'category_cid', 'category_id', catCidToId)
        applyFk(qMerged, 'material_cid', 'material_id', matCidToId)
        const qCidToId = new Map()
        for (const r of qMerged) qCidToId.set(r.client_id, qUpsert(r))

        // 2.5) papers（自身无外键依赖 questions，独立合并建 cid→id 映射）
        const paperUpsert = makeUpsert('papers', cfg[6].cols)
        const paperMerged = lwwMerge(readAll('papers'), remote.papers || [])
        const paperCidToId = new Map()
        for (const r of paperMerged) paperCidToId.set(r.client_id, paperUpsert(r))

        // 3) 依赖 questions 的三张表
        const depUpsert = (rows, c) => {
          applyFk(rows, 'question_cid', 'question_id', qCidToId)
          const up = makeUpsert(c.table, c.cols)
          rows.forEach(r => up(r))
          return rows.length
        }
        const arN = depUpsert(lwwMerge(readAll('answer_records'), remote.answerRecords || []), cfg[2])
        const wbN = depUpsert(lwwMerge(readAll('wrong_books'), remote.wrongBooks || []), cfg[3])
        const fvN = depUpsert(lwwMerge(readAll('favorites'), remote.favorites || []), cfg[4])
        const ntN = depUpsert(lwwMerge(readAll('notes'), remote.notes || []), cfg[5])

        // 4) paper_questions（依赖 papers + questions，两个外键都按 cid 解析）
        const pqMerged = lwwMerge(readAll('paper_questions'), remote.paperQuestions || [])
        applyFk(pqMerged, 'question_cid', 'question_id', qCidToId)
        applyFk(pqMerged, 'paper_cid', 'paper_id', paperCidToId)
        const pqUpsert = makeUpsert('paper_questions', cfg[7].cols)
        pqMerged.forEach(r => pqUpsert(r))

        // question_tags：按题目 client_id 解析成本机 question_id
        const qtMerged = remote.questionTags || []
        const qtIns = sqlite.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (?,?)')
        qtMerged.forEach(r => {
          const qid = qCidToId.get(r.question_cid)
          if (qid) qtIns.run(qid, r.tag)
        })

        // 5) 知识库：kb_docs 走 LWW（身份=client_id）；子表（blocks/tags/links）无 client_id，
        // 跨设备 id 错位，跟随「远端胜出的文档」整体重建；MD 文件随快照还原（PDF 仅 rel_path）。
        const kbUpsert = makeUpsert('kb_docs', cfg[8].cols)
        const kbLocalAll = readAll('kb_docs')
        const kbRemoteAll = remote.kbDocs || []
        const kbMerged = lwwMerge(kbLocalAll, kbRemoteAll)
        const kbLocalMap = new Map(kbLocalAll.map(r => [r.client_id, r]))
        const kbRemoteMap = new Map(kbRemoteAll.map(r => [r.client_id, r]))
        const relPathUsed = new Map(kbLocalAll.map(r => [r.rel_path, r.client_id]))
        let kbDocsN = 0
        let kbBlocksN = 0
        let kbTagsN = 0
        let kbLinksN = 0
        const kbCidToId = new Map()
        for (const r of kbMerged) {
          if (!r.client_id) r.client_id = uuid()
          const localRow = kbLocalMap.get(r.client_id)
          const remoteRow = kbRemoteMap.get(r.client_id)
          const remoteWin = !!remoteRow && (!localRow || Number(remoteRow.updated_at || 0) >= Number(localRow.updated_at || 0))
          // rel_path 冲突（对端文件与本地其他 doc 重名）：INSERT 场景换后缀，保证 UNIQUE 不炸
          const origRel = r.rel_path
          if (!localRow && r.rel_path && relPathUsed.has(r.rel_path)) {
            const ext = r.type === 'pdf' ? 'pdf' : 'md'
            r.rel_path = r.rel_path.replace(/\.(md|pdf)$/i, '') + '-' + Date.now() + '.' + ext
          }
          relPathUsed.set(r.rel_path, r.client_id)
          const docId = kbUpsert(r)
          kbCidToId.set(r.client_id, docId)
          kbDocsN++
          if (remoteWin) {
            sqlite.prepare('DELETE FROM kb_blocks WHERE doc_id=?').run(docId)
            sqlite.prepare('DELETE FROM kb_tags WHERE doc_id=?').run(docId)
            sqlite.prepare('DELETE FROM kb_links WHERE doc_id=?').run(docId)
            const insB = sqlite.prepare('INSERT INTO kb_blocks (doc_id, seq, heading, content, char_start, char_end, review_at, review_count, review_lapses) VALUES (?,?,?,?,?,?,?,?,?)')
            for (const b of (remote.kbBlocksByCid && remote.kbBlocksByCid[r.client_id]) || []) {
              insB.run(docId, b.seq || 0, b.heading ?? null, String(b.content || ''), b.char_start ?? null, b.char_end ?? null, b.review_at ?? null, b.review_count || 0, b.review_lapses || 0)
              kbBlocksN++
            }
            const insT = sqlite.prepare('INSERT OR IGNORE INTO kb_tags (doc_id, tag) VALUES (?,?)')
            for (const t of (remote.kbTagsByCid && remote.kbTagsByCid[r.client_id]) || []) {
              insT.run(docId, t.tag)
              kbTagsN++
            }
            const insL = sqlite.prepare('INSERT INTO kb_links (doc_id, block_id, question_id, note, created_at) VALUES (?,?,?,?,?)')
            for (const l of (remote.kbLinksByCid && remote.kbLinksByCid[r.client_id]) || []) {
              const qid = qCidToId.get(l.question_cid)
              if (qid) {
                insL.run(docId, l.block_id ?? null, qid, l.note || '', l.created_at ?? Date.now())
                kbLinksN++
              }
            }
            // 用原始 rel_path 匹配远端文件（重命名发生在上面），落盘用重命名后的新名
            const rf = (remote.kbFiles || []).find(f => f && f.relPath === origRel)
            if (rf && rf.base64) kbFilesToRestore.push({ ...rf, relPath: r.rel_path })
          }
        }

        // 6) 反馈层七张表：全部 LWW（事件行 client_id 唯一，多端合并天然去重；UNIQUE 表用 OR IGNORE）
        const mergeSimple = (cfgIdx, remoteKey) => {
          const c = cfg[cfgIdx]
          const rows = lwwMerge(readAll(c.table), remote[remoteKey] || [])
          const up = makeUpsert(c.table, c.cols, !!c.orIgnore)
          rows.forEach(r => up(r))
          return rows.length
        }
        const xpN = mergeSimple(9, 'xpLogs')
        const hbN = mergeSimple(10, 'habits')
        const hcN = mergeSimple(11, 'habitChecks')
        const rvN = mergeSimple(12, 'reviewLogs')
        const fsN = mergeSimple(13, 'focusSessions')
        const cdN = mergeSimple(14, 'cards') // 修复：cards 此前漏合并，跨端闪卡会丢失/被全量覆盖
        // 高亮/文档双链：doc 引用按 cid 解析成本机 id 后再 upsert
        const hlMerged = lwwMerge(readAll('kb_highlights'), remote.kbHighlights || [])
        applyFk(hlMerged, 'doc_cid', 'doc_id', kbCidToId)
        const hlUp = makeUpsert('kb_highlights', cfg[16].cols) // 修复：原 cfg[14]（cards）索引错位
        hlMerged.forEach(r => hlUp(r))
        const dlMerged = lwwMerge(readAll('kb_doc_links'), remote.kbDocLinks || [])
        applyFk(dlMerged, 'from_cid', 'from_doc_id', kbCidToId)
        applyFk(dlMerged, 'to_cid', 'to_doc_id', kbCidToId)
        const dlUp = makeUpsert('kb_doc_links', cfg[17].cols, true) // 修复：原 cfg[15]（materials）索引错位
        dlMerged.forEach(r => dlUp(r))

        return { categories: catMerged.length, questions: qMerged.length, answerRecords: arN, wrongBooks: wbN, favorites: fvN, notes: ntN, papers: paperMerged.length, paperQuestions: pqMerged.length, kbDocs: kbDocsN, kbBlocks: kbBlocksN, kbTags: kbTagsN, kbLinks: kbLinksN, xpLogs: xpN, habits: hbN, habitChecks: hcN, reviewLogs: rvN, focusSessions: fsN, cards: cdN, kbHighlights: hlMerged.length, kbDocLinks: dlMerged.length, conflicts: syncConflicts, conflictItems: syncConflictItems.slice(0, 50) }
      })
      const result = tx()
      // 图片还原已下沉到独立通道（restoreImages）：拉取后由同步编排层解码远端图片文件并落盘，
      // 不再在此内嵌（快照 JSON 已不含 base64 图片）。仅对旧版仍内嵌 images 的快照做兜底还原，保证兼容。
      if (Array.isArray(remote.images) && remote.images.length) {
        const imgDir = path.join(app.getPath('userData'), 'images')
        try { if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true }) } catch (e) {}
        remote.images.forEach(im => {
          if (!im || !im.name) return
          const full = path.join(imgDir, path.basename(String(im.name)))
          try { if (!fs.existsSync(full) && im.b64) fs.writeFileSync(full, Buffer.from(im.b64, 'base64')) } catch (e) {}
        })
      }
      // 还原知识库 MD 文件（PDF 二进制不进快照，靠 rel_path 提示重导）
      this.restoreKbFiles(kbFilesToRestore)
      logger.info('mergeRemote 完成', {
        questions: result.questions, wrongBooks: result.wrongBooks,
        conflicts: result.conflicts, notes: result.notes
      })
      return result
    },

    // 导入手动备份 JSON（INSERT OR REPLACE，按 id 覆盖；同步预留 updated_at）。
    // 导入前差异预览（不写入）：对比备份 JSON 与当前库，返回新增/更新/本地独有统计，供用户确认
    importPreview(jsonStr) {
      let data
      try { data = JSON.parse(jsonStr) } catch (e) { throw new Error('备份文件不是有效的 JSON') }
      const diff = (table, rows, idCol = 'id') => {
        if (!rows || !rows.length) return { total: 0, fresh: 0, update: 0, localOnly: 0 }
        const ids = new Set(rows.map(r => r[idCol]))
        const local = sqlite.prepare(`SELECT ${idCol} FROM ${table} WHERE deleted=0`).all().map(r => r[idCol])
        const localSet = new Set(local)
        let fresh = 0, update = 0
        for (const id of ids) { if (localSet.has(id)) update++; else fresh++ }
        let localOnly = 0
        for (const id of localSet) { if (!ids.has(id)) localOnly++ }
        return { total: rows.length, fresh, update, localOnly }
      }
      return {
        questions: diff('questions', data.questions),
        categories: diff('categories', data.categories),
        kbDocs: diff('kb_docs', data.kbDocs),
        notes: diff('notes', data.notes),
        wrongBooks: diff('wrong_books', data.wrongBooks),
        otherTables: ['xp_logs', 'habits', 'habit_checks', 'review_logs', 'focus_sessions', 'kb_highlights', 'kb_doc_links', 'cards', 'papers', 'answer_records', 'favorites']
          .filter(t => Array.isArray(data[t]) && data[t].length)
          .length
      }
    },

    // 与 mergeRemote 不同：这里是"整机恢复"，不做 LWW 合并。
    importData(jsonStr) {
      const data = JSON.parse(jsonStr)
      const now = Date.now()
      const replace = (table, rows, cols) => {
        if (!rows || !rows.length) return
        const ph = cols.map(() => '?').join(',')
        const stmt = sqlite.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${ph})`)
        const tx = sqlite.transaction(() => {
          rows.forEach(r => stmt.run(...cols.map(c => r[c])))
        })
        tx()
      }
      replace('categories', data.categories, ['id', 'name', 'parent_id', 'level', 'stage', 'sort', 'client_id', 'parent_cid', 'updated_at', 'deleted'])
      replace('questions', data.questions, ['id', 'category_id', 'type', 'stem', 'options_json', 'answer_json', 'keywords_json', 'analysis', 'difficulty', 'source', 'images_json', 'audio_url', 'material_id', 'material_cid', 'client_id', 'category_cid', 'updated_at', 'deleted'])
      replace('answer_records', data.answerRecords, ['id', 'user_id', 'question_id', 'selected_json', 'is_correct', 'duration_ms', 'mode', 'self_graded', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'])
      replace('wrong_books', data.wrongBooks, ['id', 'user_id', 'question_id', 'wrong_count', 'reviewed_count', 'ease', 'interval', 'next_review_at', 'weak_point', 'status', 'client_id', 'question_cid', 'updated_at', 'deleted'])
      replace('favorites', data.favorites, ['id', 'user_id', 'question_id', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'])
      replace('notes', data.notes, ['id', 'user_id', 'question_id', 'content', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'])
      replace('papers', data.papers, ['id', 'user_id', 'title', 'subject_id', 'duration_minutes', 'total_score', 'rules_json', 'created_at', 'client_id', 'updated_at', 'deleted'])
      replace('paper_questions', data.paperQuestions, ['id', 'paper_id', 'seq', 'question_id', 'score', 'client_id', 'question_cid', 'deleted'])
      // 知识库（老备份无 kb 字段时 replace 自动跳过；文件按需写回）
      replace('kb_docs', data.kbDocs, ['id', 'title', 'type', 'rel_path', 'size', 'hash', 'folder', 'read_count', 'created_at', 'updated_at', 'deleted', 'client_id'])
      ;(data.kbBlocks || []).forEach(b => {
        b.review_at = b.review_at ?? null
        b.review_count = b.review_count ?? 0
        b.review_lapses = b.review_lapses ?? 0
      })
      replace('kb_blocks', data.kbBlocks, ['id', 'doc_id', 'seq', 'heading', 'content', 'char_start', 'char_end', 'review_at', 'review_count', 'review_lapses'])
      replace('kb_tags', data.kbTags, ['doc_id', 'tag'])
      replace('kb_links', data.kbLinks, ['id', 'doc_id', 'block_id', 'question_id', 'note', 'created_at'])
      replace('xp_logs', data.xpLogs, ['id', 'user_id', 'xp', 'source', 'note', 'created_at', 'deleted', 'client_id'])
      replace('habits', data.habits, ['id', 'name', 'icon', 'sort', 'created_at', 'updated_at', 'deleted', 'client_id'])
      replace('habit_checks', data.habitChecks, ['id', 'habit_id', 'check_date', 'created_at', 'client_id'])
      replace('review_logs', data.reviewLogs, ['id', 'item_type', 'item_id', 'result', 'created_at', 'client_id'])
      replace('focus_sessions', data.focusSessions, ['id', 'minutes', 'started_at', 'created_at', 'deleted', 'client_id'])
      replace('kb_highlights', data.kbHighlights, ['id', 'doc_id', 'block_id', 'text', 'note', 'color', 'created_at', 'updated_at', 'deleted', 'client_id'])
      replace('kb_doc_links', data.kbDocLinks, ['id', 'from_doc_id', 'to_doc_id', 'note', 'created_at', 'client_id'])
      ;(data.cards || []).forEach(c => {
        c.review_at = c.review_at ?? null
        c.review_count = c.review_count ?? 0
        c.review_lapses = c.review_lapses ?? 0
      })
      replace('cards', data.cards, ['id', 'front', 'back', 'category', 'review_at', 'review_count', 'review_lapses', 'created_at', 'updated_at', 'deleted', 'client_id'])
      replace('materials', data.materials, ['id', 'title', 'content', 'subject_id', 'created_at', 'updated_at', 'deleted', 'client_id'])
      this.restoreKbFiles(data.kbFiles)
      // 补齐可能缺失的 client_id（老备份无 cid 列）
      this.backfillClientIds()
      return { ok: true, imported: (data.questions || []).length, kbDocs: (data.kbDocs || []).length }
    }
  }
}
