<script setup>
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { celebrate } from '../utils/celebrate.js'
import { useEsc } from '../utils/useEsc.js'
import SimpleQuestion from './SimpleQuestion.vue'
import CardSupplement from './CardSupplement.vue'
import { detectSubjectLang } from '../utils/speech.js'

const props = defineProps({ show: Boolean, doc: Object })
useBodyLock(() => props.show)
useFocusTrap(() => props.show, '.kb-page')
const emit = defineEmits(['close', 'open-doc'])

const HL_COLORS = {
  yellow: 'rgba(255, 200, 60, 0.25)',
  blue: 'rgba(60, 160, 255, 0.25)',
  green: 'rgba(80, 220, 140, 0.25)',
  pink: 'rgba(255, 110, 160, 0.25)'
}
const hlColor = (c) => HL_COLORS[c] || HL_COLORS.yellow

// MD 文档：打开即进入 Vditor 即时渲染（IR）编辑器——整篇渲染预览，点击任意行光标定位即进入编辑，无「编辑」按钮
const mdVditorEl = ref(null)
let mdVditor = null
const mdSaveStatus = ref('') // '' | 'saving' | 'saved' | 'err'
let mdSaveTimer = null
const tocList = ref([])
function jumpToToc(id) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
// 从 Vditor 渲染后的 DOM 收集 h1-h4 目录（Vditor 自带锚点 id）
// 注意：IR 模式下处于编辑态（源码态）的标题行 DOM 文本带 "## " 等 markdown 前缀，需清洗
function cleanTocText(raw) {
  return (raw || '')
    .replace(/^#{1,6}\s*/, '')       // 去掉开头的 # 前缀（IR 源码态残留）
    .replace(/^[*\-+]\s+/, '')       // 去掉列表项前缀
    .replace(/^(\d+[.)])\s+/, '')    // 去掉有序列表编号
    .trim() || '（无标题）'
}
function collectTocFromVditor() {
  const root = mdVditorEl.value
  if (!root) return
  const headings = root.querySelectorAll('.vditor-reset h1, .vditor-reset h2, .vditor-reset h3, .vditor-reset h4')
  tocList.value = Array.from(headings).map((h, i) => {
    if (!h.id) h.id = 'kb-sec-' + i
    return { id: h.id, level: Number(h.tagName.slice(1)), text: cleanTocText(h.textContent) }
  })
}
// 保存 MD 文档（Vditor 内容 → kbSaveMd；input 防抖 + Ctrl+S + 返回时立即保存）
async function saveMdDoc(showStatus = true) {
  if (!mdVditor || !props.doc) return false
  const content = mdVditor.getValue()
  if (showStatus) mdSaveStatus.value = 'saving'
  const r = await tiku.kbSaveMd(props.doc.id, content)
  if (showStatus) mdSaveStatus.value = r.ok ? 'saved' : 'err'
  return r.ok
}
function destroyMdVditor() {
  if (mdVditor) {
    try { mdVditor.destroy() } catch (e) { /* 忽略 */ }
    mdVditor = null
  }
  clearTimeout(mdSaveTimer)
}
// Vditor 用 XHR + script.text（等价内联脚本）加载图标精灵 ant.js，会被 CSP script-src 'self' 拦截导致图标空白
// → 改为普通 <script src> 预加载（同源外部脚本，CSP 允许）；Vditor 检测到 #vditorIconScript 已存在会跳过
function ensureVditorIcons() {
  if (document.getElementById('vditorIconScript')) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = (import.meta.env.DEV ? '/vditor' : './vditor') + '/dist/js/icons/ant.js'
    s.id = 'vditorIconScript'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Vditor 图标资源加载失败'))
    document.head.appendChild(s)
  })
}
async function initMdVditor(gen) {
  const r = await tiku.kbRead(props.doc.id)
  if (!r.ok) { showToast('读取失败：' + r.error, 'err'); return }
  const text = new TextDecoder('utf-8').decode(b64ToUint8(r.base64))
  await nextTick()
  if (gen !== loadGen) return // 已被更新的文档接管，放弃初始化，避免双 Vditor 竞争同一 DOM
  if (!mdVditorEl.value) return
  try { await ensureVditorIcons() } catch (e) { /* 图标缺失不阻塞编辑，仅工具栏无图标 */ }
  const isDark = document.documentElement.dataset.theme === 'dark'
  mdVditor = new Vditor(mdVditorEl.value, {
    mode: 'ir', // 即时渲染：整篇渲染预览，光标所在行显示源码（点击行即进入编辑）——Typora 式所见即所得
    cdn: import.meta.env.DEV ? '/vditor' : './vditor',
    value: text,
    height: '100%',
    theme: isDark ? 'dark' : 'classic',
    lang: 'zh_CN',
    placeholder: '',
    cache: { enable: false },
    preview: { delay: 120, maxWidth: 10000 }, // maxWidth 设超大值——Vditor setPadding 用 (父宽-maxWidth)/2 算左右内距，默认 800 会把文字挤到中间（左右各 ~120px 内距），超大值让内距落到 35px 最小舒适值，文字接近占满右栏
    toolbar: [],          // 无工具栏 = Typora 式纯正文（依赖 Ctrl+B/I 等快捷键 + 顶栏编辑态操作）
    counter: false,       // 无字数统计
    outline: false,       // 无大纲按钮
    input: () => {
      clearTimeout(mdSaveTimer)
      mdSaveStatus.value = 'saving'
      mdSaveTimer = setTimeout(() => saveMdDoc(true), 800) // 输入停顿 800ms 自动保存
      collectTocFromVditor() // 标题变化后更新目录
    },
    after: () => {
      try {
        mdVditor.blur()   // 先失焦 → 所有标题行恢复渲染态（否则源码态的标题文本带 ## 前缀污染大纲）
        collectTocFromVditor()
        // 兜底：强制 IR 编辑区宽度 100% + 重渲染预览（防首帧 clientWidth 异常导致 setPadding 锁死极窄——字符垂直排列 bug）
        const irEl = document.querySelector('.kb-md-vditor .vditor-ir')
        if (irEl) irEl.style.width = '100%'
        if (typeof mdVditor.renderPreview === 'function') mdVditor.renderPreview()
      } catch (e) { /* 忽略 */ }
    }
  })
}
// 全局快捷键：Ctrl+S 保存 MD 文档
function onGlobalKeydown(e) {
  if (!mdVditor || !props.doc || props.doc.type !== 'md') return
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    saveMdDoc(true)
  }
}
// 统一缩放：MD 用字号倍数（20px = 100%，用户要求正文字体更大），PDF 用 canvas scale（100 = 基准 1.5）
const fontSize = ref(20)
const MD_FONT_BASE = 20
const MD_ZOOM_MIN = 75   // =15px
const MD_ZOOM_MAX = 150  // =30px
const MD_ZOOM_STEP = 10  // =2px/步
const isMdDoc = computed(() => props.doc?.type === 'md')
const zoomPct = computed(() => isMdDoc.value ? Math.round(fontSize.value / MD_FONT_BASE * 100) : pdfZoom.value)
const ZOOM_MIN = computed(() => isMdDoc.value ? MD_ZOOM_MIN : PDF_ZOOM_MIN)
const ZOOM_MAX = computed(() => isMdDoc.value ? MD_ZOOM_MAX : PDF_ZOOM_MAX)
const ZOOM_STEP = computed(() => isMdDoc.value ? MD_ZOOM_STEP : PDF_ZOOM_STEP)
function mdZoomToFont(pct) { return Math.round(MD_FONT_BASE * pct / 100 * 10) / 10 }

