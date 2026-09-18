import type { Annotation } from '../types'
import type { ConflictItem } from '../lib/conflicts'
import type { CoverageResult } from '../lib/coverage'
import { buildReviewReport, reviewReportFileName } from '../lib/report'

interface Props {
  title: string
  text: string
  annotations: Annotation[]
  /** 当前冲突检测结果（含已忽略项；报告只列出未忽略冲突） */
  conflicts: ConflictItem[]
  /** 当前覆盖审计结果 */
  coverageResult: CoverageResult
  coverageTags: string[]
}

/** 触发浏览器下载（自包含 HTML） */
function downloadHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** 审阅报告侧栏分区：以当前文档快照生成并下载自包含 HTML 报告（只读，不改数据） */
export function ReportSection(props: Props) {
  const pendingCount = props.annotations.filter((a) => a.status === 'pending').length
  const activeConflictCount = props.conflicts.filter((c) => !c.ignored).length
  const coverageIssueCount =
    props.coverageResult.gapCount + props.coverageResult.overlapCount

  const generate = () => {
    const now = Date.now()
    // 只读取当前状态生成快照，不触发任何 setDoc / 本地写入
    const html = buildReviewReport({
      title: props.title,
      text: props.text,
      annotations: props.annotations,
      conflicts: props.conflicts,
      coverage: props.coverageResult,
      coverageTags: props.coverageTags,
      generatedAt: now,
    })
    downloadHtml(reviewReportFileName(props.title, now), html)
  }

  return (
    <section className="side-section">
      <h2 className="side-heading">审阅报告</h2>
      <p className="side-hint">
        以<strong>当前文档快照</strong>生成一份自包含 HTML 报告：开头汇总标注总数、待处理数、
        冲突数与覆盖问题数；正文按原文位置渲染已绑定标注的高亮、引文、标签与备注，
        并列出待处理标注与冲突双方。只读生成，<strong>不修改本地数据</strong>。
      </p>
      <p className="side-hint">
        当前共 <strong>{props.annotations.length}</strong> 条标注（
        <strong>{pendingCount}</strong> 条待处理） ·{' '}
        <strong>{activeConflictCount}</strong> 条冲突 ·{' '}
        <strong>{coverageIssueCount}</strong> 处覆盖问题
      </p>
      <button
        type="button"
        className="btn btn-small btn-primary"
        onClick={generate}
        disabled={!props.text}
        title={props.text ? '生成并下载 HTML 审阅报告' : '请先粘贴原文'}
      >
        生成并下载 HTML 报告
      </button>
    </section>
  )
}
