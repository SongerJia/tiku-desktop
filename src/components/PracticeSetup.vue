<script setup>
import { ref, computed, onMounted } from 'vue'
import { tiku } from '../api/tiku.js'
import Icon from './Icon.vue'

const props = defineProps({
  show: Boolean,
  wide: Boolean,
  preset: { type: Object, default: () => ({ categoryId: null, subjectId: null, presetMode: 'practice', subjectName: '', scopeLabel: '' }) }
})
const emit = defineEmits(['confirm', 'cancel', 'resume'])

// 科目范围：默认跟随当前科目（内容闭环按科目维度），可切「全部科目」
const subjectScope = ref(props.preset.subjectId ? 'current' : 'all')

// 断点续做 + 智能复习到期提示
const resumeSession = ref(null)
const reviewDue = ref(null)
function resumeLast() {
  emit('resume', resumeSession.value)
}

// 范围 → 对应拉题 mode
const scopes = [
  { key: 'practice', label: '全部', desc: '当前范围所有题' },
  { key: 'wrong', label: '错题重练', desc: '错题本活跃题目' },
  { key: 'favorite', label: '收藏复习', desc: '我收藏的题目' },
  { key: 'unattempted', label: '未做专项', desc: '只练没答过的题' },
  { key: 'weak', label: '弱点强化', desc: '按正确率加权只练最弱的题' },
  { key: 'review-due', label: '智能复习', desc: '艾宾浩斯到期题' },
  { key: 'exam', label: '模拟考试', desc: '限时随机抽取' }
]

// 标签筛选：题库打过的标签，多选（AND 语义，题目须带全部所选标签）
const allTags = ref([])
const selTags = ref([])
onMounted(async () => {
  try { allTags.value = (await tiku.listTags()).map(t => t.tag) } catch (e) { allTags.value = [] }
  try { resumeSession.value = await tiku.getResumeSession() } catch (e) { resumeSession.value = null }
  try { reviewDue.value = await tiku.reviewDueStats(props.preset.subjectId) } catch (e) { reviewDue.value = null }
})
function toggleTag(t) {
  const i = selTags.value.indexOf(t)
  if (i >= 0) selTags.value.splice(i, 1)
  else selTags.value.push(t)
}

function presetToScope(m) {
  return ['practice', 'wrong', 'favorite', 'unattempted', 'weak', 'review-due', 'exam'].includes(m) ? m : 'practice'
}

const scope = ref(presetToScope(props.preset.presetMode))
const order = ref(scope.value === 'exam' ? 'random' : 'sequential')
const limit = ref(scope.value === 'exam' ? 50 : '')
const durationMin = ref(60)
// 练习方式：answer=正常作答判分 / recite=背题（直接看答案，不判分不记录）
// 刻意做成与「题库范围」正交的开关——这样「背错题」「背收藏」都成立，
// 而不是把背题硬塞进范围列表里变成互斥的第七个选项。
const recite = ref(false)

const isExam = computed(() => scope.value === 'exam')
const scopeLabel = computed(() => props.preset.scopeLabel || '全部范围')

function pickScope(s) {
  scope.value = s
  if (s === 'exam') {
    if (order.value !== 'random') order.value = 'random'
    if (!limit.value) limit.value = 50
    recite.value = false   // 考试不可能背题，互斥
  }
}

