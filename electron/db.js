const Database = require('better-sqlite3')
const path = require('path')
const crypto = require('crypto')
const fs = require('fs')
const { app } = require('electron') // nativeImage 已随图片压缩逻辑迁至 db-assets.js
const assets = require('./db-assets') // 题图/音频文件存取 + getImage 缓存
const gamify = require('./db-gamify') // XP/激励/每日任务/复习到期统计
const statsModule = require('./db-stats') // 统计/趋势/成就指标
const quizModule = require('./db-quiz') // 题库核心（取题/判分/错题本/收藏/笔记 + 复习 markMastered/rateReview）
const kbModule = require('./db-kb') // 知识库文档基础（读/CRUD/标签/图谱）
const bankModule = require('./db-bank') // 题库管理（导入/列表/增删改/统计/导出 + 分类/批量）
const cardsModule = require('./db-cards') // 卡片记忆 + 材料题
const habitsModule = require('./db-habits') // 习惯/专注/回顾/断点续做
const miscModule = require('./db-misc') // 高亮/双链/错因/周报
const weakModule = require('./db-weak') // 薄弱项/相似题/弱点抽题
const paperModule = require('./db-paper') // 模拟卷/标签/章节进度
const exportModule = require('./db-export') // 错题本/笔记导出 + 孤儿图片清理
const syncModule = require('./db-sync') // 同步/备份（导出/增量快照/图片/LWW 合并/导入恢复）
const schemaModule = require('./db-schema') // 建表/迁移（initSchema/migrateSchema）
const metaModule = require('./db-meta') // 元数据/初始化（backfill/ensureUser/seed/KV/清空）
const logger = require('./logger')

// 本地用户固定为 id=1（纯本地单用户；云同步只同步"学习数据"，不区分账号行）。
const LOCAL_USER = 1

const uuid = () => crypto.randomUUID()

let sqlite
let dbRecovered = false // 本次启动是否由备份自动恢复

// getImage 缓存与题图/音频文件方法已随拆分抽到 electron/db-assets.js

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

