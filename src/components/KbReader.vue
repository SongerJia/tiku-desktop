<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import MarkdownIt from 'markdown-it'
import { tiku } from '../api/tiku.js'

const props = defineProps({ show: Boolean, doc: Object })
const emit = defineEmits(['close'])

const md = new MarkdownIt({ linkify: true, breaks: true, html: false })
const html = ref('')
const pdfState = ref({ loading: false, error: '', pages: 0, done: 0 })
const pdfContainer = ref(null)
let pdfTask = null
let pdfDoc = null

watch(() => props.show, async (v) => {
  if (!v || !props.doc) return
  html.value = ''
  pdfState.value = { loading: false, error: '', pages: 0, done: 0 }
  cleanupPdf()
  if (props.doc.type === 'md') await renderMd()
  else await renderPdf()
})

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

async function renderMd() {
  const r = await tiku.kbRead(props.doc.id)
  if (!r.ok) { html.value = `<div class="kb-err">读取失败：${r.error}</div>`; return }
  const text = new TextDecoder('utf-8').decode(b64ToUint8(r.base64))
  html.value = md.render(text)
}

async function renderPdf() {
  const r = await tiku.kbRead(props.doc.id)
  if (!r.ok) { pdfState.value.error = `读取失败：${r.error}`; return }
  try {
    pdfState.value.loading = true
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfTask = getDocument({
      data: b64ToUint8(r.base64),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true
    })
    pdfDoc = await pdfTask.promise
    pdfState.value.pages = pdfDoc.numPages
    await renderAllPages()
  } catch (e) {
    pdfState.value.error = String((e && e.message) || e)
  } finally {
    pdfState.value.loading = false
  }
}

async function renderAllPages() {
  if (!pdfDoc || !pdfContainer.value) return
  try {
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p)
      const vp = page.getViewport({ scale: 1.5 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      canvas.classList.add('kb-pdf-page')
      pdfContainer.value.appendChild(canvas)
      pdfState.value.done = p
    }
  } catch (e) {
    if (!pdfState.value.error) pdfState.value.error = String((e && e.message) || e)
  }
}

function cleanupPdf() {
  if (pdfTask && typeof pdfTask.destroy === 'function') {
    try { pdfTask.destroy() } catch (e) { /* 忽略 */ }
  }
  pdfTask = null
  pdfDoc = null
}

onBeforeUnmount(cleanupPdf)
</script>

<template>
  <div v-if="show" class="kb-mask" @click.self="emit('close')">
    <div class="kb-reader">
      <div class="kb-reader-head">
        <span class="badge kb-type" :class="props.doc?.type">{{ props.doc?.type === 'pdf' ? 'PDF' : 'MD' }}</span>
        <span class="kb-reader-title">{{ props.doc?.title }}</span>
        <div class="kb-reader-spacer"></div>
        <span v-if="pdfState.pages" class="kb-pdf-prog">{{ pdfState.done }}/{{ pdfState.pages }}</span>
        <button class="btn kb-close" @click="emit('close')">关闭</button>
      </div>
      <div class="kb-reader-body">
        <div v-if="pdfState.error" class="kb-err">
          <p>{{ pdfState.error }}</p>
          <p class="kb-hint">扫描版 PDF 没有文本层无法内嵌预览，可用系统阅读器打开原件</p>
          <button class="btn btn-primary" @click="tiku.kbOpen(props.doc.id)">系统阅读器打开</button>
        </div>
        <div v-if="pdfState.loading" class="empty">PDF 加载中…</div>
        <div v-if="props.doc?.type === 'md'" class="kb-md" v-html="html"></div>
        <div v-else ref="pdfContainer" class="kb-pdf"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kb-mask {
  position: fixed;
  inset: 0;
  background: rgba(2, 12, 24, 0.85);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
  padding: 16px;
}
.kb-reader {
  width: min(860px, 96vw);
  height: 92vh;
  background: var(--bg, #06121f);
  border: 1px solid var(--line);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 0 40px rgba(42, 245, 255, 0.15);
}
.kb-reader-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}
.kb-reader-title { font-size: 15px; font-weight: 500; color: var(--text); }
.kb-reader-spacer { flex: 1; }
.kb-type { text-transform: uppercase; letter-spacing: 1px; }
.kb-type.pdf { background: rgba(232, 95, 61, 0.15); color: #e85f3d; }
.kb-type.md { background: rgba(42, 245, 255, 0.12); color: var(--brand); }
.kb-pdf-prog { font-size: 12px; color: var(--muted); }
.kb-close { padding: 4px 14px; }
.kb-reader-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 26px;
  scroll-behavior: smooth;
}
.kb-md { max-width: 760px; margin: 0 auto; }
.kb-md :deep(h1), .kb-md :deep(h2), .kb-md :deep(h3) { color: var(--brand); margin: 18px 0 10px; }
.kb-md :deep(h1) { font-size: 20px; }
.kb-md :deep(h2) { font-size: 17px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
.kb-md :deep(h3) { font-size: 15px; }
.kb-md :deep(p) { line-height: 1.8; color: var(--text); margin: 8px 0; }
.kb-md :deep(ul), .kb-md :deep(ol) { padding-left: 22px; color: var(--text); line-height: 1.8; }
.kb-md :deep(code) { background: rgba(42, 245, 255, 0.1); color: var(--brand); padding: 1px 6px; border-radius: 4px; font-size: 12.5px; }
.kb-md :deep(pre) { background: rgba(255, 255, 255, 0.04); border: 1px solid var(--line); border-radius: 10px; padding: 12px; overflow-x: auto; }
.kb-md :deep(pre code) { background: none; color: var(--text); }
.kb-md :deep(blockquote) { border-left: 3px solid var(--brand); padding-left: 12px; color: var(--muted); margin: 10px 0; }
.kb-md :deep(table) { border-collapse: collapse; margin: 10px 0; }
.kb-md :deep(th), .kb-md :deep(td) { border: 1px solid var(--line); padding: 6px 10px; font-size: 13px; }
.kb-md :deep(img) { max-width: 100%; border-radius: 8px; }
.kb-pdf { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.kb-pdf-page {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.5);
  background: #fff;
}
.kb-err { color: #e85f3d; text-align: center; padding: 40px 0; }
.kb-hint { font-size: 12px; color: var(--muted); margin-top: 8px; }
</style>
