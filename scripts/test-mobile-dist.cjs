// 端到端验证 dist-mobile 产物（P4b）：模拟 Capacitor WebView 全局环境，加载打包后的 boot.js，
// 确认 window.capacitorBridge 就绪、数据方法可用、平台方法占位 reject、persist 落盘。
// 运行：node scripts/test-mobile-dist.cjs（需先 vite build --config vite.mobile.config.js）
const fs = require('fs')
const path = require('path')

let pass = 0
let fail = 0
// 注意：脚本会 chdir 到 dist-mobile（wasm 相对定位），输出文件必须用绝对路径
const OUT = path.join(__dirname, '..', 'mobile-dist-test-out.txt')
function ok(name, cond, extra) {
  if (cond) { pass++; fs.appendFileSync(OUT, 'OK ' + name + '\n') }
  else { fail++; fs.appendFileSync(OUT, 'FAIL ' + name + (extra ? ' | ' + extra : '') + '\n') }
}

;(async () => {
  const distDir = path.join(__dirname, '..', 'dist-mobile')
  if (!fs.existsSync(path.join(distDir, 'boot.js'))) {
    console.error('缺少 dist-mobile/boot.js，请先运行: npx vite build --config vite.mobile.config.js')
    process.exit(1)
  }
  // 模拟 WebView 全局（Capacitor 8 + 浏览器 API）
  global.window = { Capacitor: { isNativePlatform: true } }
  // node 环境无 relative URL fetch（真 WebView 有）：拦截 sql-wasm.wasm 请求从 dist 读文件
  const origFetch = global.fetch
  global.fetch = (input, init) => {
    const s = String(input || '')
    if (s.startsWith('sql-wasm')) {
      return Promise.resolve(new Response(fs.readFileSync(path.join(distDir, s)), { status: 200 }))
    }
    return origFetch ? origFetch(input, init) : Promise.reject(new Error('fetch 不可用: ' + s))
  }
  // 确保 sql-wasm.wasm 可被 locateFile 相对定位
  process.chdir(distDir)
  // 产物是 IIFE（无 export）：直接 import 原文件即可执行，window.Capacitor 存在 → 自动 boot
  const bootUrl = 'file://' + path.join(distDir, 'boot.js').replace(/\\/g, '/')
  await import(bootUrl)
  // 等待自动 boot 完成（window.Capacitor 存在 → boot.js 自动启动）
  let bridge = null
  for (let i = 0; i < 200; i++) {
    if (global.window.capacitorBridge) { bridge = global.window.capacitorBridge; break }
    await new Promise(r => setTimeout(r, 50))
  }
  ok('产物自动 boot 后 window.capacitorBridge 就绪', !!bridge)
  if (!bridge) { fs.appendFileSync(OUT, 'mobile dist 产物：' + pass + ' 通过 / ' + fail + ' 失败\n'); process.exit(1) }

  const api = bridge.api
  ok('bridge.api 方法数 = 109 + 18', Object.keys(api).length === 109 + 18, '实际 ' + Object.keys(api).length)

  // 数据方法可用
  const summary = await api.getSummary()
  ok('getSummary.total > 0（样例数据灌入）', summary.total > 0)
  const qs = await api.getQuestions({ limit: 3 })
  ok('getQuestions 返回题目', Array.isArray(qs) && qs.length > 0)
  const q = qs[0]
  const wrong = await api.submitAnswer({ questionId: q.id, selected: [], durationMs: 0, mode: 'practice' })
  ok('答错入错题本', wrong.isCorrect === false && (await api.getWrongBook()).some(x => x.question_id === q.id))

  // 平台方法占位
  try { await api.checkUpdate() } catch (e) { ok('checkUpdate 占位 reject', /平台方法将在 APK 集成/.test(String(e.message || e))) }

  // persist 落盘 + 调试句柄：bridge.persist 显式调用不抛错，bridge.db 可调 db 方法
  bridge.persist()
  ok('bridge.persist() 显式落盘不抛错', true)
  ok('bridge.db 调试句柄可用', typeof bridge.db.getSummary === 'function' && bridge.db.getSummary().total > 0)

  fs.appendFileSync(OUT, 'mobile dist 产物：' + pass + ' 通过 / ' + fail + ' 失败\n')
  console.log('mobile dist 产物：' + pass + ' 通过 / ' + fail + ' 失败')
  process.exit(fail ? 1 : 0)
})().catch(e => {
  fail++
  fs.appendFileSync(OUT, 'EXC ' + (e && e.stack ? e.stack.split('\n').slice(0, 10).join(' | ') : e) + '\n')
  console.error('❌ mobile dist 验证异常:', e && e.stack ? e.stack.split('\n').slice(0, 10).join('\n') : e)
  process.exit(1)
})
