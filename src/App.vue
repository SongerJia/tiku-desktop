<script setup>
import { ref, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
// 首屏轻量组件静态引入（侧栏/首页/弹层容器）
import Home from './components/Home.vue'
import SubjectSelector from './components/SubjectSelector.vue'
import UnifiedSearch from './components/UnifiedSearch.vue'
import AppToast from './components/AppToast.vue'
import AppConfirm from './components/AppConfirm.vue'
import AppPrompt from './components/AppPrompt.vue'
import SubjectConfigModal from './components/SubjectConfigModal.vue'
import LogoMark from './components/LogoMark.vue'
// 大组件按需拆包：进入对应视图/弹层才加载，首屏 bundle 瘦身
const Quiz = defineAsyncComponent(() => import('./components/Quiz.vue'))
const Knowledge = defineAsyncComponent(() => import('./components/Knowledge.vue'))
const Stats = defineAsyncComponent(() => import('./components/Stats.vue'))
const Profile = defineAsyncComponent(() => import('./components/Profile.vue'))
const PracticeSetup = defineAsyncComponent(() => import('./components/PracticeSetup.vue'))
const BankManager = defineAsyncComponent(() => import('./components/BankManager.vue'))
const MockExamSetup = defineAsyncComponent(() => import('./components/MockExamSetup.vue'))
import { tiku } from './api/tiku.js'
import { useResponsive } from './composables/useResponsive.js'
import { useSubjectConfig } from './composables/useSubjectConfig.js'
import { applyAppearance } from './utils/appearance.js'
import { showToast } from './utils/toast.js'

const { isWide } = useResponsive()

const tabs = [
  { key: 'home', label: '首页', icon: 'home' },
  { key: 'bank', label: '题库', icon: 'bank' },
  { key: 'practice', label: '刷题', icon: 'bolt' },
  { key: 'stats', label: '学习统计', icon: 'stats' },
  { key: 'profile', label: '我的', icon: 'me' }
]

const currentTab = ref('home')
const currentSubject = ref({ id: null, name: '请选择科目' })
// 顶部选择器的「当前章节」：选科目时为 null；选章节/子章节时记录该节点（currentSubject 始终为所属科目）
const currentChapter = ref(null)
const showSubjectPicker = ref(false)
const quiz = ref({ active: false, categoryId: null, subjectId: null, mode: 'practice', order: 'sequential', limit: null, durationMin: null, recite: false, paperId: null, tags: null, questionId: null, daily: false })
// 练习设置弹层：所有「开始刷题」入口先到这里配置范围/方式/考试参数
const setup = ref({ active: false, categoryId: null, subjectId: null, presetMode: 'practice', subjectName: '', scopeLabel: '' })
// 题库管理（导入/录题/编辑/删除）
const showBank = ref(false)
const bankSubjectId = ref(null) // 入口初始科目：tab 页=当前科目，我的页=null 全部
const bankCategoryId = ref(null) // 入口初始章节（题库页内选中的章节；我的页=null 全部章节）
// 模拟卷组卷 / 我的试卷
const mock = ref({ active: false })
// 统一搜索（题目 + 知识文档）
const showSearch = ref(false)
// 切回首页时的刷新计数（驱动 Home 重新加载实时数据）
const homeRefresh = ref(0)
// 题库管理弹窗变更计数（驱动 Knowledge 刷新列表）
const bankRefreshToken = ref(0)
// 科目配置
const { config: subjectConfig, refreshConfig: refreshSubjectConfig, updateConfig: updateSubjectConfig } = useSubjectConfig(currentSubject)
const showSubjectConfig = ref(false)

// PC 侧栏宽度：可拖动右边缘调整，本地持久化
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 360
const SIDEBAR_DEFAULT = 236
const SIDEBAR_KEY = 'sidebar-width'
const sidebarWidth = ref(SIDEBAR_DEFAULT)
let resizeStartX = 0
let resizeStartW = SIDEBAR_DEFAULT
function startResize(e) {
  resizeStartX = e.clientX
  resizeStartW = sidebarWidth.value
  document.body.classList.add('is-resizing')
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', stopResize)
  e.preventDefault()
}
function onResize(e) {
  const delta = e.clientX - resizeStartX
  sidebarWidth.value = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, resizeStartW + delta))
}
function stopResize() {
  document.body.classList.remove('is-resizing')
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
  try { localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth.value)) } catch (e) { /* 隐私模式可能抛错，忽略 */ }
}

