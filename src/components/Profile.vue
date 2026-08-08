<script setup>
import Icon from './Icon.vue'
import CountUp from './CountUp.vue'
import { showConfirm } from '../utils/confirm.js'
import { ACH_DEFS } from '../utils/achievements.js'
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
import CategoryManager from './CategoryManager.vue'

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
const conflictItems = ref([]) // 本次同步冲突明细
const conflictOpen = ref(false)
const syncToken = ref('')
const syncing = ref(false)

const showChapter = ref(false)
const showAbout = ref(false)
const showBackup = ref(false)
const showXpDetail = ref(false)
const showCats = ref(false)

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
      if (m.conflicts) msg += ' · 冲突 ' + m.conflicts + ' 条（按时间戳覆盖）'
      conflictItems.value = (m.conflictItems || []).slice(0, 50)
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

async function cleanupImages() {
  try {
    const r = await tiku.cleanupOrphanImages()
    if (r.removed > 0) showToast(`已清理 ${r.removed} 张无用图片，释放 ${(r.freedBytes / 1024).toFixed(1)} KB`, 'ok')
    else showToast('没有需要清理的无用图片', 'ok')
  } catch (e) {
    showToast('清理失败：' + (e.message || '未知错误'), 'err')
  }
}

async function exportWrong() {
  try {
    const file = await tiku.exportWrongBook()
    await tiku.openPath(file)
    showToast('错题本已导出并在文件管理器中打开', 'ok')
  } catch (e) { showToast('导出失败：' + (e.message || '未知错误'), 'err') }
}
async function exportNotes() {
  try {
    const file = await tiku.exportNotes()
    await tiku.openPath(file)
    showToast('笔记已导出并在文件管理器中打开', 'ok')
  } catch (e) { showToast('导出失败：' + (e.message || '未知错误'), 'err') }
}
async function exportZip() {
  try {
    const r = await tiku.exportAllZip()
    if (!r.ok) throw new Error(r.error || '打包失败')
    await tiku.openPath(r.path)
    showToast(`全量数据已打包（${(r.size / 1024 / 1024).toFixed(1)} MB），可在文件管理器查看`, 'ok')
  } catch (e) { showToast('导出失败：' + (e.message || '未知错误'), 'err') }
}

function fmtTs(ts) {
  const d = new Date(Number(ts))
  if (isNaN(d.getTime())) return '-'
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtTime(ts) {
  if (!ts) return '从未同步'
  const diff = Date.now() - Number(ts)
  if (diff < 60000) return '刚刚'
  const min = Math.floor(diff / 60000)
  if (min < 60) return min + ' 分钟前'
  const hr = Math.floor(min / 60)
  if (hr < 24) return hr + ' 小时前'
  const day = Math.floor(hr / 24)
  if (day < 7) return day + ' 天前'
  // 超过一周回退绝对时间，避免「3 周前」这类不直观表达
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

async function importData(event) {
  const file = event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const json = e.target.result
      // 1) 差异预览：导入前让用户看清会新增/覆盖什么
      const d = await tiku.importPreview(json)
      const q = d.questions
      const parts = []
      if (q && q.total) parts.push(`题库：新增 ${q.fresh} · 覆盖 ${q.update} · 本地独有 ${q.localOnly} 保留`)
      if (d.categories && d.categories.total) parts.push(`章节：${d.categories.total} 条`)
      if (d.kbDocs && d.kbDocs.total) parts.push(`知识文档：${d.kbDocs.total} 篇`)
      if (d.notes && d.notes.total) parts.push(`笔记：${d.notes.total} 条`)
      if (d.otherTables) parts.push(`反馈数据：${d.otherTables} 类`)
      const lines = [
        '备份文件内容与当前库的差异：',
        ...(parts.length ? parts.map(x => '· ' + x) : ['· 未识别到题库/文档数据']),
        '',
        '导入会按记录 id 覆盖已有数据（同 id），新增的记录直接加入；',
        '本地独有记录不会删除。确定继续？'
      ]
      const ok = await showConfirm(lines.join('\n'), { title: '导入备份确认' })
      if (!ok) return
      const r = await tiku.importData(json)
      showToast(`导入成功：${r.imported} 题 · ${r.kbDocs || 0} 篇文档`, 'ok')
    } catch (err) {
      showToast('导入失败：' + (err.message || String(err)), 'err')
    }
  }
  reader.readAsText(file)
  event.target.value = ''
}

