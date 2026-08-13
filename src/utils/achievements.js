// 成就系统共享模块：定义 + 解锁检测 + 升级检测（Profile 成就墙与全局庆祝共用）
// 游戏化：系列分组 / 稀有度(铜银金白金) / 成就点数 / 成就等级 / 隐藏成就 / 解锁时间戳
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

export const ACH_DEFS = [
  // ===== 刷题达人（quiz）=====
  { key: 'first', name: '初次启程', icon: 'flag', series: 'quiz', rarity: 'bronze', desc: '完成第一题', progress: m => m.totalAnswered / 1, fmt: m => `${Math.min(m.totalAnswered, 1)}/1` },
  { key: 'ten', name: '小试牛刀', icon: 'pencil', series: 'quiz', rarity: 'bronze', desc: '累计刷题 10 题', progress: m => m.totalAnswered / 10, fmt: m => `${m.totalAnswered}/10` },
  { key: 'hundred', name: '百题斩', icon: 'shield', series: 'quiz', rarity: 'silver', desc: '累计刷题 100 题', progress: m => m.totalAnswered / 100, fmt: m => `${m.totalAnswered}/100` },
  { key: 'thousand', name: '千题斩', icon: 'mountain', series: 'quiz', rarity: 'gold', desc: '累计刷题 1000 题', progress: m => m.totalAnswered / 1000, fmt: m => `${m.totalAnswered}/1000` },
  { key: 'today20', name: '今日之星', icon: 'sun', series: 'quiz', rarity: 'silver', desc: '单日刷题 20 题', progress: m => m.today / 20, fmt: m => `${Math.min(m.today, 20)}/20` },
  { key: 'correct200', name: '神射手', icon: 'arrow-hit', series: 'quiz', rarity: 'gold', desc: '累计答对 200 次', progress: m => m.correctCount / 200, fmt: m => `${m.correctCount}/200` },
  { key: 'essay20', name: '问答专家', icon: 'bubble', series: 'quiz', rarity: 'silver', desc: '问答作答 20 次', progress: m => m.essayCount / 20, fmt: m => `${m.essayCount}/20` },
  { key: 'fiveK', name: '万题斩', icon: 'rocket', series: 'quiz', rarity: 'platinum', desc: '累计刷题 5000 题', progress: m => m.totalAnswered / 5000, fmt: m => `${m.totalAnswered}/5000` },
  { key: 'correct500', name: '百步穿杨', icon: 'target', series: 'quiz', rarity: 'platinum', desc: '累计答对 500 次', progress: m => m.correctCount / 500, fmt: m => `${m.correctCount}/500` },
  // ===== 连续打卡（streak）=====
  { key: 'streak7', name: '七日打卡', icon: 'fire', series: 'streak', rarity: 'silver', desc: '连续学习 7 天', progress: m => m.streak / 7, fmt: m => `${Math.min(m.streak, 7)}/7` },
  { key: 'streak30', name: '月度连击', icon: 'bolt', series: 'streak', rarity: 'gold', desc: '连续学习 30 天', progress: m => m.streak / 30, fmt: m => `${Math.min(m.streak, 30)}/30` },
  { key: 'active30', name: '月度学霸', icon: 'trophy', series: 'streak', rarity: 'silver', desc: '累计学习 30 天', progress: m => m.activeDays / 30, fmt: m => `${m.activeDays}/30` },
  { key: 'streak60', name: '连击王者', icon: 'crown', series: 'streak', rarity: 'gold', desc: '连续学习 60 天', progress: m => m.streak / 60, fmt: m => `${Math.min(m.streak, 60)}/60` },
  { key: 'streak100', name: '百日连击', icon: 'gem', series: 'streak', rarity: 'platinum', desc: '连续学习 100 天', progress: m => m.streak / 100, fmt: m => `${Math.min(m.streak, 100)}/100` },
  // ===== 掌握之路（master）=====
  { key: 'mastered', name: '渐入佳境', icon: 'check', series: 'master', rarity: 'silver', desc: '掌握 50 道题', progress: m => m.mastered / 50, fmt: m => `${m.mastered}/50` },
  { key: 'master200', name: '知识大师', icon: 'trophy', series: 'master', rarity: 'gold', desc: '掌握 200 道题', progress: m => m.mastered / 200, fmt: m => `${m.mastered}/200` },
  { key: 'goal', name: '自律克己', icon: 'target', series: 'master', rarity: 'bronze', desc: '设定每日目标', progress: m => (m.dailyGoal > 0 ? 1 : 0), fmt: m => (m.dailyGoal > 0 ? '已设置' : '未设置') },
  { key: 'master100', name: '融会贯通', icon: 'link', series: 'master', rarity: 'silver', desc: '掌握 100 道题', progress: m => m.mastered / 100, fmt: m => `${m.mastered}/100` },
  { key: 'master500', name: '题海宗师', icon: 'wand', series: 'master', rarity: 'platinum', desc: '掌握 500 道题', progress: m => m.mastered / 500, fmt: m => `${m.mastered}/500` },
  // ===== 错题大师（wrong）：直面错题 + 错题毕业（wrongCount / mastered）=====
  { key: 'wrong10', name: '直面错题', icon: 'shield', series: 'wrong', rarity: 'bronze', desc: '错题本积累 10 道', progress: m => m.wrongCount / 10, fmt: m => `${m.wrongCount}/10` },
  { key: 'wrong50', name: '错题山积', icon: 'layers', series: 'wrong', rarity: 'silver', desc: '错题本积累 50 道', progress: m => m.wrongCount / 50, fmt: m => `${m.wrongCount}/50` },
  { key: 'wrong100', name: '错题如海', icon: 'wave', series: 'wrong', rarity: 'gold', desc: '错题本积累 100 道', progress: m => m.wrongCount / 100, fmt: m => `${m.wrongCount}/100` },
  { key: 'clear100', name: '毕业百题', icon: 'grad-cap', series: 'wrong', rarity: 'silver', desc: '从错题本毕业 100 道（掌握）', progress: m => m.mastered / 100, fmt: m => `${m.mastered}/100` },
  { key: 'clear300', name: '错题清零者', icon: 'broom', series: 'wrong', rarity: 'platinum', desc: '从错题本毕业 300 道（掌握）', progress: m => m.mastered / 300, fmt: m => `${m.mastered}/300` },
  // ===== 记忆卡达人（cards）：建卡 + 复习（cardsCount / reviewCount）=====
  { key: 'card1', name: '记忆初成', icon: 'card', series: 'cards', rarity: 'bronze', desc: '制作第 1 张记忆卡', progress: m => m.cardsCount / 1, fmt: m => `${Math.min(m.cardsCount, 1)}/1` },
  { key: 'card10', name: '卡片新手', icon: 'bookmark', series: 'cards', rarity: 'silver', desc: '制作 10 张记忆卡', progress: m => m.cardsCount / 10, fmt: m => `${m.cardsCount}/10` },
  { key: 'card50', name: '记忆宫殿', icon: 'library', series: 'cards', rarity: 'gold', desc: '制作 50 张记忆卡', progress: m => m.cardsCount / 50, fmt: m => `${m.cardsCount}/50` },
  { key: 'card100', name: '记忆大师', icon: 'brain', series: 'cards', rarity: 'platinum', desc: '制作 100 张记忆卡', progress: m => m.cardsCount / 100, fmt: m => `${m.cardsCount}/100` },
  { key: 'cardReview200', name: '温故知新', icon: 'refresh', series: 'cards', rarity: 'gold', desc: '累计复习 200 次', progress: m => m.reviewCount / 200, fmt: m => `${m.reviewCount}/200` },
  // ===== 专注达人（focus）：专注总分钟（focusMin）=====
  { key: 'focus30', name: '专注一刻', icon: 'hourglass', series: 'focus', rarity: 'bronze', desc: '累计专注 30 分钟', progress: m => m.focusMin / 30, fmt: m => `${m.focusMin}/30` },
  { key: 'focus300', name: '专注五小时', icon: 'pomodoro', series: 'focus', rarity: 'silver', desc: '累计专注 300 分钟', progress: m => m.focusMin / 300, fmt: m => `${m.focusMin}/300` },
  { key: 'focus1500', name: '专注 25 小时', icon: 'bolt', series: 'focus', rarity: 'gold', desc: '累计专注 1500 分钟', progress: m => m.focusMin / 1500, fmt: m => `${m.focusMin}/1500` },
  { key: 'focus5000', name: '专注 83 小时', icon: 'flame', series: 'focus', rarity: 'platinum', desc: '累计专注 5000 分钟', progress: m => m.focusMin / 5000, fmt: m => `${m.focusMin}/5000` },
  // ===== 任务达人（quest）：习惯打卡（habitChecks）=====
  { key: 'habit5', name: '自律开端', icon: 'play', series: 'quest', rarity: 'bronze', desc: '习惯打卡 5 次', progress: m => m.habitChecks / 5, fmt: m => `${m.habitChecks}/5` },
  { key: 'habit30', name: '习惯成自然', icon: 'sprout', series: 'quest', rarity: 'silver', desc: '习惯打卡 30 次', progress: m => m.habitChecks / 30, fmt: m => `${m.habitChecks}/30` },
  { key: 'habit100', name: '铁律达人', icon: 'medal', series: 'quest', rarity: 'gold', desc: '习惯打卡 100 次', progress: m => m.habitChecks / 100, fmt: m => `${m.habitChecks}/100` },
  // ===== 知识库（kb）=====
  { key: 'kbFirst', name: '建库人', icon: 'doc', series: 'kb', rarity: 'bronze', desc: '导入第 1 篇文档', progress: m => m.kbDocs / 1, fmt: m => `${Math.min(m.kbDocs, 1)}/1` },
  { key: 'kbTen', name: '藏书家', icon: 'book', series: 'kb', rarity: 'silver', desc: '导入 10 篇文档', progress: m => m.kbDocs / 10, fmt: m => `${m.kbDocs}/10` },
  { key: 'kbLink10', name: '知识织网', icon: 'network', series: 'kb', rarity: 'silver', desc: '建立 10 条文档↔题目联动', progress: m => m.kbLinks / 10, fmt: m => `${m.kbLinks}/10` },
  { key: 'kbRead50', name: '求知若渴', icon: 'eye', series: 'kb', rarity: 'gold', desc: '阅读文档 50 次', progress: m => m.kbReadCount / 50, fmt: m => `${m.kbReadCount}/50` },
  { key: 'kbFifty', name: '图书馆长', icon: 'library', series: 'kb', rarity: 'gold', desc: '导入 50 篇文档', progress: m => m.kbDocs / 50, fmt: m => `${m.kbDocs}/50` },
  { key: 'kbLink50', name: '知识网络', icon: 'link', series: 'kb', rarity: 'gold', desc: '建立 50 条文档↔题目联动', progress: m => m.kbLinks / 50, fmt: m => `${m.kbLinks}/50` },
  { key: 'kbRead200', name: '学富五车', icon: 'bulb', series: 'kb', rarity: 'platinum', desc: '阅读文档 200 次', progress: m => m.kbReadCount / 200, fmt: m => `${m.kbReadCount}/200` },
  // ===== 笔记整理（notes）=====
  { key: 'notes10', name: '好学笔记', icon: 'note', series: 'notes', rarity: 'silver', desc: '写满 10 条笔记', progress: m => m.notesCount / 10, fmt: m => `${m.notesCount}/10` },
  { key: 'notes50', name: '笔记狂魔', icon: 'layers', series: 'notes', rarity: 'gold', desc: '写满 50 条笔记', progress: m => m.notesCount / 50, fmt: m => `${m.notesCount}/50` },
  { key: 'tags5', name: '井井有条', icon: 'tag', series: 'notes', rarity: 'bronze', desc: '使用 5 个标签', progress: m => m.tagsUsed / 5, fmt: m => `${m.tagsUsed}/5` },
  { key: 'tags15', name: '标签大师', icon: 'grid', series: 'notes', rarity: 'silver', desc: '使用 15 个标签', progress: m => m.tagsUsed / 15, fmt: m => `${m.tagsUsed}/15` },
  { key: 'notes100', name: '著作等身', icon: 'library', series: 'notes', rarity: 'platinum', desc: '写满 100 条笔记', progress: m => m.notesCount / 100, fmt: m => `${m.notesCount}/100` },
  { key: 'tags30', name: '标签艺术家', icon: 'brush', series: 'notes', rarity: 'gold', desc: '使用 30 个标签', progress: m => m.tagsUsed / 30, fmt: m => `${m.tagsUsed}/30` },
  // ===== 收藏卷宗（fav）=====
  { key: 'fav20', name: '收藏家', icon: 'heart', series: 'fav', rarity: 'silver', desc: '收藏 20 道题', progress: m => m.favCount / 20, fmt: m => `${m.favCount}/20` },
  { key: 'fav50', name: '收藏达人', icon: 'star', series: 'fav', rarity: 'gold', desc: '收藏 50 道题', progress: m => m.favCount / 50, fmt: m => `${m.favCount}/50` },
  { key: 'paper', name: '出卷人', icon: 'paper', series: 'fav', rarity: 'bronze', desc: '组卷至少 1 套', progress: m => m.papersCount / 1, fmt: m => `${Math.min(m.papersCount, 1)}/1` },
  { key: 'fav100', name: '藏书阁主', icon: 'chest', series: 'fav', rarity: 'platinum', desc: '收藏 100 道题', progress: m => m.favCount / 100, fmt: m => `${m.favCount}/100` },
  { key: 'favGroup5', name: '分类收藏家', icon: 'folder', series: 'fav', rarity: 'silver', desc: '使用 5 个收藏分组', progress: m => m.favGroups / 5, fmt: m => `${m.favGroups}/5` },
  // ===== 隐藏成就（达成才揭晓）=====
  { key: 'day50', name: '一日千里', icon: 'bolt', series: 'quiz', rarity: 'platinum', hidden: true, desc: '单日答题 50 题', progress: m => m.today / 50, fmt: m => `${Math.min(m.today, 50)}/50` },
  { key: 'active90', name: '百日攀登', icon: 'mountain', series: 'streak', rarity: 'gold', hidden: true, desc: '累计学习 90 天', progress: m => m.activeDays / 90, fmt: m => `${m.activeDays}/90` },
  { key: 'tenInRow', name: '势如破竹', icon: 'pulse', series: 'streak', rarity: 'platinum', hidden: true, desc: '连续学习 10 天', progress: m => m.streak / 10, fmt: m => `${m.streak}/10` }
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
  if (points >= 600) return { name: '白金传说', icon: 'medal', min: 600 }
  if (points >= 300) return { name: '黄金大师', icon: 'medal', min: 300 }
  if (points >= 100) return { name: '白银学者', icon: 'medal', min: 100 }
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