// PDF 当前页（滚动估算）
const currentPage = ref(0)
// PDF 缩放百分比（100 = 基准 1.5 scale），懒渲染重建
const pdfZoom = ref(100)
const PDF_ZOOM_MIN = 50
const PDF_ZOOM_MAX = 250
const PDF_ZOOM_STEP = 15
let pdfZoomTimer = null
// 缩放交互：右下角浮层 + Ctrl+滚轮 + 2.2s 无操作自动隐藏（MD/PDF 统一）
const zoomUi = ref(false)
let zoomUiTimer = null
function showZoomUi() {
  zoomUi.value = true
  clearTimeout(zoomUiTimer)
  zoomUiTimer = setTimeout(() => { zoomUi.value = false }, 2200)
}
function pauseZoomHide() { clearTimeout(zoomUiTimer) }
function resumeZoomHide() { showZoomUi() }
function scheduleZoomRender() {
  clearTimeout(pdfZoomTimer)
  pdfZoomTimer = setTimeout(async () => {
    if (!pdfDoc || !pdfContainer.value) return
    await rebuildPdfAtZoom() // 懒渲染重建：只渲染可见页，旧 zoom 缓存命中直接复用
  }, 200)
}
function applyPdfZoom(val) {
  pdfZoom.value = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, val))
  scheduleZoomRender()
}
// 统一缩放入口：MD 改字号，PDF 改 scale
function changeZoom(delta) {
  if (isMdDoc.value) {
    const cur = Math.round(fontSize.value / MD_FONT_BASE * 100)
    fontSize.value = mdZoomToFont(Math.min(ZOOM_MAX.value, Math.max(ZOOM_MIN.value, cur + delta)))
  } else {
    applyPdfZoom(pdfZoom.value + delta)
  }
  showZoomUi()
}
function onZoomSlider(e) {
  const pct = Number(e.target.value)
  if (isMdDoc.value) {
    fontSize.value = mdZoomToFont(pct)
  } else {
    applyPdfZoom(pct)
  }
  showZoomUi()
}
function resetZoom() {
  if (isMdDoc.value) {
    fontSize.value = MD_FONT_BASE
  } else {
    applyPdfZoom(100)
  }
  showZoomUi()
}
// Ctrl+滚轮缩放（MD 挂 Vditor 容器 / PDF 挂 pdfContainer；passive:false 才能 preventDefault）
let zoomWheelCleanup = null
function attachZoomWheel() {
  const c = isMdDoc.value ? mdVditorEl.value : pdfContainer.value
  if (!c || zoomWheelCleanup) return
  const onWheel = (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    changeZoom(e.deltaY < 0 ? ZOOM_STEP.value : -ZOOM_STEP.value)
  }
  c.addEventListener('wheel', onWheel, { passive: false })
  zoomWheelCleanup = () => c.removeEventListener('wheel', onWheel)
}
function detachZoomWheel() {
  if (zoomWheelCleanup) { zoomWheelCleanup(); zoomWheelCleanup = null }
}
const html = ref('')
const pdfState = ref({ loading: false, error: '', pages: 0 })
const pdfContainer = ref(null)
let pdfTask = null
let pdfDoc = null
// ---- 懒渲染（保守版）：按需 getPage + 串行渲染 + 缩放缓存 ----
// 教训：大 PDF（400+ 页）严禁全量/并发 getPage——两次事故都是 600 页并发预取卡死主线程
let pdfPageObjs = []   // pdfjs Page 对象缓存（仅渲染到的页）
let pageEls = []       // 每页当前 DOM 元素（占位 div 或 canvas）
const pdfCache = new Map()  // `${p}|${zoom}` → canvas（缩放回旧比例直接复用）
const PDF_CACHE_MAX = 40
let renderQueue = []   // 待渲染页码
let renderBusy = false // 渲染队列串行锁
let pdfScrollTimer = null

