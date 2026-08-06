const Database = require('better-sqlite3')
const path = require('path')
const crypto = require('crypto')
const fs = require('fs')
const { app } = require('electron')
const sample = require('./sampleData')
const { lwwMerge, applyFk } = require('./sync-merge')

// 本地用户固定为 id=1（纯本地单用户；云同步只同步"学习数据"，不区分账号行）。
const LOCAL_USER = 1

const uuid = () => crypto.randomUUID()

let sqlite

function dbPath() {
  try {
    return path.join(app.getPath('userData'), 'tiku.db')
  } catch (e) {
    // 非 Electron 环境兜底（一般不会走到）
    return path.join(__dirname, 'tiku.db')
  }
}

// 收集某科目（及其所有子孙章节）的 id，用于"科目范围"拉题
function descendantCategoryIds(subjectId) {
  const rows = sqlite.prepare('SELECT id, parent_id FROM categories WHERE deleted=0').all()
  const childrenOf = {}
  rows.forEach(r => { (childrenOf[r.parent_id] = childrenOf[r.parent_id] || []).push(r.id) })
  const out = []
  const stack = [subjectId]
  while (stack.length) {
    const id = stack.pop()
    out.push(id)
    ;(childrenOf[id] || []).forEach(c => stack.push(c))
  }
  return out
}

// 艾宾浩斯间隔复习：连续答对次数 → 下次复习间隔（天）
function scheduleNextReview(reviewedCount) {
  const days = [1, 2, 4, 7, 15, 30, 60][Math.min(reviewedCount, 6)]
  return Date.now() + days * 86400000
}

// 取某题/某分类的 client_id（外键 cid 解析用）
function questionCid(id) {
  const r = sqlite.prepare('SELECT client_id FROM questions WHERE id=?').get(id)
  return r ? r.client_id : null
}
function categoryCid(id) {
  const r = sqlite.prepare('SELECT client_id FROM categories WHERE id=?').get(id)
  return r ? r.client_id : null
}

