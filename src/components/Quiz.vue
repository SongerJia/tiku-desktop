<script setup>
import Icon from './Icon.vue'
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import { tiku } from '../api/tiku.js'
import { showConfirm } from '../utils/confirm.js'
import { celebrate } from '../utils/celebrate.js'
import { showToast } from '../utils/toast.js'
import { speakText } from '../utils/speech.js'
import QuestionRenderer from './QuestionRenderer.vue'
import PaperWriter from './PaperWriter.vue'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'

const props = defineProps({
  categoryId: { default: null },
  categoryIds: { default: null }, // 多章节练习（练习设置章节多选）
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
  resume: { default: null },
  // 科目配置（控制题型显示、UI 偏好等）
  subjectConfig: { default: () => ({}) }
})
const emit = defineEmits(['exit'])
useBodyLock(() => true) // 答题页挂载即锁背景滚动（全屏 mask 覆盖），卸载自动释放
// 焦点圈定：仅 wide（居中模态）时 trap 到 quiz-modal；非 wide 是主内容视图，无需圈定
useFocusTrap(() => true, () => (props.wide ? document.querySelector('.quiz-modal') : null))

const questions = ref([])
const idx = ref(0)
const selected = ref([])
const essayText = ref('')          // 问答题作答文本
const essayReviewing = ref(false)  // 问答题：已提交作答，等待用户自评
const result = ref(null)
const results = ref({})  // 每题提交结果，按 idx 存，便于答题卡跳转恢复
let submitting = false // 提交防重：await submitAnswer 窗口内双击/交卷并发只允许一次写入
let finishPending = false // 时间到恰逢提交在途：记录待交卷，submit 完成后补执行 finishExam，防考试卡死无出口
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
// 听力音频：本地文件名 → base64 dataURL（与图片同理；http/file 直用）
const audioSrc = ref('')
// 自动播放开关（听力题进题即播，会话内记忆）
const autoPlayAudio = ref(localStorage.getItem('quiz_autoplay_audio') !== '0')
// 循环播放 / 语速
const loopAudio = ref(false)
const playRate = ref(1)

const isExam = computed(() => props.mode === 'exam')
const isRecite = computed(() => !!props.recite && !isExam.value)  // 考试与背题互斥，双保险
const q = computed(() => questions.value[idx.value] || null)
const isMultiple = computed(() => q.value && q.value.type === 'multiple')
const isEssay = computed(() => q.value && q.value.type === 'essay')
const isPaper = computed(() => q.value && q.value.type === 'paper')
const isDone = computed(() => idx.value >= questions.value.length)
const selectedForConfirm = ref(false) // 已选答案但未确认（防手滑）
// 交卷后的「逐题解析」：每题记录你的作答 vs 正确答案 + 解析，供复盘
const reviews = ref([])
const showReview = ref(false)

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
      categoryIds: props.categoryIds && props.categoryIds.length ? props.categoryIds : null,
      subjectId: props.subjectId,
      mode: props.mode,
      tags: props.tags,
      // 顺序模式 + 限定题数：SQL 层 LIMIT 截断（避免全量拉取后 JS slice，大题库 IPC/parse 开销大）
      limit: props.order === 'random' ? undefined : (props.limit || undefined)
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
  // 兜底：未走 onExit（如底部 Tab 切换直接卸载）且是进行中的练习 → 保存断点防进度丢失
  if (!exitedRef) saveResumeSilently()
})
let exitedRef = false // 主动退出标记（onExit 置位，卸载兜底不再重复保存）
async function saveResumeSilently() {
  const isPractice = !props.paperId && !props.recite && !props.durationMin
  if (!isPractice) return
  try {
    if (!isDone.value && questions.value.length > 1) {
      await tiku.saveResumeSession({
        subjectId: props.subjectId, categoryId: props.categoryId, categoryIds: props.categoryIds, order: props.order,
        mode: 'practice', questions: questions.value, idx: idx.value,
        sessionCorrect: sessionCorrect.value
      })
    } else if (isDone.value) {
      await tiku.clearResumeSession()
    }
  } catch (e) { /* 断点保存失败不影响退出 */ }
}

