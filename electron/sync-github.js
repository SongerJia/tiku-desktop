// GitHub Gist 同步模块（零后端方案）。
// 请求优先走 Electron net.fetch（Chromium 网络栈）：继承系统代理 + 系统证书信任，
// 解决 Node 原生 fetch 不认系统代理证书导致的 UNABLE_TO_VERIFY_LEAF_SIGNATURE。
// 快照压缩：TKZ1: 前缀 + gzip + base64（体积降 70-85%，且绕开 Gist API 单文件 1MB 读取截断）。

const zlib = require('zlib')
const { net } = require('electron')
const API = 'https://api.github.com'
const FILE = 'tiku-backup.json'

// 统一请求入口：Electron net.fetch 优先（系统代理/证书），降级原生 fetch
async function ghFetch(path, token, opts = {}) {
  const url = API + path
  const init = {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'tiku-desktop',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {})
    }
  }
  let res
  try {
    if (net && typeof net.fetch === 'function') res = await net.fetch(url, init)
    else res = await fetch(url, init)
  } catch (e) {
    const msg = (e && e.message) || String(e)
    if (/certificate|TLS|SSL/i.test(msg)) {
      throw new Error('网络证书校验失败（请求被代理或防火墙拦截）。请检查网络代理设置，或在「偏好设置」关闭再打开自动同步后重试')
    }
    throw new Error('网络请求失败：' + msg)
  }
  if (!res.ok) {
    let msg = `GitHub API ${res.status}`
    try {
      const j = await res.json()
      if (j && j.message) msg += ': ' + j.message
    } catch (e) { /* 非 JSON 错误体 */ }
    throw new Error(msg)
  }
  if (res.status === 204) return null
  return res.json()
}

// 校验 token 是否可用，并返回登录名（用于 UI 展示）
async function validateToken(token) {
  const u = await ghFetch('/user', token)
  return { login: u.login, name: u.name || u.login }
}

// 首次同步：建一个私有 Gist，返回 gistId
async function createGist(token, content) {
  const body = {
    description: 'tiku-desktop 学习数据同步',
    public: false,
    files: { [FILE]: { content } }
  }
  const g = await ghFetch('/gists', token, { method: 'POST', body: JSON.stringify(body) })
  return { gistId: g.id, updatedAt: g.updated_at }
}

// 后续同步：更新已有 Gist 的文件内容
async function updateGist(token, gistId, content) {
  const body = { files: { [FILE]: { content } } }
  const g = await ghFetch(`/gists/${gistId}`, token, { method: 'PATCH', body: JSON.stringify(body) })
  return { gistId: g.id, updatedAt: g.updated_at }
}

// 拉取远端快照内容（字符串），无内容返回 null。
// 关键保护：Gist API 单文件读取上限 1MB——超限时 f.truncated=true 且 content 残缺，
// 必须改用 raw_url 拉全量，否则合并会静默丢数据。返回的 content 始终是解码后的原始 JSON。
async function getGist(token, gistId) {
  const g = await ghFetch(`/gists/${gistId}`, token)
  const f = g.files && g.files[FILE]
  if (!f) return { content: null, updatedAt: g.updated_at, truncated: false }
  let content = f.content
  if (f.truncated) {
    // API 只给了前 1MB（残缺）→ 用 raw_url 拉完整内容（带认证，私有 gist 也能读）
    const init = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.raw+json',
        'User-Agent': 'tiku-desktop'
      }
    }
    const raw = (net && typeof net.fetch === 'function') ? await net.fetch(f.raw_url, init) : await fetch(f.raw_url, init)
    if (!raw.ok) throw new Error(`拉取完整快照失败（GitHub ${raw.status}）`)
    content = await raw.text()
  }
  return { content: decodeSnapshot(content), updatedAt: g.updated_at, truncated: !!f.truncated }
}

// 快照压缩：'TKZ1:' + gzip(json).toString('base64')。老数据无前缀时原样返回（兼容旧 Gist）
function encodeSnapshot(jsonStr) {
  const buf = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'))
  return 'TKZ1:' + buf.toString('base64')
}

function decodeSnapshot(content) {
  if (!content || typeof content !== 'string') return content
  if (content.startsWith('TKZ1:')) {
    try {
      return zlib.gunzipSync(Buffer.from(content.slice(5), 'base64')).toString('utf8')
    } catch (e) {
      throw new Error('快照解压失败（数据可能损坏）：' + ((e && e.message) || e))
    }
  }
  return content // 旧版本未压缩快照
}

module.exports = { validateToken, createGist, updateGist, getGist, encodeSnapshot, decodeSnapshot, FILE }
