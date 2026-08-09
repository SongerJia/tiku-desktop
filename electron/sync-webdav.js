// WebDAV 同步传输层（坚果云 / 123 云盘 / 自建 WebDAV 通用）。
// 与 Gist 版不同：WebDAV 无单文件 1MB 限制 → 采用「目录 + 多文件」模型：
//   <webdav根>/tiku-sync/
//   ├── data.json.gz      数据快照（exportSync 全量，gzip）
//   ├── manifest.json     元数据（更新时间/设备/文件清单）
//   ├── images/<name>     题目图片（hash 去重增量）
//   └── kb/<rel_path>     知识库文档原件（hash 去重增量）
// 传输走 Electron net.fetch（系统代理/证书），降级原生 fetch；Basic Auth。
// cfg: { url, user, pass }（url 形如 https://dav.jianguoyun.com/dav/）
const zlib = require('zlib')

const { net } = require('electron')
const ROOT = '/tiku-sync'

function baseUrl(cfg) {
  return String(cfg.url || '').replace(/\/+$/, '')
}

async function wdFetch(cfg, method, path, body, extraHeaders = {}) {
  const url = baseUrl(cfg) + path
  const headers = {
    Authorization: 'Basic ' + Buffer.from(`${cfg.user || ''}:${cfg.pass || ''}`).toString('base64'),
    ...extraHeaders
  }
  let res
  if (net && net.fetch) res = await net.fetch(url, { method, body, headers })
  else res = await fetch(url, { method, body, headers })
  if (res.status >= 400) {
    const err = new Error(`WebDAV ${method} ${path} → HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return res
}

// ---- 数据快照（gzip JSON 单文件）----
async function uploadData(cfg, jsonStr) {
  const buf = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'))
  await wdFetch(cfg, 'PUT', ROOT + '/data.json.gz', buf, { 'Content-Type': 'application/gzip' })
  return buf.length
}

async function downloadData(cfg) {
  try {
    const res = await wdFetch(cfg, 'GET', ROOT + '/data.json.gz')
    const buf = Buffer.from(await res.arrayBuffer())
    return zlib.gunzipSync(buf).toString('utf8')
  } catch (e) {
    if (e.status === 404) return null // 首次同步：远端还没有
    throw e
  }
}

// ---- manifest：更新时间 + kb/图片文件清单（避免依赖 PROPFIND）----
async function putManifest(cfg, m) {
  await wdFetch(cfg, 'PUT', ROOT + '/manifest.json', Buffer.from(JSON.stringify(m)), { 'Content-Type': 'application/json' })
}
async function getManifest(cfg) {
  try {
    const res = await wdFetch(cfg, 'GET', ROOT + '/manifest.json')
    return JSON.parse(await res.text())
  } catch (e) {
    if (e.status === 404) return null
    throw e
  }
}

// ---- 图片（清单驱动增量）----
function safeImgName(name) {
  // 文件名 base64url 安全化（与 Gist 版一致：无 . / + 歧义）
  return Buffer.from(String(name)).toString('base64url')
}
async function uploadImage(cfg, name, buffer) {
  await wdFetch(cfg, 'PUT', ROOT + '/images/' + safeImgName(name), buffer)
}
async function downloadImage(cfg, name) {
  const res = await wdFetch(cfg, 'GET', ROOT + '/images/' + safeImgName(name))
  return Buffer.from(await res.arrayBuffer())
}

// ---- 知识库文档原件（按 rel_path 子路径，逐段 encode 防路径歧义）----
function kbKey(rel) {
  return String(rel).split('/').map(encodeURIComponent).join('/')
}
async function uploadKbFile(cfg, rel, buffer) {
  await wdFetch(cfg, 'PUT', ROOT + '/kb/' + kbKey(rel), buffer)
}
async function downloadKbFile(cfg, rel) {
  const res = await wdFetch(cfg, 'GET', ROOT + '/kb/' + kbKey(rel))
  return Buffer.from(await res.arrayBuffer())
}

// ---- 连接校验（写测试文件，供 UI「测试连接」）----
async function testConnection(cfg) {
  const probe = '/tiku-sync/.probe'
  await wdFetch(cfg, 'PUT', probe, Buffer.from('ok'))
  await wdFetch(cfg, 'DELETE', probe)
  return true
}

module.exports = {
  uploadData, downloadData,
  putManifest, getManifest,
  uploadImage, downloadImage,
  uploadKbFile, downloadKbFile,
  testConnection
}
