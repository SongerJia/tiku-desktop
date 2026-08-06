<script setup>
import { ref, computed, onMounted } from 'vue'
import { tiku } from '../api/tiku.js'

const loggedIn = ref(false)
const loading = ref(false)
const summary = ref({ total: 0, learned: 0, mastered: 0, streak: 0, activeDays: 0 })
const trend = ref([])
const calendar = ref({})

const now = new Date()
const year = now.getFullYear()
const month = now.getMonth() + 1

const rate = computed(() => {
  return summary.value.total ? Math.round((summary.value.mastered / summary.value.total) * 100) : 0
})

const maxTrend = computed(() => Math.max(1, ...trend.value.map(d => d.count)))

const calendarDays = computed(() => {
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startWeekday = firstDay.getDay() // 0=Sun
  const days = []
  for (let i = 0; i < startWeekday; i++) days.push({ empty: true })
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const count = calendar.value[key] || 0
    days.push({ day: d, count })
  }
  return days
})

async function login() {
  loggedIn.value = true
  loading.value = true
  summary.value = await tiku.getSummary()
  trend.value = await tiku.getWeeklyTrend()
  calendar.value = await tiku.getMonthlyCalendar(year, month)
  loading.value = false
}

onMounted(async () => {
  // 本地单用户直接视为已登录，加载真实数据；如需演示未登录 UI 可注释掉下面这行
  await login()
})
</script>

<template>
  <div class="stats">
    <!-- 登录提示 / 用户信息 -->
    <div class="card login-card">
      <template v-if="!loggedIn">
        <div class="avatar">?</div>
        <div class="login-tip">登录后可查看学习进度</div>
        <button class="btn btn-primary" @click="login">立即登录</button>
      </template>
      <template v-else>
        <div class="avatar solid">张</div>
        <div class="login-tip">本地用户 · 学习进度实时统计</div>
        <div class="login-sub">已坚持学习，继续加油！</div>
      </template>
    </div>

    <div v-if="loggedIn">
      <div class="stats-grid">
      <!-- 总体进度 -->
      <div class="card progress-card">
        <div class="card-title center">总体进度</div>
        <div class="ring-wrap">
          <svg class="ring" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(42, 245, 255, 0.14)" stroke-width="10" />
            <circle
              cx="60" cy="60" r="50" fill="none" stroke="var(--brand)"
              stroke-width="10" stroke-linecap="round"
              :stroke-dasharray="`${rate * 3.14} ${314 - rate * 3.14}`"
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div class="ring-text">
            <div class="ring-num">{{ rate }}%</div>
            <div class="ring-label">掌握进度</div>
          </div>
        </div>
      </div>

      <!-- 数字卡片 -->
      <div class="card numbers">
        <div class="num-item">
          <div class="num-value">{{ summary.total }}</div>
          <div class="num-label">总卡片数</div>
        </div>
        <div class="num-item">
          <div class="num-value">{{ summary.learned }}</div>
          <div class="num-label">已学习</div>
        </div>
        <div class="num-item">
          <div class="num-value">{{ summary.mastered }}</div>
          <div class="num-label">已掌握</div>
        </div>
      </div>

      <!-- 学习趋势 -->
      <div class="card trend-card">
        <div class="card-title">学习趋势</div>
        <div v-if="!trend.length" class="empty">本周暂无学习记录</div>
        <div v-else class="trend-bars">
          <div v-for="d in trend" :key="d.date" class="bar-item">
            <div class="bar-track">
              <div class="bar-fill" :style="{ height: `${(d.count / maxTrend) * 60}px` }"></div>
            </div>
            <div class="bar-date">{{ d.date.slice(5) }}</div>
            <div class="bar-count">{{ d.count }}</div>
          </div>
        </div>
      </div>

      <!-- 学习习惯 -->
      <div class="card habit-card">
        <div class="card-title">学习习惯</div>
        <div class="habit-row">
          <div class="habit-item">
            <div class="habit-label">连续学习</div>
            <div class="habit-value">{{ summary.streak }}<span class="unit">天</span></div>
            <div class="habit-desc">坚持每天学习，养成好习惯</div>
          </div>
          <div class="habit-item">
            <div class="habit-label">累计学习</div>
            <div class="habit-value">{{ summary.activeDays }}<span class="unit">天</span></div>
            <div class="habit-desc">走过的每一步都算数</div>
          </div>
        </div>
      </div>

      <!-- 学习日历 -->
      <div class="card calendar-card">
        <div class="cal-header">
          <div class="card-title" style="margin:0">{{ year }}年{{ month }}月</div>
          <div class="cal-summary">已学习 {{ Object.keys(calendar).length }}/{{ calendarDays.filter(d => !d.empty).length }} 天</div>
        </div>
        <div class="weekdays">
          <span v-for="w in ['日','一','二','三','四','五','六']" :key="w">{{ w }}</span>
        </div>
        <div class="days">
          <span
            v-for="(d, i) in calendarDays"
            :key="i"
            class="day"
            :class="{ empty: d.empty, active: d.count > 0 }"
          >{{ d.empty ? '' : d.day }}</span>
        </div>
        <div class="cal-legend">
          <span>少</span>
          <span class="dot light"></span>
          <span class="dot mid"></span>
          <span class="dot heavy"></span>
          <span>多</span>
        </div>
      </div>
      </div>
    </div>

    <div v-if="loading" class="empty">加载中…</div>
  </div>
