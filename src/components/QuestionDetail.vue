<template>
  <!-- Teleport 到 body：弹层脱离父组件内容树（Knowledge），避免 v-if 切换牵动父树 patch 导致背景页闪动 -->
  <Teleport to="body">
    <div v-if="show" class="qd-mask" @click.self="emit('close')">
    <div class="qd-panel">
      <!-- header -->
      <div class="qd-head">
        <span class="qd-type">{{ typeLabel(info.question.type) }}</span>
        <span class="qd-path">{{ pathText }}</span>
        <span class="qd-close" @click="emit('close')">✕</span>
      </div>

      <!-- 主体（可滚动）：题干 → 归属 → 状态 -->
      <div class="qd-body">
        <!-- 题干 -->
        <div class="qd-stem">{{ info.question.stem }}</div>

        <!-- 选项（不标答案） -->
        <div class="qd-opts">
          <div v-for="(o, i) in options" :key="i" class="qd-opt">
            <b>{{ ['A', 'B', 'C', 'D', 'E', 'F'][i] || (i + 1) }}</b>
            <span>{{ o }}</span>
          </div>
        </div>

        <!-- 答案与解析：默认遮挡，点击揭开 -->
        <div class="qd-answer" @click="revealed = !revealed">
          <div class="qd-ans-content" :class="{ blur: !revealed }">
            <div v-if="answerText" class="qd-ans-line">答案：{{ answerText }}</div>
            <div v-if="info.question.analysis" class="qd-ans-line">解析：{{ info.question.analysis }}</div>
            <div v-else class="qd-ans-line">解析：暂无</div>
          </div>
          <div v-if="!revealed" class="qd-ans-mask">
            <span class="qd-lock">🔒</span> 答案与解析已遮挡 · 点击查看
          </div>
        </div>

        <!-- 归属 -->
        <div class="qd-sec">
          <div class="qd-sec-title">归属</div>
          <div class="qd-tags">
            <span class="qd-path-full">{{ pathText || '未分类' }}</span>
            <span v-for="t in info.question.tags" :key="t" class="qd-tag">#{{ t }}</span>
          </div>
        </div>

        <!-- 状态区（按数据有无显示） -->
        <div class="qd-sec">
          <div class="qd-sec-title">状态</div>
          <div class="qd-status">
            <div v-if="s.wrong" class="qd-st" :class="s.wbStatus === 'mastered' ? 'ok' : 'bad'">
              <div class="qd-st-num">{{ s.wbStatus === 'mastered' ? '已掌握' : '错 ' + s.wrongCount + ' 次' }}</div>
              <div class="qd-st-sub">{{ s.wbStatus === 'mastered' ? '已复习 ' + s.reviewedCount + ' 次' : (s.nextReviewAt ? '待复习 · ' + fmtDate(s.nextReviewAt) : '待复习') }}</div>
            </div>
            <div v-if="s.favorited" class="qd-st warn">
              <div class="qd-st-num">已收藏</div>
              <div class="qd-st-sub">{{ s.favGroup ? '组：' + s.favGroup : '默认分组' }}</div>
            </div>
            <div v-if="s.hasCard" class="qd-st ok">
              <div class="qd-st-num">有记忆卡</div>
              <div class="qd-st-sub">已复习 {{ s.cardReviewCount }} 次{{ s.cardLapses ? ' · 忘过 ' + s.cardLapses + ' 次' : '' }}</div>
            </div>
            <div v-if="s.answered" class="qd-st">
              <div class="qd-st-num">{{ s.correctRate }}%</div>
              <div class="qd-st-sub">答过 {{ s.answered }} 次</div>
            </div>
            <div v-if="!s.wrong && !s.favorited && !s.hasCard && !s.answered" class="qd-st empty-st">
              <div class="qd-st-num">—</div>
              <div class="qd-st-sub">还没有学习记录</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 行动区 -->
      <div class="qd-actions">
        <button class="btn btn-primary" @click="startPractice">开始练习本章节</button>
        <button class="btn btn-outline" @click="toggleFav" :class="{ on: s.favorited }">{{ s.favorited ? '取消收藏' : '收藏' }}</button>
        <button class="btn btn-outline" @click="toCard" :disabled="cardBusy">{{ cardBusy ? '生成中…' : '转记忆卡' }}</button>
        <button v-if="s.wrong && !s.reason" class="btn btn-outline" @click="reasonOpen = !reasonOpen">标记错因</button>
      </div>
      <div v-if="reasonOpen" class="qd-reasons">
        <button v-for="r in REASONS" :key="r" class="chip" @click="markReason(r)">{{ r }}</button>
      </div>
    </div>
    </div>

    <!-- 转卡补充表单（front 截断与 addCardFromQuestion 一致，category 用章节名，保证同题各入口查重一致） -->
    <CardSupplement
      :show="cardSupplement"
      :front="(info.question.stem || '').slice(0, 80)"
      :back="answerText || info.question.analysis || ''"
      :category="chapterName"
      :source-question-id="props.questionId"
      :lang="cardLang"
      @close="cardSupplement = false"
      @created="onCardCreated"
    />
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { detectSubjectLang } from '../utils/speech.js'
import CardSupplement from './CardSupplement.vue'

