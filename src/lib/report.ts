// 审阅报告：把当前文档快照渲染为一份自包含 HTML 报告
//
// 报告内容：
//   - 开头汇总：标注总数、待处理数、冲突数（未忽略）与覆盖问题数（缺口 + 重叠）；
//   - 原文高亮：按原文位置把已绑定标注渲染为彩色高亮（配色与标注台一致），
//     悬停可查看该处叠加标注的标签与备注；
//   - 标注明细：已绑定标注按原文位置排列，逐条列出引文、标签与备注；
//   - 待处理列表：全部待处理标注及其待处理原因；
//   - 冲突双方：未忽略冲突逐条列出命中规则、双方引文/标签/备注与交叠原文。
//
// 纯函数：只读取传入数据，不做任何修改（调用方据此保证「生成报告不改本地数据」）；
// 生成的 HTML 内联全部样式、不含任何脚本与外部引用，可离线单文件打开。

import type { Annotation } from '../types'
import type { ConflictItem } from './conflicts'
import type { CoverageResult } from './coverage'
import { badgeColor, blendedColor, buildSegments } from './segments'

export interface ReviewReportInput {
  title: string
  text: string
  annotations: Annotation[]
  /** 冲突检测结果（含已忽略项；报告只统计 / 列出未忽略冲突） */
  conflicts: ConflictItem[]
  /** 覆盖审计结果（未选择覆盖标签时各项为 0，报告中标注「未选择覆盖标签」） */
  coverage: CoverageResult
  coverageTags: string[]
  /** 生成时刻（毫秒时间戳），用于页首信息与文件名 */
  generatedAt: number
}

