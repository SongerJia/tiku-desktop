// 庆祝触发器：答题/复习/阅读等关键动作后调用，检测成就解锁与等级升级并 toast 庆祝
import { tiku } from '../api/tiku.js'
import { showToast } from './toast.js'
import { notifyNew, notifyLevelUp, evaluateSeason, syncSeasonArchive } from './achievements.js'

export async function celebrate() {
  try {
    const [ach, xp, ms] = await Promise.all([tiku.getAchievements(), tiku.xpStats(), tiku.getMonthStats()])
    const merged = { ...ach, ...ms }
    const fresh = notifyNew(merged)
    if (fresh.length) {
      // 首次解锁奖励 XP：每个成就 +20（仅新解锁计入）
      try { await tiku.logXp(fresh.length * 20, 'achievement', '成就解锁奖励') } catch (e) {}
    }
    // 赛季挑战达成也计入新鲜事（不重复奖励 XP，仅提示）
    const seaDone = evaluateSeason(merged).filter(r => r.got)
    const SEA_KEY_TS = 'tiku_sea_notified'
    let seaNotified = []
    try { seaNotified = JSON.parse(localStorage.getItem(SEA_KEY_TS) || '[]') } catch (e) {}
    const seaFresh = seaDone.filter(r => !seaNotified.includes(r.key))
    try { localStorage.setItem(SEA_KEY_TS, JSON.stringify(seaDone.map(r => r.key))) } catch (e) {}
    seaFresh.slice(0, 3).forEach(r => showToast(`${r.icon} 赛季挑战达成「${r.name}」！${r.target} ${r.unit}`, 'ok'))
    syncSeasonArchive(merged)
    fresh.slice(0, 3).forEach(a => showToast(`${a.icon} 解锁成就「${a.name}」！${a.desc} +20 XP`, 'ok'))
    const lv = notifyLevelUp(xp)
    if (lv) showToast(`🎉 升级！达到 Lv.${lv}`, 'ok')
  } catch (e) { /* 庆祝失败不影响主流程 */ }
}