onMounted(async () => {
  try {
    const saved = Number(localStorage.getItem(SIDEBAR_KEY))
    if (saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) sidebarWidth.value = saved
  } catch (e) { /* 忽略 */ }
  currentSubject.value = await tiku.getCurrentSubject()
await applyAppearance() // 应用上次保存的主题与字号
  // 若本次启动数据库由损坏自动从备份恢复，提示用户（数据可能回滚到最近一次备份）
  try {
    const st = await tiku.getDbStatus()
    if (st && st.recovered) showToast('数据库已自动从备份恢复（数据可能回滚到最近一次备份）', 'ok')
  } catch (e) { /* 忽略 */ }
  // P6-A：移动端禁用系统右键/长按上下文菜单（触屏误触弹出菜单体验差；桌面端保留 F12/右键调试）
  if (!isWide.value) {
    document.addEventListener('contextmenu', onNoContextMenu)
  }
})

// 移动端禁用 contextmenu（isWide 为窄屏时挂载；桌面右键保留）
function onNoContextMenu(e) { e.preventDefault() }

// 卸载时清理 resize 全局监听，避免泄漏
onBeforeUnmount(() => {
  stopResize()
  document.removeEventListener('contextmenu', onNoContextMenu)
})

// 导入或增删题目后，科目树可能变了（自动建了新科目），重取一次当前科目
async function onBankChanged() {
  currentSubject.value = await tiku.getCurrentSubject()
  bankRefreshToken.value++ // 题库管理弹窗变更 → 刷新 Knowledge 题库列表
}

function switchTab(key) {
  // 刷题按钮：短按 = 快速刷 5 题（跳过配置弹层），长按功能保留
  if (key === 'practice') {
    onQuickStart()
    return
  }
  currentTab.value = key
  quiz.value.active = false
  // 切回首页时刷新（每日任务/习惯/专注数据是实时的）
  if (key === 'home') homeRefresh.value++
}

// 子组件请求跳转（如每日任务「阅读」→ 题库 Tab；我的页可携带分组定位）
const profileSection = ref('') // Profile 页内要定位的分组（如 goals 学习目标）
function onGoto(tab, section) {
  if (tab === 'profile' && section) profileSection.value = section
  switchTab(tab)
}

async function onSubjectSelected(sel) {
  // sel 来自 SubjectSelector：id/name 是实际选中节点，subjectId/subjectName 是所属根科目
  // currentSubject 始终保持为「科目」，章节单独记到 currentChapter，避免下游把它当科目用
  currentSubject.value = { id: sel.subjectId, name: sel.subjectName }
  currentChapter.value = (sel.id !== sel.subjectId) ? { id: sel.id, name: sel.name } : null
  await tiku.setCurrentSubject(sel.subjectId)
  showSubjectPicker.value = false
}

// 统一入口：Home/Knowledge/错题本/收藏 都先打开设置弹层
function onStart(payload = {}) {
  const m = payload.mode || 'practice'
  // 内容闭环（练习/错题/收藏/智能复习等）默认跟随当前科目，弹层内可切「全部科目」；
  // 未选科目（id=null）时自然为全局。
  setup.value = {
    active: true,
    categoryId: payload.categoryId ?? null,
    subjectId: currentSubject.value.id,
    presetMode: m,
    subjectName: currentSubject.value.name || '',
    scopeLabel: payload.categoryId ? '本章节' : (currentSubject.value.name || '全部'),
    year: payload.year || null  // 真题年份
  }
}

