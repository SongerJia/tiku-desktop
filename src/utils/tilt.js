// 通用 3D 倾斜指令（v-tilt）：卡片跟随鼠标立体倾斜。
// 入场动画 riseIn（fill both）会压制内联 transform——animationend 时解除压制。
// 用法：<div v-tilt="{ deg: 4 }">…</div>，script setup 中 `import { vTilt } from '../utils/tilt.js'` 自动注册。
// flat: true —— 不开启 preserve-3d（含子格子的容器如 grid 多列卡片，3D 上下文会让子元素 hover/点击命中偏移；
//         仅做倾斜特效、子元素无需 3D 深度位移时传 { flat: true } 保持事件命中正常）
export const vTilt = {
  mounted(el, binding) {
    if (el.dataset.tiltBound) return
    const max = (binding.value && binding.value.deg) || 4
    const flat = !!(binding.value && binding.value.flat)
    el.dataset.tiltBound = '1'
    el.style.transition = 'transform .25s cubic-bezier(.2, .7, .3, 1), box-shadow .18s ease, background .15s ease'
    if (!flat) el.style.transformStyle = 'preserve-3d'
    el.style.willChange = 'transform'
    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      const px = (e.clientX - r.left) / r.width - 0.5
      const py = (e.clientY - r.top) / r.height - 0.5
      const rx = (px * max).toFixed(2)
      const ry = (-py * max).toFixed(2)
      el.style.transform = `perspective(700px) rotateY(${rx}deg) rotateX(${ry}deg)`
      // 重力输出：把倾斜角暴露为 CSS 变量，子元素（勋章堆等）可反向位移模拟重力
      el.style.setProperty('--tiltRx', rx)
      el.style.setProperty('--tiltRy', ry)
    }
    const onLeave = () => {
      el.style.transform = ''
      el.style.setProperty('--tiltRx', '0')
      el.style.setProperty('--tiltRy', '0')
    }
    const onAnimEnd = (e) => { if (e.animationName === 'riseIn') el.style.animation = 'none' }
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    el.addEventListener('animationend', onAnimEnd)
    el._tiltCleanup = () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
      el.removeEventListener('animationend', onAnimEnd)
      delete el._tiltCleanup
    }
  },
  unmounted(el) { if (el._tiltCleanup) el._tiltCleanup() }
}
