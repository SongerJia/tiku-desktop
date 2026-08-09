// 全 GitHub 同步编排：数据快照 + 知识库文档 + 题目图片 全部走 GitHub 仓库。
// 复用 db 既有能力（exportSync/mergeRemote/exportImageFiles/restoreImages）。
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { app } = require('electron')
const ghRepo = require('./sync-github-repo')

module.exports = function syncRunner(db) {
  const kbDir = () => path.join(app.getPath('userData'), 'kb')
  const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

  // 本地知识库文件清单：{ rel_path: sha256 }
  function scanKbFiles() {
    const dir = kbDir()
    const out = {}
    if (!fs.existsSync(dir)) return out
    const walk = (d, prefix) => {
      for (const name of fs.readdirSync(d)) {
        const full = path.join(d, name)
        const rel = prefix ? prefix + '/' + name : name
        const st = fs.statSync(full)
        if (st.isFile()) { try { out[rel] = sha256(full) } catch (e) {} }
        else if (st.isDirectory()) walk(full, rel)
      }
    }
    walk(dir, '')
    return out
  }

  // ① 数据快照：拉远端合并 → 推本地全量（收敛模型）
  async function syncData(ghCfg) {
    let merged = {}
    let remoteBytes = 0
    const remote = await ghRepo.downloadData(ghCfg)
    if (remote) {
      remoteBytes = Buffer.byteLength(remote)
      merged = db.mergeRemote(remote)
    }
    const full = db.exportSync(0)
    const dataBytes = await ghRepo.uploadData(ghCfg, JSON.stringify(full))
    return { merged, dataBytes, remoteBytes }
  }

  // ② 大文件：kb 文档 + 题目图片双向增量
  async function syncAssets(ghCfg) {
    const localKb = scanKbFiles()
    const localImgs = db.exportImageFiles(0) // [{name, buffer, hash}]
    const localImgMap = {}
    localImgs.forEach(i => { localImgMap[i.name] = i.hash })
    const remote = await ghRepo.getManifest(ghCfg)
    const remoteKb = (remote && remote.kbFiles) || {}
    const remoteImgs = (remote && remote.images) || {}
    let kbUp = 0, kbDown = 0, imgUp = 0, imgDown = 0

    // 远端 → 本地
    for (const rel of Object.keys(remoteKb)) {
      if (!localKb[rel]) {
        try {
          const buf = await ghRepo.downloadFile(ghCfg, 'kb/' + rel)
          const target = path.join(kbDir(), rel)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(target, buf)
          kbDown++
        } catch (e) {}
      }
    }
    for (const name of Object.keys(remoteImgs)) {
      if (!localImgMap[name]) {
        try {
          const buf = await ghRepo.downloadFile(ghCfg, 'images/' + name)
          db.restoreImages([{ name, b64: buf.toString('base64') }])
          imgDown++
        } catch (e) {}
      }
    }

    // 本地 → 远端
    for (const rel of Object.keys(localKb)) {
      if (remoteKb[rel] !== localKb[rel]) {
        try {
          await ghRepo.uploadFile(ghCfg, 'kb/' + rel, fs.readFileSync(path.join(kbDir(), rel)))
          kbUp++
        } catch (e) {}
      }
    }
    for (const im of localImgs) {
      if (remoteImgs[im.name] !== im.hash) {
        try { await ghRepo.uploadFile(ghCfg, 'images/' + im.name, im.buffer); imgUp++ } catch (e) {}
      }
    }

    // 写文件清单
    await ghRepo.putManifest(ghCfg, { updatedAt: Date.now(), kbFiles: localKb, images: localImgMap })
    return { kbUp, kbDown, imgUp, imgDown }
  }

  // 主流程
  async function sync(ghCfg) {
    const data = await syncData(ghCfg)
    const assets = await syncAssets(ghCfg)
    return { ok: true, ...data, ...assets }
  }

  return { sync, scanKbFiles }
}
