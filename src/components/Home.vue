<script setup>
import Icon from './Icon.vue'
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import CountUp from './CountUp.vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { vTilt } from '../utils/tilt.js' // 统一 3D 倾斜指令（2026-08-14 去重：此前 Home 内联同逻辑）
import CardsPanel from './CardsPanel.vue'

const props = defineProps({ subject: Object, refreshKey: { default: 0 } })
const emit = defineEmits(['start', 'start-mock', 'goto', 'daily', 'quick', 'manage-cards'])

const summary = ref({ total: 0, learned: 0, mastered: 0, today: 0, wrongCount: 0, accuracy: 0, weekAccuracy: 0, weekDelta: 0, streak: 0 })
const dailyGoal = ref(0)
const loading = ref(true)
const dailyPuzzle = ref(null) // { question, state }
const dueReviews = ref(0)
const xpTotal = ref(0)
// 等级进度（门面精美③）：xpStats 的 level 曲线信息，首页渲染 Lv 徽章 + 渐变进度条
// 字段对齐：后端返回 curLevelXp(本级已得)/nextLevelXp(本级所需)/levelPct
const lvInfo = ref({ level: 1, curLevelXp: 0, nextLevelXp: 100, pct: 0 })
const examDate = ref('')
const weakPoints = ref([])
const weakAccuracy = ref([])
const dailyBrief = ref({ answered: 0, correct: 0, pct: 0, mastered: 0 }) // 昨日小结（问候卡下）

onMounted(load)
watch(() => props.subject.id, load)
watch(() => props.refreshKey, load) // 切回首页时刷新实时数据