const props = defineProps({
  show: Boolean,
  questionId: { type: Number, default: 0 }
})
useBodyLock(() => props.show)
useFocusTrap(() => props.show, '.qd-panel')
const emit = defineEmits(['close', 'start'])

const REASONS = ['粗心', '知识点不懂', '时间不够']
const typeLabel = (t) => ({ single: '单选', multiple: '多选', judge: '判断', essay: '问答' }[t] || t || '题目')
const info = ref({ question: { type: '', stem: '', options_json: '', answer_json: '', analysis: '', categoryPath: [], tags: [] }, status: {} })
const revealed = ref(false)
const reasonOpen = ref(false)
const cardBusy = ref(false)
// 转卡补充表单（音标/释义/音频）：仅语言科目显示音标音频，技术类只确认背面向容
const cardSupplement = ref(false)
const cardLang = ref('')

const options = computed(() => {
  try { return JSON.parse(info.value.question.options_json || '[]') } catch (e) { return [] }
})
const answerText = computed(() => {
  try {
    const a = JSON.parse(info.value.question.answer_json || '[]')
    if (Array.isArray(a)) {
      // answer_json 存字母 key（如 ['A','B']，判断题 ['对']）；老数据可能是数字下标 → 兼容转换
      return a.map(x => {
        const n = Number(x)
        return Number.isInteger(n) && String(x).trim() !== '' ? String.fromCharCode(65 + n) : String(x)
      }).join('、')
    }
    return String(a)
  } catch (e) { return '' }
})
const s = computed(() => info.value.status || {})
const pathText = computed(() => (info.value.question.categoryPath || []).join(' › '))
// 转卡分类：取路径最后一段（章节名；无章节则科目名），与 addCardFromQuestion 的 category 一致
const chapterName = computed(() => (info.value.question.categoryPath || []).slice(-1)[0] || '')
// 科目语言：从路径首段（科目名）识别，英语/日语才显示音标/音频
const subjectName = computed(() => (info.value.question.categoryPath || [])[0] || '')

const fmtDate = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

watch(() => [props.show, props.questionId], async ([sh, id]) => {
  if (!sh || !id) return
  revealed.value = false
  reasonOpen.value = false
  try {
    const r = await tiku.getQuestionInfo(id)
    if (r && r.ok) info.value = r
  } catch (e) { /* 查询失败保持空态，不中断弹层 */ }
})

function startPractice() {
  emit('start', { categoryId: info.value.question.categoryId, mode: 'practice' })
}

async function toggleFav() {
  const r = await tiku.toggleFavorite(info.value.question.id, '')
  if (r) info.value.status.favorited = !!r.favorited
}

async function toCard() {
  if (cardBusy.value) return
  // 打开补充表单：内部先查重（同内容已有关联 → 提示；无 → 补充音标/释义/音频后新建）
  cardLang.value = detectSubjectLang(subjectName.value) || ''
  cardSupplement.value = true
}
function onCardCreated() {
  info.value.status.hasCard = true
}

async function markReason(r) {
  await tiku.setWrongReason(info.value.question.id, r)
  info.value.status.reason = r
  reasonOpen.value = false
  showToast(`已标记：${r}`, 'ok')
}
</script>