function cacheSet(key, canvas) {
  pdfCache.set(key, canvas)
  if (pdfCache.size > PDF_CACHE_MAX) {
    const oldest = pdfCache.keys().next().value
    pdfCache.delete(oldest)
  }
}
// 视口内可见页（懒渲染依据）：以滚动宿主 .kb-main 的视口矩形判断
function visiblePages() {
  const c = pdfContainer.value
  if (!c || !pdfDoc) return []
  const host = c.parentElement || c
  const rect = host.getBoundingClientRect()
  const top = rect.top
  const bottom = rect.bottom
  const out = []
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const el = pageEls[p]
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.bottom >= top && r.top <= bottom) out.push(p)
  }
  return out
}
// 渲染队列泵：串行渲染，避免并发 getPage/render 卡死主线程
async function pumpRenderQueue() {
  if (renderBusy) return
  renderBusy = true
  try {
    while (renderQueue.length) {
      const p = renderQueue.shift()
      await renderPage(p)
    }
  } catch (e) { /* 单页失败不阻塞队列 */ } finally {
    renderBusy = false
  }
}
// 渲染单页：缩放缓存命中直接复用（移动 canvas 节点，cloneNode 不复制像素）；否则按需 getPage（单页，绝不并发）
async function renderPage(p) {
  const placeholder = pageEls[p]
  if (!placeholder || !pdfDoc) return
  const key = `${p}|${pdfZoom.value}`
  let canvas = pdfCache.get(key)
  if (!canvas) {
    try {
      const page = pdfPageObjs[p] || await pdfDoc.getPage(p)
      pdfPageObjs[p] = page
      const scale = 1.5 * (pdfZoom.value / 100)
      const vp = page.getViewport({ scale })
      canvas = document.createElement('canvas')
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      canvas.className = 'kb-pdf-page'
      canvas.dataset.page = p
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
      cacheSet(key, canvas)
    } catch (e) {
      if (!pdfState.value.error) pdfState.value.error = String((e && e.message) || e)
      return
    }
  }
  canvas.classList.add('kb-pdf-page')
  canvas.dataset.page = p
  placeholder.replaceWith(canvas)
  pageEls[p] = canvas
  }
// 按当前 zoom 重建占位 + 渲染可见页（打开文档 / 缩放时调用）
async function rebuildPdfAtZoom() {
  const c = pdfContainer.value
  if (!c || !pdfDoc) return
  const total = pdfDoc.numPages
  const anchor = currentPage.value || Number(props.doc.last_page) || 1
  c.innerHTML = ''
  pageEls = []
  const scale = 1.5 * (pdfZoom.value / 100)
  // 只 getPage anchor 一页拿统一样式占位尺寸（PDF 通常统一页大小）；绝不遍历/并发 getPage
  let stdW = 900
  let stdH = 1200
  try {
    const aPage = pdfPageObjs[anchor] || await pdfDoc.getPage(anchor)
    pdfPageObjs[anchor] = aPage
    const vp = aPage.getViewport({ scale })
    stdW = Math.floor(vp.width)
    stdH = Math.floor(vp.height)
  } catch (e) { /* 用兜底尺寸 */ }
  // 为所有页建占位（撑出正确滚动条长度）
  for (let p = 1; p <= total; p++) {
    const ph = document.createElement('div')
    ph.className = 'kb-pdf-ph'
    ph.dataset.page = p
    ph.style.width = stdW + 'px'
    ph.style.height = stdH + 'px'
    c.appendChild(ph)
    pageEls[p] = ph
  }
    const anchorEl = pageEls[anchor]
  if (anchorEl) anchorEl.scrollIntoView({ block: 'start' })
  // 只渲染视口内可见页（首屏少量，其余滚动时补）
  for (const p of visiblePages()) {
    if (!renderQueue.includes(p)) renderQueue.push(p)
  }
  await pumpRenderQueue()
}

// 「相关题目」面板：已关联(kb_links) + L2 推荐(kbSuggestQuestions) + 手动搜题关联
const qLinks = ref([])
const qSugg = ref([])
const qPanel = ref(true)
const mKw = ref('')
const mRes = ref([])
const mLoading = ref(false)
const sq = ref({ show: false, q: null })
let mTimer = null

// 左侧大纲栏：默认展开，顶栏「大纲」按钮收放
const tocVisible = ref(true)
function toggleToc() {
  tocVisible.value = !tocVisible.value
  // 大纲收起/展开后右栏宽度变化，触发 Vditor 重测 setPadding（否则正文宽度不更新）
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'))
    if (mdVditor && typeof mdVditor.renderPreview === 'function') mdVditor.renderPreview()
  }, 50)
}
// 右侧相关题目 + 批注抽屉（默认关闭，按需唤出）
const panelOpen = ref(false)

// C1 顶部阅读进度条 + C2 大纲 scrollspy（2026-08-13）
const mainEl = ref(null) // 滚动宿主（kb-main，MD/PDF 通用）
const readPct = ref(0)
const activeTocId = ref('')
function onMainScroll() {
  const el = mainEl.value
  if (el) {
    const max = el.scrollHeight - el.clientHeight
    readPct.value = max > 0 ? Math.min(100, Math.round((el.scrollTop / max) * 100)) : 0
  }
  if (pdfDoc) onPdfScroll() // PDF 当前页估算（懒渲染）
  // C2 scrollspy：仅 MD，找视口内最靠上的标题（tocList 按文档顺序，第一个超出即停）
  if (props.doc && props.doc.type === 'md' && tocList.value.length) {
    let cur = ''
    for (const t of tocList.value) {
      const el = document.getElementById(t.id)
      if (el && el.getBoundingClientRect().top <= 120) cur = t.id
      else break
    }
    activeTocId.value = cur
  }
}

// 关闭：MD 文档先立即保存（防抖中的改动落盘）；PDF 保存阅读位置
async function onClose() {
  if (props.doc && props.doc.type === 'md') {
    clearTimeout(mdSaveTimer)
    await saveMdDoc(false)
  }
  await saveScroll()
  emit('close')
}

// 高亮批注 + 文档双链
const hl = ref([])
const links = ref({ from: [], to: [] })
const hlPanel = ref(true)
const linkKw = ref('')
const linkRes = ref([])
let linkTimer = null

async function loadHlAndLinks() {
  if (!props.doc) return
  const [h, l] = await Promise.allSettled([tiku.getHighlightsForDoc(props.doc.id), tiku.getDocLinks(props.doc.id)])
  hl.value = h.status === 'fulfilled' ? (h.value || []) : []
  links.value = l.status === 'fulfilled' ? (l.value || []) : []
}

async function removeHl(id) {
  await tiku.removeHighlight(id)
  await loadHlAndLinks()
}

// 高亮 → 记忆卡（E-2）：正面=高亮文本，背面=原文+文档标题；弹补充表单（音标/释义/音频，语言科目）
let hlCardBusy = null
const hlCard = ref(null)     // { highlight, doc }
const hlCardLang = ref('')
async function hlToCard(h) {
  if (hlCardBusy === h.id) return
  hlCardBusy = h.id
  try {
    // 查科目名判断语言（英语/日语显示音标音频）
    let subjName = ''
    if (props.doc && props.doc.subject_id) {
      try {
        const cats = await tiku.getCategories()
        const s = (cats || []).find(c => String(c.id) === String(props.doc.subject_id))
        if (s) subjName = s.name
      } catch (e) {}
    }
    hlCardLang.value = detectSubjectLang(subjName) || ''
    hlCard.value = { highlight: h, doc: props.doc }
  } catch (e) { /* 打开失败忽略 */ }
  finally { hlCardBusy = null }
}

