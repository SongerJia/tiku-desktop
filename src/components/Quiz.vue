<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import { tiku } from '../api/tiku.js'
import { showConfirm } from '../utils/confirm.js'
import KbReader from './KbReader.vue'

const props = defineProps({
  categoryId: { default: null },
  subjectId: { default: null },
  mode: { default: 'practice' },
  order: { default: 'sequential' },
  limit: { default: null },
  durationMin: { default: null },
  // 背题模式：直接展示答案与解析，不判分、不写答题记录、不动错题本
  recite: { default: false },
  // 模拟卷：传入卷 id 时按卷面题目与分值计分（与 getQuestions 随机抽题互斥）
  paperId: { default: null },
  // 标签筛选：仅练习带指定标签的题（AND 语义，由 db 层解析）
  tags: { default: null },
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
// 模拟卷：卷面总分与已得分数（仅 paperId 时有意义）
const paperScore = ref(0)
const earnedScore = ref(0)
// 题目图片（题干图）：文件名 → base64 dataURL
const imageUrls = ref([])

const isExam = computed(() => props.mode === 'exam')
const isRecite = computed(() => !!props.recite && !isExam.value)  // 考试与背题互斥，双保险
const q = computed(() => questions.value[idx.value] || null)
const isMultiple = computed(() => q.value && q.value.type === 'multiple')
const isEssay = computed(() => q.value && q.value.type === 'essay')
const isDone = computed(() => idx.value >= questions.value.length)
// 交卷后的「逐题解析」：每题记录你的作答 vs 正确答案 + 解析，供复盘
const reviews = ref([])
const showReview = ref(false)

// 逐题解析页的「相关文档」：已关联(kb_links) + L2 推荐(kbSuggestDocs)，按 qid 惰性加载
const rDocs = ref({})
const reader = ref({ show: false, doc: null })

async function loadRDocs(qid) {
  if (rDocs.value[qid]) return
  const [linked, suggested] = await Promise.all([tiku.kbLinksForQuestion(qid), tiku.kbSuggestDocs(qid, 5)])
  rDocs.value = { ...rDocs.value, [qid]: { linked, suggested } }
}

function openReader(qid, d) {
  reader.value = { show: true, doc: { id: d.doc_id ?? d.id, type: d.type, title: d.title } }
}

async function linkDoc(qid, d) {
  await tiku.kbLink({ docId: d.id, questionId: qid })
  const cur = rDocs.value[qid]
  rDocs.value = {
    ...rDocs.value,
    [qid]: {
      linked: [...cur.linked, { doc_id: d.id, type: d.type, title: d.title, note: '' }],
      suggested: cur.suggested.filter(x => x.id !== d.id)
    }
  }
}

async function unlinkDoc(qid, d) {
  await tiku.kbUnlink(d.doc_id, qid)
  const cur = rDocs.value[qid]
  rDocs.value = {
    ...rDocs.value,
    [qid]: {
      linked: cur.linked.filter(x => x.doc_id !== d.doc_id),
      suggested: cur.suggested
    }
  }
}

// 背题模式下直接从题目本身取答案，不经过 submitAnswer（那会写记录）
const reciteAnswer = computed(() => (q.value && q.value.answer) || [])

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
// 把选项 key 列表转成「A. 文本」的可读串（用于逐题解析页展示作答）
function optText(options, keys) {
  if (!options || !options.length) return (keys && keys.length ? keys.join('、') : '（未作答）')
  const arr = Array.isArray(keys) ? keys : [keys]
  if (!arr.length) return '（未作答）'
  return arr.map(k => {
    const o = options.find(x => x.key === k)
    return o ? `${k}. ${o.text}` : k
  }).join('；')
}

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

onMounted(async () => {
  let list
  if (props.paperId) {
    // 模拟卷：题目与分值来自已保存的卷，顺序固定，不随机、不限量
    const paper = await tiku.getPaper(props.paperId)
    list = (paper.questions || []).map(p => ({ ...p, id: p.questionId, paperScore: p.score }))
    paperScore.value = paper.totalScore || 0
  } else {
    list = await tiku.getQuestions({
      categoryId: props.categoryId,
      subjectId: props.subjectId,
      mode: props.mode,
      tags: props.tags
    })
    if (props.order === 'random') list = shuffle(list)
    if (props.limit) list = list.slice(0, Number(props.limit))
  }
  questions.value = list
  reviews.value = []
  showReview.value = false
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
  if (isRecite.value || result.value || timeUp.value || isEssay.value) return
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
  if (res.isCorrect) {
    sessionCorrect.value++
    if (props.paperId && q.value.paperScore) earnedScore.value += q.value.paperScore
  }
  reviews.value.push({
    qid: q.value.id, type: q.value.type, stem: q.value.stem,
    options: q.value.options, your: essayText.value,
    answer: q.value.answer, correct: res.isCorrect, analysis: res.analysis,
    images: imageUrls.value.slice()
  })
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
  if (res.isCorrect) {
    sessionCorrect.value++
    if (props.paperId && q.value.paperScore) earnedScore.value += q.value.paperScore
  }
  reviews.value.push({
    qid: q.value.id, type: q.value.type, stem: q.value.stem,
    options: q.value.options, your: selected.value.slice(),
    answer: res.answer, correct: res.isCorrect, analysis: res.analysis,
    images: imageUrls.value.slice()
  })
}

function resetPerQuestion() {
  selected.value = []
  essayText.value = ''
  essayReviewing.value = false
  result.value = null
}

function next() {
  idx.value++
  resetPerQuestion()
}

// 只在背题模式下开放回看上一题（答题模式回退会让判分记录变得含糊）
function prev() {
  if (!isRecite.value || idx.value <= 0) return
  idx.value--
  resetPerQuestion()
}

// 考试模式：手动提前交卷（带确认，当前题未提交会先提交再结束）
async function manualFinish() {
  const answered = result.value || (selected.value.length || (isEssay.value && essayText.value.trim()))
  const ok = await showConfirm(
    `当前已完成 ${idx.value + 1}/${questions.value.length} 题${answered ? '，本题已作答' : '，本题未作答'}。确定交卷？`,
    { title: '提前交卷', danger: true }
  )
  if (!ok) return
  finishExam()
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

// ---- 题目笔记 ----
// 跟着当前题走：切题自动载入，收起面板；保存即写库（清空内容=删除笔记）。
const noteOpen = ref(false)
const noteText = ref('')
const noteHint = ref('')
const hasNote = computed(() => !!noteText.value.trim())

watch(() => (q.value ? q.value.id : null), async (id) => {
  noteOpen.value = false
  noteHint.value = ''
  noteText.value = ''
  imageUrls.value = []
  if (!id) return
  const n = await tiku.getNote(id)
  noteText.value = n.content || ''
  // 题目图片：文件名 → base64，主进程从 userData/images 读回
  if (q.value.images && q.value.images.length) {
    try {
      const urls = await Promise.all(q.value.images.map(name => tiku.getImage(name)))
      imageUrls.value = urls.filter(Boolean)
    } catch (e) { imageUrls.value = [] }
  }
})

async function saveNote() {
  if (!q.value) return
  await tiku.saveNote({ questionId: q.value.id, content: noteText.value })
  noteHint.value = noteText.value.trim() ? '已保存' : '已清空'
  setTimeout(() => { noteHint.value = '' }, 1500)
}

async function toggleFav() {
  if (!q.value) return
  const r = await tiku.toggleFavorite(q.value.id)
  if (r.favorited) favSet.value.add(q.value.id)
  else favSet.value.delete(q.value.id)
  favSet.value = new Set(favSet.value)
}

function optionClass(key) {
  // 背题模式：直接把正确项标绿，不存在“选错”状态
  if (isRecite.value) return { right: reciteAnswer.value.includes(key) }
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
        第 {{ idx + 1 }} / {{ questions.length }} 题<template v-if="!isRecite"> · 对 {{ sessionCorrect }}</template>
        <span class="mode-tag">{{ modeLabel(mode) }}·{{ orderLabel(order) }}</span>
        <span v-if="isRecite" class="recite-tag">背题</span>
      </span>
      <span v-if="isExam && !isDone" class="timer" :class="{ warn: timeLeft <= 60 }">⏱ {{ timeText }}</span>
      <button v-if="isExam && !isDone" class="fav submit-exam" @click="manualFinish">交卷</button>
      <button class="fav" :class="{ on: q && favSet.has(q.id) }" @click="toggleFav" :disabled="!q">★ 收藏</button>
      <button class="fav note-btn" :class="{ on: hasNote }" @click="noteOpen = !noteOpen" :disabled="!q">✎ 笔记</button>
    </div>

    <SkeletonCards v-if="loading" :count="2" />
    <div v-else-if="showReview" class="review card">
      <div class="rv-head">
        <h2>逐题解析</h2>
        <button class="back" @click="showReview = false">← 返回</button>
      </div>
      <div class="rv-list">
        <div v-for="(r, i) in reviews" :key="r.qid" class="rv-item" :class="r.correct ? 'ok' : 'no'">
          <div class="rv-top">
            <span class="rv-no">第 {{ i + 1 }} 题</span>
            <span class="rv-type">{{ typeLabel(r.type) }}</span>
            <span class="rv-badge">{{ r.correct ? '✓ 正确' : '✗ 错误' }}</span>
          </div>
          <div class="rv-stem">{{ r.stem }}</div>
          <div v-if="r.images && r.images.length" class="rv-imgs">
            <img v-for="(s, k) in r.images" :key="k" :src="s" class="rv-img" alt="题干图" />
          </div>
          <div class="rv-row"><span class="rv-k">你的答案</span><span class="rv-v">{{ r.type === 'essay' ? (r.your || '（未作答）') : optText(r.options, r.your) }}</span></div>
          <div class="rv-row"><span class="rv-k">正确答案</span><span class="rv-v ans">{{ r.type === 'essay' ? ((r.answer && r.answer.length) ? r.answer.join('；') : '（主观题·自评）') : optText(r.options, r.answer) }}</span></div>
          <div v-if="r.analysis" class="rv-analysis"><b>解析：</b>{{ r.analysis }}</div>
          <div class="rv-docs">
            <div class="rv-docs-head">
              <span class="rv-docs-t">相关文档</span>
              <button v-if="!rDocs[r.qid]" class="rv-docs-btn" @click="loadRDocs(r.qid)">查看</button>
            </div>
            <template v-if="rDocs[r.qid]">
              <div v-if="!rDocs[r.qid].linked.length && !rDocs[r.qid].suggested.length" class="rv-docs-empty">暂无关联文档，可在知识库阅读页手动关联</div>
              <div v-for="d in rDocs[r.qid].linked" :key="'l' + d.doc_id" class="rv-doc">
                <span class="rv-doc-badge" :class="d.type">{{ d.type === 'pdf' ? 'PDF' : 'MD' }}</span>
                <span class="rv-doc-t" @click="openReader(r.qid, d)">{{ d.title }}</span>
                <button class="rv-doc-act" @click="unlinkDoc(r.qid, d)">解除</button>
              </div>
              <div v-for="d in rDocs[r.qid].suggested" :key="'s' + d.id" class="rv-doc sug">
                <span class="rv-doc-badge" :class="d.type">{{ d.type === 'pdf' ? 'PDF' : 'MD' }}</span>
                <span class="rv-doc-t" @click="openReader(r.qid, d)">{{ d.title }}</span>
                <span class="rv-doc-reason">{{ d.reason }}</span>
                <button class="rv-doc-act" @click="linkDoc(r.qid, d)">关联</button>
              </div>
            </template>
          </div>
        </div>
      </div>
      <button class="rv-done" @click="emit('exit')">回到首页</button>
    </div>
    <div v-else-if="isDone" class="done card">
      <h2>{{ isRecite ? '已过完本轮' : (props.paperId ? '模拟卷完成' : '本场结束') }}</h2>
      <p v-if="props.paperId">共 {{ questions.length }} 题，答对 {{ sessionCorrect }} 题，得分
        <b class="score">{{ Math.round(earnedScore * 10) / 10 }}</b> / {{ paperScore }} 分
        （正确率 {{ questions.length ? Math.round(sessionCorrect / questions.length * 100) : 0 }}%）</p>
      <p v-else-if="isRecite">共浏览 {{ questions.length }} 题。背题不判分、不计入统计，想检验效果就切回「答题」再来一遍。</p>
      <p v-else>共 {{ questions.length }} 题，答对 {{ sessionCorrect }} 题，正确率
        {{ questions.length ? Math.round(sessionCorrect / questions.length * 100) : 0 }}%</p>
      <button v-if="reviews.length && !isRecite" class="btn-review" @click="showReview = true">查看逐题解析</button>
      <button @click="emit('exit')">回到首页</button>
    </div>

    <div v-else class="card">
      <div v-if="timeUp" class="timeup">⏰ 时间到，已自动交卷</div>
      <div class="meta">
        <span class="tag">{{ typeLabel(q.type) }}</span>
        <span class="stem">{{ q.stem }}</span>
      </div>

      <!-- 题目图片（题干图） -->
      <div v-if="imageUrls.length" class="q-images">
        <img v-for="(src, i) in imageUrls" :key="i" :src="src" class="q-img" alt="题干图" />
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

      <!-- 问答题：文本作答 + 采分点对照（背题模式不作答，见下方背题面板） -->
      <div v-else-if="!isRecite" class="essay">
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

      <!-- 背题模式：不作答，直接摊开答案 / 采分点 / 解析，只管翻页 -->
      <div v-if="isRecite" class="recite-panel">
        <div class="recite-ans">
          <b>{{ isEssay ? '参考答案' : '正确答案' }}：</b>
          <span v-if="reciteAnswer.length" class="ans-val">{{ reciteAnswer.join(isEssay ? '\n' : '、') }}</span>
          <span v-else class="ans-none">（本题未录入答案）</span>
        </div>
        <div v-if="q.keywords && q.keywords.length" class="kw-list">
          <span class="kw-hit" v-for="k in q.keywords" :key="k">采分点：{{ k }}</span>
        </div>
        <div v-if="q.analysis" class="analysis"><b>解析：</b>{{ q.analysis }}</div>
        <div class="actions">
          <button class="nav-prev" :disabled="idx === 0" @click="prev">← 上一题</button>
          <button class="next" @click="next">{{ idx + 1 >= questions.length ? '完成' : '下一题 →' }}</button>
        </div>
      </div>

      <!-- 选择题：提交 + 结果 -->
      <template v-if="!isEssay && !isRecite">
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

      <!-- 本题笔记：答题 / 背题 / 考试都可写，随题切换自动载入 -->
      <div v-if="noteOpen" class="note-panel">
        <div class="note-head">
          <span class="note-title">我的笔记</span>
          <span v-if="noteHint" class="note-hint">{{ noteHint }}</span>
        </div>
        <textarea
          v-model="noteText"
          class="note-input"
          rows="3"
          placeholder="记下你的理解、易错点、记忆口诀…（清空内容并保存即删除本题笔记）"
          @blur="saveNote"
        ></textarea>
        <div class="note-foot">
          <span class="note-tip">失焦自动保存</span>
          <button class="note-save" @click="saveNote">保存</button>
        </div>
      </div>
    </div>
  </div>
  </div>
    <KbReader :show="reader.show" :doc="reader.doc" @close="reader.show = false" />
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
.submit-exam {
  border-color: var(--bad);
  color: var(--bad);
  background: rgba(255, 77, 109, 0.08);
  font-weight: 600;
}
.submit-exam:hover { background: rgba(255, 77, 109, 0.18); box-shadow: 0 0 10px rgba(255, 77, 109, 0.2); }
.back:hover, .fav:hover { border-color: var(--brand); color: var(--brand); box-shadow: var(--glow-soft); }
.fav.on { background: var(--brand-light); border-color: var(--brand); color: var(--brand); }
.progress { color: var(--muted); font-size: 13px; display: flex; align-items: center; gap: 8px; }
.mode-tag { background: var(--brand-light); color: var(--brand); border: 1px solid var(--line); border-radius: 6px; padding: 1px 7px; font-size: 11px; }
.recite-tag { background: rgba(255, 193, 84, 0.14); color: #ffc154; border: 1px solid rgba(255, 193, 84, 0.45); border-radius: 6px; padding: 1px 7px; font-size: 11px; }
.timer { color: var(--brand); font-size: 13px; font-weight: 600; margin-left: auto; text-shadow: var(--glow-soft); }
.timer.warn { color: var(--bad); text-shadow: 0 0 8px rgba(255, 77, 109, 0.5); animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: .4; } }
.hint { color: var(--muted); padding: 20px; }

.meta { margin-bottom: 14px; }
.tag { display: inline-block; background: var(--brand-light); color: var(--brand); border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; font-size: 12px; margin-right: 8px; }
.stem { font-size: 15px; font-weight: 500; line-height: 1.5; }

.q-images { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 4px; }
.q-img { max-width: 100%; max-height: 220px; border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--glow-soft); }

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

/* 笔记 */
.note-btn.on { background: rgba(255, 193, 84, 0.14); border-color: rgba(255, 193, 84, 0.5); color: #ffc154; }
.note-panel {
  margin-top: 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.02);
}
.note-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.note-title { font-size: 13px; color: var(--muted); }
.note-hint { font-size: 12px; color: var(--ok); }
.note-input {
  width: 100%;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text);
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  transition: all .15s;
}
.note-input:focus { border-color: var(--brand); box-shadow: var(--glow-soft); }
.note-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.note-tip { font-size: 11px; color: var(--muted); }
.note-save {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  color: var(--text);
  padding: 5px 16px;
  border-radius: 16px;
  font-size: 12px;
  cursor: pointer;
  transition: all .2s;
}
.note-save:hover { border-color: var(--brand); color: var(--brand); box-shadow: var(--glow-soft); }

/* 背题面板 */
.recite-panel {
  margin-top: 14px;
  border: 1px solid rgba(255, 193, 84, 0.35);
  border-radius: 10px;
  padding: 12px 14px;
  background: rgba(255, 193, 84, 0.05);
}
.recite-ans { font-size: 14px; line-height: 1.6; }
.recite-ans b { color: #ffc154; }
.ans-val { color: var(--ok); font-weight: 600; white-space: pre-wrap; }
.ans-none { color: var(--muted); }
.nav-prev {
  flex: 0 0 auto;
  min-width: 100px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  color: var(--text);
  padding: 11px 18px;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all .2s;
}
.nav-prev:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); box-shadow: var(--glow-soft); }
.nav-prev:disabled { opacity: .35; cursor: not-allowed; }

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
.submit:hover, .next:hover { box-shadow: 0 0 20px rgba(91, 124, 250, 0.6); }
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
.done .score { color: var(--brand); font-size: 18px; }
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
.done button:hover { box-shadow: 0 0 20px rgba(91, 124, 250, 0.6); }

/* 逐题解析页 */
.review { display: flex; flex-direction: column; gap: 12px; }
.rv-head { display: flex; align-items: center; justify-content: space-between; }
.rv-head h2 { color: var(--brand); text-shadow: var(--glow-soft); }
.rv-list { display: flex; flex-direction: column; gap: 12px; max-height: 60vh; overflow-y: auto; }
.rv-item { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: rgba(255, 255, 255, 0.02); }
.rv-item.ok { border-color: rgba(44, 229, 168, 0.4); }
.rv-item.no { border-color: rgba(255, 77, 109, 0.4); }
.rv-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.rv-no { font-size: 13px; color: var(--muted); }
.rv-type { font-size: 11px; color: var(--brand); border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; }
.rv-badge { margin-left: auto; font-size: 12px; font-weight: 600; }
.rv-item.ok .rv-badge { color: var(--ok); }
.rv-item.no .rv-badge { color: var(--bad); }
.rv-stem { font-size: 14px; font-weight: 500; line-height: 1.5; margin-bottom: 8px; }
.rv-imgs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.rv-img { max-width: 100%; max-height: 180px; border: 1px solid var(--line); border-radius: 8px; }
.rv-row { display: flex; gap: 10px; font-size: 13px; margin: 4px 0; }
.rv-k { flex: 0 0 64px; color: var(--muted); }
.rv-v { flex: 1; line-height: 1.6; }
.rv-v.ans { color: var(--ok); font-weight: 600; }
.rv-analysis { margin-top: 6px; color: var(--text); opacity: .85; line-height: 1.6; font-size: 13px; }
.rv-docs { margin-top: 10px; border-top: 1px dashed var(--line); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.rv-docs-head { display: flex; align-items: center; justify-content: space-between; }
.rv-docs-t { font-size: 12px; font-weight: 500; color: var(--brand); }
.rv-docs-btn {
  font-size: 11px;
  color: var(--muted);
  background: none;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 1px 10px;
  cursor: pointer;
}
.rv-docs-btn:hover { color: var(--brand); border-color: var(--brand); }
.rv-docs-empty { font-size: 12px; color: var(--muted); }
.rv-doc { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.rv-doc.sug { opacity: .85; }
.rv-doc-badge {
  font-size: 10px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--line);
  color: var(--muted);
  flex-shrink: 0;
}
.rv-doc-badge.pdf { color: #e85f3d; border-color: rgba(232, 95, 61, 0.4); }
.rv-doc-badge.md { color: var(--brand); border-color: var(--line); }
.rv-doc-t { flex: 1; color: var(--text); cursor: pointer; }
.rv-doc-t:hover { color: var(--brand); }
.rv-doc-reason { font-size: 11px; color: var(--muted); flex-shrink: 0; }
.rv-doc-act {
  font-size: 11px;
  color: var(--muted);
  background: none;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
}
.rv-doc-act:hover { color: var(--brand); }
.btn-review {
  width: 100%; background: rgba(255, 255, 255, 0.06); border: 1px solid var(--brand);
  color: var(--brand); padding: 10px 24px; border-radius: 24px; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all .2s; margin-bottom: 2px;
}
.btn-review:hover { box-shadow: var(--glow-soft); background: var(--brand-light); }
</style>
