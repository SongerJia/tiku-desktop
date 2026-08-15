// 个人知识库：文档文本抽取与切块（零依赖 MD 切块 + pdfjs-dist 抽 PDF 文本）
// - MD：按 # 标题切块，无标题则整篇一块（零格式门槛）
// - PDF：pdfjs-dist legacy 构建逐页抽文本；无文本层/异常时降级返回空块 + error（靠文件名与标签兜底）
const fs = require('fs')
const path = require('path')

// MD 按标题切块：每遇到 #~###### 标题开启新块；块头取标题文本（去 # 与尾随井号）
function splitMdBlocks(content) {
  const text = String(content || '')
  const lines = text.split(/\r?\n/)
  const blocks = []
  let cur = null
  const flush = () => { if (cur) blocks.push(cur) }
  lines.forEach((line) => {
    const m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line)
    if (m) {
      flush()
      cur = {
        heading: m[1].replace(/[#\s]+$/, '').trim() || '未命名小节',
        content: line + '\n'
      }
    } else if (cur) {
      cur.content += line + '\n'
    } else {
      // 标题前的前置文字：并入第一个块
      cur = { heading: null, content: line + '\n' }
    }
  })
  flush()
  return blocks
    .map(b => ({ heading: b.heading, content: b.content.trim() }))
    .filter(b => b.content)
}

function extractMd(content) {
  return splitMdBlocks(content).map(b => ({
    heading: b.heading,
    content: b.content,
    charStart: 0,
    charEnd: b.content.length
  }))
}

// 异步：逐页抽取 PDF 文本。返回 { blocks, error }，error 为 null 表示成功。
// 坑：pdfjs-dist 6.x 移除了 doc.destroy()，资源释放要走 loadingTask.destroy()。
async function extractPdf(filePath) {
  let task = null
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(fs.readFileSync(filePath))
    task = pdfjs.getDocument({
      data,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0 // 抑制字体解析警告（如 "Not enough parameters for hstem" 刷屏）；0=ERRORS
    })
    const doc = await task.promise
    const blocks = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const tc = await page.getTextContent()
      const text = tc.items
        .map(it => (it && it.str) || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) blocks.push({ heading: `第 ${p} 页`, content: text, charStart: 0, charEnd: text.length })
    }
    return { blocks, error: null }
  } catch (e) {
    return { blocks: [], error: String((e && e.message) || e) }
  } finally {
    if (task && typeof task.destroy === 'function') {
      try { await task.destroy() } catch (e) { /* 释放失败不影响结果 */ }
    }
  }
}

// 文件名消毒 + 冲突去重（返回 userData/kb 下的相对路径）
function uniqueRelPath(dir, originalName, ext) {
  const safe = String(originalName || 'doc').replace(/[\\/:*?"<>|]/g, '_').trim() || 'doc'
  let rel = safe + (ext ? '.' + ext : '')
  let i = 1
  while (fs.existsSync(path.join(dir, rel))) {
    rel = `${safe}-${i}.${ext}`
    i += 1
  }
  return rel
}

module.exports = { splitMdBlocks, extractMd, extractPdf, uniqueRelPath }
