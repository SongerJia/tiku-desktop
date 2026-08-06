<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { tiku } from '../api/tiku.js'

const props = defineProps({
  categoryId: { default: null },
  subjectId: { default: null },
  mode: { default: 'practice' },
  order: { default: 'sequential' },
  limit: { default: null },
  durationMin: { default: null },
  wide: { default: false }
})
const emit = defineEmits(['exit'])

const questions = ref([])
const idx = ref(0)
const selected = ref([])
const essayText = ref('')          // 问答题作答文本
const essayReviewing = ref(false)  // 问答题：已提交作答，等待用户自评
const result = ref(null)
const sessionCorrect = ref(0)
const favSet = ref(new Set())
const loading = ref(true)
const timeUp = ref(false)

const isExam = computed(() => props.mode === 'exam')
const q = computed(() => questions.value[idx.value] || null)
const isMultiple = computed(() => q.value && q.value.type === 'multiple')
const isEssay = computed(() => q.value && q.value.type === 'essay')
const isDone = computed(() => idx.value >= questions.value.length)

// 问答题：实时计算作答文本对「得分关键词」的命中情况（不区分大小写）
const keywordHits = computed(() => {
  const kws = (q.value && q.value.keywords) || []
  if (!kws.length) return { hits: [], miss: [], total: 0, hit: 0 }
  const text = (essayText.value || '').toLowerCase()
  const hits = []
  const miss = []
  kws.forEach(k => {
    if (text.includes(String(k).toLowerCase())) hits.push(k)
    else miss.push(k)
  })
  return { hits, miss, total: hits.length + miss.length, hit: hits.length }
})

