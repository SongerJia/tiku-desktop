// 移动端模拟器（PC 上模拟 APK WebView 环境，免真机快速验证 UI）
//
// 原理：Electron 开一个手机尺寸窗口，用本地 HTTP 服务器托管 dist-mobile 产物
// （与 Capacitor WebView 的 http://localhost 加载方式一致），preload 注入
// window.Capacitor shim（isNativePlatform=true + TikuBridge 插件模拟），
// 使 bridge.js/boot.js 走 APK 分支：
//   - SQL.js + 内存 fs 在 WebView 内运行（与真机一致）
//   - 文件选择用系统对话框真实模拟（kbPickFiles / pickBackup）
//   - openExternal 调系统浏览器
//
// 用法：
//   1) 先构建移动端产物：npm run build:mobile
//   2) 启动模拟器：npm run sim:mobile          （默认开 DevTools，--no-devtools 关闭）
//   3) 改代码后：重新 build:mobile，再 Ctrl+R 刷新模拟器即可
//   4) 自检（不起窗口）：npx electron scripts/mobile-sim.cjs --self-check
//
// 注意：内存 fs 每次启动/刷新重置（种子数据重新初始化）；真实持久化/状态栏
// 等原生能力仍须真机验证。

const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const http = require('http')
const { createStaticServer } = require('./lib/static-server.cjs')

// 沙箱/无 GPU 环境（CI、远程桌面、部分虚拟机）下 GPU 进程起不来会直接退出；
// 模拟器只渲染 Vue 页面，软件渲染足够（真机/正常桌面环境不受影响）。
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('use-gl', 'swiftshader')

const DIST = path.join(__dirname, '..', 'dist-mobile')
const INDEX = path.join(DIST, 'index.html')
const PORT = 18080

// ---- 原生能力模拟（主进程侧，与 TikuBridgePlugin 同语义）----
function setupIpc() {
  // 知识文档选择（多选 md/pdf/txt）
  ipcMain.handle('sim:kbPickFiles', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const r = await dialog.showOpenDialog(win, {
      title: '选择知识文档（md / pdf）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '文档', extensions: ['md', 'pdf', 'txt'] }, { name: '全部文件', extensions: ['*'] }]
    })
    if (r.canceled || !r.filePaths.length) return { files: [] }
    const files = []
    for (const fp of r.filePaths) {
      try {
        const buf = fs.readFileSync(fp)
        const ext = path.extname(fp).slice(1).toLowerCase()
        files.push({ name: path.basename(fp), ext, size: buf.length, base64: buf.toString('base64') })
      } catch (e) { /* 单文件读取失败跳过 */ }
    }
    return { files }
  })

  // 备份文件选择（.db 单选）
  ipcMain.handle('sim:pickBackup', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const r = await dialog.showOpenDialog(win, {
      title: '选择备份数据库（.db）',
      properties: ['openFile'],
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }, { name: '全部文件', extensions: ['*'] }]
    })
    if (r.canceled || !r.filePaths.length) return null
    try {
      const buf = fs.readFileSync(r.filePaths[0])
      return { name: path.basename(r.filePaths[0]), size: buf.length, base64: buf.toString('base64') }
    } catch (e) { return null }
  })

  ipcMain.handle('sim:getVersion', () => ({ name: '知识记忆小助手', version: '0.7.0-sim' }))

  ipcMain.handle('sim:openExternal', (_e, payload) => {
    const url = String((payload && payload.url) || '')
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: '仅支持 http/https 链接' }
    shell.openExternal(url)
    return { ok: true }
  })
}

// ---- 窗口（固定手机尺寸；字号缩放走 rem 方案，不联动窗口）----
function createWindow(devtools) {
  const win = new BrowserWindow({
    width: 412,
    height: 900,
    minWidth: 412,
    maxWidth: 412, // 禁止拉宽：否则 .app.is-mobile max-width:520px 居中后右侧大片空白
    minHeight: 600,
    maxHeight: 1400,
    resizable: true, // 允许纵向调整（看长列表）
    title: '知识记忆小助手 · 移动端模拟器',
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'mobile-sim-preload.cjs'),
      contextIsolation: false, // 测试工具：允许 preload 直接注入全局
      nodeIntegration: false
    }
  })
  win.loadURL(`http://127.0.0.1:${PORT}/index.html`)
  if (devtools) win.webContents.openDevTools({ mode: 'right' })
  return win
}

// ---- 自检：不起窗口，验证产物完整 + 服务器可访问（CI/沙箱可用）----
function selfCheck() {
  const checks = []
  const check = (name, ok, extra) => checks.push({ name, ok, extra })

  check('dist-mobile/index.html 存在', fs.existsSync(INDEX))
  check('sql-wasm.wasm 存在', fs.existsSync(path.join(DIST, 'sql-wasm.wasm')))
  const assetDir = path.join(DIST, 'assets')
  const assets = fs.existsSync(assetDir) ? fs.readdirSync(assetDir) : []
  check('assets 目录存在', assets.length > 0)
  const entry = assets.find(f => /^app-mobile-.*\.js$/.test(f))
  check('app-mobile entry chunk 存在', !!entry)
  const boot = assets.find(f => /^boot-.*\.js$/.test(f))
  check('boot chunk 存在', !!boot)

  createStaticServer(DIST, PORT).then(server => {
    const urls = ['/index.html', '/sql-wasm.wasm', '/assets/' + (entry || 'x'), '/assets/' + (boot || 'x')]
    let i = 0
    const next = () => {
      if (i >= urls.length) {
        server.close()
        const failed = checks.filter(c => !c.ok)
        console.log(checks.map(c => (c.ok ? '✅' : '❌') + ' ' + c.name + (c.extra ? ' (' + c.extra + ')' : '')).join('\n'))
        console.log(failed.length ? `[mobile-sim] 自检失败 ${failed.length} 项` : '[mobile-sim] 自检通过，产物可运行')
        app.exit(failed.length ? 1 : 0)
        return
      }
      const u = urls[i++]
      http.get('http://127.0.0.1:' + PORT + u, res => {
        check('GET ' + u + ' → ' + res.statusCode, res.statusCode === 200)
        res.resume(); res.on('end', next)
      }).on('error', () => { check('GET ' + u, false, '连接失败'); next() })
    }
    next()
  }).catch(e => {
    console.error('[mobile-sim] 服务器启动失败:', e.message)
    app.exit(1)
  })
}

app.whenReady().then(() => {
  if (process.argv.includes('--self-check')) { selfCheck(); return }
  // 前置检查：产物必须存在
  if (!fs.existsSync(INDEX)) {
    console.error('[mobile-sim] 缺少 dist-mobile/index.html，请先执行: npm run build:mobile')
    app.exit(1)
    return
  }
  createStaticServer(DIST, PORT).then(server => {
    setupIpc()
    const devtools = !process.argv.includes('--no-devtools')
    createWindow(devtools)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(devtools)
    })
  }).catch(e => {
    console.error('[mobile-sim] 服务器启动失败:', e.message)
    app.exit(1)
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
