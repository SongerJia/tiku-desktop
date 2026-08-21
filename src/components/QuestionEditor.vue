<script setup>
import { ref, computed, watch } from 'vue'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { useEsc } from '../utils/useEsc.js'
import { LETTERS, splitKeywords } from '../utils/bankParser.js'
import { detectSubjectLang } from '../utils/speech.js'

const props = defineProps({
  show: Boolean,
  wide: Boolean,
  question: { type: Object, default: null },   // 传入则为编辑，否则新增
  categories: { type: Array, default: () => [] },
  defaultCategoryId: { type: [Number, String], default: '' }
})
useBodyLock(() => props.show)
useFocusTrap(() => props.show, '.qe-panel')
const emit = defineEmits(['close', 'saved'])

const type = ref('single')
const stem = ref('')
const options = ref([{ key: 'A', text: '' }, { key: 'B', text: '' }, { key: 'C', text: '' }, { key: 'D', text: '' }])
const answer = ref([])
const analysis = ref('')
const keywords = ref('')          // 问答题采分点（；/换行/逗号分隔）
const difficulty = ref(3)
const source = ref('手动录入')
const error = ref('')
const saving = ref(false)
// 题干配图：文件名数组（原文件存 userData/images，库里只存文件名）
const images = ref([])
const audioUrl = ref('')
const audioSrc = ref('')        // 实际可播放的 URL（http / file / base64 dataURL）
const uploading = ref(false)
// 题干配图的预览 dataURL（getImage 是异步的，模板里不能直接 :src=Promise）
const thumbUrls = ref([])
const previewMode = ref(false)
watch(images, async (list) => {
  thumbUrls.value = []
  if (!list || !list.length) return
  try {
    const urls = await Promise.all(list.map(name => tiku.getImage(name)))
    thumbUrls.value = urls // 保留索引（缺失图留 null，避免与 images[i] 错位）
  } catch (e) { thumbUrls.value = [] }
}, { immediate: true })

const isEdit = computed(() => !!(props.question && props.question.id))
const isJudge = computed(() => type.value === 'judge')
const isEssay = computed(() => type.value === 'essay')

// 语言科目判定（科目名约定）：科目下拉选择 → 科目名含 英语/English/雅思 等 → 显示听力音频
const subjectSel = ref('')
const chapterSel = ref('')
const subjectOptions = computed(() => (props.categories || []).map(c => ({ id: c.id, name: c.name })))
const chapterOptions = computed(() => {
  const s = (props.categories || []).find(c => String(c.id) === String(subjectSel.value))
  return (s && s.children) || []
})
const curSubjectName = computed(() => {
  const s = (props.categories || []).find(c => String(c.id) === String(subjectSel.value))
  return s ? s.name : ''
})
const isLangSubject = computed(() => !!detectSubjectLang(curSubjectName.value))
// 保存用的归属：章节优先（题目必须挂具体节点，选了章节用章节，否则用科目）
const saveCategoryId = computed(() => (chapterSel.value ? Number(chapterSel.value) : (subjectSel.value ? Number(subjectSel.value) : 0)))

// 音频：若 audioUrl 是本地文件名（非 http/file），转成可播放的 dataURL
watch(audioUrl, async (v) => {
  if (!v || /^https?:\/\//.test(v) || v.startsWith('file://')) { audioSrc.value = v || ''; return }
  try { audioSrc.value = await tiku.getAudioUrl(v) } catch (e) { audioSrc.value = '' }
}, { immediate: true })

// 换科目清空章节（防跨科目挂错）；编辑回填时跳过（splitCategoryId 内设置）
let suppressCatWatch = false
watch(subjectSel, () => {
  if (suppressCatWatch) return
  chapterSel.value = ''
})

// 由分类 id（科目或章节）反推：科目下拉 + 章节下拉的选中值
function splitCategoryId(cid) {
  suppressCatWatch = true
  subjectSel.value = ''
  chapterSel.value = ''
  if (!cid) { suppressCatWatch = false; return }
  const n = Number(cid)
  const s = (props.categories || []).find(c => Number(c.id) === n)
  if (s) { subjectSel.value = String(s.id); suppressCatWatch = false; return }
  for (const c of props.categories || []) {
    const ch = (c.children || []).find(x => Number(x.id) === n)
    if (ch) { subjectSel.value = String(c.id); chapterSel.value = String(ch.id); break }
  }
  suppressCatWatch = false
}

function loadFromProps() {
  error.value = ''
  const q = props.question
  if (q && q.id) {
    type.value = q.type || 'single'
    stem.value = q.stem || ''
    options.value = (q.options && q.options.length)
      ? q.options.map(o => ({ key: o.key, text: o.text }))
      : [{ key: 'A', text: '' }, { key: 'B', text: '' }]
    answer.value = [...(q.answer || [])]
    analysis.value = q.analysis || ''
    keywords.value = (q.keywords || []).join('；')
    difficulty.value = q.difficulty || 3
    source.value = q.source || '手动录入'
    splitCategoryId(q.category_id)
    images.value = (q.images || []).slice()
    audioUrl.value = q.audio_url || ''
  } else {
    type.value = 'single'
    stem.value = ''
    options.value = LETTERS.slice(0, 4).map(k => ({ key: k, text: '' }))
    answer.value = []
    analysis.value = ''
    keywords.value = ''
    difficulty.value = 3
    source.value = '手动录入'
    splitCategoryId(props.defaultCategoryId)
    images.value = []
    audioUrl.value = ''
  }
}

function onPickImage(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      uploading.value = true
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const name = await tiku.saveImage(reader.result, ext)
      images.value.push(name)
    } catch (err) {
      error.value = '图片保存失败：' + (err.message || String(err))
    } finally {
      uploading.value = false
    }
  }
  reader.readAsArrayBuffer(file)
  e.target.value = '' // 允许再次选中同一文件
}

