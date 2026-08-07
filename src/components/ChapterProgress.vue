<script setup>
import Icon from './Icon.vue'
import { ref, watch } from 'vue'
import { tiku } from '../api/tiku.js'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['close'])

const groups = ref([])
const loading = ref(false)

watch(() => props.show, async v => {
  if (!v) return
  loading.value = true
  groups.value = await tiku.getChapterProgress()
  loading.value = false
})

const barCls = (rate) => (rate >= 80 ? 'hi' : rate >= 50 ? 'mid' : 'lo')
</script>

<template>
  <div v-if="show" class="cp-mask" @click.self="emit('close')">
    <div class="cp-box">
      <div class="cp-head">
        <span class="cp-title"><Icon name="chart" :size="14"/> 章节进度</span>
        <span class="cp-sub">每章掌握情况 · 正确率按答题计算</span>
        <button class="btn cp-close" @click="emit('close')">关闭</button>
      </div>

      <div v-if="loading" class="cp-empty">加载中…</div>
      <div v-else-if="!groups.length || !groups.some(g => g.chapters.length)" class="cp-empty">
        <p>还没有章节数据</p>
        <p class="cp-hint">先去「题库」里做几道题，这里就会展示每章的掌握进度</p>
      </div>
      <div v-else class="cp-body">
        <div v-for="g in groups.filter(x => x.chapters.length)" :key="g.subjectId" class="cp-group">
          <div class="cp-subject">{{ g.subjectName }}</div>
          <div v-for="c in g.chapters" :key="c.id" class="cp-row">
            <div class="cp-name">{{ c.name }}</div>
            <div class="cp-bar"><div class="cp-fill" :class="barCls(c.rate)" :style="{ width: c.rate + '%' }"></div></div>
            <div class="cp-nums">
              <span class="cp-rate" :class="barCls(c.rate)">{{ c.rate }}%</span>
              <span class="cp-learned">{{ c.learned }}/{{ c.totalQ }} 已学</span>
              <span v-if="c.mastered" class="cp-mastered"><Icon name="check" :size="14"/> {{ c.mastered }} 掌握</span>
              <span v-if="c.wrong" class="cp-wrong"><Icon name="x" :size="14"/> {{ c.wrong }} 错</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp-mask {
  position: fixed;
  inset: 0;
  background: rgba(2, 12, 24, 0.82);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 380;
  padding: 16px;
}
.cp-box {
  width: min(620px, 94vw);
  max-height: 82vh;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}
.cp-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}
.cp-title { font-size: 15px; font-weight: 600; color: var(--text); }
.cp-sub { font-size: 12px; color: var(--muted); }
.cp-close { margin-left: auto; padding: 3px 12px; }
.cp-empty { padding: 50px 20px; text-align: center; color: var(--text); font-size: 14px; }
.cp-hint { font-size: 12px; color: var(--muted); margin-top: 8px; }
.cp-body { overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 18px; }
.cp-group { display: flex; flex-direction: column; gap: 8px; }
.cp-subject {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand);
  border-left: 3px solid var(--brand);
  padding-left: 8px;
}
.cp-row { display: grid; grid-template-columns: 120px 1fr auto; align-items: center; gap: 12px; }
.cp-name { font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-bar { height: 7px; border-radius: 4px; background: rgba(127, 127, 127, 0.2); overflow: hidden; }
.cp-fill { height: 100%; border-radius: 4px; transition: width .4s; }
.cp-fill.hi { background: var(--ok); }
.cp-fill.mid { background: var(--brand); }
.cp-fill.lo { background: var(--bad); }
.cp-nums { display: flex; gap: 8px; font-size: 11px; align-items: center; white-space: nowrap; }
.cp-rate { font-weight: 600; }
.cp-rate.hi { color: var(--ok); }
.cp-rate.mid { color: var(--brand); }
.cp-rate.lo { color: var(--bad); }
.cp-learned { color: var(--muted); }
.cp-mastered { color: var(--ok); }
.cp-wrong { color: var(--bad); }
</style>