function onSetupConfirm(cfg) {
  quiz.value = {
    active: true,
    categoryId: cfg.categoryId,
    categoryIds: cfg.categoryIds && cfg.categoryIds.length ? cfg.categoryIds : null,
    subjectId: cfg.subjectId,
    mode: cfg.mode,
    order: cfg.order || 'sequential',
    limit: cfg.limit ?? null,
    durationMin: cfg.durationMin ?? null,
    recite: !!cfg.recite,
    paperId: null,
    tags: cfg.tags && cfg.tags.length ? cfg.tags : null,
    year: cfg.year || null,
    resume: null
  }
  setup.value.active = false
}

// 断点续做：直接用保存的题目与位置恢复
function onResume(session) {
  quiz.value = {
    active: true,
    categoryId: session.categoryId || null,
    categoryIds: session.categoryIds && session.categoryIds.length ? session.categoryIds : null,
    subjectId: session.subjectId || null,
    mode: 'practice',
    order: session.order || 'sequential',
    limit: null,
    durationMin: null,
    recite: false,
    paperId: null,
    tags: null,
    resume: session
  }
  setup.value.active = false
}


function exitQuiz() {
  quiz.value = { active: false, categoryId: null, subjectId: null, mode: 'practice', order: 'sequential', limit: null, durationMin: null, recite: false, paperId: null, tags: null, questionId: null, daily: false }
  homeRefresh.value++ // 答题回来刷新首页（每日一题卡片状态等）
}

// 每日一题：直接进入该题作答（跳过练习设置弹层），答完由 Quiz 自动提交连击
function startDailyPuzzle(question) {
  quiz.value = {
    active: true,
    categoryId: question.category_id || null,
    subjectId: null,
    mode: 'practice',
    order: 'sequential',
    limit: 1,
    durationMin: null,
    recite: false,
    paperId: null,
    tags: null,
    questionId: question.id,
    daily: true
  }
}

// 模拟卷：组卷生成后直接用 paperId 进入考试模式
function onStartMock() {
  mock.value.active = true
}
// 3 分钟快刷：跳过练习设置弹层，随机 5 题即点即刷（降低启动摩擦，首页行动台入口）
function onQuickStart() {
  quiz.value = {
    active: true,
    categoryId: null,
    subjectId: currentSubject.value.id,
    mode: 'practice',
    order: 'random',
    limit: 5,
    durationMin: null,
    recite: false,
    paperId: null,
    tags: null,
    resume: null
  }
}
function onMockConfirm(cfg) {
  quiz.value = {
    active: true,
    categoryId: null,
    subjectId: null,
    mode: 'exam',
    order: 'sequential',
    limit: null,
    durationMin: cfg.durationMin ?? 90,
    recite: false,
    paperId: cfg.paperId
  }
  mock.value.active = false
}

const iconHome = `<svg viewBox="0 0 24 24"><path d="M12 3l-9 8h3v10h5v-6h4v6h5V11h3z"/></svg>`
const iconBank = `<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zM4 11h16v2H4zM4 16h16v2H4zM6 3h12l1 2H5z"/></svg>`
const iconBolt = `<svg viewBox="0 0 24 24"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>`
const iconStats = `<svg viewBox="0 0 24 24"><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>`
const iconMe = `<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`
const icons = { home: iconHome, bank: iconBank, bolt: iconBolt, stats: iconStats, me: iconMe }
</script>

<template>
  <!-- 容器：宽屏走 PC 布局，窄屏走手机布局 -->
  <div class="app" :class="isWide ? 'is-wide' : 'is-mobile'">
    <!-- PC 侧边导航 -->
    <aside v-if="isWide" class="sidebar" :style="{ width: sidebarWidth + 'px' }">
      <div class="side-brand">
        <LogoMark :size="34" class="side-logo-img" />
        <span class="side-name">知识记忆小助手</span>
      </div>