// 退出拦截：练习模式未完成 → 保存断点；完成 → 清除断点
async function onExit() {
  exitedRef = true
  const isPractice = !props.paperId && !props.recite && !props.durationMin
  if (isPractice && !isDone.value && questions.value.length > 1) {
    await tiku.saveResumeSession({
      subjectId: props.subjectId, categoryId: props.categoryId, categoryIds: props.categoryIds, order: props.order,
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
    selectedForConfirm.value = true // 单选选完进入确认态
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
  if (finishPending) { finishPending = false; finishExam() } // 时间到且本在途提交：补执行交卷
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
  if (finishPending) { finishPending = false; finishExam() } // 时间到且本在途提交：补执行交卷
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
// ---- 结果页：上周对比/连击元数据 + 错因选择 + 批量转卡 ----
const resultMeta = ref(null)
const reasonPick = ref('')
const reasonBusy = ref(false)
// ===== 转记忆卡功能已移除 =====
function startAnother() {
  // 再来一组：重新开始练习（随机 10 题）
  idx.value = 0; questions.value = []; results.value = []; reviews.value = []
  sessionCorrect.value = 0; sessionStart.value = Date.now(); sessionEnd.value = 0
  result.value = null; selected.value = []; showReview.value = false
  mode.value = 'practice'; order.value = 'random'; isRecite.value = false
  loadQuestions({ mode: 'practice', order: 'random', limit: 10, subjectId: props.subjectId, categoryId: props.categoryId, tags: props.tags, year: props.year })
}

function onPaperSubmit(paperData) {
  // 论文提交：标记为已作答，进入下一题
  result.value = { correct: true, answer: [], analysis: '论文已提交' }
  results.value[idx.value] = { isCorrect: true, paperData }
}
const donePct = computed(() => questions.value.length ? Math.round(sessionCorrect.value / questions.value.length * 100) : 0)
const doneXp = computed(() => sessionCorrect.value * 10 + wrongs.value.length * 2)
watch(isDone, async (v) => {
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
  // 结果页元数据：上周正确率对比 + 连击天数（一次 IPC）
  try {
    const s = await tiku.getSummary(props.subjectId)
    if (s) resultMeta.value = { weekDelta: s.weekDelta ?? 0, streak: s.streak || 0 }
  } catch (e) { /* 忽略 */ }
})
// 错因批量标记：本场全部错题打同一个错因（为「错因分析」供数）
async function pickReason(reason) {
  if (reasonBusy.value) return
  reasonBusy.value = true
  reasonPick.value = reason
  try {
    let n = 0
    for (const w of wrongs.value) {
      if (w.qid) { await tiku.setWrongReason(w.qid, reason); n++ }
    }
    showToast(`已记录 ${n} 道错题的错因：${reason}`, 'ok')
  } catch (e) { showToast('记录失败：' + (e.message || e), 'err') }
  finally { reasonBusy.value = false }
}
// ===== 转记忆卡功能已移除 =====

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
  if (submitting) { finishPending = true; return } // 提交在途：标记待交卷，由 submit 完成后补执行；直接 return 会让 interval 已清的考试卡死
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
  audioSrc.value = ''
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
  // 听力音频：本地文件名（非 http/file）→ base64 dataURL，否则直用
  const au = q.value.audio_url
  if (au && !/^https?:\/\//.test(au) && !au.startsWith('file://')) {
    try {
      const url = await tiku.getAudioUrl(au)
      if (q.value && q.value.id !== id) return
      audioSrc.value = url || ''
    } catch (e) { audioSrc.value = '' }
  } else {
    audioSrc.value = au || ''
  }
  // 听力题自动播放（用户开启时）：等 DOM 渲染出 audio 后播放
  if (autoPlayAudio.value && audioSrc.value) {
    nextTick(() => {
      const el = audioEl.value
      if (el) { el.muted = false; el.play().catch(() => {}) }
    })
  }
})
const audioEl = ref(null)
function persistAutoPlay() {
  localStorage.setItem('quiz_autoplay_audio', autoPlayAudio.value ? '1' : '0')
}

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
  examRecorded.value = false // 新场次重新计入成绩曲线（此前漏重置导致重做场次不记录）
  finishPending = false
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

// ===== 旧 optionClass 已迁移至 QuestionRenderer 组件 =====
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
      <span v-if="isExam && !isDone" class="timer" :class="{ warn: timeLeft <= 60 }"><Icon name="clock" :size="14"/> {{ timeText }}</span>
      <span v-if="!loading && !isDone" class="kb-hint">⌨ 1-9 选 · Enter 提交/下一题 · F 收藏</span>
      <button v-if="isExam && !isDone" class="fav submit-exam" @click="manualFinish">交卷</button>
      <button v-if="!isRecite && !isDone" class="fav" :class="{ on: showCard }" @click="showCard = !showCard" :disabled="!q"><Icon name="grid" :size="14"/> 答题卡</button>
    </div>
    <!-- 进度条 -->
    <div v-if="!loading && !isDone" class="progress-bar">
      <div class="pb-fill" :style="{ width: ((idx + 1) / questions.length * 100) + '%' }"></div>
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
            <img v-for="(s, k) in r.images" :key="k" :src="s" class="rv-img" alt="题干图" loading="lazy" />
          </div>
          <div class="rv-row"><span class="rv-k">你的答案</span><span class="rv-v">{{ r.type === 'essay' ? (r.your || '（未作答）') : optText(r.options, r.your) }}</span></div>
          <div class="rv-row"><span class="rv-k">正确答案</span><span class="rv-v ans">{{ r.type === 'essay' ? ((r.answer && r.answer.length) ? r.answer.join('；') : '（主观题·自评）') : optText(r.options, r.answer) }}</span></div>
<div v-if="r.analysis" class="rv-analysis"><b>解析：</b>{{ r.analysis }}</div>
          <div class="rv-docs-empty">暂无关联资料</div>
        </div>
      </div>
      <button class="rv-done" @click="onExit">回到首页</button>
    </div>
    <div v-else-if="isDone" class="done card">
      <template v-if="isRecite">
        <h2>已过完本轮</h2>
        <p>共浏览 {{ questions.length }} 题。背题不判分、不计入统计，想检验效果就切回「答题」再来一遍。</p>
      </template>
      <template v-else>
        <!-- 结果主卡：正确率 + 对比 + 四格 -->
        <div class="result-hero">
          <div class="rh-sub">{{ props.paperId ? '模拟卷完成' : '本场练习完成' }} · 共 {{ questions.length }} 题</div>
          <div class="rh-pct">{{ donePct }}<small>%</small></div>
          <div class="rh-delta" :class="{ down: resultMeta?.weekDelta < 0 }">
            {{ resultMeta ? (resultMeta.weekDelta >= 0 ? '比上周平均 +' + resultMeta.weekDelta + '%' : '比上周平均 ' + resultMeta.weekDelta + '%') : '用时 ' + fmtDuration(sessionEnd.value - sessionStart.value) }}
            <span v-if="resultMeta" class="rh-delta-sub"> · 连续 {{ resultMeta.streak }} 天</span>
          </div>
          <div class="rh-grid">
            <div class="rh-item"><b>{{ sessionCorrect }}</b><span>答对</span></div>
            <div class="rh-item"><b :class="{ warn: wrongs.length }">{{ wrongs.length }}</b><span>待复习</span></div>
            <div class="rh-item"><b class="xp">+{{ doneXp }}</b><span>本场 XP</span></div>
            <div class="rh-item"><b>{{ fmtDuration(sessionEnd.value - sessionStart.value) }}</b><span>用时</span></div>
          </div>
        </div>

        <!-- 错题区 -->
        <div v-if="wrongs.length && !props.paperId" class="done-wrongs">
          <div class="dw-title">{{ wrongs.length }} 道错题已排入复习队列</div>
          <div v-for="w in wrongs.slice(0, 5)" :key="w.qid" class="dw-item">
            <span class="dw-badge">{{ typeLabel(w.type) }}</span>
            <span class="dw-stem">{{ w.stem }}</span>
          </div>
          <div class="dw-reason">
            <div class="dw-reason-q">主要错因？</div>
            <div class="dw-reason-opts">
              <button v-for="r in ['粗心', '知识点不懂', '时间不够']" :key="r" class="reason-opt" :class="{ on: reasonPick === r }" :disabled="reasonBusy" @click="pickReason(r)">{{ r }}</button>
            </div>
          </div>
          <div class="dw-actions">
            <button class="btn-review" @click="redoWrongs">重做这 {{ wrongs.length }} 道错题</button>
          </div>
        </div>

        <div class="done-actions">
          <button class="btn-review primary" @click="showReview = true">查看逐题解析</button>
          <button class="btn-review" @click="redoWrongs" v-if="wrongs.length">重做错题</button>
          <button class="btn-review" @click="onExit">返回首页</button>
          <button class="btn-review ghost" @click="startAnother" style="margin-left:auto">再来一组 ›</button>
        </div>
      </template>
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
        <img v-for="(src, i) in imageUrls" :key="i" :src="src" class="q-img" alt="题干图" loading="lazy" />
      </div>

      <!-- 听力音频（题干配置 audio_url 时显示播放器） -->
      <div v-if="q.audio_url" class="q-audio">
        <audio :src="audioSrc || q.audio_url" controls preload="none" ref="audioEl" :loop="loopAudio" :playbackRate="playRate"></audio>
        <span class="qa-hint">先听音频再作答</span>
        <button class="qa-mini" :class="{ on: loopAudio }" :title="loopAudio ? '关闭循环' : '循环播放'" @click="loopAudio = !loopAudio">↻</button>
        <select v-model.number="playRate" class="qa-rate" title="语速">
          <option :value="0.75">0.75×</option>
          <option :value="1">1×</option>
          <option :value="1.25">1.25×</option>
        </select>
        <label class="qa-autoplay" title="进题自动播放">
          <input type="checkbox" v-model="autoPlayAudio" @change="persistAutoPlay" /> 自动播放
        </label>
      </div>

      <!-- 论文模式 -->
      <PaperWriter
        v-if="q && q.type === 'paper'"
        :question="q"
        :submitted="!!result"
        :duration-min="props.durationMin || 120"
        @submit="onPaperSubmit"
      />

      <!-- 题型渲染：根据 question.type 和 subjectConfig 自动选择对应组件 -->
      <QuestionRenderer
        v-else-if="q && !isEssay"
        :question="q"
        :selected="selected"
        :submitted="!!result"
        :correct="result?.correct"
        :answer="q.answer"
        :config="subjectConfig"
        :mode="props.mode"
        @select="select($event[0])"
      />

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
          <button v-if="!isMultiple && selectedForConfirm" class="submit confirm" @click="submit">✓ 确认答案</button>
          <button v-else class="submit" :disabled="!selected.length" @click="submit">提交答案</button>
          <button v-if="!isMultiple && selectedForConfirm" class="undo" @click="selectedForConfirm = false; selected = []">撤销</button>
        </div>

        <div v-else-if="result" class="result result-banner">
          <div class="rb-icon" :class="result.isCorrect ? 'ok' : 'no'">{{ result.isCorrect ? '✓' : '✗' }}</div>
          <div class="rb-text">
            <span class="rb-title" :class="result.isCorrect ? 'ok' : 'no'">{{ result.isCorrect ? '回答正确' : '回答错误' }}</span>
            <span class="rb-ans">正确答案：{{ result.answer.join('、') }}</span>
          </div>
        </div>
        <div v-else-if="result" class="result">
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
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur, 4px));
  -webkit-backdrop-filter: blur(var(--modal-blur, 4px));
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
  padding: 20px 24px;
}
.bar { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; flex-wrap: wrap; }
.kb-hint { font-size: 11px; color: var(--muted); margin-left: auto; opacity: .6; letter-spacing: .2px; padding: 2px 8px; background: var(--bg-faint); border-radius: 6px; }
.progress-bar { height: 3px; background: var(--line); border-radius: 2px; margin-bottom: 16px; overflow: hidden; }
.pb-fill { height: 100%; background: var(--brand); border-radius: 2px; transition: width .3s ease; }
.back, .fav {
  border: 1px solid var(--line);
  background: var(--bg-faint);
  color: var(--text);
  padding: 6px 14px;
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
.recite-tag { background: rgba(255, 193, 84, 0.14); color: var(--warn-soft); border: 1px solid rgba(255, 193, 84, 0.45); border-radius: 6px; padding: 1px 7px; font-size: 11px; }
.recite-mark { margin: 12px 0; display: flex; flex-direction: column; gap: 8px; }
.rm-hint { font-size: 12px; color: var(--muted); }
.rm-actions { display: flex; gap: 10px; }
.rm-yes, .rm-no {
  flex: 1;
  padding: 9px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--bg-faint);
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
.stem { font-size: 16px; font-weight: 500; line-height: 1.6; margin-bottom: 16px; padding: 0 4px; }

.q-images { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 4px; }
.q-audio { display: flex; align-items: center; gap: 10px; margin: 10px 0 4px; flex-wrap: wrap; }
.q-audio audio { height: 36px; }
.qa-hint { font-size: 11px; color: var(--muted); }
.qa-mini {
  background: none; border: 1px solid var(--line); border-radius: 6px; color: var(--muted);
  font-size: 13px; width: 26px; height: 26px; line-height: 1; cursor: pointer; transition: all .15s;
}
.qa-mini:hover { border-color: var(--brand); color: var(--brand); }
.qa-mini.on { background: var(--brand); border-color: var(--brand); color: #fff; }
.qa-rate {
  background: var(--input-solid-bg); border: 1px solid var(--line); border-radius: 6px;
  color: var(--text); font-size: 11px; padding: 2px 4px; outline: none;
}
.qa-autoplay { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted); cursor: pointer; user-select: none; }
.qa-autoplay input { accent-color: var(--brand); }
.q-img { max-width: 100%; max-height: 220px; border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--glow-soft); }

