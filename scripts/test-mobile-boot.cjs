// APK boot 链路验证（P4b）：复刻 electron-mobile/boot.js 的启动顺序，
// 在【纯 Node 环境】注入 Capacitor 平台 shim → SQL.js driver → db.initAsync → service，
// 验证：数据读写 / 答错入错题本 / 记忆卡 / persist 落盘 / 模拟重启数据仍在 / 平台方法占位。
// 运行：node scripts/test-mobile-boot.cjs（无 electron，模拟 WebView 无 Node 内建模块的场景）
// 说明：db.js/db-assets.js 模块顶层就解构了 platform.fs/path/crypto，必须先 setPlatform 再 require。

let pass = 0
let fail = 0
const OUT = 'mobile-boot-test-out.txt'
const fs = require('fs')
function ok(name, cond, extra) {
  if (cond) { pass++; fs.appendFileSync(OUT, 'OK ' + name + '\n') }
  else { fail++; fs.appendFileSync(OUT, 'FAIL ' + name + (extra ? ' | ' + extra : '') + '\n') }
}

;(async () => {
  // 0) 模拟 Capacitor WebView：注入平台 shim（必须先于 db 模块加载）
  const { platform, setPlatform } = require('../electron/platform')
  const { createCapacitorPlatform } = require('../electron/platform-capacitor')
  setPlatform(createCapacitorPlatform({ rootDir: '/data' }))
  ok('setPlatform 注入后 isElectron=false', platform.isElectron === false)
  ok('platform.fs 已换为内存 fs', typeof platform.fs.writeFileSync === 'function' && typeof platform.fs._dump === 'function')

  // 1) SQL.js 驱动 + db 初始化（同 boot.js 顺序）
  const { createSqlJsDriver } = require('../electron/db-driver')
  const db = require('../electron/db')
  const { createDataService, PURE_DB_METHODS } = require('../electron/service')

  const driver = await createSqlJsDriver({ file: '/data/tiku.db' })
  await db.initAsync(driver)
  ok('db.initAsync 完成（样例数据已灌入）', db.getSummary().total > 0)

  // 2) service 暴露方法数与 PURE_DB_METHODS 一致
  const dataSvc = createDataService(db)
  const svcKeys = Object.keys(dataSvc)
  ok('createDataService 方法数 = PURE_DB_METHODS（' + PURE_DB_METHODS.length + '）', svcKeys.length === PURE_DB_METHODS.length, '实际 ' + svcKeys.length)
  const missing = PURE_DB_METHODS.filter(m => !(m in dataSvc))
  ok('PURE_DB_METHODS 全量暴露', missing.length === 0, '缺失: ' + missing.join(','))

  // 3) 数据读写（走 service，与前端同入口）
  const qs = await dataSvc.getQuestions({ limit: 5 })
  ok('getQuestions 返回题目', Array.isArray(qs) && qs.length > 0)
  const q = qs[0]

  // 4) 答错 → 错题本
  const wrong = await dataSvc.submitAnswer({ questionId: q.id, selected: [], durationMs: 0, mode: 'practice' })
  const wb = await dataSvc.getWrongBook()
  ok('答错 isCorrect=false 且入错题本', wrong.isCorrect === false && wb.some(x => x.question_id === q.id))

  // 5) 记忆卡：新增 + 复习 + 智能转卡
  await dataSvc.addCard('APK正面', 'APK背面', 'APK卡组')
  const cards = await dataSvc.listCards()
  ok('addCard/listCards 含新卡', cards.some(c => c.front === 'APK正面'))
  const newCard = cards.find(c => c.front === 'APK正面')
  const rr = await dataSvc.rateCard(newCard.id, 3)
  ok('rateCard 复习成功', rr && (rr.ok === true || rr.ok === undefined) )
  const cs = await dataSvc.cardsStats()
  ok('cardsStats.total >= 1', cs.total >= 1)
  const cg = await dataSvc.addCardFromQuestion(q.id)
  ok('addCardFromQuestion 生成记忆卡', cg.ok === true)

  // 6) 同步/统计模块在内存 fs 上正常（合并/备份依赖 fs 操作；exportSync/mergeRemote 由主进程
  //    sync-runner 直接调 db，不经 service——此处验证 APK 内存 fs 下同步链路可跑）
  const sync1 = JSON.parse(db.exportSync())
  ok('exportSync 全量含 questions', Array.isArray(sync1.questions) && sync1.questions.length > 0)
  const m = db.mergeRemote(db.exportSync())
  ok('mergeRemote 自合并正常（含 cards）', m.cards >= 1)

  // 7) persist 落盘：内存库字节写回内存 fs 的 /data/tiku.db
  driver.persist()
  const dump = platform.fs._dump()
  const hasDb = Object.keys(dump).some(k => k === '/data/tiku.db' && dump[k] && dump[k].length > 0)
  ok('persist 后内存 fs 存在 /data/tiku.db', hasDb, 'keys=' + Object.keys(dump).join(','))
  const dbBytes = dump['/data/tiku.db']
  ok('tiku.db 字节头为 SQLite format 3', dbBytes && dbBytes.length >= 16 && String.fromCharCode.apply(null, dbBytes.slice(0, 16)).startsWith('SQLite format 3'))

  // 8) 模拟重启：用已落盘的字节重新建库 → 数据仍在（错题本/卡片持久）
  const driver2 = await createSqlJsDriver({ file: '/data/tiku.db' })
  await db.initAsync(driver2)
  ok('重启后 getSummary.total > 0', db.getSummary().total > 0)
  const wb2 = await dataSvc.getWrongBook()
  ok('重启后错题本保留该题', wb2.some(x => x.question_id === q.id))
  const cards2 = await dataSvc.listCards()
  ok('重启后记忆卡保留', cards2.some(c => c.front === 'APK正面'))

  // 9) 平台方法占位：boot.js 合并 { ...dataSvc, ...platformStub } 后，未实现方法 reject 占位错误（P5 逐个替换）
  const PLATFORM_PLACEHOLDER = [
    'checkUpdate', 'saveImage', 'kbImportFiles', 'kbPickFiles', 'openPath',
    'restoreBackup', 'getVersion', 'openExternal', 'kbExport', 'kbOpen',
    'parseSheet', 'exportExcel', 'exportExcelTemplate', 'exportCardTemplate',
    'ghGetConfig', 'ghSaveConfig', 'ghTest', 'ghSync'
  ]
  const stub = {}
  for (const mm of PLATFORM_PLACEHOLDER) stub[mm] = (...a) => Promise.reject(new Error('[' + mm + '] 平台方法将在 APK 集成中由原生插件提供'))
  const bridge = { ...dataSvc, ...stub }
  ok('bridge 合并后方法数 = 109 + 18', Object.keys(bridge).length === PURE_DB_METHODS.length + PLATFORM_PLACEHOLDER.length, '实际 ' + Object.keys(bridge).length)
  try { await bridge.checkUpdate() } catch (e) { ok('checkUpdate 占位 reject 提示 P5 集成', /平台方法将在 APK 集成/.test(String(e.message || e))) }
  try { await bridge.ghSync() } catch (e) { ok('ghSync 占位 reject', /ghSync/.test(String(e.message || e))) }

  // 10) 图片 base64 路径（WebView 无 Node Buffer，验证 polyfill 生效）
  const tinyPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex')
  const imgName = db.saveImage(tinyPng, 'png')
  ok('saveImage 在内存 fs 落盘（跳过压缩）', !!imgName && String(imgName).endsWith('.png'))
  const imgUrl = db.getImage(imgName)
  ok('getImage 返回 data:image dataURL（Buffer polyfill 生效）', typeof imgUrl === 'string' && imgUrl.startsWith('data:image/'))
  const audioName = db.saveAudio(Buffer.from('fake-mp3-bytes'))
  ok('saveAudio 在内存 fs 落盘', !!audioName && String(audioName).endsWith('.mp3'))
  ok('getAudioUrl 返回 data:audio dataURL', (db.getAudioUrl(audioName) || '').startsWith('data:audio/'))
  db.clearUserData() // 清理内存数据，避免影响后续

  fs.appendFileSync(OUT, 'mobile boot 链路：' + pass + ' 通过 / ' + fail + ' 失败\n')
  console.log('mobile boot 链路：' + pass + ' 通过 / ' + fail + ' 失败')
  process.exit(fail ? 1 : 0)
})().catch(e => {
  fail++
  fs.appendFileSync(OUT, 'EXC ' + (e && e.stack ? e.stack.split('\n').slice(0, 8).join(' | ') : e) + '\n')
  console.error('❌ mobile boot 链路异常:', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : e)
  process.exit(1)
})
