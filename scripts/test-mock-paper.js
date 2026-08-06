// 模拟卷组卷算法验证（纯函数镜像 electron/db.js#generatePaper 的抽题与计分逻辑）
// 沙箱装不了 better-sqlite3，这里用内存数据镜像核心算法，确保：
//  1) 随机抽题无重复、不超库容；2) 卷面总分恰好为整数（四舍五入误差已抹平）；
//  3) 手动分值优先且正确计入总分。
const assert = require('assert')

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 镜像 db.js 的抽题 + 计分（手动优先，自动均摊，误差抹平到最后一个自动题）
function buildPaper(pool, rules) {
  const picked = []
  for (const rule of rules) {
    const cnt = rule.count || 0
    if (!cnt) continue
    const sub = pool.filter(p => p.type === rule.type)
    assert.ok(sub.length >= cnt, `题型 ${rule.type} 数量不足：${sub.length} < ${cnt}`)
    picked.push(...shuffle(sub).slice(0, cnt))
  }
  const manualOf = (r) => (r.score && r.score > 0) ? Number(r.score) : null
  let manualTotal = 0
  const perType = {}
  for (const r of rules) {
    const sc = manualOf(r)
    if (sc != null) { perType[r.type] = sc; manualTotal += sc * (Number(r.count) || 0) }
  }
  const autoCount = rules.filter(r => manualOf(r) == null).reduce((s, r) => s + (Number(r.count) || 0), 0)
  const autoTotal = Math.max(0, Math.round((100 - manualTotal) * 10) / 10)
  const autoEach = autoCount ? Math.round((autoTotal / autoCount) * 10) / 10 : 0

  const scores = picked.map(p => (perType[p.type] != null ? perType[p.type] : autoEach))
  const target = Math.round((manualTotal + autoTotal) * 10) / 10
  const sum0 = Math.round(scores.reduce((s, x) => s + x, 0) * 10) / 10
  const lastAutoIdx = scores.length - 1 - [...scores].reverse().findIndex(s => s === autoEach)
  if (lastAutoIdx >= 0 && scores[lastAutoIdx] === autoEach) {
    scores[lastAutoIdx] = Math.round((scores[lastAutoIdx] + (target - sum0)) * 10) / 10
  }
  const questions = picked.map((p, i) => ({ id: p.id, type: p.type, score: scores[i] }))
  return { questions, total: target, count: picked.length }
}

// ---- 构造题库：每个题型各 20 题 ----
const types = ['single', 'multiple', 'judge', 'essay']
const pool = []
let id = 1
for (const t of types) for (let i = 0; i < 20; i++) pool.push({ id: id++, type: t })

// 用例 1：等分制 10单+5多+10判+2问答=27题，总分应恰好 100
{
  const rules = [
    { type: 'single', count: 10 },
    { type: 'multiple', count: 5 },
    { type: 'judge', count: 10 },
    { type: 'essay', count: 2 }
  ]
  const paper = buildPaper(pool, rules)
  assert.strictEqual(paper.count, 27, '题数应为 27')
  assert.strictEqual(paper.total, 100, `等分总分应恰好 100，实=${paper.total}`)
  const sum = paper.questions.reduce((s, q) => Math.round((s + q.score) * 10) / 10, 0)
  assert.strictEqual(sum, 100, `计分求和应恰好 100，实=${sum}`)
  console.log('用例1 等分制: 通过 (总分=' + paper.total + ')')
}

// 用例 2：手动分值优先（单选每题 5 分 ×10 =50，判断自动均摊=50，合计 100）
{
  const rules = [
    { type: 'single', count: 10, score: 5 },
    { type: 'judge', count: 10 }
  ]
  const paper = buildPaper(pool, rules)
  const singles = paper.questions.filter(q => q.type === 'single')
  assert.ok(singles.every(q => q.score === 5), '单选题手动分值应为 5')
  assert.strictEqual(paper.total, 100, `手动+自动总分应恰好 100，实=${paper.total}`)
  console.log('用例2 手动分值: 通过 (单选=5×10, 总分=' + paper.total + ')')
}

// 用例 3：随机抽题在「单份卷内」无重复、不超出题库容量（30 轮）
{
  const rules = [{ type: 'single', count: 15 }]
  for (let trial = 0; trial < 30; trial++) {
    const paper = buildPaper(pool, rules)
    assert.strictEqual(paper.count, 15)
    const ids = new Set(paper.questions.map(q => q.id))
    assert.strictEqual(ids.size, 15, '单份卷内不应有重复题')
  }
  console.log('用例3 抽题无重复: 通过 (30 轮 × 15 题，单卷内唯一)')
}

// 用例 4：数量超过库存应抛错
{
  const rules = [{ type: 'essay', count: 999 }]
  let threw = false
  try { buildPaper(pool, rules) } catch (e) { threw = true }
  assert.ok(threw, '超库存应抛错')
  console.log('用例4 超库存拦截: 通过')
}

console.log('\n✅ 模拟卷组卷算法全部通过')
