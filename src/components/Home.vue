<script setup>
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { tiku } from '../api/tiku.js'
import ReviewPanel from './ReviewPanel.vue'

const props = defineProps({ subject: Object })
const emit = defineEmits(['start', 'start-mock'])

const summary = ref({ total: 0, learned: 0, mastered: 0, today: 0, wrongCount: 0 })
const dailyGoal = ref(0)
const loading = ref(true)

onMounted(load)
watch(() => props.subject.id, load)

const goalPct = computed(() => dailyGoal.value ? Math.min(100, Math.round((summary.value.today / dailyGoal.value) * 100)) : 0)

// 每日任务 Quest + 习惯打卡 + 每日回顾 + 番茄钟
const tasks = ref([])
const habits = ref([])
const questClaimed = ref('')
const reviewOpen = ref(false)
const focusMinutes = ref(25)
const focusLeft = ref(0)
const focusRunning = ref(false)
const focusToday = ref(0)
let focusTimer = null

async function load() {
  loading.value = true
  summary.value = await tiku.getSummary()
  try { dailyGoal.value = Number(await tiku.getSetting('daily_goal')) || 0 } catch (e) { dailyGoal.value = 0 }
  try {
    const q = await tiku.checkQuests()
    tasks.value = q.tasks
    questClaimed.value = q.claimed.join('、')
  } catch (e) { /* 任务失败不阻塞 */ }
  try { habits.value = await tiku.listHabits() } catch (e) { habits.value = [] }
  try { const fs = await tiku.focusStats(); focusToday.value = fs.today } catch (e) { focusToday.value = 0 }
  loading.value = false
}

async function toggleHabit(h) {
  if (h.checkedToday) await tiku.uncheckHabit(h.id)
  else await tiku.checkHabit(h.id)
  habits.value = await tiku.listHabits()
}

function onTaskClick(t) {
  if (t.key === 'quiz20') emit('start', { mode: 'practice' })
  else if (t.key === 'review5') reviewOpen.value = true
  else alert('去「知识库」Tab 打开任意一篇文档阅读，即算完成')
}

// 番茄钟
const focusText = computed(() => {
  const m = Math.floor(focusLeft.value / 60)
  const s = focusLeft.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})
function startFocus() {
  if (focusRunning.value) return
  focusLeft.value = focusMinutes.value * 60
  focusRunning.value = true
  focusTimer = setInterval(() => {
    focusLeft.value--
    if (focusLeft.value <= 0) stopFocus(true)
  }, 1000)
}
async function stopFocus(completed = false) {
  clearInterval(focusTimer)
  focusTimer = null
  focusRunning.value = false
  if (completed) {
    await tiku.addFocusSession(focusMinutes.value)
    const fs = await tiku.focusStats()
    focusToday.value = fs.today
  }
  focusLeft.value = 0
}
onBeforeUnmount(() => { if (focusTimer) clearInterval(focusTimer) })
</script>

