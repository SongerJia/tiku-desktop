// 考证样例数据：二级建造师（职业资格考试）。首启自动灌库。
// 题目 type: single(单选) / multiple(多选) / judge(判断)
// options: [{key, text}], answer: [key,...]

const categories = [
  { id: 1, name: '建设工程法规及相关知识', parent_id: null, level: 1, stage: null, sort: 1 },
  { id: 2, name: '建设工程施工管理', parent_id: null, level: 1, stage: null, sort: 2 },
  { id: 10, name: '建设工程基本法律知识', parent_id: 1, level: 2, stage: '基础', sort: 1 },
  { id: 11, name: '施工许可法律制度', parent_id: 1, level: 2, stage: '基础', sort: 2 },
  { id: 20, name: '施工管理基础', parent_id: 2, level: 2, stage: '基础', sort: 1 },
  { id: 21, name: '施工组织设计', parent_id: 2, level: 2, stage: '强化', sort: 2 }
]

const questions = [
  {
    id: 101,
    category_id: 10,
    type: 'single',
    stem: '根据《民法典》，下列不属于法人应当具备条件的是？',
    options: [
      { key: 'A', text: '依法成立' },
      { key: 'B', text: '有必要的财产或者经费' },
      { key: 'C', text: '有自己的名称、组织机构和场所' },
      { key: 'D', text: '必须营利' }
    ],
    answer: ['D'],
    analysis: '法人并不以营利为必要条件，非营利法人（事业单位、社会团体、基金会等）同样具有法人资格。法人条件为：依法成立；有必要的财产或经费；有自己的名称、组织机构、场所；能够独立承担民事责任。',
    difficulty: 2,
    source: '二建法规-样题'
  },
  {
    id: 102,
    category_id: 11,
    type: 'single',
    stem: '建设单位应当自领取施工许可证之日起几个月内开工？',
    options: [
      { key: 'A', text: '1 个月' },
      { key: 'B', text: '2 个月' },
      { key: 'C', text: '3 个月' },
      { key: 'D', text: '6 个月' }
    ],
    answer: ['C'],
    analysis: '《建筑法》规定，建设单位应当自领取施工许可证之日起 3 个月内开工。因故不能按期开工的，应向发证机关申请延期。',
    difficulty: 2,
    source: '二建法规-样题'
  },
  {
    id: 103,
    category_id: 20,
    type: 'single',
    stem: '项目管理的核心任务是（ ）。',
    options: [
      { key: 'A', text: '目标控制' },
      { key: 'B', text: '成本控制' },
      { key: 'C', text: '进度控制' },
      { key: 'D', text: '质量控制' }
    ],
    answer: ['A'],
    analysis: '项目管理的核心任务是项目的目标控制（费用、进度、质量等各项目标的控制），而不是某一项单维度的控制。',
    difficulty: 1,
    source: '二建管理-样题'
  },
  {
    id: 104,
    category_id: 10,
    type: 'multiple',
    stem: '下列属于非营利法人的有（ ）。',
    options: [
      { key: 'A', text: '事业单位' },
      { key: 'B', text: '社会团体' },
      { key: 'C', text: '有限责任公司' },
      { key: 'D', text: '基金会' }
    ],
    answer: ['A', 'B', 'D'],
    analysis: '非营利法人包括事业单位、社会团体、基金会、社会服务机构等；有限责任公司属于营利法人。',
    difficulty: 3,
    source: '二建法规-样题'
  },
  {
    id: 105,
    category_id: 21,
    type: 'multiple',
    stem: '施工组织设计一般应包括的内容有（ ）。',
    options: [
      { key: 'A', text: '工程概况' },
      { key: 'B', text: '施工部署' },
      { key: 'C', text: '施工进度计划' },
      { key: 'D', text: '施工准备与资源配置计划' }
    ],
    answer: ['A', 'B', 'C', 'D'],
    analysis: '施工组织设计通常包括：工程概况、施工部署、施工进度计划、施工准备与资源配置计划、主要施工方法、施工现场平面布置及主要施工管理计划等。',
    difficulty: 3,
    source: '二建管理-样题'
  },
  {
    id: 106,
    category_id: 11,
    type: 'judge',
    stem: '建设单位未取得施工许可证擅自施工的，责令停止施工，可以并处以罚款。（ ）',
    options: [
      { key: '对', text: '对' },
      { key: '错', text: '错' }
    ],
    answer: ['对'],
    analysis: '依据《建筑法》第六十四条，未取得施工许可证或者开工报告未经批准擅自施工的，责令改正/责令停止施工，可以处以罚款。',
    difficulty: 1,
    source: '二建法规-样题'
  },
  {
    id: 107,
    category_id: 21,
    type: 'essay',
    stem: '简述施工进度计划编制的主要步骤，并说明其中的关键控制点。',
    options: [],
    // 问答题的 answer 只存一条参考答案全文
    answer: ['① 收集资料：合同工期、施工图、定额、资源供应条件；② 划分施工过程：按分部分项工程拆解，粒度与管理需求匹配；③ 计算工程量与劳动量：依据定额换算工日/台班；④ 确定持续时间：结合作业面、班组数量与流水节拍；⑤ 编制初始进度计划：绘制横道图或双代号网络图；⑥ 检查与优化：核对总工期、关键线路与资源均衡性，必要时压缩关键工作；⑦ 交底与动态调整：执行中按实际进度纠偏。关键控制点是第 ④ 步的持续时间估算与第 ⑥ 步的关键线路识别——前者决定计划是否可行，后者决定压缩工期时资源该往哪儿投。'],
    // 自评时提示「答到没答到」的采分点
    keywords: ['收集资料', '划分施工过程', '计算工程量', '持续时间', '网络图', '关键线路', '资源均衡', '动态调整'],
    analysis: '本题考查施工进度计划编制流程。按「资料→拆解→算量→定时→成图→优化→执行」七步展开即可拿到主要分数，能点出关键线路与资源均衡属于加分项。',
    difficulty: 4,
    source: '二建管理-样题'
  }
]

module.exports = { categories, questions }
