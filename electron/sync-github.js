// GitHub Gist 同步模块（零后端方案）。
// 请求优先走 Electron net.fetch（Chromium 网络栈）：继承系统代理 + 系统证书信任，
// 解决 Node 原生 fetch 不认系统代理证书导致的 UNABLE_TO_VERIFY_LEAF_SIGNATURE。
// 快照压缩：TKZ1: 前缀 + gzip + base64（体积降 70-85%，且绕开 Gist API 单文件 1MB 读取截断）。

const zlib = require('zlib')
const { net } = require('electron')
const API = 'https://api.github.com'
const FILE = 'tiku-backup.json'          // 旧版单文件（兼容读取）
const CHUNK_BASE = 'tiku-backup.json.'  // 新版多文件分块前缀（.0/.1/...）
const IMG_PREFIX = 'tiku-img.'          // 独立图片文件前缀（每个图片一个/多个分块）
const IMG_INDEX = 'tiku-img-index.json' // 图片清单：{ entries: [{name, key, hash, parts}] }

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

// 首次同步：建一个私有 Gist，返回 gistId。files 为 encodeSnapshotChunks 产出的多文件对象。
async function createGist(token, files) {
  const body = {
    description: 'tiku-desktop 学习数据同步',
    public: false,
    files
  }
  const g = await ghFetch('/gists', token, { method: 'POST', body: JSON.stringify(body) })
  return { gistId: g.id, updatedAt: g.updated_at }
}

// 后续同步：用新分块覆盖旧文件，并把旧分块/旧单文件置 null 删除（Gist 不自动清理残留文件）。
// files 为多文件对象；oldFileKeys 为「上一次 gist 实际包含的文件名」（由 getGist 返回），
// 用于精确置空，避免残留 .N 分块随库体积变化而累积。
async function updateGist(token, gistId, files, oldFileKeys) {
  const next = {}
  for (const k of (oldFileKeys || [])) next[k] = null            // 删除旧分块与旧单文件
  next[FILE] = null                                              // 兼容：清掉旧单文件
  Object.assign(next, files)                                     // 写入新分块
  const body = { files: next }
  const g = await ghFetch(`/gists/${gistId}`, token, { method: 'PATCH', body: JSON.stringify(body) })
  return { gistId: g.id, updatedAt: g.updated_at }
}

// 拉取远端快照内容（解码后的原始 JSON 字符串），无内容返回 null。
// 兼容旧单文件与新多文件分块；任一分块截断时用 raw_url 补拉。
async function getGist(token, gistId) {
  const g = await ghFetch(`/gists/${gistId}`, token)
  const f = g.files || {}
  if (!Object.keys(f).length) return { content: null, images: [], updatedAt: g.updated_at, truncated: false, fileKeys: [], imgManifest: null }
  const content = await decodeSnapshotChunks(f, token)
  const images = await decodeImageFiles(f, token)
  // 解析图片清单（供同步编排层识别未变更图片、跳过重传）
  let imgManifest = null
  const idxFile = f[IMG_INDEX]
  if (idxFile) {
    try {
      const c = idxFile.truncated ? await fetchRaw(idxFile.raw_url, token) : (idxFile.content || '')
      imgManifest = JSON.parse(c)
    } catch (e) { /* 清单损坏不阻断 */ }
  }
  const truncated = Object.values(f).some(x => x && x.truncated)
  return { content, images, updatedAt: g.updated_at, truncated, fileKeys: Object.keys(f), imgManifest }
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

// 多文件分块：Gist 单文件硬上限 1MB，超大题库（尤其内嵌图片）单文件必失败。
// 改为把编码后的字符串切成多个 <900KB 的文件（tiku-backup.json.0/.1/...），
// 总容量随分块数线性扩展，彻底绕开 1MB 限制。base64 为 ASCII（≈1 字节/字符），故按字符切片即按字节。
function encodeSnapshotChunks(jsonStr, maxBytes = 900 * 1024) {
  const encoded = encodeSnapshot(jsonStr)
  const files = {}
  let i = 0
  let idx = 0
  while (i < encoded.length) {
    files[CHUNK_BASE + idx] = { content: encoded.slice(i, i + maxBytes) }
    i += maxBytes
    idx++
  }
  if (idx === 0) files[CHUNK_BASE + '0'] = { content: encoded } // 空快照也至少一块
  return { files, count: idx }
}

// 从 Gist 的 files 对象还原完整解码字符串：兼容旧单文件 + 新多文件分块。
// 任一分块被截断（>1MB，理论上不会因 <900KB 发生）时用 raw_url 补拉。
async function decodeSnapshotChunks(files, token) {
  const names = Object.keys(files || {})
  const single = files[FILE]
  const chunks = names
    .filter(n => n.startsWith(CHUNK_BASE))
    .map(n => ({ idx: Number(n.slice(CHUNK_BASE.length)), file: files[n] }))
    .sort((a, b) => a.idx - b.idx)

  let encoded
  if (single && chunks.length === 0) {
    encoded = single.truncated ? await fetchRaw(single.raw_url, token) : (single.content || '')
  } else {
    const parts = await Promise.all(chunks.map(async c => {
      return c.file && c.file.truncated ? await fetchRaw(c.file.raw_url, token) : (c.file && c.file.content || '')
    }))
    encoded = parts.join('')
  }
  return decodeSnapshot(encoded)
}

async function fetchRaw(url, token) {
  const init = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.raw+json',
      'User-Agent': 'tiku-desktop'
    }
  }
  const raw = (net && typeof net.fetch === 'function') ? await net.fetch(url, init) : await fetch(url, init)
  if (!raw.ok) throw new Error(`拉取完整快照失败（GitHub ${raw.status}）`)
  return raw.text()
}

