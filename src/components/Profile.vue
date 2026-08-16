<script setup>
import Icon from './Icon.vue'
import MedalIcon from './MedalIcon.vue'
import CountUp from './CountUp.vue'
import { showConfirm } from '../utils/confirm.js'
import { showToast } from '../utils/toast.js'
import { evaluate, achLevel, ACH_SERIES, RARITY_ORDER } from '../utils/achievements.js'
import { vTilt } from '../utils/tilt.js'
import { computePosition, offset, flip, shift, autoUpdate } from '@floating-ui/dom'
import { ref, onMounted, onBeforeUnmount, computed, nextTick, watch } from 'vue'
import { tiku } from '../api/tiku.js'
import { applyAppearance } from '../utils/appearance.js'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import WrongBook from './WrongBook.vue'
import Favorites from './Favorites.vue'
import NotesList from './NotesList.vue'
import AboutModal from './AboutModal.vue'
import BackupModal from './BackupModal.vue'
import CategoryManager from './CategoryManager.vue'

const props = defineProps({ focusSection: { type: String, default: '' } })
const emit = defineEmits(['reset', 'start', 'open-bank', 'open-kb-manager', 'focus-consumed', 'open-card-manager'])

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
const showNotes = ref(false)
const showWrong = ref(false) // 错题管理弹窗
const showFav = ref(false) // 收藏管理弹窗

// ---- GitHub 仓库同步（唯一后端：数据快照 + 知识库文档 + 题目图片）----
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
    let msg = `同步完成（数据 ${(r.dataBytes / 1024).toFixed(0)}KB · 图片 +${r.imgUp}/-${r.imgDown} · 文档 +${r.kbUp}/-${r.kbDown}）`
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
// 浮层 autoUpdate 的滚动/resize 监听随组件卸载释放（App 用 v-if 切 Tab 会真卸载，不清理会泄漏空跑）
onBeforeUnmount(() => {
  if (medalTipCleanup) { medalTipCleanup(); medalTipCleanup = null }
})