/** HTML 特殊字符转义（文本节点与属性值通用） */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 报告文件名：审阅报告_{标题清洗}_{日期}.html（清洗规则与导出 JSON 一致） */
export function reviewReportFileName(title: string, generatedAt: number): string {
  const safe = title.replace(/[\\/:*?"<>|\s]+/g, '_') || '未命名文档'
  const date = new Date(generatedAt).toISOString().slice(0, 10)
  return `审阅报告_${safe}_${date}.html`
}

// ---------- 片段渲染 ----------

function tagsHtml(tags: string[]): string {
  if (tags.length === 0) return '<span class="none">（无标签）</span>'
  return tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')
}

function quoteHtml(quote: string): string {
  return `<blockquote class="quote">${
    quote ? escapeHtml(quote) : '<span class="none">（空引文）</span>'
  }</blockquote>`
}

function noteHtml(note: string): string {
  return note
    ? `<p class="note">${escapeHtml(note)}</p>`
    : '<p class="note none">（无备注）</p>'
}

/** 原文 + 已绑定标注高亮；悬停提示为该处叠加标注的标签与备注摘要 */
function textHtml(text: string, bound: Annotation[]): string {
  if (!text) return '<p class="none">（无原文）</p>'
  const byId = new Map(bound.map((a) => [a.id, a]))
  const segments = buildSegments(
    text.length,
    bound
      .filter((a) => a.end > a.start)
      .map((a) => ({ start: a.start, end: a.end, id: a.id })),
  )
  const parts: string[] = []
  for (const seg of segments) {
    const slice = escapeHtml(text.slice(seg.start, seg.end))
    if (seg.annotationIds.length === 0) {
      parts.push(`<span>${slice}</span>`)
      continue
    }
    const tip = seg.annotationIds
      .map((id) => {
        const a = byId.get(id)!
        const tags =
          a.tags.length > 0 ? a.tags.map((t) => `#${t}`).join(' ') : '（无标签）'
        const note = a.note.replace(/\s+/g, ' ').trim()
        return note ? `${tags} · ${note.slice(0, 60)}` : tags
      })
      .join('\n')
    parts.push(
      `<mark class="hl" style="background-color:${blendedColor(
        seg.annotationIds,
      )}" title="${escapeHtml(tip)}">${slice}</mark>`,
    )
  }
  return `<article class="text">${parts.join('')}</article>`
}

/** 标注明细卡片：位置、标签、引文、备注 */
function detailHtml(a: Annotation, index: number): string {
  return [
    '<div class="ann">',
    `<div class="ann-head"><span class="idx">#${index}</span>` +
      `<span class="dot" style="background-color:${badgeColor(a.id)}"></span>` +
      `<span class="range">[${a.start}, ${a.end})</span>` +
      tagsHtml(a.tags) +
      '</div>',
    quoteHtml(a.quote),
    noteHtml(a.note),
    '</div>',
  ].join('')
}

/** 待处理标注卡片：标签、引文、待处理原因、备注 */
function pendingHtml(a: Annotation): string {
  return [
    '<div class="ann ann-pending">',
    `<div class="ann-head"><span class="flag">待绑定</span>` +
      `<span class="dot" style="background-color:${badgeColor(a.id)}"></span>` +
      tagsHtml(a.tags) +
      '</div>',
    quoteHtml(a.quote),
    a.pendingReason ? `<p class="reason">原因：${escapeHtml(a.pendingReason)}</p>` : '',
    noteHtml(a.note),
    '</div>',
  ].join('')
}

/** 冲突一方：标签、引文、备注（ConflictItem 只携带 BoundAnnotation，引文/备注按 ID 回查） */
function sideHtml(side: ConflictItem['a'], full: Annotation | undefined): string {
  return [
    '<div class="side">',
    `<div class="ann-head"><span class="dot" style="background-color:${badgeColor(
      side.id,
    )}"></span>${tagsHtml(side.tags)}</div>`,
    quoteHtml(full?.quote ?? ''),
    noteHtml(full?.note ?? ''),
    '</div>',
  ].join('')
}

/** 一条冲突：命中规则、双方卡片、交叠原文 */
function conflictHtml(
  c: ConflictItem,
  text: string,
  annById: Map<string, Annotation>,
): string {
  const rules = c.rules
    .map((r) => `<span class="rule">${escapeHtml(r.tagA)} ⇄ ${escapeHtml(r.tagB)}</span>`)
    .join('')
  const overlap = escapeHtml(text.slice(c.overlapStart, c.overlapEnd))
  return [
    '<div class="conflict">',
    `<div class="rules">${rules}</div>`,
    `<div class="sides">${sideHtml(c.a, annById.get(c.a.id))}<div class="vs">⇄</div>${sideHtml(
      c.b,
      annById.get(c.b.id),
    )}</div>`,
    `<p class="overlap">交叠 [${c.overlapStart}, ${c.overlapEnd})：「${overlap}」</p>`,
    '</div>',
  ].join('')
}

// ---------- 内联样式（自包含，无外部引用） ----------

const REPORT_CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #f4f5f7; color: #1f2329; line-height: 1.6;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif; }
.report { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
.report-head h1 { font-size: 22px; margin: 0 0 6px; }
.report-meta { color: #5f6672; font-size: 13px; margin: 2px 0; }
.stats { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
.stat { flex: 1; min-width: 150px; background: #fff; border: 1px solid #e3e6eb;
  border-radius: 10px; padding: 12px 16px; }
.stat-num { display: inline-block; font-size: 26px; font-weight: 700; }
.stat-label { margin-left: 6px; color: #5f6672; font-size: 13px; }
.stat-sub { display: block; color: #8f96a3; font-size: 12px; margin-top: 2px; }
section { background: #fff; border: 1px solid #e3e6eb; border-radius: 10px;
  padding: 20px 24px; margin-top: 20px; }
h2 { font-size: 17px; margin: 0 0 10px; }
.sec-sub { font-size: 12.5px; color: #8f96a3; font-weight: 400; margin-left: 8px; }
.sec-note { font-size: 12.5px; color: #8f96a3; margin: 0 0 8px; }
.text { white-space: pre-wrap; line-height: 2; font-size: 15px; }
.hl { padding: 1px 0; border-radius: 3px; box-shadow: inset 0 -2px 0 rgba(0,0,0,.12); }
.ann { border: 1px solid #e3e6eb; border-radius: 8px; padding: 10px 14px; margin-top: 10px; }
.ann-pending { border-style: dashed; border-color: #f0c36d; background: #fffaf0; }
.ann-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.idx { color: #8f96a3; font-size: 12px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.range { color: #8f96a3; font-size: 12px; font-variant-numeric: tabular-nums; }
.flag { background: #fff; border: 1px solid #f0c36d; color: #b26a00;
  border-radius: 6px; padding: 0 6px; font-size: 12px; }
.tag { background: #eef2ff; color: #2f6bff; border-radius: 6px;
  padding: 1px 8px; font-size: 12px; }
.quote { margin: 8px 0 0; padding: 6px 12px; border-left: 3px solid #e3e6eb;
  background: #fafbfc; white-space: pre-wrap; }
.note { margin: 6px 0 0; color: #5f6672; white-space: pre-wrap; }
.reason { margin: 6px 0 0; color: #b26a00; font-size: 13px; }
.none { color: #8f96a3; }
.ok { color: #1a9e54; }
.conflict { border: 1px solid #f0c36d; background: #fffaf0;
  border-radius: 8px; padding: 12px 16px; margin-top: 10px; }
.rules { display: flex; gap: 8px; flex-wrap: wrap; }
.rule { background: #fff; border: 1px solid #f0c36d; border-radius: 999px;
  padding: 1px 10px; font-size: 12px; color: #b26a00; }
.sides { display: flex; gap: 12px; margin-top: 10px; align-items: stretch; }
.side { flex: 1; min-width: 0; background: #fff; border: 1px solid #e3e6eb;
  border-radius: 8px; padding: 8px 12px; }
.vs { align-self: center; color: #b26a00; font-weight: 700; }
.overlap { margin: 10px 0 0; font-size: 13px; color: #5f6672; }
footer { color: #8f96a3; font-size: 12px; text-align: center; margin-top: 24px; }
@media print { body { background: #fff; } section, .stat, .ann, .conflict { break-inside: avoid; } }
`

/**
 * 生成自包含 HTML 审阅报告。
 * 输入为当前文档快照（标注、冲突检测与覆盖审计结果），函数不修改任何传入数据。
 */
export function buildReviewReport(input: ReviewReportInput): string {
  const { title, text, annotations, conflicts, coverage, coverageTags, generatedAt } = input

  // filter 返回新数组，sort 不会改动传入的 annotations
  const bound = annotations
    .filter((a) => a.status === 'bound')
    .sort((x, y) => x.start - y.start || x.end - y.end || x.id.localeCompare(y.id))
  const pending = annotations
    .filter((a) => a.status === 'pending')
    .sort((x, y) => y.updatedAt - x.updatedAt || x.id.localeCompare(y.id))

  const activeConflicts = conflicts.filter((c) => !c.ignored)
  const ignoredCount = conflicts.length - activeConflicts.length
  const coverageIssues = coverage.gapCount + coverage.overlapCount
  const annById = new Map(annotations.map((a) => [a.id, a]))

  const stat = (num: number, label: string, sub: string): string =>
    `<div class="stat"><span class="stat-num">${num}</span>` +
    `<span class="stat-label">${label}</span>` +
    `<span class="stat-sub">${sub}</span></div>`

  const statsHtml = [
    stat(annotations.length, '标注总数', `已绑定 ${bound.length} 条`),
    stat(pending.length, '待处理', '需手动重新绑定'),
    stat(
      activeConflicts.length,
      '冲突',
      `未忽略${ignoredCount > 0 ? ` · 已忽略 ${ignoredCount} 条` : ''}`,
    ),
    stat(
      coverageIssues,
      '覆盖问题',
      coverageTags.length > 0
        ? `缺口 ${coverage.gapCount} · 重叠 ${coverage.overlapCount}`
        : '未选择覆盖标签',
    ),
  ].join('')

  const detailsHtml =
    bound.length > 0
      ? bound.map((a, i) => detailHtml(a, i + 1)).join('')
      : '<p class="none">（暂无已绑定标注）</p>'

  const pendingListHtml =
    pending.length > 0
      ? pending.map(pendingHtml).join('')
      : '<p class="ok">✓ 没有待处理标注。</p>'

  const conflictsHtml =
    activeConflicts.length > 0
      ? activeConflicts.map((c) => conflictHtml(c, text, annById)).join('')
      : '<p class="ok">✓ 当前没有未忽略的冲突。</p>'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>审阅报告 · ${escapeHtml(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="report">
<header class="report-head">
<h1>审阅报告 · ${escapeHtml(title)}</h1>
<p class="report-meta">生成时间：${formatDateTime(generatedAt)} · 原文 ${text.length} 字 · 标注 ${
    annotations.length
  } 条（已绑定 ${bound.length} · 待处理 ${pending.length}）</p>
<p class="report-meta">本报告为生成时刻的文档快照，仅供审阅；生成过程不修改标注台的本地数据。</p>
<div class="stats">${statsHtml}</div>
</header>
<main>
<section>
<h2>原文高亮<span class="sec-sub">已绑定标注按原文位置着色（配色与标注台一致），悬停查看标签与备注</span></h2>
${textHtml(text, bound)}
</section>
<section>
<h2>标注明细<span class="sec-sub">按原文位置排列 · ${bound.length} 条已绑定</span></h2>
${detailsHtml}
</section>
<section>
<h2>待处理标注（${pending.length}）</h2>
${pendingListHtml}
</section>
<section>
<h2>冲突双方（${activeConflicts.length}）</h2>
${
  ignoredCount > 0
    ? `<p class="sec-note">另有 ${ignoredCount} 条冲突已忽略，未列入本节。</p>`
    : ''
}
${conflictsHtml}
</section>
</main>
<footer>由「原文锚点标注台」生成 · ${formatDateTime(
    generatedAt,
  )} · 内容为生成时刻快照，不影响本地数据</footer>
</div>
</body>
</html>
`
}
