<script setup>
import Icon from './Icon.vue'
import CountUp from './CountUp.vue'
import { showConfirm } from '../utils/confirm.js'
import { ref, onMounted, computed } from 'vue'
import { tiku } from '../api/tiku.js'
import { applyAppearance } from '../utils/appearance.js'
import WrongBook from './WrongBook.vue'
import Favorites from './Favorites.vue'
import NotesList from './NotesList.vue'
import ChapterProgress from './ChapterProgress.vue'
import AboutModal from './AboutModal.vue'
import BackupModal from './BackupModal.vue'
import XpDetailModal from './XpDetailModal.vue'

const emit = defineEmits(['reset', 'start', 'open-bank'])

function forwardStart(payload) {
  emit('start', payload)
}

const userName = ref('本地用户')
const toast = ref('')
const showNotes = ref(false)

// ---- 云同步（GitHub Gist）状态 ----
const syncConnected = ref(false)
const syncLogin = ref('')
const syncLast = ref(0)
const syncToken = ref('')
const syncing = ref(false)

const menus = [
  { label: '章节进度', action: () => showChapter.value = true },
  { label: '关于我们', action: () => showAbout.value = true }
]
const showChapter = ref(false)
const showAbout = ref(false)
const showBackup = ref(false)
const showXpDetail = ref(false)

onMounted(async () => {
  try {
    const cfg = await tiku.syncGetConfig()
    syncConnected.value = cfg.connected
    syncLogin.value = cfg.login
    syncLast.value = cfg.lastSync
  } catch (e) { /* 同步配置读取失败不阻塞页面 */ }
})

function showToast(msg) {
  toast.value = msg
  setTimeout(() => toast.value = '', 2400)
}

async function connect() {
  const t = syncToken.value.trim()
  if (!t) { showToast('请输入 GitHub Token'); return }
  try {
    const r = await tiku.syncConnect(t)
    syncConnected.value = true
    syncLogin.value = r.login
    syncToken.value = ''
    showToast('已连接 GitHub：' + r.login)
  } catch (e) {
    showToast('连接失败：' + (e.message || '请检查 Token 与网络'))
  }
}

async function doSync() {
  if (syncing.value) return
  syncing.value = true
  try {
    const r = await tiku.syncNow()
    syncLast.value = r.lastSync
    let msg = '同步成功 · ' + new Date(r.lastSync).toLocaleString()
    if (r.merge) {
      const m = r.merge
      const parts = []
      if (m.questions) parts.push('题目 ' + m.questions)
      if (m.answerRecords) parts.push('答题 ' + m.answerRecords)
      if (m.wrongBooks) parts.push('错题 ' + m.wrongBooks)
      if (m.notes) parts.push('笔记 ' + m.notes)
      if (m.kbDocs) parts.push('文档 ' + m.kbDocs)
      if (m.xpLogs) parts.push('XP ' + m.xpLogs)
      if (m.habits) parts.push('习惯 ' + m.habits)
      if (parts.length) msg += ' · 合并：' + parts.slice(0, 5).join('、')
    }
    showToast(msg, 'ok')
  } catch (e) {
    showToast('同步失败：' + (e.message || '网络异常'), 'err')
  } finally {
    syncing.value = false
  }
}

async function disconnect() {
  try { await tiku.syncDisconnect() } catch (e) {}
  syncConnected.value = false
  syncLogin.value = ''
  syncLast.value = 0
  showToast('已断开云同步（本地数据保留）')
}

async function clearLocal() {
  await tiku.clearUserData()
  showToast('已清空本地学习数据')
  emit('reset')
}

function fmtTime(ts) {
  if (!ts) return '从未同步'
  const d = new Date(Number(ts))
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function exportData() {
  const json = await tiku.exportData()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tiku-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  showToast('备份已导出')
}

function importData(event) {
  const file = event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const r = await tiku.importData(e.target.result)
      showToast(`导入成功，共 ${r.imported} 题`)
    } catch (err) {
      showToast('导入失败：' + err.message)
    }
  }
  reader.readAsText(file)
  event.target.value = ''
}