<template>
  <div class="home">
    <!-- 欢迎卡片 -->
    <div class="card welcome">
      <div class="welcome-text">
        <div class="subtitle">基于艾宾浩斯记忆曲线，科学记忆，高效备考</div>
        <h1>欢迎来到<br>知识记忆小助手</h1>
        <button class="btn btn-primary" @click="$emit('start', { mode: 'practice' })">立即开始</button>
      </div>
      <div class="welcome-illustration">
        <svg viewBox="0 0 120 100" width="110" height="92">
          <rect x="10" y="40" width="70" height="50" rx="8" fill="#0a1a26" stroke="#1c6f7d" stroke-width="1.5" />
          <rect x="25" y="25" width="70" height="50" rx="8" fill="#150f33" stroke="#7b46c4" stroke-width="1.5" />
          <rect x="40" y="10" width="70" height="50" rx="8" fill="#0c2230" stroke="#2af5ff" stroke-width="2" />
          <circle cx="95" cy="25" r="14" fill="none" stroke="#2af5ff" stroke-width="1.5" opacity="0.7" />
          <path d="M95 11 L98 21 L108 21 L100 27 L103 37 L95 31 L87 37 L90 27 L82 21 L92 21 Z" fill="#2af5ff" />
        </svg>
      </div>
    </div>

    <!-- 总数卡片 -->
    <div class="card stat-card">
      <div class="stat-title">知识卡片总数</div>
      <div class="stat-number">
        <span class="num">{{ summary.total }}</span>
        <span class="unit">张</span>
      </div>
    </div>

    <!-- 今日目标进度 -->
    <div class="card goal-card" v-if="dailyGoal">
      <div class="goal-top">
        <span class="goal-label">🎯 今日目标</span>
        <span class="goal-num">{{ Math.min(summary.today, dailyGoal) }} / {{ dailyGoal }} 题</span>
      </div>
      <div class="goal-bar"><div class="goal-fill" :style="{ width: goalPct + '%' }"></div></div>
      <div class="goal-sub">{{ goalPct >= 100 ? '🎉 今日目标已达成！' : '还差 ' + Math.max(0, dailyGoal - summary.today) + ' 题，去刷几道吧' }}</div>
    </div>

    <!-- 每日任务 Quest -->
    <div class="card quest-card">
      <div class="card-title">📋 每日任务 <span class="quest-xp">每个 +20 XP</span></div>
      <div v-if="questClaimed" class="quest-claimed">🎉 {{ questClaimed }} 已完成，XP 已到账</div>
      <div class="quest-list">
        <div v-for="t in tasks" :key="t.key" class="quest-item" :class="{ done: t.done }" @click="onTaskClick(t)">
          <span class="quest-check">{{ t.done ? '✓' : '○' }}</span>
          <span class="quest-name">{{ t.name }}</span>
          <span class="quest-state">{{ t.done ? '已完成' : '去做' }}</span>
        </div>
      </div>
    </div>

    <!-- 习惯打卡 -->
    <div v-if="habits.length" class="card habit-card">
      <div class="card-title">🔁 我的习惯 <span class="quest-xp">今日打卡</span></div>
      <div class="habit-list">
        <div v-for="h in habits" :key="h.id" class="habit-item" :class="{ done: h.checkedToday }" @click="toggleHabit(h)">
          <span class="habit-icon">{{ h.icon }}</span>
          <span class="habit-name">{{ h.name }}</span>
          <span class="habit-streak">🔥 {{ h.streak }} 天</span>
          <span class="habit-check">{{ h.checkedToday ? '✓' : '○' }}</span>
        </div>
      </div>
    </div>

    <!-- 每日回顾 + 专注 -->
    <div class="card duo-card">
      <div class="duo-row">
        <div class="duo-left" @click="reviewOpen = true">
          <span class="duo-title">🧠 每日回顾</span>
          <span class="duo-sub">主动回忆 · 对抗遗忘</span>
        </div>
        <div class="duo-right">
          <span class="duo-title">⏱ 专注 {{ focusMinutes }} 分钟</span>
          <div class="focus-ctrl">
            <span v-if="focusRunning" class="focus-time">{{ focusText }}</span>
            <button v-if="!focusRunning" class="btn btn-primary" @click="startFocus">开始</button>
            <button v-else class="btn" @click="stopFocus(false)">停止</button>
          </div>
          <span class="duo-sub">今日已专注 {{ focusToday }} 分钟</span>
        </div>
      </div>
    </div>

    <!-- 快捷入口 -->
    <div class="card shortcuts">
      <div class="card-title">知识卡片预览</div>
      <div class="shortcut-grid">
        <div class="shortcut" @click="$emit('start', { mode: 'wrong' })">
          <div class="s-icon wrong">✗</div>
          <div class="s-label">错题本</div>
          <div class="s-count">{{ summary.wrongCount }} 题</div>
        </div>
        <div class="shortcut" @click="$emit('start', { mode: 'favorite' })">
          <div class="s-icon fav">★</div>
          <div class="s-label">我的收藏</div>
          <div class="s-count">去复习</div>
        </div>
        <div class="shortcut" @click="$emit('start', { mode: 'practice' })">
          <div class="s-icon all">📚</div>
          <div class="s-label">全部刷题</div>
          <div class="s-count">{{ summary.total }} 题</div>
        </div>
        <div class="shortcut no-click">
          <div class="s-icon today">📅</div>
          <div class="s-label">今日已刷</div>
          <div class="s-count">{{ summary.today }} 题</div>
        </div>
      </div>
    </div>

    <!-- 模拟考试入口 -->
    <div class="card mock-entry">
      <div class="me-text">
        <div class="me-title">模拟考试</div>
        <div class="me-sub">按题型 / 难度组卷，限时实战，考后看得分与逐题解析</div>
      </div>
      <button class="btn btn-primary" @click="$emit('start-mock')">去组卷</button>
    </div>

    <div v-if="loading" class="empty">加载中…</div>

    <ReviewPanel :show="reviewOpen" @close="reviewOpen = false" />
  </div>
</template>

<style scoped>
.welcome {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background:
    radial-gradient(circle at 90% 15%, rgba(176, 107, 255, 0.20), transparent 60%),
    linear-gradient(135deg, rgba(42, 245, 255, 0.10), rgba(176, 107, 255, 0.06));
  border-color: rgba(42, 245, 255, 0.30);
  box-shadow: var(--glow-soft), var(--shadow);
}
.welcome-text { flex: 1; }
.welcome-text h1 { font-size: 22px; line-height: 1.3; margin: 8px 0 14px 0; color: var(--text); text-shadow: var(--glow-soft); }
.welcome-text .subtitle { font-size: 12px; color: var(--muted); }
.welcome-illustration { flex-shrink: 0; filter: drop-shadow(0 0 8px rgba(42, 245, 255, 0.35)); }