function onLinkInput() {
  clearTimeout(linkTimer)
  const kw = linkKw.value.trim()
  if (!kw) { linkRes.value = []; return }
  linkTimer = setTimeout(async () => {
    linkRes.value = (await tiku.kbSearch(kw, 5)).filter(d => d.id !== props.doc.id)
  }, 300)
}

async function linkDoc(d) {
  await tiku.linkDocs(props.doc.id, d.id)
  linkRes.value = linkRes.value.filter(x => x.id !== d.id)
  await loadHlAndLinks()
}

async function unlinkDoc(docId) {
  await tiku.unlinkDocs(props.doc.id, docId)
  await loadHlAndLinks()
}

async function loadQPanel() {
  if (!props.doc) return
  const [links, sugg] = await Promise.allSettled([
    tiku.kbLinksForDoc(props.doc.id),
    tiku.kbSuggestQuestions(props.doc.id, 5)
  ])
  qLinks.value = links.status === 'fulfilled' ? (links.value || []) : []
  qSugg.value = sugg.status === 'fulfilled' ? (sugg.value || []) : []
}

// 打开文档（show+doc 同时变）或双链跳转（doc 变）→ 刷新内容。合并为一个 watch：同时变化只触发一次，避免双 loadCurrent 重复初始化 Vditor/PDF
watch(() => [props.show, props.doc && props.doc.id], ([s, did]) => {
  if (s && did) loadCurrent().catch(e => { /* 文档加载失败：阅读区显示错误态，不抛未捕获 */ console.warn('loadCurrent', e) })
})

let loadGen = 0 // 代际计数：快速连点切文档时，旧 loadCurrent 的异步续作（new Vditor/renderPdf）全部作废，防双实例竞争同一 DOM
async function loadCurrent() {
  const gen = ++loadGen
  if (!props.doc) return
  tocList.value = []
  mdSaveStatus.value = ''
  pdfState.value = { loading: false, error: '', pages: 0 }
  qLinks.value = []
  qSugg.value = []
  mKw.value = ''
  mRes.value = []
  pdfZoom.value = 100 // 换文档重置缩放
  fontSize.value = MD_FONT_BASE
  zoomUi.value = false
  clearTimeout(pdfZoomTimer)
  clearTimeout(zoomUiTimer)
  clearTimeout(mdSaveTimer)
  detachZoomWheel()
  destroyMdVditor()
  cleanupPdf()
  if (props.doc.type === 'md') {
    await initMdVditor(gen)
    if (gen !== loadGen) { destroyMdVditor(); return } // 已被更新的文档接管，销毁自己创建的实例
    attachZoomWheel()
  } else {
    await renderPdf(gen)
    if (gen !== loadGen) { cleanupPdf(); return }
    attachZoomWheel()
  }
  await loadQPanel()
  if (gen !== loadGen) return
  await loadHlAndLinks()
  if (gen !== loadGen) return
  await tiku.kbBumpRead(props.doc.id) // 阅读埋点（计入学习统计）
  if (gen !== loadGen) return
  celebrate()
}

async function linkQ(qid) {
  try {
    await tiku.kbLink({ docId: props.doc.id, questionId: qid })
    mRes.value = mRes.value.filter(x => x.id !== qid)
    await loadQPanel()
  } catch (e) { showToast('关联失败：' + (e.message || e), 'err') }
}

async function unlinkQ(qid) {
  try {
    await tiku.kbUnlink(props.doc.id, qid)
    await loadQPanel()
  } catch (e) { showToast('解除关联失败：' + (e.message || e), 'err') }
}

function onMInput() {
  clearTimeout(mTimer)
  const kw = mKw.value.trim()
  if (!kw) { mRes.value = []; mLoading.value = false; return }
  mTimer = setTimeout(async () => {
    mLoading.value = true
    mRes.value = await tiku.getQuestions({ keyword: kw, limit: 6 })
    mLoading.value = false
  }, 300)
}

async function openQ(qid, fallbackStem) {
  const full = await tiku.getQuestionById(qid)
  sq.value = { show: true, q: full || { id: qid, stem: fallbackStem, options: [], answer: [], type: 'single' } }
}

function b64ToUint8(b64) {
  const bin = atob(b64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i += 0x8000) {
    const chunk = Math.min(0x8000, len - i)
    for (let j = 0; j < chunk; j++) bytes[i + j] = bin.charCodeAt(i + j)
  }
  return bytes
}

async function renderPdf(gen) {
  const r = await tiku.kbRead(props.doc.id)
  if (gen !== loadGen) return // 已被更新的文档接管，放弃本次渲染
  if (!r.ok) { pdfState.value.error = `读取失败：${r.error}`; return }
  try {
    pdfState.value.loading = true
    // pdfjs 6.x 必须显式设置 workerSrc；用本地 worker 文件避免网络依赖
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href
    }
    const getDocument = pdfjsLib.getDocument
    pdfTask = getDocument({
      data: b64ToUint8(r.base64),
      isEvalSupported: false,
      useSystemFonts: true
    })
    pdfDoc = await pdfTask.promise
    if (gen !== loadGen) { cleanupPdf(); return }
    pdfState.value.pages = pdfDoc.numPages
    await rebuildPdfAtZoom() // 建占位 + 渲染可见页（懒渲染）
  } catch (e) {
    if (gen !== loadGen) return
    pdfState.value.error = String((e && e.message) || e)
  } finally {
    if (gen === loadGen) pdfState.value.loading = false
  }
}

