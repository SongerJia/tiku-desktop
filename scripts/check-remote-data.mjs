// 一键诊断：查 tiku-assets 仓库远端数据量 + 老 Gist 是否有数据
// 运行：node scripts/check-remote-data.mjs
// 需要 GH_TOKEN 环境变量（已配置用户级，重开终端即可）
import zlib from 'node:zlib'

const TOKEN = process.env.GH_TOKEN || ''
if (!TOKEN) { console.error('未设置 GH_TOKEN，请重开终端再运行'); process.exit(1) }
const API = 'https://api.github.com'

async function gh(path) {
  const res = await fetch(API + path, { headers: { Authorization: `token ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'tiku-diag' } })
  if (res.status >= 400) throw new Error(path + ' → HTTP ' + res.status)
  return res.json()
}

console.log('=== 1) tiku-assets 仓库内容 ===')
try {
  const tree = await gh('/repos/SongerJia/tiku-assets/git/trees/HEAD?recursive=1')
  const files = (tree.tree || []).filter(f => f.type === 'blob')
  console.log('文件数:', files.length)
  files.slice(0, 20).forEach(f => console.log('  ', f.path, (f.size/1024).toFixed(1) + 'KB'))
  const data = files.find(f => f.path === 'data.json.gz')
  if (data) {
    // 下载并解压看数据量
    const raw = await fetch(`https://raw.githubusercontent.com/SongerJia/tiku-assets/HEAD/data.json.gz`, { headers: { Authorization: `token ${TOKEN}` } })
    const buf = Buffer.from(await raw.arrayBuffer())
    const json = JSON.parse(zlib.gunzipSync(buf).toString('utf8'))
    const count = (k) => Array.isArray(json[k]) ? json[k].length : (json[k] ? Object.keys(json[k]).length : 0)
    console.log(`data.json.gz 解压后数据量: 科目 ${count('categories')} / 题 ${count('questions')} / 卡 ${count('cards')} / 错题 ${count('wrongBooks')} / 文档 ${count('kbDocs')}`)
  } else {
    console.log('⚠️ data.json.gz 不存在——远端可能从未成功推送数据！')
  }
} catch (e) { console.log('仓库读取失败:', e.message) }

console.log('\n=== 2) 老 Gist 里是否有数据 ===')
try {
  const gists = await gh('/gists?per_page=10')
  if (!gists.length) console.log('无 Gist')
  gists.forEach(g => console.log('  gist:', (g.id || '').slice(0,8), '|', (g.description || '').slice(0,30), '| 更新:', (g.updated_at || '').slice(0,10)))
} catch (e) { console.log('Gist 读取失败:', e.message) }
