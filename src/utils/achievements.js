// 成就系统共享模块：定义 + 解锁检测 + 升级检测（Profile 成就墙与全局庆祝共用）
// 体系（2026-08-13 重构）：系列 → 归类成就（按维度归并）→ 4 档稀有度（铜银金白金）
// 62 个平级成就 → 20 个归类成就 × 4 档阈值；hidden 隐藏成就并入对应维度档位
// localStorage 键：tiku_notified_ach（已通知解锁的成就 key）、tiku_last_level（上次等级）、tiku_ach_ts（解锁时间戳）

export const ACH_SERIES = [
  { key: 'quiz', name: '刷题达人', icon: 'target' },
  { key: 'streak', name: '连续打卡', icon: 'fire' },
  { key: 'master', name: '掌握之路', icon: 'trophy' },
  { key: 'wrong', name: '错题大师', icon: 'shield' },
  { key: 'cards', name: '记忆卡达人', icon: 'card' },
  { key: 'focus', name: '专注达人', icon: 'hourglass' },
  { key: 'quest', name: '任务达人', icon: 'flag' },
  { key: 'kb', name: '知识库', icon: 'book' },
  { key: 'notes', name: '笔记整理', icon: 'note' },
  { key: 'fav', name: '收藏卷宗', icon: 'star' }
]

export const ACH_RARITY = {
  bronze:   { label: '铜',   color: '#b87333', points: 10 },
  silver:   { label: '银',   color: '#9fb2c0', points: 25 },
  gold:     { label: '金',   color: '#d9a514', points: 50 },
  platinum: { label: '白金', color: '#7dd3fc', points: 100 }
}
// 档位顺序（index 0 铜 → 3 白金）
export const RARITY_ORDER = ['bronze', 'silver', 'gold', 'platinum']

// 归类成就：metric 取后端指标字段，tiers = [铜, 银, 金, 白金] 4 档阈值
export const ACH_DEFS = [
  // ===== 刷题达人（quiz）：4 个维度 =====
  { key: 'quizTotal', name: '答题量', icon: 'target', series: 'quiz', metric: 'totalAnswered', tiers: [10, 100, 1000, 5000], desc: '累计刷题', fmt: (m, t) => `${m.totalAnswered}/${t}` },
  { key: 'quizCorrect', name: '答对量', icon: 'target', series: 'quiz', metric: 'correctCount', tiers: [50, 100, 200, 500], desc: '累计答对', fmt: (m, t) => `${m.correctCount}/${t}` },
  { key: 'quizToday', name: '单日强度', icon: 'target', series: 'quiz', metric: 'today', tiers: [10, 20, 30, 50], desc: '单日刷题', fmt: (m, t) => `${Math.min(m.today, t)}/${t}` },
  { key: 'quizEssay', name: '问答量', icon: 'target', series: 'quiz', metric: 'essayCount', tiers: [5, 10, 20, 50], desc: '问答作答', fmt: (m, t) => `${m.essayCount}/${t}` },
  // ===== 连续打卡（streak）：2 个维度 =====
  { key: 'streakDays', name: '连续天数', icon: 'fire', series: 'streak', metric: 'streak', tiers: [3, 7, 30, 100], desc: '连续学习', fmt: (m, t) => `${Math.min(m.streak, t)}/${t}` },
  { key: 'streakTotal', name: '累计天数', icon: 'fire', series: 'streak', metric: 'activeDays', tiers: [10, 30, 90, 180], desc: '累计学习', fmt: (m, t) => `${m.activeDays}/${t}` },
  // ===== 掌握之路（master）：1 个维度 =====
  { key: 'masterCount', name: '掌握量', icon: 'trophy', series: 'master', metric: 'mastered', tiers: [20, 50, 200, 500], desc: '掌握题目', fmt: (m, t) => `${m.mastered}/${t}` },
  // ===== 错题大师（wrong）：2 个维度 =====
  { key: 'wrongCount', name: '错题积累', icon: 'shield', series: 'wrong', metric: 'wrongCount', tiers: [10, 50, 100, 200], desc: '错题本积累', fmt: (m, t) => `${m.wrongCount}/${t}` },
  { key: 'wrongClear', name: '错题毕业', icon: 'shield', series: 'wrong', metric: 'mastered', tiers: [50, 100, 200, 300], desc: '错题毕业', fmt: (m, t) => `${m.mastered}/${t}` },
  // ===== 记忆卡达人（cards）：2 个维度 =====
  { key: 'cardCount', name: '建卡量', icon: 'card', series: 'cards', metric: 'cardsCount', tiers: [1, 10, 50, 100], desc: '制作记忆卡', fmt: (m, t) => `${Math.min(m.cardsCount, t)}/${t}` },
  { key: 'cardReview', name: '复习量', icon: 'card', series: 'cards', metric: 'reviewCount', tiers: [20, 50, 200, 500], desc: '累计复习', fmt: (m, t) => `${m.reviewCount}/${t}` },
  // ===== 专注达人（focus）：1 个维度 =====
  { key: 'focusMin', name: '专注时长', icon: 'hourglass', series: 'focus', metric: 'focusMin', tiers: [30, 300, 1500, 5000], desc: '累计专注', fmt: (m, t) => `${m.focusMin}/${t}` },
  // ===== 任务达人（quest）：1 个维度 =====
  { key: 'questCheck', name: '习惯打卡', icon: 'flag', series: 'quest', metric: 'habitChecks', tiers: [5, 30, 100, 300], desc: '习惯打卡', fmt: (m, t) => `${m.habitChecks}/${t}` },
  // ===== 知识库（kb）：3 个维度 =====
  { key: 'kbDocs', name: '藏书阁', icon: 'book', series: 'kb', metric: 'kbDocs', tiers: [1, 10, 50, 100], desc: '导入文档', fmt: (m, t) => `${Math.min(m.kbDocs, t)}/${t}` },
  { key: 'kbRead', name: '阅读家', icon: 'book', series: 'kb', metric: 'kbReadCount', tiers: [10, 50, 200, 500], desc: '阅读文档', fmt: (m, t) => `${m.kbReadCount}/${t}` },
  { key: 'kbLink', name: '织网', icon: 'book', series: 'kb', metric: 'kbLinks', tiers: [5, 10, 50, 100], desc: '题目联动', fmt: (m, t) => `${m.kbLinks}/${t}` },
  // ===== 笔记整理（notes）：2 个维度 =====
  { key: 'noteCount', name: '笔记量', icon: 'note', series: 'notes', metric: 'notesCount', tiers: [1, 10, 50, 100], desc: '写满笔记', fmt: (m, t) => `${Math.min(m.notesCount, t)}/${t}` },
  { key: 'noteTags', name: '标签量', icon: 'note', series: 'notes', metric: 'tagsUsed', tiers: [5, 15, 30, 60], desc: '使用标签', fmt: (m, t) => `${m.tagsUsed}/${t}` },
  // ===== 收藏卷宗（fav）：2 个维度 =====
  { key: 'favCount', name: '收藏量', icon: 'star', series: 'fav', metric: 'favCount', tiers: [10, 20, 50, 100], desc: '收藏题目', fmt: (m, t) => `${m.favCount}/${t}` },
  { key: 'favGroup', name: '收藏分组', icon: 'star', series: 'fav', metric: 'favGroups', tiers: [1, 2, 5, 10], desc: '收藏分组', fmt: (m, t) => `${m.favGroups}/${t}` }
]

