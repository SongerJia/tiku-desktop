// WebDAV 同步传输层（坚果云 / 123 / 自建通用）。
// 组合方案下，WebDAV 只承载「数据快照」（学习数据+题库，小、国内快）；
// 大文件（知识库文档原件 + 题目图片）由 sync-github-repo 走 GitHub 仓库。
// <webdav根>/tiku-sync/
// ├── data.json.gz      数据快照（exportSync 全量，gzip）
// └── manifest.json     元数据（更新时间/设备）
// cfg: { url, user, pass }
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
    if (e.status === 404) return null // 首次同步
    throw e
  }
}

// ---- manifest：更新时间/设备 ----
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

// ---- 连接校验（写测试文件，供 UI「测试连接」）----
async function testConnection(cfg) {
  const probe = ROOT + '/.probe'
  await wdFetch(cfg, 'PUT', probe, Buffer.from('ok'))
  await wdFetch(cfg, 'DELETE', probe)
  return true
}

module.exports = {
  uploadData, downloadData,
  putManifest, getManifest,
  testConnection
}
