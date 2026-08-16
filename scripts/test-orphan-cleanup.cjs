// source_question_id 悬空清理 + listCards 存在性字段（S3 建议项）。
// 直接加载 db-cards.js（纯函数模块，无 electron 依赖），用 sql.js 构造最小化 sqlite 驱动。
// 运行：node scripts/test-orphan-cleanup.cjs
const initSqlJs = require('sql.js')
const cardsMod = require('../electron/db-cards.js')

let pass = 0, fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log('OK   ' + name) } else { fail++; console.log('FAIL ' + name) }
}

initSqlJs().then(SQL => {
  const db = new SQL.Database()
  db.run(`CREATE TABLE questions (id INTEGER PRIMARY KEY, deleted INTEGER DEFAULT 0)`)
  db.run(`CREATE TABLE categories (id INTEGER PRIMARY KEY, parent_id INTEGER, name TEXT, deleted INTEGER DEFAULT 0)`)
  db.run(`CREATE TABLE cards (id INTEGER PRIMARY KEY AUTOINCREMENT, front TEXT, back TEXT, category TEXT, subject_id INTEGER, subject_cid TEXT, category_id INTEGER, category_cid TEXT, phonetic TEXT, audio_url TEXT, source_question_id INTEGER, source_doc_id INTEGER, review_at INTEGER, review_count INTEGER DEFAULT 0, review_lapses INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER, deleted INTEGER DEFAULT 0, client_id TEXT)`)

  // 最小化 sqlite 驱动：贴合 better-sqlite3/SQL.js 驱动的 prepare().run/get/all 形态
  const sqlite = {
    prepare: (sql) => {
      const stmt = db.prepare(sql)
      return {
        run: (...p) => { stmt.run(...p); return { changes: db.getRowsModified() } },
        get: (...p) => { const s = db.prepare(sql); if (p.length) s.bind(p); const r = s.step() ? s.getAsObject() : undefined; return r },
        all: (...p) => { const s = db.prepare(sql); if (p.length) s.bind(p); const rows = []; while (s.step()) rows.push(s.getAsObject()); return rows }
      }
    }
  }
  const cards = cardsMod({ sqlite, uuid: () => 'u', categoryCid: () => null })

  // 场景：题目 1 存在；卡片 c1 指向 1（有效），c2 指向 99（悬空）
  db.run('INSERT INTO questions (id, deleted) VALUES (1,0)')
  db.run("INSERT INTO cards (front, source_question_id, deleted, created_at, updated_at) VALUES ('c1',1,0,0,0)")
  db.run("INSERT INTO cards (front, source_question_id, deleted, created_at, updated_at) VALUES ('c2',99,0,0,0)")

  cards.cleanupOrphanCardSources()

  const rows = db.exec('SELECT id, source_question_id FROM cards')[0].values
  const map = Object.fromEntries(rows.map(r => [r[0], r[1]]))
  ok('有效引用保留 (c1 → 1)', map[1] === 1)
  ok('悬空引用被置空 (c2 → NULL)', map[2] === null)

  // 删除题目 1（软删）→ 清理后 c1 仍指向 1（题目行仍存在，非真正悬空）
  db.run('UPDATE questions SET deleted=1 WHERE id=1')
  cards.cleanupOrphanCardSources()
  const after = db.exec('SELECT id, source_question_id FROM cards')[0].values
  const map2 = Object.fromEntries(after.map(r => [r[0], r[1]]))
  ok('软删题目不破坏引用（仅硬删/错位才清理）', map2[1] === 1)

  // listCards：source_question_exists 仅当题目存在且未删除
  db.run('UPDATE questions SET deleted=0 WHERE id=1') // 还原
  const list = cards.listCards({})
  const c1 = list.find(c => c.front === 'c1')
  const c2 = list.find(c => c.front === 'c2')
  ok('listCards 返回 source_question_exists', c1 && 'source_question_exists' in c1 && c2 && 'source_question_exists' in c2)
  ok('c1 源题目存在 → true', !!c1.source_question_exists)
  ok('c2 源题目不存在 → false', !c2.source_question_exists)

  console.log(`\npass=${pass} fail=${fail}`)
  process.exit(fail ? 1 : 0)
}).catch(e => { console.error(e); process.exit(1) })
