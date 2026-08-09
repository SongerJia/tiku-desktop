// WebDAV 同步编排：数据快照合并 + 题目图片增量 + 知识库文档双向。
// 复用 db 既有能力（exportSync/mergeRemote/exportImageFiles/restoreImages），
// 传输走 sync-webdav（坚果云/123/自建通用，cfg: {url,user,pass}）。
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { app } = require('electron')
const syncWebdav = require('./sync-webdav')

module.exports = function webdavSyncRunner(db) {
  const kbDir = () => path.join(app.getPath('userData'), 'kb')
  const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

  // 本地知识库文件清单：{ rel_path: sha256 }（递归，rel 用 / 分隔）
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

  // 主流程：拉远端合并 → 推本地全量 → 图片/kb 双向增量 → 写 manifest
  async function sync(cfg) {
    // 1) 拉远端数据快照并合并进本地（让本机看到其他端的数据）
    let merged = {}
    let remoteBytes = 0
    const remote = await syncWebdav.downloadData(cfg)
    if (remote) {
      remoteBytes = Buffer.byteLength(remote)
      merged = db.mergeRemote(remote)
    }

    // 2) 本地全量快照上传（收敛模型：合并后本地即最新全集）
    const full = db.exportSync(0)
    const dataBytes = await syncWebdav.uploadData(cfg, JSON.stringify(full))

    // 3) 图片双向增量（复用既有图片导出/还原）
    const m = await syncWebdav.getManifest(cfg)
    const localImages = db.exportImageFiles(0) // [{name, buffer, hash}]
    const remoteImgHashes = new Set((m && m.images) || [])
    const remoteImgNames = (m && m.imageNames) || []
    const localImgNames = new Set(localImages.map(i => i.name))
    let imgUp = 0, imgDown = 0
    for (const im of localImages) { // 本地 → 远端（新增/变更）
      if (!remoteImgHashes.has(im.hash)) {
        try { await syncWebdav.uploadImage(cfg, im.name, im.buffer); imgUp++ } catch (e) {}
      }
    }
    for (const name of remoteImgNames) { // 远端 → 本地（缺图补拉）
      if (!localImgNames.has(name)) {
        try {
          const buf = await syncWebdav.downloadImage(cfg, name)
          db.restoreImages([{ name, b64: buf.toString('base64') }])
          imgDown++
        } catch (e) {}
      }
    }

    // 4) 知识库文档双向（缺失/变更才传）
    const localKb = scanKbFiles()
    const remoteKb = (m && m.kbFiles) || {}
    let kbUp = 0, kbDown = 0
    for (const rel of Object.keys(remoteKb)) { // 远端 → 本地（本地缺文件）
      if (!localKb[rel]) {
        try {
          const buf = await syncWebdav.downloadKbFile(cfg, rel)
          const target = path.join(kbDir(), rel)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(target, buf)
          kbDown++
        } catch (e) {}
      }
    }
    for (const rel of Object.keys(localKb)) { // 本地 → 远端（新增/变更）
      if (remoteKb[rel] !== localKb[rel]) {
        try {
          await syncWebdav.uploadKbFile(cfg, rel, fs.readFileSync(path.join(kbDir(), rel)))
          kbUp++
        } catch (e) {}
      }
    }

    // 5) 写 manifest（下次同步的比对基准）
    await syncWebdav.putManifest(cfg, {
      updatedAt: Date.now(),
      images: localImages.map(i => i.hash),
      imageNames: [...localImgNames],
      kbFiles: localKb
    })

    return { ok: true, merged, dataBytes, remoteBytes, imgUp, imgDown, kbUp, kbDown }
  }

  return { sync, scanKbFiles }
}
