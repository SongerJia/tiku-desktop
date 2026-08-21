// 科目配置系统（2026-08-20）：每个科目独立配置题型、维度、UI 偏好
// 存储方式：tiku.setSetting('subject_cfg_{id}', JSON.stringify(config))
// 默认值：通用配置（单选/多选/判断/问答，无年份等特殊维度）

import { tiku } from '../api/tiku.js'

// ===== 内置题型注册表 =====
export const BUILTIN_TYPES = [
  { key: 'single',   label: '单选', icon: '○' },
  { key: 'multiple', label: '多选', icon: '□' },
  { key: 'judge',    label: '判断', icon: '✓✗' },
  { key: 'essay',    label: '问答', icon: '✎' },
  { key: 'paper',    label: '论文', icon: '📄' },
  { key: 'coding',   label: '编码', icon: '&lt;/&gt;' },
  { key: 'listening',label: '听力', icon: '♪' }
]

// ===== 内置维度注册表 =====
export const BUILTIN_DIMS = [
  { key: 'year',           label: '年份',     desc: '按考试年份筛选' },
  { key: 'difficulty',     label: '难度',     desc: '按难度星级筛选' },
  { key: 'tag',            label: '标签',     desc: '按自定义标签筛选' },
  { key: 'chapter_weight', label: '章节分值', desc: '显示章节考试占比' }
]

// ===== 默认配置 =====
export const DEFAULT_CONFIG = {
  types: ['single', 'multiple', 'judge', 'essay'],
  dims: ['difficulty', 'tag'],
  ui: {
    single_card: true,        // 单选卡片式选项（vs 传统 A. B. C. D.）
    show_difficulty: true,    // 难度星级
    show_accuracy: true,      // 正确率
    show_year: false,         // 显示年份标签
    show_chapter_weight: false // 章节分值占比
  },
  exam: null // 考试模式参数（如架构师有 knowledge/case/paper）
}

// ===== 预置：软考系统架构师 =====
export const ARCHITECT_CONFIG = {
  types: ['single', 'essay', 'paper'],
  dims: ['year', 'chapter_weight', 'difficulty', 'tag'],
  ui: {
    single_card: true,
    show_difficulty: true,
    show_accuracy: true,
    show_year: true,
    show_chapter_weight: true
  },
  exam: {
    knowledge: { count: 75, minutes: 150 },
    case: { count: 3, minutes: 90 },
    paper: { count: 1, minutes: 120 }
  }
}

// ===== 预置：Java 工程师 =====
export const JAVA_CONFIG = {
  types: ['single', 'multiple', 'coding'],
  dims: ['difficulty', 'tag'],
  ui: {
    single_card: true,
    show_difficulty: true,
    show_accuracy: true,
    show_year: false,
    show_chapter_weight: false
  },
  exam: null
}

// ===== 预置：雅思 =====
export const IELTS_CONFIG = {
  types: ['single', 'multiple', 'essay', 'listening'],
  dims: ['year', 'difficulty', 'tag'],
  ui: {
    single_card: true,
    show_difficulty: false,
    show_accuracy: true,
    show_year: true,
    show_chapter_weight: false
  },
  exam: {
    listening: { count: 40, minutes: 30 },
    reading: { count: 40, minutes: 60 },
    writing: { count: 2, minutes: 60 },
    speaking: { count: 3, minutes: 15 }
  }
}

// ===== 预置映射（按科目名匹配） =====
export const PRESET_MAP = {
  '软考系统架构师': ARCHITECT_CONFIG,
  '系统架构设计师': ARCHITECT_CONFIG,
  'Java': JAVA_CONFIG,
  'Java工程师': JAVA_CONFIG,
  '雅思': IELTS_CONFIG,
  'IELTS': IELTS_CONFIG
}

// ===== 存储键 =====
function cfgKey(subjectId) { return `subject_cfg_${subjectId}` }

// ===== 加载科目配置 =====
export async function loadSubjectConfig(subjectId) {
  if (!subjectId) return { ...DEFAULT_CONFIG }
  try {
    const raw = await tiku.getSetting(cfgKey(subjectId))
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_CONFIG, ...parsed, ui: { ...DEFAULT_CONFIG.ui, ...(parsed.ui || {}) } }
    }
  } catch (e) { /* 解析失败走默认 */ }
  return { ...DEFAULT_CONFIG }
}

// ===== 保存科目配置 =====
export async function saveSubjectConfig(subjectId, config) {
  if (!subjectId) return
  await tiku.setSetting(cfgKey(subjectId), JSON.stringify(config))
}

// ===== 应用预置（按科目名匹配） =====
export function detectPreset(subjectName) {
  if (!subjectName) return null
  for (const [keyword, preset] of Object.entries(PRESET_MAP)) {
    if (subjectName.includes(keyword)) return { ...preset, ui: { ...preset.ui } }
  }
  return null
}

// ===== 获取科目支持的题型列表（用于筛选器/新增题目的题型下拉） =====
export function getTypeOptions(config) {
  return BUILTIN_TYPES.filter(t => config.types.includes(t.key))
}

// ===== 获取科目启用的维度列表（用于筛选器） =====
export function getDimOptions(config) {
  return BUILTIN_DIMS.filter(d => config.dims.includes(d.key))
}