// ---- 外观 / 偏好 ----
const theme = ref('dark')
const fontScale = ref('1')
const dailyGoal = ref(0)
const remindEnabled = ref(false)
const remindTime = ref('21:00')
async function setTheme(t) {
  theme.value = t
  await tiku.setSetting('theme', t)
  await applyAppearance()
}
async function setFontScale(v) {
  fontScale.value = v
  await tiku.setSetting('font_scale', String(v))
  await applyAppearance()
}
async function setDailyGoal(v) {
  dailyGoal.value = Number(v) || 0
  await tiku.setSetting('daily_goal', String(dailyGoal.value))
}
async function setRemindEnabled(v) {
  remindEnabled.value = !!v
  await tiku.setSetting('remind_enabled', remindEnabled.value ? '1' : '0')
}
async function setRemindTime(v) {
  remindTime.value = v || '21:00'
  await tiku.setSetting('remind_time', remindTime.value)
}

// ---- 游戏化成就（指标来自 getAchievements，成就定义在前端派生）----
const metrics = ref(null)
// progress: 0~1 达成度；fmt: 进度文案（"已完成"由模板统一处理）
const achievements = computed(() => ACH_DEFS.map(a => {
  const p = metrics.value ? a.progress(metrics.value) : 0
  return {
    ...a,
    got: p >= 1,
    pct: Math.round(Math.min(1, Math.max(0, p)) * 100),
    fmtText: metrics.value ? a.fmt(metrics.value) : ''
  }
}))
const unlockedCount = computed(() => achievements.value.filter(a => a.got).length)

// ---- 知识库概览（kbStats）----
const kbStats = ref(null)
// ---- XP 等级 ----
const xp = ref(null)
// ---- 习惯管理 ----
const habits = ref([])
const newHabitName = ref('')

// 页面分组折叠：学习成长默认展开，其余收起（避免平铺过长）
const secOpen = ref({ learn: true, habits: false, prefs: false, sync: false, misc: false })
function toggleSec(k) {
  secOpen.value[k] = !secOpen.value[k]
}
async function loadHabits() {
  habits.value = await tiku.listHabits()
}
async function addHabit() {
  const name = newHabitName.value.trim()
  if (!name) return
  await tiku.addHabit(name)
  newHabitName.value = ''
  await loadHabits()
}
async function removeHabit(h) {
  const ok = await showConfirm(`删除习惯「${h.name}」？
其打卡记录一并删除。`)
  if (!ok) return
  await tiku.deleteHabit(h.id)
  await loadHabits()
}

onMounted(async () => {
  try {
    const [t, f, g, ach, re, rt, kb, x] = await Promise.all([
      tiku.getSetting('theme'), tiku.getSetting('font_scale'),
      tiku.getSetting('daily_goal'), tiku.getAchievements(),
      tiku.getSetting('remind_enabled'), tiku.getSetting('remind_time'),
      tiku.kbStats(), tiku.xpStats()
    ])
    theme.value = t || 'dark'
    fontScale.value = f || '1'
    dailyGoal.value = Number(g) || 0
    metrics.value = ach
    remindEnabled.value = re === '1'
    remindTime.value = rt || '21:00'
    kbStats.value = kb
    xp.value = x
    await loadHabits()
  } catch (e) { /* 成就读取失败不阻塞 */ }
})
</script>

