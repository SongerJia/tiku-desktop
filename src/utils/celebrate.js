// 庆祝触发器：答题/复习/阅读等关键动作后调用，检测成就解锁与等级升级并 toast 庆祝
import { tiku } from '../api/tiku.js'
import { showToast } from './toast.js'
import { notifyNew, notifyLevelUp } from './achievements.js'

export async function celebrate() {
  try {
    const [ach, xp, ms] = await Promise.all([tiku.getAchievements(), tiku.xpStats(), tiku.getMonthStats()])
    const merged = { ...ach, ...ms }
    const fresh = notifyNew(merged)
    if (fresh.length) {
      // 首次解锁奖励 XP：每个成就 +20（仅新解锁计入）
      try { await tiku.logXp(fresh.length * 20, 'achievement', '成就解锁奖励') } catch (e) {}
    }
    // 赛季系统已移除（2026-08-12）：不再弹「赛季挑战达成」toast（此前 UI 已删，弹了无入口可看）
    // 解锁爆光（2026-08-14）：首个新成就全屏粒子爆光，其余走 toast
    if (fresh.length && typeof window !== 'undefined' && window.__achBurst) {
      window.__achBurst({ name: fresh[0].name, desc: fresh[0].desc })
    }
    fresh.slice(0, 3).forEach(a => showToast(`解锁成就「${a.name}」！${a.desc} +20 XP`, 'ok'))
    const lv = notifyLevelUp(xp)
    if (lv) showToast(`升级！达到 Lv.${lv}`, 'ok')
  } catch (e) { /* 庆祝失败不影响主流程 */ }
}
