<script setup>
import Icon from './Icon.vue'
import CountUp from './CountUp.vue'
import { showConfirm } from '../utils/confirm.js'
import { showToast } from '../utils/toast.js'
import { vTilt } from '../utils/tilt.js'
import { ref, onMounted, computed, nextTick, watch } from 'vue'
import { tiku } from '../api/tiku.js'
import { applyAppearance } from '../utils/appearance.js'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import WrongBook from './WrongBook.vue'
import Favorites from './Favorites.vue'
import AboutModal from './AboutModal.vue'
import BackupModal from './BackupModal.vue'
import CategoryManager from './CategoryManager.vue'

const props = defineProps({ focusSection: { type: String, default: '' } })
const emit = defineEmits(['reset', 'start', 'open-bank', 'focus-consumed'])

function forwardStart(payload) {
  emit('start', payload)
}

const userName = ref('本地用户')
const avatar = ref('') // 本地头像（base64，localStorage 存储，不进同步）
const avatarAuto = ref(false) // 当前头像是否首字生成（true=首字；false=用户上传。缺失标记按上传处理，防改名误覆盖）
const editOpen = ref(false) // 编辑资料弹窗
useBodyLock(editOpen)
useFocusTrap(editOpen, '.ep-panel')
const editName = ref('')
const fileInput = ref(null)

// 打开编辑资料弹窗（名字 + 头像统一在弹窗里编辑，避免内联输入/误触）
function openEdit() {
  editName.value = userName.value
  editOpen.value = true
}
async function saveEdit() {
  const v = editName.value.trim().slice(0, 20)
  const renamed = v && v !== userName.value
  if (renamed) {
    userName.value = v
    try { await tiku.setSetting('user_name', v) } catch (e) { /* 保存失败不阻塞 */ }
  }
  // 未上传自定义头像时：用姓名首字生成头像（首汉字或英文首字母大写）
  // 改名后仅当当前是首字头像才刷新（用户上传的头像不能被改名覆盖）
  if (!avatar.value || (renamed && avatarAuto.value)) {
    const gen = genInitialAvatar(userName.value)
    avatar.value = gen
    avatarAuto.value = true
    try { localStorage.setItem('tiku_avatar', gen); localStorage.setItem('tiku_avatar_auto', '1') } catch (e) { /* 存储失败忽略 */ }
  }
  editOpen.value = false
}
// 首字头像：姓名首个汉字或英文首字母大写 → canvas 品牌渐变圆底白字 → dataURL（与上传头像同尺寸 112px）
function genInitialAvatar(name) {
  const c = document.createElement('canvas')
  c.width = c.height = 112
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 112, 112)
  g.addColorStop(0, '#5b7cfa')
  g.addColorStop(1, '#7a5cff')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(56, 56, 56, 0, Math.PI * 2)
  ctx.fill()
  const ch = String(name || '').trim()[0] || '用'
  const text = /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 50px "Inter", "Noto Sans SC", "PingFang SC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 56, 58)
  return c.toDataURL('image/png')
}
// 换头像：本地图片 → canvas 居中裁切压缩 112px → localStorage（纯本地，不同步）
function onPickAvatar(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  // 类型/大小校验：仅图片，≤2MB（避免超大文件卡死 canvas 压缩）
  if (!/^image\//.test(f.type)) { showToast('请选择图片文件（jpg/png/webp/gif）', 'err'); e.target.value = ''; return }
  if (f.size > 2 * 1024 * 1024) { showToast('图片过大，请选择 2MB 以内的图片', 'err'); e.target.value = ''; return }
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = c.height = 112
      const ctx = c.getContext('2d')
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2
      ctx.drawImage(img, sx, sy, side, side, 0, 0, 112, 112)
      avatar.value = c.toDataURL('image/jpeg', 0.85)
      avatarAuto.value = false // 用户上传 → 标记非首字，改名不再覆盖
      try { localStorage.setItem('tiku_avatar', avatar.value); localStorage.setItem('tiku_avatar_auto', '0') } catch (err) { /* 存储失败忽略 */ }
    }
    img.onerror = () => { showToast('图片解析失败，请换一张', 'err') }
    img.src = reader.result
  }
  reader.readAsDataURL(f)
  e.target.value = ''
}
function clearAvatar() {
  avatar.value = ''
  try { localStorage.removeItem('tiku_avatar'); localStorage.removeItem('tiku_avatar_auto') } catch (e) {}
}
const showWrong = ref(false) // 错题管理弹窗
const showFav = ref(false) // 收藏管理弹窗

