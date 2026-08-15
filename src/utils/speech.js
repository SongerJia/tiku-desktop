// 语音朗读（Web Speech API，Electron/Chromium 内置，本地可用无需联网）
let cachedVoice = null

function pickChineseVoice() {
  if (cachedVoice) return cachedVoice
  try {
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []
    cachedVoice = voices.find(v => /zh[-_]CN/i.test(v.lang)) || voices.find(v => /^zh/i.test(v.lang)) || null
  } catch (e) { cachedVoice = null }
  return cachedVoice
}

// 朗读一段文本；返回是否成功发起
export function speakText(text, rate = 1) {
  if (!text || !window.speechSynthesis) return false
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    const v = pickChineseVoice()
    if (v) u.voice = v
    u.lang = 'zh-CN'
    u.rate = rate
    window.speechSynthesis.speak(u)
    return true
  } catch (e) { return false }
}
