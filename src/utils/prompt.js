// 全局输入弹层：替代原生 window.prompt（Electron 里与主题割裂），视觉与 AppConfirm 一致
// 用法：import { showPrompt } from '../utils/prompt.js'
//       const name = await showPrompt({ title: '重命名', value: '旧名', placeholder: '新名称' })
//       返回输入值（trim）；取消/Esc/点遮罩返回 null
import { ref } from 'vue'

export const promptState = ref({ show: false, title: '', msg: '', value: '', placeholder: '' })
let resolver = null

export function showPrompt(opts = {}) {
  // 释放上一个未决的 prompt（连续弹出时前一个 Promise 不悬挂）
  if (resolver) { resolver(null); resolver = null }
  promptState.value = {
    show: true,
    title: opts.title || '请输入',
    msg: opts.msg || '',
    value: opts.value ?? '',
    placeholder: opts.placeholder || ''
  }
  return new Promise(res => { resolver = res })
}

export function resolvePrompt(val) {
  promptState.value.show = false
  if (resolver) {
    resolver(val)
    resolver = null
  }
}
