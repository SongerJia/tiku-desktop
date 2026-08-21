<script setup>
// 科目配置弹窗：每个科目可独立配置题型、维度、UI 偏好
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import { useEsc } from '../utils/useEsc.js'
import { showToast } from '../utils/toast.js'
import { BUILTIN_TYPES, BUILTIN_DIMS, DEFAULT_CONFIG, ARCHITECT_CONFIG, JAVA_CONFIG, IELTS_CONFIG } from '../utils/subjectConfig.js'
import { ref, watch, onMounted } from 'vue'

const props = defineProps({
  show: Boolean,
  subject: Object,        // { id, name }
  config: Object          // 当前配置
})
useBodyLock(() => props.show)
useFocusTrap(() => props.show, '.sc-panel')
const emit = defineEmits(['close', 'save'])

// 本地编辑副本
const edit = ref({ types: [], dims: [], ui: {}, exam: null })

watch(() => props.show, (v) => {
  if (v && props.config) {
    edit.value = JSON.parse(JSON.stringify(props.config))
  }
})

function toggleType(key) {
  const types = [...edit.value.types]
  const idx = types.indexOf(key)
  if (idx >= 0) types.splice(idx, 1)
  else types.push(key)
  edit.value.types = types
}

function toggleDim(key) {
  const dims = [...edit.value.dims]
  const idx = dims.indexOf(key)
  if (idx >= 0) dims.splice(idx, 1)
  else dims.push(key)
  edit.value.dims = dims
}

function toggleUI(key) {
  edit.value.ui = { ...edit.value.ui, [key]: !edit.value.ui[key] }
}

function applyPreset(preset) {
  edit.value = JSON.parse(JSON.stringify(preset))
}

function save() {
  emit('save', { ...edit.value })
  showToast('科目配置已保存', 'ok')
  emit('close')
}

