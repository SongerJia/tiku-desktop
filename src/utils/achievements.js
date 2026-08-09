// 成就系统共享模块：定义 + 解锁检测 + 升级检测（Profile 成就墙与全局庆祝共用）
// 游戏化：系列分组 / 稀有度(铜银金白金) / 成就点数 / 成就等级 / 隐藏成就 / 解锁时间戳
// localStorage 键：tiku_notified_ach（已通知解锁的成就 key）、tiku_last_level（上次等级）、tiku_ach_ts（解锁时间戳）

export const ACH_SERIES = [
  { key: 'quiz', name: '刷题达人', icon: '🎯' },
  { key: 'streak', name: '连续打卡', icon: '🔥' },
  { key: 'master', name: '掌握之路', icon: '🏆' },
  { key: 'kb', name: '知识库', icon: '📚' },
  { key: 'notes', name: '笔记整理', icon: '📒' },
  { key: 'fav', name: '收藏卷宗', icon: '⭐' }
]

export const ACH_RARITY = {
  bronze:   { label: '铜',   color: '#b87333', points: 10 },
  silver:   { label: '银',   color: '#8a97a5', points: 25 },
  gold:     { label: '金',   color: '#d9a514', points: 50 },
  platinum: { label: '白金', color: '#7b46c4', points: 100 }
}

export const ACH_DEFS = [
  // ===== 刷题达人（quiz）=====
  { key: 'first', name: '初次启程', icon: '🌟', series: 'quiz', rarity: 'bronze', desc: '完成第一题', progress: m => m.totalAnswered / 1, fmt: m => `${Math.min(m.totalAnswered, 1)}/1` },
  { key: 'ten', name: '小试牛刀', icon: '✨', series: 'quiz', rarity: 'bronze', desc: '累计刷题 10 题', progress: m => m.totalAnswered / 10, fmt: m => `${m.totalAnswered}/10` },
  { key: 'hundred', name: '百题斩', icon: '💯', series: 'quiz', rarity: 'silver', desc: '累计刷题 100 题', progress: m => m.totalAnswered / 100, fmt: m => `${m.totalAnswered}/100` },
  { key: 'thousand', name: '千题斩', icon: '💪', series: 'quiz', rarity: 'gold', desc: '累计刷题 1000 题', progress: m => m.totalAnswered / 1000, fmt: m => `${m.totalAnswered}/1000` },
  { key: 'today20', name: '今日之星', icon: '🌞', series: 'quiz', rarity: 'silver', desc: '单日刷题 20 题', progress: m => m.today / 20, fmt: m => `${Math.min(m.today, 20)}/20` },
  { key: 'correct200', name: '神射手', icon: '🎯', series: 'quiz', rarity: 'gold', desc: '累计答对 200 次', progress: m => m.correctCount / 200, fmt: m => `${m.correctCount}/200` },
  { key: 'essay20', name: '问答专家', icon: '💬', series: 'quiz', rarity: 'silver', desc: '问答作答 20 次', progress: m => m.essayCount / 20, fmt: m => `${m.essayCount}/20` },
  // ===== 连续打卡（streak）=====
  { key: 'streak7', name: '七日打卡', icon: '🔥', series: 'streak', rarity: 'silver', desc: '连续学习 7 天', progress: m => m.streak / 7, fmt: m => `${Math.min(m.streak, 7)}/7` },
  { key: 'streak30', name: '月度连击', icon: '⚡', series: 'streak', rarity: 'gold', desc: '连续学习 30 天', progress: m => m.streak / 30, fmt: m => `${Math.min(m.streak, 30)}/30` },
  { key: 'active30', name: '月度学霸', icon: '🏆', series: 'streak', rarity: 'silver', desc: '累计学习 30 天', progress: m => m.activeDays / 30, fmt: m => `${m.activeDays}/30` },
  // ===== 掌握之路（master）=====
  { key: 'mastered', name: '渐入佳境', icon: '🎯', series: 'master', rarity: 'silver', desc: '掌握 50 道题', progress: m => m.mastered / 50, fmt: m => `${m.mastered}/50` },
  { key: 'master200', name: '知识大师', icon: '🏅', series: 'master', rarity: 'gold', desc: '掌握 200 道题', progress: m => m.mastered / 200, fmt: m => `${m.mastered}/200` },
  { key: 'goal', name: '自律克己', icon: '🎯', series: 'master', rarity: 'bronze', desc: '设定每日目标', progress: m => (m.dailyGoal > 0 ? 1 : 0), fmt: m => (m.dailyGoal > 0 ? '已设置' : '未设置') },
  // ===== 知识库（kb）=====
  { key: 'kbFirst', name: '建库人', icon: '📚', series: 'kb', rarity: 'bronze', desc: '导入第 1 篇文档', progress: m => m.kbDocs / 1, fmt: m => `${Math.min(m.kbDocs, 1)}/1` },
  { key: 'kbTen', name: '藏书家', icon: '📚', series: 'kb', rarity: 'silver', desc: '导入 10 篇文档', progress: m => m.kbDocs / 10, fmt: m => `${m.kbDocs}/10` },
  { key: 'kbLink10', name: '知识织网', icon: '🕸️', series: 'kb', rarity: 'silver', desc: '建立 10 条文档↔题目联动', progress: m => m.kbLinks / 10, fmt: m => `${m.kbLinks}/10` },
  { key: 'kbRead50', name: '求知若渴', icon: '📖', series: 'kb', rarity: 'gold', desc: '阅读文档 50 次', progress: m => m.kbReadCount / 50, fmt: m => `${m.kbReadCount}/50` },
  // ===== 笔记整理（notes）=====
  { key: 'notes10', name: '好学笔记', icon: '📒', series: 'notes', rarity: 'silver', desc: '写满 10 条笔记', progress: m => m.notesCount / 10, fmt: m => `${m.notesCount}/10` },
  { key: 'notes50', name: '笔记狂魔', icon: '📓', series: 'notes', rarity: 'gold', desc: '写满 50 条笔记', progress: m => m.notesCount / 50, fmt: m => `${m.notesCount}/50` },
  { key: 'tags5', name: '井井有条', icon: '🏷️', series: 'notes', rarity: 'bronze', desc: '使用 5 个标签', progress: m => m.tagsUsed / 5, fmt: m => `${m.tagsUsed}/5` },
  { key: 'tags15', name: '标签大师', icon: '🏷️', series: 'notes', rarity: 'silver', desc: '使用 15 个标签', progress: m => m.tagsUsed / 15, fmt: m => `${m.tagsUsed}/15` },
  // ===== 收藏卷宗（fav）=====
  { key: 'fav20', name: '收藏家', icon: '⭐', series: 'fav', rarity: 'silver', desc: '收藏 20 道题', progress: m => m.favCount / 20, fmt: m => `${m.favCount}/20` },
  { key: 'fav50', name: '收藏达人', icon: '💖', series: 'fav', rarity: 'gold', desc: '收藏 50 道题', progress: m => m.favCount / 50, fmt: m => `${m.favCount}/50` },
  { key: 'paper', name: '出卷人', icon: '📝', series: 'fav', rarity: 'bronze', desc: '组卷至少 1 套', progress: m => m.papersCount / 1, fmt: m => `${Math.min(m.papersCount, 1)}/1` },
  // ===== 隐藏成就（达成才揭晓）=====
  { key: 'day50', name: '一日千里', icon: '🚀', series: 'quiz', rarity: 'platinum', hidden: true, desc: '单日答题 50 题', progress: m => m.today / 50, fmt: m => `${Math.min(m.today, 50)}/50` },
  { key: 'active90', name: '百日攀登', icon: '⛰️', series: 'streak', rarity: 'gold', hidden: true, desc: '累计学习 90 天', progress: m => m.activeDays / 90, fmt: m => `${m.activeDays}/90` },
  { key: 'tenInRow', name: '势如破竹', icon: '🌊', series: 'streak', rarity: 'platinum', hidden: true, desc: '连续学习 10 天', progress: m => m.streak / 10, fmt: m => `${m.streak}/10` }
]

