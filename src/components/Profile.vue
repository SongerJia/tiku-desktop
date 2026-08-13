<script setup>
import Icon from './Icon.vue'
import CountUp from './CountUp.vue'
import { showConfirm } from '../utils/confirm.js'
import { evaluate, achLevel, ACH_SERIES } from '../utils/achievements.js'
import { vTilt } from '../utils/tilt.js'
import { ref, onMounted, computed } from 'vue'
import { tiku } from '../api/tiku.js'
import { applyAppearance } from '../utils/appearance.js'
import WrongBook from './WrongBook.vue'
import Favorites from './Favorites.vue'
import NotesList from './NotesList.vue'
import ChapterProgress from './ChapterProgress.vue'
import AboutModal from './AboutModal.vue'
import BackupModal from './BackupModal.vue'
import CategoryManager from './CategoryManager.vue'

const emit = defineEmits(['reset', 'start', 'open-bank', 'goto-kb-all'])

function forwardStart(payload) {
  emit('start', payload)
}

const userName = ref('本地用户')
const toast = ref('')
const showNotes = ref(false)

// ---- GitHub 仓库同步（唯一后端：数据快照 + 知识库文档 + 题目图片）----
const ghToken = ref('')
const ghOwner = ref('')
const ghRepo = ref('')
const ghLast = ref(0)
const ghSyncing = ref(false)
const ghResult = ref(null)
const ghHasToken = ref(false)
async function ghLoad() {
  try {
    const c = await tiku.ghGetConfig()
    ghHasToken.value = c.hasToken
    ghOwner.value = c.owner
    ghRepo.value = c.repo
    ghLast.value = c.lastSync
  } catch (e) {}
}
async function ghTest() {
  if (!ghOwner.value.trim() || !ghRepo.value.trim()) { showToast('请先填写仓库拥有者和仓库名'); return }
  try {
    // token 留空则用已保存的（主进程兜底）
    await tiku.ghTest({ token: ghToken.value, owner: ghOwner.value, repo: ghRepo.value })
    showToast('仓库连接成功', 'ok')
  } catch (e) { showToast('仓库连接失败：' + (e.message || e), 'err') }
}
async function ghSave() {
  if (!ghOwner.value.trim() || !ghRepo.value.trim()) { showToast('请填写仓库拥有者和仓库名'); return }
  if (!ghToken.value.trim() && !ghHasToken.value) { showToast('请填写 GitHub Token（或已保存过则留空）'); return }
  await tiku.ghSaveConfig({ token: ghToken.value, owner: ghOwner.value, repo: ghRepo.value })
  ghHasToken.value = ghHasToken.value || !!ghToken.value.trim()
  ghToken.value = '' // 不回显明文
  showToast('仓库配置已保存', 'ok')
}
async function ghDoSync() {
  if (!ghOwner.value.trim() || !ghRepo.value.trim() || (!ghToken.value.trim() && !ghHasToken.value)) { showToast('请先完成配置（Token / 拥有者 / 仓库名）'); return }
  // 自动保存当前输入（避免忘记先点「保存配置」）
  try { await tiku.ghSaveConfig({ token: ghToken.value, owner: ghOwner.value, repo: ghRepo.value }) } catch (e) {}
  ghSyncing.value = true
  try {
    const r = await tiku.ghSync()
    ghResult.value = r
    ghLast.value = Date.now()
    const failed = (r.failedKbUp || []).length + (r.failedKbDown || []).length + (r.failedImgUp || []).length + (r.failedImgDown || []).length
    let msg = `同步完成（数据 ${(r.dataBytes / 1024).toFixed(0)}KB · 图片 +${r.imgUp}/-${r.imgDown} · 文档 +${r.kbUp}/-${r.kbDown}）`
    if (r.merged && r.merged.conflicts) msg += ` · 冲突 ${r.merged.conflicts} 条已按时间戳覆盖`
    if (failed) msg += ` · ${failed} 个文件失败，下次同步重试`
    showToast(msg, failed ? 'err' : 'ok')
  } catch (e) { showToast('同步失败：' + (e.message || e), 'err') }
  finally { ghSyncing.value = false }
}

