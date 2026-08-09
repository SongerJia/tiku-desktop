// GitHub 仓库文件同步（承载大文件：知识库文档原件 + 题目图片）。
// 组合方案：小数据走 WebDAV（坚果云），大文件走 GitHub 私有/公开仓库（免费 1GB、无流量限制）。
// cfg: { token, owner, repo }
// 存储模型（仓库内）：
//   tiku-manifest.json   文件清单 { kbFiles:{rel:sha256}, images:{name:sha256}, updatedAt }
//   kb/<rel_path>        知识库文档原件（逐段 encodeURIComponent）
//   images/<safeName>    题目图片
// 清单用「本地 sha256 快照」比对（远端 git blob sha 与本地 sha256 不可直接比）。
const { net } = require('electron')
const API = 'https://api.github.com'
const MANIFEST = 'tiku-manifest.json'

function ghFetch(path, token, opts = {}) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) }
  const p = net && net.fetch
    ? net.fetch(API + path, { method: opts.method || 'GET', body: opts.body, headers })
    : fetch(API + path, { method: opts.method || 'GET', body: opts.body, headers })
  return p.then(async (res) => {
    if (res.status === 404) { const e = new Error('NOT_FOUND'); e.status = 404; throw e }
    if (res.status >= 400) {
      const txt = await res.text().catch(() => '')
      const err = new Error(`GitHub ${path} → HTTP ${res.status} ${txt.slice(0, 120)}`)
      err.status = res.status
      throw err
    }
    return res.json()
  })
}

// 默认分支（raw 下载需要）
let branchCache = {}
async function defaultBranch(cfg) {
  if (branchCache[cfg.repo]) return branchCache[cfg.repo]
  const r = await ghFetch(`/repos/${cfg.owner}/${cfg.repo}`, cfg.token)
  branchCache[cfg.repo] = r.default_branch || 'main'
  return branchCache[cfg.repo]
}

// 连接校验：token 有效 + 仓库可访问
async function testConnection(cfg) {
  await defaultBranch(cfg)
  return true
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

// 下载文件（raw URL；公开仓库免 token，仍带 token 以兼容私有）
async function downloadFile(cfg, relPath) {
  const branch = await defaultBranch(cfg)
  const url = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${branch}/${encPath(relPath)}`
  const headers = { Authorization: `Bearer ${cfg.token}` }
  let res
  if (net && net.fetch) res = await net.fetch(url, { headers })
  else res = await fetch(url, { headers })
  if (res.status >= 400) throw new Error(`下载 ${relPath} → HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

module.exports = { testConnection, getManifest, putManifest, uploadFile, downloadFile }