function confirm() {
  const cfg = {
    categoryId: props.preset.categoryId,
    subjectId: subjectScope.value === 'all' ? null : props.preset.subjectId,
    mode: scope.value,
    order: order.value,
    limit: limit.value ? Number(limit.value) : (isExam.value ? 50 : null),
    durationMin: isExam.value ? (durationMin.value ? Number(durationMin.value) : 60) : null,
    recite: isExam.value ? false : recite.value,
    tags: selTags.value.slice()
  }
  emit('confirm', cfg)
}
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="setup-mask" :class="{ 'is-wide': wide }" @click.self="emit('cancel')">
      <div class="setup-panel" :class="{ 'is-wide': wide }">
        <div class="header">
          <span class="close" @click="emit('cancel')">×</span>
          <span class="title">练习设置</span>
          <span class="scope">{{ scopeLabel }}</span>
        </div>

        <!-- 断点续做 -->
        <div v-if="resumeSession && resumeSession.questions" class="resume-bar">
          <span>上次练习到第 {{ (resumeSession.idx || 0) + 1 }}/{{ resumeSession.questions.length }} 题</span>
          <button class="btn btn-primary" @click="resumeLast">继续上次</button>
        </div>
        <!-- 智能复习到期提示 -->
        <div v-if="scope === 'review-due' && reviewDue" class="due-hint">
          <Icon name="clock" :size="13"/> 今日到期 <b>{{ reviewDue.due }}</b> 题 · 预计 {{ reviewDue.estMinutes }} 分钟
        </div>

        <!-- 科目范围（内容闭环默认跟随当前科目，可切全部） -->
        <div class="section" v-if="props.preset.subjectName">
          <div class="sec-title">科目范围</div>
          <div class="seg">
            <button :class="{ on: subjectScope === 'current' }" @click="subjectScope = 'current'">{{ props.preset.subjectName }}</button>
            <button :class="{ on: subjectScope === 'all' }" @click="subjectScope = 'all'">全部科目</button>
          </div>
        </div>

        <!-- 范围 -->
        <div class="section">
          <div class="sec-title">题库范围</div>
          <div class="chips">
            <button
              v-for="s in scopes"
              :key="s.key"
              class="chip"
              :class="{ active: scope === s.key }"
              @click="pickScope(s.key)"
            >
              <span class="chip-label">{{ s.label }}</span>
              <span class="chip-desc">{{ s.desc }}</span>
            </button>
          </div>
        </div>

        <!-- 标签筛选（可选）：多标签 AND 语义 -->
        <div class="section" v-if="allTags.length">
          <div class="sec-title">标签筛选（可选 · 题目须带全部所选标签）</div>
          <div class="chips">
            <button
              v-for="t in allTags"
              :key="t"
              class="chip"
              :class="{ active: selTags.includes(t) }"
              @click="toggleTag(t)"
            >
              <span class="chip-label">#{{ t }}</span>
            </button>
          </div>
        </div>

        <!-- 练习方式：背题与作答互斥，但都可叠加在任意范围上 -->
        <div class="section" v-if="!isExam">
          <div class="sec-title">练习方式</div>
          <div class="chips row">
            <button class="chip sm" :class="{ active: !recite }" @click="recite = false">
              <span>答题</span>
            </button>
            <button class="chip sm" :class="{ active: recite }" @click="recite = true">
              <span>背题</span>
            </button>
          </div>
          <div class="mode-tip">{{ recite ? '直接显示答案与解析，不判分、不计入统计与错题本' : '作答后判分，计入统计与错题本' }}</div>
        </div>

        <!-- 出题方式 -->
        <div class="section">
          <div class="sec-title">出题方式</div>
          <div class="chips row">
            <button class="chip sm" :class="{ active: order === 'sequential' }" @click="order = 'sequential'">顺序</button>
            <button class="chip sm" :class="{ active: order === 'random' }" @click="order = 'random'">随机</button>
          </div>
        </div>

        <!-- 抽题数量（非考试也可限制） -->
        <div class="section" v-if="!isExam">
          <div class="sec-title">抽题数量（留空=全部）</div>
          <input class="input" type="number" min="1" v-model="limit" placeholder="例如 20" />
        </div>

        <!-- 考试参数 -->
        <div class="section" v-if="isExam">
          <div class="sec-title">考试参数</div>
          <div class="exam-params">
            <label class="param">
              <span>考试时长（分钟）</span>
              <input class="input" type="number" min="1" v-model="durationMin" />
            </label>
            <label class="param">
              <span>抽题数量</span>
              <input class="input" type="number" min="1" v-model="limit" />
            </label>
          </div>
        </div>

        <div class="footer">
          <button class="btn btn-outline" @click="emit('cancel')">取消</button>
          <button class="btn btn-primary" @click="confirm">{{ recite && !isExam ? '开始背题' : '开始练习' }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.resume-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid rgba(91, 124, 250, 0.4);
  background: rgba(91, 124, 250, 0.08);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--text);
}
.due-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 8px;
}
.due-hint b { color: var(--warn); }
.setup-mask {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 16, 0.72);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 320;
  display: flex;
  align-items: flex-end;
}
.setup-panel {
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  max-height: 88%;
  background: var(--card-solid, #0b1020);
  border: 1px solid var(--line, #1d2740);
  border-radius: 20px 20px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow, 0 20px 60px rgba(0,0,0,.5)), var(--glow-soft, 0 0 20px rgba(42,245,255,.2));
}
.setup-mask.is-wide { align-items: center; justify-content: center; padding: 24px; }
.setup-panel.is-wide { width: 480px; max-width: 92vw; height: auto; border-radius: 16px; }

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--line, #1d2740);
}
.header .close { font-size: 24px; color: var(--muted, #7c8aa5); cursor: pointer; width: 32px; }
.header .title { font-size: 17px; font-weight: 600; }
.header .scope { font-size: 12px; color: var(--brand, #5b7cfa); background: var(--brand-light, rgba(42,245,255,.12)); border: 1px solid var(--line, #1d2740); border-radius: 20px; padding: 3px 10px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.section { padding: 14px 18px; border-bottom: 1px solid var(--line, #1d2740); }
.sec-title { font-size: 13px; color: var(--muted, #7c8aa5); margin-bottom: 10px; }

.chips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.chips.row { grid-template-columns: repeat(2, 1fr); }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.seg button { background: none; border: none; color: var(--muted); padding: 6px 16px; font-size: 13px; cursor: pointer; }
.seg button.on { background: var(--brand); color: #fff; font-weight: 600; }
.chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border: 1px solid var(--line, #1d2740);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  padding: 9px 10px;
  cursor: pointer;
  color: var(--text, #d6e2f5);
  transition: all .18s;
  text-align: left;
}
.chip.sm { align-items: center; flex-direction: row; justify-content: center; font-size: 14px; font-weight: 500; }
.chip:hover { border-color: var(--brand, #5b7cfa); box-shadow: var(--glow-soft, 0 0 12px rgba(42,245,255,.25)); }
.chip.active { background: var(--brand, #5b7cfa); color: #fff; border-color: var(--brand, #5b7cfa); box-shadow: var(--glow, 0 0 16px rgba(42,245,255,.5)); }
.chip.active .chip-desc { color: rgba(2, 16, 24, 0.7); }
.chip-label { font-size: 14px; font-weight: 600; }
.chip-desc { font-size: 10px; opacity: .8; line-height: 1.3; }

.input {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line, #1d2740);
  border-radius: 8px;
  color: var(--text, #d6e2f5);
  padding: 9px 12px;
  font-size: 14px;
  outline: none;
}
.input:focus { border-color: var(--brand, #5b7cfa); }

.exam-params { display: flex; flex-direction: column; gap: 12px; }
.param { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--text, #d6e2f5); }
.param .input { width: 120px; }

.mode-tip { margin-top: 8px; font-size: 11px; color: var(--muted, #7c8aa5); line-height: 1.4; }

.footer { display: flex; gap: 12px; padding: 16px 18px 22px; }
.btn { flex: 1; padding: 11px; border-radius: 24px; font-size: 14px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
.btn-outline { background: transparent; border-color: var(--line, #1d2740); color: var(--text, #d6e2f5); }
.btn-outline:hover { border-color: var(--brand, #5b7cfa); color: var(--brand, #5b7cfa); }
.btn-primary { background: var(--brand, #5b7cfa); color: #fff; border: none; box-shadow: var(--glow, 0 0 16px rgba(42,245,255,.5)); }
.btn-primary:hover { box-shadow: 0 0 22px rgba(91, 124, 250, 0.7); }

.fade-enter-active, .fade-leave-active { transition: opacity .22s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