// 考试倒计时
const timeLeft = ref(props.durationMin ? props.durationMin * 60 : 0)
let timer = null
const timeText = computed(() => {
  const m = Math.floor(timeLeft.value / 60)
  const s = timeLeft.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

const modeLabel = (m) => ({
  practice: '练习', wrong: '错题重练', favorite: '收藏复习',
  unattempted: '未做专项', 'review-due': '智能复习', exam: '模拟考试'
}[m] || m)
const orderLabel = (o) => (o === 'random' ? '随机' : '顺序')
const typeLabel = (t) => ({ single: '单选', multiple: '多选', judge: '判断', essay: '问答' }[t] || t)

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

onMounted(async () => {
  let list = await tiku.getQuestions({
    categoryId: props.categoryId,
    subjectId: props.subjectId,
    mode: props.mode
  })
  if (props.order === 'random') list = shuffle(list)
  if (props.limit) list = list.slice(0, Number(props.limit))
  questions.value = list
  const favs = await tiku.getFavorites()
  favSet.value = new Set(favs.map(f => f.question_id))
  loading.value = false

  if (props.durationMin) {
    timer = setInterval(() => {
      timeLeft.value--
      if (timeLeft.value <= 0) {
        clearInterval(timer)
        finishExam()
      }
    }, 1000)
  }
})

onUnmounted(() => { if (timer) clearInterval(timer) })

function select(key) {
  if (result.value || timeUp.value || isEssay.value) return
  if (isMultiple.value) {
    const i = selected.value.indexOf(key)
    if (i >= 0) selected.value.splice(i, 1)
    else selected.value.push(key)
  } else {
    selected.value = [key]
  }
}

// 问答题：先提交作答，进入「对照采分点自评」阶段
function submitEssayDraft() {
  if (!essayText.value.trim() || result.value || timeUp.value) return
  essayReviewing.value = true
}

// 问答题：用户自评对错（selfGrade 决定本题是否计入正确）
async function submitEssay(grade) {
  if (!q.value || result.value) return
  const res = await tiku.submitAnswer({
    questionId: q.value.id,
    selected: essayText.value,
    durationMs: 0,
    mode: props.mode,
    selfGrade: grade
  })
  result.value = res
  if (res.isCorrect) sessionCorrect.value++
}

async function submit() {
  if (!selected.value.length || !q.value || result.value || timeUp.value || isEssay.value) return
  const res = await tiku.submitAnswer({
    questionId: q.value.id,
    selected: selected.value,
    durationMs: 0,
    mode: props.mode
  })
  result.value = res
  if (res.isCorrect) sessionCorrect.value++
}

function next() {
  idx.value++
  selected.value = []
  essayText.value = ''
  essayReviewing.value = false
  result.value = null
}

async function finishExam() {
  // 时间到：先提交当前题目（若有作答），再结束本场
  if (q.value && !result.value) {
    if (isEssay.value) {
      if (essayText.value.trim()) await submitEssay(false) // 已写但未自评，保守算未掌握
    } else if (selected.value.length) {
      await submit()
    }
  }
  timeUp.value = true
  idx.value = questions.value.length
}

async function toggleFav() {
  if (!q.value) return
  const r = await tiku.toggleFavorite(q.value.id)
  if (r.favorited) favSet.value.add(q.value.id)
  else favSet.value.delete(q.value.id)
  favSet.value = new Set(favSet.value)
}

function optionClass(key) {
  if (!result.value) return { sel: selected.value.includes(key) }
  const correct = result.value.answer.includes(key)
  const chosen = selected.value.includes(key)
  if (correct) return { right: true }
  if (chosen && !correct) return { wrong: true }
  return {}
}
</script>

<template>
  <div :class="wide ? 'quiz-mask' : 'quiz'">
   <div :class="wide ? 'quiz-modal' : ''">
    <div class="bar">
      <button class="back" @click="emit('exit')">← 返回</button>
      <span v-if="!loading && !isDone" class="progress">
        第 {{ idx + 1 }} / {{ questions.length }} 题 · 对 {{ sessionCorrect }}
        <span class="mode-tag">{{ modeLabel(mode) }}·{{ orderLabel(order) }}</span>
      </span>
      <span v-if="isExam && !isDone" class="timer" :class="{ warn: timeLeft <= 60 }">⏱ {{ timeText }}</span>
      <button class="fav" :class="{ on: q && favSet.has(q.id) }" @click="toggleFav" :disabled="!q">★ 收藏</button>
    </div>

    <div v-if="loading" class="hint">加载中…</div>
    <div v-else-if="isDone" class="done card">
      <h2>本场结束</h2>
      <p>共 {{ questions.length }} 题，答对 {{ sessionCorrect }} 题，正确率
        {{ questions.length ? Math.round(sessionCorrect / questions.length * 100) : 0 }}%</p>
      <button @click="emit('exit')">回到首页</button>
    </div>

    <div v-else class="card">
      <div v-if="timeUp" class="timeup">⏰ 时间到，已自动交卷</div>
      <div class="meta">
        <span class="tag">{{ typeLabel(q.type) }}</span>
        <span class="stem">{{ q.stem }}</span>
      </div>

      <!-- 选择题 / 判断题：选项作答 -->
      <div v-if="!isEssay" class="options">
        <div
          v-for="opt in q.options"
          :key="opt.key"
          class="option"
          :class="optionClass(opt.key)"
          @click="select(opt.key)"
        >
          <span class="key">{{ opt.key }}</span>
          <span class="text">{{ opt.text }}</span>
        </div>
      </div>

      <!-- 问答题：文本作答 + 采分点对照 -->
      <div v-else class="essay">
        <textarea
          v-model="essayText"
          class="essay-input"
          :disabled="essayReviewing || result"
          placeholder="在此作答…（答完后点击下方「提交作答」，系统会对照采分点帮你自评）"
          rows="6"
        ></textarea>

        <!-- 阶段一：作答中，可提交 -->
        <div v-if="!essayReviewing && !result" class="actions">
          <button class="submit" :disabled="!essayText.trim()" @click="submitEssayDraft">提交作答</button>
        </div>

        <!-- 阶段二：对照采分点自评 -->
        <div v-else-if="essayReviewing && !result" class="essay-review">
          <div class="kw-summary">
            <span class="kw-title">采分点命中：</span>
            <span :class="keywordHits.total ? (keywordHits.hit === keywordHits.total ? 'kw-all' : 'kw-part') : 'kw-none'">
              {{ keywordHits.total ? keywordHits.hit + ' / ' + keywordHits.total : '本题未设采分点' }}
            </span>
          </div>
          <div v-if="keywordHits.hits.length" class="kw-list">
            <span class="kw-hit" v-for="k in keywordHits.hits" :key="k">✓ {{ k }}</span>
          </div>
          <div v-if="keywordHits.miss.length" class="kw-list">
            <span class="kw-miss" v-for="k in keywordHits.miss" :key="k">✗ {{ k }}</span>
          </div>
          <p class="kw-tip">提示：主观题无标准答案，请对照采分点自行判断是否掌握。</p>
          <div class="actions">
            <button class="grade-yes" @click="submitEssay(true)">我会了 / 答对了</button>
            <button class="grade-no" @click="submitEssay(false)">我还没掌握 / 答错了</button>
          </div>
        </div>
      </div>

      <!-- 选择题：提交 + 结果 -->
      <template v-if="!isEssay">
        <div v-if="!result" class="actions">
          <button class="submit" :disabled="!selected.length" @click="submit">提交答案</button>
        </div>

        <div v-else class="result">
          <div :class="result.isCorrect ? 'ok' : 'no'">
            {{ result.isCorrect ? '✓ 回答正确' : '✗ 回答错误' }}
            <span class="ans">正确答案：{{ result.answer.join('、') }}</span>
          </div>
          <div class="analysis"><b>解析：</b>{{ result.analysis }}</div>
          <button class="next" @click="next">下一题 →</button>
        </div>
      </template>

      <!-- 问答题：结果（自评后） -->
      <div v-else-if="result" class="result">
        <div :class="result.isCorrect ? 'ok' : 'no'">
          {{ result.isCorrect ? '✓ 已自评掌握' : '✗ 自评未掌握' }}
          <span class="ans">（主观题·自评）</span>
        </div>
        <div v-if="result.keywords && result.keywords.length" class="kw-list">
          <span class="kw-hit" v-for="k in result.keywords" :key="k">采分点：{{ k }}</span>
        </div>
        <div class="analysis"><b>参考解析：</b>{{ result.analysis }}</div>
        <button class="next" @click="next">下一题 →</button>
      </div>
    </div>
  </div>
  </div>
</template>

<style scoped>
/* 手机：全屏覆盖答题页 */
.quiz {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  padding: 14px;
  overflow-y: auto;
}
/* PC 端：答题页变为居中模态框 */
.quiz-mask {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 16, 0.72);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.quiz-modal {
  width: 720px;
  max-width: 100%;
  max-height: 92vh;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow), var(--glow-soft);
  overflow-y: auto;
  padding: 18px 20px;
}
.bar { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; flex-wrap: wrap; }
.back, .fav {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: all .2s;
}
.back:hover, .fav:hover { border-color: var(--brand); color: var(--brand); box-shadow: var(--glow-soft); }
.fav.on { background: var(--brand-light); border-color: var(--brand); color: var(--brand); }
.progress { color: var(--muted); font-size: 13px; display: flex; align-items: center; gap: 8px; }
.mode-tag { background: var(--brand-light); color: var(--brand); border: 1px solid var(--line); border-radius: 6px; padding: 1px 7px; font-size: 11px; }
.timer { color: var(--brand); font-size: 13px; font-weight: 600; margin-left: auto; text-shadow: var(--glow-soft); }
.timer.warn { color: var(--bad); text-shadow: 0 0 8px rgba(255, 77, 109, 0.5); animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: .4; } }
.hint { color: var(--muted); padding: 20px; }

