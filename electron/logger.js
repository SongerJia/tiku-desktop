// 轻量持久化日志：写入 userData/logs/app-YYYY-MM-DD.log，并在控制台镜像输出。
// 不依赖具体 DB；electron 不可用时自动降级为仅控制台输出（不报错）。
const fs = require('fs')
const path = require('path')

let logDir = null
function ensureDir() {
  if (logDir !== null) return logDir
  try {
    const { app } = require('electron')
    logDir = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  } catch (e) {
    logDir = null // 降级：仅控制台
  }
  return logDir
}

function write(level, args) {
  const msg = args.map(a => (typeof a === 'object' ? safeStringify(a) : String(a))).join(' ')
  const ts = new Date().toISOString()
  const line = `[${ts}] [${level}] ${msg}`
  try {
    const dir = ensureDir()
    if (dir) {
      const file = path.join(dir, `app-${ts.slice(0, 10)}.log`)
      fs.appendFileSync(file, line + '\n')
    }
  } catch (e) { /* 写日志不应影响主流程 */ }
  if (level === 'ERROR') console.error(line)
  else if (level === 'WARN') console.warn(line)
  else console.log(line)
}

function safeStringify(o) {
  try { return JSON.stringify(o) } catch (e) { return String(o) }
}

module.exports = {
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
  log: (...a) => write('INFO', a)
}
