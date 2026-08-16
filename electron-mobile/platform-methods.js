// APK 端 18 平台方法实现（P5）：与 Electron main.js 的平台 handler 对齐。
// 分三类：
//   ① JS 可直接实现（数据层/纯计算）：saveImage / parseSheet / exportExcel*（复用 xlsx-lite，
//     zlib 已由 platform 注入 pako shim）/ gh*（GitHub 同步走 fetch + sync-runner，token 存 settings）
//   ② Capacitor 原生桥（文件选择/版本/外链）：kbPickFiles / kbImportFiles / restoreBackup /
//     getVersion / openExternal —— 调 window.Capacitor.Plugins.TikuBridge
//   ③ 首版占位（明确错误，不阻塞 UI）：checkUpdate / openPath / kbExport / kbOpen
// 由 boot.js 合并进 window.capacitorBridge.api。

import xlsxModule from '../electron/xlsx-lite.js'
import kbImportModule from '../electron/kb-import.js'
import syncRunnerFactory from '../electron/sync-runner.js'
// 以下静态 import（而非动态 import）：boot 是 IIFE 单 bundle，动态 import 会触发 code-splitting
// 与 IIFE 冲突；这些模块的顶层 require 均有惰性保护，boot 注入 platform 后加载安全。
import ghRepoModule from '../electron/sync-github-repo.js'
import platformModule from '../electron/platform.js'
import { webCryptoAvailable, generateKeyB64, importKeyB64, encryptToken, decryptToken } from './token-crypto.js'

const { readXlsx, writeXlsx } = xlsxModule
const { importKbFiles } = kbImportModule
const { platform } = platformModule

const KB_MIME = ['text/markdown', 'text/plain', 'application/pdf']

// 应用自身的 GitHub 仓库（APK 自动更新源；与 AboutModal 中仓库一致）
const GH_REPO = 'SongerJia/tiku-desktop'

// 语义化版本比较：a>b 返回 1，a<b 返回 -1，相等 0（按 . 分段数值比较）
function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0
    if (x !== y) return x - y
  }
  return 0
}

// 原生桥（Capacitor 插件；WebView 未注册时降级为不可用）
function nativeBridge() {
  return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins.TikuBridge : null
}

