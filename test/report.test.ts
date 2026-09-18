import assert from 'node:assert'
import { buildReviewReport, escapeHtml, reviewReportFileName } from '../src/lib/report'
import { detectConflicts } from '../src/lib/conflicts'
import { auditCoverage } from '../src/lib/coverage'
import { blendedColor } from '../src/lib/segments'
import type { Annotation, ConflictRule, IgnoredConflict } from '../src/types'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

// 42 字原文：0-10 数字（含〇）、11-20 天干、21-30 地支、31-41 生肖杂字
const TEXT = '零一二三四五六七八九〇甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥猪鼠牛虎兔龙蛇马羊'
assert.strictEqual(TEXT.length, 42)
// 各标注引文：a1 [0,10) 零一二三四五六七八九；a2 [5,15) 五六七八九〇甲乙丙丁；
// a6 [10,20) 〇甲乙丙丁戊己庚辛壬；a3 [20,30) 癸子丑寅卯辰巳午未申；a8 [25,35) 辰巳午未申酉戌亥猪鼠

let seq = 0
function ann(
  start: number,
  end: number,
  tags: string[],
  overrides: Partial<Annotation> = {},
): Annotation {
  seq += 1
  return {
    id: overrides.id ?? `a${seq}`,
    quote: overrides.quote ?? TEXT.slice(start, end),
    start,
    end,
    note: '',
    tags,
    status: 'bound',
    createdAt: 0,
    updatedAt: 0,
    contextBefore: '',
    contextAfter: '',
    ...overrides,
  }
}

// 已绑定 5 条（a1 正面 / a2 反面 相交 → 活跃冲突；a6 正面 与 a2 相交 → 已忽略冲突；
// a3、a8 命中覆盖标签「主题」并互相交叠）+ 待处理 2 条
const RULE: ConflictRule = { id: 'r1', tagA: '正面', tagB: '反面', createdAt: 0 }
const a1 = ann(0, 10, ['正面'], { id: 'a1', note: '开头很好' })
const a2 = ann(5, 15, ['反面'], { id: 'a2' })
const a6 = ann(10, 20, ['正面'], { id: 'a6', note: '第二段' })
const a3 = ann(20, 30, ['主题'], { id: 'a3', note: '覆盖甲' })
const a8 = ann(25, 35, ['主题'], { id: 'a8', note: '覆盖乙' })
const a4 = ann(0, 0, ['怀旧'], {
  id: 'a4',
  status: 'pending',
  quote: '不存在的引文甲',
  note: '这条丢了',
  pendingReason: '全文找不到引文',
  updatedAt: 2,
})
const a5 = ann(0, 0, [], {
  id: 'a5',
  status: 'pending',
  quote: '不存在的引文乙',
  pendingReason: '多个候选得分并列',
  updatedAt: 1,
})
const ANNOTATIONS = [a1, a2, a6, a3, a8, a4, a5]

const IGNORED: IgnoredConflict[] = [
  { annotationIds: ['a2', 'a6'], ruleIds: ['r1'], createdAt: 0 },
]
const CONFLICTS = detectConflicts(ANNOTATIONS, [RULE], IGNORED)
const COVERAGE_TAGS = ['主题']
const COVERAGE = auditCoverage(ANNOTATIONS, TEXT.length, COVERAGE_TAGS)
const GENERATED_AT = Date.UTC(2026, 8, 18, 10, 30) // 2026-09-18 10:30 UTC

function makeInput() {
  return {
    title: '审阅样例文档',
    text: TEXT,
    annotations: ANNOTATIONS,
    conflicts: CONFLICTS,
    coverage: COVERAGE,
    coverageTags: COVERAGE_TAGS,
    generatedAt: GENERATED_AT,
  }
}

const HTML = buildReviewReport(makeInput())

