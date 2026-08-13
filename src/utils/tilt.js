// 通用 3D 倾斜指令（v-tilt）：卡片跟随鼠标立体倾斜。
// 入场动画 riseIn（fill both）会压制内联 transform——animationend 时解除压制。
// 用法：<div v-tilt="{ deg: 4 }">…</div>，script setup 中 `import { vTilt } from '../utils/tilt.js'` 自动注册。
export const vTilt = {
  mounted(el, binding) {
    if (el.dataset.tiltBound) return
    const max = (binding.value && binding.value.deg) || 4
    el.dataset.tiltBound = '1'
    el.style.transition = 'transform .25s cubic-bezier(.2, .7, .3, 1), box-shadow .18s ease, background .15s ease'
    el.style.transformStyle = 'preserve-3d'
    el.style.willChange = 'transform'
    el.addEventListener('mousemove', (e) => {
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
    })
    el.addEventListener('mouseleave', () => {
      el.style.transform = ''
      el.style.setProperty('--tiltRx', '0')
      el.style.setProperty('--tiltRy', '0')
    })
    el.addEventListener('animationend', (e) => { if (e.animationName === 'riseIn') el.style.animation = 'none' })
  }
}
