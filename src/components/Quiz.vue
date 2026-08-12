<script setup>
import Icon from './Icon.vue'
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import { tiku } from '../api/tiku.js'
import { showConfirm } from '../utils/confirm.js'
import { celebrate } from '../utils/celebrate.js'
import { showToast } from '../utils/toast.js'
import KbReader from './KbReader.vue'
import { speakText } from '../utils/speech.js'

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
  // 每日一题等指定单题：传题 id 时直接作答该题（与随机抽题互斥）
  questionId: { default: null },
  // 每日一题标记：答完自动把结果提交给每日一题连击
  daily: { default: false },
  wide: { default: false },
  // 断点续做：传 { questions, idx } 直接恢复练习
  resume: { default: null }
})
const emit = defineEmits(['exit'])

const questions = ref([])
const idx = ref(0)
const selected = ref([])
const essayText = ref('')          // 问答题作答文本
const essayReviewing = ref(false)  // 问答题：已提交作答，等待用户自评
const result = ref(null)
const results = ref({})  // 每题提交结果，按 idx 存，便于答题卡跳转恢复
let submitting = false // 提交防重：await submitAnswer 窗口内双击/交卷并发只允许一次写入
const materialOpen = ref(true) // 材料卡默认展开
const sessionCorrect = ref(0)
const sessionStart = ref(0)
const sessionEnd = ref(0)
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

// 知识库双链跳转：在已加载的关联文档缓存（rDocs）中查找目标文档
function onReaderOpenDoc(docId) {
  const id = String(docId)
  const pool = Object.values(rDocs.value).flatMap(v => [...(v.linked || []), ...(v.suggested || [])])
  const d = pool.find(x => String(x.doc_id ?? x.id) === id)
  if (d) reader.value = { show: true, doc: { id: d.doc_id ?? d.id, type: d.type || 'md', title: d.title } }
}

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

// 背题模式：会/不会标记（不会 → 提交判错入错题本，计入后续复习）
const reciteMarked = ref(new Set())
async function markRecite(understood) {
  if (reciteMarked.value.has(q.value.id)) return
  reciteMarked.value.add(q.value.id)
  if (!understood) {
    await tiku.submitAnswer({ questionId: q.value.id, selected: [], durationMs: 0, mode: 'recite', selfGrade: false })
    showToast('已加入错题本，稍后可在「智能复习」中巩固', 'ok')
  }
}

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

