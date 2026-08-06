<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  show: Boolean,
  wide: Boolean,
  preset: { type: Object, default: () => ({ categoryId: null, subjectId: null, presetMode: 'practice', scopeLabel: '' }) }
})
const emit = defineEmits(['confirm', 'cancel'])

// 范围 → 对应拉题 mode
const scopes = [
  { key: 'practice', label: '全部', desc: '当前范围所有题' },
  { key: 'wrong', label: '错题重练', desc: '错题本活跃题目' },
  { key: 'favorite', label: '收藏复习', desc: '我收藏的题目' },
  { key: 'unattempted', label: '未做专项', desc: '只练没答过的题' },
  { key: 'review-due', label: '智能复习', desc: '艾宾浩斯到期题' },
  { key: 'exam', label: '模拟考试', desc: '限时随机抽取' }
]

function presetToScope(m) {
  return ['practice', 'wrong', 'favorite', 'unattempted', 'review-due', 'exam'].includes(m) ? m : 'practice'
}

const scope = ref(presetToScope(props.preset.presetMode))
const order = ref(scope.value === 'exam' ? 'random' : 'sequential')
const limit = ref(scope.value === 'exam' ? 50 : '')
const durationMin = ref(60)

const isExam = computed(() => scope.value === 'exam')
const scopeLabel = computed(() => props.preset.scopeLabel || '全部范围')

function pickScope(s) {
  scope.value = s
  if (s === 'exam') {
    if (order.value !== 'random') order.value = 'random'
    if (!limit.value) limit.value = 50
  }
}

function confirm() {
  const cfg = {
    categoryId: props.preset.categoryId,
    subjectId: props.preset.subjectId,
    mode: scope.value,
    order: order.value,
    limit: limit.value ? Number(limit.value) : (isExam.value ? 50 : null),
    durationMin: isExam.value ? (durationMin.value ? Number(durationMin.value) : 60) : null
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
          <button class="btn btn-primary" @click="confirm">开始练习</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
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
.header .scope { font-size: 12px; color: var(--brand, #2af5ff); background: var(--brand-light, rgba(42,245,255,.12)); border: 1px solid var(--line, #1d2740); border-radius: 20px; padding: 3px 10px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.section { padding: 14px 18px; border-bottom: 1px solid var(--line, #1d2740); }
.sec-title { font-size: 13px; color: var(--muted, #7c8aa5); margin-bottom: 10px; }

.chips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.chips.row { grid-template-columns: repeat(2, 1fr); }
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
.chip:hover { border-color: var(--brand, #2af5ff); box-shadow: var(--glow-soft, 0 0 12px rgba(42,245,255,.25)); }
.chip.active { background: var(--brand, #2af5ff); color: #021018; border-color: var(--brand, #2af5ff); box-shadow: var(--glow, 0 0 16px rgba(42,245,255,.5)); }
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
.input:focus { border-color: var(--brand, #2af5ff); }

.exam-params { display: flex; flex-direction: column; gap: 12px; }
.param { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--text, #d6e2f5); }
.param .input { width: 120px; }

.footer { display: flex; gap: 12px; padding: 16px 18px 22px; }
.btn { flex: 1; padding: 11px; border-radius: 24px; font-size: 14px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
.btn-outline { background: transparent; border-color: var(--line, #1d2740); color: var(--text, #d6e2f5); }
.btn-outline:hover { border-color: var(--brand, #2af5ff); color: var(--brand, #2af5ff); }
.btn-primary { background: var(--brand, #2af5ff); color: #021018; border: none; box-shadow: var(--glow, 0 0 16px rgba(42,245,255,.5)); }
.btn-primary:hover { box-shadow: 0 0 22px rgba(42, 245, 255, 0.7); }

.fade-enter-active, .fade-leave-active { transition: opacity .22s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
