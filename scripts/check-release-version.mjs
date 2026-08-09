// 发布防呆：检查当前版本是否已发布到 GitHub Releases（防止误发布同版本覆盖旧版）
// 用法：node scripts/check-release-version.mjs [GH_TOKEN]
// 返回 0 = 可发布；1 = 已存在同名 release（中止）
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const token = process.env.GH_TOKEN || process.argv[2] || ''
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const version = pkg.version
const tag = `v${version}`

if (!token) {
  console.error('❌ 未设置 GH_TOKEN（或参数）。发布需要 GitHub Token（repo 权限）。')
  process.exit(2)
}

console.log(`🔍 检查 ${tag} 是否已发布...`)
try {
  const res = execSync(
    `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: token ${token}" -H "Accept: application/vnd.github+json" https://api.github.com/repos/${pkg.build.publish[0].owner}/${pkg.build.publish[0].repo}/releases/tags/${tag}`,
    { encoding: 'utf8', shell: 'bash' }
  )
  if (res.trim() === '200') {
    console.error(`❌ ${tag} 已在 GitHub Releases 存在——请先提升 package.json 的 version 再发布！`)
    process.exit(1)
  }
  console.log(`✅ ${tag} 未发布过，可以发布。`)
  process.exit(0)
} catch (e) {
  console.error('❌ 检查失败：' + (e && e.message))
  process.exit(2)
}