function removeImage(i) {
  images.value.splice(i, 1)
}

// 选择本地音频文件（雅思等听力题）：复制到 userData/audio 并保存文件名
function onPickAudio(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      uploading.value = true
      const ext = (file.name.split('.').pop() || 'mp3').toLowerCase()
      const name = await tiku.saveAudio(reader.result, ext)
      audioUrl.value = name
      showToast('音频已添加', 'ok')
    } catch (err) {
      error.value = '音频保存失败：' + (err.message || String(err))
    } finally {
      uploading.value = false
    }
  }
  reader.readAsArrayBuffer(file)
  e.target.value = ''
}
function removeAudio() {
  audioUrl.value = ''
  audioSrc.value = ''
}

// 支持 Ctrl+V 直接粘贴截图到题干配图（老师最常见录入方式）
async function onPaste(e) {
  const items = (e.clipboardData && e.clipboardData.items) || []
  for (const it of items) {
    if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
      e.preventDefault()
      try {
        uploading.value = true
        const blob = it.getAsFile()
        if (!blob) continue
        const buf = await blob.arrayBuffer()
        const ext = (it.type.split('/')[1] || 'png').replace(/[^a-z]/g, '')
        const name = await tiku.saveImage(buf, ext)
        images.value.push(name)
      } catch (err) {
        error.value = '粘贴图片失败：' + (err.message || String(err))
      } finally {
        uploading.value = false
      }
    }
  }
}

watch(() => props.show, (v) => { if (v) loadFromProps() }, { immediate: true })
useEsc(() => emit('close'))

watch(type, (t) => {
  // 切题型时清掉不再合法的答案，避免残留脏选择
  if (t === 'judge') answer.value = []
  else if (t === 'essay') answer.value = []
  else if (t === 'single' && answer.value.length > 1) answer.value = [answer.value[0]]
  if (t !== 'judge' && t !== 'essay' && !options.value.length) options.value = LETTERS.slice(0, 4).map(k => ({ key: k, text: '' }))
})

function addOption() {
  if (options.value.length >= LETTERS.length) return
  options.value.push({ key: LETTERS[options.value.length], text: '' })
}

function removeOption(idx) {
  const removed = options.value[idx].key
  options.value.splice(idx, 1)
  // 删完重排 key，保证永远是连续的 A/B/C…
  options.value = options.value.map((o, i) => ({ ...o, key: LETTERS[i] }))
  answer.value = answer.value.filter(k => k !== removed && options.value.some(o => o.key === k))
}

function toggleAnswer(key) {
  if (isJudge.value || type.value === 'single') {
    answer.value = [key]
    return
  }
  const i = answer.value.indexOf(key)
  if (i >= 0) answer.value.splice(i, 1)
  else answer.value.push(key)
  answer.value.sort((a, b) => LETTERS.indexOf(a) - LETTERS.indexOf(b))
}

