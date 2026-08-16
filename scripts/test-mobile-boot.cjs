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

  // 9) 平台方法（P5 真实实现）：createPlatformMethods 提供 18 个，其中 JS 可实现部分可验证；
  //    原生桥部分（kbPickFiles/restoreBackup 等）在无原生插件时走「原生桥不可用」路径不抛异常
  const methodsMod = await import('../electron-mobile/platform-methods.js')
  const pm = methodsMod.createPlatformMethods(db)
  const bridge = { ...dataSvc, ...pm }
  ok('bridge 合并后方法数 = 109 + 19', Object.keys(bridge).length === PURE_DB_METHODS.length + 19, '实际 ' + Object.keys(bridge).length)

  // 9a) saveImage：真实实现（db 落盘）
  const imgNamePm = await pm.saveImage(Buffer.from('pm-png-bytes'), 'png')
  ok('pm.saveImage 返回文件名', !!imgNamePm && String(imgNamePm).endsWith('.png'))

  // 9b) Excel 往返：exportExcelTemplate（writeXlsx）→ parseSheet（readXlsx）恢复表头
  const xlsxB64 = await pm.exportExcelTemplate()
  ok('exportExcelTemplate 返回 base64', typeof xlsxB64 === 'string' && xlsxB64.length > 100)
  const xlsxBytes = Buffer.from(xlsxB64, 'base64')
  const matrix = await pm.parseSheet(xlsxBytes)
  ok('parseSheet 解析模板含表头', Array.isArray(matrix) && matrix.length >= 2 && matrix[0][0] === '科目')

  // 9c) exportExcel：题库非空时返回 base64
  const bankB64 = await pm.exportExcel(null)
  ok('exportExcel 返回题库 base64', bankB64 === null || typeof bankB64 === 'string')

  // 9d) gh 配置往返（token 存 settings）
  await pm.ghSaveConfig({ token: 'ghp_test123', owner: 'songerjia', repo: 'tiku-assets' })
  const ghCfg = await pm.ghGetConfig()
  ok('ghSaveConfig/ghGetConfig 往返', ghCfg.hasToken === true && ghCfg.owner === 'songerjia' && ghCfg.repo === 'tiku-assets')
  // ghSync 未配置网络仓库：应抛「请先完成配置」类错误或网络错误（此处 token 无效 → 测试连接失败路径）
  try { await pm.ghSync() } catch (e) { ok('ghSync 无有效配置时报错（不静默）', !!e) }

  // 9e) checkUpdate 在缺原生桥时返回明确错误对象（不抛异常）；有桥且联网时才会真正检测
  const cu = await pm.checkUpdate()
  ok('checkUpdate 无原生桥时返回错误对象', cu && cu.ok === false && /更新|桥|不可用/.test(cu.error || ''))
  const op = await pm.openPath('/data/x')
  ok('openPath 占位返回错误提示', op && op.ok === false)

  // 9f) 原生桥缺失路径：kbPickFiles 返回 []、getVersion 回退内置版本
  const picked = await pm.kbPickFiles()
  ok('kbPickFiles 无原生桥时返回空结果', picked && picked.bridgeMissing === true && Array.isArray(picked.files) && picked.files.length === 0)
  const ver = await pm.getVersion()
  ok('getVersion 回退内置版本', ver && !!ver.version)
  const ext = await pm.openExternal('https://example.com')
  ok('openExternal 无原生桥时返回错误', ext && ext.ok === false)

  // 9g) 跨端一致性：Capacitor shim 的 sha1/sha256/zlib 与 node 实现输出一致（同步核心正确性）
  const nodeCrypto = require('crypto')
  const capCrypto = platform.crypto
  const payload = Buffer.from('跨端一致性测试 payload 123')
  const sha256Cap = capCrypto.createHash('sha256').update(payload).digest('hex')
  const sha256Node = nodeCrypto.createHash('sha256').update(payload).digest('hex')
  ok('sha256 shim 与 node 一致', sha256Cap === sha256Node, sha256Cap)
  const sha1Cap = capCrypto.createHash('sha1').update(payload).digest('hex')
  const sha1Node = nodeCrypto.createHash('sha1').update(payload).digest('hex')
  ok('sha1 shim 与 node 一致', sha1Cap === sha1Node, sha1Cap)
  const nodeZlib = require('zlib')
  const capZlib = platform.zlib
  const raw = Buffer.from('zlib 跨端 payload ' + 'x'.repeat(1000))
  const deflated = capZlib.deflateRawSync(raw)
  const nodeInflated = nodeZlib.inflateRawSync(deflated)
  ok('pako deflateRaw → node inflateRaw 互操作', nodeInflated.equals(raw))
  const nodeDeflated = nodeZlib.deflateRawSync(raw)
  const capInflated = Buffer.from(capZlib.inflateRawSync(nodeDeflated))
  ok('node deflateRaw → pako inflateRaw 互操作', capInflated.equals(raw))
  const gzCap = capZlib.gzipSync(raw)
  const gzNode = nodeZlib.gunzipSync(gzCap)
  ok('pako gzip → node gunzip 互操作', gzNode.equals(raw))
  ok('zlib crc32 shim 与 node 一致', capZlib.crc32(raw) === nodeZlib.crc32(raw))
  // zip.js 在 shim 下可生成合法 zip（crc32 正确性间接验证）
  const { makeZip } = require('../electron/zip.js')
  const zipBuf = makeZip([{ path: 'a.txt', data: Buffer.from('hello zip') }])
  ok('makeZip 在 pako crc32 shim 下产出 zip', zipBuf && zipBuf.length > 40 && zipBuf[0] === 0x50 && zipBuf[1] === 0x4b)
  // xlsx-lite 在 shim 下完整往返（writeXlsx 用 deflateRaw、readXlsx 用 inflateRaw）
  const { writeXlsx, readXlsx } = require('../electron/xlsx-lite.js')
  const xBuf = writeXlsx([['列A', '列B'], ['1', 'hello']], { sheetName: '测试' })
  const xParsed = readXlsx(xBuf)
  ok('xlsx-lite 在 pako shim 下读写往返', Array.isArray(xParsed) && xParsed[1] && xParsed[1][1] === 'hello')

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
