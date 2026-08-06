// 全局 Confirm 弹层：替代原生 confirm，视觉与应用一致
// 用法：import { showConfirm } from '../utils/confirm.js'
//       if (!(await showConfirm('确定删除？', { title: '删除', danger: true }))) return
import { ref } from 'vue'

export const confirmState = ref({ show: false, msg: '', title: '', danger: true })
let resolver = null

export function showConfirm(msg, opts = {}) {
  confirmState.value = {
    show: true,
    msg,
    title: opts.title || '确认操作',
    danger: opts.danger !== false
  }
  return new Promise(res => { resolver = res })
}

export function resolveConfirm(ok) {
  confirmState.value.show = false
  if (resolver) {
    resolver(ok)
    resolver = null
  }
}
