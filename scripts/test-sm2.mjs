// SM-2 轻量算法单测：覆盖质量分 0-5、间隔复利、ease 边界、连对进度。
import assert from 'assert'
import { scheduleNextReview } from '../electron/sm2.js'

let pass = 0, fail = 0
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ✅', name) }
  catch (e) { fail++; console.log('  ❌', name, '-', e.message) }
}

// 首次作答（无历史）
await check('首次答对(quality=4)：interval=1, ease≈2.5', () => {
  const r = scheduleNextReview({}, 4)
  assert.equal(r.interval, 1)
  assert.ok(Math.abs(r.ease - 2.5) < 1e-9)
})

// 连对进度：0→1→6→6*ease
await check('第二次答对(quality=5)：interval=6', () => {
  const r = scheduleNextReview({ interval: 1, ease: 2.5 }, 5)
  assert.equal(r.interval, 6)
  assert.ok(r.ease > 2.5) // 满分应提升 ease
})

await check('第三次答对(quality=4)：interval≈round(6*ease)', () => {
  const r = scheduleNextReview({ interval: 6, ease: 2.6 }, 4)
  assert.equal(r.interval, Math.round(6 * 2.6))
})

// 失败处理
await check('答错(quality=0)：interval 重置为 1 且 ease 下降', () => {
  const r = scheduleNextReview({ interval: 30, ease: 2.8 }, 0)
  assert.equal(r.interval, 1)
  assert.ok(r.ease < 2.8)
  assert.ok(r.ease >= 1.3)
})

await check('低质量(quality=2)同样判失败重置', () => {
  const r = scheduleNextReview({ interval: 12, ease: 2.5 }, 2)
  assert.equal(r.interval, 1)
})

// ease 下界保护
await check('ease 不跌破 1.3', () => {
  let s = { interval: 1, ease: 1.3 }
  for (let i = 0; i < 10; i++) s = scheduleNextReview(s, 0)
  assert.ok(s.ease >= 1.3)
})

// interval 上界保护
await check('interval 不超过 365', () => {
  const r = scheduleNextReview({ interval: 300, ease: 3.0 }, 5)
  assert.ok(r.interval <= 365)
})

// next 为未来时间戳
await check('next 为毫秒时间戳且 > now', () => {
  const now = Date.now()
  const r = scheduleNextReview({ interval: 1, ease: 2.5 }, 4)
  assert.ok(typeof r.next === 'number' && r.next > now)
})

console.log(`\nSM-2 测试：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