onMounted(() => window.addEventListener('keydown', onKey))
onMounted(async () => {
  sessionStart.value = Date.now()
  // 断点续做：直接用保存的题目与位置恢复
  if (props.resume && props.resume.questions && props.resume.questions.length) {
    questions.value = props.resume.questions
    idx.value = Math.min(Number(props.resume.idx) || 0, questions.value.length - 1)
    sessionCorrect.value = Number(props.resume.sessionCorrect) || 0 // 续做保留已答对计数，正确率统计完整
    reviews.value = []
    showReview.value = false
    loading.value = false
    const favs = await tiku.getFavorites()
    favSet.value = new Set(favs.map(f => f.question_id))
    return
  }
  let list
  if (props.paperId) {
    // 模拟卷：题目与分值来自已保存的卷，顺序固定，不随机、不限量
    const paper = await tiku.getPaper(props.paperId)
    list = (paper.questions || []).map(p => ({ ...p, id: p.questionId, paperScore: p.score }))
    paperScore.value = paper.totalScore || 0
  } else if (props.questionId) {
    // 每日一题等指定单题：直接取该题作答
    const q = await tiku.getQuestionById(Number(props.questionId))
    list = q ? [q] : []
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

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (noteHintTimer) clearTimeout(noteHintTimer)
  window.removeEventListener('keydown', onKey)
})

// 退出拦截：练习模式未完成 → 保存断点；完成 → 清除断点
async function onExit() {
  const isPractice = !props.paperId && !props.recite && !props.durationMin
  if (isPractice && !isDone.value && questions.value.length > 1) {
    await tiku.saveResumeSession({
      subjectId: props.subjectId, categoryId: props.categoryId, order: props.order,
      mode: 'practice', questions: questions.value, idx: idx.value,
      sessionCorrect: sessionCorrect.value
    })
    showToast('已保存进度，下次练习可继续', 'ok')
  } else if (isPractice && isDone.value) {
    await tiku.clearResumeSession()
  }
  emit('exit')
}

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
async function reportDailyIfNeeded(correct) {
  if (props.daily && q.value) {
    try { await tiku.submitDailyPuzzle(q.value.id, correct) } catch (e) { /* 提交失败不影响答题 */ }
  }
}

async function submitEssay(grade) {
  if (!q.value || result.value || submitting) return
  submitting = true
  let res
  try {
    res = await tiku.submitAnswer({
      questionId: q.value.id,
      selected: essayText.value,
      durationMs: 0,
      mode: props.mode,
      selfGrade: grade
    })
  } finally {
    submitting = false
  }
  result.value = res
  await reportDailyIfNeeded(res.isCorrect)
  results.value = { ...results.value, [idx.value]: res }
  if (res.isCorrect) {
    sessionCorrect.value++
    if (props.paperId && q.value.paperScore) earnedScore.value += q.value.paperScore
  }
  const entry = {
    qid: q.value.id, type: q.value.type, stem: q.value.stem,
    options: q.value.options, your: essayText.value,
    answer: q.value.answer, correct: res.isCorrect, analysis: res.analysis,
    images: imageUrls.value.slice(),
    q: { ...q.value }
  }
  const ei = reviews.value.findIndex(r => r.qid === q.value.id)
  if (ei >= 0) reviews.value.splice(ei, 1, entry)
  else reviews.value.push(entry)
}

async function submit() {
  if (submitting || !selected.value.length || !q.value || result.value || timeUp.value || isEssay.value) return
  submitting = true
  let res
  try {
    res = await tiku.submitAnswer({
      questionId: q.value.id,
      selected: selected.value,
      durationMs: 0,
      mode: props.mode
    })
  } finally {
    submitting = false
  }
  result.value = res
  await reportDailyIfNeeded(res.isCorrect)
  results.value = { ...results.value, [idx.value]: res }
  celebrate() // 成就/升级即时庆祝
  if (res.isCorrect) {
    sessionCorrect.value++
    if (props.paperId && q.value.paperScore) earnedScore.value += q.value.paperScore
  }
  const entry = {
    qid: q.value.id, type: q.value.type, stem: q.value.stem,
    options: q.value.options, your: selected.value.slice(),
    answer: res.answer, correct: res.isCorrect, analysis: res.analysis,
    images: imageUrls.value.slice(),
    q: { ...q.value }
  }
  const ei = reviews.value.findIndex(r => r.qid === q.value.id)
  if (ei >= 0) reviews.value.splice(ei, 1, entry)
  else reviews.value.push(entry)
}

function resetPerQuestion() {
  selected.value = []
  essayText.value = ''
  essayReviewing.value = false
  materialOpen.value = true
  result.value = results.value[idx.value] || null
}

function next() {
  idx.value++
  resetPerQuestion()
  if (idx.value >= questions.value.length) sessionEnd.value = Date.now()
}

// 只在背题模式下开放回看上一题（答题模式回退会让判分记录变得含糊）
function prev() {
  if (!isRecite.value || idx.value <= 0) return
  idx.value--
  resetPerQuestion()
}

// 答题卡导航：标记每题状态，点击跳到任意题
const showCard = ref(false)
const isReviewMode = computed(() => ['review-due', 'wrong'].includes(props.mode))
const cardItems = computed(() => questions.value.map((qq, i) => {
  const r = results.value[i]
  let status = 'todo'
  if (i === idx.value) status = 'current'
  else if (r) status = r.isCorrect ? 'right' : 'wrong'
  return { i, status }
}))
function jumpTo(i) {
  if (i < 0 || i >= questions.value.length) return
  idx.value = i
  resetPerQuestion()
  showCard.value = false
}
async function markMastered() {
  if (!q.value) return
  const res = await tiku.markMastered(q.value.id)
  if (res && res.ok) {
    showToast('已标记为掌握，该题从复习中毕业 🎉', 'ok')
    const m = { isCorrect: true, answer: q.value.answer, analysis: q.value.analysis, mastered: true }
    results.value = { ...results.value, [idx.value]: m }
    result.value = m
  }
}

// 四档复习反馈：忘记(1)/困难(3)/记得(4)/简单(5) → 覆盖该题 SM-2 排期
const RATE_LABELS = { 1: '忘记', 3: '困难', 4: '记得', 5: '简单' }
const curRated = computed(() => (results.value[idx.value] || {}).rated || '')
async function rate(quality) {
  if (!q.value) return
  await tiku.rateReview(q.value.id, quality)
  results.value = { ...results.value, [idx.value]: { ...(results.value[idx.value] || {}), rated: String(quality) } }
  showToast(`已按「${RATE_LABELS[quality]}」更新复习排期`, 'ok')
}
// 语音朗读（Web Speech，本地）
function speakQuestion() {
  if (!q.value) return
  const opts = (q.value.options || []).map(o => `${o.key}. ${o.text}`).join('，')
  speakText([q.value.stem, opts, q.value.analysis ? '解析：' + q.value.analysis : ''].filter(Boolean).join('。'))
}
function speakAnalysis() {
  if (q.value && q.value.analysis) speakText('解析：' + q.value.analysis)
}

// 完成一场练习/模考后，把正确率记入本地历史（Stats 页成绩曲线）
const examRecorded = ref(false)
watch(isDone, (v) => {
  if (!v || examRecorded.value) return
  examRecorded.value = true
  if (props.recite) return // 背题模式不判分，不计入成绩曲线
  try {
    const total = questions.value.length
    const pct = total ? Math.round(sessionCorrect.value / total * 100) : 0
    const h = JSON.parse(localStorage.getItem('exam_history') || '[]')
    h.push({ date: new Date().toLocaleDateString(), pct, label: props.paperId ? '模拟卷' : modeLabel(props.mode) })
    localStorage.setItem('exam_history', JSON.stringify(h.slice(-30)))
  } catch (e) { /* 忽略 */ }
})

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
  if (submitting) return // 与手动交卷并发时只执行一次
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
  sessionEnd.value = Date.now()
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
  if (q.value && q.value.id !== id) return // 已切题则丢弃旧结果
  noteText.value = n.content || ''
  // 题目图片：文件名 → base64，主进程从 userData/images 读回
  if (q.value.images && q.value.images.length) {
    try {
      const urls = await Promise.all(q.value.images.map(name => tiku.getImage(name)))
      if (q.value && q.value.id !== id) return
      imageUrls.value = urls.filter(Boolean)
    } catch (e) { imageUrls.value = [] }
  }
})

