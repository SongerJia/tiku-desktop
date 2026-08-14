<script setup>
import Icon from './Icon.vue'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import { computed } from 'vue'

const props = defineProps({ show: Boolean, q: Object })
useBodyLock(() => props.show)
useFocusTrap(() => props.show, '.sq-box')
const emit = defineEmits(['close'])

const typeLabel = { single: '单选', multiple: '多选', judge: '判断', essay: '问答' }

const opts = computed(() => {
  const raw = props.q?.options
  if (!Array.isArray(raw)) return []
  // options 可能是字符串数组或 {key,text} 对象数组（主进程统一对象格式）——统一取 text
  return raw.map(o => (o && typeof o === 'object' && 'text' in o) ? o.text : o)
})

const ans = computed(() => {
  const raw = props.q?.answer
  return Array.isArray(raw) ? raw : (raw == null || raw === '' ? [] : [String(raw)])
})

const letter = i => String.fromCharCode(65 + i)

function isRight(i) {
  const a = ans.value
  if (!a.length) return false
  return a.some(x => String(x).toUpperCase() === letter(i) || String(x) === String(i + 1))
}
</script>

<template>
  <div v-if="show && q" class="sq-mask" @click.self="emit('close')">
    <div class="card sq-box">
      <div class="sq-head">
        <span class="badge">{{ typeLabel[q.type] || q.type }}</span>
        <span class="sq-title">题目速览 #{{ q.id }}</span>
        <div class="sq-spacer"></div>
        <span v-for="t in q.tags || []" :key="t" class="sq-tag">{{ t }}</span>
        <button class="btn sq-close" @click="emit('close')">关闭</button>
      </div>
      <div class="sq-body">
        <p class="sq-stem">{{ q.stem }}</p>
        <div v-if="opts.length" class="sq-opts">
          <div
            v-for="(o, i) in opts"
            :key="i"
            class="sq-opt"
            :class="{ right: isRight(i) }"
          >
            <span class="sq-let">{{ letter(i) }}</span>
            <span>{{ o }}</span>
            <span v-if="isRight(i)" class="sq-ok"><Icon name="check" :size="16"/></span>
          </div>
        </div>
        <div v-if="ans.length" class="sq-ans">
          正确答案：<b>{{ ans.join('、') }}</b>
        </div>
        <div v-if="q.analysis" class="sq-analysis">
          <span class="sq-lab">解析</span>
          <p>{{ q.analysis }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sq-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 400;
  padding: 20px;
}
.sq-box {
  width: min(560px, 92vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sq-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}
.sq-title { font-size: 14px; font-weight: 500; color: var(--text); }
.sq-spacer { flex: 1; }
.sq-tag {
  font-size: 11px;
  color: var(--brand);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 1px 8px;
  background: color-mix(in srgb, var(--brand) 8%, transparent);
}
.sq-close { padding: 3px 12px; }
.sq-body { padding: 16px 18px; overflow-y: auto; }
.sq-stem { font-size: 14px; line-height: 1.7; color: var(--text); margin-bottom: 12px; }
.sq-opts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.sq-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text);
}
.sq-opt.right { border-color: #22c55e; background: rgba(34, 197, 94, 0.08); }
.sq-let {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--line);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--muted);
  flex-shrink: 0;
}
.sq-opt.right .sq-let { border-color: #22c55e; color: #22c55e; }
.sq-ok { margin-left: auto; color: #22c55e; }
.sq-ans { font-size: 13px; color: #22c55e; margin-bottom: 10px; }
.sq-analysis { border-top: 1px dashed var(--line); padding-top: 10px; }
.sq-lab { font-size: 11px; color: var(--muted); display: block; margin-bottom: 4px; }
.sq-analysis p { font-size: 13px; line-height: 1.7; color: var(--text); }
</style>