<template>
  <div class="profile">
    <!-- 用户信息 + XP 等级（紧凑右侧） -->
    <div class="card user-card">
      <div class="avatar">{{ userName.slice(0, 1) }}</div>
      <div class="user-info">
        <div class="user-name">{{ userName }}</div>
        <div class="user-sub">本地账号 · 数据离线存储</div>
      </div>
      <div v-if="xp" class="user-xp">
        <div class="user-xp-top">
          <span class="user-xp-level">Lv.{{ xp.level }}</span>
          <span class="user-xp-num"><CountUp :value="xp.total" /> XP</span>
        </div>
        <div class="user-xp-bar"><div class="user-xp-fill" :style="{ width: xp.levelPct + '%' }"></div></div>
        <div class="user-xp-sub">今日 +{{ xp.today }}</div>
      </div>
    </div>



    <!-- 学习成长（知识库概览 + 成就） -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('learn')">
        <span class="sec-title"><Icon name="chart" :size="14"/> 学习成长</span>
        <span class="sec-badge">{{ unlockedCount }} 成就</span>
        <span class="sec-arrow" :class="{ open: secOpen.learn }">▾</span>
      </div>
      <div v-show="secOpen.learn" class="sec-body">

    <!-- 知识库概览 -->
    <div v-if="kbStats" class="card">
      <div class="card-title">知识库概览</div>
      <div class="kb-stats">
        <div class="kb-stat"><b>{{ kbStats.docs }}</b><span>文档</span></div>
        <div class="kb-stat"><b>{{ kbStats.blocks }}</b><span>文本块</span></div>
        <div class="kb-stat"><b>{{ kbStats.links }}</b><span>题目联动</span></div>
        <div class="kb-stat"><b>{{ kbStats.readCount }}</b><span>阅读次数</span></div>
        <div class="kb-stat"><b>{{ kbStats.tags }}</b><span>标签</span></div>
        <div class="kb-stat"><b>{{ kbStats.folders }}</b><span>文件夹</span></div>
      </div>
    </div>

    <!-- 游戏化成就 -->
    <div class="card">
      <div class="card-title">我的成就（{{ unlockedCount }}/{{ achievements.length }}）</div>
      <div class="ach-grid">
        <div v-for="a in achievements" :key="a.key" class="ach" :class="{ got: a.got }">
          <div class="ach-head">
            <span class="ach-icon">{{ a.icon }}</span>
            <span class="ach-name">{{ a.name }}</span>
            <span class="ach-pct" :class="{ done: a.got }">{{ a.got ? '<Icon name="check" :size="14"/> 已达成' : a.fmtText }}</span>
          </div>
          <span class="ach-desc">{{ a.desc }}</span>
          <div class="ach-bar">
            <div class="ach-fill" :class="{ done: a.got }" :style="{ width: a.pct + '%' }"></div>
          </div>
        </div>
      </div>
    </div>
      </div>
    </div>


    <!-- <Icon name="settings" :size="14"/> 偏好设置 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('prefs')">
        <span class="sec-title"><Icon name="settings" :size="14"/> 偏好设置</span>
        <span class="sec-arrow" :class="{ open: secOpen.prefs }">▾</span>
      </div>
      <div v-show="secOpen.prefs" class="sec-body">

    <!-- 偏好设置 -->
    <div class="card">
      <div class="card-title">偏好设置</div>
      <div class="pref-row">
        <span class="pref-label">主题</span>
        <div class="seg">
          <button :class="{ on: theme === 'dark' }" @click="setTheme('dark')">暗色</button>
          <button :class="{ on: theme === 'light' }" @click="setTheme('light')">浅色</button>
        </div>
      </div>
      <div class="pref-row">
        <span class="pref-label">字号 {{ Math.round(fontScale * 100) }}%</span>
        <input class="pref-range" type="range" min="0.8" max="1.4" step="0.05" :value="fontScale" @input="setFontScale($event.target.value)" />
      </div>
      <div class="pref-row">
        <span class="pref-label">每日目标</span>
        <input class="pref-input" type="number" min="0" :value="dailyGoal" @change="setDailyGoal($event.target.value)" placeholder="0=不限" />
        <span class="pref-unit">题/天</span>
      </div>
      <div class="pref-row">
        <span class="pref-label">学习提醒</span>
        <input class="pref-input pref-time" type="time" :value="remindTime" @change="setRemindTime($event.target.value)" />
        <label class="pref-switch">
          <input type="checkbox" :checked="remindEnabled" @change="setRemindEnabled($event.target.checked)" />
          <span class="pref-switch-slider"></span>
        </label>
      </div>
    </div>

      </div>
    </div>


    <!-- <Icon name="refresh" :size="14"/> 习惯管理 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('habits')">
        <span class="sec-title"><Icon name="refresh" :size="14"/> 习惯管理</span> <span class="sec-badge">{{ habits.length }} 个</span>
        <span class="sec-arrow" :class="{ open: secOpen.habits }">▾</span>
      </div>
      <div v-show="secOpen.habits" class="sec-body">

    <!-- 习惯管理 -->
    <div class="card">
      <div class="card-title">习惯管理</div>
      <div class="habit-mgr">
        <div v-for="h in habits" :key="h.id" class="habit-mgr-item">
          <span class="habit-mgr-icon">{{ h.icon }}</span>
          <span class="habit-mgr-name">{{ h.name }}</span>
          <span class="habit-mgr-streak"><Icon name="fire" :size="14"/> {{ h.streak }} 天</span>
          <button class="habit-mgr-del" @click="removeHabit(h)">删除</button>
        </div>
        <div v-if="!habits.length" class="habit-mgr-empty">还没有习惯，加一个吧（如：雅思刷题 / 健身 / 阅读）</div>
        <div class="habit-mgr-add">
          <input v-model="newHabitName" class="input" placeholder="新习惯名称，回车或点添加" @keyup.enter="addHabit" />
          <button class="btn btn-primary" @click="addHabit">添加</button>
        </div>
      </div>
    </div>

      </div>
    </div>


    <!-- <Icon name="cloud" :size="14"/> 云同步与数据 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('sync')">
        <span class="sec-title"><Icon name="cloud" :size="14"/> 云同步与数据</span> <span class="sec-badge">{{ syncConnected ? '已连接' : '未连接' }}</span>
        <span class="sec-arrow" :class="{ open: secOpen.sync }">▾</span>
      </div>
      <div v-show="secOpen.sync" class="sec-body">

    <!-- 云同步（GitHub Gist，零后端） -->
    <div class="card">
      <div class="card-title">云同步（GitHub）</div>

      <div v-if="!syncConnected" class="sync-connect">
        <p class="sync-tip">
          用 GitHub 私有 Gist 同步多设备学习数据，零后端、零部署。<br />
          需一个带 <code>gist</code> 权限的 Personal Access Token。
        </p>
        <input
          v-model="syncToken"
          class="sync-input"
          type="password"
          placeholder="粘贴 GitHub Token（ghp_...）"
          @keyup.enter="connect"
        />
        <button class="btn btn-primary sync-btn" @click="connect">连接并同步</button>
        <a class="sync-link" href="https://github.com/settings/tokens" target="_blank" rel="noopener">
          如何创建 Token？
        </a>
      </div>

      <div v-else class="sync-connected">
        <div class="sync-row">
          <span class="sync-dot"></span>
          <span>已连接：<b>{{ syncLogin }}</b></span>
        </div>
        <div class="sync-row sub">上次同步：{{ fmtTime(syncLast) }}</div>
        <div class="sync-actions">
          <button class="btn btn-primary" :disabled="syncing" @click="doSync">
            {{ syncing ? '同步中…' : '立即同步' }}
          </button>
          <button class="btn btn-outline" @click="disconnect">断开连接</button>
        </div>
      </div>
    </div>


    <!-- 题库管理 -->
    <div class="card">
      <div class="card-title">题库</div>
      <div class="list-item highlight" @click="emit('open-bank')">
        <span class="title">题库管理</span>
        <span class="sub">导入 Excel/CSV · 录题 · 编辑删除</span>
        <span class="arrow">›</span>
      </div>
    </div>


    <!-- 数据导入导出 -->
    <div class="card">
      <div class="card-title">数据管理</div>
      <div class="list-item" @click="exportData">
        <span class="title">导出备份</span>
        <span class="arrow">›</span>
      </div>
      <label class="list-item" style="display:flex;cursor:pointer">
        <span class="title">导入备份</span>
        <span class="arrow">›</span>
        <input type="file" accept=".json" style="display:none" @change="importData" />
      </label>
      <div class="list-item" @click="showBackup = true">
        <span class="title">备份管理</span>
        <span class="sub">自动备份列表 · 一键恢复</span>
        <span class="arrow">›</span>
      </div>
      <div class="list-item" @click="clearLocal">
        <span class="title danger">清空本地学习数据</span>
        <span class="arrow">›</span>
      </div>
    </div>


      </div>
    </div>


    <!-- <Icon name="note" :size="14"/> 错题与收藏 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('misc')">
        <span class="sec-title"><Icon name="note" :size="14"/> 错题与收藏</span>
        <span class="sec-arrow" :class="{ open: secOpen.misc }">▾</span>
      </div>
      <div v-show="secOpen.misc" class="sec-body">

    <!-- 错题本 / 收藏 / 笔记 -->
    <div class="card">
      <div class="card-title">我的错题与收藏</div>
      <WrongBook @start="forwardStart" />
      <Favorites @start="forwardStart" />
      <div class="list-item" @click="showNotes = true">
        <span class="title">我的笔记</span>
        <span class="sub">查看与删除全部题目笔记</span>
        <span class="arrow">›</span>
      </div>
    </div>


      </div>
    </div>


    <!-- 菜单列表 -->
    <div class="card menu-card">
      <div
        v-for="m in menus"
        :key="m.label"
        class="list-item"
        @click="m.action"
      >
        <span class="title">{{ m.label }}</span>
        <span class="arrow">›</span>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <NotesList :show="showNotes" @close="showNotes = false" />
    <ChapterProgress :show="showChapter" @close="showChapter = false" />
    <AboutModal :show="showAbout" @close="showAbout = false" />
    <BackupModal :show="showBackup" @close="showBackup = false" />
    <XpDetailModal :show="showXpDetail" @close="showXpDetail = false" />
  </div>