<nav class="side-nav">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="side-item"
          :class="{ active: currentTab === t.key && !quiz.active, 'side-practice': t.key === 'practice' }"
          @click="switchTab(t.key)"
          @contextmenu.prevent="t.key === 'practice' && onStart({ mode: 'practice' })"
        >
          <span class="side-icon" :class="{ 'bolt-icon': t.key === 'practice' }" v-html="icons[t.icon]"></span>
          <span class="side-label">{{ t.label }}</span>
          <span v-if="t.key === 'practice'" class="side-longtip" title="右键/长按打开详细配置">⋯</span>
        </button>
</nav>
</aside>

    <!-- 主列：顶部栏 + 内容 +（窄屏）底部 Tab -->
    <div class="main-col">
      <header class="topbar">
        <button class="subject-btn" @click="showSubjectPicker = true">
          <span class="dot"></span>
          <span class="sb-name">{{ currentChapter ? currentSubject.name + ' / ' + currentChapter.name : currentSubject.name }}</span>
          <span class="arrow">▾</span>
        </button>
        <button class="top-search" title="搜索题目" @click="showSearch = true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        </button>
        <button class="top-cfg" title="科目配置" @click="showSubjectConfig = true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        </button>
      </header>

      <main class="page-content">
        <Quiz
          v-if="quiz.active"
          :wide="isWide"
          :categoryId="quiz.categoryId"
          :subjectId="quiz.subjectId"
          :mode="quiz.mode"
          :order="quiz.order"
          :limit="quiz.limit"
          :durationMin="quiz.durationMin"
          :recite="quiz.recite"
          :paperId="quiz.paperId"
          :tags="quiz.tags"
          :resume="quiz.resume"
          :questionId="quiz.questionId"
          :daily="quiz.daily"
          :subjectConfig="subjectConfig"
          @exit="exitQuiz"
        />
        <template v-else>
          <Transition name="fade" mode="out-in">
            <div :key="currentTab" class="tab-page">
              <Home v-if="currentTab === 'home'" :subject="currentSubject" :current-chapter-id="currentChapter?.id ?? null" :refresh-key="homeRefresh" @start="onStart" @start-mock="onStartMock" @goto="onGoto" @daily="startDailyPuzzle" @quick="onQuickStart" />
              <Knowledge v-else-if="currentTab === 'bank'" :subject="currentSubject" :subject-config="subjectConfig" :current-chapter-id="currentChapter?.id ?? null" :refresh-token="bankRefreshToken" @start="onStart" @manage="(cat) => { showBank = true; bankSubjectId = currentSubject.id; bankCategoryId = cat || null }" />
              <Stats v-else-if="currentTab === 'stats'" :subject="currentSubject" @goto="onGoto" />
              <Profile
            v-else-if="currentTab === 'profile'"
            :focus-section="profileSection"
            @focus-consumed="profileSection = ''"
            @reset="currentTab = 'home'"
            @start="onStart"
            @open-bank="showBank = true; bankSubjectId = currentSubject.id; bankCategoryId = currentChapter?.id ?? null"
          />
            </div>
          </Transition>
        </template>
      </main>

      <nav v-if="!isWide" class="bottom-tab">
        <div
          v-for="t in tabs"
          :key="t.key"
          class="tab-item"
          :class="{ active: currentTab === t.key && !quiz.active, 'tab-practice': t.key === 'practice' }"
          @click="switchTab(t.key)"
          @contextmenu.prevent="t.key === 'practice' && onStart({ mode: 'practice' })"
        >
          <span class="tab-icon" :class="{ 'bolt-icon': t.key === 'practice' }" v-html="icons[t.icon]"></span>
          <span>{{ t.label }}</span>
        </div>
      </nav>
    </div>

    <SubjectSelector
      v-model:show="showSubjectPicker"
      :wide="isWide"
      :currentId="currentSubject.id"
      @select="onSubjectSelected"
      @close="showSubjectPicker = false"
    />

    <PracticeSetup
      v-if="setup.active"
      :show="setup.active"
      :wide="isWide"
      :preset="setup"
      @confirm="onSetupConfirm"
      @resume="onResume"
      @cancel="setup.active = false"
    />

    <BankManager
      :show="showBank"
      :wide="isWide"
      :initial-subject-id="bankSubjectId"
      :initial-category-id="bankCategoryId"
      @close="showBank = false"
      @changed="onBankChanged"
    />

    <MockExamSetup
      v-if="mock.active"
      :show="mock.active"
      :wide="isWide"
      :subject="currentSubject"
      @confirm="onMockConfirm"
      @cancel="mock.active = false"
    />

    <UnifiedSearch :show="showSearch" @close="showSearch = false" />
    <AppToast />
    <AppConfirm />
    <AppPrompt />
    <SubjectConfigModal :show="showSubjectConfig" :subject="currentSubject" :config="subjectConfig" @close="showSubjectConfig = false" @save="updateSubjectConfig" />
  </div>