// 滚动：估算当前页（保存位置用）+ 防抖补渲染新进视口的页
function onPdfScroll() {
  if (!pdfDoc) return
  const host = (pdfContainer.value && pdfContainer.value.parentElement) || pdfContainer.value
  if (!host) return
  const top = host.getBoundingClientRect().top + 40
  let cur = 0
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const el = pageEls[p]
    if (!el) continue
    if (el.getBoundingClientRect().top <= top) cur = p
    else break
  }
  currentPage.value = cur
  // 把可见但未渲染的页加入队列（防抖，避免滚动中疯狂排队）
  clearTimeout(pdfScrollTimer)
  pdfScrollTimer = setTimeout(() => {
    const vis = visiblePages()
    for (const p of vis) {
      if (pdfCache.has(`${p}|${pdfZoom.value}`)) continue
      if (!renderQueue.includes(p)) renderQueue.push(p)
    }
    pumpRenderQueue()
  }, 120)
}

async function saveScroll() {
  if (!props.doc) return
  if (props.doc.type === 'pdf' && currentPage.value > 0) {
    await tiku.saveKbScroll(props.doc.id, currentPage.value)
  }
}

function cleanupPdf() {
  if (pdfTask && typeof pdfTask.destroy === 'function') {
    try { pdfTask.destroy() } catch (e) { /* 忽略 */ }
  }
  pdfTask = null
  pdfDoc = null
  pdfPageObjs = []
  pageEls = []
  renderQueue = []
  renderBusy = false
  pdfCache.clear()
  clearTimeout(pdfScrollTimer)
}

onBeforeUnmount(() => {
  cleanupPdf()
  destroyMdVditor()
  detachZoomWheel()
  clearTimeout(mTimer)
  clearTimeout(pdfZoomTimer)
  clearTimeout(zoomUiTimer)
  clearTimeout(mdSaveTimer)
  window.removeEventListener('keydown', onGlobalKeydown)
})
window.addEventListener('keydown', onGlobalKeydown)
useEsc(() => onClose()) // Esc 关闭走 onClose：先保存 MD 改动/PDF 页码再关闭，避免丢编辑
</script>

