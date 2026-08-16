const { createBetterDriver, createSqlJsDriver } = require('./db-driver')
const { platform, fs, path, crypto } = require('./platform') // P4a + P7：fs/path/crypto 走 Proxy 懒绑定（避免 Rollup chunk 顺序导致顶层快照为 null）
const app = { getPath: () => platform.userDataDir() } // app.getPath('userData') 兼容别名（APK 指向 Capacitor 目录）
const assets = require('./db-assets') // 题图/音频文件存取 + getImage 缓存
const gamify = require('./db-gamify') // XP/激励/每日任务/复习到期统计
const statsModule = require('./db-stats') // 统计/趋势/成就指标
const quizModule = require('./db-quiz') // 题库核心（取题/判分/错题本/收藏/笔记 + 复习 markMastered/rateReview）
const kbModule = require('./db-kb') // 知识库文档基础（读/CRUD/标签/图谱）
const bankModule = require('./db-bank') // 题库管理（导入/列表/增删改/统计/导出 + 分类/批量）
const cardsModule = require('./db-cards') // 卡片记忆 + 材料题
const habitsModule = require('./db-habits') // 专注/断点续做
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
  // 统一走驱动适配层（Electron=better-sqlite3 同步；APK=SQL.js 异步，见 initWithDriver）
  _tryOpen() {
    try {
      sqlite = createBetterDriver(dbPath())
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
      // 逐个尝试：跳过损坏的备份（非 SQLite 头），避免损坏备份覆盖主库（同 restoreBackup 的校验）
      let src = null
      for (const b of backups) {
        const cand = path.join(app.getPath('userData'), 'backups', b.file)
        try {
          const head = fs.readFileSync(cand).subarray(0, 16).toString('latin1')
          if (head.startsWith('SQLite format 3')) { src = cand; break }
        } catch (e) { /* 读取失败跳过该备份 */ }
      }
      if (!src) return false
      // 把损坏文件改名留存（便于排查），再用合法备份覆盖
      try { if (fs.existsSync(base)) fs.renameSync(base, base + '.corrupt.' + Date.now()) } catch (e) {}
      for (const ext of ['-wal', '-shm']) {
        const w = base + ext
        try { if (fs.existsSync(w)) fs.unlinkSync(w) } catch (e) {}
      }
      fs.copyFileSync(src, base)
      return this._tryOpen()
    } catch (e) {
      return false
    }
  },

  // 合并子模块 + 建表/迁移/种子/回填（sqlite 已就绪后调用；Electron 同步路径与 APK 异步路径共用）
  _initModules() {
    this._raw = sqlite // 暴露底层驱动（测试/诊断用；SQL.js 变体测试需要直接执行 SQL）
    // sqlite 已赋值，此时再合并依赖它的子模块（ctx 需要真实 sqlite 实例）
    Object.assign(this, gamify({ sqlite, LOCAL_USER, uuid, descendantCategoryIds }))
    Object.assign(this, statsModule({ sqlite, LOCAL_USER, uuid, descendantCategoryIds }))
    Object.assign(this, quizModule({ sqlite, LOCAL_USER, uuid, questionCid, descendantCategoryIds }))
    Object.assign(this, kbModule({ sqlite, uuid, app }))
    Object.assign(this, bankModule({ sqlite, LOCAL_USER, uuid, categoryCid, descendantCategoryIds }))
    Object.assign(this, cardsModule({ sqlite, uuid, categoryCid }))
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
    // 启动期兜底：清理指向不存在题目的悬空 source_question_id（备份恢复/跨库导入可能产生）
    try { if (this.cleanupOrphanCardSources) this.cleanupOrphanCardSources() } catch (e) {}
    this.ensureUser()
    this.seedIfEmpty()
    this.backfillClientIds() // 老库/样例数据补齐 client_id 与 *_cid，保证可同步
    // 每日备份延迟到窗口显示后后台执行：copyFileSync 复制大库文件会阻塞启动，不抢首帧
    setTimeout(() => { try { this.autoBackup() } catch (e) { /* 备份失败不影响运行 */ } }, 4000)
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
    this._initModules()
  },

  // APK 异步初始化入口：SQL.js 驱动（wasm 加载为异步），初始化后行为与 Electron 一致。
  // usage: const db = require('./db'); await db.initAsync(await createSqlJsDriver({ file }))
  async initAsync(driver) {
    logger.info('db.initAsync 启动（SQL.js 驱动）')
    sqlite = driver
    this._initModules()
  },

  // 启动期数据库状态（供渲染端提示「已从备份恢复」）
  getDbStatus() {
    return { recovered: dbRecovered }
  },

  // 自动备份：每次启动把 tiku.db 复制到 backups/（按天去重），保留最近 5 份
  autoBackup() {
    try {
      const src = dbPath()
      // SQL.js 是内存库：无物理文件时先 persist 落盘（APK 场景），再走统一复制逻辑
      if (!fs.existsSync(src)) {
        if (sqlite && sqlite.persist) sqlite.persist()
      }
      if (!fs.existsSync(src)) return
      const dir = path.join(app.getPath('userData'), 'backups')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const dst = path.join(dir, `tiku-${stamp}.db`)
      if (fs.existsSync(dst)) return // 当天已备份过
      // WAL 模式下先 checkpoint，确保 -wal 中的写入也进入主库文件，否则备份缺本次会话数据
      // （SQL.js 无 WAL，checkpoint 内部 no-op）
      try { sqlite.checkpoint ? sqlite.checkpoint() : sqlite.pragma('wal_checkpoint(TRUNCATE)') } catch (e) {}
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
    const src = path.join(dir, path.basename(String(fileName))) // basename 防穿越
    if (!fs.existsSync(src)) return { ok: false, error: '备份文件不存在' }
    // 校验备份文件是合法 SQLite（文件头 "SQLite format 3"），防损坏备份覆盖主库
    try {
      const head = fs.readFileSync(src).subarray(0, 16).toString('latin1')
      if (!head.startsWith('SQLite format 3')) return { ok: false, error: '备份文件损坏（非 SQLite 数据库）' }
    } catch (e) {
      return { ok: false, error: '备份文件读取失败' }
    }
    try {
      if (sqlite) sqlite.close()
      sqlite = null
      const target = dbPath()
      fs.copyFileSync(src, target)
      for (const ext of ['-wal', '-shm']) {
        const w = target + ext
        if (fs.existsSync(w)) fs.unlinkSync(w)
      }
      // 重新打开连接（恢复失败路径不再留下"库已关"的死状态）
      this._tryOpen()
      return { ok: true }
    } catch (e) {
      // 复制失败：尽力重开连接，避免后续 IPC 全部 "connection not open"
      try { this._tryOpen() } catch (e2) {}
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

  // ---- 专注/断点续做方法已抽到 electron/db-habits.js（init 中合并）----

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