async function clearLocal() {
  const ok = await showConfirm('清空本地学习数据？\n将删除全部答题记录、错题本、收藏、笔记、XP、记忆卡、番茄记录、复习日志与每日一题连击，且不可恢复。\n（题库与知识库文档不受影响）')
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
      if (d.kbDocs && d.kbDocs.total) parts.push(`知识文档：${d.kbDocs.total} 篇`)
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
// 拖动只更新预览（气泡/刻度/百分比），松开（change）才应用全局字号 → 消除拖动时页面实时抖动
function onScaleDrag(e) { fontScale.value = e.target.value }
function onScaleCommit(e) { setFontScale(e.target.value) }
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
const achievements = computed(() => metrics.value ? evaluate(metrics.value) : [])
const unlockedCount = computed(() => achievements.value.filter(a => a.got).length)
const achPoints = computed(() => achievements.value.filter(a => a.got).reduce((s, a) => s + (a.points || 0), 0))
const achLv = computed(() => achLevel(achPoints.value))
const achPct = computed(() => achievements.value.length ? Math.round((unlockedCount.value / achievements.value.length) * 100) : 0)
// 勋章全局浮层：floating-ui computePosition（flip/shift 自动视口翻转避让，与热力图统一技术栈）
const activeTip = ref(null) // { title, sub, desc, got } 仅内容，位置由 computePosition 设置到浮层元素
const medalTipEl = ref(null)
const medalAnchor = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
const medalTipAnchor = {
  getBoundingClientRect: () => ({
    width: medalAnchor.width, height: medalAnchor.height,
    left: medalAnchor.left, top: medalAnchor.top,
    right: medalAnchor.right, bottom: medalAnchor.bottom,
    x: medalAnchor.left, y: medalAnchor.top
  })
}
let medalTipSeq = 0
let medalTipCleanup = null // autoUpdate 清理函数（滚动/resize 时浮层跟随锚点）
async function showTip(elOrE, payload) {
  const el = elOrE.currentTarget || elOrE
  const r = el.getBoundingClientRect()
  medalAnchor.left = r.left; medalAnchor.top = r.top
  medalAnchor.right = r.right; medalAnchor.bottom = r.bottom
  medalAnchor.width = r.width; medalAnchor.height = r.height
  activeTip.value = payload
  const seq = ++medalTipSeq
  await nextTick() // 等浮层渲染后定位
  if (seq !== medalTipSeq || !medalTipEl.value) return
  if (medalTipCleanup) { medalTipCleanup(); medalTipCleanup = null }
  // autoUpdate：页面滚动/窗口缩放时浮层自动跟随锚点（computePosition 单次定位会漂移）
  medalTipCleanup = autoUpdate(medalTipAnchor, medalTipEl.value, async () => {
    if (seq !== medalTipSeq || !medalTipEl.value) return
    const { x, y } = await computePosition(medalTipAnchor, medalTipEl.value, {
      placement: 'top', // 默认上方，空间不足 flip 自动翻到下方
      middleware: [offset(10), flip(), shift({ padding: 8 })]
    })
    if (seq !== medalTipSeq || !medalTipEl.value) return
    medalTipEl.value.style.left = x + 'px'
    medalTipEl.value.style.top = y + 'px'
  })
}
function hideTip() {
  activeTip.value = null
  if (medalTipCleanup) { medalTipCleanup(); medalTipCleanup = null }
}
// 浮层数据：归类成就的 4 档进度（当前档/下一档阈值 + 全档位预览）
const RAR_LABEL = { bronze: '铜', silver: '银', gold: '金', platinum: '白金' }
function achTipPayload(a) {
  const tierLine = a.tiers.map((t, i) => `${RAR_LABEL[RARITY_ORDER[i]]}${t}`).join(' · ')
  const sub = a.got
    ? `当前 ${RAR_LABEL[a.rarity]}档 · ${a.fmtText}${a.next ? ` / 下一档 ${a.next}` : ' · 已满级'}`
    : `未解锁 · 目标 ${a.tiers[0]}`
  return {
    title: a.name,
    sub,
    desc: `${a.seriesName || ''}${tierLine}`,
    got: a.got
  }
}
// 勋章稀有度 class：已解锁 → 'got <rarity>'（驱动 --rr 配色），未解锁 → ''
const medalCls = (a) => a.got ? 'got ' + (a.rarity || 'bronze') : ''
// 归类成就平铺：20 个成就直接陈列（3 行 × 9 列，不足补占位）
const RARITY_RANK = { bronze: 1, silver: 2, gold: 3, platinum: 4 }
const SERIES_NAME = Object.fromEntries(ACH_SERIES.map(s => [s.key, s.name]))
const seriesMedals = computed(() => {
  if (!metrics.value) return []
  return achievements.value.map(a => ({ ...a, seriesName: SERIES_NAME[a.series] || '' }))
})
// 勋章底形状（viewBox 100×100）：铜=菱形、银=六边形、金=盾形、白金=八角星（铜原为圆，与外层圆勋章重复故改菱形）
const BADGE_SHAPES = {
  bronze: 'M50 20 L80 50 L50 80 L20 50 Z',
  silver: 'M50 3 L90 26 L90 74 L50 97 L10 74 L10 26 Z',
  gold: 'M50 3 L88 18 V52 C88 74 72 88 50 97 C28 88 12 74 12 52 V18 Z',
  platinum: 'M50 3 L59 24 L80 20 L76 41 L97 50 L76 59 L80 80 L59 76 L50 97 L41 76 L20 80 L24 59 L3 50 L24 41 L20 20 L41 24 Z'
}
const shapeD = (r) => BADGE_SHAPES[r] || BADGE_SHAPES.bronze
// NEW 角标：3 天内解锁的成就标记（替代'最近解锁'横条，信息融进勋章墙零占地）
const isNewAch = (a) => {
  if (!a.got || !a.unlockAt) return false
  const t = new Date(String(a.unlockAt).slice(0, 10) + 'T00:00:00').getTime()
  if (!t) return false
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const diff = now.getTime() - t
  return diff >= 0 && diff <= 3 * 86400000
}
// 用户卡右侧勋章区：每系列 1 枚代表（该系列最高已点亮档位），仅已解锁系列，按系列顺序排列
const stackMedals = computed(() => {
  if (!metrics.value) return []
  return ACH_SERIES.map(sr => {
    const list = achievements.value.filter(a => a.series === sr.key && a.got)
    if (!list.length) return null
    return list.sort((a, b) => (RARITY_RANK[b.rarity] || 0) - (RARITY_RANK[a.rarity] || 0))[0]
  }).filter(Boolean)
})
// 点击勋章区 → 展开勋章墙分组并平滑滚动到完整勋章墙
function gotoAch() {
  secOpen.value.learn = true
  nextTick(() => {
    const el = document.querySelector('.ach-card')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

// 页面分组折叠：勋章墙默认展开，其余收起（避免平铺过长）
const secOpen = ref({ learn: false, goals: false, prefs: false, sync: false, data: false, bank: false, kb: false, cards: false, misc: false })
function toggleSec(k) {
  secOpen.value[k] = !secOpen.value[k]
}
// 外部定位：首页「设置目标/考试倒计时」→ 展开学习目标分组并滚动（仿 gotoAch）
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
      <!-- 勋章区：已解锁勋章全部松散平铺（自动换行填满右侧空白），点击滚动到完整勋章墙 -->
      <div class="medal-area" title="查看全部勋章" @click="gotoAch">
        <template v-for="(a, i) in stackMedals" :key="a.key">
          <div class="medal area-medal got" :class="a.rarity || 'bronze'" :style="{ zIndex: 10 + i }" @click.stop="gotoAch"
               @mouseenter="showTip($event, { title: a.name, sub: (a.unlockAt || '已解锁') + ' 解锁', desc: a.desc, got: true })"
               @mouseleave="hideTip">
            <svg class="medal-bg" viewBox="0 0 100 100" aria-hidden="true"><path :d="shapeD(a.rarity)" /></svg>
            <MedalIcon :series="a.series" :got="true" :size="15" class="medal-icon" />
            <span v-if="isNewAch(a)" class="medal-new">NEW</span>
          </div>
        </template>
      </div>
      <!-- 右侧呼吸圈（纯装饰，conic 旋转 + 中心呼吸光点） -->
      <span class="user-aura" aria-hidden="true"></span>
    </div>



    <!-- 勋章墙（游戏化成就） -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('learn')">
        <span class="sec-icon sec-icon-learn"><Icon name="chart" :size="16" /></span>
        <span class="sec-title">勋章墙</span>
        <span class="sec-badge">{{ unlockedCount }} 成就</span>
        <span class="sec-arrow" :class="{ open: secOpen.learn }"><Icon name="chevron-down" :size="14" /></span>
      </div>
      <div v-show="secOpen.learn" class="sec-body">

    <!-- 游戏化成就：概览条 + 系列分组 + 三态成就卡 -->
    <div class="card ach-card" v-tilt="{ deg: 3, flat: true }">
      <!-- 概览条 -->
      <div class="ach-summary">
        <span class="ach-lv" :style="{ borderColor: achLv.min >= 600 ? '#7dd3fc' : achLv.min >= 300 ? '#d9a514' : achLv.min >= 100 ? '#9fb2c0' : '#b87333', color: achLv.min >= 600 ? '#7dd3fc' : achLv.min >= 300 ? '#d9a514' : achLv.min >= 100 ? '#9fb2c0' : '#b87333' }"><Icon :name="achLv.icon" :size="13" /> {{ achLv.name }}</span>
        <span class="ach-sum-item"><b>{{ achPoints }}</b>成就点数</span>
        <span class="ach-sum-item"><b>{{ unlockedCount }}/{{ achievements.length }}</b>已解锁</span>
        <span class="ach-sum-item"><b>{{ achPct }}%</b>完成率</span>
        <span class="ach-sum-ring" :style="{ background: `conic-gradient(var(--brand) ${achPct * 3.6}deg, var(--line) 0deg)` }"></span>
      </div>


      <!-- 勋章墙（归类成就平铺）：20 个归类成就 × 4 档，3 行 × 9 列，不足补占位 -->
      <div class="medal-grid">
        <div v-for="(a, i) in seriesMedals" :key="a.key" class="medal-cell">
          <div class="medal big-medal" :class="medalCls(a)" :style="{ animationDelay: (i * 0.04) + 's' }"
               @mouseenter="showTip($event, achTipPayload(a))"
               @mouseleave="hideTip">
            <svg v-if="a.got" class="medal-bg" viewBox="0 0 100 100" aria-hidden="true"><path :d="shapeD(a.rarity)" /></svg>
            <MedalIcon :series="a.series" :got="a.got" :size="26" class="medal-icon" />
            <span v-if="a.got && isNewAch(a)" class="medal-new">NEW</span>
            <div v-if="a.got" class="medal-orb"></div>
          </div>
          <div class="medal-base" :class="{ off: !a.got }"></div>
          <span class="medal-sname">{{ a.name }}</span>
        </div>
        <div v-for="k in (27 - seriesMedals.length)" :key="'ph-' + k" class="medal-cell medal-ph">
          <div class="medal-ph-box"></div>
        </div>
      </div>
      <div v-if="!seriesMedals.length" class="ach-empty">还没有成就数据，先刷几道题吧</div>
    </div>
      </div>
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
      <!-- 每日复习 -->
      <div class="goal-row">
        <span class="goal-ico" style="--gc: #4fd1a5; --gc-a: 79, 209, 165"><Icon name="refresh" :size="15" /></span>
        <div class="goal-main">
          <span class="goal-name">每日复习</span>
          <span class="goal-desc">记忆卡复习次数</span>
        </div>
        <div class="goal-stepper">
          <button class="gs-btn" type="button" @click="stepGoal(() => reviewGoal, setReviewGoal)(-5)">−</button>
          <input class="goal-input" type="number" min="0" :value="reviewGoal" @change="setReviewGoal($event.target.value)" placeholder="0" />
          <button class="gs-btn" type="button" @click="stepGoal(() => reviewGoal, setReviewGoal)(5)">+</button>
        </div>
        <span class="goal-unit">条/天</span>
        <span v-if="reviewGoal > 0" class="goal-on">已设</span>
      </div>
      <!-- 每日阅读 -->
      <div class="goal-row">
        <span class="goal-ico" style="--gc: #fbbf24; --gc-a: 251, 191, 36"><Icon name="doc" :size="15" /></span>
        <div class="goal-main">
          <span class="goal-name">每日阅读</span>
          <span class="goal-desc">知识库文档阅读</span>
        </div>
        <div class="goal-stepper">
          <button class="gs-btn" type="button" @click="stepGoal(() => readGoal, setReadGoal)(-1)">−</button>
          <input class="goal-input" type="number" min="0" :value="readGoal" @change="setReadGoal($event.target.value)" placeholder="0" />
          <button class="gs-btn" type="button" @click="stepGoal(() => readGoal, setReadGoal)(1)">+</button>
        </div>
        <span class="goal-unit">篇/天</span>
        <span v-if="readGoal > 0" class="goal-on">已设</span>
      </div>
      <!-- 目标考试日 -->
      <div class="goal-row">
        <span class="goal-ico" style="--gc: #fb7185; --gc-a: 251, 113, 133"><Icon name="calendar" :size="15" /></span>
        <div class="goal-main">
          <span class="goal-name">目标考试日</span>
          <span class="goal-desc">首页倒计时</span>
        </div>
        <div class="goal-date-wrap">
          <Icon name="calendar" :size="13" class="gd-ico" />
          <input class="goal-input goal-date" type="date" :value="examDate" @change="setExamDate($event.target.value)" />
        </div>
        <span v-if="examDate" class="goal-on">已设</span>
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

    <!-- GitHub 仓库同步（唯一后端：学习数据+题库+知识库文档+题目图片） -->
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
          <div class="sync-metric"><b>+{{ ghResult.kbUp }}/-{{ ghResult.kbDown }}</b><span>知识库文档</span></div>
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
          <p>用 GitHub 私有仓库同步<b>全部数据</b>（学习数据 + 题库 + 知识库文档 + 题目图片），Token 需 <code>repo</code> 权限，<b>建议仓库设为 Private</b> 保护隐私。</p>
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

    <!-- 知识库 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('kb')">
        <span class="sec-icon sec-icon-kb"><Icon name="book" :size="16" /></span>
        <span class="sec-title">知识库</span>
        <span class="sec-arrow" :class="{ open: secOpen.kb }"><Icon name="chevron-down" :size="14" /></span>
      </div>
      <div v-show="secOpen.kb" class="sec-body">

    <!-- 文档管理（内容资产：导入/重命名/移动/删除） -->
    <div class="card">
      <div class="card-title">知识库</div>
      <div class="list-item highlight" @click="emit('open-kb-manager')">
        <span class="title">知识库管理</span>
        <span class="sub">导入 md/pdf · 搜索 · 重命名 · 整理</span>
        <span class="arrow">›</span>
      </div>
    </div>

      </div>
    </div>

    <!-- 记忆卡 -->
    <div class="sec">
      <div class="sec-head" @click="toggleSec('cards')">
        <span class="sec-icon sec-icon-cards"><Icon name="bookmark" :size="16" /></span>
        <span class="sec-title">记忆卡</span>
        <span class="sec-arrow" :class="{ open: secOpen.cards }"><Icon name="chevron-down" :size="14" /></span>
      </div>
      <div v-show="secOpen.cards" class="sec-body">

    <!-- 记忆卡管理（内容资产：增删改/导入/按科目章节筛选） -->
    <div class="card">
      <div class="card-title">记忆卡</div>
      <div class="list-item highlight" @click="emit('open-card-manager')">
        <span class="title">记忆卡管理</span>
        <span class="sub">增删改 · CSV 导入 · 按科目章节筛选</span>
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
          <div class="dm-main"><span class="dm-name">导出全量 ZIP</span><span class="dm-desc">题库+图片+知识库打包</span></div>
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
      <div class="wf-item" @click="showNotes = true">
        <span class="wf-ico" style="--gc: #a78bfa; --gc-a: 167, 139, 250"><Icon name="note" :size="15" /></span>
        <div class="wf-main">
          <span class="wf-name">我的笔记</span>
          <span class="wf-desc">查看与删除全部题目笔记</span>
        </div>
        <span v-if="metrics" class="wf-badge">{{ metrics.notesCount }} 条</span>
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

    <NotesList :show="showNotes" @close="showNotes = false" />
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

    <!-- 勋章全局浮层（Teleport to body + floating-ui 定位，固定 z-index 顶层） -->
    <Teleport to="body">
      <div v-if="activeTip" ref="medalTipEl" class="medal-float">
        <div class="mf-title">{{ activeTip.title }}</div>
        <div class="mf-sub" :class="{ lock: !activeTip.got }">{{ activeTip.sub }}</div>
        <div class="mf-desc">{{ activeTip.desc }}</div>
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

/* 成就墙 */
/* 成就中心（游戏化）：概览条 + 系列分组 + 三态卡 */
.ach-summary { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-bottom: 12px; margin-bottom: 10px; border-bottom: 1px dashed var(--line); }
.ach-lv { font-size: 13px; font-weight: 600; color: var(--text); border: 1.5px solid var(--line); border-radius: 999px; padding: 3px 12px; display: inline-flex; align-items: center; gap: 5px; }
.ach-sum-item { font-size: 12px; color: var(--muted); display: inline-flex; align-items: baseline; gap: 4px; }
.ach-sum-item b { font-size: 16px; color: var(--brand); font-weight: 700; }
.ach-sum-ring { width: 30px; height: 30px; border-radius: 50%; margin-left: auto; position: relative; }
.ach-sum-ring::after { content: ''; position: absolute; inset: 6px; background: var(--bg, #fff); border-radius: 50%; }
.ach-empty { font-size: 12px; color: var(--muted); text-align: center; padding: 12px 0; }

/* ===== 勋章全局浮层（Teleport to body + floating-ui 定位，与热力图统一；flip/shift 自动视口翻转） ===== */
.medal-float {
  position: fixed; z-index: 9999; pointer-events: none;
  width: max-content; max-width: 240px;
  background: var(--tip-bg); border: 1px solid color-mix(in srgb, var(--brand) 40%, transparent);
  border-radius: 10px; padding: 8px 10px;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5);
  text-align: left;
}
.medal-float .mf-title { font-size: 12.5px; color: var(--tip-text); font-weight: 500; margin-bottom: 3px; }
.medal-float .mf-sub { font-size: 10.5px; color: var(--ok-soft); margin-bottom: 2px; }
.medal-float .mf-sub.lock { color: var(--tip-muted); }
.medal-float .mf-desc { font-size: 11px; color: var(--tip-muted); margin-top: 4px; line-height: 1.5; }

/* 同步冲突明细 */

/* 主题选择：大卡片预览式（mini 界面卡 + 选中光晕 + 对勾角标） */
.theme-palette { display: flex; gap: 10px; }
.theme-card {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  font-size: 11px; color: var(--muted);
  background: transparent; border: 1px solid var(--line);
  border-radius: 12px; padding: 10px 10px 9px; cursor: pointer;
  transition: all .18s ease;
}
.theme-card:hover { border-color: color-mix(in srgb, var(--brand) 45%, transparent); transform: translateY(-1px); }
.theme-card.on { border-color: var(--brand); box-shadow: 0 0 0 1.5px var(--brand), 0 4px 14px color-mix(in srgb, var(--brand) 22%, transparent); }
.theme-card.on .tc-name { color: var(--text); font-weight: 600; }
/* mini 界面预览 */
.tc-preview {
  display: block; width: 74px; height: 46px; border-radius: 8px;
  overflow: hidden; border: 1px solid var(--line); position: relative;
  display: flex; flex-direction: column; gap: 4px; padding: 6px 7px;
}
.tc-bar { display: block; height: 6px; border-radius: 3px; margin-bottom: 3px; opacity: .9; }
.tc-line { display: block; height: 3px; border-radius: 2px; opacity: .5; }
.tc-line.short { width: 55%; }
.tc-dark   { background: #131827; }
.tc-dark .tc-bar { background: #2a3550; }
.tc-dark .tc-line { background: #39466b; }
.tc-light  { background: #f3f5fa; }
.tc-light .tc-bar { background: #d7deeb; }
.tc-light .tc-line { background: #cdd6e6; }
.tc-eye    { background: #eef4ea; }
.tc-eye .tc-bar { background: #cfe0c8; }
.tc-eye .tc-line { background: #c4d8bb; }
/* 选中对勾角标 */
.tc-check {
  position: absolute; top: -7px; right: -7px;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--brand); color: #fff;
  font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 8px color-mix(in srgb, var(--brand) 60%, transparent);
  animation: tcPop .3s cubic-bezier(.2, .9, .3, 1.3);
}
@keyframes tcPop { from { transform: scale(0); } to { transform: scale(1); } }
/* 字号滑块：气泡跟随 + 刻度精确对齐 + 重置 */
.pref-a { font-size: 12px; color: var(--muted); flex-shrink: 0; }
.pref-a.big { font-size: 16px; }
.pref-range-wrap { flex: 1; position: relative; padding-top: 22px; }
/* 数值气泡：跟随 thumb（left 由百分比驱动，-19px 让气泡中心对齐 thumb） */
.pref-bubble {
  position: absolute; top: 0;
  background: var(--brand); color: #fff;
  font-size: 11px; font-weight: 700; line-height: 1;
  padding: 4px 8px; border-radius: 8px;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--brand) 40%, transparent);
  transition: left .05s linear;
  pointer-events: none;
  white-space: nowrap;
}
.pref-bubble::after {
  content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  border: 4px solid transparent; border-top-color: var(--brand);
}
.pref-range-wrap .pref-range { margin-top: 4px; }
.pref-range {
  width: 100%; accent-color: var(--brand); cursor: pointer;
  -webkit-appearance: none; appearance: none; height: 6px; border-radius: 3px;
  background: var(--line);
}
.pref-range::-webkit-slider-thumb {
  -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; border: 2px solid var(--brand);
  box-shadow: 0 0 8px color-mix(in srgb, var(--brand) 45%, transparent);
  cursor: pointer; margin-top: 0;
}
.pref-range:hover::-webkit-slider-thumb { transform: scale(1.15); box-shadow: 0 0 12px color-mix(in srgb, var(--brand) 65%, transparent); }
/* 刻度：绝对定位精确对齐滑块位置（0%/16.7%/…/100%） */
.pref-ticks { position: relative; height: 6px; margin-top: 6px; }
.pref-ticks i {
  position: absolute; top: 0;
  width: 3px; height: 6px; border-radius: 1px; background: var(--line); transition: background .2s;
  transform: translateX(-50%);
}
.pref-ticks i.on { background: var(--brand); }
/* 重置按钮 */
.pref-reset {
  flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%;
  border: 1px solid var(--line); background: transparent; color: var(--muted);
  font-size: 14px; cursor: pointer; transition: all .15s;
  display: flex; align-items: center; justify-content: center;
}
.pref-reset:hover:not(:disabled) { color: var(--brand); border-color: var(--brand); transform: rotate(-30deg); }
.pref-reset:disabled { opacity: .35; cursor: default; }

/* ===== 我的页铺开（2026-08-12）：渐变语言 / 流光 ===== */
/* 用户卡/成就墙卡：渐变边框（门面） */
.user-card, .ach-card {
  border: 1px solid transparent;
  background-image:
    linear-gradient(var(--card), var(--card)),
    linear-gradient(135deg, color-mix(in srgb, var(--brand) 40%, transparent), color-mix(in srgb, var(--brand2) 40%, transparent));
  background-origin: border-box;
  background-clip: padding-box, border-box;
  position: relative;
}
/* 成就墙卡 hover 流光 */
.ach-card::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  padding: 1px;
  background: conic-gradient(from var(--ang), transparent 0deg, color-mix(in srgb, var(--brand) 70%, transparent) 80deg, transparent 170deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0; pointer-events: none; transition: opacity .18s;
}
.ach-card:hover::after { opacity: 1; animation: angSpin 2.2s linear infinite; }

/* 成就数字：渐变（三主题由 --num-grad 统一） */
.ach-sum-item b {
  background: var(--num-grad);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}

/* ===== 我的页加浓（2026-08-12）：首页同款浓度 ===== */
/* stagger 交错入场：用户卡 → 学习成长 → 学习目标 */
.profile > * { animation: riseIn .4s cubic-bezier(.2, .7, .3, 1) both; }
.profile > *:nth-child(2) { animation-delay: .06s; }
.profile > *:nth-child(3) { animation-delay: .12s; }

@keyframes numPop { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }

/* 成就数字弹入 */
.ach-sum-item b { animation: numPop .45s cubic-bezier(.2, .7, .3, 1) both; }

/* 成就完成率环：入场弹入 */
.ach-sum-ring { animation: ringPop .5s cubic-bezier(.2, .7, .3, 1) .15s both; }
@keyframes ringPop { from { opacity: 0; transform: scale(.7); } to { opacity: 1; transform: scale(1); } }

/* 头像区：装饰光斑（勋章堆已承担右侧点缀，光斑改为内部小范围，不溢出裁剪） */
.user-card { position: relative; overflow: visible; }
.user-card::before {
  content: ''; position: absolute; top: -18px; right: -8px;
  width: 110px; height: 110px; border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--brand) 8%, transparent), transparent 62%);
  pointer-events: none;
}
/* 用户卡瘦身（2026-08-13）：顶部渐变光带 + 本地徽章 + 今日XP胶囊 */
.user-card::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 44px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--brand) 10%, transparent), transparent 65%);
  pointer-events: none;
}
.local-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; color: var(--ok-soft);
  border: 1px solid color-mix(in srgb, var(--ok) 40%, transparent);
  background: color-mix(in srgb, var(--ok) 10%, transparent);
  border-radius: 8px; padding: 1px 7px;
  margin-left: 6px; vertical-align: 2px; white-space: nowrap;
}
.local-badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--ok); flex-shrink: 0; }
[data-theme="light"] .local-badge { color: #0f9d6b; }
[data-theme="eye"] .local-badge { color: #1f8a5b; }


/* ===== 用户卡可编辑 + 右侧特效（2026-08-13）===== */
/* 头像容器：可点击换图 */
.avatar-wrap {
  position: relative; flex-shrink: 0;
  width: 56px; height: 56px;
  cursor: pointer;
}
/* 头像外圈流光环：双光带绕头像旋转（放容器上，避开 user-aura 的 mask 裁剪） */
.avatar-wrap::after {
  content: ''; position: absolute; inset: -3px; border-radius: 50%;
  padding: 2px; z-index: 1; pointer-events: none;
  background: conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--brand) 95%, transparent) 48deg, transparent 96deg, color-mix(in srgb, var(--brand2) 60%, transparent) 165deg, transparent 215deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: achSpin 3.4s linear infinite;
  opacity: .7;
}
.avatar-wrap:hover::after { opacity: 1; }
.avatar-img {
  width: 56px; height: 56px; border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 15%, transparent), 0 4px 14px color-mix(in srgb, var(--brand) 35%, transparent);
}
/* 编辑入口：低调（✎ 低透明），hover 名字区才亮起 */
.user-name { display: flex; align-items: center; gap: 6px; }
.user-name-text { font-size: 16px; font-weight: 600; color: var(--text); }