// 1. 汇总数字：总数 7 / 待处理 2 / 冲突 1（未忽略）/ 覆盖问题 3（缺口 2 · 重叠 1）
check('开头汇总标注总数、待处理数、冲突数与覆盖问题数', () => {
  assert.strictEqual(CONFLICTS.length, 2)
  assert.strictEqual(CONFLICTS.filter((c) => !c.ignored).length, 1)
  assert.strictEqual(COVERAGE.gapCount + COVERAGE.overlapCount, 3)
  assert.ok(HTML.includes('<span class="stat-num">7</span><span class="stat-label">标注总数</span>'))
  assert.ok(HTML.includes('<span class="stat-num">2</span><span class="stat-label">待处理</span>'))
  assert.ok(HTML.includes('<span class="stat-num">1</span><span class="stat-label">冲突</span>'))
  assert.ok(HTML.includes('<span class="stat-num">3</span><span class="stat-label">覆盖问题</span>'))
  assert.ok(HTML.includes('已绑定 5 条'))
  assert.ok(HTML.includes('缺口 2 · 重叠 1'))
  assert.ok(HTML.includes('未忽略 · 已忽略 1 条'))
})

// 2. 原文高亮：按原文位置渲染 mark，颜色与标注台一致，悬停提示含标签与备注
check('原文按位置渲染高亮（配色一致、悬停提示含标签与备注）', () => {
  // [0,5) 仅 a1 → 单色；[5,10) a1+a2 叠加 → 混色
  assert.ok(
    HTML.includes(
      `<mark class="hl" style="background-color:${blendedColor(['a1'])}"`,
    ),
  )
  assert.ok(
    HTML.includes(
      `<mark class="hl" style="background-color:${blendedColor(['a1', 'a2'])}"`,
    ),
  )
  assert.ok(HTML.includes('title="#正面 · 开头很好"'))
  // 待处理标注不参与高亮
  assert.ok(!HTML.includes('title="#怀旧'))
})

// 3. 标注明细按原文位置排列，含引文、标签、备注
check('标注明细按原文位置排列并含引文、标签、备注', () => {
  const start = HTML.indexOf('标注明细')
  assert.ok(start > 0)
  const section = HTML.slice(start, HTML.indexOf('待处理标注（'))
  const i1 = section.indexOf('零一二三四五六七八九')
  const i2 = section.indexOf('五六七八九〇甲乙丙丁')
  const i6 = section.indexOf('〇甲乙丙丁戊己庚辛壬')
  const i3 = section.indexOf('癸子丑寅卯辰巳午未申')
  const i8 = section.indexOf('辰巳午未申酉戌亥猪鼠')
  assert.ok(i1 > 0 && i1 < i2 && i2 < i6 && i6 < i3 && i3 < i8)
  assert.ok(section.includes('<span class="tag">#正面</span>'))
  assert.ok(section.includes('<p class="note">开头很好</p>'))
  assert.ok(section.includes('[0, 10)'))
  // 无备注的 a2 显示占位
  assert.ok(section.includes('（无备注）'))
})

// 4. 待处理列表：引文、原因、标签齐全；空标签显示占位
check('报告列出待处理标注及原因', () => {
  assert.ok(HTML.includes('待处理标注（2）'))
  const section = HTML.slice(HTML.indexOf('待处理标注（'), HTML.indexOf('冲突双方（'))
  assert.ok(section.includes('不存在的引文甲'))
  assert.ok(section.includes('原因：全文找不到引文'))
  assert.ok(section.includes('不存在的引文乙'))
  assert.ok(section.includes('原因：多个候选得分并列'))
  assert.ok(section.includes('（无标签）'))
  // 已绑定标注不出现在待处理区
  assert.ok(!section.includes('零一二三四五六七八九'))
})

