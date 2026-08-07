// 庆祝触发器：答题/复习/阅读等关键动作后调用，检测成就解锁与等级升级并 toast 庆祝
import { tiku } from '../api/tiku.js'
import { showToast } from './toast.js'
import { notifyNew, notifyLevelUp } from './achievements.js'

export async function celebrate() {
  try {
    const [ach, xp] = await Promise.all([tiku.getAchievements(), tiku.xpStats()])
    const fresh = notifyNew(ach)
    fresh.slice(0, 3).forEach(a => showToast(`${a.icon} 解锁成就「${a.name}」！${a.desc}`, 'ok'))
    const lv = notifyLevelUp(xp)
    if (lv) showToast(`🎉 升级！达到 Lv.${lv}`, 'ok')
  } catch (e) { /* 庆祝失败不影响主流程 */ }
}
