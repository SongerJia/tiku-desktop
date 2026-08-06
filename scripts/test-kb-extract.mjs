// 个人知识库抽取模块真实验证：MD 切块 + PDF 文本抽取（需 fixture.pdf 已由 gen-fixture-pdf.py 生成）
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
const require = createRequire(import.meta.url)
const fs = require('fs')
const path = require('path')
const os = require('os')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { extractMd, extractPdf, splitMdBlocks, uniqueRelPath } = require('../electron/kbExtract.js')

async function main() {
  let pass = 0, fail = 0
  const check = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name) } else { fail++; console.log('❌ ' + name) } }

  // 1. MD 按标题切块
  const md = `# TCP 三次握手

SYN、SYN-ACK、ACK 的过程。

## 为什么不能两次

历史连接复用问题。

# 挥手四次

FIN 与 ACK。`
  const blocks = splitMdBlocks(md)
  check('MD 切块数=3', blocks.length === 3)
  check('MD 块标题正确', blocks[0].heading === 'TCP 三次握手' && blocks[1].heading === '为什么不能两次')
  check('MD 无标题前置文字并入首块', blocks[0].content.includes('SYN'))

  // 2. 无标题 MD：整篇一块
  const plain = splitMdBlocks('Some people think that tourism creates tension.')
  check('MD 无标题整篇一块', plain.length === 1 && plain[0].heading === null)
  check('extractMd 返回 charStart/charEnd', extractMd(md)[0].charEnd > 0)

  // 3. PDF 文本抽取（真实走 pdfjs-dist）
  const fixture = path.join(__dirname, 'fixture.pdf')
  if (!fs.existsSync(fixture)) {
    check('fixture.pdf 存在（先跑 gen-fixture-pdf.py）', false)
  } else {
    const r = await extractPdf(fixture)
    check('PDF 抽取无错误', r.error === null)
    check('PDF 抽到 1 页文本块', r.blocks.length === 1)
    const joined = r.blocks.map(b => b.content).join(' ')
    check('PDF 文本内容命中', joined.includes('Hello Knowledge Base') && joined.includes('TCP Handshake'))
    check('PDF 块 heading 为页码', r.blocks[0].heading === '第 1 页')
  }

  // 4. 非 PDF 文件 → 优雅降级（error 而非抛异常）
  const bad = await extractPdf(fileURLToPath(import.meta.url))
  check('非 PDF 文件降级返回 error', Array.isArray(bad.blocks) && typeof bad.error === 'string')

  // 5. uniqueRelPath 冲突去重
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'))
  fs.writeFileSync(path.join(dir, 'doc.md'), 'x')
  check('uniqueRelPath 首文件原名', uniqueRelPath(dir, 'doc', 'md') === 'doc-1.md')
  fs.writeFileSync(path.join(dir, 'doc-1.md'), 'x')
  check('uniqueRelPath 二次冲突再 +1', uniqueRelPath(dir, 'doc', 'md') === 'doc-2.md')
  check('uniqueRelPath 消毒非法字符', uniqueRelPath(dir, 'a/b:c*', 'md') === 'a_b_c_.md')

  console.log(`\n=== kb 抽取模块真实验证：${pass} 通过 / ${fail} 失败 ===`)
  process.exit(fail ? 1 : 0)
}

main()
