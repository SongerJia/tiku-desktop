# 代码审计 · 轮 4：首页 / 统计 / 我的（页面维度）

> 审计时间：2026-08-14 · 范围：`Home.vue / Stats.vue / Profile.vue`（关键逻辑）+ `achievements.js / celebrate.js / appearance.js / toast.js / confirm.js / tilt.js / useEsc.js / print.js / speech.js`

## 一、发现清单

### 🟠 P2

| # | 位置 | 问题 | 影响 | 建议 |
|---|---|---|---|---|
| P2-20 | celebrate.js L9 | `merged = { ...ach, ...ms }`：getMonthStats.focusMin（**本月**）覆盖 getAchievements.focusMin（**累计**） | 成就墙显示累计专注（Profile 用 getAchievements），庆祝检测用本月 → **同一成就两处口径不一致**，专注成就解锁时机错乱 | celebrate 不用 ms 覆盖 focusMin（或成就墙也按本月） |
| P2-21 | achievements.js L42 | `wrongClear`（错题毕业）metric 复用 `mastered`（=答对过的题数，非从错题本毕业数） | 成就语义错误：显示的"错题毕业"实际是答对量；与 masterCount 同 metric 联动 | 后端加 `wrongGraduated` 指标（status 从 wrong→mastered 的计数） |
| P2-22 | achievements.js L49 | `questCheck` 用 habitChecks（习惯功能已砍，恒 0） | quest 系列 4 档**永久灰**，UI 上永远是 0/5 | 删除 questCheck 成就（或换 quest XP 领取次数指标） |

### 🟡 P3

| # | 位置 | 问题 |
|---|---|---|
| P3-22 | achievements.js L70 | fmtText 显示当前档阈值（已达标仍显示 `/1000` 而非下一档） |
| P3-23 | confirm.js L15-24 | resolver 单例——连续 showConfirm 会覆盖，前一个 Promise 永不 resolve |
| P3-24 | tilt.js / Home.vue L143-159 | vTilt **两处重复定义**（utils 与 Home 内联同逻辑）；指令卸载不清理 mousemove 监听 |
| P3-25 | print.js | title/bodyHtml 未转义拼接 document.write（题干含 `</script>` 可注入打印窗口，本地场景影响小） |
| P3-26 | Profile/Stats/BankManager/ImportWizard | toast 类 setTimeout 卸载未清理（Vue3 无害，规范问题） |

### ✅ 验证通过
- notifyNew / notifyLevelUp 首次调用只记录基线不弹（防老数据刷屏）✓
- toast 全局单例 + 防抖 ✓；useEsc 挂载/卸载成对 ✓
- 成就档位单调性 ✓（P2-21 是语义错，非单调错）
- Home/Stats 的 3D 倾斜、热力图浮层（--tip-bg 语义变量）主题适配 ✓
- Profile 无全局事件监听泄漏（无 addEventListener 残留）

## 二、汇总（累计 4 轮）

- 轮 4：P2×3 · P3×5
- 累计：P1×3（P1-1 修正为 review_logs 同步）· **P2×22** · **P3×26**
- 成就系统 3 处口径/语义问题（focusMin 覆盖、wrongClear 复用 metric、questCheck 死成就）是轮 4 核心