.stat-card { display: flex; flex-direction: column; gap: 8px; }
.stat-title { font-size: 15px; font-weight: 600; color: var(--text); }
.stat-number { display: flex; align-items: baseline; gap: 6px; }
.stat-number .num { font-size: 40px; font-weight: 700; color: var(--brand); line-height: 1; text-shadow: var(--glow); }
.stat-number .unit { font-size: 14px; color: var(--muted); }

.goal-card { display: flex; flex-direction: column; gap: 8px; }
.goal-top { display: flex; align-items: center; justify-content: space-between; }
.goal-label { font-size: 14px; font-weight: 600; color: var(--text); }
.goal-num { font-size: 13px; color: var(--brand); font-weight: 600; }
.goal-bar { height: 8px; background: rgba(255,255,255,.06); border-radius: 6px; overflow: hidden; }
.goal-fill { height: 100%; background: linear-gradient(90deg, var(--brand), var(--brand2, #7b46c4)); border-radius: 6px; transition: width .4s; box-shadow: var(--glow-soft); }
.goal-sub { font-size: 12px; color: var(--muted); }

/* 每日任务 */
.quest-xp { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 6px; }
.quest-claimed { font-size: 12px; color: var(--ok); margin-bottom: 8px; }
.quest-list { display: flex; flex-direction: column; gap: 8px; }
.quest-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 12px;
  cursor: pointer;
  transition: border-color .2s;
}
.quest-item:hover { border-color: var(--brand); }
.quest-item.done { border-color: rgba(44, 229, 168, 0.4); background: rgba(44, 229, 168, 0.05); }
.quest-check { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--muted); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: var(--muted); }
.quest-item.done .quest-check { border-color: var(--ok); color: var(--ok); }
.quest-name { flex: 1; font-size: 13px; color: var(--text); }
.quest-state { font-size: 11px; color: var(--muted); }
.quest-item.done .quest-state { color: var(--ok); }

/* 习惯打卡 */
.habit-list { display: flex; flex-direction: column; gap: 6px; }
.habit-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  cursor: pointer;
}
.habit-item.done { border-color: rgba(44, 229, 168, 0.4); background: rgba(44, 229, 168, 0.05); }
.habit-icon { font-size: 16px; }
.habit-name { flex: 1; font-size: 13px; color: var(--text); }
.habit-streak { font-size: 11px; color: var(--warn); }
.habit-check { font-size: 16px; color: var(--muted); }
.habit-item.done .habit-check { color: var(--ok); }

/* 每日回顾 + 专注 */
.duo-row { display: flex; gap: 14px; }
.duo-left {
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.duo-left:hover { border-color: var(--brand); }
.duo-right {
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.duo-title { font-size: 13px; font-weight: 600; color: var(--text); }
.duo-sub { font-size: 11px; color: var(--muted); }
.focus-ctrl { display: flex; align-items: center; gap: 8px; }
.focus-time { font-size: 20px; font-weight: 600; color: var(--brand); font-variant-numeric: tabular-nums; }

.shortcuts .shortcut-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.shortcut {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 4px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: all .2s;
}
.shortcut:hover { background: var(--brand-light); border-color: var(--brand); box-shadow: var(--glow-soft); }
.s-icon {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #021018;
}
.s-icon.wrong { background: var(--bad); box-shadow: 0 0 10px rgba(255, 77, 109, 0.55); }
.s-icon.fav { background: var(--warn); box-shadow: 0 0 10px rgba(255, 180, 84, 0.55); }
.s-icon.all { background: var(--brand); box-shadow: var(--glow); }
.s-icon.today { background: var(--ok); box-shadow: 0 0 10px rgba(44, 229, 168, 0.55); }
.s-label { font-size: 12px; color: var(--text); }
.s-count { font-size: 11px; color: var(--muted); }
.shortcut.no-click { cursor: default; }
.shortcut.no-click:hover { background: rgba(255, 255, 255, 0.02); border-color: var(--line); box-shadow: none; }

.mock-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background:
    radial-gradient(circle at 12% 50%, rgba(255, 193, 84, 0.16), transparent 55%),
    linear-gradient(135deg, rgba(42, 245, 255, 0.08), rgba(255, 193, 84, 0.06));
  border-color: rgba(255, 193, 84, 0.30);
}
.mock-entry .me-text { flex: 1; }
.me-title { font-size: 16px; font-weight: 700; color: var(--text); }
.me-sub { font-size: 12px; color: var(--muted); margin-top: 4px; line-height: 1.5; }
.mock-entry .btn { flex: 0 0 auto; }
</style>
