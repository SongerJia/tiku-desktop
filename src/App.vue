<script setup>
import { ref, onMounted } from 'vue'
import Home from './components/Home.vue'
import Knowledge from './components/Knowledge.vue'
import KbLibrary from './components/KbLibrary.vue'
import Stats from './components/Stats.vue'
import Profile from './components/Profile.vue'
import SubjectSelector from './components/SubjectSelector.vue'
import Quiz from './components/Quiz.vue'
import PracticeSetup from './components/PracticeSetup.vue'
import BankManager from './components/BankManager.vue'
import MockExamSetup from './components/MockExamSetup.vue'
import UnifiedSearch from './components/UnifiedSearch.vue'
import { tiku } from './api/tiku.js'
import { useResponsive } from './composables/useResponsive.js'
import { applyAppearance } from './utils/appearance.js'

const { isWide } = useResponsive()

const tabs = [
  { key: 'home', label: '首页', icon: 'home' },
  { key: 'bank', label: '题库', icon: 'bank' },
  { key: 'kb', label: '知识库', icon: 'doc' },
  { key: 'stats', label: '学习统计', icon: 'stats' },
  { key: 'profile', label: '我的', icon: 'me' }
]

const currentTab = ref('home')
const currentSubject = ref({ id: null, name: '请选择科目' })
const showSubjectPicker = ref(false)
const quiz = ref({ active: false, categoryId: null, subjectId: null, mode: 'practice', order: 'sequential', limit: null, durationMin: null, recite: false, paperId: null, tags: null })
// 练习设置弹层：所有「开始刷题」入口先到这里配置范围/方式/考试参数
const setup = ref({ active: false, categoryId: null, subjectId: null, presetMode: 'practice', scopeLabel: '' })
// 题库管理（导入/录题/编辑/删除）
const showBank = ref(false)
// 模拟卷组卷 / 我的试卷
const mock = ref({ active: false })
// 统一搜索（题目 + 知识文档）
const showSearch = ref(false)

onMounted(async () => {
  currentSubject.value = await tiku.getCurrentSubject()
  await applyAppearance() // 应用上次保存的主题与字号
})

// 导入或增删题目后，科目树可能变了（自动建了新科目），重取一次当前科目
async function onBankChanged() {
  currentSubject.value = await tiku.getCurrentSubject()
}

function switchTab(key) {
  currentTab.value = key
  quiz.value.active = false
}

async function onSubjectSelected(subject) {
  await tiku.setCurrentSubject(subject.id)
  currentSubject.value = subject
  showSubjectPicker.value = false
}

// 统一入口：Home/Knowledge/错题本/收藏 都先打开设置弹层
function onStart(payload = {}) {
  const m = payload.mode || 'practice'
  // 错题/收藏/智能复习是全局池，不限定科目；其余按当前科目范围
  const subjectScoped = !['wrong', 'favorite', 'review-due'].includes(m)
  setup.value = {
    active: true,
    categoryId: payload.categoryId ?? null,
    subjectId: subjectScoped ? currentSubject.value.id : null,
    presetMode: m,
    scopeLabel: payload.categoryId ? '本章节' : (currentSubject.value.name || '全部')
  }
}

function onSetupConfirm(cfg) {
  quiz.value = {
    active: true,
    categoryId: cfg.categoryId,
    subjectId: cfg.subjectId,
    mode: cfg.mode,
    order: cfg.order || 'sequential',
    limit: cfg.limit ?? null,
    durationMin: cfg.durationMin ?? null,
    recite: !!cfg.recite,
    paperId: null,
    tags: cfg.tags && cfg.tags.length ? cfg.tags : null
  }
  setup.value.active = false
}

function startQuiz({ categoryId, mode }) {
  quiz.value = { active: true, categoryId, subjectId: null, mode: mode || 'practice', order: 'sequential', limit: null, durationMin: null, recite: false, paperId: null, tags: null }
}
function exitQuiz() {
  quiz.value = { active: false, categoryId: null, subjectId: null, mode: 'practice', order: 'sequential', limit: null, durationMin: null, recite: false, paperId: null, tags: null }
}