// base64 → Uint8Array（WebView Buffer polyfill 已提供，这里双保险）
function b64ToBytes(b64) {
  const clean = String(b64 || '').replace(/\s+/g, '')
  const bin = atob(clean)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

export function createPlatformMethods(db) {
  // ---- GitHub token 静态加密（S1 建议项）----
  // 密钥存 settings.gh_key（base64），token 以 AES-GCM 密文存 settings.gh_token。
  // 无 WebCrypto 时降级明文，保证功能不中断。
  async function getCryptoKey() {
    if (!webCryptoAvailable()) return null
    let b64 = db.getSetting('gh_key')
    if (!b64) { b64 = await generateKeyB64(); db.setSetting('gh_key', b64) }
    return importKeyB64(b64)
  }
  // 读取并解密 token；密文损坏/非本格式时按迁移前明文返回
  async function readToken() {
    const raw = db.getSetting('gh_token') || ''
    if (!raw) return ''
    if (!webCryptoAvailable()) return raw
    try {
      const k = await getCryptoKey()
      return await decryptToken(k, raw)
    } catch (e) {
      return raw // 兼容加密改造前的明文存储
    }
  }

  return {
    // ---- ① JS 直接实现 ----

    // 题图保存：db 层落盘（APK 走内存 fs，跳过 nativeImage 压缩存原始字节）
    saveImage: (buf, ext) => db.saveImage(buf, ext),

    // Excel 解析：复用 xlsx-lite（Electron 主进程同款逻辑）
    parseSheet: (buf) => {
      try {
        const matrix = readXlsx(new Uint8Array(buf))
        const rows = Array.isArray(matrix) && Array.isArray(matrix[0]) ? matrix : (matrix && matrix.rows ? matrix.rows : [])
        if (!rows.length) return []
        return rows.map(r => (Array.isArray(r) ? r : []).map(c => (c == null ? '' : String(c))))
      } catch (err) {
        throw new Error('Excel 解析失败：' + ((err && err.message) || String(err)))
      }
    },

    // 题库导出 Excel / 模板：xlsx-lite 生成 base64（渲染层转 blob 下载/保存）
    exportExcel: (subjectId) => {
      const rows = db.exportBank(subjectId || null)
      if (!rows || !rows.length) return null
      const matrix = rows.map(r => {
        const opts = Array.isArray(r.options) ? r.options : []
        const optCols = [0, 1, 2, 3, 4, 5].map(i => opts[i] || '')
        let ans = Array.isArray(r.answer) ? r.answer.join('') : String(r.answer || '')
        if (r.type === '判断' && ans) ans = (ans === 'true' || ans === '1') ? '对' : '错'
        return [r.subject || '', r.chapter || '', r.type || '', r.stem || '', ...optCols, ans,
          (Array.isArray(r.keywords) ? r.keywords.join('；') : ''), r.analysis || '', r.difficulty || 3, '']
      })
      const buf = writeXlsx(matrix, { sheetName: '题库' })
      return b64(buf)
    },

    exportExcelTemplate: () => b64(writeXlsx(TEMPLATE_SAMPLE_ROWS, { sheetName: '题库导入模板' })),
    exportCardTemplate: () => b64(writeXlsx([
      ['正面', '背面', '分类'],
      ['apple', 'n. 苹果；苹果树', '词汇'],
      ['abandon', 'v. 放弃；抛弃', '词汇'],
      ['りんご', '苹果', '単語']
    ], { sheetName: '记忆卡导入模板' })),

    // GitHub 仓库同步：token 加密存 settings（AES-GCM，APK 无 safeStorage；owner/repo 同 Electron）
    ghGetConfig: () => ({
      hasToken: !!(db.getSetting('gh_token') || ''),
      owner: db.getSetting('gh_owner') || '',
      repo: db.getSetting('gh_repo') || '',
      lastSync: Number(db.getSetting('gh_last_sync') || 0)
    }),

    ghSaveConfig: async (cfg) => {
      const t = String((cfg && cfg.token) || '').trim()
      if (t) {
        const k = await getCryptoKey()
        // 无 WebCrypto 时降级为明文存储（告警已在 readToken 路径兼容）
        db.setSetting('gh_token', k ? await encryptToken(k, t) : t)
        if (!k) console.warn('[gh] WebCrypto 不可用，token 以明文存储')
      }
      db.setSetting('gh_owner', String((cfg && cfg.owner) || '').trim())
      db.setSetting('gh_repo', String((cfg && cfg.repo) || '').trim())
      return { ok: true }
    },

    ghTest: async (cfg) => {
      const token = String((cfg && cfg.token) || '').trim() || await readToken()
      await ghRepoModule.testConnection({ token, owner: (cfg && cfg.owner) || '', repo: (cfg && cfg.repo) || '' })
      return { ok: true }
    },

    ghSync: async () => {
      const token = await readToken()
      const owner = db.getSetting('gh_owner') || ''
      const repo = db.getSetting('gh_repo') || ''
      if (!token || !owner || !repo) throw new Error('请先完成 GitHub 仓库配置')
      const runner = syncRunnerFactory(db)
      const r = await runner.sync({ token, owner, repo })
      db.setSetting('gh_last_sync', String(Date.now()))
      return r
    },

    // ---- ② Capacitor 原生桥 ----

    // 选择 md/pdf 文档：原生返回 [{ name, ext, size, base64 }]。
    // bridgeMissing 标记用于诊断：window.Capacitor.Plugins.TikuBridge 不存在（插件未注册/名不匹配）
    kbPickFiles: async () => {
      const nb = nativeBridge()
      if (!nb) return { bridgeMissing: true, files: [] }
      const r = await nb.kbPickFiles({ mimeTypes: KB_MIME })
      return (r && r.files) || []
    },

    // 选择并导入知识文档（字节 → 共享 importKbFiles，与 Electron 同一套去重/切块/入库）
    // paths 语义（跨端差异）：
    //   Electron：字符串路径数组（main.js 读磁盘）
    //   APK：kbPickFiles 预览返回的 [{ name, ext, base64 }] 对象数组 → 复用不重复弹选择器；
    //        空/null → 弹系统选择器
    kbImportFiles: async (paths, subjectId) => {
      let picked = paths
      const isObjList = Array.isArray(paths) && paths.length > 0 && typeof paths[0] === 'object'
      if (!isObjList) {
        const nb = nativeBridge()
        if (!nb) return []
        const r = await nb.kbPickFiles({ mimeTypes: KB_MIME })
        picked = (r && r.files) || []
      }
      const files = (picked || []).map(f => ({
        name: f.name, ext: f.ext, data: b64ToBytes(f.base64 || '')
      })).filter(f => f.data.length > 0)
      if (!files.length) {
        // 有选中项但字节为空 → 返回可读错误（此前静默失败无任何反馈，难排查）
        if (Array.isArray(picked) && picked.length > 0) {
          const first = picked[0] || {}
          return [{ ok: false, file: first.name || '文件', error: '未读取到文件内容（base64 为空，可能读取失败）' }]
        }
        return []
      }
      return importKbFiles(db, files, subjectId)
    },

    // 选择备份文件恢复：原生返回字节 → 覆盖内存库 tiku.db 并重开
    restoreBackup: async () => {
      const nb = nativeBridge()
      if (!nb) return { ok: false, error: '原生桥不可用' }
      const r = await nb.pickBackup()
      if (!r || !r.base64) return { ok: false, canceled: true }
      const bytes = b64ToBytes(r.base64)
      const head = String.fromCharCode.apply(null, bytes.slice(0, 16))
      if (!head.startsWith('SQLite format 3')) return { ok: false, error: '备份文件损坏（非 SQLite 数据库）' }
      platform.fs.writeFileSync('/data/tiku.db', bytes)
      // 立即落盘设备文件（平台方法不经防抖调度），否则 reload 前内存快照未写回会丢恢复结果
      try { if (platform && platform.fs && platform.fs._persistToStorage) await platform.fs._persistToStorage() } catch (e) {}
      return { ok: true, needRestart: true } // WebView 需 reload 使新库生效
    },

    getVersion: async () => {
      const nb = nativeBridge()
      if (nb) { const r = await nb.getVersion(); if (r && r.version) return r }
      return { name: '知识记忆小助手', version: '0.7.0' }
    },

    openExternal: async (url) => {
      const u = String(url || '')
      if (!/^https?:\/\//i.test(u)) return { ok: false, error: '仅支持 http/https 链接' }
      const nb = nativeBridge()
      if (nb) { await nb.openExternal({ url: u }); return { ok: true } }
      return { ok: false, error: '原生桥不可用' }
    },

    // ---- ③ 自动更新（APK 应用内更新，基于 GitHub Releases）----
    // 检测：查本仓库 latest release，比较版本号；返回可用版本与 APK 下载地址。
    // 桌面端不走这里（走 electron-updater）；前端靠 downloadUrl 是否存在区分两平台。
    checkUpdate: async () => {
      const nb = nativeBridge()
      if (!nb) return { ok: false, error: '原生桥不可用（非 APK 环境）' }
      try {
        const cur = await nb.getVersion()
        const curVer = String((cur && cur.version) || '0.0.0').replace(/^v/, '')
        const api = 'https://api.github.com/repos/' + GH_REPO + '/releases/latest'
        const resp = await fetch(api, {
          headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'tiku-desktop' }
        })
        if (!resp.ok) return { ok: false, error: '查询更新失败（HTTP ' + resp.status + '）' }
        const rel = await resp.json()
        const tag = String(rel.tag_name || '').replace(/^v/, '')
        const assets = Array.isArray(rel.assets) ? rel.assets : []
        const apk = assets.find(a => String(a.name || '').toLowerCase().endsWith('.apk'))
        if (!apk) return { ok: true, available: false, version: tag }
        return {
          ok: true,
          available: cmpVer(tag, curVer) > 0,
          version: tag,
          downloadUrl: apk.browser_download_url,
          size: Number(apk.size || 0)
        }
      } catch (e) {
        return { ok: false, error: '检查更新异常：' + (e && e.message ? e.message : e) }
      }
    },

    // 下载并安装：fetch APK（带进度）→ 写设备文件 → 调起系统安装器。
    // onProgress(percent) 由调用方传入（如 AboutModal 进度条）；无总长度时不回调。
    // 注意：覆盖安装要求新 APK 与已装应用同一签名（release 包），否则安装器会报签名不一致。
    downloadUpdate: async (downloadUrl, onProgress) => {
      const nb = nativeBridge()
      if (!nb) return { ok: false, error: '原生桥不可用' }
      if (!downloadUrl) return { ok: false, error: '缺少下载地址' }
      const resp = await fetch(downloadUrl)
      if (!resp.ok) throw new Error('下载失败（HTTP ' + resp.status + '）')
      const total = Number(resp.headers.get('content-length') || 0)
      const reader = resp.body.getReader()
      const chunks = []
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) { chunks.push(value); received += value.length }
        if (onProgress && total) onProgress(Math.min(99, Math.floor(received / total * 100)))
      }
      const len = chunks.reduce((a, c) => a + c.length, 0)
      const u8 = new Uint8Array(len)
      let off = 0
      for (const c of chunks) { u8.set(c, off); off += c.length }
      // 写设备文件（TikuBridge.fsWrite → getFilesDir()/tiku/update.apk）
      await nb.fsWrite({ name: 'update.apk', data: b64(u8) })
      // 调起系统安装器（FileProvider 已授权临时读权限）
      await nb.installApk({ path: 'tiku/update.apk' })
      return { ok: true }
    },
    openPath: async () => ({ ok: false, error: 'APK 端不支持打开系统路径（文件已保存在应用目录）' }),
    kbExport: async () => ({ ok: false, error: 'APK 端暂不支持目录导出（可走 GitHub 同步备份）' }),
    kbOpen: async () => ({ ok: false, error: 'APK 端不支持系统打开原件' })
  }
}

