// useSubjectConfig.js：科目配置加载/响应 composable
// 在 App.vue 中调用，随科目切换自动加载对应配置，下发给子组件

import { ref, watch, computed } from 'vue'
import { loadSubjectConfig, saveSubjectConfig, detectPreset, DEFAULT_CONFIG, getTypeOptions, getDimOptions } from '../utils/subjectConfig.js'

export function useSubjectConfig(currentSubject) {
  // 当前科目的配置（响应式）
  const config = ref({ ...DEFAULT_CONFIG })
  const loading = ref(false)

  // 根据当前科目加载配置
  async function refreshConfig() {
    const sid = currentSubject.value?.id
    loading.value = true
    if (sid) {
      const cfg = await loadSubjectConfig(sid)
      // 检测预置：如果从未手动配置过（用默认值），尝试按科目名匹配预置
      const raw = await getRawConfig(sid)
      if (!raw) {
        const preset = detectPreset(currentSubject.value?.name || '')
        if (preset) {
          config.value = preset
          await saveSubjectConfig(sid, preset)
        } else {
          config.value = cfg
        }
      } else {
        config.value = cfg
      }
    } else {
      config.value = { ...DEFAULT_CONFIG }
    }
    loading.value = false
  }

  // 获取原始配置字符串（判断是否已配置过）
  async function getRawConfig(subjectId) {
    if (!subjectId) return null
    try {
      const { tiku } = await import('../api/tiku.js')
      return await tiku.getSetting(`subject_cfg_${subjectId}`)
    } catch (e) { return null }
  }

  // 保存配置
  async function updateConfig(partial) {
    const sid = currentSubject.value?.id
    if (!sid) return
    const merged = { ...config.value, ...partial, ui: { ...config.value.ui, ...(partial.ui || {}) } }
    config.value = merged
    await saveSubjectConfig(sid, merged)
  }

  // 跟随科目变化
  watch(() => currentSubject.value?.id, () => { refreshConfig() }, { immediate: false })

  // 便捷计算属性
  const typeOptions = computed(() => getTypeOptions(config.value))
  const dimOptions = computed(() => getDimOptions(config.value))
  const hasDim = (dimKey) => config.value.dims.includes(dimKey)

  return {
    config,
    loading,
    refreshConfig,
    updateConfig,
    typeOptions,
    dimOptions,
    hasDim
  }
}