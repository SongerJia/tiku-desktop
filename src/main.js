import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
// 精致本地字体：英文/数字 Inter，中文 思源黑体 Noto Sans SC（离线可用）
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/500.css'
import '@fontsource/noto-sans-sc/700.css'

createApp(App).mount('#app')
