// 统一 SQLite 驱动适配层（跨端地基）
// 目标：暴露 better-sqlite3 同形 API 子集，Electron（better-sqlite3）与 APK（SQL.js wasm）双驱动可替换，
//      db-*.js 的 SQL 逻辑零改动复用。
//
// 统一 API（与 better-sqlite3 用法一致）：
//   driver.prepare(sql) → { run(...params) → { changes, lastInsertRowid }, get(...params) → row|undefined, all(...params) → rows }
//   driver.pragma(p) / driver.exec(sql)
//   driver.transaction(fn) → 包装函数（BEGIN/COMMIT/ROLLBACK 语义一致）
//   driver.close()
//
// 用法：
//   Electron:  const driver = createBetterDriver(dbPath)          // 同步
//   APK:       const driver = await createSqlJsDriver({ file })   // 异步（wasm 加载 + 文件持久化）

function createBetterDriver(dbPath) {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath)
  try { db.pragma('journal_mode = WAL') } catch (e) {}
  try { db.pragma('busy_timeout = 5000') } catch (e) {}
  try { db.pragma('foreign_keys = ON') } catch (e) {}
  try { db.pragma('cache_size = -8000') } catch (e) {}
  return {
    _raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql)
      return {
        run: (...p) => {
          const info = stmt.run(...p)
          return { changes: info.changes, lastInsertRowid: info.lastInsertRowid }
        },
        get: (...p) => stmt.get(...p),
        all: (...p) => stmt.all(...p)
      }
    },
    pragma(p) { return db.pragma(p) },
    exec(sql) { return db.exec(sql) },
    transaction(fn) { return db.transaction(fn) },
    close() { db.close() },
    // WAL checkpoint（备份前调用；SQL.js 无 WAL，no-op）
    checkpoint() { try { db.pragma('wal_checkpoint(TRUNCATE)') } catch (e) {} },
    // 导出整库字节（备份/同步快照用；better 直接读文件，SQL.js 用 db.export()）
    exportBytes() { return require('fs').readFileSync(dbPath) }
  }
}

// SQL.js 驱动：异步初始化（wasm 加载）。
// 持久化：SQL.js 是内存库，改动后由上层调 driver.persist() 写回文件。
async function createSqlJsDriver({ file, locateFile } = {}) {
  const initSqlJs = require('sql.js')
  const fs = require('fs')
  const SQL = await initSqlJs(locateFile ? { locateFile } : undefined)
  let db
  if (file && fs.existsSync(file)) {
    const bytes = fs.readFileSync(file)
    db = new SQL.Database(new Uint8Array(bytes))
  } else {
    db = new SQL.Database()
  }
  // SQL.js 无 WAL；外键需要 PRAGMA 开启
  try { db.exec('PRAGMA foreign_keys = ON') } catch (e) {}
  // better-sqlite3 容忍 undefined 参数（按 NULL 处理），SQL.js 会抛 "unknown type"——
  // 统一把 undefined 归一为 null，保证两驱动行为一致
  const norm = (params) => (params && params.length ? params.map(p => (p === undefined ? null : p)) : undefined)
  return {
    _raw: db,
    prepare(sql) {
      return {
        run: (...params) => {
          db.run(sql, norm(params))
          const lastId = (db.exec('SELECT last_insert_rowid() AS id')[0] || {}).values
          return { changes: db.getRowsModified(), lastInsertRowid: lastId ? lastId[0][0] : 0 }
        },
        get: (...params) => {
          const stmt = db.prepare(sql)
          try {
            const n = norm(params)
            if (n) stmt.bind(n)
            return stmt.step() ? stmt.getAsObject() : undefined
          } finally { stmt.free() }
        },
        all: (...params) => {
          const stmt = db.prepare(sql)
          try {
            const n = norm(params)
            if (n) stmt.bind(n)
            const rows = []
            while (stmt.step()) rows.push(stmt.getAsObject())
            return rows
          } finally { stmt.free() }
        }
      }
    },
    pragma(p) {
      // PRAGMA 结果与 better-sqlite3 形态对齐（行数组）；SQL.js 返回 [[...]]
      const r = db.exec('PRAGMA ' + p)
      if (!r || !r[0] || !r[0].values) return []
      return r[0].values.map(v => (v.length === 1 ? v[0] : v))
    },
    exec(sql) { return db.exec(sql) },
    transaction(fn) {
      return (...args) => {
        db.run('BEGIN')
        try {
          const r = fn(...args)
          db.run('COMMIT')
          return r
        } catch (e) {
          try { db.run('ROLLBACK') } catch (e2) {}
          throw e
        }
      }
    },
    close() { db.close() },
    checkpoint() { /* SQL.js 无 WAL */ },
    // 持久化：把内存库写回文件（移动端在上层操作后调用）
    persist() {
      if (!file) return
      const data = db.export()
      fs.writeFileSync(file, Buffer.from(data))
    },
    exportBytes() {
      return Buffer.from(db.export())
    }
  }
}

module.exports = { createBetterDriver, createSqlJsDriver }
