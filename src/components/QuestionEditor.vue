<script setup>
import { ref, computed, watch } from 'vue'
import { tiku } from '../api/tiku.js'
import { LETTERS, splitKeywords } from '../utils/bankParser.js'

const props = defineProps({
  show: Boolean,
  wide: Boolean,
  question: { type: Object, default: null },   // 传入则为编辑，否则新增
  categories: { type: Array, default: () => [] },
  defaultCategoryId: { type: [Number, String], default: '' }
})
const emit = defineEmits(['close', 'saved'])

const type = ref('single')
const stem = ref('')
const options = ref([{ key: 'A', text: '' }, { key: 'B', text: '' }, { key: 'C', text: '' }, { key: 'D', text: '' }])
const answer = ref([])
const analysis = ref('')
const keywords = ref('')          // 问答题采分点（；/换行/逗号分隔）
const difficulty = ref(3)
const source = ref('手动录入')
const categoryId = ref('')
const error = ref('')
const saving = ref(false)
// 题干配图：文件名数组（原文件存 userData/images，库里只存文件名）
const images = ref([])
const audioUrl = ref('')
const uploading = ref(false)
// 题干配图的预览 dataURL（getImage 是异步的，模板里不能直接 :src=Promise）
const thumbUrls = ref([])
watch(images, async (list) => {
  thumbUrls.value = []
  if (!list || !list.length) return
  try {
    const urls = await Promise.all(list.map(name => tiku.getImage(name)))
    thumbUrls.value = urls.filter(Boolean)
  } catch (e) { thumbUrls.value = [] }
}, { immediate: true })

const isEdit = computed(() => !!(props.question && props.question.id))
const isJudge = computed(() => type.value === 'judge')
const isEssay = computed(() => type.value === 'essay')

// 分类拍平成「科目 / 章节」，题目只能挂在具体节点上
const flatCategories = computed(() => {
  const out = []
  ;(props.categories || []).forEach(s => {
    out.push({ id: s.id, label: s.name, isSubject: true })
    ;(s.children || []).forEach(c => out.push({ id: c.id, label: '　└ ' + c.name, isSubject: false }))
  })
  return out
})

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
    categoryId.value = q.category_id || ''
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
    categoryId.value = props.defaultCategoryId || ''
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

watch(() => props.show, (v) => { if (v) loadFromProps() }, { immediate: true })

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
  if (!categoryId.value) return '请选择所属科目/章节'
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
      categoryId: Number(categoryId.value),
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
        </div>

        <div class="qe-body">
          <div class="field">
            <label>所属科目 / 章节</label>
            <select v-model="categoryId" class="input">
              <option value="">请选择…</option>
              <option v-for="c in flatCategories" :key="c.id" :value="c.id">{{ c.label }}</option>
            </select>
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
                <img :src="thumbUrls[i]" :alt="img" />
                <button class="img-del" @click="removeImage(i)">×</button>
              </div>
              <label class="img-add">
                <input type="file" accept="image/*" hidden @change="onPickImage" />
                <span>{{ uploading ? '上传中…' : '+ 添加图片' }}</span>
              </label>
            </div>
            <span class="hint-sm">图片保存在本机「userData/images」，同步时会随题库 JSON 一起备份</span>
          </div>

          <div class="field">
            <label>听力音频（选填，雅思等听力题）</label>
            <input v-model="audioUrl" class="input" placeholder="音频地址：本地文件路径或 http(s) 链接（答题页自动出现播放器）" />
            <audio v-if="audioUrl.trim()" :src="audioUrl.trim()" controls preload="none" class="audio-preview"></audio>
            <span class="hint-sm">答题页会显示播放器；本地路径用绝对路径（如 D://audio//listening1.mp3）</span>
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
  background: rgba(3, 6, 14, 0.72);
  backdrop-filter: blur(6px);
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

.qe-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field > label, .label-row > label { font-size: 12px; color: var(--muted); }
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

.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  padding: 7px 16px;
  border-radius: 20px;
  border: 1px solid var(--line);
  background: rgba(91, 124, 250, 0.05);
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.chip.active {
  border-color: var(--brand);
  color: var(--brand);
  background: var(--brand-light);
  box-shadow: var(--glow-soft);
}

.opt-row { display: flex; align-items: center; gap: 8px; }
.opt-key {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: rgba(91, 124, 250, 0.05);
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.opt-key.picked {
  border-color: var(--ok);
  color: var(--ok);
  background: rgba(44, 229, 168, 0.14);
  box-shadow: 0 0 10px rgba(44, 229, 168, 0.3);
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
  color: #ffb3c1;
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