function validate() {
  if (!saveCategoryId.value) return '请选择所属科目'
  if (!stem.value.trim()) return '题干不能为空'
  if (isJudge.value) {
    if (!answer.value.length) return '请选择判断题答案（对 / 错）'
    return ''
  }
  if (isEssay.value) {
    // 问答题无标准答案，只需题干；采分点（关键词）可选，但不填就失去自评提示
    return ''
  }
  const filled = options.value.filter(o => o.text.trim())
  if (filled.length < 2) return '至少填写 2 个选项'
  if (!answer.value.length) return '请勾选正确答案'
  if (type.value === 'single' && answer.value.length > 1) return '单选题只能有一个答案'
  const validKeys = filled.map(o => o.key)
  if (answer.value.some(k => !validKeys.includes(k))) return '答案指向了空选项，请检查'
  return ''
}

async function save() {
  const err = validate()
  if (err) { error.value = err; return }
  error.value = ''
  saving.value = true
  try {
    const isEssayQ = isEssay.value
    const payload = {
      id: props.question && props.question.id,
      categoryId: saveCategoryId.value,
      type: type.value,
      stem: stem.value.trim(),
      options: isEssayQ || isJudge.value
        ? (isJudge.value ? [{ key: '对', text: '对' }, { key: '错', text: '错' }] : [])
        : options.value.filter(o => o.text.trim()).map(o => ({ key: o.key, text: o.text.trim() })),
      answer: isEssayQ ? [] : [...answer.value],
      keywords: isEssayQ ? splitKeywords(keywords.value) : [],
      analysis: analysis.value.trim(),
      difficulty: Number(difficulty.value) || 3,
      source: source.value.trim() || '手动录入',
      images: images.value.slice(),
      audioUrl: audioUrl.value.trim()
    }
    if (isEdit.value) await tiku.updateQuestion(payload)
    else await tiku.addQuestion(payload)
    emit('saved', { isEdit: isEdit.value })
    emit('close')
  } catch (e) {
    error.value = '保存失败：' + (e.message || String(e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="qe-mask" :class="{ 'is-wide': wide }" @click.self="emit('close')">
      <div class="qe-panel" :class="{ 'is-wide': wide }">
        <div class="qe-header">
          <span class="close" @click="emit('close')">×</span>
          <span class="title">{{ isEdit ? '编辑题目' : '新增题目' }}</span>
          <button class="preview-toggle" @click="previewMode = !previewMode">{{ previewMode ? '返回编辑' : '预览' }}</button>
        </div>

        <div v-if="previewMode" class="preview-area">
          <div class="pv-type">{{ { single: '单选', multiple: '多选', judge: '判断', essay: '问答' }[type] || type }}</div>
          <div class="pv-stem">{{ stem }}</div>
          <div v-if="thumbUrls.length" class="pv-images">
            <img v-for="(u, i) in thumbUrls" :key="i" :src="u" class="pv-img" />
          </div>
          <div v-if="!isEssay && !isJudge" class="pv-options">
            <div v-for="opt in options" :key="opt.key" class="pv-opt" :class="{ on: answer.includes(opt.key) }">
              <span class="pv-key">{{ opt.key }}</span>
              <span class="pv-text">{{ opt.text || '（空）' }}</span>
            </div>
          </div>
          <div v-if="isJudge" class="pv-judge">
            <span class="pv-ans">{{ answer.includes('A') ? '✓ 正确' : '✗ 错误' }}</span>
          </div>
          <div v-if="answer.length" class="pv-answer">答案：{{ answer.join('、') }}</div>
          <div v-if="analysis" class="pv-analysis">{{ analysis }}</div>
        </div>

        <div v-else class="qe-body" @paste="onPaste">
          <div class="field">
            <label>所属科目 / 章节</label>
            <div class="cat-row">
              <select v-model="subjectSel" class="input">
                <option value="">选择科目…</option>
                <option v-for="s in subjectOptions" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
              </select>
              <select v-model="chapterSel" class="input" :disabled="!chapterOptions.length">
                <option value="">章节（可空）</option>
                <option v-for="c in chapterOptions" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
              </select>
            </div>
          </div>

          <div class="field">
            <label>题型</label>
            <div class="chips">
              <button
                v-for="t in [{ k: 'single', l: '单选' }, { k: 'multiple', l: '多选' }, { k: 'judge', l: '判断' }, { k: 'essay', l: '问答' }]"
                :key="t.k"
                class="chip"
                :class="{ active: type === t.k }"
                @click="type = t.k"
              >{{ t.l }}</button>
            </div>
          </div>

          <div class="field">
            <label>题干</label>
            <textarea v-model="stem" class="input area" rows="3" placeholder="输入题目内容…"></textarea>
          </div>

          <!-- 选项与答案 -->
          <div v-if="!isJudge && !isEssay" class="field">
            <div class="label-row">
              <label>选项（勾选左侧圆点标记正确答案）</label>
              <button class="btn btn-outline sm" @click="addOption">+ 选项</button>
            </div>
            <div v-for="(o, i) in options" :key="o.key" class="opt-row">
              <button
                class="opt-key"
                :class="{ picked: answer.includes(o.key) }"
                @click="toggleAnswer(o.key)"
              >{{ o.key }}</button>
              <input v-model="o.text" class="input" :placeholder="`选项 ${o.key} 内容`" />
              <button v-if="options.length > 2" class="del" @click="removeOption(i)">×</button>
            </div>
          </div>

          <div v-else class="field">
            <label>答案</label>
            <div class="chips">
              <button
                v-for="k in ['对', '错']"
                :key="k"
                class="chip"
                :class="{ active: answer.includes(k) }"
                @click="toggleAnswer(k)"
              >{{ k }}</button>
            </div>
          </div>

          <!-- 问答题：采分点（关键词） -->
          <div v-if="isEssay" class="field">
            <label>得分关键词 / 采分点（选填，用 ；或换行分隔）</label>
            <textarea v-model="keywords" class="input area" rows="3" placeholder="如：收集资料；划分施工过程；计算工程量；确定持续时间；绘制网络图；优化关键线路"></textarea>
            <span class="hint-sm">作答时会实时高亮你写到的关键词，帮你判断是否答全；最终对错由你自评。</span>
          </div>

          <div class="field">
            <label>题干配图（选填，支持多张）</label>
            <div class="img-thumbs">
              <div v-for="(img, i) in images" :key="i" class="img-thumb">
                <img :src="thumbUrls[i]" :alt="img" loading="lazy" />
                <button class="img-del" @click="removeImage(i)">×</button>
              </div>
              <label class="img-add">
                <input type="file" accept="image/*" hidden @change="onPickImage" />
                <span>{{ uploading ? '上传中…' : '+ 添加图片' }}</span>
              </label>
            </div>
            <span class="hint-sm">图片保存在本机「userData/images」；也可直接 Ctrl+V 粘贴截图。同步时会随题库一起备份</span>
          </div>

          <div v-if="isLangSubject" class="field">
            <label>听力音频（选填，{{ curSubjectName }}科目）</label>
            <div class="audio-row">
              <input v-model="audioUrl" class="input" placeholder="音频地址：http(s) 链接，或点右侧选本地文件（自动存入本机）" />
              <label class="audio-pick">
                <input type="file" accept="audio/*" hidden @change="onPickAudio" />
                <span>{{ uploading ? '处理中…' : '选择文件' }}</span>
              </label>
              <button v-if="audioUrl.trim()" class="del" @click="removeAudio">×</button>
            </div>
            <audio v-if="audioSrc" :src="audioSrc" controls preload="none" class="audio-preview"></audio>
            <span class="hint-sm">答题页会显示播放器；选本地文件后将随题库同步一起备份</span>
          </div>

          <div class="field">
            <label>解析（可空）</label>
            <textarea v-model="analysis" class="input area" rows="2" placeholder="为什么选这个答案…"></textarea>
          </div>

          <div class="row-2">
            <div class="field">
              <label>难度</label>
              <select v-model="difficulty" class="input">
                <option v-for="d in [1, 2, 3, 4, 5]" :key="d" :value="d">{{ d }} 星</option>
              </select>
            </div>
            <div class="field">
              <label>来源</label>
              <input v-model="source" class="input" placeholder="如 2024真题" />
            </div>
          </div>

          <div v-if="error" class="err">{{ error }}</div>

          <div class="qe-footer">
            <button class="btn btn-outline" @click="emit('close')">取消</button>
            <button class="btn btn-primary" :disabled="saving" @click="save">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.qe-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  z-index: 210;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.qe-mask.is-wide { align-items: center; }

.qe-panel {
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: var(--radius) var(--radius) 0 0;
  box-shadow: var(--shadow), var(--glow-soft);
}
.qe-panel.is-wide { width: 640px; max-width: 92vw; border-radius: var(--radius); max-height: 86vh; }

.qe-header {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--card-solid);
  z-index: 2;
}
.qe-header .title { flex: 1; font-size: 16px; font-weight: 700; color: var(--text); }
.qe-header .close { font-size: 22px; color: var(--muted); cursor: pointer; line-height: 1; }
.qe-header .close:hover { color: var(--brand); }
.preview-toggle { background: none; border: 1px solid var(--line); border-radius: 8px; padding: 4px 12px; font-size: 12px; color: var(--muted); cursor: pointer; transition: all .15s; }
.preview-toggle:hover { border-color: var(--brand); color: var(--brand); }
.preview-area { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.pv-type { font-size: 11px; font-weight: 600; color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, transparent); display: inline-block; padding: 2px 8px; border-radius: 4px; align-self: flex-start; }
.pv-stem { font-size: 14px; line-height: 1.6; color: var(--text); }
.pv-images { display: flex; gap: 8px; flex-wrap: wrap; }
.pv-img { max-height: 200px; border-radius: 8px; border: 1px solid var(--line); }
.pv-options { display: flex; flex-direction: column; gap: 6px; }
.pv-opt { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; }
.pv-opt.on { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); }
.pv-key { width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: var(--muted); }
.pv-opt.on .pv-key { border-color: var(--brand); background: var(--brand); color: #fff; }
.pv-text { font-size: 13px; color: var(--text); }
.pv-judge { font-size: 14px; font-weight: 600; }
.pv-ans { color: var(--ok); }
.pv-answer { font-size: 12px; color: var(--ok); font-weight: 500; }
.pv-analysis { font-size: 12px; color: var(--muted); line-height: 1.5; padding: 8px; background: var(--bg-faint); border-radius: 8px; }

.qe-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field > label, .label-row > label { font-size: 12px; color: var(--muted); }
.cat-row { display: flex; gap: 8px; }
.cat-row .input { flex: 1; min-width: 0; }
.label-row { display: flex; align-items: center; justify-content: space-between; }
.row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.input {
  background: var(--input-solid-bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 9px 10px;
  font-size: 13px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
}
.input:focus { border-color: var(--brand); box-shadow: var(--glow-soft); }
.area { resize: vertical; line-height: 1.6; }
.hint-sm { font-size: 11px; color: var(--muted); opacity: 0.8; line-height: 1.5; }

/* 题干配图 */
.img-thumbs { display: flex; flex-wrap: wrap; gap: 10px; }
.img-thumb { position: relative; width: 92px; height: 92px; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: rgba(5,8,15,.6); }
.img-thumb img { width: 100%; height: 100%; object-fit: cover; }
.img-del { position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; border-radius: 50%; border: none; background: rgba(2,6,16,.7); color: #ffb3c1; font-size: 13px; line-height: 1; cursor: pointer; }
.img-del:hover { background: var(--bad); color: #fff; }
.img-add {
  width: 92px; height: 92px; display: flex; align-items: center; justify-content: center;
  border: 1px dashed var(--line); border-radius: 10px; color: var(--muted); font-size: 12px;
  cursor: pointer; text-align: center; transition: all .15s; padding: 4px;
}
.img-add:hover { border-color: var(--brand); color: var(--brand); box-shadow: var(--glow-soft); }

.audio-preview { width: 100%; margin-top: 6px; }
.audio-row { display: flex; align-items: center; gap: 8px; }
.audio-row .input { flex: 1; }
.audio-pick {
  flex-shrink: 0; padding: 8px 14px; border-radius: var(--radius-sm);
  border: 1px solid var(--line); background: color-mix(in srgb, var(--brand) 6%, transparent);
  color: var(--muted); font-size: 13px; cursor: pointer; transition: all .15s;
}
.audio-pick:hover { border-color: var(--brand); color: var(--brand); box-shadow: var(--glow-soft); }

.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  padding: 7px 16px;
  border-radius: 20px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--brand) 5%, transparent);
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.chip.active {
  border-color: var(--brand);
  color: #fff;
  background: var(--brand);
  box-shadow: var(--glow-soft);
}

.opt-row { display: flex; align-items: center; gap: 8px; }
.opt-key {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--brand) 5%, transparent);
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.opt-key.picked {
  border-color: var(--ok);
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 14%, transparent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--ok) 30%, transparent);
}
.del {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
}
.del:hover { color: var(--bad); border-color: var(--bad); }

.err {
  font-size: 12px;
  color: var(--bad-soft);
  border: 1px solid rgba(255, 77, 109, 0.4);
  background: rgba(255, 77, 109, 0.08);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}

.qe-footer { display: flex; gap: 10px; padding-top: 4px; }
.qe-footer .btn { flex: 1; }
.btn.sm { padding: 4px 10px; font-size: 12px; }
.btn[disabled] { opacity: 0.45; cursor: not-allowed; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