.timeup { background: rgba(255, 77, 109, 0.12); border: 1px solid var(--bad); color: var(--bad); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 13px; }
.material-card { border: 1px solid color-mix(in srgb, var(--brand) 35%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--brand) 5%, transparent); margin-bottom: 12px; overflow: hidden; cursor: pointer; }
.mc-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; font-size: 13px; color: var(--text); }
.mc-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-toggle { font-size: 11px; color: var(--muted); flex-shrink: 0; }
.mc-body { padding: 4px 14px 12px; font-size: 13px; line-height: 1.7; color: var(--text); white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow-y: auto; }

/* 选项渲染已迁移至 QuestionRenderer 组件 */
.key { font-weight: 600; width: 22px; text-align: center; color: var(--brand); }
.text { line-height: 1.5; }

/* 问答题 */
.essay { margin-top: 4px; }
.essay-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-faint);
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

.essay-review { margin-top: 14px; border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: var(--bg-faint); }
.kw-summary { font-size: 14px; margin-bottom: 8px; }
.kw-title { color: var(--muted); }
.kw-all { color: var(--ok); font-weight: 600; }
.kw-part { color: var(--brand); font-weight: 600; }
.kw-none { color: var(--muted); }
.kw-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
.kw-hit { background: color-mix(in srgb, var(--ok) 12%, transparent); border: 1px solid var(--ok); color: var(--ok); border-radius: 6px; padding: 2px 8px; font-size: 12px; }
.kw-miss { background: rgba(255, 77, 109, 0.10); border: 1px solid var(--bad); color: var(--bad); border-radius: 6px; padding: 2px 8px; font-size: 12px; }
.kw-tip { color: var(--muted); font-size: 12px; margin: 8px 0 4px; }

