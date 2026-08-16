// 批量把 font-size: Xpx 转 font-size: X/16 rem（保留3位小数）
// 用法: node scripts/remify-fonts.cjs
const fs = require('fs')
const path = require('path')

function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (['node_modules', 'dist', 'dist-mobile'].includes(f)) continue
      walk(p, out)
    } else if (/\.(vue|css)$/.test(f)) out.push(p)
  }
}

const files = []
walk(path.resolve('src'), files)
let total = 0
for (const f of files) {
  let src = fs.readFileSync(f, 'utf8')
  const before = src
  src = src.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (m, px) => {
    total++
    return 'font-size: ' + (parseFloat(px) / 16).toFixed(3) + 'rem'
  })
  if (src !== before) fs.writeFileSync(f, src)
}
console.log('扫描文件数:', files.length, '| 替换处数:', total)