/* ===== 编辑资料弹窗（2026-08-13）===== */
.ep-mask {
  position: fixed; inset: 0; z-index: 400;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur, 6px));
  display: flex; align-items: center; justify-content: center; padding: 24px;
  animation: maskIn .18s ease;
}
.ep-panel {
  width: 360px; max-width: 92vw;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  padding: 18px 20px;
  animation: riseIn .28s cubic-bezier(.2, .7, .3, 1) both;
}
.ep-title { font-size: 15px; font-weight: 600; margin-bottom: 14px; }
.ep-avatar-row { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.ep-avatar {
  width: 64px; height: 64px; border-radius: 50%; overflow: hidden; flex-shrink: 0;
  background: linear-gradient(135deg, var(--brand), var(--brand2, #7a5cff));
  color: #fff; font-size: 24px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 15%, transparent);
}
.ep-avatar img { width: 100%; height: 100%; object-fit: cover; }
.ep-avatar-acts { display: flex; flex-direction: column; gap: 8px; }
.ep-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.ep-label { font-size: 12px; color: var(--muted); }
.ep-foot { display: flex; justify-content: flex-end; gap: 10px; }

/* 用户卡编辑入口：名字旁低调 ✎（默认 25%，hover 名字区亮起微转） */
.user-edit-btn {
  font-size: 12px; color: var(--muted);
  opacity: .25; cursor: pointer; user-select: none;
  transition: opacity .15s ease, color .15s ease, transform .15s ease;
  margin-left: 2px;
}
.user-name:hover .user-edit-btn { opacity: 1; color: var(--brand); transform: scale(1.12); }




/* ===== 勋章墙（归类成就平铺）：3 行 × 9 列，cell 含勋章+底座+成就名 ===== */
.medal-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 18px 8px;
  justify-items: center;
  padding: 10px 2px 6px;
}
.medal-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; }
/* 预留占位：虚线圆点，暗示还有成就可解锁 */
.medal-ph-box {
  width: 44px; height: 44px; border-radius: 50%;
  border: 1.5px dashed rgba(148, 163, 184, 0.28);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: rgba(148, 163, 184, 0.35);
}
.medal-ph-box::after { content: '?'; }
/* cell 级稀有度色：供底座发光（勋章自身 --rr 仍在 medal 上） */
.medal-cell.bronze   { --rr: 184, 115, 51; }
.medal-cell.silver   { --rr: 159, 178, 192; }
.medal-cell.gold     { --rr: 217, 165, 20; }
.medal-cell.platinum { --rr: 125, 211, 252; }
/* 展柜底座：椭圆发光台座（大勋章下方），已解锁带稀有度辉光 + 光波扩散 + 悬浮投影，未解锁灰底，hover 增强 */
.medal-base {
  position: relative;
  width: 100%; max-width: 92px;
  height: 14px; border-radius: 50%;
  background: rgba(var(--rr, 148, 163, 184), 0.30);
  filter: blur(5px);
  transition: background .18s ease;
  pointer-events: none;
  margin-top: -4px;
}
/* 底座光波：内圈亮环脉冲扩散（稀有度色跟随） */
.medal-base::after {
  content: ''; position: absolute; left: 50%; top: 50%;
  width: 60%; height: 60%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 1px solid rgba(var(--rr, 148, 163, 184), 0.5);
  opacity: 0;
  animation: basePulse 3.2s ease-out infinite;
}
.medal-cell:hover .medal-base { background: rgba(var(--rr, 148, 163, 184), 0.55); }
.medal-cell:hover .medal-base::after { border-color: rgba(var(--rr, 148, 163, 184), 0.8); }
@keyframes basePulse {
  0% { opacity: .7; transform: translate(-50%, -50%) scale(.6); }
  70% { opacity: 0; transform: translate(-50%, -50%) scale(1.6); }
  100% { opacity: 0; }
}
.medal-sname { font-size: 10.5px; color: var(--muted); opacity: .75; letter-spacing: .3px; }
.medal {
  position: relative;
  width: 44px; height: 44px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-faint);
  border: 1px solid var(--line);
  cursor: pointer;
  animation: medalIn .4s cubic-bezier(.2, .7, .3, 1) both;
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.medal-icon { position: relative; z-index: 3; line-height: 1; color: var(--muted); opacity: .65; transition: color .18s ease, opacity .18s ease, transform .18s ease; }
/* 稀有度配色（2026-08-13）：外层统一圆形徽章，--rr 驱动圆底/边框/光晕与图标色；内层形状作稀有度徽记 */
.medal.got {
  --rr: 91, 124, 250;
  background:
    radial-gradient(circle at 32% 24%, rgba(255, 255, 255, 0.18), transparent 42%),
    radial-gradient(circle at 35% 30%, rgba(var(--rr), 0.32), rgba(var(--rr), 0.10) 68%);
  border: 2px solid rgba(var(--rr), 0.55);
  border-radius: 50%;
  box-shadow: 0 0 12px rgba(var(--rr), 0.28), inset 0 1px 4px rgba(255, 255, 255, 0.10);
}
.medal.got.bronze   { --rr: 184, 115, 51; }
.medal.got.silver   { --rr: 159, 178, 192; }
.medal.got.gold     { --rr: 217, 165, 20; }
.medal.got.platinum { --rr: 125, 211, 252; outline: 1px solid rgba(var(--rr), 0.35); outline-offset: 2px; }
.medal.got .medal-icon { color: rgba(var(--rr), 0.95); opacity: 1; filter: none; }
/* 特效加码（2026-08-14）：外圈流光环——完整光带绕圆旋转（rotate 方案，不依赖 --ang），
   档位差异化：光带数（铜1/银2/金2/白金3）+ 亮度 + 速度；与内圈 ::after 反向对向转。
   inset -5px 让光带脱离勋章本体一圈，避免与 2px 实色边框同色系融在一起 */
.medal.got::before {
  content: ''; position: absolute; inset: -5px; border-radius: 50%;
  padding: 3px; z-index: 1; pointer-events: none;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(var(--rr), 1) 70deg, transparent 130deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: achSpin 5s linear infinite;
  opacity: .5;
}
.medal.got.bronze::before {
  opacity: .45; animation-duration: 5.5s;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(var(--rr), 1) 70deg, transparent 130deg);
}
.medal.got.silver::before {
  opacity: .6; animation-duration: 4.5s;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(var(--rr), 1) 55deg, transparent 100deg, rgba(var(--rr), 0.7) 175deg, transparent 220deg);
}
.medal.got.gold::before {
  opacity: .85; animation-duration: 3s;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(var(--rr), 1) 50deg, transparent 90deg, rgba(var(--rr), 0.8) 165deg, transparent 205deg);
}
.medal.got.platinum::before {
  opacity: 1; animation-duration: 2.2s;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(var(--rr), 1) 40deg, transparent 75deg, rgba(var(--rr), 0.9) 130deg, transparent 165deg, rgba(var(--rr), 0.75) 235deg, transparent 270deg);
}
/* 内圈反向流光（::after 环形，rotate 旋转不依赖 --ang，与外圈对向转；稀有度差异化） */
.medal.got::after {
  content: ''; position: absolute; inset: 13%;
  border-radius: 50%;
  padding: 1.5px; z-index: 2; pointer-events: none;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(var(--rr), 0.85) 70deg, transparent 140deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: achSpinRev 4s linear infinite;
  opacity: .55;
}
.medal.got.bronze::after   { opacity: .22; animation-duration: 6s; }
.medal.got.silver::after   { opacity: .4;  animation-duration: 5s; }
.medal.got.gold::after     { opacity: .65; animation-duration: 3.2s; }
.medal.got.platinum::after { opacity: .85; animation-duration: 2.6s; }
@keyframes achSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes achSpinRev { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
/* hover 流光加速：内外圈都转快，光效更热烈 */
.medal.got:hover::before { animation-duration: 1.6s; }
.medal.got:hover::after { animation-duration: 1.8s; }
.medal.got .medal-bg { animation: achGlow 3s ease-in-out infinite; }
.medal.got.platinum .medal-bg { animation-duration: 2s; }
@keyframes achGlow {
  0%, 100% { filter: drop-shadow(0 0 4px rgba(var(--rr), 0.35)); }
  50% { filter: drop-shadow(0 0 10px rgba(var(--rr), 0.6)); }
}
.medal:hover { transform: translateY(-3px) scale(1.12); z-index: 5; }
.medal:hover .medal-icon { transform: rotate(-8deg) scale(1.1); }
.medal.got:hover {
  animation: medalWiggle .5s ease;
  box-shadow: 0 0 14px rgba(var(--rr), 0.5);
}
/* 内层稀有度形状徽记（铜=圆/银=六边/金=盾/白金=八角星），缩小嵌在圆形徽章内 */
.medal-bg {
  position: absolute; inset: 16%;
  width: auto; height: auto;
  z-index: 0;
  pointer-events: none;
}
.medal-bg path {
  fill: rgba(var(--rr), 0.10);
  stroke: rgba(var(--rr), 0.6);
  stroke-width: 2.5;
  stroke-linejoin: round;
}
/* 勋章墙代表勋章：56px（9 列网格适配），向下投影悬浮，hover 上浮（浮层已迁移 Teleport+floating-ui） */
.big-medal { width: 56px; height: 56px; }
.big-medal .medal-bg { inset: 16%; }
.big-medal .medal-icon { transform: scale(1); }
.big-medal:hover { transform: translateY(-4px) scale(1.08); }
/* 未解锁底座：灰影（无稀有度辉光） */
.medal-base.off { background: rgba(148, 163, 184, 0.16); }
.medal-base.off::after { display: none; }
/* 能量光球：勋章上方稀有度色光球悬浮旋转（光环 + 中心光点），hover 增强 */
.medal-orb {
  position: absolute; top: -14px; left: 50%;
  transform: translateX(-50%);
  width: 20px; height: 20px; border-radius: 50%;
  z-index: 6; pointer-events: none;
  background: radial-gradient(circle at 38% 32%, rgba(var(--rr, 148, 163, 184), 0.9), rgba(var(--rr, 148, 163, 184), 0.15) 68%);
  box-shadow: 0 0 12px rgba(var(--rr, 148, 163, 184), 0.6);
  animation: orbFloat 2.8s ease-in-out infinite;
}
.medal-orb::after {
  content: ''; position: absolute; inset: -6px;
  border-radius: 50%;
  border: 1px solid rgba(var(--rr, 148, 163, 184), 0.5);
  animation: orbRing 2.8s linear infinite;
}
@keyframes orbFloat {
  0%, 100% { margin-top: 0; }
  50% { margin-top: -5px; }
}
@keyframes orbRing {
  from { transform: rotate(0deg) scale(1); opacity: .8; }
  to { transform: rotate(360deg) scale(1.25); opacity: 0; }
}
@keyframes medalWiggle {
  0%, 100% { transform: translateY(-3px) scale(1.12) rotate(0); }
  30% { transform: translateY(-3px) scale(1.12) rotate(-8deg); }
  60% { transform: translateY(-3px) scale(1.12) rotate(6deg); }
}
@keyframes medalIn { from { opacity: 0; transform: scale(.5); } to { opacity: 1; transform: scale(1); } }

/* NEW 角标：3 天内解锁的金色角标（弹跳出现） */
.medal-new {
  position: absolute; top: -5px; right: -6px;
  z-index: 4;
  font-size: 8.5px; font-weight: 700; letter-spacing: .3px;
  color: #1a1205;
  background: linear-gradient(135deg, #ffd76a, #f5a623);
  border-radius: 7px; padding: 1px 5px;
  box-shadow: 0 2px 6px rgba(245, 166, 35, 0.5);
  animation: newPop .5s cubic-bezier(.2, .7, .3, 1) both;
  pointer-events: none;
}
@keyframes newPop { from { opacity: 0; transform: scale(.4); } 70% { transform: scale(1.2); } to { opacity: 1; transform: scale(1); } }

/* ===== 用户卡右侧勋章区（2026-08-13 V2）：已解锁全部松散平铺 + 倾斜重力 ===== */
/* tilt.js 在卡片上暴露 --tiltRx/--tiltRy（rotateY/rotateX 角度数字），
   整片反向位移 = 重力滑落；单枚再叠一层位移 + 反向倾倒，形成层次物理感。
   animation:none 必须——基类 .medal 的 medalIn(fill both) 填充帧会压制 transform */
.medal-area {
  --tiltRx: 0; --tiltRy: 0;
  position: relative;
  flex: 1; min-width: 0;
  display: flex; flex-wrap: wrap; align-items: center;
  gap: 8px;
  padding-left: 24px; padding-right: 16px;
  cursor: pointer;
  transform: translate(calc(var(--tiltRx) * -2.6px), calc(var(--tiltRy) * 2.6px));
  transition: transform .18s cubic-bezier(.2, .7, .3, 1);
}
.area-medal {
  width: 34px; height: 34px;
  animation: none;
  transform: translate(calc(var(--tiltRx) * -1.4px), calc(var(--tiltRy) * 1.4px)) rotate(calc(var(--tiltRx) * -0.7deg));
  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.area-medal .medal-icon { font-size: 16px; }
/* hover 弹起 + 摆动（keyframes 内嵌重力项，避免动画覆盖位移；浮层已迁移 Teleport+floating-ui） */
.area-medal:hover {
  transform: translate(calc(var(--tiltRx) * -1.4px), calc(var(--tiltRy) * 1.4px)) translateY(-8px) scale(1.2) rotate(calc(var(--tiltRx) * -0.7deg));
  z-index: 30 !important;
  animation: medalStackWiggle .5s ease;
}
@keyframes medalStackWiggle {
  0%, 100% { transform: translate(calc(var(--tiltRx) * -1.4px), calc(var(--tiltRy) * 1.4px)) translateY(-8px) scale(1.2) rotate(calc(var(--tiltRx) * -0.7deg)); }
  30% { transform: translate(calc(var(--tiltRx) * -1.4px), calc(var(--tiltRy) * 1.4px)) translateY(-8px) scale(1.2) rotate(calc(var(--tiltRx) * -0.7deg) - 8deg); }
  60% { transform: translate(calc(var(--tiltRx) * -1.4px), calc(var(--tiltRy) * 1.4px)) translateY(-8px) scale(1.2) rotate(calc(var(--tiltRx) * -0.7deg) + 6deg); }
}

/* P6-B 移动端适配：勋章墙 9 列 → 6 列（820px 断点与 useResponsive 一致） */
@media (max-width: 820px) {
  .medal-grid { grid-template-columns: repeat(6, 1fr); gap: 14px 6px; }
  .wf-panel { height: 92dvh; max-height: 92dvh; }
  /* 字号缩放已恢复移动端 zoom（0.85~1.20 限幅），字号滑块正常显示 */
}

</style>