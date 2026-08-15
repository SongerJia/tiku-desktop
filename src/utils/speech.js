// 语音朗读（Web Speech API，Electron/Chromium 内置，本地可用无需联网）
// 支持多语言音色：zh-CN / en-US / ja-JP 等，按 lang 缓存已选中的 voice。
const VOICE_CACHE = new Map() // lang → SpeechSynthesisVoice | null

function normLang(l) { return String(l || '').replace('_', '-').toLowerCase() }

// 精确匹配优先（如 en-US），再按主语言前缀兜底（en-US 找不到 → 任意 en-*）
function pickVoice(lang) {
  const key = normLang(lang)
  if (VOICE_CACHE.has(key)) return VOICE_CACHE.get(key)
  let v = null
  try {
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []
    const nk = key.replace('-', '_')
    v = voices.find(x => normLang(x.lang) === key)
      || voices.find(x => normLang(x.lang) === nk)
      || voices.find(x => normLang(x.lang).startsWith(key.split('-')[0] + '-'))
      || voices.find(x => normLang(x.lang).startsWith(key.split('-')[0] + '_'))
      || null
  } catch (e) { v = null }
  VOICE_CACHE.set(key, v)
  return v
}

// Chromium 的语音列表是异步加载的：首次 getVoices() 可能为空，
// voiceschanged 触发后清空缓存，下次朗读重新挑选（修复首次选不到中文音色）。
if (typeof window !== 'undefined' && window.speechSynthesis) {
  try { window.speechSynthesis.addEventListener('voiceschanged', () => VOICE_CACHE.clear()) } catch (e) {}
}

// 朗读一段文本；返回是否成功发起。
// speakText(text, rate) 保持旧签名兼容；lang 可选（默认 zh-CN）。
export function speakText(text, rate = 1, lang = 'zh-CN') {
  if (!text || !window.speechSynthesis) return false
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    const v = pickVoice(lang)
    if (v) u.voice = v
    u.lang = lang
    u.rate = rate
    window.speechSynthesis.speak(u)
    return true
  } catch (e) { return false }
}

// 按科目名识别语言：英语/English→en-US，日语/Japanese/日本語→ja-JP，其余→null（不显示发音功能）
export function detectSubjectLang(subjectName) {
  const n = String(subjectName || '')
  if (/英语|english|ielts|toefl/i.test(n)) return 'en-US'
  if (/日语|日本语|japanese|日本語|jlpt|n\d级/i.test(n)) return 'ja-JP'
  return null
}
