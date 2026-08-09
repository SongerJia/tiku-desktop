// 全 GitHub 同步编排：数据快照 + 知识库文档 + 题目图片 全部走 GitHub 仓库。
// 复用 db 既有能力（exportSync/mergeRemote/exportImageFiles/restoreImages）。
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { app } = require('electron')
const ghRepo = require('./sync-github-repo')

module.exports = function syncRunner(db) {
  const kbDir = () => path.join(app.getPath('userData'), 'kb')

  // 本地知识库文件清单：{ rel: { hash, buf } }——buf 复用，避免上传时二次读盘
  // 只纳入「未删除文档」对应的文件（软删文档的文件已被删除，不再进入清单 → 远端 manifest 不含 → 其他端不再下载）
  function scanKbFiles() {
    const dir = kbDir()
    const out = {}
    if (!fs.existsSync(dir)) return out
    // 有效文档的 rel_path 集合（deleted=0）
    let activeRels = null
    try {
      activeRels = new Set(db.getKbDocs ? (db.getKbDocs() || []).map(d => d.rel_path).filter(Boolean) : [])
    } catch (e) { activeRels = null }
    const walk = (d, prefix) => {
      for (const name of fs.readdirSync(d)) {
        const full = path.join(d, name)
        const rel = prefix ? prefix + '/' + name : name
        const st = fs.statSync(full)
        if (st.isFile()) {
          // 软删文档的文件不纳入清单（删除随 manifest 传播；notes/ 子目录等无文档记录的文件保留兜底）
          if (activeRels && !activeRels.has(rel) && !rel.startsWith('notes/')) continue
          try {
            const buf = fs.readFileSync(full)
            out[rel] = { hash: crypto.createHash('sha256').update(buf).digest('hex'), buf }
          } catch (e) {}
        }
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
    // 本地软删文档的 rel_path 集合：这些文件不应下载回来，且应删除远端文件本体
    let deletedRels = new Set()
    try { deletedRels = new Set(db.getDeletedKbRels ? (db.getDeletedKbRels() || []) : []) } catch (e) {}
    let kbUp = 0, kbDown = 0, kbDel = 0, imgUp = 0, imgDown = 0

    // 安全净化：拒绝路径穿越（'..' / 绝对路径）——rel 来自远端不可信清单
    const safeRel = (rel) => !String(rel).includes('..') && !path.isAbsolute(String(rel))

    // manifest 将写入的最终状态（上传成功 ∪ 下载成功；失败的排除 → 下次同步自动重试）
    const kbUpOk = {}, imgUpOk = {}

    // 远端 → 本地
    const failedKbDown = [], failedImgDown = []
    for (const rel of Object.keys(remoteKb)) {
      if (deletedRels.has(rel)) continue // 本地已软删：不下载，稍后删除远端
      if (!localKb[rel]) {
        if (!safeRel(rel)) { failedKbDown.push(rel); continue }
        try {
          const buf = await ghRepo.downloadFile(ghCfg, 'kb/' + rel)
          const target = path.join(kbDir(), rel)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(target, buf)
          kbDown++
          kbUpOk[rel] = remoteKb[rel] // 远端清单 hash 即下载内容的 hash
        } catch (e) { failedKbDown.push(rel) }
      }
    }
    for (const name of Object.keys(remoteImgs)) {
      if (!localImgMap[name]) {
        if (!safeRel(name)) { failedImgDown.push(name); continue }
        try {
          const buf = await ghRepo.downloadFile(ghCfg, 'images/' + name)
          db.restoreImages([{ name, b64: buf.toString('base64') }])
          imgDown++
          imgUpOk[name] = remoteImgs[name]
        } catch (e) { failedImgDown.push(name) }
      }
    }

    // 本地 → 远端（成功的才写进 manifest；失败的排除 → 下次同步自动重试）
    const failedKbUp = [], failedImgUp = []
    for (const rel of Object.keys(localKb)) {
      if (remoteKb[rel] !== localKb[rel].hash) {
        try {
          await ghRepo.uploadFile(ghCfg, 'kb/' + rel, localKb[rel].buf)
          kbUp++; kbUpOk[rel] = localKb[rel].hash
        } catch (e) { failedKbUp.push(rel) }
      } else kbUpOk[rel] = localKb[rel].hash
    }
    for (const im of localImgs) {
      if (remoteImgs[im.name] !== im.hash) {
        try { await ghRepo.uploadFile(ghCfg, 'images/' + im.name, im.buffer); imgUp++; imgUpOk[im.name] = im.hash } catch (e) { failedImgUp.push(im.name) }
      } else imgUpOk[im.name] = im.hash
    }

    // 删除远端已软删文件（本地软删 → 远端文件本体也移除）
    const failedKbDel = []
    for (const rel of deletedRels) {
      if (remoteKb[rel]) {
        try { await ghRepo.deleteFile(ghCfg, 'kb/' + rel); kbDel++ } catch (e) { failedKbDel.push(rel) }
      }
    }

    // 写文件清单（只含成功状态）
    await ghRepo.putManifest(ghCfg, { updatedAt: Date.now(), kbFiles: kbUpOk, images: imgUpOk })
    return { kbUp, kbDown, kbDel, imgUp, imgDown, failedKbUp, failedKbDown, failedImgUp, failedImgDown, failedKbDel }
  }

  // 主流程
  async function sync(ghCfg) {
    const data = await syncData(ghCfg)
    const assets = await syncAssets(ghCfg)
    return { ok: true, ...data, ...assets }
  }

  return { sync, scanKbFiles }
}