.meta { margin-bottom: 14px; }
.tag { display: inline-block; background: var(--brand-light); color: var(--brand); border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; font-size: 12px; margin-right: 8px; }
.stem { font-size: 15px; font-weight: 500; line-height: 1.5; }

.timeup { background: rgba(255, 77, 109, 0.12); border: 1px solid var(--bad); color: var(--bad); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 13px; }

.options { display: flex; flex-direction: column; gap: 8px; }
.option {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  color: var(--text);
  background: rgba(255, 255, 255, 0.02);
  transition: all .15s;
}
.option:hover { border-color: var(--brand); box-shadow: var(--glow-soft); }
.option.sel { background: var(--brand-light); border-color: var(--brand); color: var(--brand); }
.option.right { background: rgba(44, 229, 168, 0.12); border-color: var(--ok); box-shadow: 0 0 10px rgba(44, 229, 168, 0.3); }
.option.wrong { background: rgba(255, 77, 109, 0.12); border-color: var(--bad); box-shadow: 0 0 10px rgba(255, 77, 109, 0.3); }
.key { font-weight: 600; width: 22px; text-align: center; color: var(--brand); }
.text { line-height: 1.5; }

/* 问答题 */
.essay { margin-top: 4px; }
.essay-input {
  width: 100%;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--text);
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  transition: all .15s;
}
.essay-input:focus { border-color: var(--brand); box-shadow: var(--glow-soft); }
.essay-input:disabled { opacity: .7; cursor: not-allowed; }