/* 笔记 */
.note-btn.on { background: rgba(255, 193, 84, 0.14); border-color: rgba(255, 193, 84, 0.5); color: var(--warn-soft); }
.note-panel {
  margin-top: 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--bg-faint);
}
.note-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.note-title { font-size: 13px; color: var(--muted); }
.note-hint { font-size: 12px; color: var(--ok); }
.note-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-faint);
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
  background: var(--bg-faint);
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
.recite-ans b { color: var(--warn-soft); }
.ans-val { color: var(--ok); font-weight: 600; white-space: pre-wrap; }
.ans-none { color: var(--muted); }
.nav-prev {
  flex: 0 0 auto;
  min-width: 100px;
  background: var(--bg-faint);
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
.submit.confirm { background: var(--ok); border-color: var(--ok); color: #fff; font-size: 15px; padding: 10px 28px; }
.submit.confirm:hover { filter: brightness(1.1); }
.undo { background: none; border: 1px solid var(--line); color: var(--muted); border-radius: 10px; padding: 8px 18px; font-size: 13px; cursor: pointer; transition: all .15s; }
.undo:hover { border-color: var(--bad); color: var(--bad); }
.submit, .next {
  width: 100%;
  background: var(--brand);
  color: #fff;
  box-shadow: var(--glow);
}
.submit:hover, .next:hover { box-shadow: 0 0 20px color-mix(in srgb, var(--brand) 60%, transparent); }
.submit:disabled { background: color-mix(in srgb, var(--muted) 12%, transparent); color: var(--muted); box-shadow: none; cursor: not-allowed; flex: 1; }
.grade-yes { background: color-mix(in srgb, var(--ok) 18%, transparent); border: 1px solid var(--ok); color: var(--ok); }
.grade-yes:hover { box-shadow: 0 0 16px color-mix(in srgb, var(--ok) 40%, transparent); }
.grade-no { background: rgba(255, 77, 109, 0.14); border: 1px solid var(--bad); color: var(--bad); }
.grade-no:hover { box-shadow: 0 0 16px rgba(255, 77, 109, 0.4); }

.result { margin-top: 14px; }
.result-banner { display: flex; align-items: center; gap: 14px; padding: 16px; border-radius: 14px; background: color-mix(in srgb, var(--line) 30%, transparent); }
.result-banner .rb-icon { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; flex-shrink: 0; }
.result-banner .rb-icon.ok { background: color-mix(in srgb, var(--ok) 18%, transparent); color: var(--ok); }
.result-banner .rb-icon.no { background: color-mix(in srgb, var(--bad) 18%, transparent); color: var(--bad); }
.result-banner .rb-text { display: flex; flex-direction: column; gap: 2px; }
.result-banner .rb-title { font-size: 17px; font-weight: 700; }
.result-banner .rb-title.ok { color: var(--ok); }
.result-banner .rb-title.no { color: var(--bad); }
.result-banner .rb-ans { font-size: 12px; color: var(--muted); }
.ok { color: var(--ok); font-weight: 600; text-shadow: 0 0 8px color-mix(in srgb, var(--ok) 45%, transparent); }
.no { color: var(--bad); font-weight: 600; text-shadow: 0 0 8px rgba(255, 77, 109, 0.45); }
.ans { color: var(--muted); font-weight: 400; margin-left: 8px; }
.analysis { margin: 10px 0; color: var(--text); opacity: .85; line-height: 1.6; }

.done { text-align: center; animation: doneIn .4s ease; }
@keyframes doneIn { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }
.done h2 { color: var(--brand); text-shadow: var(--glow-soft); }
.done .score { color: var(--brand); font-size: 18px; }
.done p { color: var(--muted); margin: 8px 0 16px; }

/* 结果页主卡 */
.result-hero { padding: 6px 4px 12px; }
.rh-sub { font-size: 12.5px; color: var(--muted); }
.rh-pct { font-size: 42px; font-weight: 700; color: var(--brand); line-height: 1.15; margin-top: 2px; text-shadow: var(--glow-soft); }
.rh-pct small { font-size: 22px; font-weight: 600; }
.rh-score { font-size: 34px; font-weight: 700; color: var(--brand); margin-top: 4px; }
.rh-score-total { font-size: 15px; font-weight: 400; color: var(--muted); }
.rh-delta { font-size: 12.5px; color: var(--ok); margin: 4px 0 14px; }
.rh-delta.down { color: var(--bad); }
.rh-delta-sub { color: var(--muted); }
.rh-grid { display: flex; border-top: 1px solid var(--line); padding-top: 12px; }
.rh-item { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.rh-item b { font-size: 16px; font-weight: 600; }
.rh-item b.warn { color: var(--bad); }
.rh-item b.xp { color: var(--warn); }
.rh-item span { font-size: 11.5px; color: var(--muted); }

/* 错因选择 */
.dw-reason { margin-top: 8px; border-top: 1px dashed var(--line); padding-top: 10px; }
.dw-reason-q { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
.dw-reason-opts { display: flex; gap: 8px; }
.reason-opt {
  flex: 1; text-align: center; padding: 8px 4px; font-size: 12.5px; cursor: pointer;
  background: transparent; color: var(--text);
  border: 1px solid var(--line); border-radius: 9px; transition: all .15s;
}
.reason-opt:hover { border-color: var(--brand); color: var(--brand); }
.reason-opt.on { background: var(--brand-light); border-color: var(--brand); color: var(--brand); }
.reason-opt:disabled { opacity: .5; cursor: default; }
.dw-reason-hint { font-size: 11px; color: var(--muted); margin-top: 8px; }
.dw-actions { display: flex; gap: 8px; margin-top: 8px; }
.dw-actions .btn-review { flex: 1; }
.btn-review.ghost { background: transparent; color: var(--ok); border: 1px solid rgba(47, 191, 143, 0.45); box-shadow: none; }
.btn-review.ghost:hover { background: rgba(47, 191, 143, 0.1); box-shadow: none; }
.btn-review.ghost:disabled { opacity: .5; cursor: default; }

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
.done button:hover { box-shadow: 0 0 20px color-mix(in srgb, var(--brand) 60%, transparent); }

/* 逐题解析页 */
.review { display: flex; flex-direction: column; gap: 12px; }
.rv-head { display: flex; align-items: center; justify-content: space-between; }
.rv-head h2 { color: var(--brand); text-shadow: var(--glow-soft); }
.rv-list { display: flex; flex-direction: column; gap: 12px; max-height: 60vh; overflow-y: auto; }
.rv-item { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: var(--bg-faint); }
.rv-item.ok { border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
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
.rv-docs-empty { font-size: 12px; color: var(--muted); margin-top: 8px; }
.btn-review {
  width: 100%; background: rgba(255, 255, 255, 0.06); border: 1px solid var(--brand);
  color: var(--brand); padding: 10px 24px; border-radius: 24px; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all .2s; margin-bottom: 2px;
}
.btn-review:hover { box-shadow: var(--glow-soft); background: var(--brand-light); }
.btn-review.ghost { background: transparent; border-color: var(--line); color: var(--muted); font-weight: 400; }
.btn-review.ghost:hover { border-color: var(--brand); color: var(--brand); }
/* 结果页次按钮：返回首页（与主操作区分层级） */
.back-home {
  width: 100%; background: transparent; border: 1px solid var(--line);
  color: var(--muted); padding: 9px 24px; border-radius: 24px; font-size: 13px;
  cursor: pointer; transition: all .2s; margin-top: 2px;
}
.back-home:hover { color: var(--text); border-color: var(--brand); }
.done-actions { display: flex; gap: 8px; margin-top: 14px; }
.done-actions .btn-review { flex: 1; }
.done-actions .btn-review.primary { background: var(--brand); color: #fff; border-color: var(--brand); }
.done-actions .btn-review.primary:hover { filter: brightness(1.1); }
/* 答题反馈动画 */
.result { animation: resultIn .3s ease; }
@keyframes resultIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
.option { transition: background .2s ease, border-color .2s ease, box-shadow .2s ease; }
.result .ok { animation: popOk .35s ease; }
.result .no { animation: popNo .35s ease; }
@keyframes popOk { 0% { transform: scale(.96); } 60% { transform: scale(1.02); } 100% { transform: scale(1); } }
@keyframes popNo { 0% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } 100% { transform: translateX(0); } }

/* 答题卡导航 */
.ac-mask { position: fixed; inset: 0; background: var(--modal-mask); display: flex; align-items: center; justify-content: center; z-index: 400; padding: 16px; }
.ac-panel { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; width: min(420px, 92vw); max-height: 80vh; display: flex; flex-direction: column; box-shadow: var(--glow-soft); }
.ac-head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; margin-bottom: 10px; flex-shrink: 0; }
.ac-x { background: none; border: none; color: var(--muted); font-size: 16px; cursor: pointer; }
.ac-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; overflow-y: auto; max-height: 60vh; padding: 2px; }
.ac-cell { aspect-ratio: 1; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font-size: 12px; cursor: pointer; transition: transform .1s ease; }
.ac-cell:hover { transform: scale(1.08); }
.ac-cell.current { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand) inset; font-weight: 700; }
.ac-cell.right { background: color-mix(in srgb, var(--ok) 18%, transparent); border-color: var(--ok); color: var(--ok); }
.ac-cell.wrong { background: rgba(255, 77, 109, 0.16); border-color: var(--bad); color: var(--bad); }
.ac-cell.todo { opacity: .7; }
.ac-legend { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 11px; color: var(--muted); flex-wrap: wrap; }
.ac-dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.ac-dot.current { background: var(--brand); }
.ac-dot.right { background: var(--ok); }
.ac-dot.wrong { background: var(--bad); }
.ac-dot.todo { background: var(--line); }
.master-btn { margin-top: 8px; background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); border: 1px solid var(--ok); border-radius: 8px; padding: 6px 12px; cursor: pointer; font-weight: 600; }
.master-btn:hover { background: color-mix(in srgb, var(--ok) 26%, transparent); }

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

/* ===== 答题页铺开（2026-08-12）：渐变语言 / 流光（不做倾斜——答题专注场景）===== */
/* 题目卡/结果卡：渐变边框（scoped 覆盖全局 .card） */
.card {
  border: 1px solid transparent;
  background-image:
    linear-gradient(var(--card), var(--card)),
    linear-gradient(135deg, color-mix(in srgb, var(--brand) 40%, transparent), color-mix(in srgb, var(--brand2) 40%, transparent));
  background-origin: border-box;
  background-clip: padding-box, border-box;
  position: relative;
}
/* 主卡 hover 流光描边（pointer-events none 不挡选项点击） */
.card::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  padding: 1px;
  background: conic-gradient(from var(--ang), transparent 0deg, color-mix(in srgb, var(--brand) 70%, transparent) 80deg, transparent 170deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0; pointer-events: none; transition: opacity .18s;
}
.card:hover::after { opacity: 1; animation: angSpin 2.2s linear infinite; }

/* 选项 hover：品牌渐变底（比原纯色更有层次） */
.option:hover { background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 10%, transparent), color-mix(in srgb, var(--brand2) 6%, transparent)); }