<template>
  <!-- Teleport 到 body：全屏阅读器脱离 .kb 内容树，fixed 定位不受任何视图模式/动画/容器干扰（图谱模式下曾嵌页面内） -->
  <Teleport to="body">
  <div v-if="show" class="kb-page">
    <!-- C1 顶部阅读进度条：滚动即走 2px 细线（MD/PDF 通用） -->
    <div class="kb-progress"><div class="kb-progress-fill" :style="{ width: readPct + '%' }"></div></div>
    <!-- 顶栏：返回 + 标题 + 操作按钮 -->
    <div class="kb-head">
      <button class="btn kb-back" @click="onClose">← 返回</button>
      <span class="badge kb-type" :class="props.doc?.type">{{ props.doc?.type === 'pdf' ? 'PDF' : 'MD' }}</span>
      <span class="kb-title">{{ props.doc?.title }}</span>
      <div class="kb-spacer"></div>
      <span v-if="pdfState.pages" class="kb-pdf-prog">{{ currentPage || 1 }}/{{ pdfState.pages }} 页</span>
      <template v-if="props.doc?.type === 'md'">
        <span v-if="mdSaveStatus === 'saving'" class="kb-save-state">保存中…</span>
        <span v-else-if="mdSaveStatus === 'saved'" class="kb-save-state ok">已保存</span>
        <span v-else-if="mdSaveStatus === 'err'" class="kb-save-state err">保存失败</span>
      </template>
      <button v-if="props.doc?.type === 'md' && tocList.length" class="btn kb-side-toggle" :class="{ on: tocVisible }" @click="toggleToc">大纲</button>
      <button class="btn kb-side-toggle" :class="{ on: panelOpen }" @click="panelOpen = !panelOpen">相关</button>
    </div>
    <!-- 主体：双栏 Typora 式（左大纲常驻可收放 + 右正文） -->
    <div class="kb-body">
      <!-- 左：MD 大纲（默认展开，顶栏「大纲」按钮收放） -->
      <aside v-if="props.doc?.type === 'md' && tocList.length && tocVisible" class="kb-side-toc">
        <div class="kb-side-title">大纲</div>
        <div class="kb-toc">
          <div
            v-for="t in tocList"
            :key="t.id"
            class="kb-toc-item"
            :class="['kb-toc-l' + t.level, { active: t.id === activeTocId }]"
            :title="t.text"
            @click="jumpToToc(t.id)"
          >{{ t.text || '（无标题）' }}</div>
        </div>
      </aside>
      <!-- 右：正文（md = Vditor IR / pdf = 懒渲染） -->
      <div class="kb-main" ref="mainEl" @scroll.passive="onMainScroll">
        <template v-if="props.doc?.type === 'md'">
          <div ref="mdVditorEl" class="kb-md-vditor" :style="{ '--kb-md-fs': fontSize + 'px' }"></div>
        </template>
        <template v-else>
          <div v-if="pdfState.error" class="kb-err">
            <p>{{ pdfState.error }}</p>
            <p class="kb-hint">扫描版 PDF 没有文本层无法内嵌预览，可用系统阅读器打开原件</p>
            <button class="btn btn-primary" @click="tiku.kbOpen(props.doc.id)">系统阅读器打开</button>
          </div>
          <div v-if="pdfState.loading" class="empty">PDF 加载中…</div>
          <div ref="pdfContainer" class="kb-pdf"></div>
        </template>
      </div>
    </div>

    <!-- 右侧相关题目 + 批注抽屉（默认关闭，按需唤出） -->
    <transition name="kb-slide-right">
      <aside v-if="panelOpen" class="kb-drawer kb-drawer-right">
        <div class="kb-drawer-head">
          <span>相关 &amp; 批注</span>
          <button class="kb-drawer-close" @click="panelOpen = false" aria-label="关闭">×</button>
        </div>
        <div class="kb-drawer-body">
        <!-- 相关题目面板：已关联 + L2 推荐 + 手动搜题关联 -->
        <div class="kb-links">
          <div class="kb-links-head" @click="qPanel = !qPanel">
            <span>相关题目</span>
            <span v-if="qLinks.length || qSugg.length" class="kb-links-count">{{ qLinks.length + qSugg.length }}</span>
            <span class="kb-links-toggle">{{ qPanel ? '收起' : '展开' }}</span>
          </div>
          <div v-if="qPanel" class="kb-links-body">
            <div v-if="!qLinks.length && !qSugg.length" class="kb-links-empty">暂无关联题目，可在下方搜索手动关联</div>
            <div v-for="l in qLinks" :key="'l' + l.id" class="kb-lq">
              <span class="kb-lq-stem" @click="openQ(l.question_id, l.stemPreview)">{{ l.stemPreview }}</span>
              <button class="kb-lq-act" @click="unlinkQ(l.question_id)">解除</button>
            </div>
            <div v-for="s in qSugg" :key="'s' + s.id" class="kb-lq sug">
              <span class="kb-lq-stem" @click="openQ(s.id, s.stem)">{{ s.stem }}</span>
              <span class="kb-lq-reason">{{ s.reason }}</span>
              <button class="kb-lq-act" @click="linkQ(s.id)">关联</button>
            </div>
            <div class="kb-lq-search">
              <input v-model="mKw" class="input" placeholder="搜题手动关联（如：TCP 三次握手）…" @input="onMInput" />
            </div>
            <div v-if="mLoading" class="kb-links-empty">搜索中…</div>
            <div v-for="q in mRes" :key="'m' + q.id" class="kb-lq">
              <span class="kb-lq-stem" @click="openQ(q.id, q.stem)">{{ q.stem }}</span>
              <button class="kb-lq-act" @click="linkQ(q.id)">关联</button>
            </div>
          </div>
        </div>

        <!-- 批注与关联：高亮 + 文档双链 -->
        <div class="kb-links">
          <div class="kb-links-head" @click="hlPanel = !hlPanel">
            <span>批注与关联</span>
            <span v-if="hl.length || links.from.length || links.to.length" class="kb-links-count">{{ hl.length + links.from.length + links.to.length }}</span>
            <span class="kb-links-toggle">{{ hlPanel ? '收起' : '展开' }}</span>
          </div>
          <div v-if="hlPanel" class="kb-links-body">
            <div v-if="hl.length" class="kb-hl">
              <div v-for="h in hl" :key="h.id" class="kb-lq">
                <span class="kb-hl-text" :style="{ background: hlColor(h.color) }">{{ h.text }}</span>
                <button class="kb-lq-act" :class="{ busy: hlCardBusy === h.id }" @click="hlToCard(h)">转卡</button>
                <button class="kb-lq-act" @click="removeHl(h.id)">删除</button>
              </div>
            </div>
            <div v-else class="kb-links-empty">阅读时选中文字点「高亮」，重要内容不丢失</div>
            <div v-if="links.from.length || links.to.length" class="kb-dl">
              <div v-for="l in [...links.from, ...links.to]" :key="l.doc_id" class="kb-lq">
                <span class="kb-lq-stem" @click="$emit('open-doc', l.doc_id)">{{ l.title }}</span>
                <button class="kb-lq-act" @click="unlinkDoc(l.doc_id)">解除</button>
              </div>
            </div>
            <div class="kb-lq-search">
              <input v-model="linkKw" class="input" placeholder="搜索其他文档建立关联…" @input="onLinkInput" />
            </div>
            <div v-for="d in linkRes" :key="'d' + d.id" class="kb-lq">
              <span class="kb-lq-stem">{{ d.title }}</span>
              <button class="kb-lq-act" @click="linkDoc(d)">关联</button>
            </div>
          </div>
        </div>
      </div>
      </aside>
    </transition>

    <!-- 抽屉遮罩：点击关闭（不覆盖顶栏，保持返回可点） -->
    <div v-if="panelOpen" class="kb-drawer-mask" @click="panelOpen = false"></div>

    <!-- 缩放浮层（MD/PDF 统一）：右下角，2.2s 无操作自动隐藏；hover 暂停计时 -->
    <div v-if="zoomUi" class="kb-zoom-ui" @mouseenter="pauseZoomHide" @mouseleave="resumeZoomHide">
      <button class="kb-zoom-btn" :disabled="zoomPct <= ZOOM_MIN" @click="changeZoom(-ZOOM_STEP)" title="缩小">−</button>
      <input class="kb-zoom-range" type="range" :min="ZOOM_MIN" :max="ZOOM_MAX" :value="zoomPct" @input="onZoomSlider" title="缩放比例" />
      <button class="kb-zoom-btn" :disabled="zoomPct >= ZOOM_MAX" @click="changeZoom(ZOOM_STEP)" title="放大">＋</button>
      <span class="kb-zoom-pct">{{ zoomPct }}%</span>
      <button class="kb-zoom-reset" v-if="zoomPct !== 100" @click="resetZoom">复位</button>
    </div>

    <SimpleQuestion :show="sq.show" :q="sq.q" @close="sq.show = false" />

    <!-- 高亮转卡补充表单 -->
    <CardSupplement
      v-if="hlCard"
      :show="true"
      :front="(hlCard.highlight.text || '').slice(0, 80)"
      :back="'【原文】' + (hlCard.highlight.text || '') + '\n【来源】' + ((hlCard.doc && hlCard.doc.title) || '知识库')"
      :category="(hlCard.doc && hlCard.doc.title) || '知识库'"
      :subject-id="(hlCard.doc && hlCard.doc.subject_id) || null"
      :source-doc-id="hlCard.doc ? hlCard.doc.id : null"
      :lang="hlCardLang"
      @close="hlCard = null"
      @created="hlCard = null; loadHlAndLinks()"
    />
  </div>
  </Teleport>
</template>