// 计算每项成就的状态（与 Profile 原逻辑一致）
export function evaluate(metrics) {
  return ACH_DEFS.map(a => {
    const p = metrics ? a.progress(metrics) : 0
    return {
      ...a,
      got: p >= 1,
      pct: Math.round(Math.min(1, Math.max(0, p)) * 100),
      fmtText: metrics ? a.fmt(metrics) : '',
      points: (ACH_RARITY[a.rarity] || ACH_RARITY.bronze).points,
      unlockAt: getAchTs(a.key)
    }
  })
}

// 成就等级（按累计点数）
export function achLevel(points) {
  if (points >= 600) return { name: '白金传说', icon: '💎', min: 600 }
  if (points >= 300) return { name: '黄金大师', icon: '🥇', min: 300 }
  if (points >= 100) return { name: '白银学者', icon: '🥈', min: 100 }
  return { name: '青铜学徒', icon: '🥉', min: 0 }
}

// 解锁时间戳存取：tiku_ach_ts = { [key]: 'YYYY-MM-DD' }
const TS_KEY = 'tiku_ach_ts'
function tsStore() {
  try { return JSON.parse(localStorage.getItem(TS_KEY) || '{}') } catch (e) { return {} }
}
export function getAchTs(key) { return tsStore()[key] || null }
export function markAchTs(key) {
  const s = tsStore()
  if (!s[key]) { s[key] = new Date().toISOString().slice(0, 10) }
  try { localStorage.setItem(TS_KEY, JSON.stringify(s)) } catch (e) {}
}

const ACH_KEY = 'tiku_notified_ach'

// 返回「新解锁」的成就列表（首次调用只初始化不弹，避免老数据刷屏）
export function notifyNew(metrics) {
  const unlocked = evaluate(metrics).filter(a => a.got)
  let done = []
  try { done = JSON.parse(localStorage.getItem(ACH_KEY) || '[]') } catch (e) { done = [] }
  const fresh = unlocked.filter(a => !done.includes(a.key))
  fresh.forEach(a => markAchTs(a.key))
  try { localStorage.setItem(ACH_KEY, JSON.stringify(unlocked.map(a => a.key))) } catch (e) {}
  if (!done.length) return [] // 首次：只记录基线，不弹
  return fresh
}

const LV_KEY = 'tiku_last_level'

// 返回新等级（0 = 未升级；首次只记录基线）
export function notifyLevelUp(xp) {
  const lv = (xp && xp.level) || 1
  const last = Number(localStorage.getItem(LV_KEY) || 0)
  try { localStorage.setItem(LV_KEY, String(lv)) } catch (e) {}
  if (!last) return 0
  return lv > last ? lv : 0
}