/* 结果页大数字：渐变（正确率/得分） */
.rh-pct {
  background: linear-gradient(180deg, #93b1ff, #5b7cfa);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}
.rh-score { background: linear-gradient(180deg, #93b1ff, #5b7cfa); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
[data-theme="light"] .rh-pct, [data-theme="light"] .rh-score { background: linear-gradient(180deg, #3d5bd9, #7c3aed); -webkit-background-clip: text; background-clip: text; }
[data-theme="eye"] .rh-pct, [data-theme="eye"] .rh-score { background: linear-gradient(180deg, #2e6649, #4d8f6e); -webkit-background-clip: text; background-clip: text; }

/* ===== 答题页加浓（2026-08-12）：结果反馈层（不干扰答题操作）===== */
/* 结果页大数字：弹入（配合渐变） */
.rh-pct, .rh-score { animation: numPop .5s cubic-bezier(.2, .7, .3, 1) .1s both; }
@keyframes numPop { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }

/* 结果卡/逐题解析卡：入场浮起（Quiz 不在 .tab-page，手动补） */
.done, .review { animation: riseIn .4s cubic-bezier(.2, .7, .3, 1) both; }

/* 选项选中：轻微弹入反馈 */
.option.sel { animation: optSel .25s cubic-bezier(.2, .7, .3, 1); }
@keyframes optSel { 0% { transform: scale(.98); } 60% { transform: scale(1.015); } 100% { transform: scale(1); } }

/* 考试计时器危急：红色呼吸（时间压力可视化） */
.timer.warn { animation: timerWarn 1s ease-in-out infinite; }
@keyframes timerWarn { 0%, 100% { color: var(--bad); opacity: 1; } 50% { color: var(--bad); opacity: .55; } }

/* P6-B 移动端适配：触控目标加高 + 答题卡列数（820px 断点与 useResponsive 一致） */
@media (max-width: 820px) {
  .option { min-height: 48px; padding: 13px 14px; }
  .btn-review { min-height: 44px; }
  .ac-grid { grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .quiz-modal { max-height: 94dvh; }
}
</style>