const showChapter = ref(false)
const showAbout = ref(false)
const showBackup = ref(false)
const showCats = ref(false)

onMounted(async () => {
  try { ghLoad() } catch (e) { /* 同步配置读取失败不阻塞页面 */ }
})

function showToast(msg) {
  toast.value = msg
  setTimeout(() => toast.value = '', 2400)
}

async function clearLocal() {
  const ok = await showConfirm('清空本地学习数据？\n将删除全部答题记录、错题本、收藏、笔记、XP、记忆卡、番茄记录、复习日志与每日一题连击，且不可恢复。\n（题库与知识库文档不受影响）')
  if (!ok) return
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
const examDate = ref('') // 目标考试日（YYYY-MM-DD），首页显示倒计时
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
async function setExamDate(v) {
  examDate.value = v || ''
  await tiku.setSetting(goalKey('exam_date'), v || '')
}

// ---- 学习目标（按科目存，未设置不显示每日任务；跟随科目选择器）----
const goalSubjects = ref([])
const goalSubjectId = ref(null) // null = 全部科目（全局兜底）
const dailyGoal = ref(0)
const reviewGoal = ref(0)
const readGoal = ref(0)
// 科目 key：选中具体科目 → daily_goal_{id}；全部 → daily_goal
const goalKey = (base) => goalSubjectId.value ? `${base}_${goalSubjectId.value}` : base
async function loadGoals() {
  try { goalSubjects.value = await tiku.getSubjects() } catch (e) { goalSubjects.value = [] }
  dailyGoal.value = Number((await tiku.getSetting(goalKey('daily_goal'))) || 0)
  reviewGoal.value = Number((await tiku.getSetting(goalKey('review_goal'))) || 0)
  readGoal.value = Number((await tiku.getSetting(goalKey('read_goal'))) || 0)
  examDate.value = (await tiku.getSetting(goalKey('exam_date'))) || ''
}
async function setDailyGoal(v) {
  dailyGoal.value = Number(v) || 0
  await tiku.setSetting(goalKey('daily_goal'), String(dailyGoal.value))
}
async function setReviewGoal(v) {
  reviewGoal.value = Number(v) || 0
  await tiku.setSetting(goalKey('review_goal'), String(reviewGoal.value))
}
async function setReadGoal(v) {
  readGoal.value = Number(v) || 0
  await tiku.setSetting(goalKey('read_goal'), String(readGoal.value))
}

// ---- 游戏化成就（指标来自 getAchievements，成就定义在前端派生）----
const metrics = ref(null)
// 游戏化成就：evaluate 统一计算（含系列/稀有度/点数/解锁时间/隐藏状态）
const achievements = computed(() => metrics.value ? evaluate(metrics.value) : [])
const unlockedCount = computed(() => achievements.value.filter(a => a.got).length)
const achPoints = computed(() => achievements.value.filter(a => a.got).reduce((s, a) => s + (a.points || 0), 0))
const achLv = computed(() => achLevel(achPoints.value))
const achPct = computed(() => achievements.value.length ? Math.round((unlockedCount.value / achievements.value.length) * 100) : 0)
// 系列折叠状态（默认全部展开）
const achOpen = ref(new Set(ACH_SERIES.map(s => s.key)))
function toggleAchSeries(key) {
  const s = new Set(achOpen.value)
  if (s.has(key)) s.delete(key); else s.add(key)
  achOpen.value = s
}
// 按系列分组，每组带系列内进度
const achSeries = computed(() => ACH_SERIES.map(sr => {
  const list = achievements.value.filter(a => a.series === sr.key)
  return { ...sr, list, got: list.filter(a => a.got).length, total: list.length }
}).filter(s => s.list.length))
// 最近解锁（成就墙高亮：按解锁日期最新 4 个，替代 toast 一闪而过）
const recentUnlocked = computed(() => achievements.value
  .filter(a => a.got && a.unlockAt)
  .sort((a, b) => String(b.unlockAt).localeCompare(String(a.unlockAt)))
  .slice(0, 4))

// ---- 知识库概览（kbStats）----
const kbStats = ref(null)

// 页面分组折叠：学习成长默认展开，其余收起（避免平铺过长）
const secOpen = ref({ learn: true, goals: true, prefs: false, sync: false, misc: false })
function toggleSec(k) {
  secOpen.value[k] = !secOpen.value[k]
}

onMounted(async () => {
  const [tR, fR, achR, kbR, msR] = await Promise.allSettled([
    tiku.getSetting('theme'), tiku.getSetting('font_scale'),
    tiku.getAchievements(),
    tiku.kbStats(),
    tiku.getMonthStats()
  ])
  if (tR.status === 'fulfilled') theme.value = tR.value || 'dark'
  if (fR.status === 'fulfilled') fontScale.value = fR.value || '1'
  if (kbR.status === 'fulfilled') kbStats.value = kbR.value
  if (achR.status === 'fulfilled' && msR.status === 'fulfilled') metrics.value = { ...achR.value, ...msR.value }
  try { await loadGoals() } catch (e) { /* 目标读取失败不阻塞 */ }
})
</script>

<template>
  <div class="profile">
    <!-- 用户信息 + XP 等级（紧凑右侧） -->
    <div class="card user-card" v-tilt="{ deg: 3 }">
      <div class="avatar">{{ userName.slice(0, 1) }}</div>
      <div class="user-info">
        <div class="user-name">{{ userName }}<span class="local-badge">本地</span></div>
        <div class="user-sub">数据只在本机 · 断网也能学</div>
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

    <!-- 知识库概览（点击进入全部科目管理） -->
    <div v-if="kbStats" class="card kb-overview-card" v-tilt="{ deg: 3 }" @click="emit('goto-kb-all')">
      <div class="card-title">知识库概览 <span class="kb-go">管理全部文档 ›</span></div>
      <div class="kb-stats">
        <div class="kb-stat"><b>{{ kbStats.docs }}</b><span>文档</span></div>
        <div class="kb-stat"><b>{{ kbStats.blocks }}</b><span>文本块</span></div>
        <div class="kb-stat"><b>{{ kbStats.links }}</b><span>题目联动</span></div>
        <div class="kb-stat"><b>{{ kbStats.readCount }}</b><span>阅读次数</span></div>
        <div class="kb-stat"><b>{{ kbStats.tags }}</b><span>标签</span></div>
        <div class="kb-stat"><b>{{ kbStats.folders }}</b><span>文件夹</span></div>
      </div>
    </div>

    <!-- 游戏化成就：概览条 + 系列分组 + 三态成就卡 -->
    <div class="card ach-card" v-tilt="{ deg: 3 }">
      <!-- 概览条 -->
      <div class="ach-summary">
        <span class="ach-lv" :style="{ borderColor: achLv.min >= 600 ? '#7b46c4' : achLv.min >= 300 ? '#d9a514' : achLv.min >= 100 ? '#8a97a5' : '#b87333' }">{{ achLv.icon }} {{ achLv.name }}</span>
        <span class="ach-sum-item"><b>{{ achPoints }}</b>成就点数</span>
        <span class="ach-sum-item"><b>{{ unlockedCount }}/{{ achievements.length }}</b>已解锁</span>
        <span class="ach-sum-item"><b>{{ achPct }}%</b>完成率</span>
        <span class="ach-sum-ring" :style="{ background: `conic-gradient(var(--brand) ${achPct * 3.6}deg, var(--line) 0deg)` }"></span>
      </div>

      <!-- 最近解锁（高亮条） -->
      <div v-if="recentUnlocked.length" class="ach-recent">
        <div v-for="a in recentUnlocked" :key="'recent' + a.key" class="ach-recent-item">
          <span class="ari-icon">{{ a.icon }}</span>
          <span class="ari-name">{{ a.name }}</span>
          <span class="ari-date">{{ (a.unlockAt || '').slice(5).replace('-', '/') }} 解锁</span>
        </div>
      </div>

      <!-- 系列分组 -->
      <div v-for="sr in achSeries" :key="sr.key" class="ach-series">
        <div class="ach-series-head" @click="toggleAchSeries(sr.key)">
          <span class="ach-series-icon">{{ sr.icon }}</span>
          <span class="ach-series-name">{{ sr.name }}</span>
          <span class="ach-series-prog">{{ sr.got }}/{{ sr.total }}</span>
          <span class="ach-series-arrow" :class="{ open: achOpen.has(sr.key) }">▾</span>
        </div>
        <div v-show="achOpen.has(sr.key)" class="ach-grid">
          <div
            v-for="a in sr.list"
            :key="a.key"
            class="ach"
            :class="{ got: a.got, hidden: a.hidden && !a.got }"
          >
            <div class="ach-head">
              <span class="ach-icon" :style="a.got ? { filter: 'none' } : {}">
                {{ a.got ? a.icon : (a.hidden ? '❓' : '🔒') }}
              </span>
              <span class="ach-name">
                {{ a.got || !a.hidden ? a.name : '？？？' }}
              </span>
              <span class="ach-pct" :class="{ done: a.got }">
                <template v-if="a.got">{{ a.unlockAt || '已解锁' }}</template>
                <template v-else-if="a.hidden">？？？</template>
                <template v-else>{{ a.fmtText }}</template>
              </span>
            </div>
            <span class="ach-desc" v-if="a.got || !a.hidden">{{ a.desc }}<template v-if="!a.got"> · +{{ a.points }} 点</template></span>
            <span class="ach-desc" v-else>解锁后揭晓</span>
            <div class="ach-bar" v-if="!a.hidden || a.got">
              <div class="ach-fill" :class="{ done: a.got }" :style="{ width: a.pct + '%' }"></div>
            </div>
            <div class="ach-bar" v-else></div>
          </div>
        </div>
      </div>
      <div v-if="!achSeries.length" class="ach-empty">还没有成就数据，先刷几道题吧</div>
    </div>
      </div>
    </div>


    <!-- 学习目标（按科目存，未设置不显示每日任务） -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('goals')">
        <span class="sec-icon sec-icon-goals"><Icon name="target" :size="16" /></span>
        <span class="sec-title">学习目标</span>
        <span class="sec-arrow" :class="{ open: secOpen.goals }"><Icon name="chevron-down" :size="14" /></span>
      </div>
      <div v-show="secOpen.goals" class="sec-body">

    <div class="card goal-card">
      <div class="card-title">学习目标 <span class="goal-scope">设置后每日任务自动生成，达标 +20 XP</span></div>
      <div class="goal-row">
        <span class="goal-label">科目</span>
        <select class="goal-select" :value="goalSubjectId ?? ''" @change="goalSubjectId = $event.target.value || null; loadGoals()">
          <option value="">全部科目（全局）</option>
          <option v-for="s in goalSubjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <div class="goal-row">
        <span class="goal-label">每日刷题</span>
        <input class="pref-input" type="number" min="0" :value="dailyGoal" @change="setDailyGoal($event.target.value)" placeholder="0=不设置" />
        <span class="pref-unit">题/天 · 展示在首页 KPI</span>
      </div>
      <div class="goal-row">
        <span class="goal-label">每日复习</span>
        <input class="pref-input" type="number" min="0" :value="reviewGoal" @change="setReviewGoal($event.target.value)" placeholder="0=不设置" />
        <span class="pref-unit">条/天</span>
      </div>
      <div class="goal-row">
        <span class="goal-label">每日阅读</span>
        <input class="pref-input" type="number" min="0" :value="readGoal" @change="setReadGoal($event.target.value)" placeholder="0=不设置" />
        <span class="pref-unit">篇/天</span>
      </div>
      <div class="goal-row">
        <span class="goal-label">目标考试日</span>
        <input class="pref-input goal-date" type="date" :value="examDate" @change="setExamDate($event.target.value)" />
        <span class="pref-unit">首页倒计时</span>
      </div>
      <div class="goal-tip">未设置的目标不在「每日任务」显示；设 0 即取消该目标</div>
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
    </div>

      </div>
    </div>


    <!-- 云同步与数据 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('sync')">
        <span class="sec-icon sec-icon-sync"><Icon name="cloud" :size="16" /></span>
        <span class="sec-title">云同步与数据</span>
        <span class="sec-arrow" :class="{ open: secOpen.sync }"><Icon name="chevron-down" :size="14" /></span>
      </div>
      <div v-show="secOpen.sync" class="sec-body">

    <!-- GitHub 仓库同步（唯一后端：学习数据+题库+知识库文档+题目图片） -->
    <div class="card">
      <div class="card-title">云盘同步（GitHub 仓库）</div>
      <p class="sync-tip">
        用 GitHub 私有仓库同步<b>全部数据</b>（学习数据 + 题库 + 知识库文档 + 题目图片），跨 Windows / macOS / 安卓。
        <br />Token 需有 <code>repo</code> 权限（GitHub → Settings → Developer settings → Personal access tokens）。<b>建议仓库设为 Private</b>（学习数据含个人隐私）。
      </p>
      <div v-if="ghHasToken && !ghToken" class="sync-row sub" style="margin:6px 0 8px">
        <span class="sync-dot" style="background:var(--ok)"></span>
        <span><b>Token 已配置</b>（留空保持不变，无需重新填写）</span>
      </div>
      <div class="wd-form">
        <input v-model="ghToken" class="sync-input" type="password" :placeholder="ghHasToken ? 'Token 已配置（留空保持不变）' : 'GitHub Token（ghp_...，需 repo 权限）'" @keyup.enter="ghSave" />
        <input v-model="ghOwner" class="sync-input" placeholder="仓库拥有者（GitHub 用户名）" @keyup.enter="ghSave" />
        <input v-model="ghRepo" class="sync-input" placeholder="仓库名（如 tiku-assets）" @keyup.enter="ghSave" />
        <div class="sync-actions">
          <button class="btn" :disabled="ghSyncing" @click="ghTest">测试连接</button>
          <button class="btn" :disabled="ghSyncing" @click="ghSave">保存配置</button>
          <button class="btn btn-primary" :disabled="ghSyncing" @click="ghDoSync">
            {{ ghSyncing ? '同步中…' : '立即同步' }}
          </button>
        </div>
        <div v-if="ghLast" class="sync-row sub">上次同步：{{ fmtTime(ghLast) }}</div>
        <div v-if="ghResult" class="wd-result">
          同步完成：数据 {{ (ghResult.dataBytes / 1024).toFixed(0) }}KB · 图片 +{{ ghResult.imgUp }}/-{{ ghResult.imgDown }} · 文档 +{{ ghResult.kbUp }}/-{{ ghResult.kbDown }}
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
  </div>
</template>

<style scoped>
.user-card {
  display: flex;
  align-items: center;
  gap: 14px;
}
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
.sec-icon-goals   { background: rgba(91, 124, 250, 0.14);  color: var(--brand); }
.sec-icon-prefs   { background: rgba(91, 124, 250, 0.14);  color: var(--brand); }
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
  background: linear-gradient(135deg, var(--brand), var(--brand2, #7a5cff));
  color: #fff;
  font-size: 22px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(91, 124, 250, 0.15), 0 4px 14px rgba(91, 124, 250, 0.35);
  transition: transform .2s ease, box-shadow .2s ease;
}
.user-card:hover .avatar { transform: scale(1.06); box-shadow: 0 0 0 4px rgba(91, 124, 250, 0.24), 0 6px 18px rgba(91, 124, 250, 0.5); }
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
.wd-form { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.wd-result { font-size: 12px; color: var(--ok); }
.gh-title { margin-top: 14px; }
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
.seg button.on { background: var(--brand); color: #fff; font-weight: 600; }
.pref-range { flex: 1; accent-color: var(--brand); }
.pref-input { width: 80px; background: var(--input-solid-bg); border: 1px solid var(--line); border-radius: 8px; color: var(--text); padding: 6px 10px; font-size: 13px; outline: none; font-family: inherit; }
.pref-input:focus { border-color: var(--brand); }
.kb-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }.kb-stat {
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


.pref-unit { color: var(--muted); font-size: 12px; }
.pref-sub { flex: 1; color: var(--muted); font-size: 11px; }
.goal-date { flex: 1; width: auto; min-width: 0; }

/* 学习目标 */
.goal-card { border-color: rgba(91, 124, 250, 0.4); }
.goal-scope { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 6px; }
.goal-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 0.5px solid rgba(148, 163, 184, 0.12); }
.goal-row:last-of-type { border-bottom: none; }
.goal-label { width: 64px; font-size: 13px; color: var(--text); flex-shrink: 0; }
.goal-select { flex: 0 0 auto; background: var(--input-solid-bg); border: 1px solid var(--line); border-radius: 8px; color: var(--text); padding: 6px 10px; font-size: 13px; outline: none; font-family: inherit; }
.goal-tip { font-size: 11px; color: var(--muted); margin-top: 8px; }

/* 成就墙 */
/* 成就中心（游戏化）：概览条 + 系列分组 + 三态卡 */
.ach-summary { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-bottom: 12px; margin-bottom: 10px; border-bottom: 1px dashed var(--line); }
.ach-lv { font-size: 13px; font-weight: 600; color: var(--text); border: 1.5px solid var(--line); border-radius: 999px; padding: 3px 12px; }
.ach-sum-item { font-size: 12px; color: var(--muted); display: inline-flex; align-items: baseline; gap: 4px; }
.ach-sum-item b { font-size: 16px; color: var(--brand); font-weight: 700; }
.ach-sum-ring { width: 30px; height: 30px; border-radius: 50%; margin-left: auto; position: relative; }
.ach-sum-ring::after { content: ''; position: absolute; inset: 6px; background: var(--bg, #fff); border-radius: 50%; }
/* 最近解锁高亮条 */
.ach-recent { display: flex; gap: 8px; padding-bottom: 12px; margin-bottom: 10px; border-bottom: 1px dashed var(--line); }
.ach-recent-item {
  flex: 1; min-width: 0; text-align: center;
  background: rgba(91, 124, 250, 0.08); border: 1px solid rgba(91, 124, 250, 0.25);
  border-radius: 10px; padding: 8px 4px;
}
.ari-icon { font-size: 17px; display: block; }
.ari-name { font-size: 11.5px; color: var(--text); display: block; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ari-date { font-size: 10.5px; color: var(--muted); display: block; margin-top: 2px; }
.ach-series { margin-bottom: 14px; }
.ach-series-head { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 4px; border-radius: 8px; }
.ach-series-head:hover { background: rgba(91,124,250,.06); }
.ach-series-icon { font-size: 15px; }
.ach-series-name { font-size: 13px; font-weight: 600; color: var(--text); }
.ach-series-prog { font-size: 11px; color: var(--muted); background: rgba(91,124,250,.1); border-radius: 999px; padding: 1px 8px; }
.ach-series-arrow { margin-left: auto; font-size: 12px; color: var(--muted); transition: transform .2s; }
.ach-series-arrow.open { transform: rotate(180deg); }
.ach-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.ach { display: flex; flex-direction: column; gap: 3px; border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: rgba(255,255,255,.02); opacity: .72; transition: all .2s; }
.ach:hover { opacity: 1; border-color: rgba(91,124,250,.5); }
.ach.got { opacity: 1; border-color: var(--brand); background: var(--brand-light); box-shadow: var(--glow-soft); }
.ach.hidden { opacity: .45; }
.ach.hidden:hover { opacity: .6; }
.ach-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ach-icon { font-size: 18px; filter: grayscale(1) brightness(.7); flex-shrink: 0; }
.ach.got .ach-icon { filter: none; }
.ach-name { font-size: 13px; font-weight: 600; color: var(--text); display: inline-flex; align-items: center; gap: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ach.got .ach-name { color: var(--brand); }
.ach-pct { margin-left: auto; font-size: 11px; color: var(--muted); white-space: nowrap; flex-shrink: 0; }
.ach-pct.done { color: var(--ok); font-weight: 600; }
.ach-desc { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
.ach-empty { font-size: 12px; color: var(--muted); text-align: center; padding: 12px 0; }

/* 同步冲突明细 */

/* 主题色板（方向 12） */
.theme-palette { display: flex; gap: 8px; }
.theme-swatch {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  font-size: 11px; color: var(--muted); background: transparent; border: 1px solid var(--line);
  border-radius: 10px; padding: 8px 10px; cursor: pointer; transition: all .15s;
}
.theme-swatch.on { border-color: var(--brand); color: var(--text); box-shadow: var(--glow-soft); }
.sw-dot { width: 30px; height: 22px; border-radius: 6px; border: 1px solid var(--line); }
.kb-overview-card { cursor: pointer; transition: border-color .15s; }
.kb-overview-card:hover { border-color: var(--brand); }
.kb-go { font-size: 11px; color: var(--brand); font-weight: 600; margin-left: 6px; }

/* ===== 我的页铺开（2026-08-12）：渐变语言 / 流光 ===== */
/* 用户卡/成就墙卡：渐变边框（门面） */
.user-card, .ach-card {
  border: 1px solid transparent;
  background-image:
    linear-gradient(var(--card), var(--card)),
    linear-gradient(135deg, rgba(91, 124, 250, 0.4), rgba(122, 92, 255, 0.4));
  background-origin: border-box;
  background-clip: padding-box, border-box;
  position: relative;
}
/* 成就墙卡 hover 流光 */
.ach-card::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  padding: 1px;
  background: conic-gradient(from var(--ang), transparent 0deg, rgba(91, 124, 250, 0.7) 80deg, transparent 170deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0; pointer-events: none; transition: opacity .18s;
}
.ach-card:hover::after { opacity: 1; animation: angSpin 2.2s linear infinite; }

/* 成就数字/知识库数字：渐变 */
.ach-sum-item b, .kb-stat b {
  background: linear-gradient(180deg, #f4f7ff, #a9b6da);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}
[data-theme="light"] .ach-sum-item b, [data-theme="light"] .kb-stat b { background: linear-gradient(180deg, #1f2937, #64748b); -webkit-background-clip: text; background-clip: text; }

/* ===== 我的页加浓（2026-08-12）：首页同款浓度 ===== */
/* stagger 交错入场：用户卡 → 学习成长 → 学习目标 */
.profile > * { animation: riseIn .4s cubic-bezier(.2, .7, .3, 1) both; }
.profile > *:nth-child(2) { animation-delay: .06s; }
.profile > *:nth-child(3) { animation-delay: .12s; }

@keyframes numPop { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }

/* 成就数字弹入 */
.ach-sum-item b, .kb-stat b { animation: numPop .45s cubic-bezier(.2, .7, .3, 1) both; }

/* 成就完成率环：入场弹入 */
.ach-sum-ring { animation: ringPop .5s cubic-bezier(.2, .7, .3, 1) .15s both; }
@keyframes ringPop { from { opacity: 0; transform: scale(.7); } to { opacity: 1; transform: scale(1); } }

/* 头像区：装饰光斑 */
.user-card { position: relative; overflow: hidden; }
.user-card::before {
  content: ''; position: absolute; top: -46px; right: -36px;
  width: 150px; height: 150px; border-radius: 50%;
  background: radial-gradient(circle, rgba(91, 124, 250, 0.10), transparent 62%);
  pointer-events: none;
}
/* 用户卡瘦身（2026-08-13）：顶部渐变光带 + 本地徽章 + 今日XP胶囊 */
.user-card::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 44px;
  background: linear-gradient(180deg, rgba(91, 124, 250, 0.10), transparent 65%);
  pointer-events: none;
}
.local-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; color: #4fd1a5;
  border: 1px solid rgba(47, 191, 143, 0.4);
  background: rgba(47, 191, 143, 0.1);
  border-radius: 8px; padding: 1px 7px;
  margin-left: 6px; vertical-align: 2px; white-space: nowrap;
}
.local-badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--ok); flex-shrink: 0; }
[data-theme="light"] .local-badge { color: #0f9d6b; }

</style>