let noteHintTimer = null
async function saveNote() {
  if (!q.value) return
  await tiku.saveNote({ questionId: q.value.id, content: noteText.value })
  noteHint.value = noteText.value.trim() ? '已保存' : '已清空'
  if (noteHintTimer) clearTimeout(noteHintTimer)
  noteHintTimer = setTimeout(() => { noteHint.value = '' }, 1500)
}

// 键盘快捷键：1-9 选答案 / Enter 提交或下一题 / F 收藏 / 空格翻页（背题）
function onKey(e) {
  const tag = (e.target && e.target.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return
  if (loading.value || showReview.value) return
  if (isRecite.value) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next(); return }
    if (e.key === 'f' || e.key === 'F') { toggleFav(); return }
    return
  }
  if (isEssay.value || timeUp.value || !q.value) return
  // 数字键：按选项位置选（1 → 第 1 个选项，不依赖 A/B/C 字符）
  if (/^[1-9]$/.test(e.key) && !result.value) {
    const o = (q.value.options || [])[Number(e.key) - 1]
    if (o) { select(o.key); e.preventDefault(); return }
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    if (result.value) next()
    else if (selected.value.length) submit()
    return
  }
  if (e.key === 'f' || e.key === 'F') { toggleFav(); return }
}

// 练习总结：本次错题 + 用时
const wrongs = computed(() => reviews.value.filter(r => !r.correct))
function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m ? m + ' 分 ' + (s % 60) + ' 秒' : s + ' 秒'
}
function redoWrongs() {
  questions.value = wrongs.value.map(r => r.q ? { ...r.q } : { id: r.qid, type: r.type, stem: r.stem, options: r.options, answer: r.answer, analysis: r.analysis })
  idx.value = 0
  sessionCorrect.value = 0
  sessionStart.value = Date.now()
  sessionEnd.value = 0
  reviews.value = []
  results.value = {} // 清空旧场次结果，否则重做每题命中旧判定被锁定
  result.value = null
  resetPerQuestion()
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
      <button class="back" @click="onExit">← 返回</button>
      <span v-if="!loading && !isDone" class="progress">
        第 {{ idx + 1 }} / {{ questions.length }} 题<template v-if="!isRecite"> · 对 {{ sessionCorrect }}</template>
        <span class="mode-tag">{{ modeLabel(mode) }}·{{ orderLabel(order) }}</span>
        <span v-if="isRecite" class="recite-tag">背题</span>
      </span>
      <span v-if="isExam && !isDone" class="timer" :class="{ warn: timeLeft <= 60 }">⏱ {{ timeText }}</span>
      <span v-if="!loading && !isDone && !isRecite" class="kb-hint" style="font-size:11px;color:var(--muted);margin-left:auto;opacity:.7">⌨ 1-9 选 · Enter 提交/下一题 · F 收藏</span>
      <button v-if="isExam && !isDone" class="fav submit-exam" @click="manualFinish">交卷</button>
      <button class="fav" :class="{ on: q && favSet.has(q.id) }" @click="toggleFav" :disabled="!q">★ 收藏</button>
      <button class="fav note-btn" :class="{ on: hasNote }" @click="noteOpen = !noteOpen" :disabled="!q">✎ 笔记</button>
      <button v-if="!isRecite && !isDone" class="fav" :class="{ on: showCard }" @click="showCard = !showCard" :disabled="!q">▦ 答题卡</button>
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
            <span class="rv-badge">{{ r.correct ? '正确' : '错误' }}</span>
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
      <button class="rv-done" @click="onExit">回到首页</button>
    </div>
    <div v-else-if="isDone" class="done card">
      <h2>{{ isRecite ? '已过完本轮' : (props.paperId ? '模拟卷完成' : '本场结束') }}</h2>
      <p v-if="props.paperId">共 {{ questions.length }} 题，答对 {{ sessionCorrect }} 题，得分
        <b class="score">{{ Math.round(earnedScore * 10) / 10 }}</b> / {{ paperScore }} 分
        （正确率 {{ questions.length ? Math.round(sessionCorrect / questions.length * 100) : 0 }}%）</p>
      <p v-else-if="isRecite">共浏览 {{ questions.length }} 题。背题不判分、不计入统计，想检验效果就切回「答题」再来一遍。</p>
      <p v-else>共 {{ questions.length }} 题，答对 {{ sessionCorrect }} 题，正确率
        {{ questions.length ? Math.round(sessionCorrect / questions.length * 100) : 0 }}% · 用时 {{ fmtDuration(sessionEnd.value - sessionStart.value) }}</p>

      <div v-if="wrongs.length && !isRecite && !props.paperId" class="done-wrongs">
        <div class="dw-title">本次答错 {{ wrongs.length }} 题<template v-if="wrongs.length > 5">（展示前 5）</template></div>
        <div v-for="w in wrongs.slice(0, 5)" :key="w.qid" class="dw-item">
          <span class="dw-badge">{{ typeLabel(w.type) }}</span>
          <span class="dw-stem">{{ w.stem }}</span>
        </div>
        <button class="btn-review" @click="redoWrongs">重做这 {{ wrongs.length }} 道错题</button>
      </div>

      <button v-if="reviews.length && !isRecite" class="btn-review" @click="showReview = true">查看逐题解析</button>
      <button @click="onExit">回到首页</button>
    </div>

    <div v-else class="card">
      <div v-if="timeUp" class="timeup">⏰ 时间到，已自动交卷</div>

      <!-- 材料题：背景材料卡（先读材料再作答，可折叠） -->
      <div v-if="q.material_content" class="material-card" @click="materialOpen = !materialOpen">
        <div class="mc-head">
          <Icon name="doc" :size="13"/>
          <b class="mc-title">{{ q.material_title || '材料' }}</b>
          <span class="mc-toggle">{{ materialOpen ? '收起 ▲' : '展开 ▼' }}</span>
        </div>
        <div v-show="materialOpen" class="mc-body">{{ q.material_content }}</div>
      </div>

      <div class="meta">
        <span class="tag">{{ typeLabel(q.type) }}</span>
        <span class="stem">{{ q.stem }}</span>
        <button class="tts-btn" title="朗读题目与解析" @click="speakQuestion">🔊</button>
      </div>

      <!-- 题目图片（题干图） -->
      <div v-if="imageUrls.length" class="q-images">
        <img v-for="(src, i) in imageUrls" :key="i" :src="src" class="q-img" alt="题干图" />
      </div>

      <!-- 听力音频（题干配置 audio_url 时显示播放器） -->
      <div v-if="q.audio_url" class="q-audio">
        <audio :src="q.audio_url" controls preload="none"></audio>
        <span class="qa-hint">先听音频再作答</span>
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
          <span v-if="optionClass(opt.key).sel" class="mark sel"><Icon name="check" :size="14"/></span>
          <span v-else-if="optionClass(opt.key).right" class="mark right"><Icon name="check" :size="14"/></span>
          <span v-else-if="optionClass(opt.key).wrong" class="mark wrong"><Icon name="x" :size="14"/></span>
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
            <span class="kw-hit" v-for="k in keywordHits.hits" :key="k"><Icon name="check" :size="12"/> {{ k }}</span>
          </div>
          <div v-if="keywordHits.miss.length" class="kw-list">
            <span class="kw-miss" v-for="k in keywordHits.miss" :key="k"><Icon name="x" :size="12"/> {{ k }}</span>
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
        <div class="recite-mark" v-if="!reciteMarked.has(q.id)">
          <span class="rm-hint">这题会了吗？不会的会自动进错题本，方便后面复习</span>
          <div class="rm-actions">
            <button class="rm-yes" @click="markRecite(true)">✓ 会了</button>
            <button class="rm-no" @click="markRecite(false)">✗ 不会</button>
          </div>
        </div>
        <div v-else class="recite-marked">已标记，继续下一题</div>
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
            {{ result.isCorrect ? '回答正确' : '回答错误' }}
            <span class="ans">正确答案：{{ result.answer.join('、') }}</span>
          </div>
          <div class="analysis"><b>解析：</b>{{ result.analysis }} <button class="tts-btn sm" title="朗读解析" @click="speakAnalysis">🔊</button></div>
          <div class="rate-row" v-if="!result.mastered">
            <span class="rate-label">本次复习：</span>
            <button class="rate-btn" :class="{ on: curRated === '1' }" @click="rate(1)">忘记</button>
            <button class="rate-btn" :class="{ on: curRated === '3' }" @click="rate(3)">困难</button>
            <button class="rate-btn" :class="{ on: curRated === '4' }" @click="rate(4)">记得</button>
            <button class="rate-btn" :class="{ on: curRated === '5' }" @click="rate(5)">简单</button>
          </div>
          <button v-if="isReviewMode && !result.mastered" class="master-btn" @click="markMastered">✓ 标记已掌握</button>
          <button class="next" @click="next">下一题 →</button>
        </div>
      </template>

      <!-- 问答题：结果（自评后） -->
      <div v-else-if="result" class="result">
        <div :class="result.isCorrect ? 'ok' : 'no'">
          {{ result.isCorrect ? '已自评掌握' : '自评未掌握' }}
          <span class="ans">（主观题·自评）</span>
        </div>
        <div v-if="result.keywords && result.keywords.length" class="kw-list">
          <span class="kw-hit" v-for="k in result.keywords" :key="k">采分点：{{ k }}</span>
        </div>
        <div class="analysis"><b>参考解析：</b>{{ result.analysis }} <button class="tts-btn sm" title="朗读解析" @click="speakAnalysis">🔊</button></div>
        <div class="rate-row" v-if="!result.mastered">
          <span class="rate-label">本次复习：</span>
          <button class="rate-btn" :class="{ on: curRated === '1' }" @click="rate(1)">忘记</button>
          <button class="rate-btn" :class="{ on: curRated === '3' }" @click="rate(3)">困难</button>
          <button class="rate-btn" :class="{ on: curRated === '4' }" @click="rate(4)">记得</button>
          <button class="rate-btn" :class="{ on: curRated === '5' }" @click="rate(5)">简单</button>
        </div>
        <button v-if="isReviewMode && !result.mastered" class="master-btn" @click="markMastered">✓ 标记已掌握</button>
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
    <!-- 答题卡导航 -->
    <div v-if="showCard && !isRecite && questions.length" class="ac-mask" @click.self="showCard = false">
      <div class="ac-panel">
        <div class="ac-head">
          <span>答题卡（{{ idx + 1 }} / {{ questions.length }}）</span>
          <button class="ac-x" @click="showCard = false">✕</button>
        </div>
        <div class="ac-grid">
          <button
            v-for="item in cardItems"
            :key="item.i"
            class="ac-cell"
            :class="item.status"
            @click="jumpTo(item.i)"
          >{{ item.i + 1 }}</button>
        </div>
        <div class="ac-legend">
          <span class="ac-dot current"></span>当前
          <span class="ac-dot right"></span>答对
          <span class="ac-dot wrong"></span>答错
          <span class="ac-dot todo"></span>未答
        </div>
      </div>
    </div>

    <KbReader :show="reader.show" :doc="reader.doc" @close="reader.show = false" @open-doc="onReaderOpenDoc" />
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
.recite-mark { margin: 12px 0; display: flex; flex-direction: column; gap: 8px; }
.rm-hint { font-size: 12px; color: var(--muted); }
.rm-actions { display: flex; gap: 10px; }
.rm-yes, .rm-no {
  flex: 1;
  padding: 9px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  transition: all .15s;
}
.rm-yes:hover { border-color: var(--ok); color: var(--ok); background: rgba(47, 191, 143, 0.08); }
.rm-no:hover { border-color: var(--bad); color: var(--bad); background: rgba(229, 83, 95, 0.08); }
.recite-marked { margin: 12px 0; font-size: 12px; color: var(--ok); }
.timer { color: var(--brand); font-size: 13px; font-weight: 600; margin-left: auto; text-shadow: var(--glow-soft); }
.timer.warn { color: var(--bad); text-shadow: 0 0 8px rgba(255, 77, 109, 0.5); animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: .4; } }
.hint { color: var(--muted); padding: 20px; }