<style scoped>
.qd-mask {
  position: fixed; inset: 0; z-index: 300;
  background: var(--modal-mask);
  /* 毛玻璃：blur 随 maskIn 渐变（0→4px）平滑出现，避免瞬间糊；闪动根因已由 Teleport 根治，blur 可放心保留 */
  backdrop-filter: blur(var(--modal-blur, 4px));
  display: flex; align-items: center; justify-content: center; padding: 24px;
  animation: maskIn .18s ease;
}
.qd-panel {
  width: 960px; max-width: 94vw; max-height: 88%;
  background: var(--card-solid, #0b1020);
  border: 1px solid var(--line, #1d2740);
  border-radius: 16px;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, .5);
  animation: riseIn .28s cubic-bezier(.2, .7, .3, 1) both;
}
.qd-head {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 24px; border-bottom: 1px solid var(--line, #1d2740);
  flex-shrink: 0;
}
.qd-type {
  background: color-mix(in srgb, var(--brand) 15%, transparent); color: var(--brand, #5b7cfa);
  border: 1px solid color-mix(in srgb, var(--brand) 40%, transparent);
  font-size: 12.5px; padding: 4px 12px; border-radius: 7px; flex-shrink: 0;
}
.qd-path { font-size: 13.5px; color: var(--muted, #7c8aa5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qd-close { margin-left: auto; color: var(--muted, #7c8aa5); font-size: 17px; cursor: pointer; flex-shrink: 0; }
.qd-close:hover { color: var(--text, #d6e2f5); }

/* 主体可滚动 */
.qd-body { overflow-y: auto; min-height: 0; }
.qd-stem { padding: 20px 24px 10px; font-size: 15.5px; line-height: 1.8; }
.qd-opts { padding: 6px 24px 14px; display: flex; flex-direction: column; gap: 6px; }
.qd-opt {
  border: 1px solid var(--line, #1d2740); border-radius: 9px;
  padding: 11px 15px; font-size: 14px; color: var(--text, #d6e2f5);
  display: flex; gap: 10px; align-items: baseline;
}
.qd-opt b { color: var(--muted, #7c8aa5); font-weight: 600; flex-shrink: 0; }

/* 答案遮挡 */
.qd-answer {
  position: relative; margin: 0 24px 8px;
  border-radius: 8px; overflow: hidden; cursor: pointer;
  border: 1px dashed var(--line, #1d2740);
}
.qd-ans-content { padding: 11px 15px; font-size: 13.5px; line-height: 1.6; color: var(--muted, #7c8aa5); }
.qd-ans-content.blur { filter: blur(5px); user-select: none; pointer-events: none; }
.qd-ans-mask {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  background: rgba(2, 6, 16, 0.55);
  font-size: 13.5px; color: #dfe7fa;
  transition: opacity .2s;
}
.qd-lock { font-size: 11px; }

.qd-sec { padding: 14px 24px; border-top: 1px solid var(--line, #1d2740); }
.qd-sec-title { font-size: 12.5px; color: var(--muted, #7c8aa5); margin-bottom: 10px; }
.qd-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.qd-path-full { font-size: 13px; color: var(--text, #d6e2f5); }
.qd-tag {
  font-size: 12px; padding: 4px 12px; border-radius: 11px;
  background: color-mix(in srgb, var(--brand) 12%, transparent); border: 1px solid color-mix(in srgb, var(--brand) 35%, transparent);
  color: var(--brand-soft);
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif;
  line-height: 1.5;
}

.qd-status { display: flex; gap: 8px; flex-wrap: wrap; }
.qd-st {
  flex: 1; min-width: 110px;
  border: 1px solid var(--line, #1d2740); border-radius: 9px;
  padding: 9px; text-align: center;
}
.qd-st.bad { border-color: rgba(229, 83, 95, 0.35); background: rgba(229, 83, 95, 0.06); }
.qd-st.warn { border-color: rgba(255, 184, 77, 0.3); background: rgba(255, 184, 77, 0.05); }
.qd-st.ok { border-color: rgba(47, 191, 143, 0.3); background: rgba(47, 191, 143, 0.05); }
.qd-st-num { font-size: 14px; font-weight: 600; }
.qd-st.bad .qd-st-num { color: var(--bad, #e5535f); }
.qd-st.warn .qd-st-num { color: var(--warn, #ffb84d); }
.qd-st.ok .qd-st-num { color: var(--ok, #4fd1a5); }
.qd-st-sub { font-size: 11.5px; color: var(--muted, #7c8aa5); margin-top: 3px; }
.qd-st.empty-st .qd-st-num { color: var(--muted, #7c8aa5); }

.qd-actions { display: flex; gap: 12px; padding: 16px 24px 18px; border-top: 1px solid var(--line, #1d2740); flex-wrap: wrap; }
.qd-actions .btn { flex: 1; min-width: 110px; padding: 12px; border-radius: 22px; font-size: 14.5px; font-weight: 600; cursor: pointer; }
.qd-actions .btn.on { border-color: var(--brand, #5b7cfa); color: var(--brand, #5b7cfa); }
.qd-reasons { display: flex; gap: 10px; padding: 0 24px 14px; }
.qd-reasons .chip {
  padding: 7px 15px; border-radius: 15px; font-size: 13px; cursor: pointer;
  border: 1px solid var(--line, #1d2740); background: rgba(255, 255, 255, 0.03); color: var(--text, #d6e2f5);
}
.qd-reasons .chip:hover { border-color: var(--brand, #5b7cfa); }

@keyframes maskIn {
  from { opacity: 0; backdrop-filter: blur(0); }
  to { opacity: 1; backdrop-filter: blur(4px); }
}
@keyframes riseIn { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
</style>