// 模拟卷：组卷生成后直接用 paperId 进入考试模式
function onStartMock() {
  mock.value.active = true
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
const iconDoc = `<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6zM14 3v5h5l-5-5zM9 12h8v1.5H9zM9 15.5h8V17H9zM9 9h3v1.5H9z"/></svg>`
const iconStats = `<svg viewBox="0 0 24 24"><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>`
const iconMe = `<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`
const icons = { home: iconHome, bank: iconBank, doc: iconDoc, stats: iconStats, me: iconMe }
</script>

<template>
  <!-- 容器：宽屏走 PC 布局，窄屏走手机布局 -->
  <div class="app" :class="isWide ? 'is-wide' : 'is-mobile'">
    <!-- PC 侧边导航 -->
    <aside v-if="isWide" class="sidebar">
      <div class="side-brand">
        <span class="side-logo">📚</span>
        <span class="side-name">知识记忆小助手</span>
      </div>
      <nav class="side-nav">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="side-item"
          :class="{ active: currentTab === t.key && !quiz.active }"
          @click="switchTab(t.key)"
        >
          <span class="side-icon" v-html="icons[t.icon]"></span>
          <span class="side-label">{{ t.label }}</span>
        </button>
      </nav>
      <div class="side-foot">本地数据 · 离线可用</div>
    </aside>

    <!-- 主列：顶部栏 + 内容 +（窄屏）底部 Tab -->
    <div class="main-col">
      <header class="topbar">
        <button class="subject-btn" @click="showSubjectPicker = true">
          <span class="dot"></span>
          <span class="sb-name">{{ currentSubject.name }}</span>
          <span class="arrow">▾</span>
        </button>
        <button class="top-search" title="统一搜索（题目 + 知识文档）" @click="showSearch = true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
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
          @exit="exitQuiz"
        />
        <template v-else>
          <Home v-if="currentTab === 'home'" :subject="currentSubject" @start="onStart" @start-mock="onStartMock" />
          <Knowledge v-else-if="currentTab === 'bank'" :subject="currentSubject" @start="onStart" />
          <KbLibrary v-else-if="currentTab === 'kb'" />
          <Stats v-else-if="currentTab === 'stats'" />
          <Profile
            v-else-if="currentTab === 'profile'"
            @reset="currentTab = 'home'"
            @start="onStart"
            @open-bank="showBank = true"
          />
        </template>
      </main>

      <nav v-if="!isWide" class="bottom-tab">
        <div
          v-for="t in tabs"
          :key="t.key"
          class="tab-item"
          :class="{ active: currentTab === t.key && !quiz.active }"
          @click="switchTab(t.key)"
        >
          <span class="tab-icon" v-html="icons[t.icon]"></span>
          <span>{{ t.label }}</span>
        </div>
      </nav>
    </div>

    <SubjectSelector
      v-model:show="showSubjectPicker"
      :wide="isWide"
      :currentId="currentSubject.id"
      @select="onSubjectSelected"
    />

    <PracticeSetup
      v-if="setup.active"
      :show="setup.active"
      :wide="isWide"
      :preset="setup"
      @confirm="onSetupConfirm"
      @cancel="setup.active = false"
    />

    <BankManager
      :show="showBank"
      :wide="isWide"
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
  </div>
</template>

<style scoped>
.subject-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  background: rgba(42, 245, 255, 0.06);
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 10px;
  box-shadow: var(--glow-soft);
  transition: border-color .2s, box-shadow .2s, color .2s;
}
.subject-btn:hover { border-color: var(--brand); color: var(--brand); box-shadow: var(--glow); }
.subject-btn .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 8px var(--brand); }
.subject-btn .arrow { font-size: 11px; color: var(--muted); }
.top-search {
  margin-left: auto;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: rgba(42, 245, 255, 0.06);
  color: var(--text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: border-color .2s, box-shadow .2s, color .2s;
}
.top-search:hover { border-color: var(--brand); color: var(--brand); box-shadow: var(--glow-soft); }
</style>
