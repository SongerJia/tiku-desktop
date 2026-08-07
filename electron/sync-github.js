// GitHub Gist 同步模块（零后端方案）。
// 用 Node 全局 fetch 调 GitHub REST API，把整库 JSON 快照存进一个私有 Gist 文件。
// 权限只需 token 带 gist scope。所有请求统一带 Authorization: Bearer。
// 快照压缩：TKZ1: 前缀 + gzip + base64（体积降 70-85%，且绕开 Gist API 单文件 1MB 读取截断）。

const zlib = require('zlib')
const API = 'https://api.github.com'
const FILE = 'tiku-backup.json'

async function ghFetch(path, token, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'tiku-desktop',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {})
    }
  })
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
    const res = await fetch(f.raw_url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.raw+json',
        'User-Agent': 'tiku-desktop'
      }
    })
    if (!res.ok) throw new Error(`拉取完整快照失败（GitHub ${res.status}）`)
    content = await res.text()
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
