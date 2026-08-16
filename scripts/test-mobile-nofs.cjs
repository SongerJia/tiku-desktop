// WebView 无 node 环境测试（P7 自审建立）：模拟 APK WebView（无 require('fs'/'path'/'crypto'/'zlib'/'electron'）），
// 加载 electron/ 源码（CJS），验证 boot + 数据操作 + 知识库导入 + Excel + 记忆卡 全链路。
//
// 为什么需要这个测试：test-mobile-boot/test-mobile-dist 在 node 环境跑，node 有 require('fs')
// 兜底 → platform.fs 默认非 null，掩盖「WebView 无 node 时 platform.fs=null」的问题
// （真机/模拟器报 Cannot read properties of null (reading 'existsSync') 就是这类）。
// 本测试拦截 node 内置模块，platform.fs 初始 null → setPlatform 注入 memFs → 验证后续调用拿到 memFs。
//
// 用法：node scripts/test-mobile-nofs.cjs

const Module = require('module')

// ---- 1) 拦截 node 内置模块（模拟 WebView 无 node）----
// 先预热 sql.js（其内部 require('fs') 读 wasm 需要真实 fs；WebView 中 sql.js 走 fetch/wasmBinary）
require('sql.js')
const realPath = require('path') // 拦截前保存真实 path/fs（测试脚本自身用）
const realFs = require('fs')
const BLOCKED = new Set(['fs', 'path', 'crypto', 'zlib', 'os', 'util', 'events', 'stream', 'buffer', 'electron', 'better-sqlite3'])
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (BLOCKED.has(request)) {
    const e = new Error('模拟 WebView：模块不可用 ' + request)
    e.code = 'WEBVIEW_BLOCKED'
    throw e
  }
  return origLoad.call(this, request, parent, isMain)
}

// ---- 2) 测试基础设施 ----
let pass = 0
let fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('OK  ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}
const OUT = 'mobile-nofs-test-out.txt'

async function main() {
  const out = []
  const log = (s) => { out.push(s); console.log(s) }

  // 3) 注入 Capacitor 平台（模拟 platform-init）
  const { setPlatform } = require('../electron/platform.js')
  const { createCapacitorPlatform } = require('../electron/platform-capacitor.js')
  const platformShim = createCapacitorPlatform({ rootDir: '/data' })
  setPlatform(platformShim)
  ok('setPlatform 注入后 platform.fs 非 null', !!require('../electron/platform.js').platform.fs)

  // 4) SQL.js db 初始化（wasm 从 node_modules 读字节传 wasmBinary，绕过 fs/fetch）
  const { createSqlJsDriver } = require('../electron/db-driver.js')
  const db = require('../electron/db.js')
  const wasmPath = realPath.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  const wasmBytes = realFs.readFileSync(wasmPath)
  const driver = await createSqlJsDriver({
    file: '/data/tiku.db',
    wasmBinary: new Uint8Array(wasmBytes),
  })
  await db.initAsync(driver)
  ok('db.initAsync 成功（建表/种子）', true)

  // 5) 数据服务
  const { createDataService } = require('../electron/service.js')
  const svc = createDataService(db)

  // 6) 核心数据操作（覆盖真实 WebView 调用）
  const qs = svc.listQuestions({ page: 1, pageSize: 5 })
  ok('listQuestions 分页查询', qs && Array.isArray(qs.items) && qs.items.length >= 0, 'total=' + (qs && qs.total))
  const subjects = svc.getSubjects()
  ok('getSubjects 返回科目', Array.isArray(subjects))
  const wb = svc.getWrongBook({ page: 1, pageSize: 5 })
  ok('getWrongBook 错题本', wb && (Array.isArray(wb) || Array.isArray(wb.items)))

  // 7) 知识库导入（之前真机报 fs=null 的场景）
  const { createPlatformMethods } = require('../electron-mobile/platform-methods.js')
  const pm = createPlatformMethods(db)
  const mdContent = '# P7 自审测试文档\n\n验证 WebView 无 node 环境的导入链路'
  const mdBytes = new TextEncoder().encode(mdContent)
  const previewFiles = [{ name: 'p7-selfcheck.md', ext: 'md', size: mdBytes.length, base64: Buffer.from(mdBytes).toString('base64') }]
  try {
    const r = await pm.kbImportFiles(previewFiles, null)
    const okCount = (r || []).filter(x => x.ok).length
    ok('kbImportFiles 导入成功', okCount >= 1, JSON.stringify(r).slice(0, 120))
    const docs = db.getKbDocs()
    ok('kbDocs 含新文档', (docs || []).some(d => d.title === 'p7-selfcheck'))
  } catch (e) {
    ok('kbImportFiles 导入成功', false, '抛错: ' + (e && e.stack || e).toString().slice(0, 200))
  }

  // 8) Excel 往返（xlsx-lite 用 zlib Proxy → platform.zlib = pako shim）
  try {
    const { writeXlsx, readXlsx } = require('../electron/xlsx-lite.js')
    const rows = [['科目', '章节', '题型', '题干', '选项A', '答案'], ['测试', '章1', '单选', '题干1', 'A', 'A']]
    const buf = writeXlsx(rows, { sheetName: '题库' })
    const matrix = readXlsx(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    ok('xlsx-lite 写入+读取往返', Array.isArray(matrix) && matrix.length >= 2 && matrix[1][0] === '测试', JSON.stringify(matrix).slice(0, 80))
  } catch (e) {
    ok('xlsx-lite 往返', false, '抛错: ' + (e && e.stack || e).toString().slice(0, 200))
  }

  // 9) makeZip（zip.js 用 zlib Proxy）
  try {
    const { makeZip } = require('../electron/zip.js')
    const z = makeZip([{ path: 'a.txt', data: Buffer.from('hello zip') }])
    ok('makeZip 生成 ZIP', z && z.length > 0 && z[0] === 0x50, 'len=' + (z && z.length))
  } catch (e) {
    ok('makeZip', false, '抛错: ' + (e && e.stack || e).toString().slice(0, 200))
  }

  // 10) 记忆卡 + persist
  try {
    const card = svc.addCardSmart({ front: 'P7 卡', back: 'P7 卡背' })
    ok('addCardSmart 记忆卡', card && (card.id || card.ok))
    driver.persist()
    const dump = platformShim.fs._dump()
    ok('persist 落盘到内存 fs', !!dump['/data/tiku.db'] && dump['/data/tiku.db'].length > 0)
  } catch (e) {
    ok('记忆卡 + persist', false, '抛错: ' + (e && e.stack || e).toString().slice(0, 200))
  }

  const line = 'WebView 无 node 环境：' + pass + ' 通过 / ' + fail + ' 失败'
  out.push(line)
  realFs.writeFileSync(realPath.join(__dirname, '..', 'mobile-nofs-test-out.txt'), out.join('\n') + '\n')
  console.log(line)
  process.exit(fail ? 1 : 0)
}

main().catch(e => {
  console.error('FATAL:', (e && e.stack) || e)
  realFs.writeFileSync(realPath.join(__dirname, '..', 'mobile-nofs-test-out.txt'), 'FATAL: ' + ((e && e.stack) || e) + '\n')
  process.exit(1)
})
