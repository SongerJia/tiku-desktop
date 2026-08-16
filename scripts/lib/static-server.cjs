// 静态文件服务器（供 mobile-sim 使用；独立模块便于无 Electron 环境下单测）
// 仅本机访问，路径安全（禁止跳出 distDir），无缓存（开发场景每次取最新产物）

const http = require('http')
const fs = require('fs')
const path = require('path')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
}

function createStaticServer(distDir, port) {
  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0])
      if (p.endsWith('/')) p += 'index.html'
      // 路径安全：禁止跳出 distDir
      const abs = path.normalize(path.join(distDir, p))
      if (!abs.startsWith(distDir + path.sep) && abs !== distDir) {
        res.writeHead(403); res.end('forbidden'); return
      }
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        res.writeHead(404); res.end('not found'); return
      }
      const ext = path.extname(abs).toLowerCase()
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      fs.createReadStream(abs).pipe(res)
    } catch (e) {
      res.writeHead(500); res.end(String(e))
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

module.exports = { createStaticServer }
