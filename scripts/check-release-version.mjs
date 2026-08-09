// 发布防呆：检查当前版本是否已发布到 GitHub Releases（防止误发布同版本覆盖旧版）
// 用法：node scripts/check-release-version.mjs
// 读取 GH_TOKEN 环境变量（用户级环境变量，npm run release 前设置）
// 返回 0 = 可发布；1 = 已存在同名 release（中止）；2 = 配置错误
import fs from 'node:fs'

const token = process.env.GH_TOKEN || ''
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const version = pkg.version
const tag = `v${version}`

const publish = (pkg.build && pkg.build.publish && pkg.build.publish[0]) || {}
const owner = publish.owner || ''
const repo = publish.repo || ''

if (!token) {
  console.error('❌ 未设置 GH_TOKEN 环境变量。发布需要 GitHub Token（repo 权限）。')
  console.error('   Windows 已配置用户级 GH_TOKEN，请【重新打开终端】后再运行。')
  process.exit(2)
}
if (!owner || !repo) {
  console.error('❌ package.json 的 build.publish 缺少 owner/repo 配置')
  process.exit(2)
}

console.log(`🔍 检查 ${tag} 是否已发布...`)

// 用 Node 原生 fetch（Node 18+ 内置），不依赖 curl/bash
try {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'tiku-release-check'
    }
  })
  if (res.status === 200) {
    console.error(`❌ ${tag} 已在 GitHub Releases 存在——请先提升 package.json 的 version 再发布！`)
    process.exit(1)
  }
  if (res.status === 404) {
    console.log(`✅ ${tag} 未发布过，可以发布。`)
    process.exit(0)
  }
  // 401/403 = token 问题；网络错误会 throw
  const body = await res.json().catch(() => ({}))
  console.error(`❌ 检查失败（HTTP ${res.status}）：${body.message || '未知错误'}`)
  process.exit(2)
} catch (e) {
  console.error('❌ 网络错误（无法连接 GitHub API）：' + (e && e.message))
  console.error('   请确认网络可访问 api.github.com 后重试（同步走 GitHub 正常的话网络应该没问题）。')
  process.exit(2)
}