<style scoped>
/* 全屏三栏阅读页 */
.kb-page {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}
.kb-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--topbar-bg, var(--bg));
  flex-shrink: 0;
}
.kb-back { padding: 4px 12px; }
.kb-title { font-size: 14.5px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-spacer { flex: 1; }
.kb-type { text-transform: uppercase; letter-spacing: 1px; }
.kb-type.pdf { background: rgba(232, 95, 61, 0.15); color: #e85f3d; }
[data-theme="light"] .kb-type.pdf { color: #b23c1f; }
[data-theme="eye"] .kb-type.pdf { color: #96411f; }
.kb-type.md { background: color-mix(in srgb, var(--brand) 12%, transparent); color: var(--brand); }
.kb-pdf-prog { font-size: 12px; color: var(--muted); }
.kb-act { padding: 4px 12px; }
/* PDF 缩放浮层：右下角，滑条 + −/＋ + 百分比 + 复位 */
.kb-zoom-ui {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 320;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--card-solid, var(--bg));
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 8px 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
  transition: opacity .2s ease, transform .2s ease;
}
.kb-zoom-btn {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.kb-zoom-btn:disabled { opacity: .35; cursor: default; }
.kb-zoom-btn:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); }
.kb-zoom-range { width: 120px; accent-color: var(--brand); cursor: pointer; }
.kb-zoom-pct { font-size: 12px; color: var(--muted); min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; }
.kb-zoom-reset { font-size: 12px; color: var(--brand); background: none; border: none; cursor: pointer; padding: 2px 4px; }
.kb-zoom-reset:hover { text-decoration: underline; }

/* 双栏 Typora 式：左大纲常驻 + 右正文 */
.kb-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  min-width: 0;          /* 关键：flex item 可收缩，宽度由父 .kb-page 确定分配，不与子循环 */
  overflow: hidden;
}
.kb-side-toc {
  flex: 0 0 260px;       /* 常驻左栏 260px（用户要求大纲更宽；收起时 v-if 移除，右栏自动占满） */
  min-width: 0;
  border-right: 1px solid var(--line);
  overflow-y: auto;
  padding: 18px 12px;
  background: var(--bg);  /* Typora 左栏略深背景（与正文白色区分） */
}
.kb-side-title {
  font-size: 14px;         /* "大纲"标签 11→14px（用户要求变大） */
  color: var(--muted);
  letter-spacing: 1px;
  padding: 0 6px 10px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 8px;
  font-weight: 700;
}
.kb-toc {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kb-toc-item {
  padding: 5px 10px;
  font-size: 14px;         /* 大纲字号 12.5→14（用户要求更大） */
  color: var(--muted);
  cursor: pointer;
  border-radius: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background .15s, color .15s;
}
.kb-toc-item:hover { background: var(--brand-light); color: var(--brand); }
/* 层级缩进（Typora 风格：h1 最左，h2/h3/h4 依次缩进） */
.kb-toc-l1 { font-weight: 600; color: var(--text); }
.kb-toc-l2 { padding-left: 24px; }
.kb-toc-l3 { padding-left: 38px; font-size: 13px; }
.kb-toc-l4 { padding-left: 52px; font-size: 13px; }

.kb-main {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden; /* 防止 PDF 页宽于容器时溢出到屏幕外（兜底，正常应靠 :deep 限宽） */
  padding: 12px 20px 60px;  /* 左右 padding 30→20（正文更宽）；顶部 24→12 贴合 */
  scroll-behavior: smooth;
  display: flex;
  flex-direction: column; /* MD 编辑器 flex 撑满可视高度；PDF 内容自然撑开滚动 */
}
/* Vditor MD 编辑器（Typora 式）：让 .kb-main 滚动整篇内容（不在 Vditor 内部滚）——
   关键：去掉 .vditor 的 overflow:hidden + .vditor-content 的内部滚动 + .vditor-reset 的 height:100%，
   让 pre（.vditor-reset）高度自适应内容，溢出由外层 .kb-main overflow-y:auto 接管；
   之前 Vditor 内部滚动导致右栏下方/右侧大片空白（用户红框3块），现在是整篇连贯 */
.kb-md-vditor {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
}
.kb-md-vditor :deep(.vditor) {
  width: 100%;
  min-height: 100%;        /* 至少撑满右栏可视高度；超出时让 pre 高度自适应 */
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;       /* 关键：不再内部裁剪，让 pre 高度自适应 */
  display: flex;
  flex-direction: column;
}
.kb-md-vditor :deep(.vditor-content),
.kb-md-vditor :deep(.vditor-ir) {
  background: transparent;
  overflow: visible;       /* 关键：不内部滚 */
}
.kb-md-vditor :deep(.vditor-ir) {
  padding: 0 0 60px;        /* 去掉顶部 40px 留白（用户反馈"最上面有一块空白"）；保留底部滚动余量 */
  width: 100%;
}
/* 正文排版：18px（更接近图2 参考的字号）+ 行距 1.7（更 Typora 风）+ 撑满右栏 + pre 高度自适应内容 */
.kb-md-vditor :deep(.vditor-reset) {
  width: 100%;
  height: auto !important;  /* 覆盖 Vditor 的 height:100%，pre 高度 = 内容高度 */
  max-width: none;
  margin: 0;
  font-size: var(--kb-md-fs, 18px) !important;
  line-height: 1.7;
  color: var(--text);
}
.kb-md-vditor :deep(.vditor-reset p) { margin: 0.8em 0; }
.kb-md-vditor :deep(.vditor-reset h1) {
  font-size: 2em; margin: 1.2em 0 0.6em; font-weight: 700;
  border-bottom: 1px solid var(--line); padding-bottom: 0.3em;
}
.kb-md-vditor :deep(.vditor-reset h2) {
  font-size: 1.5em; margin: 1.1em 0 0.5em; font-weight: 700;
  border-bottom: 1px solid var(--line); padding-bottom: 0.3em;
}
.kb-md-vditor :deep(.vditor-reset h3) { font-size: 1.25em; margin: 1em 0 0.5em; font-weight: 600; }
.kb-md-vditor :deep(.vditor-reset h4) { font-size: 1.1em; margin: 0.9em 0 0.4em; font-weight: 600; }
.kb-md-vditor :deep(.vditor-reset pre) { border-radius: 6px; font-size: 0.9em; }
.kb-md-vditor :deep(.vditor-reset code) { font-size: 0.9em; }
.kb-md-vditor :deep(.vditor-reset blockquote) {
  margin: 1em 0;
  padding: 0.1em 1em;
  border-left: 3px solid var(--line);
  color: var(--muted);
  background: transparent;
  border-radius: 0;
}
.kb-md-vditor :deep(.vditor-reset blockquote p) { margin: 0.5em 0; }
.kb-md-vditor :deep(.vditor-reset table) { font-size: 0.95em; }
/* 工具栏/状态栏：toolbar 传 [] 不渲染，保留样式兜底 */
.kb-md-vditor :deep(.vditor-toolbar) {
  display: none !important;  /* 双保险：即使 toolbar 配置失效也不显示 */
}
.kb-md-vditor :deep(.vditor-status) {
  background: transparent !important;
  color: var(--muted) !important;
  font-size: 12px !important;
}
.kb-md-vditor :deep(.vditor-footer) {
  background: transparent !important;
  border-top: 1px solid var(--line) !important;
}
.kb-save-state { font-size: 12px; color: var(--muted); }
.kb-save-state.ok { color: var(--ok); }
.kb-save-state.err { color: var(--bad); }
/* 抽屉（Typora 式沉浸：默认关闭，按需滑入；不挤占正文） */
.kb-drawer {
  position: fixed;
  top: 56px;                /* 避开顶栏，保持返回可点 */
  bottom: 0;
  width: min(360px, 86vw);
  z-index: 300;
  background: var(--card-solid, var(--bg));
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
}
.kb-drawer-left { left: 0; border-right: 1px solid var(--line); }
.kb-drawer-right { right: 0; border-left: 1px solid var(--line); }
.kb-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.kb-drawer-close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.kb-drawer-close:hover { color: var(--brand); }
.kb-drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.kb-drawer-mask {
  position: fixed;
  top: 56px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 290;
  background: rgba(0, 0, 0, 0.28);
}
/* 滑入动画 */
.kb-slide-left-enter-active, .kb-slide-left-leave-active,
.kb-slide-right-enter-active, .kb-slide-right-leave-active { transition: transform .25s ease; }
.kb-slide-left-enter-from, .kb-slide-left-leave-to { transform: translateX(-100%); }
.kb-slide-right-enter-from, .kb-slide-right-leave-to { transform: translateX(100%); }

/* 顶栏抽屉开关按钮（.on = 已展开） */
.kb-side-toggle { padding: 4px 12px; gap: 5px; }
.kb-side-toggle.on { color: var(--brand); border-color: var(--brand); background: var(--brand-light); }
.kb-md-vditor :deep(.vditor-reset h1),
.kb-md-vditor :deep(.vditor-reset h2),
.kb-md-vditor :deep(.vditor-reset h3),
.kb-md-vditor :deep(.vditor-reset h4) { scroll-margin-top: 70px; }
.kb-pdf { display: flex; flex-direction: column; align-items: center; gap: 12px; }
/* canvas / 占位 div 是 JS 动态创建的，没有 scoped data 属性，必须用 :deep 才能命中 */
:deep(.kb-pdf-page) {
  max-width: 100%;
  width: auto;
  height: auto;
  border-radius: 4px;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.5);
  background: #fff;
}
:deep(.kb-pdf-ph) {
  max-width: 100%;          /* 加载占位也限宽，避免动画占位比容器宽 */
  border-radius: 4px;
  background:
    linear-gradient(90deg, rgba(127, 127, 127, 0.05) 25%, rgba(127, 127, 127, 0.09) 50%, rgba(127, 127, 127, 0.05) 75%);
  background-size: 300% 100%;
  animation: kb-pdf-scan 1.4s infinite;
  flex-shrink: 0;
}
@keyframes kb-pdf-scan {
  0% { background-position: 0% 0; }
  100% { background-position: 300% 0; }
}
.kb-err { color: var(--bad); text-align: center; padding: 40px 0; }
.kb-hint { font-size: 12px; color: var(--muted); margin-top: 8px; }

/* 窄屏：抽屉加宽适配 */
@media (max-width: 960px) {
  .kb-main { padding: 18px 18px 40px; }
  .kb-drawer { width: 86vw; }
}

.kb-links {
  margin: 0;                /* 抽屉 .kb-drawer-body 用 gap 统一控制卡片间距 */
  max-width: none;          /* 取消原 760px 限宽 */
  display: flex;
  flex-direction: column;   /* 高度随内容自然撑开：空时只有 header，有内容再长大 */
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;         /* 圆角裁剪 */
  background: var(--card-solid, var(--bg));
}
.kb-links-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--brand);
  background: color-mix(in srgb, var(--brand) 5%, transparent);
  user-select: none;
}
.kb-links-count {
  font-size: 11px;
  color: var(--muted);
  background: color-mix(in srgb, var(--brand) 10%, transparent);
  border-radius: 10px;
  padding: 0 8px;
}
.kb-links-toggle { margin-left: auto; font-size: 12px; color: var(--muted); }
.kb-links-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.kb-links-empty { font-size: 12px; color: var(--muted); }
.kb-lq { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.kb-lq.sug { opacity: .9; }
.kb-lq-stem {
  flex: 1;
  color: var(--text);
  line-height: 1.5;
  cursor: pointer;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.kb-lq-stem:hover { color: var(--brand); }
.kb-lq-reason { font-size: 11px; color: var(--muted); flex-shrink: 0; }
.kb-lq-act {
  font-size: 11px;
  color: var(--muted);
  background: none;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
}
.kb-lq-act:hover { color: var(--brand); }
.kb-lq-search { margin-top: 4px; }
.kb-lq-search .input { width: 100%; font-size: 13px; }
.kb-hl, .kb-dl { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
.kb-hl-text {
  flex: 1;
  font-size: 12px;
  color: var(--text);
  line-height: 1.6;
  border-radius: 6px;
  padding: 4px 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ===== 阅读页打磨（2026-08-13）：C1 顶部进度条 + C2 大纲 scrollspy ===== */
/* 注意：不得给 .kb-page 重设 position（763 行 fixed 全屏覆盖是全屏阅读器的根本）；
   .kb-progress absolute 以 fixed 的 .kb-page 为包含块，定位不受影响 */
.kb-progress {
  position: absolute; top: 0; left: 0; right: 0; height: 2px; z-index: 20;
  background: rgba(148, 163, 184, 0.12);
  pointer-events: none;
}
.kb-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--brand), var(--brand2, #7a5cff));
  border-radius: 0 2px 2px 0;
  box-shadow: 0 0 8px color-mix(in srgb, var(--brand) 60%, transparent);
  transition: width .08s linear;
}
.kb-toc-item.active {
  background: color-mix(in srgb, var(--brand) 16%, transparent);
  border-left: 2px solid var(--brand);
  color: var(--brand-soft);
  font-weight: 600;
}


/* ===== 阅读页特效（2026-08-13）：正文聚焦光（极淡，不干扰阅读） ===== */
.kb-main {
  background:
    radial-gradient(900px 480px at 50% -4%, color-mix(in srgb, var(--brand) 5%, transparent), transparent 62%),
    transparent;
}

</style>