// ---- GitHub 仓库同步（唯一后端：数据快照 + 题目图片）----
const ghToken = ref('')
const ghOwner = ref('')
const ghRepo = ref('')
const ghLast = ref(0)
const ghSyncing = ref(false)
const ghResult = ref(null)
const ghHasToken = ref(false)
const showCfg = ref(false) // 已连接时表单收起，点「编辑配置」展开
async function ghLoad() {
  try {
    const c = await tiku.ghGetConfig()
    ghHasToken.value = c.hasToken
    ghOwner.value = c.owner
    ghRepo.value = c.repo
    ghLast.value = c.lastSync
    showCfg.value = !c.hasToken // 未连接默认展开引导，已连接默认收起
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
  showCfg.value = false // 保存成功收起表单
  showToast('仓库配置已保存', 'ok')
}
async function ghDoSync() {
  if (!ghOwner.value.trim() || !ghRepo.value.trim() || (!ghToken.value.trim() && !ghHasToken.value)) { showToast('请先完成配置（Token / 拥有者 / 仓库名）'); return }
  // 自动保存当前输入（避免忘记先点「保存配置」）
  try { await tiku.ghSaveConfig({ token: ghToken.value, owner: ghOwner.value, repo: ghRepo.value }) } catch (e) {}
  ghSyncing.value = true
  try {
    const r = await tiku.ghSync()
    const failed = (r.failedKbUp || []).length + (r.failedKbDown || []).length + (r.failedImgUp || []).length + (r.failedImgDown || []).length
    ghResult.value = { ...r, failedCount: failed }
    ghLast.value = Date.now()
    let msg = `同步完成（数据 ${(r.dataBytes / 1024).toFixed(0)}KB · 图片 +${r.imgUp}/-${r.imgDown}）`
    if (r.merged && r.merged.conflicts) msg += ` · 冲突 ${r.merged.conflicts} 条已按时间戳覆盖`
    if (failed) msg += ` · ${failed} 个文件失败，下次同步重试`
    showToast(msg, failed ? 'err' : 'ok')
  } catch (e) { showToast('同步失败：' + (e.message || e), 'err') }
  finally { ghSyncing.value = false }
}

const showAbout = ref(false)
const showBackup = ref(false)
const showCats = ref(false)

onMounted(async () => {
  try { ghLoad() } catch (e) { /* 同步配置读取失败不阻塞页面 */ }
})

async function clearLocal() {
  const ok = await showConfirm('清空本地学习数据？\n将删除全部答题记录、错题本、收藏、笔记、XP、番茄记录、复习日志与每日一题连击，且不可恢复。\n（题库不受影响）')
  if (!ok) return
  await tiku.clearUserData()
  showToast('已清空本地学习数据')
  emit('reset')
}

async function cleanupImages() {
  try {
    const [img, aud] = await Promise.all([tiku.cleanupOrphanImages(), tiku.cleanupOrphanAudio()])
    const n = img.removed + aud.removed
    const kb = (img.freedBytes + aud.freedBytes) / 1024
    if (n > 0) showToast(`已清理 ${n} 个无用文件（图片 ${img.removed} / 音频 ${aud.removed}），释放 ${kb.toFixed(1)} KB`, 'ok')
    else showToast('没有需要清理的无用文件', 'ok')
  } catch (e) {
    showToast('清理失败：' + (e.message || '未知错误'), 'err')
  }
}

async function exportWrong() {
  try {
    const file = await tiku.exportWrongBook()
    const r = await tiku.openPath(file)
    showToast(r && r.openedDir ? '错题本已导出，可在导出目录查看' : '错题本已导出并在文件管理器中打开', 'ok')
  } catch (e) { showToast('导出失败：' + (e.message || '未知错误'), 'err') }
}
async function exportNotes() {
  try {
    const file = await tiku.exportNotes()
    const r = await tiku.openPath(file)
    showToast(r && r.openedDir ? '笔记已导出，可在导出目录查看' : '笔记已导出并在文件管理器中打开', 'ok')
  } catch (e) { showToast('导出失败：' + (e.message || '未知错误'), 'err') }
}
async function exportZip() {
  try {
    const r = await tiku.exportAllZip(localStorage.getItem('tiku_avatar') || '')
    if (!r.ok) throw new Error(r.error || '打包失败')
    const o = await tiku.openPath(r.path)
    showToast(o && o.openedDir ? `全量数据已打包（${(r.size / 1024 / 1024).toFixed(1)} MB），可在导出目录查看` : `全量数据已打包（${(r.size / 1024 / 1024).toFixed(1)} MB），已打开所在目录`, 'ok')
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
  const avatarData = localStorage.getItem('tiku_avatar') || ''
  const json = await tiku.exportData(avatarData)
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
      if (d.notes && d.notes.total) parts.push(`笔记：${d.notes.total} 条`)
      if (d.settings && d.settings.total) parts.push(`偏好设置：${d.settings.total} 项（用户名/目标/主题）`)
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
      // 恢复头像/用户名显示状态（头像存 localStorage，settings 已随备份恢复）
      try {
        const d2 = JSON.parse(json)
        if (d2.avatar) {
          localStorage.setItem('tiku_avatar', d2.avatar); avatar.value = d2.avatar
          // 备份 JSON 不含头像来源标记：恢复的头像一律按「上传」处理（改名不覆盖，最安全）
          localStorage.setItem('tiku_avatar_auto', '0'); avatarAuto.value = false
        }
        const n = await tiku.getSetting('user_name')
        if (n) userName.value = n
      } catch (err) { /* 显示状态恢复失败不影响导入 */ }
      showToast(`导入成功：${r.imported} 题`, 'ok')
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
// ===== 考试日已移除 =====
async function setFontScale(v) {
  fontScale.value = v
  await tiku.setSetting('font_scale', String(v))
  await applyAppearance()
}
// 拖动只更新预览（气泡/刻度/百分比），松开（change）才应用全局字号 → 消除拖动时页面实时抖动
function onScaleDrag(e) { fontScale.value = e.target.value }
function onScaleCommit(e) { setFontScale(e.target.value) }
// ===== 考试日已移除 =====

// ---- 学习目标（按科目存，未设置不显示每日任务；跟随科目选择器）----
const goalSubjects = ref([])
const goalSubjectId = ref(null) // null = 全部科目（全局兜底）
const dailyGoal = ref(0)
// 科目 key：选中具体科目 → daily_goal_{id}；全部 → daily_goal
const goalKey = (base) => goalSubjectId.value ? `${base}_${goalSubjectId.value}` : base
async function loadGoals() {
  try { goalSubjects.value = await tiku.getSubjects() } catch (e) { goalSubjects.value = [] }
  dailyGoal.value = Number((await tiku.getSetting(goalKey('daily_goal'))) || 0)
}
async function setDailyGoal(v) {
  dailyGoal.value = Number(v) || 0
  await tiku.setSetting(goalKey('daily_goal'), String(dailyGoal.value))
}
// ===== 复习目标已移除 =====
// 数字目标步进（−/+ 按钮）：不小于 0
function stepGoal(get, set) {
  return (delta) => {
    const cur = Number(get()) || 0
    const next = Math.max(0, cur + delta)
    if (next !== cur) set(String(next))
  }
}

// ---- 游戏化成就（指标来自 getAchievements，成就定义在前端派生）----
const metrics = ref(null)
// 游戏化成就：evaluate 统一计算（含系列/稀有度/点数/解锁时间/隐藏状态）
// ===== 勋章墙已移除 =====

// 页面分组折叠：勋章墙默认展开，其余收起（避免平铺过长）
const secOpen = ref({ goals: false, prefs: false, sync: false, data: false, bank: false, misc: false })
function toggleSec(k) {
  secOpen.value[k] = !secOpen.value[k]
}
// 外部定位：首页「设置目标」→ 展开学习目标分组并滚动
watch(() => props.focusSection, (s) => {
  if (!s) return
  const map = { goals: '#sec-goals' }
  const sel = map[s]
  if (sel) {
    secOpen.value.goals = true
    nextTick(() => {
      const el = document.querySelector(sel)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  emit('focus-consumed')
}, { immediate: true })

onMounted(async () => {
  const [tR, fR, achR, msR] = await Promise.allSettled([
    tiku.getSetting('theme'), tiku.getSetting('font_scale'),
    tiku.getAchievements(),
    tiku.getMonthStats()
  ])
  if (tR.status === 'fulfilled') theme.value = tR.value || 'dark'
  if (fR.status === 'fulfilled') fontScale.value = fR.value || '1'
  try { const n = await tiku.getSetting('user_name'); if (n) userName.value = n } catch (e) {}
  try { avatar.value = localStorage.getItem('tiku_avatar') || '' } catch (e) {}
  // 恢复头像来源标记（仅显式 '1'=首字；缺失/其他=老数据按上传处理，改名不覆盖最安全）
  try { avatarAuto.value = localStorage.getItem('tiku_avatar_auto') === '1' } catch (e) { avatarAuto.value = false }
  if (achR.status === 'fulfilled' && msR.status === 'fulfilled') metrics.value = { ...achR.value, ...msR.value }
  try { await loadGoals() } catch (e) { /* 目标读取失败不阻塞 */ }
})
</script>

<template>
  <div class="profile">
    <!-- 用户信息 + XP 等级（紧凑右侧） -->
    <div class="card user-card" v-tilt="{ deg: 3, flat: true }">
      <div class="avatar-wrap">
        <img v-if="avatar" :src="avatar" class="avatar-img" alt="头像" />
        <div v-else class="avatar">{{ userName.slice(0, 1) }}</div>
      </div>
      <div class="user-info">
        <div class="user-name">
          <span class="user-name-text">{{ userName }}</span><span class="local-badge">本地</span>
          <span class="user-edit-btn" @click="openEdit" title="编辑资料">✎</span>
        </div>
        <div class="user-sub">数据只在本机 · 断网也能学</div>
      </div>
      <span class="user-aura" aria-hidden="true"></span>
    </div>

    <!-- 学习目标（按科目存，未设置不显示每日任务） -->
    <div class="sec" id="sec-goals">
      <div class="sec-head" @click="toggleSec('goals')">
        <span class="sec-icon sec-icon-goals"><Icon name="target" :size="16" /></span>
        <span class="sec-title">学习目标</span>
        <span class="sec-arrow" :class="{ open: secOpen.goals }"><Icon name="chevron-down" :size="14" /></span>
      </div>
      <div v-show="secOpen.goals" class="sec-body">

    <div class="card goal-card">
      <div class="card-title">学习目标 <span class="goal-scope">设置后每日任务自动生成，达标 +20 XP</span></div>
      <!-- 科目范围：跟随科目选择器 -->
      <div class="goal-scope-row">
        <span class="goal-scope-icon"><Icon name="grid" :size="14" /></span>
        <span class="goal-scope-label">目标科目</span>
        <select class="goal-select" :value="goalSubjectId ?? ''" @change="goalSubjectId = $event.target.value || null; loadGoals()">
          <option value="">全部科目（全局）</option>
          <option v-for="s in goalSubjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <span class="goal-scope-tip">按科目独立设目标</span>
      </div>
      <!-- 每日刷题 -->
      <div class="goal-row">
        <span class="goal-ico" style="--gc: #5b7cfa; --gc-a: 91, 124, 250"><Icon name="target" :size="15" /></span>
        <div class="goal-main">
          <span class="goal-name">每日刷题</span>
          <span class="goal-desc">首页 KPI · 今日刷题数</span>
        </div>
        <div class="goal-stepper">
          <button class="gs-btn" type="button" @click="stepGoal(() => dailyGoal, setDailyGoal)(-5)">−</button>
          <input class="goal-input" type="number" min="0" :value="dailyGoal" @change="setDailyGoal($event.target.value)" placeholder="0" />
          <button class="gs-btn" type="button" @click="stepGoal(() => dailyGoal, setDailyGoal)(5)">+</button>
        </div>
        <span class="goal-unit">题/天</span>
<span v-if="dailyGoal > 0" class="goal-on">已设</span>
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
          <button class="theme-card" :class="{ on: theme === 'dark' }" @click="setTheme('dark')">
            <span class="tc-preview tc-dark">
              <i class="tc-bar"></i>
              <i class="tc-line"></i><i class="tc-line"></i><i class="tc-line short"></i>
            </span>
            <span class="tc-name">深色</span>
            <span v-if="theme === 'dark'" class="tc-check">✓</span>
          </button>
          <button class="theme-card" :class="{ on: theme === 'light' }" @click="setTheme('light')">
            <span class="tc-preview tc-light">
              <i class="tc-bar"></i>
              <i class="tc-line"></i><i class="tc-line"></i><i class="tc-line short"></i>
            </span>
            <span class="tc-name">浅色</span>
            <span v-if="theme === 'light'" class="tc-check">✓</span>
          </button>
          <button class="theme-card" :class="{ on: theme === 'eye' }" @click="setTheme('eye')">
            <span class="tc-preview tc-eye">
              <i class="tc-bar"></i>
              <i class="tc-line"></i><i class="tc-line"></i><i class="tc-line short"></i>
            </span>
            <span class="tc-name">护眼绿</span>
            <span v-if="theme === 'eye'" class="tc-check">✓</span>
          </button>
        </div>
      </div>
      <div class="pref-row">
        <span class="pref-label">字号</span>
        <span class="pref-a">A</span>
        <div class="pref-range-wrap">
          <div class="pref-bubble" :style="{ left: `calc(${(fontScale - 0.85) / 0.35 * 100}% - 19px)` }">
            <b>{{ Math.round(fontScale * 100) }}%</b>
          </div>
          <input class="pref-range" type="range" min="0.85" max="1.20" step="0.05" :value="fontScale"
                 @input="onScaleDrag" @change="onScaleCommit"
                 :style="{ background: `linear-gradient(90deg, var(--brand) ${(fontScale - 0.85) / 0.35 * 100}%, var(--line) ${(fontScale - 0.85) / 0.35 * 100}%)` }" />
          <div class="pref-ticks">
            <i v-for="t in 8" :key="t" :class="{ on: Math.round(fontScale * 100) >= Math.round((0.85 + (t - 1) * 0.05) * 100) }"
               :style="{ left: ((t - 1) / 7 * 100) + '%' }"></i>
          </div>
        </div>
        <span class="pref-a big">A</span>
        <button class="pref-reset" :disabled="Math.abs(fontScale - 1) < 0.001" @click="setFontScale(1)" title="重置 100%">↺</button>
      </div>
    </div>

      </div>
    </div>


    <!-- 云同步 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('sync')">
        <span class="sec-icon sec-icon-sync"><Icon name="cloud" :size="16" /></span>
        <span class="sec-title">云同步</span>
        <span class="sec-arrow" :class="{ open: secOpen.sync }"><Icon name="chevron-down" :size="14" /></span>
      </div>
      <div v-show="secOpen.sync" class="sec-body">

    <!-- GitHub 仓库同步（唯一后端：学习数据+题库+题目图片） -->
    <div class="card sync-card">
      <div class="card-title">云同步 <span class="sync-scope">GitHub 私有仓库</span></div>
      <!-- 状态头 -->
      <div class="sync-status">
        <span class="sync-ico" :class="{ on: ghHasToken }"><Icon name="cloud" :size="18" /></span>
        <div class="sync-status-main">
          <div class="sync-status-line">
            <span class="sync-status-dot" :class="{ on: ghHasToken }"></span>
            <b>{{ ghHasToken ? '已连接' : '未连接' }}</b>
          </div>
          <span class="sync-sub">{{ ghHasToken ? (ghOwner + '/' + ghRepo + ' · 跨 Windows / macOS / 安卓') : '数据只在本机 · 配置后跨设备同步' }}</span>
        </div>
        <span class="sync-time">{{ fmtTime(ghLast) }}</span>
      </div>

      <!-- 已连接态：立即同步 + 结果三格 + 上次结果 -->
      <template v-if="ghHasToken && !showCfg">
        <div class="sync-actions-main">
          <button class="btn btn-primary sync-btn-big" :disabled="ghSyncing" @click="ghDoSync">
            {{ ghSyncing ? '同步中…' : '立即同步' }}
          </button>
          <span class="sync-edit" @click="showCfg = true">编辑配置</span>
        </div>
        <div v-if="ghResult" class="sync-metrics">
          <div class="sync-metric"><b>{{ (ghResult.dataBytes / 1024).toFixed(0) }} KB</b><span>学习数据</span></div>
          <div class="sync-metric"><b>+{{ ghResult.imgUp }}/-{{ ghResult.imgDown }}</b><span>题目图片</span></div>
        </div>
        <div v-if="ghResult && (ghResult.merged?.conflicts || ghResult.failedCount)" class="sync-note">
          <template v-if="ghResult.merged?.conflicts">冲突 {{ ghResult.merged.conflicts }} 条已按时间戳覆盖</template>
          <template v-if="ghResult.failedCount"> · {{ ghResult.failedCount }} 个文件失败，下次同步重试</template>
        </div>
      </template>

      <!-- 配置表单（未连接引导 或 编辑配置展开） -->
      <div v-show="!ghHasToken || showCfg" class="wd-form">
        <div v-if="!ghHasToken" class="sync-info">
          <Icon name="clock" :size="14" />
          <p>用 GitHub 私有仓库同步<b>全部数据</b>（学习数据 + 题库 + 题目图片），Token 需 <code>repo</code> 权限，<b>建议仓库设为 Private</b> 保护隐私。</p>
        </div>
        <div v-if="ghHasToken && !ghToken" class="sync-row sub" style="margin:6px 0 8px">
          <span class="sync-dot" style="background:var(--ok)"></span>
          <span><b>Token 已配置</b>（留空保持不变，无需重新填写）</span>
        </div>
        <input v-model="ghToken" class="sync-input" type="password" :placeholder="ghHasToken ? 'Token 已配置（留空保持不变）' : 'GitHub Token（ghp_...，需 repo 权限）'" @keyup.enter="ghSave" />
        <div class="sync-form-row">
          <input v-model="ghOwner" class="sync-input" placeholder="仓库拥有者（GitHub 用户名）" @keyup.enter="ghSave" />
          <input v-model="ghRepo" class="sync-input" placeholder="仓库名（如 tiku-assets）" @keyup.enter="ghSave" />
        </div>
        <div class="sync-actions">
          <button class="btn btn-primary" :disabled="ghSyncing" @click="ghSave">{{ ghHasToken ? '保存配置' : '保存并连接' }}</button>
          <button class="btn" :disabled="ghSyncing" @click="ghTest">测试连接</button>
          <span v-if="ghHasToken" class="sync-cancel" @click="showCfg = false">取消</span>
        </div>
      </div>
    </div>

      </div>
    </div>

    <!-- 题库 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('bank')">
        <span class="sec-icon sec-icon-bank"><Icon name="doc" :size="16" /></span>
        <span class="sec-title">题库</span>
        <span class="sec-arrow" :class="{ open: secOpen.bank }"><Icon name="chevron-down" :size="14" /></span>
      </div>
      <div v-show="secOpen.bank" class="sec-body">

    <!-- 题库管理（内容资产：导入/录题） -->
    <div class="card">
      <div class="card-title">题库</div>
      <div class="list-item highlight" @click="emit('open-bank')">
        <span class="title">题库管理</span>
        <span class="sub">导入 Excel/CSV · 录题 · 编辑删除</span>
        <span class="arrow">›</span>
      </div>
    </div>

      </div>
    </div>

    <!-- 数据 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('data')">
        <span class="sec-icon sec-icon-data"><Icon name="folder" :size="16" /></span>
        <span class="sec-title">数据</span>
        <span class="sec-arrow" :class="{ open: secOpen.data }"><Icon name="chevron-down" :size="14" /></span>
      </div>
      <div v-show="secOpen.data" class="sec-body">


    <!-- 数据管理（分区：备份迁移 / 内容整理 / 导出内容 / 危险操作） -->
    <div class="card">
      <div class="card-title">数据管理</div>

      <p class="dm-sec">备份与迁移</p>
      <div class="dm-grid">
        <div class="dm-item" @click="exportData">
          <span class="dm-ico" style="--gc: #5b7cfa; --gc-a: 91, 124, 250"><Icon name="download" :size="15" /></span>
          <div class="dm-main"><span class="dm-name">导出备份</span><span class="dm-desc">JSON 快照</span></div>
        </div>
        <label class="dm-item">
          <span class="dm-ico" style="--gc: #8b5cf6; --gc-a: 139, 92, 246"><Icon name="paper" :size="15" /></span>
          <div class="dm-main"><span class="dm-name">导入备份</span><span class="dm-desc">恢复 JSON 快照</span></div>
          <input type="file" accept=".json" style="display:none" @change="importData" />
        </label>
        <div class="dm-item" @click="showBackup = true">
          <span class="dm-ico" style="--gc: #22d3ee; --gc-a: 34, 211, 238"><Icon name="clock" :size="15" /></span>
          <div class="dm-main"><span class="dm-name">备份管理</span><span class="dm-desc">自动备份 · 一键恢复</span></div>
        </div>
        <div class="dm-item" @click="exportZip">
          <span class="dm-ico" style="--gc: #fbbf24; --gc-a: 251, 191, 36"><Icon name="chest" :size="15" /></span>
          <div class="dm-main"><span class="dm-name">导出全量 ZIP</span><span class="dm-desc">题库+图片打包</span></div>
        </div>
      </div>

      <p class="dm-sec">内容整理</p>
      <div class="dm-grid">
        <div class="dm-item" @click="showCats = true">
          <span class="dm-ico" style="--gc: #4fd1a5; --gc-a: 79, 209, 165"><Icon name="grid" :size="15" /></span>
          <div class="dm-main"><span class="dm-name">科目管理</span><span class="dm-desc">科目与章节</span></div>
        </div>
        <div class="dm-item" @click="cleanupImages">
          <span class="dm-ico" style="--gc: #fb7185; --gc-a: 251, 113, 133"><Icon name="broom" :size="15" /></span>
          <div class="dm-main"><span class="dm-name">清理无用图片与音频</span><span class="dm-desc">释放存储空间</span></div>
        </div>
      </div>

      <p class="dm-sec">导出内容</p>
      <div class="dm-grid">
        <div class="dm-item" @click="exportWrong">
          <span class="dm-ico" style="--gc: #fb923c; --gc-a: 251, 146, 60"><Icon name="note" :size="15" /></span>
          <div class="dm-main"><span class="dm-name">导出错题本</span><span class="dm-desc">Markdown 打开</span></div>
        </div>
        <div class="dm-item" @click="exportNotes">
          <span class="dm-ico" style="--gc: #a78bfa; --gc-a: 167, 139, 250"><Icon name="doc" :size="15" /></span>
          <div class="dm-main"><span class="dm-name">导出笔记</span><span class="dm-desc">Markdown 打开</span></div>
        </div>
      </div>

      <p class="dm-sec danger">危险操作</p>
      <div class="dm-item danger" @click="clearLocal">
        <span class="dm-ico" style="--gc: #ff6b6b; --gc-a: 255, 107, 107"><Icon name="trash" :size="15" /></span>
        <div class="dm-main"><span class="dm-name">清空本地学习数据</span><span class="dm-desc">不可恢复，需二次确认</span></div>
      </div>
    </div>


      </div>
    </div>


    <!-- 错题与收藏（入口卡 + 管理弹窗） -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('misc')">
        <span class="sec-icon sec-icon-misc"><Icon name="note" :size="16" /></span>
        <span class="sec-title">错题与收藏</span>
        <span class="sec-arrow" :class="{ open: secOpen.misc }"><Icon name="chevron-down" :size="14" /></span>
      </div>
      <div v-show="secOpen.misc" class="sec-body">

    <div class="card">
      <div class="card-title">我的错题与收藏</div>
      <div class="wf-item" @click="showWrong = true">
        <span class="wf-ico" style="--gc: #fb7185; --gc-a: 251, 113, 133"><Icon name="fire" :size="15" /></span>
        <div class="wf-main">
          <span class="wf-name">错题本</span>
          <span class="wf-desc">未掌握题目 · 错题重练</span>
        </div>
        <span v-if="metrics" class="wf-badge">{{ metrics.wrongCount }} 道待练</span>
        <span class="wf-arrow">›</span>
      </div>
      <div class="wf-item" @click="showFav = true">
        <span class="wf-ico" style="--gc: #fbbf24; --gc-a: 251, 191, 36"><Icon name="star" :size="15" /></span>
        <div class="wf-main">
          <span class="wf-name">收藏</span>
          <span class="wf-desc">重点题目 · 收藏复习</span>
        </div>
        <span v-if="metrics" class="wf-badge">{{ metrics.favCount }} 道</span>
        <span class="wf-arrow">›</span>
      </div>
      </div>
      </div>
    </div>

    <div class="sec">
      <div class="sec-head sec-head-link" @click="showAbout = true">
        <span class="sec-icon sec-icon-about"><Icon name="info" :size="16" /></span>
        <span class="sec-title">关于我们</span>
        <span class="sec-arrow-r"><Icon name="chevron-right" :size="14" /></span>
      </div>
    </div>

    <AboutModal :show="showAbout" @close="showAbout = false" />
    <BackupModal :show="showBackup" @close="showBackup = false" />
    <CategoryManager :show="showCats" @close="showCats = false" />
  </div>

    <!-- 编辑资料弹窗：名字 + 头像（Teleport，避免嵌父树干扰） -->
    <Teleport to="body">
      <div v-if="editOpen" class="ep-mask" @click.self="editOpen = false">
        <div class="ep-panel">
          <div class="ep-title">编辑资料</div>
          <div class="ep-avatar-row">
            <div class="ep-avatar">
              <img v-if="avatar" :src="avatar" alt="头像" />
              <span v-else>{{ userName.slice(0, 1) }}</span>
            </div>
            <div class="ep-avatar-acts">
              <button class="btn btn-sm" @click="fileInput.click()">选择图片</button>
              <button v-if="avatar" class="btn btn-sm ghost" @click="clearAvatar">清除头像</button>
            </div>
          </div>
          <input ref="fileInput" type="file" accept="image/*" hidden @change="onPickAvatar" />
          <div class="ep-field">
            <label class="ep-label">名字</label>
            <input v-model="editName" class="input" maxlength="20" placeholder="输入你的名字" @keyup.enter="saveEdit" />
          </div>
          <div class="ep-foot">
            <button class="btn" @click="editOpen = false">取消</button>
            <button class="btn btn-primary" @click="saveEdit">保存</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 错题管理弹窗（Teleport：包完整 WrongBook 列表） -->
    <Teleport to="body">
      <transition name="fade">
        <div v-if="showWrong" class="wf-mask" @click.self="showWrong = false">
          <div class="wf-panel">
            <div class="wf-head">
              <span class="close" @click="showWrong = false">×</span>
              <span class="title">错题本</span>
              <span class="count">{{ metrics ? metrics.wrongCount : 0 }} 道</span>
            </div>
            <div class="wf-body">
              <WrongBook @start="forwardStart" />
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- 收藏管理弹窗（Teleport：包完整 Favorites 列表） -->
    <Teleport to="body">
      <transition name="fade">
        <div v-if="showFav" class="wf-mask" @click.self="showFav = false">
          <div class="wf-panel">
            <div class="wf-head">
              <span class="close" @click="showFav = false">×</span>
              <span class="title">收藏</span>
              <span class="count">{{ metrics ? metrics.favCount : 0 }} 道</span>
            </div>
            <div class="wf-body">
              <Favorites @start="forwardStart" />
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
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
  background: var(--bg-faint);
  cursor: pointer;
  user-select: none;
  transition: background .2s, border-color .2s;
}
.sec-head:hover {
  background: color-mix(in srgb, var(--brand) 6%, transparent);
  border-color: color-mix(in srgb, var(--brand) 32%, transparent);
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
.sec-icon-goals   { background: color-mix(in srgb, var(--brand) 14%, transparent);  color: var(--brand); }
.sec-icon-prefs   { background: color-mix(in srgb, var(--brand) 14%, transparent);  color: var(--brand); }
.sec-icon-sync    { background: rgba(34, 211, 238, 0.14);  color: #22d3ee; }
.sec-icon-data    { background: rgba(251, 191, 36, 0.14);  color: #fbbf24; }
.sec-icon-bank    { background: rgba(139, 92, 246, 0.14);  color: #8b5cf6; }
.sec-icon-kb      { background: rgba(47, 191, 143, 0.14);  color: var(--ok); }
.sec-icon-cards   { background: rgba(99, 102, 241, 0.14);  color: #6366f1; }
.sec-icon-misc    { background: rgba(251, 113, 133, 0.14); color: #fb7185; }
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
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 15%, transparent), 0 4px 14px color-mix(in srgb, var(--brand) 35%, transparent);
  transition: transform .2s ease, box-shadow .2s ease;
}
.user-card:hover .avatar { transform: scale(1.06); box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand) 24%, transparent), 0 6px 18px color-mix(in srgb, var(--brand) 50%, transparent); }
.user-info { flex: 0 1 auto; max-width: 200px; overflow: hidden; }

/* 右侧呼吸圈（纯装饰，conic 渐变旋转 + 中心呼吸光点；flex 流内定位不遮挡勋章区） */
.user-aura {
  position: relative;
  flex-shrink: 0;
  width: 46px; height: 46px; border-radius: 50%;
  margin-left: 12px;
  pointer-events: none;
  opacity: .8;
  background: conic-gradient(from var(--ang), transparent 0deg, color-mix(in srgb, var(--brand) 50%, transparent) 90deg, transparent 180deg, color-mix(in srgb, var(--brand2) 40%, transparent) 270deg, transparent 360deg);
  -webkit-mask: radial-gradient(circle, transparent 58%, #000 62%);
  mask: radial-gradient(circle, transparent 58%, #000 62%);
  animation: auraSpin 4s linear infinite;
}
.user-aura::after {
  content: ''; position: absolute; inset: 32%;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--brand) 85%, transparent), color-mix(in srgb, var(--brand) 10%, transparent) 70%);
  animation: auraBreathe 2.6s ease-in-out infinite;
}
@keyframes auraSpin { to { --ang: 360deg; } }
@keyframes auraBreathe { 0%, 100% { opacity: .4; } 50% { opacity: 1; } }
[data-theme="light"] .user-aura { opacity: .6; }
[data-theme="eye"] .user-aura { opacity: .6; }
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
.list-item.danger .title { color: var(--bad); }

/* 错题与收藏入口卡（2026-08-14） */
.wf-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 4px;
  border-bottom: 0.5px solid var(--line);
  cursor: pointer;
  transition: background .15s ease;
}
.wf-item:last-of-type { border-bottom: none; }
.wf-item:hover { background: var(--hover-bg); }
.wf-ico {
  width: 32px; height: 32px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--gc-a), 0.13); color: var(--gc);
  box-shadow: inset 0 0 0 1px rgba(var(--gc-a), 0.3);
}
.wf-main { flex: 1; min-width: 0; }
.wf-name { display: block; font-size: 13.5px; font-weight: 500; color: var(--text); }
.wf-desc { display: block; font-size: 11px; color: var(--muted); margin-top: 1px; }
.wf-badge {
  font-size: 11px; color: var(--muted); flex-shrink: 0;
  background: var(--bg-soft); border: 1px solid var(--line);
  border-radius: 999px; padding: 2px 9px;
}
.wf-arrow { font-size: 15px; color: var(--muted); flex-shrink: 0; }

/* 错题/收藏管理弹窗（Teleport） */
.wf-mask {
  position: fixed; inset: 0; z-index: 200;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  -webkit-backdrop-filter: blur(var(--modal-blur));
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.wf-panel {
  width: 780px; max-width: 94vw; height: 84vh;
  display: flex; flex-direction: column;
  background: var(--card-solid);
  border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: var(--shadow), var(--glow-soft);
  overflow: hidden;
  animation: wfPanelIn .26s cubic-bezier(.2, .7, .3, 1);
}
@keyframes wfPanelIn { from { opacity: 0; transform: translateY(18px) scale(.98); } to { opacity: 1; transform: none; } }
.wf-head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px; border-bottom: 1px solid var(--line); flex-shrink: 0;
}
.wf-head .close { font-size: 18px; color: var(--muted); cursor: pointer; line-height: 1; padding: 4px 8px; border-radius: 6px; }
.wf-head .close:hover { color: var(--text); background: var(--hover-bg); }
.wf-head .title { font-size: 15px; font-weight: 600; color: var(--text); }
.wf-head .count { margin-left: auto; font-size: 12px; color: var(--muted); }
.wf-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 18px; }
.wf-body :deep(h2) { display: none; } /* 组件内自带 h2 与弹窗头重复，隐藏 */

/* 弹窗淡入（Profile 此前未定义 fade） */
.fade-enter-active, .fade-leave-active { transition: opacity .18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 数据管理分区（2026-08-14）：分区标题 + 图标操作卡 2 列网格 */
.dm-sec {
  font-size: 11px; color: var(--muted); letter-spacing: .5px;
  margin: 14px 2px 8px;
}
.dm-sec.danger { color: var(--bad); }
.dm-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
}
.dm-item {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--line); border-radius: 10px;
  padding: 9px 10px; cursor: pointer;
  transition: border-color .15s ease, transform .15s ease, background .15s ease;
}
.dm-item:hover { border-color: var(--brand); background: var(--hover-bg); transform: translateY(-1px); }
.dm-item.danger { border-color: color-mix(in srgb, var(--bad) 40%, transparent); }
.dm-item.danger:hover { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 6%, transparent); }
.dm-ico {
  width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--gc-a), 0.13); color: var(--gc);
  box-shadow: inset 0 0 0 1px rgba(var(--gc-a), 0.3);
}
.dm-main { min-width: 0; }
.dm-name {
  display: block; font-size: 13px; font-weight: 500; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dm-item.danger .dm-name { color: var(--bad); }
.dm-desc {
  display: block; font-size: 11px; color: var(--muted); margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 云同步卡片（2026-08-13：连接状态卡 V2） */
.sync-card { border-color: rgba(34, 211, 238, 0.35); }
.sync-scope { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 6px; }
/* 状态头：图标胶囊 + 分层信息 + 时间胶囊 */
.sync-status {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 0; margin-top: 10px; border-top: 1px solid var(--line);
}
.sync-ico {
  position: relative;
  width: 38px; height: 38px; border-radius: 12px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(148, 163, 184, 0.12); color: var(--muted);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.25);
  transition: background .2s ease, color .2s ease, box-shadow .2s ease;
}
/* 流光环（LogoMark 同款：conic 双光带 + mask 环形 + rotate），未连接隐藏 */
.sync-ico::after {
  content: ''; position: absolute; inset: -2px; border-radius: 14px;
  padding: 1.5px; z-index: 1; pointer-events: none;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(34, 211, 238, 0.95) 48deg, transparent 96deg, rgba(34, 211, 238, 0.55) 165deg, transparent 215deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: achSpin 3.5s linear infinite;
  opacity: 0;
  transition: opacity .2s ease;
}
.sync-ico.on {
  background: rgba(34, 211, 238, 0.15); color: #22d3ee;
  box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.4), 0 0 12px rgba(34, 211, 238, 0.2);
}
.sync-ico.on::after { opacity: .75; }
.sync-status-main { flex: 1; min-width: 0; }
.sync-status-line { display: flex; align-items: center; gap: 7px; }
.sync-status-line b { font-size: 14px; font-weight: 600; color: var(--text); }
.sync-status-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: var(--muted); opacity: .55;
}
.sync-status-dot.on {
  background: var(--ok); opacity: 1;
  animation: syncPulse 2s ease-in-out infinite;
}
@keyframes syncPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(79, 209, 165, 0.45); }
  50% { box-shadow: 0 0 0 5px rgba(79, 209, 165, 0); }
}
.sync-sub {
  display: block; margin-top: 2px;
  font-size: 12px; color: var(--muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sync-time {
  flex-shrink: 0;
  font-size: 12px; color: var(--muted);
  background: var(--bg-soft); border: 1px solid var(--line);
  border-radius: 999px; padding: 4px 10px;
}
/* 未连接引导信息条 */
.sync-info {
  display: flex; gap: 9px; align-items: flex-start;
  background: rgba(34, 211, 238, 0.08); border: 1px solid rgba(34, 211, 238, 0.28);
  border-radius: 10px; padding: 9px 12px;
}
.sync-info > svg { flex-shrink: 0; margin-top: 2px; color: #22d3ee; }
.sync-info p { font-size: 12px; line-height: 1.6; color: var(--muted); margin: 0; }
.sync-info code {
  background: rgba(34, 211, 238, 0.15); color: #22d3ee;
  padding: 1px 5px; border-radius: 4px; font-size: 11px;
}
/* 已连接态：立即同步主按钮 + 编辑配置 */
.sync-actions-main { display: flex; align-items: center; gap: 14px; margin-top: 14px; }
.sync-btn-big { padding: 9px 28px; font-size: 14px; }
.sync-edit { font-size: 12px; color: var(--brand); cursor: pointer; flex-shrink: 0; }
.sync-edit:hover { text-decoration: underline; }
/* 结果三格 */
.sync-metrics {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--line);
}
.sync-metric {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  background: var(--bg-soft); border: 1px solid var(--line); border-radius: 10px; padding: 10px 6px;
}
.sync-metric b {
  font-size: 17px; font-weight: 700; color: var(--text);
  background: var(--num-grad);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
}
.sync-metric span { font-size: 11px; color: var(--muted); }
/* 上次结果提示（冲突/失败） */
.sync-note { font-size: 11.5px; color: var(--muted); margin-top: 10px; line-height: 1.6; }
/* 表单行：拥有者/仓库名 并排 */
.sync-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sync-cancel { font-size: 12px; color: var(--muted); cursor: pointer; align-self: center; }
.sync-cancel:hover { color: var(--text); }
.wd-form { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.wd-result { font-size: 12px; color: var(--ok); }
.gh-title { margin-top: 14px; }
.sync-connect { display: flex; flex-direction: column; gap: 10px; }
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

/* 偏好设置 */
.pref-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; font-size: 13px; }
.pref-label { flex: 0 0 88px; color: var(--muted); }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.seg button { background: none; border: none; color: var(--muted); padding: 6px 16px; font-size: 13px; cursor: pointer; }
.seg button.on { background: var(--brand); color: #fff; font-weight: 600; }
.pref-range { flex: 1; accent-color: var(--brand); }
.pref-input { width: 80px; background: var(--input-solid-bg); border: 1px solid var(--line); border-radius: 8px; color: var(--text); padding: 6px 10px; font-size: 13px; outline: none; font-family: inherit; }
.pref-input:focus { border-color: var(--brand); }
.pref-unit { color: var(--muted); font-size: 12px; }
.pref-sub { flex: 1; color: var(--muted); font-size: 11px; }

/* 学习目标（卡片式：图标 + 名称 + 输入 + 状态徽标） */
.goal-card { border-color: color-mix(in srgb, var(--brand) 40%, transparent); }
.goal-scope { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 6px; }
/* 科目范围行 */
.goal-scope-row {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; margin-bottom: 4px;
  background: color-mix(in srgb, var(--brand) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand) 16%, transparent);
  border-radius: 10px;
}
.goal-scope-icon { display: inline-flex; color: var(--brand); }
.goal-scope-label { font-size: 13px; font-weight: 600; color: var(--text); }
.goal-scope-tip { margin-left: auto; font-size: 11px; color: var(--muted); }
.goal-select { background: var(--input-solid-bg); border: 1px solid var(--line); border-radius: 8px; color: var(--text); padding: 5px 10px; font-size: 13px; outline: none; font-family: inherit; }
/* 目标行 */
.goal-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 4px;
  border-bottom: 0.5px solid rgba(148, 163, 184, 0.12);
  transition: background .15s;
}
.goal-row:last-of-type { border-bottom: none; }
.goal-row:hover { background: var(--bg-faint); border-radius: 8px; }
/* 图标胶囊：每项目标一个主题色（--gc 实色 + --gc-a 透明版） */
.goal-ico {
  position: relative;
  width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--gc-a), 0.13);
  color: var(--gc);
  box-shadow: inset 0 0 0 1px rgba(var(--gc-a), 0.26);
}
/* 流光环：已设目标（行内有 .goal-on 徽标）才显示，颜色跟随行主题色 --gc-a */
.goal-ico::after {
  content: ''; position: absolute; inset: -2px; border-radius: 12px;
  padding: 1.5px; z-index: 1; pointer-events: none;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(var(--gc-a), 0.95) 48deg, transparent 96deg, rgba(var(--gc-a), 0.55) 165deg, transparent 215deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: achSpin 3.8s linear infinite;
  opacity: 0;
  transition: opacity .2s ease;
}
.goal-row:has(.goal-on) .goal-ico::after { opacity: .7; }
.goal-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.goal-name { font-size: 13.5px; font-weight: 600; color: var(--text); }
.goal-desc { font-size: 11px; color: var(--muted); }
/* 数值输入：紧凑右对齐 */
.goal-input {
  width: 56px;
  background: transparent; border: none; border-radius: 0;
  color: var(--text); padding: 6px 0;
  font-size: 13px; outline: none; font-family: inherit; text-align: center;
  -moz-appearance: textfield; appearance: textfield;
}
.goal-input::-webkit-outer-spin-button, .goal-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.goal-input:focus { border-color: transparent; }
/* 步进胶囊：− [数值] + 一体，hover/focus 蓝边发光 */
.goal-stepper {
  margin-left: auto;
  display: flex; align-items: center;
  background: var(--input-solid-bg);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color .15s, box-shadow .15s;
}
.goal-stepper:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 15%, transparent); }
.gs-btn {
  width: 28px; height: 30px;
  background: transparent; border: none;
  color: var(--muted); font-size: 15px; line-height: 1;
  cursor: pointer; transition: color .15s, background .15s;
}
.gs-btn:hover { color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, transparent); }
.gs-btn:active { transform: scale(.92); }
.goal-unit { font-size: 11px; color: var(--muted); flex-shrink: 0; margin-left: 6px; }
/* 日期输入：图标 + 输入一体胶囊 */
.goal-date-wrap {
  margin-left: auto;
  display: flex; align-items: center; gap: 6px;
  background: var(--input-solid-bg);
  border: 1px solid var(--line);
  border-radius: 10px; padding: 0 10px;
  transition: border-color .15s, box-shadow .15s;
}
.goal-date-wrap:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 15%, transparent); }
.gd-ico { color: var(--muted); flex-shrink: 0; }
.goal-date-wrap .goal-date { width: auto; min-width: 118px; text-align: left; padding: 6px 0; }
.goal-date-wrap .goal-date::-webkit-calendar-picker-indicator { filter: invert(.6); cursor: pointer; }
.goal-on {
  font-size: 10px; font-weight: 700; color: #0e1512;
  background: var(--ok); border-radius: 999px; padding: 2px 8px;
  flex-shrink: 0; letter-spacing: .3px;
}
/* 浅色/护眼：--ok 为深绿底，深字对比不足 → 白字 */
[data-theme="light"] .goal-on { color: #fff; }
[data-theme="eye"] .goal-on { color: #fff; }
.goal-tip { font-size: 11px; color: var(--muted); margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--line); }

</style>