.meta { margin-bottom: 14px; }
.tag { display: inline-block; background: var(--brand-light); color: var(--brand); border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; font-size: 12px; margin-right: 8px; }
.stem { font-size: 15px; font-weight: 500; line-height: 1.5; }

.q-images { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 4px; }
.q-audio { display: flex; align-items: center; gap: 10px; margin: 10px 0 4px; }
.q-audio audio { height: 36px; }
.qa-hint { font-size: 11px; color: var(--muted); }
.q-img { max-width: 100%; max-height: 220px; border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--glow-soft); }

.timeup { background: rgba(255, 77, 109, 0.12); border: 1px solid var(--bad); color: var(--bad); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 13px; }
.material-card { border: 1px solid rgba(91, 124, 250, 0.35); border-radius: 10px; background: rgba(91, 124, 250, 0.05); margin-bottom: 12px; overflow: hidden; cursor: pointer; }
.mc-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; font-size: 13px; color: var(--text); }
.mc-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-toggle { font-size: 11px; color: var(--muted); flex-shrink: 0; }
.mc-body { padding: 4px 14px 12px; font-size: 13px; line-height: 1.7; color: var(--text); white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow-y: auto; }

.options { display: flex; flex-direction: column; gap: 8px; }
.option {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 11px 13px;
  cursor: pointer;
  color: var(--text);
  background: rgba(255, 255, 255, 0.02);
  position: relative;
  transition: border-color .15s, background .15s, transform .12s, box-shadow .15s;
}
.option:hover { border-color: var(--brand); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25); }
.option:active { transform: scale(0.99); }
.option .key {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid var(--line);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  flex-shrink: 0;
  transition: all .15s;
}
.option.sel { background: var(--brand-light); border-color: var(--brand); }
.option.sel .key { background: var(--brand); border-color: var(--brand); color: #fff; }
.option.sel .text { color: var(--brand); font-weight: 500; }
.option.right { background: rgba(47, 191, 143, 0.12); border-color: var(--ok); }
.option.right .key { border-color: var(--ok); color: var(--ok); }
.option.wrong { background: rgba(229, 83, 95, 0.12); border-color: var(--bad); }
.option.wrong .key { border-color: var(--bad); color: var(--bad); }
.option .mark {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.option .mark.sel { color: var(--brand); }
.option .mark.right { color: var(--ok); }
.option .mark.wrong { color: var(--bad); }
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
  color: #fff;
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
.done-wrongs { text-align: left; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin: 0 0 14px; display: flex; flex-direction: column; gap: 6px; background: rgba(229, 83, 95, 0.04); }
.dw-title { font-size: 13px; font-weight: 600; color: var(--bad); }
.dw-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
.dw-badge { flex-shrink: 0; font-size: 10px; border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; color: var(--text); }
.dw-stem { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.done-wrongs .btn-review { margin-top: 4px; }
.done button {
  background: var(--brand);
  color: #ffffff;
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
/* 答题反馈动画 */
.result { animation: resultIn .3s ease; }
@keyframes resultIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
.option { transition: background .2s ease, border-color .2s ease, box-shadow .2s ease; }
.result .ok { animation: popOk .35s ease; }
.result .no { animation: popNo .35s ease; }
@keyframes popOk { 0% { transform: scale(.96); } 60% { transform: scale(1.02); } 100% { transform: scale(1); } }
@keyframes popNo { 0% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } 100% { transform: translateX(0); } }

/* 答题卡导航 */
.ac-mask { position: fixed; inset: 0; background: rgba(2, 6, 16, 0.55); display: flex; align-items: center; justify-content: center; z-index: 400; padding: 16px; }
.ac-panel { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; width: min(420px, 92vw); box-shadow: var(--glow-soft); }
.ac-head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; margin-bottom: 10px; }
.ac-x { background: none; border: none; color: var(--muted); font-size: 16px; cursor: pointer; }
.ac-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
.ac-cell { aspect-ratio: 1; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font-size: 12px; cursor: pointer; transition: transform .1s ease; }
.ac-cell:hover { transform: scale(1.08); }
.ac-cell.current { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand) inset; font-weight: 700; }
.ac-cell.right { background: rgba(44, 196, 138, 0.18); border-color: var(--good); color: var(--good); }
.ac-cell.wrong { background: rgba(255, 77, 109, 0.16); border-color: var(--bad); color: var(--bad); }
.ac-cell.todo { opacity: .7; }
.ac-legend { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 11px; color: var(--muted); flex-wrap: wrap; }
.ac-dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.ac-dot.current { background: var(--brand); }
.ac-dot.right { background: var(--good); }
.ac-dot.wrong { background: var(--bad); }
.ac-dot.todo { background: var(--line); }
.master-btn { margin-top: 8px; background: rgba(44, 196, 138, 0.14); color: var(--good); border: 1px solid var(--good); border-radius: 8px; padding: 6px 12px; cursor: pointer; font-weight: 600; }
.master-btn:hover { background: rgba(44, 196, 138, 0.26); }

/* 四档复习反馈 */
.rate-row { display: flex; align-items: center; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.rate-label { font-size: 11px; color: var(--muted); margin-right: 2px; }
.rate-btn { border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 999px; padding: 4px 13px; font-size: 12px; cursor: pointer; transition: all .15s ease; }
.rate-btn:hover { border-color: var(--brand); color: var(--brand); }
.rate-btn.on { background: var(--brand); border-color: var(--brand); color: #fff; }
/* 语音朗读 */
.tts-btn { background: none; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 12px; padding: 2px 8px; cursor: pointer; margin-left: 6px; line-height: 1.4; vertical-align: middle; }
.tts-btn:hover { color: var(--brand); border-color: var(--brand); }
.tts-btn.sm { font-size: 11px; padding: 1px 6px; }
</style>