// 自适应复习（SM-2 轻量实现）已抽到 ./sm2.js（便于单测），此处直接复用 scheduleNextReview。

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
  // 仅建立连接 + PRAGMA，不建表。返回是否成功打开。
  _tryOpen() {
    try {
      sqlite = new Database(dbPath())
      sqlite.pragma('journal_mode = WAL')
      // 健壮性 / 性能 PRAGMA：避免多连接锁超时、启用外键语义、放宽页缓存
      try { sqlite.pragma('busy_timeout = 5000') } catch (e) { /* 老版本 better-sqlite3 可能不支持，忽略 */ }
      try { sqlite.pragma('foreign_keys = ON') } catch (e) { /* 同上 */ }
      try { sqlite.pragma('cache_size = -8000') } catch (e) { /* 8MB 页缓存，约 -8000 页 */ }
      return true
    } catch (e) {
      try { if (sqlite) sqlite.close() } catch (e2) {}
      sqlite = null
      return false
    }
  },

  // 主库损坏时用最近备份覆盖后重试；返回是否恢复成功。
  _recoverFromBackup() {
    try {
      const base = dbPath()
      const backups = this.listBackups() // 已按 mtime 倒序
      if (!backups.length) return false
      // 把损坏文件改名留存（便于排查），再用最新备份覆盖
      try { if (fs.existsSync(base)) fs.renameSync(base, base + '.corrupt.' + Date.now()) } catch (e) {}
      for (const ext of ['-wal', '-shm']) {
        const w = base + ext
        try { if (fs.existsSync(w)) fs.unlinkSync(w) } catch (e) {}
      }
      fs.copyFileSync(path.join(app.getPath('userData'), 'backups', backups[0].file), base)
      return this._tryOpen()
    } catch (e) {
      return false
    }
  },

  init() {
    logger.info('db.init 启动')
    if (!this._tryOpen()) {
      // 1) 损坏的 WAL/SHM 副文件常导致打开失败 → 删掉再试（仅丢未 checkpoint 的尾，可接受）
      const base = dbPath()
      for (const ext of ['-wal', '-shm']) {
        const w = base + ext
        try { if (fs.existsSync(w)) fs.unlinkSync(w) } catch (e) {}
      }
      if (!this._tryOpen()) {
        // 2) 主库损坏 → 用最近备份恢复
        const recovered = this._recoverFromBackup()
        if (!recovered) {
          logger.error('db.init 自动恢复失败，数据库损坏')
          throw new Error('数据库文件损坏，且自动恢复未成功。请到「我的 → 数据管理」手动恢复备份，或联系支持。')
        }
        dbRecovered = true
        logger.warn('db.init 已从最近备份自动恢复')
      }
    }
    // sqlite 已赋值，此时再合并依赖它的子模块（ctx 需要真实 sqlite 实例）
    Object.assign(this, gamify({ sqlite, LOCAL_USER, uuid, descendantCategoryIds }))
    Object.assign(this, statsModule({ sqlite, LOCAL_USER, uuid, descendantCategoryIds }))
    Object.assign(this, quizModule({ sqlite, LOCAL_USER, uuid, questionCid, descendantCategoryIds }))
    Object.assign(this, kbModule({ sqlite, uuid, app }))
    Object.assign(this, bankModule({ sqlite, LOCAL_USER, uuid, categoryCid, descendantCategoryIds }))
    Object.assign(this, cardsModule({ sqlite, uuid }))
    Object.assign(this, habitsModule({ sqlite, LOCAL_USER, uuid }))
    Object.assign(this, miscModule({ sqlite, LOCAL_USER, uuid, descendantCategoryIds }))
    Object.assign(this, weakModule({ sqlite, LOCAL_USER, descendantCategoryIds }))
    Object.assign(this, paperModule({ sqlite, LOCAL_USER, uuid, descendantCategoryIds, questionCid }))
    Object.assign(this, exportModule({ sqlite, LOCAL_USER }))
    Object.assign(this, syncModule({ sqlite, LOCAL_USER, uuid }))
    Object.assign(this, schemaModule({ sqlite }))
    Object.assign(this, metaModule({ sqlite, LOCAL_USER, uuid, sample: require('./sampleData'), descendantCategoryIds }))
    this.initSchema()
    this.migrateSchema()
    this.ensureUser()
    this.seedIfEmpty()
    this.backfillClientIds() // 老库/样例数据补齐 client_id 与 *_cid，保证可同步
    // 每日备份延迟到窗口显示后后台执行：copyFileSync 复制大库文件会阻塞启动，不抢首帧
    setTimeout(() => { try { this.autoBackup() } catch (e) { /* 备份失败不影响运行 */ } }, 4000)
  },

  // 启动期数据库状态（供渲染端提示「已从备份恢复」）
  getDbStatus() {
    return { recovered: dbRecovered }
  },

  // 自动备份：每次启动把 tiku.db 复制到 backups/（按天去重），保留最近 5 份
  autoBackup() {
    try {
      const src = dbPath()
      if (!fs.existsSync(src)) return
      const dir = path.join(app.getPath('userData'), 'backups')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const dst = path.join(dir, `tiku-${stamp}.db`)
      if (fs.existsSync(dst)) return // 当天已备份过
      fs.copyFileSync(src, dst)
      const list = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort()
      while (list.length > 5) {
        fs.unlinkSync(path.join(dir, list.shift()))
      }
    } catch (e) { /* 备份失败不影响启动 */ }
  },

  // 备份列表（供「备份管理」弹层）
  listBackups() {
    try {
      const dir = path.join(app.getPath('userData'), 'backups')
      if (!fs.existsSync(dir)) return []
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.db'))
        .map(f => {
          const st = fs.statSync(path.join(dir, f))
          return { file: f, size: st.size, mtime: st.mtimeMs }
        })
        .sort((a, b) => b.mtime - a.mtime)
    } catch (e) { return [] }
  },

  // 一键恢复备份：复制备份文件覆盖当前库（WAL 一并清掉），返回后由主进程重启应用
  restoreBackup(fileName) {
    const dir = path.join(app.getPath('userData'), 'backups')
    const src = path.join(dir, String(fileName))
    if (!fs.existsSync(src)) return { ok: false, error: '备份文件不存在' }
    try {
      if (sqlite) sqlite.close()
      const target = dbPath()
      fs.copyFileSync(src, target)
      for (const ext of ['-wal', '-shm']) {
        const w = target + ext
        if (fs.existsSync(w)) fs.unlinkSync(w)
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  },

  close() {
    if (sqlite) sqlite.close()
  },

  // ---- 建表/迁移方法已抽到 electron/db-schema.js（init 中合并）----

  // 给历史数据/样例数据补齐 client_id 与 *_cid（按 client_id 做跨设备身份，否则无法匹配）。
  // ---- 元数据/初始化方法（backfill/ensureUser/seed/KV/清空）已抽到 electron/db-meta.js（init 中合并）----

  // ---- 复习方法（markMastered/rateReview）已并入 electron/db-quiz.js（init 中合并）----

  // ================= 个人知识库（kb_*） =================
  // 搜索统一用 LIKE：SQLite FTS5 的 unicode61 分词器不做中文分词，中文会被整段
  // 当成一个 token 而搜不到；LIKE 子串匹配对中英文都正确。个人知识库量级（千级
  // 文档 × 几十块）下毫秒级返回，FTS5(trigram) 留作远期优化。

  // ---- 知识库统计/文件方法已并入 electron/db-kb.js（init 中合并）----

  // 今日行为计数 / 每日任务：已抽到 electron/db-gamify.js

  // 每日回顾：到期错题（复用智能复习调度）+ 知识库随机块
  // ---- 习惯/专注/回顾/断点续做方法已抽到 electron/db-habits.js（init 中合并）----

  // ---- 文档高亮批注 ----
  // ---- 高亮/双链/错因/周报方法已抽到 electron/db-misc.js（init 中合并）----

  // 阅读页取文档原件内容（base64；MD 由渲染层解码为文本，PDF 交给 pdfjs）
  // ---- 知识库文档基础方法（读/CRUD/标签/图谱）已抽到 electron/db-kb.js（init 中合并）----

  // ---- 知识库联动/搜索方法（互链/搜索/推荐）已并入 electron/db-kb.js（init 中合并）----
}

// 合并独立拆出的子模块方法（保持 this=api，方法互调不受影响）
// 注意：db-gamify 依赖 sqlite，须在 init() 中 sqlite 赋值后再合并（见 init 开头）
Object.assign(api, assets)

module.exports = api
