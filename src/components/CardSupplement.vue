<script setup>
// 转卡补充弹窗（题目/文档高亮/错题 → 记忆卡）：
// 先按内容查重 —— 已存在同内容卡 → 关联出处并提示；不存在 → 让用户补充 音标/释义/音频 后新建。
// 复用方：QuestionDetail「转记忆卡」、KbReader 高亮「转卡」、WrongBook「生成记忆卡」。
import Icon from './Icon.vue'
import { ref, computed, watch } from 'vue'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { useEsc } from '../utils/useEsc.js'

const props = defineProps({
  show: Boolean,
  // 卡片预填
  front: { type: String, default: '' },
  back: { type: String, default: '' },
  category: { type: String, default: '' },
  subjectId: { type: [Number, String], default: null },
  categoryId: { type: [Number, String], default: null },
  // 来源：题目 或 文档 至少一个
  sourceQuestionId: { type: [Number, String], default: null },
  sourceDocId: { type: [Number, String], default: null },
  // 语言科目才显示音标/音频（英语/日语）
  lang: { type: String, default: '' } // 'en-US' | 'ja-JP' | ''
})
useBodyLock(() => props.show)
useFocusTrap(() => props.show, '.cs-mask > .cs-panel')
const emit = defineEmits(['close', 'created'])

const phonetic = ref('')
const backDraft = ref('')
const audioName = ref('')   // 本地文件名（存 userData/audio）
const audioSrc = ref('')    // 可播放 URL
const busy = ref(false)
const error = ref('')

const showLang = computed(() => !!props.lang)

watch(() => props.show, (v) => {
  if (!v) return
  phonetic.value = ''
  backDraft.value = props.back || ''
  audioName.value = ''
  audioSrc.value = ''
  error.value = ''
})
useEsc(() => emit('close'))

// 本地音频文件 → saveAudio 存盘 → 预览
function onPickAudio(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      const name = await tiku.saveAudio(reader.result)
      audioName.value = name
      audioSrc.value = await tiku.getAudioUrl(name)
    } catch (err) {
      error.value = '音频保存失败：' + (err.message || String(err))
    }
  }
  reader.readAsArrayBuffer(file)
}
function removeAudio() { audioName.value = ''; audioSrc.value = '' }

async function confirm() {
  if (busy.value) return
  const front = String(props.front || '').trim()
  if (!front) { error.value = '正面内容为空'; return }
  busy.value = true
  error.value = ''
  try {
    const r = await tiku.addCardSmart({
      front,
      back: backDraft.value || props.back || '',
      category: props.category || '',
      subjectId: props.subjectId ? Number(props.subjectId) : null,
      categoryId: props.categoryId ? Number(props.categoryId) : null,
      phonetic: phonetic.value.trim(),
      audioUrl: audioName.value,
      sourceQuestionId: props.sourceQuestionId ? Number(props.sourceQuestionId) : null,
      sourceDocId: props.sourceDocId ? Number(props.sourceDocId) : null
    })
    if (!r || !r.ok) throw new Error((r && r.error) || '创建失败')
    if (r.matched) {
      showToast(r.duplicate ? '已有关联的记忆卡，无需重复创建' : '已关联出处', 'ok')
    } else {
      showToast('已生成记忆卡，可在「记忆卡」复习', 'ok')
    }
    emit('created', r)
    emit('close')
  } catch (err) {
    error.value = String((err && err.message) || err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="cs-mask" @click.self="emit('close')">
      <div class="cs-panel">
        <div class="cs-head">
          <span class="cs-title">转为记忆卡</span>
          <span class="cs-close" @click="emit('close')">×</span>
        </div>

        <div class="cs-body">
          <!-- 正面预览 -->
          <div class="cs-row">
            <span class="cs-label">正面</span>
            <div class="cs-front">{{ front }}</div>
          </div>

          <!-- 音标（语言科目） -->
          <div v-if="showLang" class="cs-row">
            <span class="cs-label">音标</span>
            <input v-model="phonetic" class="input" :placeholder="lang === 'ja-JP' ? '如：あいさつ（发音标注）' : '如：/əˈbændən/'" />
          </div>

          <!-- 背面（释义/答案） -->
          <div class="cs-row">
            <span class="cs-label">释义</span>
            <textarea v-model="backDraft" class="input cs-textarea" rows="3" placeholder="单词释义 / 答案 / 解析"></textarea>
          </div>

          <!-- 发音音频（语言科目） -->
          <div v-if="showLang" class="cs-row">
            <span class="cs-label">音频</span>
            <div class="cs-audio-row">
              <label class="btn btn-outline sm cs-pick">
                选择音频文件
                <input type="file" accept="audio/*" hidden @change="onPickAudio" />
              </label>
              <span v-if="audioName" class="cs-audio-name">{{ audioName }}</span>
              <button v-if="audioName" class="cs-audio-rm" @click="removeAudio">×</button>
            </div>
            <audio v-if="audioSrc" :src="audioSrc" controls preload="none" class="cs-audio"></audio>
            <span class="cs-hint">不选则复习时用系统语音朗读</span>
          </div>

          <div v-if="error" class="cs-err">{{ error }}</div>
        </div>

        <div class="cs-foot">
          <button class="btn" @click="emit('close')">取消</button>
          <button class="btn btn-primary" :disabled="busy" @click="confirm">{{ busy ? '创建中…' : '创建记忆卡' }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.cs-mask {
  position: fixed; inset: 0; z-index: 230;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.cs-panel {
  width: 440px; max-width: 92vw;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow), var(--glow-soft);
  display: flex; flex-direction: column; overflow: hidden;
}
.cs-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--line);
}
.cs-title { font-size: 15px; font-weight: 600; color: var(--text); }
.cs-close { font-size: 20px; color: var(--muted); cursor: pointer; line-height: 1; }
.cs-close:hover { color: var(--brand); }
.cs-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
.cs-row { display: flex; flex-direction: column; gap: 5px; }
.cs-label { font-size: 11px; color: var(--muted); }
.cs-front { font-size: 15px; font-weight: 600; color: var(--text); word-break: break-word; }
.input {
  background: var(--input-solid-bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
  box-sizing: border-box;
}
.input:focus { border-color: var(--brand); box-shadow: var(--glow-soft); }
.cs-textarea { resize: vertical; line-height: 1.6; }
.cs-audio-row { display: flex; align-items: center; gap: 8px; }
.cs-pick { cursor: pointer; display: inline-flex; align-items: center; }
.cs-audio-name { font-size: 12px; color: var(--muted); }
.cs-audio-rm { background: none; border: none; color: var(--muted); font-size: 16px; cursor: pointer; padding: 0 4px; }
.cs-audio-rm:hover { color: var(--bad); }
.cs-audio { width: 100%; height: 36px; }
.cs-hint { font-size: 11px; color: var(--muted); }
.cs-err { font-size: 12px; color: var(--bad-soft); border: 1px solid rgba(255,77,109,.4); background: rgba(255,77,109,.08); border-radius: 8px; padding: 8px 10px; }
.cs-foot {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 12px 16px; border-top: 1px solid var(--line);
}
.fade-enter-active, .fade-leave-active { transition: opacity .18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
