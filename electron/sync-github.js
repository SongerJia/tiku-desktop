// GitHub Gist 同步模块（零后端方案）。
// 用 Node 全局 fetch 调 GitHub REST API，把整库 JSON 快照存进一个私有 Gist 文件。
// 权限只需 token 带 gist scope。所有请求统一带 Authorization: Bearer。

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

// 拉取远端快照内容（字符串），无内容返回 null
async function getGist(token, gistId) {
  const g = await ghFetch(`/gists/${gistId}`, token)
  const f = g.files && g.files[FILE]
  return { content: f ? f.content : null, updatedAt: g.updated_at }
}

module.exports = { validateToken, createGist, updateGist, getGist, FILE }
