// 全局轻量 Toast：替代原生 alert，视觉与应用风格一致
// 用法：import { showToast } from '../utils/toast.js'
//       showToast('保存成功', 'ok')  // type: info | ok | err
import { ref } from 'vue'

export const toastMsg = ref('')
export const toastType = ref('info')
let timer = null

export function showToast(msg, type = 'info') {
  toastMsg.value = msg
  toastType.value = type
  clearTimeout(timer)
  timer = setTimeout(() => { toastMsg.value = '' }, 2600)
}