</template>

<style scoped>
.subject-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--brand) 6%, transparent);
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 10px;
  box-shadow: var(--glow-soft);
  transition: border-color .2s, box-shadow .2s, color .2s;
}
.subject-btn:hover { border-color: var(--brand); color: var(--brand); box-shadow: var(--glow); }.subject-btn .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 8px var(--brand); }
.subject-btn .arrow { font-size: 11px; color: var(--muted); }
.top-search {
  margin-left: auto;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--brand) 6%, transparent);
  color: var(--text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: border-color .2s, box-shadow .2s, color .2s;
}
.top-search:hover { border-color: var(--brand); color: var(--brand); box-shadow: var(--glow-soft); }
.top-cfg {
  margin-left: 6px;
  width: 34px; height: 34px; border-radius: 10px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--brand) 6%, transparent);
  color: var(--muted); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: border-color .2s, box-shadow .2s, color .2s;
}
.top-cfg:hover { border-color: var(--brand); color: var(--brand); box-shadow: var(--glow-soft); }
.tab-page { height: 100%; }
.fade-enter-active, .fade-leave-active { transition: opacity .16s ease, transform .16s ease; }
.fade-enter-from { opacity: 0; transform: translateY(6px); }
.fade-leave-to { opacity: 0; }

/* 刷题按钮：品牌色突出 */
.side-practice {
  margin: 6px 0;
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 18%, transparent), color-mix(in srgb, var(--brand2) 12%, transparent));
  border: 1px solid color-mix(in srgb, var(--brand) 40%, transparent);
  border-radius: 12px;
  font-weight: 600;
}
.side-practice:hover { border-color: var(--brand); box-shadow: var(--glow); }
.side-practice .bolt-icon { color: var(--brand); }
.side-practice.active { border-color: var(--brand); background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 25%, transparent), color-mix(in srgb, var(--brand2) 18%, transparent)); }
.side-longtip { margin-left: auto; font-size: 11px; color: var(--muted); opacity: 0.5; letter-spacing: 1px; }

/* 移动端底部：刷题按钮居中凸起 */
.tab-practice {
  position: relative;
  transform: translateY(-6px);
}
.tab-practice .tab-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--brand), var(--brand2));
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px color-mix(in srgb, var(--brand) 50%, transparent);
  margin-bottom: 2px;
  transition: transform .2s, box-shadow .2s;
}
.tab-practice:active .tab-icon { transform: scale(.92); box-shadow: 0 2px 8px color-mix(in srgb, var(--brand) 40%, transparent); }
.tab-practice .tab-icon svg { width: 22px; height: 22px; fill: #fff; }
.tab-practice span:last-child { color: var(--brand); font-weight: 600; }
</style>