</template>

<style scoped>
.user-card {
  display: flex;
  align-items: center;
  gap: 14px;
}
/* XP 等级：用户卡右侧紧凑精致版 */
.user-xp {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  flex-shrink: 0;
}
.user-xp-top { display: flex; align-items: baseline; gap: 6px; }
.user-xp-level {
  font-size: 15px;
  font-weight: 600;
  color: var(--brand);
  letter-spacing: .3px;
}
.user-xp-num { font-size: 11px; color: var(--muted); }
.user-xp-bar {
  width: 84px;
  height: 4px;
  border-radius: 2px;
  background: rgba(127, 127, 127, 0.22);
  overflow: hidden;
}
.user-xp-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--brand), var(--brand2, #7a5cff));
  transition: width .4s;
}
.user-xp-sub { font-size: 10px; color: var(--muted); }
/* 分组折叠 */
.sec { display: flex; flex-direction: column; }
.sec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  user-select: none;
  transition: border-color .2s;
}
.sec-head:hover { border-color: var(--brand); }
.sec-title { font-size: 14px; font-weight: 600; color: var(--text); }
.sec-badge {
  font-size: 11px;
  color: var(--muted);
  background: rgba(91, 124, 250, 0.08);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0 8px;
}
.sec-arrow {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
  transition: transform .2s;
}
.sec-arrow.open { transform: rotate(180deg); }
.sec-body { display: flex; flex-direction: column; gap: 12px; padding: 12px 0 4px; }
.avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--brand-light);
  color: var(--brand);
  font-size: 22px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.user-info { flex: 1; overflow: hidden; }
