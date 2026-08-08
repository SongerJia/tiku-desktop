// 自适应复习（SM-2 轻量实现）：依据掌握质量 quality(0-5) 计算下一次间隔与难度因子。
// state: { interval(天,0起), ease(默认2.5) }；quality<3 视为失败，间隔重置且 ease 下降。
// 返回 { interval(天), ease, next(毫秒时间戳) }。
// 独立成模块，便于 node 单测直接 require（不依赖 electron / 数据库）。
function scheduleNextReview(state, quality) {
  let interval = state && state.interval != null ? state.interval : 0
  let ease = state && state.ease != null ? state.ease : 2.5
  quality = quality == null ? 4 : quality
  if (quality < 3) {
    interval = 1
    ease = Math.max(1.3, ease - 0.2)
  } else {
    if (interval === 0) interval = 1
    else if (interval === 1) interval = 6
    else interval = Math.round(interval * ease)
    // 质量越高 ease 增长越多（5→+0.1，4→+0.02，3→-0.14）
    ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    ease = Math.max(1.3, ease)
  }
  interval = Math.max(1, Math.min(interval, 365))
  return { interval, ease, next: Date.now() + interval * 86400000 }
}

module.exports = { scheduleNextReview }