.essay-review { margin-top: 14px; border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: rgba(255, 255, 255, 0.02); }
.kw-summary { font-size: 14px; margin-bottom: 8px; }
.kw-title { color: var(--muted); }
.kw-all { color: var(--ok); font-weight: 600; }
.kw-part { color: var(--brand); font-weight: 600; }
.kw-none { color: var(--muted); }
.kw-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
.kw-hit { background: rgba(44, 229, 168, 0.12); border: 1px solid var(--ok); color: var(--ok); border-radius: 6px; padding: 2px 8px; font-size: 12px; }
.kw-miss { background: rgba(255, 77, 109, 0.10); border: 1px solid var(--bad); color: var(--bad); border-radius: 6px; padding: 2px 8px; font-size: 12px; }
.kw-tip { color: var(--muted); font-size: 12px; margin: 8px 0 4px; }

.actions { margin-top: 14px; display: flex; gap: 10px; }
.submit, .next, .grade-yes, .grade-no {
  flex: 1;
  border: none;
  padding: 11px 20px;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all .2s;
}
.submit, .next {
  width: 100%;
  background: var(--brand);
  color: #021018;
  box-shadow: var(--glow);
}
.submit:hover, .next:hover { box-shadow: 0 0 20px rgba(42, 245, 255, 0.6); }
.submit:disabled { background: rgba(255, 255, 255, 0.10); color: var(--muted); box-shadow: none; cursor: not-allowed; flex: 1; }
.grade-yes { background: rgba(44, 229, 168, 0.18); border: 1px solid var(--ok); color: var(--ok); }
.grade-yes:hover { box-shadow: 0 0 16px rgba(44, 229, 168, 0.4); }
.grade-no { background: rgba(255, 77, 109, 0.14); border: 1px solid var(--bad); color: var(--bad); }
.grade-no:hover { box-shadow: 0 0 16px rgba(255, 77, 109, 0.4); }

.result { margin-top: 14px; }
.ok { color: var(--ok); font-weight: 600; text-shadow: 0 0 8px rgba(44, 229, 168, 0.45); }
.no { color: var(--bad); font-weight: 600; text-shadow: 0 0 8px rgba(255, 77, 109, 0.45); }
.ans { color: var(--muted); font-weight: 400; margin-left: 8px; }
.analysis { margin: 10px 0; color: var(--text); opacity: .85; line-height: 1.6; }

.done { text-align: center; }
.done h2 { color: var(--brand); text-shadow: var(--glow-soft); }
.done p { color: var(--muted); margin: 8px 0 16px; }
.done button {
  background: var(--brand);
  color: #021018;
  border: none;
  padding: 10px 24px;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--glow);
}
.done button:hover { box-shadow: 0 0 20px rgba(42, 245, 255, 0.6); }
</style>
