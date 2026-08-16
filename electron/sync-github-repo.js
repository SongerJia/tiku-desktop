// GitHub 仓库文件同步（唯一同步后端：数据快照 + 知识库文档 + 题目图片 全走仓库）。
// 免费私有仓库 1GB、无流量限制；cfg: { token, owner, repo }
// 存储模型（仓库内）：
//   data.json.gz        数据快照（exportSync 全量，gzip）
//   tiku-manifest.json  文件清单 { kbFiles:{rel:sha256}, images:{name:sha256}, updatedAt }
//   kb/<rel_path>        知识库文档原件（逐段 encodeURIComponent）
//   images/<safeName>    题目图片
// 清单用「本地 sha256 快照」比对（远端 git blob sha 与本地 sha256 不可直接比）。
// P5：electron net 惰性化（WebView 无 electron → 用全局 fetch）；zlib 从 platform 取
const { platform } = require('./platform')
const zlib = platform.zlib || require('zlib')
let net = null
try { net = require('electron').net } catch (e) { /* WebView：走全局 fetch */ }
const API = 'https://api.github.com'
const MANIFEST = 'tiku-manifest.json'

function ghFetch(path, token, opts = {}) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) }
  const signal = opts.signal || AbortSignal.timeout(30000) // 30s 超时，防网络挂起永久转圈
  const p = net && net.fetch
    ? net.fetch(API + path, { method: opts.method || 'GET', body: opts.body, headers, signal })
    : fetch(API + path, { method: opts.method || 'GET', body: opts.body, headers, signal })
  return p.then(async (res) => {
    if (res.status >= 400) {
      let msg = ''
      try { const j = await res.json(); msg = (j && j.message) || '' } catch (e) {}
      const err = new Error(msg || `HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return res.json()
  })
}

// 默认分支（raw 下载需要；键含 owner+repo，避免同名仓库串）
let branchCache = {}
async function defaultBranch(cfg) {
  const key = `${cfg.owner}/${cfg.repo}`
  if (branchCache[key]) return branchCache[key]
  const r = await ghFetch(`/repos/${cfg.owner}/${cfg.repo}`, cfg.token)
  branchCache[key] = r.default_branch || 'main'
  return branchCache[key]
}

// 连接校验：token 有效 + 仓库可访问（区分 404=仓库/名称错，401/403=token 错）
async function testConnection(cfg) {
  try {
    await defaultBranch(cfg)
    return true
  } catch (e) {
    if (e.status === 404) throw new Error('仓库不存在或「拥有者/仓库名」填写有误（例如 songerjia/tiku-assets；注意仓库名不含 .git）')
    if (e.status === 401 || e.status === 403) throw new Error('Token 无效或无权限访问该仓库（检查 token 是否带 repo 权限、是否被撤销）')
    throw e
  }
}

function encPath(p) {
  return String(p).split('/').map(encodeURIComponent).join('/')
}

// 读仓库文件清单；不存在返回 null
async function getManifest(cfg) {
  try {
    const r = await ghFetch(`/repos/${cfg.owner}/${cfg.repo}/contents/${MANIFEST}`, cfg.token)
    return JSON.parse(Buffer.from(r.content, 'base64').toString('utf8'))
  } catch (e) {
    if (e.status === 404) return null
    throw e
  }
}

async function putManifest(cfg, m) {
  await uploadFile(cfg, MANIFEST, Buffer.from(JSON.stringify(m)))
}

// 上传文件（contents API，base64；已存在则带 sha 更新）
async function uploadFile(cfg, relPath, buf) {
  let sha = null
  try {
    const r = await ghFetch(`/repos/${cfg.owner}/${cfg.repo}/contents/${encPath(relPath)}`, cfg.token)
    sha = r.sha
  } catch (e) { /* 404 → 新建 */ }
  const body = { message: 'sync', content: buf.toString('base64') }
  if (sha) body.sha = sha
  await ghFetch(`/repos/${cfg.owner}/${cfg.repo}/contents/${encPath(relPath)}`, cfg.token, { method: 'PUT', body: JSON.stringify(body) })
}

// 删除远端文件（软删文档的同步传播：文件本体也从仓库移除）
async function deleteFile(cfg, relPath) {
  let sha = null
  try {
    const r = await ghFetch(`/repos/${cfg.owner}/${cfg.repo}/contents/${encPath(relPath)}`, cfg.token)
    sha = r.sha
  } catch (e) {
    if (e.status === 404) return { ok: true, notFound: true } // 已不存在，视为成功
    throw e
  }
  await ghFetch(`/repos/${cfg.owner}/${cfg.repo}/contents/${encPath(relPath)}`, cfg.token, {
    method: 'DELETE',
    body: JSON.stringify({ message: 'sync-del', sha })
  })
  return { ok: true }
}

// 下载文件（raw URL；public 免 token，仍带 token 以兼容 private；30s 超时）
async function downloadFile(cfg, relPath) {
  const branch = await defaultBranch(cfg)
  const headers = { Authorization: `Bearer ${cfg.token}` }
  const url = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${branch}/${encPath(relPath)}`

  // 主源 raw.githubusercontent.com 国内网络不稳（常 502/超时）→ 自动重试 3 次（退避）
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const signal = AbortSignal.timeout(30000)
      let res
      if (net && net.fetch) res = await net.fetch(url, { headers, signal })
      else res = await fetch(url, { headers, signal })
      if (res.status === 404) { const e = new Error(`下载 ${relPath} → HTTP 404`); e.status = 404; throw e }
      if (res.status >= 400) throw new Error(`下载 ${relPath} → HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      if (e.status === 404) throw e // 文件不存在不重试
      lastErr = e
      await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)))
    }
  }

  // 备用源：GitHub API contents（base64，api.github.com 相对稳定）
  try {
    const r = await ghFetch(`/repos/${cfg.owner}/${cfg.repo}/contents/${encPath(relPath)}`, cfg.token)
    if (r.content) return Buffer.from(String(r.content).replace(/\s/g, ''), 'base64')
    // >1MB 文件 contents API 不给 content，只给 download_url → 直接拉 raw 直链
    if (r.download_url) {
      const f = net && net.fetch ? net.fetch.bind(net) : fetch.bind(globalThis)
      const res = await f(r.download_url, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(60000) })
      if (res.status >= 400) throw new Error(`下载 ${relPath} → HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    }
    throw new Error(`下载 ${relPath}：contents 无内容`)
  } catch (e) {
    if (e.status === 404) { e.status = 404; throw e }
    throw lastErr || e
  }
}

// ---- 数据快照（data.json.gz：gzip 压缩，避免 base64 膨胀超限）----
// 统一走同步 API（node zlib gzipSync / pako gzip），返回 Promise<Buffer> 保持原接口
const gzip = async (buf) => Buffer.from(zlib.gzipSync(buf))
const gunzip = async (buf) => Buffer.from(zlib.gunzipSync(buf))

async function uploadData(cfg, jsonStr) {
  const buf = await gzip(Buffer.from(jsonStr, 'utf8'))
  await uploadFile(cfg, 'data.json.gz', buf)
  return buf.length
}

async function downloadData(cfg) {
  try {
    const buf = await downloadFile(cfg, 'data.json.gz')
    return (await gunzip(buf)).toString('utf8')
  } catch (e) {
    if (e.status === 404) return null // 首次同步
    throw e
  }
}

module.exports = { testConnection, getManifest, putManifest, uploadFile, deleteFile, downloadFile, uploadData, downloadData }