// 首页问候语：按时段切换
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了，注意休息'
  if (h < 12) return '早上好，继续加油'
  if (h < 18) return '下午好，保持专注'
  return '晚上好，今天也在进步'
})
const todayStr = computed(() => {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]}`
})
const typeLabel = (t) => ({ single: '单选', multiple: '多选', judge: '判断', essay: '问答' }[t] || t)

// 一句话成长总结：本周正确率 + 对比 + 错题数（有数据才显示，无数据给引导）
const growthText = computed(() => {
  if (!summary.value.today && !summary.value.wrongCount) return null
  const acc = summary.value.weekAccuracy
  const delta = summary.value.weekDelta
  const parts = []
  if (summary.value.today > 0) {
    const accTxt = acc > 0 ? `${acc}%` : '—'
    parts.push(`本周正确率 ${accTxt}${delta !== 0 ? (delta > 0 ? ` · 比上周 +${delta}%` : ` · 比上周 ${delta}%`) : ''}`)
  }
  if (summary.value.wrongCount > 0) parts.push(`错题还剩 ${summary.value.wrongCount} 题`)
  return parts.join(' · ')
})

// 考试倒计时（设了考试日显示天数；没设显示引导）
const examLeft = computed(() => {
  if (!examDate.value) return null
  const target = new Date(examDate.value + 'T00:00:00')
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const days = Math.round((target - now) / 86400000)
  return { date: examDate.value, days, over: days < 0 }
})

// 今日刷题进度（目标 KPI 格）
const goalPct = computed(() => dailyGoal.value ? Math.min(100, Math.round((summary.value.today / dailyGoal.value) * 100)) : 0)
// 目标进度环弧长：157 = 2πr(25)，按完成度缩放
const ringOffset = computed(() => 157 - (157 * goalPct.value) / 100)
// 进度环动画：数据加载完成后从空环填充到目标值（精致动效）
const ringAnim = ref(false)
watch(loading, (v) => { if (!v) setTimeout(() => { ringAnim.value = true }, 80) })

// 3D 倾斜（加码 3）：行动台跟随鼠标轻微立体倾斜（perspective 6deg），离开展平
function onDockMove(e) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  const px = (e.clientX - r.left) / r.width - 0.5
  const py = (e.clientY - r.top) / r.height - 0.5
  el.style.transform = `perspective(700px) rotateY(${(px * 6).toFixed(2)}deg) rotateX(${(-py * 6).toFixed(2)}deg)`
}
function onDockLeave(e) {
  e.currentTarget.style.transform = ''
}
// 入场动画结束（riseIn fill both 会压制内联 transform）：动画完成后解除压制，3D 倾斜才生效
function onDockAnimEnd(e) {
  if (e.animationName === 'riseIn') e.currentTarget.style.animation = 'none'
}

// 目标达成爆光：进度首次到 100% 时目标环脉冲一次（回落后可再次触发）
const goalBurst = ref(false)
let goalBursted = false
watch(goalPct, (v) => {
  if (v >= 100 && !goalBursted) {
    goalBursted = true
    goalBurst.value = true
    setTimeout(() => { goalBurst.value = false }, 900)
  } else if (v < 100) {
    goalBursted = false
  }
})

// ---- 首页交互加码（2026-08-12）：倒计时 / 距差 / 预览浮层数据 ----
const hoursLeft = computed(() => 24 - new Date().getHours()) // 今天还剩几小时（复习最佳窗口）
const goalLeft = computed(() => Math.max(0, (dailyGoal.value || 0) - (summary.value.today || 0))) // 距今日目标还差
const lvGap = computed(() => Math.max(0, lvInfo.value.nextLevelXp - lvInfo.value.curLevelXp)) // 距下一级还差
const lvQues = computed(() => Math.ceil(lvGap.value / 10)) // 答对折算：每对 +10 XP → 约再刷几题
const cardMins = computed(() => Math.max(1, Math.ceil((cardStats.value.due || 0) * 0.5))) // 到期卡预计复习分钟

// H13 破纪录：历史最长连击（localStorage 持久化）
const bestStreak = ref(0)
function trackBestStreak() {
  try {
    const best = Number(localStorage.getItem('tiku_streak_best') || 0)
    const cur = summary.value.streak || 0
    bestStreak.value = Math.max(best, cur)
    if (cur > best) localStorage.setItem('tiku_streak_best', String(cur))
  } catch (e) { /* 隐私模式忽略 */ }
}
const streakGap = computed(() => Math.max(0, bestStreak.value - summary.value.streak))

// H16 复习完成反馈：对比复习前后到期数，减少则首页绿闪「复习完成」
const reviewFlash = ref(false)
let lastDue = -1
let reviewFlashTimer = null
function trackReviewDone() {
  if (lastDue >= 0 && dueReviews.value < lastDue) {
    reviewFlash.value = true
    clearTimeout(reviewFlashTimer)
    reviewFlashTimer = setTimeout(() => { reviewFlash.value = false }, 3200)
  }
  lastDue = dueReviews.value
}

// H22 时段学习建议：按当前时间 + 数据生成一条行动建议
const adviceText = computed(() => {
  const h = new Date().getHours()
  if (h < 12) return dueReviews.value > 0 ? '早上大脑清醒：先复习到期错题，再刷今日目标' : '早上大脑清醒：适合攻克记忆类内容'
  if (h < 18) return weakPoints.value.length ? `下午状态稳：攻坚薄弱点「${String(weakPoints.value[0].stem || '').slice(0, 12)}…」` : '下午状态稳：适合做整卷模拟考'
  return dueReviews.value > 0 ? '晚上收尾：把今天的新错题转成记忆卡，明天再复习' : '晚上适合整理：回顾今天的错因，标记一下为什么错'
})

// H21 番茄完成反馈：work 阶段完成时番茄条上方绿闪
const focusDoneFlash = ref(false)
let focusFlashTimer = null
function flashFocusDone() {
  focusDoneFlash.value = true
  clearTimeout(focusFlashTimer)
  focusFlashTimer = setTimeout(() => { focusDoneFlash.value = false }, 3200)
}

// 3D 倾斜指令已统一到 ../utils/tilt.js（vTilt，含重力变量与防御）

let loadSeq = 0 // 防竞态：快速切科目时旧请求晚返回，seq 不匹配则整体丢弃，避免过期数据覆盖
async function load() {
  const seq = ++loadSeq
  loading.value = true
  const sid = props.subject && props.subject.id
  const [sumR, goalR, fsR, cardsR, weakR, accR, puzzleR, dueR, xpR, exR, briefR] = await Promise.allSettled([
    tiku.getSummary(sid),
    tiku.getSetting(sid ? `daily_goal_${sid}` : 'daily_goal'),
    tiku.focusStats(),
    tiku.cardsStats({ subjectId: sid }),
    tiku.getWeakPoints(5, sid),
    tiku.getCategoryAccuracy(sid),
    tiku.getDailyPuzzle(sid),
    tiku.reviewDueStats(sid),
    tiku.xpStats(),
    tiku.getSetting(sid ? `exam_date_${sid}` : 'exam_date'),
    tiku.getDailyBrief()
  ])
  if (seq !== loadSeq) return // 已被更新的加载取代，丢弃本次结果
  summary.value = sumR.status === 'fulfilled' && sumR.value ? sumR.value : { total: 0, learned: 0, mastered: 0, today: 0, wrongCount: 0, accuracy: 0, weekAccuracy: 0, weekDelta: 0, streak: 0 }
  dailyGoal.value = goalR.status === 'fulfilled' ? Number(goalR.value) || 0 : 0
  // 科目未设目标时回退全局 daily_goal
  if (!dailyGoal.value && sid) {
    try { dailyGoal.value = Number((await tiku.getSetting('daily_goal')) || 0) } catch (e) { dailyGoal.value = 0 }
    if (seq !== loadSeq) return
  }
  if (fsR.status === 'fulfilled' && fsR.value) { focusToday.value = fsR.value.today; focusWeek.value = fsR.value.week }
  if (cardsR.status === 'fulfilled' && cardsR.value) cardStats.value = cardsR.value
  weakPoints.value = weakR.status === 'fulfilled' && Array.isArray(weakR.value) ? weakR.value : []
  weakAccuracy.value = accR.status === 'fulfilled' && Array.isArray(accR.value) ? accR.value.slice(0, 3) : []
  dailyPuzzle.value = puzzleR.status === 'fulfilled' ? puzzleR.value : null
  dueReviews.value = dueR.status === 'fulfilled' && dueR.value ? dueR.value.due || 0 : 0
  trackReviewDone() // H16 复习完成对比
  trackBestStreak() // H13 破纪录追踪
  xpTotal.value = xpR.status === 'fulfilled' && xpR.value ? (xpR.value.total || 0) : 0
  if (xpR.status === 'fulfilled' && xpR.value) {
    const x = xpR.value
    lvInfo.value = {
      level: x.level || 1,
      curLevelXp: x.curLevelXp || 0,
      nextLevelXp: x.nextLevelXp || 100,
      today: x.today || 0,
      week: x.week || 0,
      pct: x.levelPct || 0
    }
  }
  // 考试日：科目 key 优先，未设置则全局兜底
  if (exR.status === 'fulfilled') examDate.value = exR.value || ''
  if (briefR.status === 'fulfilled' && briefR.value) dailyBrief.value = briefR.value
  if (!examDate.value && sid) {
    try { examDate.value = (await tiku.getSetting('exam_date')) || '' } catch (e) { examDate.value = '' }
    if (seq !== loadSeq) return
  }
  loading.value = false
}

function startDaily() {
  if (dailyPuzzle.value && dailyPuzzle.value.question) emit('daily', dailyPuzzle.value.question)
}
// 智能复习路由：有到期 → review-due；无到期有错题 → wrong；都无 → 提示
function startSmartReview() {
  if (dueReviews.value > 0) emit('start', { mode: 'review-due' })
  else if (summary.value.wrongCount > 0) emit('start', { mode: 'wrong' })
  else showToast('当前没有到期复习和错题，去刷几道新题吧', 'ok')
}

// ---- 番茄钟 ----
const cardsOpen = ref(false)
const cardStats = ref({ total: 0, due: 0 })
const focusMinutes = ref(25)
const focusLeft = ref(0)
const focusRunning = ref(false)
const focusToday = ref(0)
const focusWeek = ref(0)
const focusPhase = ref('work')   // 'work' 25 分钟 | 'break' 5 分钟（番茄循环）
const pomodoroCount = ref(0)     // 本日完成的番茄数（会话内累计）
const paused = ref(false)
const noiseOn = ref(false)       // 白噪音开关
let focusTimer = null
let noiseCtx = null
let noiseSrc = null

const focusText = computed(() => {
  const m = Math.floor(focusLeft.value / 60)
  const s = focusLeft.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})
function startFocus() {
  if (focusRunning.value) return
  focusPhase.value = 'work'
  focusLeft.value = 25 * 60
  focusRunning.value = true
  paused.value = false
  focusTimer = setInterval(tick, 1000)
}
function tick() {
  if (paused.value) return
  focusLeft.value--
  if (focusLeft.value <= 0) phaseComplete()
}
let focusCompleting = false // 防重入：记账 await 期间 tick 再次触发
async function phaseComplete() {
  if (focusCompleting) return
  focusCompleting = true
  try {
    if (focusPhase.value === 'work') {
      pomodoroCount.value++
      flashFocusDone() // H21 番茄完成绿闪
      try {
        await tiku.addFocusSession(25)
        const fs = await tiku.focusStats()
        focusToday.value = fs.today
      } catch (e) {}
      showToast(`🍅 第 ${pomodoroCount.value} 个番茄完成，+50 XP，休息一下`, 'ok')
      focusPhase.value = 'break'
      focusLeft.value = 5 * 60
    } else {
      focusPhase.value = 'work'
      focusLeft.value = 25 * 60
      showToast(`休息结束，开始第 ${pomodoroCount.value + 1} 个番茄 💪`, 'ok')
    }
  } finally { focusCompleting = false }
}
function pauseFocus() {
  paused.value = !paused.value
}
function skipBreak() {
  if (focusPhase.value === 'break') {
    focusPhase.value = 'work'
    focusLeft.value = 25 * 60
  }
}
async function stopFocus(completed = false) {
  clearInterval(focusTimer)
  focusTimer = null
  focusRunning.value = false
  paused.value = false
  stopNoise()
  if (completed && focusPhase.value === 'work' && !focusCompleting) { // focusCompleting 防与 phaseComplete 并发双记账
    await tiku.addFocusSession(focusMinutes.value)
    const fs = await tiku.focusStats()
    focusToday.value = fs.today
  }
  focusLeft.value = 0
}
// 白噪音：Web Audio 本地生成粉噪（无需外部文件）
function startNoise() {
  if (noiseCtx) return
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    noiseCtx = new AC()
    const size = 2 * noiseCtx.sampleRate
    const buffer = noiseCtx.createBuffer(1, size, noiseCtx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < size; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02 // 一阶低通近似粉噪
      data[i] = last * 3.5
    }
    const src = noiseCtx.createBufferSource()
    src.buffer = buffer
    src.loop = true // 2 秒 buffer 循环播放，否则播完即静音
    const gain = noiseCtx.createGain()
    gain.gain.value = 0.05
    src.connect(gain).connect(noiseCtx.destination)
    src.start()
    noiseSrc = src
  } catch (e) { /* 音频不可用则静默 */ }
}
function stopNoise() {
  try { if (noiseSrc) noiseSrc.stop() } catch (e) {}
  try { if (noiseCtx) noiseCtx.close() } catch (e) {}
  noiseSrc = null
  noiseCtx = null
}
// 记忆卡复习/增删后刷新首页「到期」角标
async function onCardsUpdated() {
  try {
    const r = await tiku.cardsStats({ subjectId: props.subject.id })
    if (r) cardStats.value = r
  } catch (e) { /* 忽略 */ }
}
onBeforeUnmount(() => {
  if (focusTimer) clearInterval(focusTimer)
  stopNoise()
})
</script>

<template>
  <div class="home">
    <SkeletonCards v-if="loading" :count="3" />

    <template v-else>
      <!-- 顶部问候卡 + 一句话成长总结 -->
      <div class="card greet-card">
        <div class="greet-head">
          <span class="greet-title">{{ greeting }}</span>
          <span class="greet-date">{{ todayStr }}</span>
        </div>
        <!-- H22 时段建议：根据时间+数据生成一条行动建议 -->
        <div class="advice-line">
          <span class="adv-ico"><Icon name="target" :size="12"/></span>
          <span>{{ adviceText }}</span>
        </div>
        <!-- 等级进度条（门面③）：Lv 徽章 + 渐变 XP 进度（flat：内部 blur 光点 + 3D 透视组合易出残影） -->
        <div class="lv-bar" v-tilt="{ deg: 2, flat: true }">
          <span class="lv-badge">Lv.{{ lvInfo.level }}</span>
          <div class="lv-track">
            <div class="lv-fill" :style="{ width: lvInfo.pct + '%' }"></div>
            <span class="lv-glow" :style="{ left: 'calc(' + lvInfo.pct + '% - 6px)' }"></span>
          </div>
          <span class="lv-xp">{{ lvInfo.curLevelXp }} / {{ lvInfo.nextLevelXp }} XP</span>
          <span class="tip">距 Lv.{{ lvInfo.level + 1 }} 还差 {{ lvGap }} XP，约再刷 {{ lvQues }} 题（答对 +10）</span>
        </div>
        <!-- 昨日小结（昨日有学习记录时优先显示，替代本周总结条） -->
        <div v-if="dailyBrief.answered > 0" class="brief-bar" @click="emit('goto', 'stats')">
          <span class="growth-icon"><Icon name="check" :size="14"/></span>
          <span class="brief-text">
            昨日小结：刷题 <b>{{ dailyBrief.answered }}</b> 题 · 正确率 <b>{{ dailyBrief.pct }}%</b><template v-if="dailyBrief.mastered"> · 新增掌握 <b>{{ dailyBrief.mastered }}</b></template>
            <span class="brief-sub">今日还有 {{ dueReviews }} 题待复习 ›</span>
          </span>
        </div>
        <div v-else-if="growthText" class="growth-bar" @click="emit('goto', 'stats')">
          <span class="growth-icon"><Icon name="pulse" :size="14"/></span>
          <span class="growth-text">{{ growthText }}</span>
          <span class="growth-go">看统计 ›</span>
        </div>
        <div v-else class="growth-bar ghost">
          <span class="growth-text">开始刷题，这里会出现你的成长轨迹</span>
        </div>
      </div>

      <!-- 复习完成反馈（H16：复习回来到期数减少时短暂绿闪） -->
      <div v-if="reviewFlash" class="review-done">
        <span class="rd-ico"><Icon name="check" :size="15"/></span>
        <span>复习完成！还剩 <b>{{ dueReviews }}</b> 题待复习，明天继续巩固</span>
      </div>

      <!-- 复习到期横幅（有到期才显示；H14：到期多时红色紧迫） -->
      <div v-else-if="dueReviews > 0" class="review-banner" :class="{ urgent: dueReviews > 20 }" v-tilt="{ flat: true }" @click="startSmartReview">
        <span class="rb-ico"><Icon name="clock" :size="15"/></span>
        <div class="rb-info">
          <div class="rb-title">{{ dueReviews }} 道错题已到复习期</div>
          <div class="rb-sub">今天还剩 {{ hoursLeft }} 小时最佳复习窗口</div>
        </div>
        <span class="rb-btn">开始复习</span>
        <span class="tip">间隔记忆提醒你：现在复习效果最好</span>
      </div>

      <!-- 今日行动台：目标进度环 + 三大行动 -->
      <div class="action-dock" @mousemove="onDockMove" @mouseleave="onDockLeave" @animationend="onDockAnimEnd">
        <div class="dock-ring" :class="{ clickable: true, 'ring-burst': goalBurst }" @click="dailyGoal ? emit('goto', 'stats') : emit('goto', 'profile', 'goals')" :title="dailyGoal ? '看学习热力图' : '设置今日目标'">
          <svg viewBox="0 0 60 60" width="88" height="88">
            <circle cx="30" cy="30" r="25" fill="none" stroke="rgba(148,163,184,0.14)" stroke-width="5"/>
            <circle cx="30" cy="30" r="25" fill="none" stroke="var(--brand)" stroke-width="5" stroke-linecap="round" class="ring-anim"
              :stroke-dasharray="'157 157'" :stroke-dashoffset="ringAnim ? ringOffset : 157" transform="rotate(-90 30 30)"/>
            <!-- 外圈流光环：双光带绕进度环旋转（引导注意力到今日行动） -->
            <circle cx="30" cy="30" r="29" fill="none" stroke="var(--brand)" stroke-width="1.6" class="ring-flow" />
          </svg>
          <!-- 环中心数字：HTML 覆盖层（CountUp 滚动与环填充同步） -->
          <div class="ring-center">
            <span class="rc-num"><CountUp v-if="dailyGoal" :value="summary.today" /></span><span class="rc-total" v-if="dailyGoal">/{{ dailyGoal }}</span>
            <span class="rc-none" v-else>—</span>
          </div>
          <div class="ring-sub">{{ dailyGoal ? '完成 ' + goalPct + '%' : '点此设置目标' }}</div>
        </div>
        <div class="dock-actions">
          <div class="dock-btn review" @click="startSmartReview">
            <div><b>今日复习</b><span class="db-sub">{{ dueReviews }} 题到期 · SM-2 排期</span></div>
            <em>{{ dueReviews }}</em>
          </div>
          <div class="dock-btn daily" @click="startDaily" :class="{ disabled: !(dailyPuzzle && dailyPuzzle.question) }">
            <div><b>每日一题</b><span class="db-sub">{{ dailyPuzzle && dailyPuzzle.question ? (dailyPuzzle.state.answered ? '今天已答 · 查看解析' : '30 秒搞定 · 攒连击') : '明天再来' }}</span></div>
            <em>{{ dailyPuzzle && dailyPuzzle.state ? dailyPuzzle.state.streak : 0 }}</em>
            <!-- H20：未答→题干预览；已答→结果反馈 -->
            <span v-if="dailyPuzzle && dailyPuzzle.question && !dailyPuzzle.state.answered" class="tip tip-wide">
              {{ typeLabel(dailyPuzzle.question.type) }} · {{ (dailyPuzzle.question.stem || '').slice(0, 40) }}{{ (dailyPuzzle.question.stem || '').length > 40 ? '…' : '' }}
            </span>
            <span v-else-if="dailyPuzzle && dailyPuzzle.state.answered" class="tip">
              今天已答 · {{ dailyPuzzle.state.correct ? '答对 ✓' : '答错' }} · 连击 {{ dailyPuzzle.state.streak }} 天
            </span>
          </div>
          <div class="dock-btn quick" @click="emit('quick')">
            <div><b>3 分钟快刷</b><span class="db-sub">随机 5 题 · 随时开始</span></div>
            <span class="dock-go">开始 ›</span>
            <span class="tip">随机 5 题 · 约 3 分钟 · 计入学习统计</span>
          </div>
        </div>
      </div>

      <!-- KPI 数据条 -->
      <div class="kpi-strip" v-tilt="{ flat: true }">
        <div class="kpi-item">
          <span class="kpi-num"><CountUp :value="summary.streak" /></span>
          <span class="kpi-label">连续学习</span>
          <span class="tip">累计学习 {{ summary.activeDays }} 天<template v-if="streakGap > 0"> · 再坚持 {{ streakGap }} 天破纪录（历史最长 {{ bestStreak }} 天）</template></span>
        </div>
        <div class="kpi-sep"></div>
        <div class="kpi-item">
          <span class="kpi-num"><CountUp :value="summary.today" /><small v-if="dailyGoal"> / {{ dailyGoal }}</small></span>
          <span class="kpi-label">今日刷题{{ dailyGoal ? ' · 目标' : '' }}</span>
          <div v-if="dailyGoal" class="kpi-bar"><div class="kpi-fill" :style="{ width: goalPct + '%' }"></div></div>
          <span class="tip" v-if="dailyGoal">距今日目标还差 {{ goalLeft }} 题</span>
        </div>
        <div class="kpi-sep"></div>
        <div class="kpi-item">
          <span class="kpi-num"><CountUp :value="xpTotal" /></span>
          <span class="kpi-label">累计 XP</span>
          <span class="tip">今日 +{{ lvInfo.today }} XP · 本周 +{{ lvInfo.week }} XP</span>
        </div>
        <div class="kpi-sep"></div>
        <div class="kpi-item link" @click="emit('goto', 'stats')">
          <span class="kpi-num accent">看足迹</span>
          <span class="kpi-label">热力图</span>
          <span class="tip">打开学习热力图，回看每天的积累</span>
        </div>
      </div>

      <!-- 考试倒计时（压缩单行小条：设了考试日显示天数，没设显示引导） -->
      <div v-if="examLeft" class="exam-mini" @click="emit('goto', 'profile', 'goals')">
        <span class="em-ico"><Icon name="clock" :size="13"/></span>
        <span class="em-name">{{ examLeft.over ? '考试日已过' : '目标考试日' }} · {{ examLeft.date }}</span>
        <span class="em-num" :class="{ over: examLeft.over }">{{ examLeft.over ? '已过' : examLeft.days + ' 天' }}</span>
      </div>
      <div v-else class="exam-mini guide" @click="emit('goto', 'profile', 'goals')">
        <span class="em-ico"><Icon name="clock" :size="13"/></span>
        <span class="em-name">设置目标考试日，首页显示倒计时</span>
        <span class="em-num">去设置 ›</span>
      </div>

      <!-- 番茄完成反馈（H21） -->
      <div v-if="focusDoneFlash" class="focus-done">
        <span class="fd-ico"><Icon name="check" :size="15"/></span>
        <span>专注完成！第 {{ pomodoroCount }} 个番茄 +50 XP，休息一下</span>
      </div>

      <!-- 番茄专注（单行） -->
      <div class="card focus-bar" v-tilt="{ flat: true }">
        <span class="fb-ico"><Icon name="clock" :size="16"/></span>
        <div class="fb-info">
          <span class="fb-title">番茄专注</span>
          <span class="fb-sub">今日 {{ focusToday }} 分钟 · 已 {{ pomodoroCount }} 个番茄</span>
        </div>
        <div class="fb-ctrl">
          <span v-if="focusRunning" class="focus-time" :class="{ break: focusPhase === 'break' }">{{ focusText }}</span>
          <button v-if="!focusRunning" class="btn btn-primary" @click="startFocus">25:00 开始</button>
          <template v-else>
            <button class="btn" @click="pauseFocus">{{ paused ? '继续' : '暂停' }}</button>
            <button v-if="focusPhase === 'break'" class="btn" @click="skipBreak">跳过休息</button>
            <button class="btn" @click="stopFocus(false)">停止</button>
          </template>
        </div>
      </div>

      <!-- 更多功能（v-tilt flat：保留倾斜特效但不开 preserve-3d，grid 子格 hover 命中不偏移） -->
      <div class="card more-card" v-tilt="{ flat: true }">
        <div class="card-title">更多功能</div>
        <div class="more-grid">
          <div class="more-item" @click="emit('start', { mode: 'wrong' })">
            <span class="mi-ico wrong"><Icon name="x" :size="16"/></span>
            <span class="mi-main">错题本</span>
            <span class="mi-count">{{ summary.wrongCount }} 题</span>
            <span class="tip">待复习 {{ summary.wrongCount }} 题 · 已掌握 {{ summary.mastered }} · 今日到期 {{ dueReviews }}</span>
          </div>
          <div class="more-item" @click="emit('start', { mode: 'favorite' })">
            <span class="mi-ico fav"><Icon name="star" :size="16"/></span>
            <span class="mi-main">收藏复习</span>
          </div>
          <div class="more-item" @click="emit('start', { mode: 'practice' })">
            <span class="mi-ico all"><Icon name="book" :size="16"/></span>
            <span class="mi-main">全部刷题</span>
          </div>
          <div class="more-item" @click="emit('goto', 'kb')">
            <span class="mi-ico kb"><Icon name="doc" :size="16"/></span>
            <span class="mi-main">知识库</span>
          </div>
          <div class="more-item" @click="emit('start-mock')">
            <span class="mi-ico exam"><Icon name="clock" :size="16"/></span>
            <span class="mi-main">模拟考试</span>
          </div>
          <div class="more-item" @click="cardsOpen = true">
            <span class="mi-ico cards"><Icon name="bookmark" :size="16"/></span>
            <span class="mi-main">记忆卡</span>
            <span v-if="cardStats.due > 0" class="mi-count due">{{ cardStats.due }} 到期</span>
            <span class="tip" v-if="cardStats.due > 0">{{ cardStats.due }} 张到期，预计 {{ cardMins }} 分钟复习完，别让卡堆积</span>
          </div>
        </div>
      </div>

      <!-- 薄弱点（沉底：不占首屏，有数据才显示） -->
      <div v-if="weakPoints.length || weakAccuracy.length" class="card weak-card" v-tilt="{ flat: true }">
        <div class="card-title"><Icon name="info" :size="14"/> 待攻克薄弱点</div>
        <div v-if="weakPoints.length" class="weak-list">
          <div v-for="w in weakPoints" :key="w.id" class="weak-item" @click="emit('goto', 'bank')">
            <span class="weak-stem">{{ w.stem || '（空题干）' }}</span>
            <span class="weak-meta">
              <span class="weak-tag" v-if="w.cat">{{ w.cat }}</span>
              <span class="weak-count">错 {{ w.wrong_count }} 次</span>
            </span>
          </div>
        </div>
        <div v-if="weakAccuracy.length" class="weak-cats">
          <div v-for="a in weakAccuracy" :key="a.cat" class="weak-cat">
            <span class="weak-cat-name">{{ a.cat }}</span>
            <span class="weak-cat-rate" :class="{ low: a.rate < 60 }">正确率 {{ a.rate }}%</span>
          </div>
        </div>
      </div>

      <CardsPanel :show="cardsOpen" :subject="props.subject" @close="cardsOpen = false" @updated="onCardsUpdated" @manage="cardsOpen = false; emit('manage-cards')" />
    </template>
  </div>
</template>

<style scoped>
.home { display: flex; flex-direction: column; gap: 14px; }
/* 目标达成爆光：环外光晕扩散 + 轻微放大（一次性） */
.dock-ring.ring-burst { animation: ringBurst .8s ease-out; }
@keyframes ringBurst {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand) 45%, transparent); transform: scale(1); }
  100% { box-shadow: 0 0 0 22px transparent; transform: scale(1.04); }
}

/* 问候卡 + 成长总结 */
.greet-card { padding: 16px; }
.greet-head { display: flex; align-items: baseline; justify-content: space-between; }
.greet-title { font-size: 17px; font-weight: 600; color: var(--text); }
.greet-date { font-size: 12px; color: var(--muted); }
.growth-bar {
  display: flex; align-items: center; gap: 8px;
  margin-top: 12px; padding: 10px 12px;
  background: color-mix(in srgb, var(--brand) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand) 35%, transparent);
  border-radius: 10px; cursor: pointer; transition: all .15s;
}
/* 昨日小结条 */
.brief-bar {
  display: flex; align-items: center; gap: 8px;
  margin-top: 12px; padding: 10px 12px;
  background: rgba(47, 191, 143, 0.08);
  border: 1px solid rgba(47, 191, 143, 0.3);
  border-radius: 10px; cursor: pointer; transition: all .15s;
}
.brief-bar:hover { box-shadow: var(--glow-soft); }
.brief-text { font-size: 12.5px; color: var(--ok-soft); }
.brief-text b { color: var(--ok); font-weight: 600; }
.brief-sub { color: var(--muted); margin-left: 6px; }
.growth-bar:hover { border-color: var(--brand); }
.growth-bar.ghost { background: transparent; border-style: dashed; cursor: default; }
.growth-icon { color: var(--brand); flex-shrink: 0; }
.growth-text { flex: 1; font-size: 13px; color: var(--text); line-height: 1.5; }
.growth-go { font-size: 12px; color: var(--brand); white-space: nowrap; }

/* 考试倒计时（压缩单行小条：不占首屏主位） */
.exam-mini {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255, 184, 77, 0.06);
  border: 1px solid rgba(255, 184, 77, 0.28);
  border-radius: 10px; padding: 7px 12px; cursor: pointer; transition: all .15s;
}
.exam-mini:hover { border-color: var(--warn); }
.exam-mini.guide { border-style: dashed; }
.em-ico { color: var(--warn); display: flex; flex-shrink: 0; }
.em-name { flex: 1; min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.em-num { font-size: 13px; font-weight: 600; color: var(--warn); flex-shrink: 0; }
.em-num.over { color: var(--muted); }
.exam-mini.guide .em-num { color: var(--brand); }

/* 主行动区 */
/* 复习到期横幅 */
.review-banner {
  display: flex; align-items: center; gap: 10px;
  background: rgba(217, 154, 61, 0.10);
  border: 1px solid rgba(217, 154, 61, 0.45);
  border-radius: 12px; padding: 12px 14px; cursor: pointer; transition: all .15s;
}
.review-banner:hover { box-shadow: var(--glow-soft); }
.rb-ico { color: var(--warn); flex-shrink: 0; display: flex; }
.rb-info { flex: 1; min-width: 0; }
.rb-title { font-size: 14px; font-weight: 600; color: var(--warn-soft); }
.rb-sub { font-size: 12px; color: var(--muted); }
.rb-btn { flex-shrink: 0; background: var(--warn); color: #1a160e; border-radius: 9px; padding: 7px 14px; font-size: 13px; font-weight: 600; }

/* 今日行动台：目标进度环 + 三大行动（不用 preserve-3d：3D 上下文会让内部可点击按钮命中偏移） */
.action-dock { display: flex; gap: 14px; transition: transform .25s cubic-bezier(.2, .7, .3, 1); will-change: transform; }
.dock-ring {
  flex: 0 0 108px; min-width: 108px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 6px;
}
.dock-ring.clickable { cursor: pointer; }
.dock-ring.clickable:hover { border-color: var(--brand); }
/* 外圈流光环：双光带绕进度环旋转（transform-box 必须 fill-box） */
.ring-flow {
  transform-box: fill-box; transform-origin: center;
  stroke-dasharray: 24 158 24 158;
  opacity: .55;
  animation: ringFlowSpin 3.6s linear infinite;
}
@keyframes ringFlowSpin { to { transform: rotate(360deg); } }
.ring-sub { font-size: 11px; color: var(--muted); margin-top: 6px; }
.dock-actions { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.dock-btn {
  flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 12px 14px; border-radius: 12px; cursor: pointer; transition: all .15s;
}
.dock-btn:hover { transform: translateY(-2px); }
.dock-btn b { font-size: 15px; font-weight: 600; display: block; }
.db-sub { display: block; margin-top: 3px; font-size: 12px; color: var(--muted); }
.dock-btn em { font-style: normal; font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.dock-btn.review { background: color-mix(in srgb, var(--brand) 14%, transparent); border: 1px solid color-mix(in srgb, var(--brand) 40%, transparent); }
.dock-btn.review:hover { box-shadow: var(--glow-soft); }
.dock-btn.review b { color: var(--brand-soft); }
.dock-btn.review em { color: var(--brand); }
.dock-btn.daily { background: rgba(47, 191, 143, 0.10); border: 1px solid rgba(47, 191, 143, 0.35); }
.dock-btn.daily:hover { box-shadow: var(--glow-soft); }
.dock-btn.daily b { color: var(--ok); }
.dock-btn.daily em { color: var(--ok); }
.dock-btn.daily.disabled { opacity: .55; cursor: default; }
.dock-btn.quick { background: var(--card); border: 1px dashed rgba(148, 163, 184, 0.3); }
.dock-btn.quick:hover { border-style: solid; border-color: var(--brand); box-shadow: var(--glow-soft); }
.dock-go { font-size: 12px !important; color: var(--muted); }

/* KPI 数据条 */
.kpi-strip {
  display: flex; align-items: stretch; gap: 0;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 8px;
}
.kpi-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
.kpi-item.link { cursor: pointer; }
.kpi-sep { width: 1px; background: var(--line); margin: 4px 6px; }
.kpi-num {
  font-size: 20px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums;
  background-image: linear-gradient(100deg, transparent 42%, color-mix(in srgb, var(--text) 28%, transparent) 50%, transparent 58%), var(--num-grad);
  background-size: 220% 100%, 100% 100%;
  background-position: 120% 0, 0 0;
  background-clip: text; -webkit-background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: numSweep 6s ease-in-out infinite;
}
@keyframes numSweep {
  0%, 55% { background-position: 120% 0, 0 0; }
  85%, 100% { background-position: -40% 0, 0 0; }
}
.kpi-num small { font-size: 12px; color: var(--muted); font-weight: 400; background: none; -webkit-text-fill-color: var(--muted); }
.kpi-num.accent { background: none; color: var(--brand); font-size: 15px; -webkit-text-fill-color: var(--brand); }
.kpi-label { font-size: 11px; color: var(--muted); }
.kpi-bar { height: 4px; border-radius: 2px; background: var(--line); width: 70%; margin-top: 4px; overflow: hidden; }
/* 方案二：进度条高光点流动 */
.kpi-fill { height: 100%; border-radius: 2px; background: var(--brand); transition: width .4s; position: relative; overflow: hidden; }
.kpi-fill::after {
  content: '';
  position: absolute; top: 0; bottom: 0; width: 26%;
  left: -30%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.65), transparent);
  animation: barShine 2.8s ease-in-out infinite;
}
@keyframes barShine {
  0% { left: -30%; }
  55%, 100% { left: 115%; }
}

/* 薄弱点 */
.weak-card { display: flex; flex-direction: column; gap: 10px; }
.weak-list { display: flex; flex-direction: column; gap: 8px; }
.weak-item {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
  cursor: pointer; transition: all .15s;
}
.weak-item:hover { border-color: var(--bad); background: rgba(255, 77, 109, 0.06); }
.weak-stem { flex: 1; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weak-meta { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.weak-tag { font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 1px 5px; }
.weak-count { font-size: 11px; color: var(--bad); }
.weak-cats { display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--line); padding-top: 8px; }
.weak-cat { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.weak-cat-name { color: var(--text); }
.weak-cat-rate { color: var(--muted); }
.weak-cat-rate.low { color: var(--bad); font-weight: 600; }

/* 番茄专注单行 */
.focus-bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.fb-ico { width: 26px; height: 26px; border-radius: 50%; background: rgba(255, 184, 77, 0.15); color: var(--warn); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.fb-info { flex: 1; min-width: 0; }
.fb-title { font-size: 13px; color: var(--text); }
.fb-sub { font-size: 12px; color: var(--muted); margin-left: 8px; }
.fb-ctrl { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.focus-time { font-size: 18px; font-weight: 600; color: var(--brand); font-variant-numeric: tabular-nums; }
.focus-time.break { color: var(--warn); }

/* 更多功能 */
.more-card { padding: 12px 16px; }
.more-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
.more-item {
  display: flex; align-items: center; gap: 10px;
  padding: 12px; border: 1px solid var(--line); border-radius: 12px;
  cursor: pointer; transition: all .15s; background: rgba(148, 163, 184, 0.05);
}
.more-item:hover { border-color: var(--brand); box-shadow: var(--glow-soft); }
.mi-ico { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.mi-ico.wrong { background: rgba(255, 77, 109, 0.14); color: var(--bad); }
.mi-ico.fav { background: rgba(244, 114, 182, 0.14); color: var(--bad-soft); }
.mi-ico.all { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.mi-ico.kb { background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); }
.mi-ico.exam { background: rgba(56, 189, 248, 0.14); color: var(--brand-soft); }
.mi-ico.cards { background: rgba(167, 139, 250, 0.14); color: var(--brand-soft); }
.mi-main { flex: 1; font-size: 13px; color: var(--text); }
.mi-count { font-size: 11px; color: var(--muted); }
.mi-count.due { color: var(--warn); font-weight: 600; }

/* ===== 精致化（2026-08-12）：入场 stagger / 问候渐变 / 环动画 / 宫格 hover ===== */
/* 卡片依次浮入（非 .card 元素如 action-dock/kpi-strip 也覆盖） */
.home > * { animation: riseIn .4s cubic-bezier(.2, .7, .3, 1) both; }
.home > *:nth-child(1) { animation-delay: .02s; }
.home > *:nth-child(2) { animation-delay: .06s; }
.home > *:nth-child(3) { animation-delay: .10s; }
.home > *:nth-child(4) { animation-delay: .14s; }
.home > *:nth-child(5) { animation-delay: .18s; }
.home > *:nth-child(6) { animation-delay: .22s; }
.home > *:nth-child(7) { animation-delay: .26s; }
.home > *:nth-child(8) { animation-delay: .30s; }

/* 问候卡：靛蓝渐变打底 + 品牌描边（门面质感） */
.greet-card {
  background: linear-gradient(160deg, color-mix(in srgb, var(--brand) 12%, transparent), var(--card) 55%);
  border-color: color-mix(in srgb, var(--brand) 35%, transparent);
}

/* 目标进度环：从空环填充到目标值 */
.ring-anim { transition: stroke-dashoffset 1s cubic-bezier(.3, .7, .3, 1); }

/* 更多宫格：hover 抬升 + 亮底（整格响应，文字/图标/计数同步反馈，避免只有图标左侧在动） */
.more-item { transition: transform .15s ease, background .15s ease, box-shadow .15s ease, border-color .15s ease; }
.more-item:hover {
  transform: translateY(-2px);
  background: color-mix(in srgb, var(--brand) 12%, transparent);
  border-color: color-mix(in srgb, var(--brand) 55%, transparent);
  box-shadow: var(--glow-soft);
}
.more-item:hover .mi-main { color: var(--brand); }
.more-item:hover .mi-count { color: var(--brand-soft); }

/* ===== 首页审查精修（2026-08-12）：hover 质感统一 + 图标对齐 ===== */
/* 进度环卡：无论是否可点，统一 hover 抬升亮边 */
.dock-ring { transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
.dock-ring:hover { transform: translateY(-2px); box-shadow: var(--glow-soft); border-color: color-mix(in srgb, var(--brand) 40%, transparent); }

/* KPI 条 hover 微亮（只增质感，不暗示可点） */
.kpi-strip { transition: box-shadow .18s ease; }
.kpi-strip:hover { box-shadow: var(--glow-soft); }

/* 番茄条 hover 抬升 */
.focus-bar { transition: transform .18s ease, box-shadow .18s ease; }
.focus-bar:hover { transform: translateY(-2px); box-shadow: var(--glow-soft); }

/* 薄弱点行 hover 亮底 */
.weak-item { transition: background .15s ease; border-radius: 8px; }
.weak-item:hover { background: color-mix(in srgb, var(--brand) 8%, transparent); }
/* 薄弱点卡标题：Icon 与文字垂直居中 */
.weak-card .card-title { display: flex; align-items: center; gap: 6px; }

/* 成长/小结条 hover 微抬 */
.growth-bar, .brief-bar { transform: translateY(0); }
.growth-bar:hover, .brief-bar:hover { transform: translateY(-1px); box-shadow: var(--glow-soft); }

/* 快刷 hover：箭头转品牌色 */
.dock-btn.quick:hover .dock-go { color: var(--brand); }

/* ===== 首页加码（2026-08-12）：呼吸召唤 / 数字滚动 / 图标微弹 / 双层节奏 ===== */
/* ① 到期横幅：伪元素呼吸光晕（不抢主元素入场动画） */
.review-banner { position: relative; }
.review-banner::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  border: 1px solid rgba(217, 154, 61, 0.5);
  animation: bannerPulse 2.4s ease-in-out infinite; pointer-events: none;
}
@keyframes bannerPulse { 0%, 100% { opacity: .15; } 50% { opacity: .9; } }

/* ② KPI 进度条：从 0 填充（配合数字滚动） */
.kpi-fill { animation: fillBar .9s cubic-bezier(.3, .7, .3, 1) both; }
@keyframes fillBar { from { width: 0; } }

/* ③ 宫格图标：hover 微弹 */
.mi-ico { transition: transform .18s cubic-bezier(.3, .7, .3, 1); }
.more-item:hover .mi-ico { transform: translateY(-2px) scale(1.08); }

/* ④ 行动按钮：父卡入场后逐个弹出（双层节奏） */
.dock-actions > * { animation: riseIn .38s cubic-bezier(.2, .7, .3, 1) both; }
.dock-actions > *:nth-child(1) { animation-delay: .10s; }
.dock-actions > *:nth-child(2) { animation-delay: .15s; }
.dock-actions > *:nth-child(3) { animation-delay: .20s; }

/* ⑤ 问候卡：更浓渐变 + 顶部高光线 */
.greet-card {
  background: linear-gradient(160deg, color-mix(in srgb, var(--brand) 16%, transparent), var(--card) 60%);
  border-color: color-mix(in srgb, var(--brand) 45%, transparent);
  position: relative; overflow: hidden;
}
.greet-card::before {
  content: ''; position: absolute; top: 0; left: 10%; right: 10%;
  height: 1px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--brand) 65%, transparent), transparent);
}

/* ⑥ 日期胶囊化 */
.greet-date {
  font-size: 11px; color: var(--muted);
  background: rgba(148, 163, 184, 0.1); border: 1px solid var(--line);
  border-radius: 999px; padding: 3px 10px;
}

/* ⑦ 看足迹 hover 加深 */
.kpi-item.link:hover .kpi-num { color: var(--brand-dark); }
.kpi-item.link:hover .kpi-label { color: var(--brand); }

/* ===== 加码 2（2026-08-12）：数字弹入 / hover 彩色光晕描边 ===== */
/* KPI 数字：加载弹入（scale .85 → 1） */
.kpi-num { animation: numPop .45s cubic-bezier(.2, .7, .3, 1) both; }
@keyframes numPop { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }

/* 行动按钮 hover：彩色光晕描边（品牌色晕 + 1px 亮边，质感拉满） */
.dock-btn.review:hover { box-shadow: 0 6px 22px color-mix(in srgb, var(--brand) 35%, transparent), 0 0 0 1px color-mix(in srgb, var(--brand) 50%, transparent); }
.dock-btn.daily:hover { box-shadow: 0 6px 22px rgba(47, 191, 143, 0.28), 0 0 0 1px rgba(47, 191, 143, 0.45); }
.dock-btn.quick:hover { box-shadow: 0 6px 22px color-mix(in srgb, var(--brand) 30%, transparent), 0 0 0 1px color-mix(in srgb, var(--brand) 40%, transparent); }
.more-item:hover { box-shadow: var(--glow-soft), 0 0 0 1px color-mix(in srgb, var(--brand) 30%, transparent); }

/* ===== 实验：hover 流光描边（2026-08-12，用户好奇项，不合适可回退）===== */
/* @property --ang 已移 style.css 全局注册 */
.dock-btn { position: relative; }
.dock-btn::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  padding: 1px;
  background: conic-gradient(from var(--ang), transparent 0deg, color-mix(in srgb, var(--brand) 85%, transparent) 80deg, transparent 170deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0; pointer-events: none; transition: opacity .18s;
}
.dock-btn:hover::after { opacity: 1; animation: angSpin 2.2s linear infinite; }
@keyframes angSpin { to { --ang: 360deg; } }

/* 更多宫格也挂流光（复用 --ang，hover 光点绕边框转） */
.more-item { position: relative; }
.more-item::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  padding: 1px;
  background: conic-gradient(from var(--ang), transparent 0deg, color-mix(in srgb, var(--brand) 70%, transparent) 80deg, transparent 170deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0; pointer-events: none; transition: opacity .18s;
}
.more-item:hover::after { opacity: 1; animation: angSpin 2.2s linear infinite; }

/* ===== 门面 10 件套（2026-08-12 全上）===== */
/* ① 问候语渐变文字（靛蓝→紫） */
.greet-title {
  background: linear-gradient(90deg, #93b1ff, #c3a8ff);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}

/* ② 问候卡装饰波纹（右上同心圆环，overflow hidden 裁切；缓慢波纹呼吸：scale + opacity 合成动画） */
.greet-card::after {
  content: ''; position: absolute; top: -42px; right: -34px;
  width: 150px; height: 150px; border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--brand) 20%, transparent);
  box-shadow: 0 0 0 14px color-mix(in srgb, var(--brand) 6%, transparent), 0 0 0 30px color-mix(in srgb, var(--brand) 4%, transparent);
  pointer-events: none;
  animation: greetRing 5.5s ease-in-out infinite;
}
@keyframes greetRing {
  0%, 100% { transform: scale(1); opacity: .72; }
  50% { transform: scale(1.14); opacity: 1; }
}

/* ③ 等级进度条：Lv 徽章 + 渐变 XP 进度 + 尽头光点 */
.lv-bar { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.lv-badge {
  flex-shrink: 0; font-size: 11px; font-weight: 600;
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 25%, transparent), color-mix(in srgb, var(--brand2) 20%, transparent));
  border: 1px solid color-mix(in srgb, var(--brand) 45%, transparent); color: var(--tip-text);
  border-radius: 999px; padding: 2px 9px;
}
.lv-track { flex: 1; height: 6px; border-radius: 3px; background: rgba(148, 163, 184, 0.14); overflow: hidden; position: relative; }
.lv-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--brand), var(--brand2)); animation: fillBar .9s cubic-bezier(.3, .7, .3, 1) both; }
.lv-glow { position: absolute; top: 0; bottom: 0; width: 12px; border-radius: 3px; background: rgba(255, 255, 255, 0.55); filter: blur(3px); pointer-events: none; }
.lv-xp { font-size: 11px; color: var(--muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }

/* ④ KPI 大数字渐变光泽（small 保持 muted，看足迹保持品牌渐变；三主题由 --num-grad 统一） */
.kpi-num {
  background: var(--num-grad);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}
.kpi-num small { -webkit-text-fill-color: var(--muted); }
.kpi-num.accent { background: linear-gradient(90deg, var(--brand), var(--brand2)); -webkit-background-clip: text; background-clip: text; }

/* ⑤ 渐变边框：问候卡 / 进度环卡（双背景 border-box 技巧） */
.greet-card {
  border: 1px solid transparent;
  background-image:
    linear-gradient(160deg, color-mix(in srgb, var(--brand) 16%, transparent), var(--card) 60%),
    linear-gradient(135deg, color-mix(in srgb, var(--brand) 55%, transparent), color-mix(in srgb, var(--brand2) 55%, transparent));
  background-origin: border-box;
  background-clip: padding-box, border-box;
}
.dock-ring {
  border: 1px solid transparent;
  background-image:
    linear-gradient(var(--card), var(--card)),
    linear-gradient(135deg, color-mix(in srgb, var(--brand) 45%, transparent), color-mix(in srgb, var(--brand2) 45%, transparent));
  background-origin: border-box;
  background-clip: padding-box, border-box;
  position: relative;
}

/* ⑥ 宫格图标 hover：渐变底（品牌紫蓝统一语言） */
.mi-ico { transition: transform .18s cubic-bezier(.3, .7, .3, 1), background .18s ease; }
.more-item:hover .mi-ico { background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 30%, transparent), color-mix(in srgb, var(--brand2) 20%, transparent)); }

/* ⑧ 环中心数字：HTML 覆盖层（CountUp 滚动与环填充同步） */
.ring-center {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding-bottom: 12px; pointer-events: none;
}
.rc-num { font-size: 16px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.rc-total { font-size: 11px; color: var(--muted); margin-left: 2px; }
.rc-none { font-size: 15px; color: var(--muted); }

/* ⑨ KPI 分隔线渐变（中间亮两端透明） */
.kpi-sep { background: linear-gradient(180deg, transparent, rgba(148, 163, 184, 0.35), transparent); }

/* 浅色主题：渐变文字换深色系（KPI 渐变由 --num-grad 语义变量统一） */
[data-theme="light"] .greet-title { background: linear-gradient(90deg, #3d5bd9, #7c3aed); -webkit-background-clip: text; background-clip: text; }
[data-theme="light"] .lv-badge { color: #3d5bd9; }
/* 护眼绿主题：与浅色同源（绿色调） */
[data-theme="eye"] .greet-title { background: linear-gradient(90deg, #2e6649, #4d8f6e); -webkit-background-clip: text; background-clip: text; }
[data-theme="eye"] .lv-badge { color: #3a7d5a; }

/* ===== 首页交互加码（2026-08-12）：统一 hover 浮层 + 按压反馈 ===== */
/* 浮层基座：暗卡 + 三角箭头，hover 显示（各触发容器须 position:relative） */
.tip {
  position: absolute; bottom: calc(100% + 10px); left: 50%;
  transform: translateX(-50%) translateY(3px);
  background: var(--tip-bg); border: 1px solid color-mix(in srgb, var(--brand) 35%, transparent);
  border-radius: 8px; padding: 6px 11px;
  font-size: 11.5px; color: var(--tip-text); white-space: nowrap; line-height: 1.5;
  opacity: 0; pointer-events: none; z-index: 40;
  transition: opacity .16s ease, transform .16s ease;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.tip::after {
  content: ''; position: absolute; top: 100%; left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent; border-top-color: var(--tip-bg);
}
.tip-wide { white-space: normal; max-width: 220px; text-align: left; }

/* 触发容器：relative + hover 显示浮层 */
.review-banner, .lv-bar, .kpi-item, .dock-btn.daily, .dock-btn.quick, .more-item { position: relative; }
.review-banner:hover .tip, .lv-bar:hover .tip, .kpi-item:hover .tip,
.dock-btn.daily:hover .tip, .dock-btn.quick:hover .tip, .more-item:hover .tip {
  opacity: 1; transform: translateX(-50%) translateY(0);
}

/* 按压反馈：brightness（不冲突 tilt 的内联 transform） */
.review-banner:active, .dock-btn:active, .more-item:active, .kpi-item.link:active { filter: brightness(.9); }


/* H14 到期紧迫升级：>20 题横幅转红 */
.review-banner.urgent {
  background: rgba(229, 83, 95, 0.10);
  border-color: rgba(229, 83, 95, 0.5);
}
.review-banner.urgent .rb-title { color: var(--bad-soft); }
.review-banner.urgent .rb-btn { background: var(--bad); }
.review-banner.urgent::after { border-color: rgba(229, 83, 95, 0.5); }

/* H16 复习完成绿闪条 */
.review-done {
  display: flex; align-items: center; gap: 10px;
  background: rgba(47, 191, 143, 0.10);
  border: 1px solid rgba(47, 191, 143, 0.45);
  border-radius: 12px; padding: 12px 14px;
  font-size: 13.5px; color: var(--ok-soft);
  animation: riseIn .35s cubic-bezier(.2, .7, .3, 1) both;
}
.review-done .rd-ico { color: var(--ok); display: flex; }
.review-done b { color: var(--ok-soft); }


/* H20/H21/H22 样式：建议行 / 番茄完成闪条 */
.advice-line {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px; font-size: 11.5px; color: var(--muted);
}
.adv-ico { color: var(--brand); display: flex; flex-shrink: 0; }

.focus-done {
  display: flex; align-items: center; gap: 10px;
  background: rgba(47, 191, 143, 0.10);
  border: 1px solid rgba(47, 191, 143, 0.45);
  border-radius: 12px; padding: 12px 14px;
  font-size: 13.5px; color: var(--ok-soft);
  animation: riseIn .35s cubic-bezier(.2, .7, .3, 1) both;
}
.focus-done .fd-ico { color: var(--ok); display: flex; }

</style>