// 计算每项归类成就的状态：tier 0=未达铜 / 1=铜 / 2=银 / 3=金 / 4=白金
// 点数 = 当前达到档位的稀有度点数（如达金=50，未解锁=0）；pct = 当前档到下一档的进度
export function evaluate(metrics) {
  return ACH_DEFS.map(a => {
    const v = metrics ? Number(metrics[a.metric] || 0) : 0
    let tier = 0
    a.tiers.forEach((t, i) => { if (v >= t) tier = i + 1 })
    const rarity = tier ? RARITY_ORDER[tier - 1] : 'bronze'
    const cur = a.tiers[Math.max(0, tier - 1)] // 当前档阈值（未解锁=铜档）
    const next = a.tiers[tier] // 下一档阈值（满档=undefined）
    const p = next ? v / next : 1
    return {
      ...a,
      tier,
      rarity,
      got: tier > 0,
      pct: Math.round(Math.min(1, Math.max(0, p)) * 100),
      fmtText: metrics ? a.fmt(metrics, cur) : '',
      next, // 下一档阈值
      points: tier ? (ACH_RARITY[rarity] || ACH_RARITY.bronze).points : 0,
      unlockAt: getAchTs(a.key)
    }
  })
}

// 成就等级（按累计点数；20 个归类成就全白金 = 100×20 = 2000 点）
export function achLevel(points) {
  if (points >= 1000) return { name: '白金传说', icon: 'medal', min: 1000 }
  if (points >= 500) return { name: '黄金大师', icon: 'medal', min: 500 }
  if (points >= 150) return { name: '白银学者', icon: 'medal', min: 150 }
  return { name: '青铜学徒', icon: 'medal', min: 0 }
}

// 解锁时间戳存取：tiku_ach_ts = { [key]: 'YYYY-MM-DD' }
const TS_KEY = 'tiku_ach_ts'
function tsStore() {
  try { return JSON.parse(localStorage.getItem(TS_KEY) || '{}') } catch (e) { return {} }
}
export function getAchTs(key) { return tsStore()[key] || null }
export function markAchTs(key) {
  const s = tsStore()
  if (!s[key]) {
    // 本地日期（东八区不能用 toISOString 取 UTC 日期，0-7 点会偏移到前一天）
    const d = new Date()
    s[key] = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }
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
  let last = 0
  try { last = Number(localStorage.getItem(LV_KEY) || 0) } catch (e) {}
  try { localStorage.setItem(LV_KEY, String(lv)) } catch (e) {}
  if (!last) return 0
  return lv > last ? lv : 0
}
