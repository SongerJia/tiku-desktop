// 打开独立窗口渲染 printable HTML，并调起系统「打印 / 另存为 PDF」对话框。
// 用独立窗口而非当前 DOM 的 @media print，避免破坏正在进行的答题界面。
// 题干图以 dataURL（base64）内联进 HTML，离线也能正确打印。
export function printHtml(title, bodyHtml, styleHtml) {
  const w = window.open('', '_blank', 'width=820,height=1100')
  if (!w) {
    alert('导出 PDF 需要允许弹出窗口，请在浏览器地址栏放开拦截后重试')
    return
  }
  const base = `
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1a1a1a; padding: 28px 32px; font-size: 13px; line-height: 1.7; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .doc-sub { color: #666; margin: 0 0 18px; font-size: 12px; }
    .q { border: 1px solid #d6d6d6; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; page-break-inside: avoid; }
    .q-no { color: #0a7ea4; font-weight: 700; margin-right: 6px; }
    .q-type { color: #888; font-size: 11px; margin-left: 8px; }
    .q-stem { font-weight: 600; }
    .opts { margin: 8px 0 0 18px; padding: 0; }
    .opts li { margin: 3px 0; }
    .ans-key { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #ccc; color: #0a7ea4; font-weight: 600; }
    .analysis { margin-top: 6px; color: #555; }
    .score-line { float: right; color: #0a7ea4; font-weight: 600; }
    .section-title { font-size: 15px; font-weight: 700; margin: 22px 0 10px; border-left: 4px solid #0a7ea4; padding-left: 8px; }
    img.q-img { max-width: 360px; max-height: 240px; display: block; margin: 8px 0; border: 1px solid #ddd; border-radius: 6px; }
    table.sum { border-collapse: collapse; width: 100%; margin-top: 8px; }
    table.sum th, table.sum td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 12px; }
    @media print { .no-print { display: none; } }
  `
  w.document.open()
  // title 做 HTML 转义防注入；bodyHtml 为产品拼接（调用方负责其字段转义），
  // 仅对 `</script` 兜底转义，防止用户题干中的字面量提前终止脚本块
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const safeBody = String(bodyHtml || '').replace(/<\/script/gi, '<\\/script')
  w.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
    `<style>${base}${styleHtml || ''}</style></head><body>${safeBody}<script>window.onload=function(){setTimeout(function(){window.print();},250);}<\/script></body></html>`
  )
  w.document.close()
  w.focus()
}