// 5. 冲突双方：命中规则、双方引文、交叠原文；已忽略冲突不列出
check('报告列出冲突双方（规则、双方、交叠原文），已忽略冲突不列出', () => {
  assert.ok(HTML.includes('冲突双方（1）'))
  assert.ok(HTML.includes('另有 1 条冲突已忽略，未列入本节'))
  const section = HTML.slice(HTML.indexOf('冲突双方（'))
  assert.ok(section.includes('<span class="rule">正面 ⇄ 反面</span>'))
  assert.ok(section.includes('零一二三四五六七八九'))
  assert.ok(section.includes('五六七八九〇甲乙丙丁'))
  assert.ok(section.includes('交叠 [5, 10)：「五六七八九」'))
  // 双方卡片携带备注（a1 有备注，a2 无备注显示占位）
  assert.ok(section.includes('<p class="note">开头很好</p>'))
  assert.ok(section.includes('（无备注）'))
  // 已忽略的 a2⇄a6 不出现（a6 引文只在明细与高亮区，不在冲突区）
  assert.ok(!section.includes('〇甲乙丙丁戊己庚辛壬'))
})

// 6. HTML 转义：标题 / 引文 / 备注 / 标签中的特殊字符不破坏文档结构
check('标题、引文、备注、标签中的 HTML 特殊字符被转义', () => {
  const evil = ann(0, 4, ['x<y'], {
    id: 'ev1',
    note: '备注<script>alert(1)</script>&"\'',
  })
  const html = buildReviewReport({
    title: '报告<img src=x>',
    text: TEXT,
    annotations: [evil],
    conflicts: [],
    coverage: auditCoverage([evil], TEXT.length, []),
    coverageTags: [],
    generatedAt: GENERATED_AT,
  })
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('<img'))
  assert.ok(html.includes('审阅报告 · 报告&lt;img src=x&gt;'))
  assert.ok(html.includes('备注&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#39;'))
  assert.ok(html.includes('<span class="tag">#x&lt;y</span>'))
  // 自包含：无脚本、无外部样式 / 链接引用
  assert.ok(!html.includes('<link'))
  assert.ok(!html.includes('http://') && !html.includes('https://'))
})

// 7. 文件名：包含清洗后的文档标题与日期
check('文件名包含文档标题与日期，非法字符清洗', () => {
  assert.strictEqual(
    reviewReportFileName('审阅 报告/测试', GENERATED_AT),
    '审阅报告_审阅_报告_测试_2026-09-18.html',
  )
  assert.strictEqual(
    reviewReportFileName('', GENERATED_AT),
    '审阅报告_未命名文档_2026-09-18.html',
  )
})

// 8. 纯函数：同输入输出一致，且不修改传入数据
check('同输入必得同报告，且不修改传入数据', () => {
  const input = makeInput()
  const before = JSON.stringify(input, (k, v) => (v instanceof Map ? [...v] : v))
  const h1 = buildReviewReport(input)
  const h2 = buildReviewReport(input)
  assert.strictEqual(h1, h2)
  const after = JSON.stringify(input, (k, v) => (v instanceof Map ? [...v] : v))
  assert.strictEqual(after, before)
})

// 9. 未选择覆盖标签：汇总标注「未选择覆盖标签」，覆盖问题为 0
check('未配置覆盖标签时汇总显示未选择', () => {
  const html = buildReviewReport({
    ...makeInput(),
    coverage: auditCoverage(ANNOTATIONS, TEXT.length, []),
    coverageTags: [],
  })
  assert.ok(html.includes('<span class="stat-num">0</span><span class="stat-label">覆盖问题</span>'))
  assert.ok(html.includes('未选择覆盖标签'))
})

// 10. 空文档：不崩溃，各分区给出空态
check('空文档也能生成报告（各分区空态）', () => {
  const html = buildReviewReport({
    title: '空文档',
    text: '',
    annotations: [],
    conflicts: [],
    coverage: auditCoverage([], 0, []),
    coverageTags: [],
    generatedAt: GENERATED_AT,
  })
  assert.ok(html.includes('（无原文）'))
  assert.ok(html.includes('（暂无已绑定标注）'))
  assert.ok(html.includes('✓ 没有待处理标注。'))
  assert.ok(html.includes('✓ 当前没有未忽略的冲突。'))
  assert.ok(html.includes('<span class="stat-num">0</span><span class="stat-label">标注总数</span>'))
})

// 11. escapeHtml 全量特殊字符
check('escapeHtml 转义五种特殊字符', () => {
  assert.strictEqual(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;')
})

console.log(`\n全部 ${passed} 项通过`)