// 题库导入模板样例（与 main.js 一致：含表头 + 4 行示例）
const EXPORT_HEADER = ['科目', '章节', '题型', '题干', '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '答案', '解析', '知识点', '难度', '来源']
const TEMPLATE_SAMPLE_ROWS = [
  EXPORT_HEADER,
  ['建设工程法规', '基本法律知识', '单选', '根据《民法典》，下列不属于法人应当具备条件的是？',
   '依法成立', '有必要的财产或者经费', '有自己的名称、组织机构和场所', '必须营利', '', '',
   'D', '', '法人并不以营利为必要条件，非营利法人同样具有法人资格。', 2, '教材例题'],
  ['建设工程施工管理', '施工组织设计', '多选', '施工组织设计一般应包括的内容有（ ）。',
   '工程概况', '施工部署', '施工进度计划', '施工准备与资源配置计划', '', '',
   'ABCD', '', '施工组织设计通常包括上述内容及主要施工方法、平面布置、管理计划等。', 3, '教材例题'],
  ['建设工程法规', '施工许可法律制度', '判断', '建设单位未取得施工许可证擅自施工的，责令停止施工，可以并处以罚款。（ ）',
   '', '', '', '', '', '', '对', '', '依据《建筑法》第六十四条。', 1, '教材例题'],
  ['建设工程施工管理', '施工管理基础', '问答', '简述施工进度计划编制的主要步骤，并说明关键控制点。',
   '', '', '', '', '', '',
   '①收集资料 ②划分施工过程 ③计算工程量 ④确定持续时间 ⑤编制初始计划 ⑥检查与优化 ⑦交底与动态调整。关键控制点是持续时间估算与关键线路识别。',
   '收集资料；划分施工过程；计算工程量；持续时间；网络图；关键线路；资源均衡；动态调整',
   '本题考查施工进度计划编制流程。', 4, '教材例题']
]

// Uint8Array → base64（浏览器 btoa 分块，避免 apply 超参）
function b64(u8) {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk))
  }
  return btoa(bin)
}