// ---- 外观 / 偏好 ----
const theme = ref('dark')
const fontScale = ref('1')
const dailyGoal = ref(0)
const examDate = ref('') // 目标考试日（YYYY-MM-DD），首页显示倒计时
const remindEnabled = ref(false)
const autoSync = ref(true)
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
function setExamDate(v) {
  examDate.value = v || ''
  tiku.setSetting('exam_date', v || '')
}
async function setRemindEnabled(v) {
  remindEnabled.value = !!v
  await tiku.setSetting('remind_enabled', remindEnabled.value ? '1' : '0')
}

async function setAutoSync(v) {
  autoSync.value = !!v
  await tiku.setSetting('auto_sync', autoSync.value ? '1' : '0')
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
    const [t, f, g, ach, re, rt, kb, x, ed] = await Promise.all([
      tiku.getSetting('theme'), tiku.getSetting('font_scale'),
      tiku.getSetting('daily_goal'), tiku.getAchievements(),
      tiku.getSetting('remind_enabled'), tiku.getSetting('remind_time'),
      tiku.kbStats(), tiku.xpStats(), tiku.getSetting('exam_date')
    ])
    theme.value = t || 'dark'
    fontScale.value = f || '1'
    dailyGoal.value = Number(g) || 0
    examDate.value = ed || ''
    metrics.value = ach
    remindEnabled.value = re === '1'
    autoSync.value = await tiku.getSetting('auto_sync').then(v => v !== '0').catch(() => true)
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
        <span class="sec-icon sec-icon-learn"><Icon name="chart" :size="16" /></span>
        <span class="sec-title">学习成长</span>
        <span class="sec-badge">{{ unlockedCount }} 成就</span>
        <span class="sec-arrow" :class="{ open: secOpen.learn }"><Icon name="chevron-down" :size="14" /></span>
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
            <span class="ach-pct" :class="{ done: a.got }">
              <template v-if="a.got"><Icon name="check" :size="14"/> 已达成</template>
              <template v-else>{{ a.fmtText }}</template>
            </span>
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


    <div class="sec">
      <div class="sec-head" @click="toggleSec('prefs')">
        <span class="sec-icon sec-icon-prefs"><Icon name="settings" :size="16" /></span>
        <span class="sec-title">偏好设置</span>
        <span class="sec-arrow" :class="{ open: secOpen.prefs }"><Icon name="chevron-down" :size="14" /></span>
      </div>
      <div v-show="secOpen.prefs" class="sec-body">

    <!-- 偏好设置 -->
    <div class="card">
      <div class="card-title">偏好设置</div>
      <div class="pref-row">
        <span class="pref-label">主题</span>
        <div class="theme-palette">
          <button class="theme-swatch" :class="{ on: theme === 'dark' }" @click="setTheme('dark')">
            <i class="sw-dot" style="background:#1a1f2e"></i><span>深色</span>
          </button>
          <button class="theme-swatch" :class="{ on: theme === 'light' }" @click="setTheme('light')">
            <i class="sw-dot" style="background:#eef1f6"></i><span>浅色</span>
          </button>
          <button class="theme-swatch" :class="{ on: theme === 'eye' }" @click="setTheme('eye')">
            <i class="sw-dot" style="background:#e9f0e6"></i><span>护眼绿</span>
          </button>
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
        <span class="pref-label">目标考试日</span>
        <input class="pref-input" type="date" :value="examDate" @change="setExamDate($event.target.value)" />
        <span class="pref-sub">首页显示倒计时与每日计划</span>
      </div>
      <div class="pref-row">
        <span class="pref-label">学习提醒</span>
        <input class="pref-input pref-time" type="time" :value="remindTime" @change="setRemindTime($event.target.value)" />
        <label class="pref-switch">
          <input type="checkbox" :checked="remindEnabled" @change="setRemindEnabled($event.target.checked)" />
          <span class="pref-switch-slider"></span>
        </label>
      </div>
      <div class="pref-row">
        <span class="pref-label">自动同步</span>
        <span class="pref-sub">启动与每 60 分钟静默同步</span>
        <label class="pref-switch">
          <input type="checkbox" :checked="autoSync" @change="setAutoSync($event.target.checked)" />
          <span class="pref-switch-slider"></span>
        </label>
      </div>
    </div>

      </div>
    </div>


    <!-- 习惯管理 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('habits')">
        <span class="sec-icon sec-icon-habits"><Icon name="refresh" :size="16" /></span>
        <span class="sec-title">习惯管理</span>
        <span class="sec-badge">{{ habits.length }} 个</span>
        <span class="sec-arrow" :class="{ open: secOpen.habits }"><Icon name="chevron-down" :size="14" /></span>
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


    <!-- 云同步与数据 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('sync')">
        <span class="sec-icon sec-icon-sync"><Icon name="cloud" :size="16" /></span>
        <span class="sec-title">云同步与数据</span>
        <span class="sec-badge" :class="{ ok: syncConnected }">{{ syncConnected ? '已连接' : '未连接' }}</span>
        <span class="sec-arrow" :class="{ open: secOpen.sync }"><Icon name="chevron-down" :size="14" /></span>
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
        <div v-if="conflictItems.length" class="conflict-list">
          <div class="cl-head" @click="conflictOpen = !conflictOpen">
            <span>本次冲突明细（{{ conflictItems.length }} 条）</span>
            <span class="cl-toggle">{{ conflictOpen ? '收起 ▲' : '展开 ▼' }}</span>
          </div>
          <div v-show="conflictOpen" class="cl-body">
            <div v-for="(c, i) in conflictItems" :key="i" class="cl-item">
              <span class="cl-table">{{ c.table }}</span>
              <span class="cl-key">#{{ c.key }}</span>
              <span class="cl-times">本地 {{ fmtTs(c.localAt) }} / 远端 {{ fmtTs(c.remoteAt) }}</span>
            </div>
            <div class="cl-note">已自动保留时间戳较新的一版；如需保留另一版，可在对应端修改后再同步。</div>
          </div>
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
      <div class="list-item" @click="showCats = true">
        <span class="title">科目管理</span>
        <span class="sub">新建 / 改名 / 删除科目与章节</span>
        <span class="arrow">›</span>
      </div>
      <div class="list-item" @click="cleanupImages">
        <span class="title">清理无用图片</span>
        <span class="sub">回收未使用的题图，释放存储空间</span>
        <span class="arrow">›</span>
      </div>
      <div class="list-item" @click="exportWrong">
        <span class="title">导出错题本</span>
        <span class="sub">生成 Markdown 在文件管理器中打开</span>
        <span class="arrow">›</span>
      </div>
      <div class="list-item" @click="exportNotes">
        <span class="title">导出笔记</span>
        <span class="sub">生成 Markdown 在文件管理器中打开</span>
        <span class="arrow">›</span>
      </div>
      <div class="list-item" @click="exportZip">
        <span class="title">导出全量数据 ZIP</span>
        <span class="sub">题库 + 图片 + 音频 + 知识库一键打包，可迁移</span>
        <span class="arrow">›</span>
      </div>
      <div class="list-item" @click="clearLocal">
        <span class="title danger">清空本地学习数据</span>
        <span class="arrow">›</span>
      </div>
    </div>


      </div>
    </div>


    <!-- 错题与收藏 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('misc')">
        <span class="sec-icon sec-icon-misc"><Icon name="note" :size="16" /></span>
        <span class="sec-title">错题与收藏</span>
        <span class="sec-arrow" :class="{ open: secOpen.misc }"><Icon name="chevron-down" :size="14" /></span>
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


    <!-- 其它 -->
    <div class="sec">
      <div class="sec-head sec-head-link" @click="showChapter = true">
        <span class="sec-icon sec-icon-chapter"><Icon name="bookmark" :size="16" /></span>
        <span class="sec-title">章节进度</span>
        <span class="sec-arrow-r"><Icon name="chevron-right" :size="14" /></span>
      </div>
    </div>
    <div class="sec">
      <div class="sec-head sec-head-link" @click="showAbout = true">
        <span class="sec-icon sec-icon-about"><Icon name="info" :size="16" /></span>
        <span class="sec-title">关于我们</span>
        <span class="sec-arrow-r"><Icon name="chevron-right" :size="14" /></span>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <NotesList :show="showNotes" @close="showNotes = false" />
    <ChapterProgress :show="showChapter" @close="showChapter = false" />
    <AboutModal :show="showAbout" @close="showAbout = false" />
    <BackupModal :show="showBackup" @close="showBackup = false" />
    <CategoryManager :show="showCats" @close="showCats = false" />
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
/* ===== 分组列表（精细化） ===== */
.sec { display: flex; flex-direction: column; }

.sec-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  user-select: none;
  transition: background .2s, border-color .2s;
}
.sec-head:hover {
  background: rgba(91, 124, 250, 0.06);
  border-color: rgba(91, 124, 250, 0.32);
}
.sec-head:hover .sec-title { color: var(--brand); }

