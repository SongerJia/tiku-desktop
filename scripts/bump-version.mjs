// 版本号提升：npm run bump <patch|minor|major>
// 自动：①package.json version 递增 ②README 第 5 行"当前版本：**vX.Y.Z**"同步（git commit 需手动，见脚本末尾提示）
// 用法：node scripts/bump-version.mjs patch|minor|major
import fs from 'node:fs'

const type = process.argv[2] || 'patch'
if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('用法：npm run bump <patch|minor|major>')
  process.exit(1)
}

const pkgPath = new URL('../package.json', import.meta.url)
const readmePath = new URL('../README.md', import.meta.url)
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const [maj, min, pat] = String(pkg.version).split('.').map(n => parseInt(n, 10) || 0)

let next
if (type === 'major') next = `${maj + 1}.0.0`
else if (type === 'minor') next = `${maj}.${min + 1}.0`
else next = `${maj}.${min}.${pat + 1}`

console.log(`📦 ${pkg.version} → ${next} (${type})`)

// 1) package.json
pkg.version = next
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// 2) README 第 5 行"当前版本：**vX.Y.Z**" 只替换版本号数字（不碰描述）
let readme = fs.readFileSync(readmePath, 'utf8')
const oldLine = readme.split('\n').find(l => l.includes('当前版本：**v'))
if (oldLine) {
  const updated = oldLine.replace(/v\d+\.\d+\.\d+/, 'v' + next)
  if (updated !== oldLine) {
    readme = readme.replace(oldLine, updated)
    fs.writeFileSync(readmePath, readme)
    console.log('📄 README 当前版本行已同步 →', updated.trim().slice(0, 60) + '...')
  } else {
    console.log('⚠️ README 当前版本行未找到版本号格式，跳过')
  }
} else {
  console.log('⚠️ README 未找到"当前版本：**vX.Y.Z**"行，跳过')
}

console.log('✅ 版本号已更新。请 git add -A && git commit 后运行 npm run release 发布。')