.user-name { font-size: 16px; font-weight: 600; }
.user-sub { font-size: 12px; color: var(--muted); margin-top: 4px; }

.menu-card { padding: 0 16px; }

/* 题库管理入口：比普通菜单项更显眼，这是高频操作 */
.list-item.highlight { cursor: pointer; }
.list-item.highlight .title { color: var(--brand); font-weight: 600; }
.list-item.highlight .sub {
  flex: 1;
  text-align: right;
  margin-right: 8px;
  font-size: 11px;
  color: var(--muted);
}
.list-item.danger .title { color: #ff6b6b; }

/* 云同步卡片 */
.sync-connect { display: flex; flex-direction: column; gap: 10px; }
.sync-tip { font-size: 12px; color: var(--muted); line-height: 1.6; }
.sync-tip code {
  background: var(--line);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
}
.sync-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 12px;
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.sync-input:focus { border-color: var(--brand); }
.sync-btn { align-self: flex-start; }
.sync-link { font-size: 11px; color: var(--brand); text-decoration: none; }
.sync-link:hover { text-decoration: underline; }

.sync-connected { display: flex; flex-direction: column; gap: 8px; }
.sync-row { font-size: 13px; display: flex; align-items: center; gap: 6px; }
.sync-row.sub { color: var(--muted); font-size: 12px; }
.sync-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #2ecc71; box-shadow: 0 0 6px #2ecc71;
}
.sync-actions { display: flex; gap: 10px; margin-top: 4px; }