// 把图片数组编码为独立 Gist 文件 + 清单（快照 JSON 不再内嵌 base64 图片，显著瘦身）。
// imgList: [{ name, buffer, hash }]；每个图 gzip+base64，单文件 <=900KB 避免 Gist 1MB 截断；
// 超长则自动分块（.0/.1/...）。返回 { files: {gistKey:{content}}, index: <清单 JSON 字符串> }。
// 文件名做 base64url 安全化（无 . / + 歧义），清单保存原名→密钥映射，解码时还原。
function encodeImageFiles(imgList) {
  const files = {}
  const entries = []
  const maxBytes = 900 * 1024
  for (const im of imgList || []) {
    if (!im || !im.name || !im.buffer) continue
    const safe = Buffer.from(String(im.name)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    const key = IMG_PREFIX + safe
    let encoded
    try { encoded = zlib.gzipSync(im.buffer).toString('base64') } catch (e) { continue }
    if (encoded.length <= maxBytes) {
      files[key] = { content: encoded }
      entries.push({ name: im.name, key, hash: im.hash || '', parts: 1 })
    } else {
      let i = 0
      for (let off = 0; off < encoded.length; off += maxBytes, i++) {
        files[`${key}.${i}`] = { content: encoded.slice(off, off + maxBytes) }
      }
      entries.push({ name: im.name, key, hash: im.hash || '', parts: i })
    }
  }
  const index = JSON.stringify({ version: 1, entries })
  return { files, index }
}

// 从 Gist files 对象还原图片二进制数组 [{name, buffer}]（配合 encodeImageFiles）。
// 读取清单定位每个图的密钥/分块数，分块或被截断时按 raw_url 补拉；单图失败不影响整体。
async function decodeImageFiles(files, token) {
  const f = files || {}
  const idxFile = f[IMG_INDEX]
  if (!idxFile) return []
  let idx
  try {
    const c = idxFile.truncated ? await fetchRaw(idxFile.raw_url, token) : (idxFile.content || '')
    idx = JSON.parse(c)
  } catch (e) { return [] }
  const out = []
  for (const e of (idx.entries || [])) {
    try {
      let encoded = ''
      if (e.parts && e.parts > 1) {
        for (let i = 0; i < e.parts; i++) {
          const cf = f[`${e.key}.${i}`]
          if (!cf) break
          encoded += cf.truncated ? await fetchRaw(cf.raw_url, token) : (cf.content || '')
        }
      } else {
        const cf = f[e.key]
        if (!cf) continue
        encoded += cf.truncated ? await fetchRaw(cf.raw_url, token) : (cf.content || '')
      }
      if (!encoded) continue
      const buf = zlib.gunzipSync(Buffer.from(encoded, 'base64'))
      out.push({ name: e.name, buffer: buf })
    } catch (e) { /* 单图损坏跳过 */ }
  }
  return out
}

module.exports = { validateToken, createGist, updateGist, getGist, encodeSnapshot, decodeSnapshot, encodeSnapshotChunks, decodeSnapshotChunks, encodeImageFiles, decodeImageFiles, FILE, CHUNK_BASE, IMG_PREFIX, IMG_INDEX }
