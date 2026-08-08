// 元数据/初始化模块：backfillClientIds / ensureUser / seedIfEmpty / getSetting / setSetting / clearUserData。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/LOCAL_USER/uuid/sample。
module.exports = function metaModule(ctx) {
  const { sqlite, LOCAL_USER, uuid, sample } = ctx

  return {
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
  // ---- 分类基础（科目/章节树 + 当前科目）已抽到 electron/db-bank.js（init 中合并）----

  // ---- 错题本/笔记导出 + 孤儿图片清理已抽到 electron/db-export.js（init 中合并）----

  // ---- 章节进度已抽到 electron/db-paper.js（init 中合并，此处于 2026-08-08 清除残留重复定义）----

  // ============ 题目批量操作 ============
  // patch: { categoryId, difficulty, addTags:[], setTags:[] }；软删兼容同步
  // ---- 题目批量操作已抽到 electron/db-bank.js（init 中合并）----

  // ---- 统计/趋势/成就方法已抽到 electron/db-stats.js（init 中合并）----,

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

  // ---- 分类管理已抽到 electron/db-bank.js（init 中合并）----

  // ---- 题库管理方法（导入/列表/增删改/统计/导出）已抽到 electron/db-bank.js（init 中合并）----

  // ---- 同步/备份方法（导出/增量快照/图片/LWW 合并/导入恢复）已抽到 electron/db-sync.js（init 中合并）----
  }
}