.toast {
  position: fixed;
  left: 50%;
  bottom: 90px;
  transform: translateX(-50%);
  background: rgba(8, 14, 28, 0.92);
  color: var(--text);
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 13px;
  z-index: 100;
  border: 1px solid var(--line);
  box-shadow: var(--glow-soft);
}

/* 偏好设置 */
.pref-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; font-size: 13px; }
.pref-label { flex: 0 0 88px; color: var(--muted); }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.seg button { background: none; border: none; color: var(--muted); padding: 6px 16px; font-size: 13px; cursor: pointer; }
.seg button.on { background: var(--brand); color: #021018; font-weight: 600; }
.pref-range { flex: 1; accent-color: var(--brand); }
.pref-input { width: 80px; background: var(--input-solid-bg); border: 1px solid var(--line); border-radius: 8px; color: var(--text); padding: 6px 10px; font-size: 13px; outline: none; font-family: inherit; }
.pref-input:focus { border-color: var(--brand); }
.pref-time { width: auto; }
.pref-switch { display: inline-flex; align-items: center; margin-left: auto; cursor: pointer; }
.pref-switch input { display: none; }
.pref-switch-slider {
  width: 38px;
  height: 20px;
  border-radius: 12px;
  background: var(--line);
  position: relative;
  transition: background .2s;
}
.pref-switch-slider::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--muted);
  transition: all .2s;
}
.pref-switch input:checked + .pref-switch-slider { background: var(--brand); }
.pref-switch input:checked + .pref-switch-slider::after { left: 20px; background: #021018; }
.kb-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.kb-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 6px;
  background: rgba(255, 255, 255, 0.03);
}
.kb-stat b { font-size: 18px; color: var(--brand); }
.kb-stat span { font-size: 11px; color: var(--muted); }

/* XP 等级已精简为用户卡右侧 .user-xp（见上方） */

/* 习惯管理 */
.habit-mgr { display: flex; flex-direction: column; gap: 8px; }
.habit-mgr-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 12px;
}
.habit-mgr-icon { font-size: 16px; }
.habit-mgr-name { flex: 1; font-size: 13px; color: var(--text); }
.habit-mgr-streak { font-size: 11px; color: var(--warn); }
.habit-mgr-del { font-size: 12px; color: var(--muted); background: none; border: none; cursor: pointer; }
.habit-mgr-del:hover { color: var(--bad); }
.habit-mgr-empty { font-size: 12px; color: var(--muted); }
.habit-mgr-add { display: flex; gap: 8px; }
.habit-mgr-add .input { flex: 1; }
.pref-unit { color: var(--muted); font-size: 12px; }

/* 成就墙 */
.ach-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.ach { display: flex; flex-direction: column; gap: 3px; border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: rgba(255,255,255,.02); opacity: .62; transition: all .2s; }
.ach.got { opacity: 1; border-color: var(--brand); background: var(--brand-light); box-shadow: var(--glow-soft); }
.ach-head { display: flex; align-items: center; gap: 6px; }
.ach-icon { font-size: 20px; }
.ach-name { font-size: 13px; font-weight: 600; color: var(--text); }
.ach-pct { margin-left: auto; font-size: 11px; color: var(--muted); white-space: nowrap; }
.ach-pct.done { color: var(--ok); font-weight: 600; }
.ach-desc { font-size: 11px; color: var(--muted); }
.ach-bar {
  height: 5px;
  border-radius: 3px;
  background: rgba(127, 127, 127, 0.25);
  overflow: hidden;
  margin-top: 3px;
}
.ach-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--muted);
  transition: width .3s ease;
}
.ach-fill.done { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
.ach.got .ach-state { color: var(--brand); font-weight: 600; }
</style>