</template>

<style scoped>
.center { text-align: center; }

.login-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--brand-light);
  color: var(--brand);
  font-size: 24px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  box-shadow: var(--glow-soft);
}
.avatar.solid { background: var(--brand); color: #021018; box-shadow: var(--glow); }
.login-tip { font-size: 14px; color: var(--text); }
.login-sub { font-size: 12px; color: var(--muted); }

.progress-card { text-align: center; }
.ring-wrap {
  position: relative;
  width: 140px;
  height: 140px;
  margin: 10px auto 0;
}
.ring { width: 100%; height: 100%; filter: drop-shadow(0 0 6px rgba(42,245,255,0.4)); }
.ring-text {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}
.ring-num { font-size: 28px; font-weight: 700; color: var(--brand); text-shadow: var(--glow-soft); }
.ring-label { font-size: 12px; color: var(--muted); }

.numbers {
  display: flex;
  justify-content: space-around;
  text-align: center;
}
.num-value { font-size: 26px; font-weight: 700; color: var(--brand); text-shadow: var(--glow-soft); }
.num-label { font-size: 12px; color: var(--muted); margin-top: 4px; }

.trend-bars {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  height: 90px;
  padding-top: 10px;
}
.bar-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.bar-track {
  width: 14px;
  height: 60px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 7px;
  position: relative;
  overflow: hidden;
}
.bar-fill {
  position: absolute;
  bottom: 0;
  width: 100%;
  background: linear-gradient(180deg, var(--brand), var(--brand2));
  border-radius: 7px;
  min-height: 4px;
  box-shadow: 0 0 8px rgba(42, 245, 255, 0.5);
}
.bar-date { font-size: 10px; color: var(--muted); }
.bar-count { font-size: 10px; color: var(--brand); }

.habit-row { display: flex; gap: 12px; }
.habit-item {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px;
}
.habit-label { font-size: 13px; color: var(--text); }
.habit-value { font-size: 22px; font-weight: 700; color: var(--brand); margin: 6px 0; text-shadow: var(--glow-soft); }
.habit-value .unit { font-size: 12px; margin-left: 2px; }
.habit-desc { font-size: 11px; color: var(--muted); }

.cal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.cal-summary { font-size: 12px; color: var(--muted); }
.weekdays, .days { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; gap: 6px; }
.weekdays { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.day {
  width: 30px;
  height: 30px;
  line-height: 30px;
  border-radius: 50%;
  font-size: 12px;
  margin: 0 auto;
  color: var(--text);
}
.day.active { background: var(--brand); color: #021018; box-shadow: var(--glow); font-weight: 600; }
.day.empty { visibility: hidden; }
.cal-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--muted);
}
.dot { width: 10px; height: 10px; border-radius: 2px; }
.dot.light { background: rgba(42, 245, 255, 0.25); }
.dot.mid { background: rgba(42, 245, 255, 0.55); }
.dot.heavy { background: var(--brand); box-shadow: var(--glow); }
</style>