const api = {
  init() {
    sqlite = new Database(dbPath())
    sqlite.pragma('journal_mode = WAL')
    this.initSchema()
    this.migrateSchema()
    this.ensureUser()
    this.seedIfEmpty()
    this.backfillClientIds() // 老库/样例数据补齐 client_id 与 *_cid，保证可同步
    return this
  },

  close() {
    if (sqlite) sqlite.close()
  },

  initSchema() {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        total_answered INTEGER DEFAULT 0,
        correct_count INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER,
        client_id TEXT
      );
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id INTEGER,
        level INTEGER,
        stage TEXT,
        sort INTEGER DEFAULT 0,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        parent_cid TEXT
      );
      CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY,
        category_id INTEGER,
        type TEXT,
        stem TEXT,
        options_json TEXT,
        answer_json TEXT,
        analysis TEXT,
        difficulty INTEGER,
        source TEXT,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        category_cid TEXT
      );
      CREATE TABLE IF NOT EXISTS answer_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        question_id INTEGER,
        selected_json TEXT,
        is_correct INTEGER,
        duration_ms INTEGER,
        mode TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        question_cid TEXT
      );
      CREATE TABLE IF NOT EXISTS wrong_books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        question_id INTEGER,
        wrong_count INTEGER DEFAULT 0,
        reviewed_count INTEGER DEFAULT 0,
        next_review_at INTEGER,
        weak_point TEXT,
        status TEXT DEFAULT 'wrong',
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        question_cid TEXT
      );
      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        question_id INTEGER,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        question_cid TEXT
      );
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        question_id INTEGER,
        content TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        question_cid TEXT
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS papers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT,
        subject_id INTEGER,
        duration_minutes INTEGER,
        total_score REAL,
        rules_json TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT
      );
      CREATE TABLE IF NOT EXISTS paper_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id INTEGER,
        seq INTEGER,
        question_id INTEGER,
        score REAL,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        question_cid TEXT
      );
      CREATE TABLE IF NOT EXISTS question_tags (
        question_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (question_id, tag)
      );
      CREATE TABLE IF NOT EXISTS kb_docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'md',
        rel_path TEXT NOT NULL UNIQUE,
        size INTEGER DEFAULT 0,
        hash TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT
      );
      CREATE TABLE IF NOT EXISTS kb_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        heading TEXT,
        content TEXT NOT NULL,
        char_start INTEGER,
        char_end INTEGER
      );
      CREATE TABLE IF NOT EXISTS kb_tags (
        doc_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (doc_id, tag)
      );
      CREATE TABLE IF NOT EXISTS kb_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL,
        block_id INTEGER,
        question_id INTEGER NOT NULL,
        note TEXT,
        created_at INTEGER,
        UNIQUE (doc_id, question_id)
      );
      CREATE INDEX IF NOT EXISTS idx_kb_blocks_doc ON kb_blocks(doc_id);
      CREATE INDEX IF NOT EXISTS idx_kb_links_q ON kb_links(question_id);
      CREATE INDEX IF NOT EXISTS idx_kb_docs_deleted ON kb_docs(deleted);
    `)
  },

  // 轻量迁移：老版本装过的库没有新列，这里按需 ALTER，保证升级后不丢数据也不报错。
  // 规则：只做「加列」这种绝对安全的操作，绝不改列类型 / 删列。
  migrateSchema() {
    const addColumn = (table, column, ddl) => {
      const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
      if (!cols.includes(column)) {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
        return true
      }
      return false
    }
    // 问答题的「得分关键词」
    addColumn('questions', 'keywords_json', 'keywords_json TEXT')
    // 问答题自评标记
    addColumn('answer_records', 'self_graded', 'self_graded INTEGER DEFAULT 0')
    // 云同步身份列 + 外键 cid
    addColumn('users', 'client_id', 'client_id TEXT')
    addColumn('categories', 'client_id', 'client_id TEXT')
    addColumn('categories', 'parent_cid', 'parent_cid TEXT')
    addColumn('questions', 'client_id', 'client_id TEXT')
    addColumn('questions', 'category_cid', 'category_cid TEXT')
    addColumn('questions', 'images_json', 'images_json TEXT')
    addColumn('answer_records', 'client_id', 'client_id TEXT')
    addColumn('answer_records', 'question_cid', 'question_cid TEXT')
    addColumn('wrong_books', 'client_id', 'client_id TEXT')
    addColumn('wrong_books', 'question_cid', 'question_cid TEXT')
    addColumn('favorites', 'client_id', 'client_id TEXT')
    addColumn('favorites', 'question_cid', 'question_cid TEXT')
    addColumn('notes', 'client_id', 'client_id TEXT')
    addColumn('notes', 'question_cid', 'question_cid TEXT')
  },

  // 给历史数据/样例数据补齐 client_id 与 *_cid（按 client_id 做跨设备身份，否则无法匹配）。
  backfillClientIds() {
    const setCid = (table) => {
      const rows = sqlite.prepare(`SELECT id FROM ${table} WHERE client_id IS NULL OR client_id=''`).all()
      if (!rows.length) return
      const upd = sqlite.prepare(`UPDATE ${table} SET client_id=? WHERE id=?`)
      const tx = sqlite.transaction(() => rows.forEach(r => upd.run(uuid(), r.id)))
      tx()
    }
    ;['users', 'categories', 'questions', 'answer_records', 'wrong_books', 'favorites', 'notes', 'papers'].forEach(setCid)

    const fix = (table, fkCol, refTable, refCol) =>
      sqlite.prepare(`UPDATE ${table} SET ${fkCol}=(SELECT client_id FROM ${refTable} r WHERE r.id=${table}.${refCol})
                      WHERE ${fkCol} IS NULL AND ${refCol} IS NOT NULL`).run()
    fix('questions', 'category_cid', 'categories', 'category_id')
    fix('answer_records', 'question_cid', 'questions', 'question_id')
    fix('wrong_books', 'question_cid', 'questions', 'question_id')
    fix('favorites', 'question_cid', 'questions', 'question_id')
    fix('notes', 'question_cid', 'questions', 'question_id')
    fix('categories', 'parent_cid', 'categories', 'parent_id')
  },

  ensureUser() {
    const u = sqlite.prepare('SELECT id FROM users WHERE id=?').get(LOCAL_USER)
    if (!u) {
      sqlite.prepare('INSERT INTO users (id, name, created_at, updated_at, client_id) VALUES (?,?,?,?,?)')
        .run(LOCAL_USER, '本地用户', Date.now(), Date.now(), uuid())
    }
  },

  // 首次启动且题库为空时，灌入考证样例数据（二级建造师）。
  seedIfEmpty() {
    const count = sqlite.prepare('SELECT COUNT(*) AS n FROM categories').get().n
    if (count > 0) return
    const now = Date.now()
    const insC = sqlite.prepare('INSERT INTO categories (id,name,parent_id,level,stage,sort,updated_at,client_id) VALUES (?,?,?,?,?,?,?,?)')
    const insQ = sqlite.prepare('INSERT INTO questions (id,category_id,type,stem,options_json,answer_json,keywords_json,analysis,difficulty,source,updated_at,client_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    const tx = sqlite.transaction(() => {
      for (const c of sample.categories) {
        insC.run(c.id, c.name, c.parent_id ?? null, c.level, c.stage ?? null, c.sort ?? 0, now, uuid())
      }
      for (const q of sample.questions) {
        insQ.run(q.id, q.category_id, q.type, q.stem, JSON.stringify(q.options || []),
          JSON.stringify(q.answer || []), JSON.stringify(q.keywords || []),
          q.analysis, q.difficulty ?? 3, q.source ?? '样题', now, uuid())
      }
    })
    tx()
  },

  // 设置项（同步配置等轻量 KV）
  getSetting(key) {
    const r = sqlite.prepare('SELECT value FROM settings WHERE key=?').get(key)
    return r ? r.value : null
  },
  setSetting(key, value) {
    sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(key, String(value))
    return { ok: true }
  },

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

  // 按 id 取单题（含解析后的选项/答案/标签），联动面板点开题目速览用
  getQuestionById(id) {
    const r = sqlite.prepare('SELECT * FROM questions WHERE id=? AND deleted=0').get(id)
    if (!r) return null
    return {
      ...r,
      options: JSON.parse(r.options_json || '[]'),
      answer: JSON.parse(r.answer_json || '[]'),
      keywords: r.keywords_json ? JSON.parse(r.keywords_json) : [],
      images: r.images_json ? JSON.parse(r.images_json) : [],
      tags: sqlite.prepare('SELECT tag FROM question_tags WHERE question_id=? ORDER BY tag').all(id).map(x => x.tag)
    }
  },

  getQuestions({ subjectId, categoryId, mode, limit, keyword, tags } = {}) {
    // 弱点强化：按错题数/正确率加权返回最弱的题，不走普通筛选
    if (mode === 'weak') {
      return this.getWeakQuestions(limit ? Number(limit) : 30, subjectId, categoryId)
    }
    let sql = 'SELECT * FROM questions WHERE deleted=0'
    const params = []
    if (categoryId) {
      sql += ' AND category_id=?'
      params.push(categoryId)
    } else if (subjectId) {
      const ids = descendantCategoryIds(subjectId)
      if (!ids.length) return []
      sql += ' AND category_id IN (' + ids.map(() => '?').join(',') + ')'
      params.push(...ids)
    }
    if (keyword) {
      sql += ' AND stem LIKE ?'
      params.push(`%${keyword}%`)
    }
    if (mode === 'wrong') {
      const ids = sqlite.prepare("SELECT question_id FROM wrong_books WHERE user_id=? AND status='wrong' AND deleted=0").all(LOCAL_USER).map(w => w.question_id)
      if (!ids.length) return []
      sql += ' AND id IN (' + ids.map(() => '?').join(',') + ')'
      params.push(...ids)
    } else if (mode === 'favorite') {
      const ids = sqlite.prepare('SELECT question_id FROM favorites WHERE user_id=? AND deleted=0').all(LOCAL_USER).map(f => f.question_id)
      if (!ids.length) return []
      sql += ' AND id IN (' + ids.map(() => '?').join(',') + ')'
      params.push(...ids)
    } else if (mode === 'unattempted') {
      sql += ' AND id NOT IN (SELECT question_id FROM answer_records WHERE user_id=? AND deleted=0)'
      params.push(LOCAL_USER)
    } else if (mode === 'review-due') {
      const ids = sqlite.prepare("SELECT question_id FROM wrong_books WHERE user_id=? AND status='wrong' AND deleted=0 AND (next_review_at IS NULL OR next_review_at<=?)")
        .all(LOCAL_USER, Date.now()).map(w => w.question_id)
      if (!ids.length) return []
      sql += ' AND id IN (' + ids.map(() => '?').join(',') + ')'
      params.push(...ids)
    }
    if (tags && tags.length) {
      // 按标签筛选：题目须带全部所选标签（AND 语义），通过 question_tags 子查询解析
      tags.forEach(t => {
        sql += ' AND id IN (SELECT question_id FROM question_tags WHERE tag=?)'
        params.push(t)
      })
    }
    sql += ' ORDER BY id ASC'
    if (limit) {
      sql += ' LIMIT ?'
      params.push(limit)
    }
    const rows = sqlite.prepare(sql).all(...params)
    return rows.map(r => ({
      ...r,
      options: JSON.parse(r.options_json || '[]'),
      answer: JSON.parse(r.answer_json || '[]'),
      keywords: r.keywords_json ? JSON.parse(r.keywords_json) : [],
      images: r.images_json ? JSON.parse(r.images_json) : []
    }))
  },

  submitAnswer({ questionId, selected, durationMs, mode, selfGrade }) {
    const q = sqlite.prepare('SELECT * FROM questions WHERE id=?').get(questionId)
    if (!q) return { error: 'question not found' }

    const isEssay = q.type === 'essay'
    let correct
    if (isEssay) {
      correct = selfGrade === true
    } else {
      correct = JSON.stringify([...selected].sort()) === JSON.stringify([...JSON.parse(q.answer_json || '[]')].sort())
    }
    const now = Date.now()
    const qCid = q.client_id

    sqlite.prepare(`INSERT INTO answer_records
      (user_id, question_id, selected_json, is_correct, duration_ms, mode, self_graded, created_at, updated_at, client_id, question_cid)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(LOCAL_USER, questionId, JSON.stringify(selected), correct ? 1 : 0, durationMs || 0, mode || 'practice', isEssay ? 1 : 0, now, now, uuid(), qCid)

    sqlite.prepare('UPDATE users SET total_answered=total_answered+1, correct_count=correct_count+?, updated_at=? WHERE id=?')
      .run(correct ? 1 : 0, now, LOCAL_USER)

    if (!correct) {
      sqlite.prepare(`INSERT INTO wrong_books (user_id, question_id, wrong_count, reviewed_count, status, next_review_at, updated_at, client_id, question_cid)
        VALUES (?,?,1,0,?,?,?,?,?)
        ON CONFLICT(user_id, question_id) DO UPDATE SET
          wrong_count=wrong_books.wrong_count+1,
          reviewed_count=0,
          status='wrong',
          next_review_at=excluded.next_review_at,
          updated_at=?`)
        .run(LOCAL_USER, questionId, 'wrong', scheduleNextReview(0), now, uuid(), qCid, now)
    } else {
      const wb = sqlite.prepare('SELECT id, reviewed_count FROM wrong_books WHERE user_id=? AND question_id=?').get(LOCAL_USER, questionId)
      if (wb) {
        const rc = (wb.reviewed_count || 0) + 1
        const graduated = rc >= 3
        sqlite.prepare('UPDATE wrong_books SET reviewed_count=?, status=?, next_review_at=?, updated_at=? WHERE id=?')
          .run(rc, graduated ? 'mastered' : 'wrong', scheduleNextReview(rc), now, wb.id)
      }
    }

    return {
      isCorrect: correct,
      analysis: q.analysis,
      answer: JSON.parse(q.answer_json || '[]'),
      options: JSON.parse(q.options_json || '[]'),
      keywords: q.keywords_json ? JSON.parse(q.keywords_json) : [],
      stem: q.stem,
      type: q.type,
      selfGraded: isEssay
    }
  },

  getWrongBook() {
    const rows = sqlite.prepare(`SELECT w.*, q.stem, q.type, q.options_json, q.answer_json, q.analysis
      FROM wrong_books w JOIN questions q ON q.id=w.question_id
      WHERE w.user_id=? AND w.status='wrong' AND w.deleted=0`).all(LOCAL_USER)
    return rows.map(r => ({
      ...r,
      options: JSON.parse(r.options_json),
      answer: JSON.parse(r.answer_json),
      images: r.images_json ? JSON.parse(r.images_json) : []
    }))
  },

  getFavorites() {
    const rows = sqlite.prepare(`SELECT f.*, q.stem, q.type, q.options_json, q.answer_json
      FROM favorites f JOIN questions q ON q.id=f.question_id
      WHERE f.user_id=? AND f.deleted=0`).all(LOCAL_USER)
    return rows.map(r => ({
      ...r,
      options: JSON.parse(r.options_json),
      answer: JSON.parse(r.answer_json),
      images: r.images_json ? JSON.parse(r.images_json) : []
    }))
  },

  toggleFavorite(questionId) {
    const ex = sqlite.prepare('SELECT id FROM favorites WHERE user_id=? AND question_id=? AND deleted=0').get(LOCAL_USER, questionId)
    if (ex) {
      sqlite.prepare('UPDATE favorites SET deleted=1, updated_at=? WHERE id=?').run(Date.now(), ex.id)
      return { favorited: false }
    }
    sqlite.prepare('INSERT INTO favorites (user_id, question_id, created_at, updated_at, client_id, question_cid) VALUES (?,?,?,?,?,?)')
      .run(LOCAL_USER, questionId, Date.now(), Date.now(), uuid(), questionCid(questionId))
    return { favorited: true }
  },

  // ============ 题目笔记 ============
  getNote(questionId) {
    const r = sqlite.prepare('SELECT content, updated_at FROM notes WHERE user_id=? AND question_id=? AND deleted=0')
      .get(LOCAL_USER, questionId)
    return r ? { content: r.content || '', updatedAt: r.updated_at } : { content: '', updatedAt: null }
  },

  saveNote({ questionId, content }) {
    const text = String(content == null ? '' : content).trim()
    const now = Date.now()
    if (!text) {
      sqlite.prepare('UPDATE notes SET content=?, deleted=1, updated_at=? WHERE user_id=? AND question_id=?')
        .run('', now, LOCAL_USER, questionId)
      return { ok: true, content: '', deleted: true }
    }
    sqlite.prepare(`INSERT INTO notes (user_id, question_id, content, created_at, updated_at, deleted, client_id, question_cid)
      VALUES (?,?,?,?,?,0,?,?)
      ON CONFLICT(user_id, question_id) DO UPDATE SET
        content=excluded.content,
        deleted=0,
        updated_at=excluded.updated_at`)
      .run(LOCAL_USER, questionId, text, now, now, uuid(), questionCid(questionId))
    return { ok: true, content: text, deleted: false }
  },

  listNotes() {
    return sqlite.prepare(`SELECT n.question_id, n.content, n.updated_at,
        q.stem, q.type, c.name AS category
      FROM notes n
      JOIN questions q ON q.id=n.question_id AND q.deleted=0
      LEFT JOIN categories c ON c.id=q.category_id
      WHERE n.user_id=? AND n.deleted=0 AND TRIM(IFNULL(n.content,''))<>''
      ORDER BY n.updated_at DESC`).all(LOCAL_USER)
  },

  getNotedQuestionIds() {
    return sqlite.prepare("SELECT question_id FROM notes WHERE user_id=? AND deleted=0 AND TRIM(IFNULL(content,''))<>''")
      .all(LOCAL_USER).map(r => r.question_id)
  },

  // ============ 题目图片 ============
  // 图片存 userData/images/，questions.images_json 存相对文件名数组（如 ["a.png","b.png"]）。
  ensureImageDir() {
    const dir = path.join(app.getPath('userData'), 'images')
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
    return dir
  },
  saveImage(buffer, ext = 'png') {
    const dir = this.ensureImageDir()
    const safeExt = String(ext || 'png').replace(/[^\w]/g, '').slice(0, 6) || 'png'
    const name = uuid() + '.' + safeExt
    fs.writeFileSync(path.join(dir, name), Buffer.from(buffer))
    return name
  },
  getImage(name) {
    if (!name) return null
    const dir = path.join(app.getPath('userData'), 'images')
    const full = path.join(dir, path.basename(String(name)))
    try {
      if (!fs.existsSync(full)) return null
      const b64 = fs.readFileSync(full).toString('base64')
      const ext = path.extname(name).slice(1).toLowerCase() || 'png'
      return `data:image/${ext};base64,${b64}`
    } catch (e) { return null }
  },

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
    const autoCount = rules.filter(r => manualScoreOf(r) == null).reduce((s, r) => s + (Number(r.count) || 0), 0)
    const autoTotal = Math.max(0, Math.round((100 - manualTotal) * 10) / 10)
    const autoEach = autoCount ? Math.round((autoTotal / autoCount) * 10) / 10 : 0

    const scores = picked.map(p => (perTypeManual[p.type] != null ? perTypeManual[p.type] : autoEach))
    const target = Math.round((manualTotal + autoTotal) * 10) / 10
    const sum0 = Math.round(scores.reduce((s, x) => s + x, 0) * 10) / 10
    const lastAutoIdx = scores.length - 1 - [...scores].reverse().findIndex(s => s === autoEach)
    if (lastAutoIdx >= 0 && scores[lastAutoIdx] === autoEach) {
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

  // ============ 薄弱分析 / 相似题 / 弱点抽题 ============
  // 薄弱章节：正确率升序、错题数降序（用于错题页高亮最弱章节）
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
  },

  // ============ 题目批量操作 ============
  // patch: { categoryId, difficulty, addTags:[], setTags:[] }；软删兼容同步
  batchUpdateQuestions(ids, patch = {}) {
    const list = (ids || []).map(Number).filter(Boolean)
    if (!list.length) return { ok: true, updated: 0 }
    const now = Date.now()
    const tx = sqlite.transaction(() => {
      for (const id of list) {
        if (patch.categoryId != null) {
          sqlite.prepare('UPDATE questions SET category_id=?, category_cid=?, updated_at=? WHERE id=?')
            .run(Number(patch.categoryId), categoryCid(Number(patch.categoryId)), now, id)
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
  },

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

  // 游戏化成就所需的全部原始指标（成就定义在前端，按阈值派生「已解锁」状态）
  getAchievements() {
    const s = this.getSummary()
    const totalAnswered = sqlite.prepare('SELECT COUNT(*) AS n FROM answer_records WHERE user_id=? AND deleted=0').get(LOCAL_USER).n
    const papersCount = sqlite.prepare('SELECT COUNT(*) AS n FROM papers WHERE deleted=0').get().n
    const notesCount = sqlite.prepare("SELECT COUNT(*) AS n FROM notes WHERE user_id=? AND deleted=0 AND TRIM(IFNULL(content,''))<>''").get(LOCAL_USER).n
    const tagsUsed = sqlite.prepare('SELECT COUNT(DISTINCT tag) AS n FROM question_tags').get().n
    const favCount = sqlite.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id=? AND deleted=0').get(LOCAL_USER).n
    return {
      streak: s.streak, today: s.today, activeDays: s.activeDays,
      totalAnswered, mastered: s.mastered, wrongCount: s.wrongCount,
      papersCount, notesCount, tagsUsed, favCount,
      dailyGoal: Number(this.getSetting('daily_goal') || 0)
    }
  },

  getSummary() {
    const total = sqlite.prepare('SELECT COUNT(*) AS n FROM questions WHERE deleted=0').get().n
    const learned = sqlite.prepare('SELECT COUNT(DISTINCT question_id) AS n FROM answer_records WHERE user_id=? AND deleted=0').get(LOCAL_USER).n
    const mastered = sqlite.prepare(`SELECT COUNT(DISTINCT question_id) AS n FROM answer_records
      WHERE user_id=? AND deleted=0 AND is_correct=1`).get(LOCAL_USER).n
    const todayStart = new Date().setHours(0, 0, 0, 0)
    const today = sqlite.prepare('SELECT COUNT(*) AS n FROM answer_records WHERE user_id=? AND deleted=0 AND created_at>=?').get(LOCAL_USER, todayStart).n
    const wrongCount = sqlite.prepare("SELECT COUNT(*) AS n FROM wrong_books WHERE user_id=? AND status='wrong' AND deleted=0").get(LOCAL_USER).n

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

    return { total, learned, mastered, today, wrongCount, activeDays, streak }
  },

  getChapterProgress(subjectId) {
    const sql = subjectId
      ? 'SELECT id FROM categories WHERE deleted=0 AND parent_id=? ORDER BY sort, id'
      : 'SELECT id FROM categories WHERE deleted=0 AND parent_id IS NOT NULL AND parent_id!=0 ORDER BY sort, id'
    const chapters = sqlite.prepare(sql).all(...(subjectId ? [subjectId] : []))
    const result = []
    for (const ch of chapters) {
      const cat = sqlite.prepare('SELECT id, name FROM categories WHERE id=?').get(ch.id)
      const stat = sqlite.prepare(`SELECT COUNT(*) AS n, SUM(is_correct) AS c
        FROM answer_records ar JOIN questions q ON q.id=ar.question_id
        WHERE ar.user_id=? AND ar.deleted=0 AND q.category_id=?`).get(LOCAL_USER, ch.id)
      const totalQ = sqlite.prepare('SELECT COUNT(*) AS n FROM questions WHERE deleted=0 AND category_id=?').get(ch.id).n
      result.push({
        id: ch.id,
        name: cat.name,
        totalQ: totalQ || 0,
        answered: stat.n || 0,
        correct: stat.c || 0,
        rate: stat.n ? Math.round(((stat.c || 0) / stat.n) * 100) : 0
      })
    }
    return result
  },

  getWeeklyTrend() {
    const days = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      d.setHours(0, 0, 0, 0)
      const start = d.getTime()
      const end = start + 24 * 60 * 60 * 1000
      const row = sqlite.prepare('SELECT COUNT(*) AS n FROM answer_records WHERE user_id=? AND deleted=0 AND created_at>=? AND created_at<?')
        .get(LOCAL_USER, start, end)
      days.push({ date: d.toISOString().slice(0, 10), count: row.n || 0 })
    }
    return days
  },

  getMonthlyCalendar(year, month) {
    const start = new Date(year, month - 1, 1).getTime()
    const end = new Date(year, month, 1).getTime()
    const rows = sqlite.prepare(`SELECT DATE(created_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS n
      FROM answer_records
      WHERE user_id=? AND deleted=0 AND created_at>=? AND created_at<?
      GROUP BY day`).all(LOCAL_USER, start, end)
    const map = {}
    rows.forEach(r => { map[r.day] = r.n })
    return map
  },

  getRecentRecords(limit = 5) {
    return sqlite.prepare(`SELECT ar.*, q.stem
      FROM answer_records ar JOIN questions q ON q.id=ar.question_id
      WHERE ar.user_id=? AND ar.deleted=0
      ORDER BY ar.created_at DESC LIMIT ?`).all(LOCAL_USER, limit)
  },

  clearUserData() {
    sqlite.prepare('DELETE FROM answer_records WHERE user_id=?').run(LOCAL_USER)
    sqlite.prepare('DELETE FROM wrong_books WHERE user_id=?').run(LOCAL_USER)
    sqlite.prepare('DELETE FROM favorites WHERE user_id=?').run(LOCAL_USER)
    sqlite.prepare('DELETE FROM notes WHERE user_id=?').run(LOCAL_USER)
    sqlite.prepare('UPDATE users SET total_answered=0, correct_count=0, updated_at=? WHERE id=?').run(Date.now(), LOCAL_USER)
    sqlite.prepare("DELETE FROM settings WHERE key='current_subject_id'").run()
    return { ok: true }
  },

  // ============ 题库管理：录入 / 编辑 / 批量导入 ============

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
    })
    tx()
    return { ok: true, removedCategories: ids.length }
  },

  importQuestionBank(rows, opts = {}) {
    const { defaultSubjectId = null, skipDuplicate = true } = opts
    const now = Date.now()
    const insQ = sqlite.prepare(`INSERT INTO questions
      (category_id,type,stem,options_json,answer_json,keywords_json,analysis,difficulty,source,updated_at,client_id,category_cid)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    const dupStmt = sqlite.prepare('SELECT id FROM questions WHERE category_id=? AND stem=? AND deleted=0')
    let inserted = 0
    let duplicated = 0
    let skipped = 0
    const touched = new Set()
    const tx = sqlite.transaction(() => {
      for (const r of rows || []) {
        let subjectId = defaultSubjectId
        if (r.subject) subjectId = this.upsertCategoryByName(r.subject, null, 1)
        if (!subjectId) { skipped++; continue }
        const categoryId = r.chapter ? this.upsertCategoryByName(r.chapter, subjectId, 2) : subjectId
        if (skipDuplicate && dupStmt.get(categoryId, r.stem)) { duplicated++; continue }
        insQ.run(
          categoryId, r.type, r.stem,
          JSON.stringify(r.options || []), JSON.stringify(r.answer || []),
          JSON.stringify(r.keywords || []),
          r.analysis || '', r.difficulty || 3, r.source || '导入', now,
          uuid(), categoryCid(categoryId)
        )
        inserted++
        touched.add(subjectId)
      }
    })
    tx()
    return { ok: true, inserted, duplicated, skipped, subjects: Array.from(touched) }
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
      where += ' AND q.stem LIKE ?'
      params.push(`%${keyword}%`)
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
        tags: sqlite.prepare('SELECT tag FROM question_tags WHERE question_id=? ORDER BY tag').all(r.id).map(x => x.tag)
      }))
    }
  },

  addQuestion(q) {
    const info = sqlite.prepare(`INSERT INTO questions
      (category_id,type,stem,options_json,answer_json,keywords_json,analysis,difficulty,source,images_json,updated_at,client_id,category_cid)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(q.categoryId, q.type, q.stem, JSON.stringify(q.options || []),
        JSON.stringify(q.answer || []), JSON.stringify(q.keywords || []),
        q.analysis || '', q.difficulty || 3,
        q.source || '手动录入', JSON.stringify(q.images || []),
        Date.now(), uuid(), categoryCid(q.categoryId))
    return { ok: true, id: info.lastInsertRowid }
  },

  updateQuestion(q) {
    sqlite.prepare(`UPDATE questions SET category_id=?,type=?,stem=?,options_json=?,
      answer_json=?,keywords_json=?,analysis=?,difficulty=?,source=?,images_json=?,updated_at=?,category_cid=? WHERE id=?`)
      .run(q.categoryId, q.type, q.stem, JSON.stringify(q.options || []),
        JSON.stringify(q.answer || []), JSON.stringify(q.keywords || []),
        q.analysis || '', q.difficulty || 3,
        q.source || '手动录入', JSON.stringify(q.images || []),
        Date.now(), categoryCid(q.categoryId), q.id)
    return { ok: true }
  },

  deleteQuestion(id) {
    sqlite.prepare('UPDATE questions SET deleted=1, updated_at=? WHERE id=?').run(Date.now(), id)
    return { ok: true }
  },

  getBankStats() {
    const total = sqlite.prepare('SELECT COUNT(*) AS n FROM questions WHERE deleted=0').get().n
    const byType = sqlite.prepare('SELECT type, COUNT(*) AS n FROM questions WHERE deleted=0 GROUP BY type').all()
    const bySubject = sqlite.prepare(
      `SELECT s.id, s.name, COUNT(q.id) AS n FROM categories s
       LEFT JOIN categories c ON (c.id = s.id OR c.parent_id = s.id) AND c.deleted=0
       LEFT JOIN questions q ON q.category_id = c.id AND q.deleted=0
       WHERE s.deleted=0 AND (s.parent_id IS NULL OR s.parent_id=0)
       GROUP BY s.id, s.name ORDER BY s.sort, s.id`
    ).all()
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

  // 导出整库（仅未删除行）为 JSON，用于手动备份 / 迁移到别的机器。
  // 含 client_id 与 *_cid，保证再导入时身份不丢。
  exportData() {
    const dump = (table, cols) => {
      const rows = sqlite.prepare(`SELECT ${cols.join(',')} FROM ${table} WHERE deleted=0`).all()
      return rows
    }
    const COLS = {
      categories: ['id', 'name', 'parent_id', 'level', 'stage', 'sort', 'client_id', 'parent_cid', 'updated_at', 'deleted'],
      questions: ['id', 'category_id', 'type', 'stem', 'options_json', 'answer_json', 'keywords_json', 'analysis', 'difficulty', 'source', 'images_json', 'client_id', 'category_cid', 'updated_at', 'deleted'],
      answerRecords: ['id', 'user_id', 'question_id', 'selected_json', 'is_correct', 'duration_ms', 'mode', 'self_graded', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'],
      wrongBooks: ['id', 'user_id', 'question_id', 'wrong_count', 'reviewed_count', 'next_review_at', 'weak_point', 'status', 'client_id', 'question_cid', 'updated_at', 'deleted'],
      favorites: ['id', 'user_id', 'question_id', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'],
      notes: ['id', 'user_id', 'question_id', 'content', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'],
      papers: ['id', 'user_id', 'title', 'subject_id', 'duration_minutes', 'total_score', 'rules_json', 'created_at', 'client_id', 'updated_at', 'deleted'],
      paperQuestions: ['id', 'paper_id', 'seq', 'question_id', 'score', 'client_id', 'question_cid', 'deleted']
    }
    return JSON.stringify({
      version: 1,
      exportedAt: Date.now(),
      categories: dump('categories', COLS.categories),
      questions: dump('questions', COLS.questions),
      answerRecords: dump('answer_records', COLS.answerRecords),
      wrongBooks: dump('wrong_books', COLS.wrongBooks),
      favorites: dump('favorites', COLS.favorites),
      notes: dump('notes', COLS.notes),
      papers: dump('papers', COLS.papers),
      paperQuestions: dump('paper_questions', COLS.paperQuestions)
    }, null, 2)
  },

  // 导出供云同步用的全量快照（含软删行，否则删除操作无法跨设备传播）。
  // users 表不入同步（本地单用户，不跨设备）。
  // 注：题目图片二进制内嵌 base64，保证换设备后 getImage 不裂图；
  // 个人题库图片体积是主要代价，超大图床建议改用分离上传方案。
  exportSync() {
    const dump = (table) => sqlite.prepare(`SELECT * FROM ${table}`).all()

    // 标签：按题目 client_id 携带（question_tags 本身无 client_id）
    const questionTags = sqlite.prepare(
      `SELECT qt.tag AS tag, q.client_id AS question_cid
       FROM question_tags qt JOIN questions q ON q.id=qt.question_id
       WHERE q.deleted=0`
    ).all()

    // 图片：收集所有在用图片文件名 → base64，内嵌进快照
    const imgRows = sqlite.prepare(
      "SELECT images_json FROM questions WHERE deleted=0 AND images_json IS NOT NULL AND images_json<>'[]'"
    ).all()
    const imageSet = new Map()
    const imgDir = path.join(app.getPath('userData'), 'images')
    imgRows.forEach(r => {
      let names = []
      try { names = JSON.parse(r.images_json || '[]') } catch (e) {}
      names.forEach(n => {
        if (imageSet.has(n)) return
        const full = path.join(imgDir, path.basename(String(n)))
        try {
          if (fs.existsSync(full)) imageSet.set(n, fs.readFileSync(full).toString('base64'))
        } catch (e) {}
      })
    })
    const images = Array.from(imageSet.entries()).map(([name, b64]) => ({ name, b64 }))

    return JSON.stringify({
      version: 2,
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
      images
    }, null, 2)
  },

  // 合并远端快照到本地：按 client_id upsert，updated_at 较新者胜（LWW），
  // 外键（category_id / question_id / parent_id）按 client_id→本机id 重新解析。
  // 返回合并后的行数摘要。
  mergeRemote(jsonStr) {
    const remote = JSON.parse(jsonStr)
    // 各表写入列（client_id 是身份键，不参与 UPDATE 覆盖）
    const cfg = [
      { table: 'categories', cols: ['name', 'parent_id', 'level', 'stage', 'sort', 'client_id', 'parent_cid', 'updated_at', 'deleted'] },
      { table: 'questions', cols: ['category_id', 'type', 'stem', 'options_json', 'answer_json', 'keywords_json', 'analysis', 'difficulty', 'source', 'images_json', 'client_id', 'category_cid', 'updated_at', 'deleted'] },
      { table: 'answer_records', cols: ['user_id', 'question_id', 'selected_json', 'is_correct', 'duration_ms', 'mode', 'self_graded', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'] },
      { table: 'wrong_books', cols: ['user_id', 'question_id', 'wrong_count', 'reviewed_count', 'next_review_at', 'weak_point', 'status', 'client_id', 'question_cid', 'updated_at', 'deleted'] },
      { table: 'favorites', cols: ['user_id', 'question_id', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'] },
      { table: 'notes', cols: ['user_id', 'question_id', 'content', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'] },
      { table: 'papers', cols: ['title', 'subject_id', 'duration_minutes', 'total_score', 'rules_json', 'created_at', 'client_id', 'updated_at', 'deleted'] },
      { table: 'paper_questions', cols: ['paper_id', 'seq', 'question_id', 'score', 'client_id', 'question_cid', 'deleted'] }
    ]

    const makeUpsert = (table, cols) => {
      const getByCid = sqlite.prepare(`SELECT id FROM ${table} WHERE client_id=?`)
      const insCols = cols
      const insPh = cols.map(() => '?').join(',')
      const updCols = cols.filter(c => c !== 'client_id')
      const updPh = updCols.map(c => `${c}=excluded.${c}`).join(',')
      const insert = sqlite.prepare(`INSERT INTO ${table} (${insCols.join(',')}) VALUES (${insPh})`)
      const update = sqlite.prepare(`UPDATE ${table} SET ${updPh} WHERE client_id=?`)
      return (r) => {
        if (!r.client_id) r.client_id = uuid() // 兜底：远端缺 client_id 时补一个
        const ex = getByCid.get(r.client_id)
        if (ex) {
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

      // 2) questions（依赖 categories）
      const qUpsert = makeUpsert('questions', cfg[1].cols)
      const qMerged = lwwMerge(readAll('questions'), remote.questions || [])
      applyFk(qMerged, 'category_cid', 'category_id', catCidToId)
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

      return { categories: catMerged.length, questions: qMerged.length, answerRecords: arN, wrongBooks: wbN, favorites: fvN, notes: ntN, papers: paperMerged.length, paperQuestions: pqMerged.length }
    })
    const result = tx()
    // 还原图片二进制到本地图床（换设备后 getImage 不裂图）
    const imgDir = path.join(app.getPath('userData'), 'images')
    try { if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true }) } catch (e) {}
    const images = remote.images || []
    images.forEach(im => {
      if (!im || !im.name) return
      const full = path.join(imgDir, path.basename(String(im.name)))
      try {
        if (!fs.existsSync(full) && im.b64) fs.writeFileSync(full, Buffer.from(im.b64, 'base64'))
      } catch (e) {}
    })
    return result
  },

  // 导入手动备份 JSON（INSERT OR REPLACE，按 id 覆盖；同步预留 updated_at）。
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
    replace('questions', data.questions, ['id', 'category_id', 'type', 'stem', 'options_json', 'answer_json', 'keywords_json', 'analysis', 'difficulty', 'source', 'client_id', 'category_cid', 'updated_at', 'deleted'])
    replace('answer_records', data.answerRecords, ['id', 'user_id', 'question_id', 'selected_json', 'is_correct', 'duration_ms', 'mode', 'self_graded', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'])
    replace('wrong_books', data.wrongBooks, ['id', 'user_id', 'question_id', 'wrong_count', 'reviewed_count', 'next_review_at', 'weak_point', 'status', 'client_id', 'question_cid', 'updated_at', 'deleted'])
    replace('favorites', data.favorites, ['id', 'user_id', 'question_id', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'])
    replace('notes', data.notes, ['id', 'user_id', 'question_id', 'content', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'])
    replace('papers', data.papers, ['id', 'user_id', 'title', 'subject_id', 'duration_minutes', 'total_score', 'rules_json', 'created_at', 'client_id', 'updated_at', 'deleted'])
    replace('paper_questions', data.paperQuestions, ['id', 'paper_id', 'seq', 'question_id', 'score', 'client_id', 'question_cid', 'deleted'])
    // 补齐可能缺失的 client_id（老备份无 cid 列）
    this.backfillClientIds()
    return { ok: true, imported: (data.questions || []).length }
  },

  // ================= 个人知识库（kb_*） =================
  // 搜索统一用 LIKE：SQLite FTS5 的 unicode61 分词器不做中文分词，中文会被整段
  // 当成一个 token 而搜不到；LIKE 子串匹配对中英文都正确。个人知识库量级（千级
  // 文档 × 几十块）下毫秒级返回，FTS5(trigram) 留作远期优化。

  kbDir() {
    return path.join(app.getPath('userData'), 'kb')
  },

  kbStats() {
    const docs = sqlite.prepare('SELECT COUNT(*) AS n FROM kb_docs WHERE deleted=0').get().n
    const blocks = sqlite.prepare('SELECT COUNT(*) AS n FROM kb_blocks').get().n
    const links = sqlite.prepare('SELECT COUNT(*) AS n FROM kb_links').get().n
    const tags = sqlite.prepare('SELECT COUNT(DISTINCT tag) AS n FROM kb_tags').get().n
    return { docs, blocks, links, tags }
  },

  // 阅读页取文档原件内容（base64；MD 由渲染层解码为文本，PDF 交给 pdfjs）
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

  findKbDocByHash(hash) {
    if (!hash) return null
    return sqlite.prepare('SELECT id, title, type FROM kb_docs WHERE hash=? AND deleted=0 LIMIT 1').get(hash) || null
  },

  addKbDoc({ title, type = 'md', relPath, size = 0, hash, blocks = [] }) {
    const now = Date.now()
    const tx = sqlite.transaction(() => {
      const info = sqlite.prepare(
        'INSERT INTO kb_docs (title, type, rel_path, size, hash, created_at, updated_at, deleted, client_id) VALUES (?,?,?,?,?,?,?,0,?)'
      ).run(title, type, relPath, size, hash || null, now, now, uuid())
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

  getKbDocs() {
    const rows = sqlite.prepare('SELECT * FROM kb_docs WHERE deleted=0 ORDER BY updated_at DESC').all()
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
    sqlite.prepare('UPDATE kb_docs SET title=?, hash=?, size=?, updated_at=? WHERE id=?')
      .run(title, hash, size, Date.now(), id)
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
  }
}

module.exports = api