useEsc(() => emit('close'))
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="sc-mask" @click.self="emit('close')">
      <div class="sc-panel">
        <div class="sc-head">
          <span class="sc-title">科目配置 · {{ subject?.name || '未命名' }}</span>
          <span class="sc-close" @click="emit('close')">×</span>
        </div>

        <!-- 预置快速应用 -->
        <div class="sc-presets">
          <span class="sc-preset-label">快速套用预置：</span>
          <button class="preset-btn" @click="applyPreset(ARCHITECT_CONFIG)">架构师</button>
          <button class="preset-btn" @click="applyPreset(JAVA_CONFIG)">Java</button>
          <button class="preset-btn" @click="applyPreset(IELTS_CONFIG)">雅思</button>
          <button class="preset-btn" @click="applyPreset(DEFAULT_CONFIG)">通用</button>
        </div>

        <!-- 题型配置 -->
        <div class="sc-sec">
          <div class="sc-sec-title">启用的题型</div>
          <div class="sc-chip-group">
            <div
              v-for="t in BUILTIN_TYPES"
              :key="t.key"
              class="sc-chip"
              :class="{ on: edit.types.includes(t.key) }"
              @click="toggleType(t.key)"
            >
              <span class="sc-chip-icon">{{ t.icon }}</span>
              <span>{{ t.label }}</span>
            </div>
          </div>
        </div>

        <!-- 筛选维度 -->
        <div class="sc-sec">
          <div class="sc-sec-title">筛选维度</div>
          <div class="sc-chip-group">
            <div
              v-for="d in BUILTIN_DIMS"
              :key="d.key"
              class="sc-chip"
              :class="{ on: edit.dims.includes(d.key) }"
              @click="toggleDim(d.key)"
            >
              <span>{{ d.label }}</span>
              <span class="sc-chip-desc">{{ d.desc }}</span>
            </div>
          </div>
        </div>

        <!-- UI 偏好 -->
        <div class="sc-sec">
          <div class="sc-sec-title">显示偏好</div>
          <div class="sc-toggle-group">
            <label class="sc-toggle">
              <input type="checkbox" :checked="edit.ui.single_card" @change="toggleUI('single_card')" />
              <span>单选卡片式选项</span>
            </label>
            <label class="sc-toggle">
              <input type="checkbox" :checked="edit.ui.show_difficulty" @change="toggleUI('show_difficulty')" />
              <span>显示难度星级</span>
            </label>
            <label class="sc-toggle">
              <input type="checkbox" :checked="edit.ui.show_accuracy" @change="toggleUI('show_accuracy')" />
              <span>显示正确率</span>
            </label>
            <label class="sc-toggle">
              <input type="checkbox" :checked="edit.ui.show_year" @change="toggleUI('show_year')" />
              <span>显示年份标签</span>
            </label>
            <label class="sc-toggle">
              <input type="checkbox" :checked="edit.ui.show_chapter_weight" @change="toggleUI('show_chapter_weight')" />
              <span>显示章节分值占比</span>
            </label>
          </div>
        </div>

        <!-- 考试模式参数（仅架构师等有考试模式的科目） -->
        <div v-if="edit.exam" class="sc-sec">
          <div class="sc-sec-title">考试模式参数</div>
          <div class="sc-exam-rows">
            <div v-for="(v, k) in edit.exam" :key="k" class="sc-exam-row">
              <span class="sc-exam-label">{{ { knowledge: '综合知识', case: '案例分析', paper: '论文' }[k] || k }}</span>
              <span class="sc-exam-detail">{{ v.count }} 题 / {{ v.minutes }} 分钟</span>
            </div>
          </div>
        </div>

        <div class="sc-foot">
          <button class="btn" @click="emit('close')">取消</button>
          <button class="btn btn-primary" @click="save">保存配置</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.sc-mask {
  position: fixed; inset: 0; z-index: 95;
  background: var(--modal-mask);
  display: flex; align-items: center; justify-content: center;
}
.sc-panel {
  width: 520px; max-width: 92vw; max-height: 80vh;
  background: var(--bg); border: 1px solid var(--line);
  border-radius: 14px; padding: 20px;
  display: flex; flex-direction: column; gap: 14px; overflow: hidden;
}
.sc-head { display: flex; align-items: center; justify-content: space-between; }
.sc-title { font-size: 15px; font-weight: 600; color: var(--text); }
.sc-close { font-size: 20px; color: var(--muted); cursor: pointer; line-height: 1; }
.sc-presets { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sc-preset-label { font-size: 11px; color: var(--muted); flex-shrink: 0; }
.preset-btn {
  border: 1px solid var(--line); background: none; border-radius: 6px;
  font-size: 11px; color: var(--muted); padding: 3px 10px; cursor: pointer;
  transition: all .15s;
}
.preset-btn:hover { border-color: var(--brand); color: var(--brand); }
.sc-sec { display: flex; flex-direction: column; gap: 8px; }
.sc-sec-title { font-size: 12px; font-weight: 600; color: var(--text); }
.sc-chip-group { display: flex; flex-wrap: wrap; gap: 6px; }
.sc-chip {
  display: inline-flex; align-items: center; gap: 4px;
  border: 1px solid var(--line); border-radius: 8px;
  padding: 6px 12px; font-size: 12px; color: var(--muted);
  cursor: pointer; transition: all .15s;
}
.sc-chip:hover { border-color: var(--brand); color: var(--text); }
.sc-chip.on { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, transparent); color: var(--brand); font-weight: 500; }
.sc-chip-icon { font-size: 13px; }
.sc-chip-desc { font-size: 10px; color: var(--muted); margin-left: 2px; }
.sc-toggle-group { display: flex; flex-direction: column; gap: 6px; }
.sc-toggle {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--text); cursor: pointer;
}
.sc-toggle input { accent-color: var(--brand); }
.sc-exam-rows { display: flex; flex-direction: column; gap: 4px; }
.sc-exam-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; background: color-mix(in srgb, var(--line) 30%, transparent); border-radius: 6px; }
.sc-exam-label { font-size: 12px; color: var(--text); }
.sc-exam-detail { font-size: 11px; color: var(--muted); }
.sc-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>