/* 颜色化图标芯片（每个分组一个语义色） */
.sec-icon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform .2s;
}
.sec-head:hover .sec-icon { transform: scale(1.06); }
.sec-icon-learn   { background: rgba(47, 191, 143, 0.14);  color: var(--ok); }
.sec-icon-prefs   { background: rgba(91, 124, 250, 0.14);  color: var(--brand); }
.sec-icon-habits  { background: rgba(167, 139, 250, 0.16); color: #a78bfa; }
.sec-icon-sync    { background: rgba(34, 211, 238, 0.14);  color: #22d3ee; }
.sec-icon-misc    { background: rgba(251, 113, 133, 0.14); color: #fb7185; }
.sec-icon-chapter { background: rgba(251, 191, 36, 0.14);  color: #fbbf24; }
.sec-icon-about   { background: rgba(148, 163, 184, 0.16); color: var(--muted); }

.sec-title { font-size: 14px; font-weight: 600; color: var(--text); flex: 1; transition: color .2s; }

.sec-badge {
  font-size: 11px;
  font-weight: 500;
  color: var(--brand);
  background: var(--brand-light);
  padding: 2px 9px;
  border-radius: 999px;
  border: none;
  line-height: 1.6;
  white-space: nowrap;
}
.sec-badge.ok { color: var(--ok); background: rgba(47, 191, 143, 0.14); }

.sec-arrow {
  display: inline-flex;
  color: var(--muted);
  transition: transform .25s, color .2s;
}
.sec-arrow :deep(.icon) { display: block; }
.sec-arrow.open { transform: rotate(180deg); color: var(--brand); }
.sec-head:hover .sec-arrow { color: var(--brand); }

.sec-head-link:hover .sec-arrow-r { color: var(--brand); transform: translateX(2px); }
.sec-arrow-r {
  display: inline-flex;
  color: var(--muted);
  transition: transform .2s, color .2s;
}
.sec-arrow-r :deep(.icon) { display: block; }

.sec-body { display: flex; flex-direction: column; gap: 12px; padding: 4px 4px 4px; margin-top: 4px; }
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
  background: var(--toast-bg);
  color: var(--text);
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 13px;
  z-index: 100;
  border: 1px solid var(--line);
  box-shadow: var(--glow-soft);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
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
.pref-sub { flex: 1; color: var(--muted); font-size: 11px; }

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

/* 同步冲突明细 */
.conflict-list { margin-top: 10px; border: 1px solid rgba(255, 160, 60, 0.35); border-radius: 10px; padding: 8px 10px; background: rgba(255, 160, 60, 0.06); }
.cl-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--warn); cursor: pointer; font-weight: 600; }
.cl-toggle { font-weight: 400; }
.cl-body { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
.cl-item { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text); }
.cl-table { flex: 0 0 auto; background: var(--line); border-radius: 4px; padding: 1px 6px; font-weight: 600; }
.cl-key { flex: 0 0 auto; color: var(--muted); }
.cl-times { flex: 1; color: var(--muted); text-align: right; }
.cl-note { margin-top: 6px; font-size: 10px; color: var(--muted); }

/* 主题色板（方向 12） */
.theme-palette { display: flex; gap: 8px; }
.theme-swatch {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  font-size: 11px; color: var(--muted); background: transparent; border: 1px solid var(--line);
  border-radius: 10px; padding: 8px 10px; cursor: pointer; transition: all .15s;
}
.theme-swatch.on { border-color: var(--brand); color: var(--text); box-shadow: var(--glow-soft); }
.sw-dot { width: 30px; height: 22px; border-radius: 6px; border: 1px solid var(--line); }
</style>
