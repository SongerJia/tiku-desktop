const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')
const sample = require('./sampleData')

// 本地用户固定为 id=1（纯本地单用户；Phase2 多端同步时再扩展账号表）。
const LOCAL_USER = 1

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

const api = {
  init() {
    sqlite = new Database(dbPath())
    sqlite.pragma('journal_mode = WAL')
    this.initSchema()
    this.migrateSchema()
    this.ensureUser()
    this.seedIfEmpty()
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
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id INTEGER,
        level INTEGER,
        stage TEXT,
        sort INTEGER DEFAULT 0,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0
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
        deleted INTEGER DEFAULT 0
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
        deleted INTEGER DEFAULT 0
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
        UNIQUE(user_id, question_id)
      );
      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        question_id INTEGER,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        UNIQUE(user_id, question_id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
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
    // 问答题的「得分关键词」：JSON 数组，客观题为空
    addColumn('questions', 'keywords_json', 'keywords_json TEXT')
    // 问答题自评标记：1=用户自评，用于统计里区分主观题
    addColumn('answer_records', 'self_graded', 'self_graded INTEGER DEFAULT 0')
  },

  ensureUser() {
    const u = sqlite.prepare('SELECT id FROM users WHERE id=?').get(LOCAL_USER)
    if (!u) {
      sqlite.prepare('INSERT INTO users (id, name, created_at, updated_at) VALUES (?,?,?,?)')
        .run(LOCAL_USER, '本地用户', Date.now(), Date.now())
    }
  },

  // 首次启动且题库为空时，灌入考证样例数据（二级建造师）。
  seedIfEmpty() {
    const count = sqlite.prepare('SELECT COUNT(*) AS n FROM categories').get().n
    if (count > 0) return
    const now = Date.now()
    const insC = sqlite.prepare('INSERT INTO categories (id,name,parent_id,level,stage,sort,updated_at) VALUES (?,?,?,?,?,?,?)')
    const insQ = sqlite.prepare('INSERT INTO questions (id,category_id,type,stem,options_json,answer_json,keywords_json,analysis,difficulty,source,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    const tx = sqlite.transaction(() => {
      for (const c of sample.categories) {
        insC.run(c.id, c.name, c.parent_id ?? null, c.level, c.stage ?? null, c.sort ?? 0, now)
      }
      for (const q of sample.questions) {
        insQ.run(q.id, q.category_id, q.type, q.stem, JSON.stringify(q.options || []),
          JSON.stringify(q.answer || []), JSON.stringify(q.keywords || []),
          q.analysis, q.difficulty ?? 3, q.source ?? '样题', now)
      }
    })
    tx()
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
    // 一级分类视为“科目”，用于选择科目弹层
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

  // 拉题。支持：
  //  - categoryId：指定某个章节
  //  - subjectId：指定科目（取其下所有章节）
  //  - mode：practice(全部) / wrong(错题) / favorite(收藏) / unattempted(未做) / review-due(智能复习到期)
  //  - keyword：题干搜索
  //  - limit：截断（考试抽题用，顺序由调用方控制随机/顺序）
  getQuestions({ subjectId, categoryId, mode, limit, keyword } = {}) {
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
      // 从未在该用户答题记录中出现过的题目
      sql += ' AND id NOT IN (SELECT question_id FROM answer_records WHERE user_id=? AND deleted=0)'
      params.push(LOCAL_USER)
    } else if (mode === 'review-due') {
      // 艾宾浩斯：状态仍为 wrong 且已到（或从未排过）下次复习时间的错题
      const ids = sqlite.prepare("SELECT question_id FROM wrong_books WHERE user_id=? AND status='wrong' AND deleted=0 AND (next_review_at IS NULL OR next_review_at<=?)")
        .all(LOCAL_USER, Date.now()).map(w => w.question_id)
      if (!ids.length) return []
      sql += ' AND id IN (' + ids.map(() => '?').join(',') + ')'
      params.push(...ids)
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
      keywords: r.keywords_json ? JSON.parse(r.keywords_json) : []
    }))
  },

  // 判分 + 写答题记录 + 更新错题本与用户统计（等价于之前云函数 submitAnswer 的逻辑）
  // selfGrade：问答题（essay）没有唯一解，无法机器判分，由用户自评 true/false。
  submitAnswer({ questionId, selected, durationMs, mode, selfGrade }) {
    const q = sqlite.prepare('SELECT * FROM questions WHERE id=?').get(questionId)
    if (!q) return { error: 'question not found' }

    const isEssay = q.type === 'essay'
    let correct
    if (isEssay) {
      // 主观题以自评为准；没传自评时保守按「未掌握」处理，免得空作答被算成对
      correct = selfGrade === true
    } else {
      correct = JSON.stringify([...selected].sort()) === JSON.stringify([...JSON.parse(q.answer_json || '[]')].sort())
    }
    const now = Date.now()

    sqlite.prepare(`INSERT INTO answer_records
      (user_id, question_id, selected_json, is_correct, duration_ms, mode, self_graded, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(LOCAL_USER, questionId, JSON.stringify(selected), correct ? 1 : 0, durationMs || 0, mode || 'practice', isEssay ? 1 : 0, now, now)

    sqlite.prepare('UPDATE users SET total_answered=total_answered+1, correct_count=correct_count+?, updated_at=? WHERE id=?')
      .run(correct ? 1 : 0, now, LOCAL_USER)

    if (!correct) {
      // 答错：错题本 +1，复习进度清零，安排 1 天后复习
      sqlite.prepare(`INSERT INTO wrong_books (user_id, question_id, wrong_count, reviewed_count, status, next_review_at, updated_at)
        VALUES (?,?,1,0,?,?,?)
        ON CONFLICT(user_id, question_id) DO UPDATE SET
          wrong_count=wrong_count+1,
          reviewed_count=0,
          status='wrong',
          next_review_at=excluded.next_review_at,
          updated_at=?`)
        .run(LOCAL_USER, questionId, 'wrong', scheduleNextReview(0), now, now)
    } else {
      // 答对：若已在错题本中，则推进间隔复习进度；连续答对 3 次毕业
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
      answer: JSON.parse(r.answer_json)
    }))
  },

  getFavorites() {
    const rows = sqlite.prepare(`SELECT f.*, q.stem, q.type, q.options_json, q.answer_json
      FROM favorites f JOIN questions q ON q.id=f.question_id
      WHERE f.user_id=? AND f.deleted=0`).all(LOCAL_USER)
    return rows.map(r => ({
      ...r,
      options: JSON.parse(r.options_json),
      answer: JSON.parse(r.answer_json)
    }))
  },

  toggleFavorite(questionId) {
    const ex = sqlite.prepare('SELECT id FROM favorites WHERE user_id=? AND question_id=? AND deleted=0').get(LOCAL_USER, questionId)
    if (ex) {
      sqlite.prepare('UPDATE favorites SET deleted=1, updated_at=? WHERE id=?').run(Date.now(), ex.id)
      return { favorited: false }
    }
    sqlite.prepare('INSERT INTO favorites (user_id, question_id, created_at, updated_at) VALUES (?,?,?,?)')
      .run(LOCAL_USER, questionId, Date.now(), Date.now())
    return { favorited: true }
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

  // 小程序风格首页/统计需要的聚合数据
  getSummary() {
    const total = sqlite.prepare('SELECT COUNT(*) AS n FROM questions WHERE deleted=0').get().n
    const learned = sqlite.prepare('SELECT COUNT(DISTINCT question_id) AS n FROM answer_records WHERE user_id=? AND deleted=0').get(LOCAL_USER).n
    const mastered = sqlite.prepare(`SELECT COUNT(DISTINCT question_id) AS n FROM answer_records
      WHERE user_id=? AND deleted=0 AND is_correct=1`).get(LOCAL_USER).n
    const todayStart = new Date().setHours(0, 0, 0, 0)
    const today = sqlite.prepare('SELECT COUNT(*) AS n FROM answer_records WHERE user_id=? AND deleted=0 AND created_at>=?').get(LOCAL_USER, todayStart).n
    const wrongCount = sqlite.prepare("SELECT COUNT(*) AS n FROM wrong_books WHERE user_id=? AND status='wrong' AND deleted=0").get(LOCAL_USER).n

    // 学习天数统计：累计学习天数 + 连续学习天数（学习习惯卡片用）
    const localDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const dayRows = sqlite.prepare("SELECT DISTINCT DATE(created_at/1000, 'unixepoch', 'localtime') AS day FROM answer_records WHERE user_id=? AND deleted=0").all(LOCAL_USER)
    const daySet = new Set(dayRows.map(r => r.day))
    const activeDays = daySet.size
    let streak = 0
    const cursor = new Date()
    cursor.setHours(0, 0, 0, 0)
    if (!daySet.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1) // 今天还没学则从昨天起算
    for (let i = 0; ; i++) {
      const d = new Date(cursor)
      d.setDate(cursor.getDate() - i)
      if (daySet.has(localDateKey(d))) streak++
      else break
    }

    return { total, learned, mastered, today, wrongCount, activeDays, streak }
  },

  getChapterProgress(subjectId) {
    // 返回某科目下各章节的答题进度（正确率）
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
    // 返回最近 7 天（含今天）每天答题数
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
    // month: 1-12
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
    // 仅用于"退出登录"演示：清空答题记录、错题本、收藏、用户统计，保留题库
    sqlite.prepare('DELETE FROM answer_records WHERE user_id=?').run(LOCAL_USER)
    sqlite.prepare('DELETE FROM wrong_books WHERE user_id=?').run(LOCAL_USER)
    sqlite.prepare('DELETE FROM favorites WHERE user_id=?').run(LOCAL_USER)
    sqlite.prepare('UPDATE users SET total_answered=0, correct_count=0, updated_at=? WHERE id=?').run(Date.now(), LOCAL_USER)
    sqlite.prepare("DELETE FROM settings WHERE key='current_subject_id'").run()
    return { ok: true }
  },

  // ============ 题库管理：录入 / 编辑 / 批量导入 ============

  // 按名称查分类，没有就新建。Excel 里写「科目/章节」文字即可自动建树。
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
    const info = sqlite.prepare('INSERT INTO categories (name,parent_id,level,sort,updated_at) VALUES (?,?,?,?,?)')
      .run(trimmed, parentId, level, (sortRow ? sortRow.s : 0) + 1, Date.now())
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

  // 软删分类，连带软删其下所有子分类与题目（可通过导入备份恢复）
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

  // 批量导入。rows 已在渲染层完成校验/归一化：
  // { subject, chapter, type, stem, options[], answer[], analysis, difficulty, source }
  importQuestionBank(rows, opts = {}) {
    const { defaultSubjectId = null, skipDuplicate = true } = opts
    const now = Date.now()
    const insQ = sqlite.prepare(`INSERT INTO questions
      (category_id,type,stem,options_json,answer_json,keywords_json,analysis,difficulty,source,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    const dupStmt = sqlite.prepare('SELECT id FROM questions WHERE category_id=? AND stem=? AND deleted=0')
    let inserted = 0
    let duplicated = 0
    let skipped = 0
    const touched = new Set()
    const tx = sqlite.transaction(() => {
      for (const r of rows || []) {
        // 优先用行内「科目」列，缺省回落到向导里选定的科目
        let subjectId = defaultSubjectId
        if (r.subject) subjectId = this.upsertCategoryByName(r.subject, null, 1)
        if (!subjectId) { skipped++; continue }
        const categoryId = r.chapter ? this.upsertCategoryByName(r.chapter, subjectId, 2) : subjectId
        if (skipDuplicate && dupStmt.get(categoryId, r.stem)) { duplicated++; continue }
        insQ.run(
          categoryId, r.type, r.stem,
          JSON.stringify(r.options || []), JSON.stringify(r.answer || []),
          JSON.stringify(r.keywords || []),
          r.analysis || '', r.difficulty || 3, r.source || '导入', now
        )
        inserted++
        touched.add(subjectId)
      }
    })
    tx()
    return { ok: true, inserted, duplicated, skipped, subjects: Array.from(touched) }
  },

  // 题库管理列表（分页 + 科目/章节/关键词筛选）
  listQuestions({ subjectId = null, categoryId = null, keyword = '', page = 1, pageSize = 20 } = {}) {
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
        keywords: r.keywords_json ? JSON.parse(r.keywords_json) : []
      }))
    }
  },

  addQuestion(q) {
    const info = sqlite.prepare(`INSERT INTO questions
      (category_id,type,stem,options_json,answer_json,keywords_json,analysis,difficulty,source,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(q.categoryId, q.type, q.stem, JSON.stringify(q.options || []),
        JSON.stringify(q.answer || []), JSON.stringify(q.keywords || []),
        q.analysis || '', q.difficulty || 3,
        q.source || '手动录入', Date.now())
    return { ok: true, id: info.lastInsertRowid }
  },

  updateQuestion(q) {
    sqlite.prepare(`UPDATE questions SET category_id=?,type=?,stem=?,options_json=?,
      answer_json=?,keywords_json=?,analysis=?,difficulty=?,source=?,updated_at=? WHERE id=?`)
      .run(q.categoryId, q.type, q.stem, JSON.stringify(q.options || []),
        JSON.stringify(q.answer || []), JSON.stringify(q.keywords || []),
        q.analysis || '', q.difficulty || 3,
        q.source || '手动录入', Date.now(), q.id)
    return { ok: true }
  },

  // 软删，保留答题记录的外键指向，也方便日后同步/恢复
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

  // 导出题库为扁平行（渲染层转 CSV，便于在 Excel 里改完再导回来）
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

  // 导出整库（非删除行）为 JSON，用于备份 / 迁移到别的机器
  exportData() {
    const dump = (table) => sqlite.prepare(`SELECT * FROM ${table} WHERE deleted=0`).all()
    return JSON.stringify({
      version: 1,
      exportedAt: Date.now(),
      categories: dump('categories'),
      questions: dump('questions'),
      answerRecords: dump('answer_records'),
      wrongBooks: dump('wrong_books'),
      favorites: dump('favorites'),
      users: dump('users')
    }, null, 2)
  },

  // 导入 JSON（INSERT OR REPLACE，按 id 合并；同步预留 updated_at）
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
    replace('categories', data.categories, ['id', 'name', 'parent_id', 'level', 'stage', 'sort', 'updated_at', 'deleted'])
    replace('questions', data.questions, ['id', 'category_id', 'type', 'stem', 'options_json', 'answer_json', 'keywords_json', 'analysis', 'difficulty', 'source', 'updated_at', 'deleted'])
    replace('answer_records', data.answerRecords, ['id', 'user_id', 'question_id', 'selected_json', 'is_correct', 'duration_ms', 'mode', 'self_graded', 'created_at', 'updated_at', 'deleted'])
    replace('wrong_books', data.wrongBooks, ['id', 'user_id', 'question_id', 'wrong_count', 'reviewed_count', 'next_review_at', 'weak_point', 'status', 'updated_at', 'deleted'])
    replace('favorites', data.favorites, ['id', 'user_id', 'question_id', 'created_at', 'updated_at', 'deleted'])
    return { ok: true, imported: (data.questions || []).length }
  }
}

module.exports = api
