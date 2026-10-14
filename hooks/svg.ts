/**
 * Vẽ graph thành một SVG: nét cong màu theo nhánh + chấm commit, chữ (hash, ref badge, message,
 * author, ngày) cùng hàng trong cùng ảnh nên không bao giờ lệch hàng. Dòng file của commit đang
 * mở nằm chèn ngay dưới commit, các nhánh chạy xuyên qua.
 */
import type { Row } from './parse'
import { STATUS_COLOR } from './parse'

const DEFAULT_ROW_H = 26
const CELL_W = 10
const PAD_X = 6
const CHAR_W = 7.3
const MONO_W = 8.0
const MAX_REFS = 3
const MIN_DESC_W = 220
const MAX_AUTHOR_W = 130
const DATE_W = 100
/** Bề rộng khi không biết pane rộng bao nhiêu. */
const DEFAULT_MAX_W = 900

const LANES = ['#4fc1ff', '#c586c0', '#4ec9b0', '#d7ba7d', '#f48771', '#89d185', '#ce9178', '#9cdcfe']

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const laneColor = (c: number) => LANES[Math.floor(c / 2) % LANES.length] ?? LANES[0]

const badgeColor = (ref: string) => {
  if (ref.startsWith('HEAD')) return '#4fc1ff'
  if (ref.startsWith('tag: ')) return '#e2c08d'
  if (ref.startsWith('origin/')) return '#f14c4c'
  if (ref.startsWith('+')) return '#888888'
  return '#89d185'
}

/** Nhánh trước tag; quá MAX_REFS thì gom thành "+N" (tooltip của dòng vẫn có đủ). */
const badgesOf = (refs: string[]) => {
  const ordered = [...refs].sort((a, b) => Number(a.startsWith('tag: ')) - Number(b.startsWith('tag: ')))
  const extra = ordered.length - MAX_REFS
  return extra > 0 ? [...ordered.slice(0, MAX_REFS), `+${extra}`] : ordered
}

const badgeW = (ref: string) => ref.replace(/^HEAD -> /, '→ ').length * 6.8 + 12

/** Svg nhận tối đa 131072 ký tự; vượt thì bớt dòng cuối tới khi vừa. */
const MAX_SOURCE = 130000

/**
 * `maxWidth`: bề rộng pane (px) — SVG rộng hơn sẽ bị thu nhỏ cả ảnh (chữ nhỏ theo), nên co cột
 * mô tả trước, rồi bỏ cột ngày, rồi cột author cho vừa.
 */
/** Tuỳ chọn vẽ: bề rộng pane, chiều cao dòng (khớp ô chữ để bấm trúng dòng), độ rộng cột người dùng kéo. */
export type SvgOptions = { maxWidth?: number; rowH?: number; descW?: number; authorW?: number }
export type SvgLayout = { textX: number; descW: number; authorW: number; dateW: number; rowH: number; rows: number }
export type SvgOut = { source: string; width: number; height: number; layout: SvgLayout }

export const renderGraphSvg = (rows: Row[], opts: SvgOptions = {}): SvgOut => {
  let shown = rows
  let out = drawSvg(shown, opts)
  while (out.source.length > MAX_SOURCE && shown.length > 1) {
    shown = shown.slice(0, Math.floor(shown.length * 0.85))
    out = drawSvg(shown, opts)
  }
  return out
}

const drawSvg = (rows: Row[], opts: SvgOptions): SvgOut => {
  const maxWidth = opts.maxWidth ?? DEFAULT_MAX_W
  const ROW_H = opts.rowH ?? DEFAULT_ROW_H
  const cols = Math.max(1, ...rows.map(r => r.graph.length))
  const textX = PAD_X + (cols + 1) * CELL_W
  const height = rows.length * ROW_H
  const cx = (c: number) => PAD_X + c * CELL_W + CELL_W / 2
  const at = (r: number, c: number) => rows[r]?.graph[c] ?? ' '
  const vertical = (ch: string) => ch === '|' || ch === '*'

  // Độ rộng cột mô tả / author theo nội dung, có trần; phần thừa bị clip.
  let descW = 0
  let authorW = 0
  for (const row of rows) {
    if (row.kind !== 'commit') continue
    const { hash, refs, subject, author } = row.commit
    const w = hash.length * MONO_W + 8 + badgesOf(refs).reduce((s, ref) => s + badgeW(ref) + 5, 0) + subject.length * CHAR_W
    descW = Math.max(descW, w)
    authorW = Math.max(authorW, author.length * CHAR_W)
  }
  authorW = opts.authorW ?? Math.min(MAX_AUTHOR_W, Math.ceil(authorW))
  let dateW = DATE_W
  const room = () => maxWidth - textX - PAD_X - (authorW > 0 ? authorW + 16 : 0) - (dateW > 0 ? dateW + 16 : 0)
  if (opts.descW === undefined && room() < MIN_DESC_W) dateW = 0
  if (opts.descW === undefined && opts.authorW === undefined && room() < MIN_DESC_W) authorW = 0
  // Chưa kéo cột: cột mô tả lấp hết chỗ trống để graph full width.
  descW = opts.descW ?? Math.max(MIN_DESC_W, Math.floor(room()))
  const authorX = textX + descW + 16
  const dateX = authorX + (authorW > 0 ? authorW + 16 : 0)
  const width = Math.ceil(dateX + (dateW > 0 ? dateW : -16) + PAD_X)

  const paths: string[] = []
  const dots: string[] = []
  const texts: string[] = []

  rows.forEach((row, r) => {
    const top = r * ROW_H
    const mid = top + ROW_H / 2
    const bottom = top + ROW_H
    for (let c = 0; c < row.graph.length; c++) {
      const ch = row.graph[c]
      const color = laneColor(c)
      const stroke = `stroke="${color}"`
      if (ch === '|') {
        paths.push(`<path d="M${cx(c)} ${top}V${bottom}" ${stroke}/>`)
      } else if (ch === '*') {
        const up = r > 0 && (vertical(at(r - 1, c)) || at(r - 1, c - 1) === '\\' || at(r - 1, c + 1) === '/')
        const down =
          r < rows.length - 1 && (vertical(at(r + 1, c)) || at(r + 1, c + 1) === '\\' || at(r + 1, c - 1) === '/')
        if (up) paths.push(`<path d="M${cx(c)} ${top}V${mid}" ${stroke}/>`)
        if (down) paths.push(`<path d="M${cx(c)} ${mid}V${bottom}" ${stroke}/>`)
        const isHead = row.kind === 'commit' && row.commit.refs.some(ref => ref.startsWith('HEAD'))
        dots.push(
          isHead
            ? `<circle cx="${cx(c)}" cy="${mid}" r="4.5" class="bg" stroke="${color}" stroke-width="2.5"/>`
            : `<circle cx="${cx(c)}" cy="${mid}" r="4" fill="${color}"/>`,
        )
      } else if (ch === '/' || ch === '\\') {
        // '/' nối cột phải (trên) xuống cột trái (dưới); '\' ngược lại. Đường cong S như VS Code.
        const [x1, x2] = ch === '/' ? [cx(c + 1), cx(c - 1)] : [cx(c - 1), cx(c + 1)]
        paths.push(`<path d="M${x1} ${top}C${x1} ${mid} ${x2} ${mid} ${x2} ${bottom}" ${stroke}/>`)
      } else if (ch === '_' || ch === '-') {
        paths.push(`<path d="M${PAD_X + c * CELL_W} ${bottom}H${PAD_X + (c + 1) * CELL_W}" ${stroke}/>`)
      }
    }

    const baseline = mid + 4
    // Badge vừa dòng (dòng 19px ở chế độ Ảnh có lớp bấm).
    const badgeH = Math.min(18, ROW_H - 4)
    if (row.kind === 'commit') {
      const { hash, refs, subject, author, date } = row.commit
      const parts: string[] = []
      let x = textX
      parts.push(`<text x="${x}" y="${baseline}" class="hash">${esc(hash)}</text>`)
      x += hash.length * MONO_W + 8
      for (const ref of badgesOf(refs)) {
        const label = ref.replace(/^HEAD -> /, '→ ')
        const w = badgeW(ref)
        const color = badgeColor(ref)
        parts.push(
          `<rect x="${x}" y="${mid - badgeH / 2}" width="${w}" height="${badgeH}" rx="4" fill="${color}" fill-opacity="0.18" stroke="${color}"/>`,
          `<text x="${x + 5}" y="${baseline - 0.5}" class="ref" fill="${color}">${esc(label)}</text>`,
        )
        x += w + 5
      }
      parts.push(`<text x="${x + 2}" y="${baseline}" class="msg">${esc(subject)}</text>`)
      const tip = `${hash} ${refs.length ? `(${refs.join(', ')}) ` : ''}${subject}\n${author} · ${date}`
      texts.push(
        `<g><title>${esc(tip)}</title>` +
          `<rect x="0" y="${top}" width="100%" height="${ROW_H}" class="${row.open ? 'row open' : 'row'}"/>` +
          `<g clip-path="url(#desc)">${parts.join('')}</g>` +
          (authorW > 0
            ? `<text x="${authorX}" y="${baseline}" class="meta" clip-path="url(#author)">${esc(author)}</text>`
            : '') +
          (dateW > 0 ? `<text x="${dateX}" y="${baseline}" class="meta">${esc(date)}</text>` : '') +
          '</g>',
      )
    } else if (row.kind === 'file') {
      const color = STATUS_COLOR[row.file.status] ?? '#888888'
      texts.push(
        `<g><title>${esc(row.file.path)}</title><rect x="0" y="${top}" width="100%" height="${ROW_H}" class="row file"/>` +
          `<text x="${textX + 12}" y="${baseline}" class="st" fill="${color}">${esc(row.file.status)}</text>` +
          `<text x="${textX + 28}" y="${baseline}" class="path">${esc(row.file.path)}</text></g>`,
      )
    } else if (row.kind === 'note') {
      texts.push(
        `<rect x="0" y="${top}" width="100%" height="${ROW_H}" class="row file"/>` +
          `<text x="${textX + 12}" y="${baseline}" class="meta">${esc(row.text)}</text>`,
      )
    }
  })

  const style = [
    'text{font:13px ui-sans-serif,system-ui,-apple-system,sans-serif;fill:#333}',
    '.hash{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#9a6e1a}',
    '.ref{font:600 11.5px ui-sans-serif,system-ui,sans-serif}',
    '.meta{fill:#888}',
    '.st{font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.path{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.bg{fill:#fff}',
    '.row{fill:transparent}',
    '.row:hover{fill:rgba(127,127,127,.12)}',
    '.open,.file{fill:rgba(79,193,255,.10)}',
    '@media (prefers-color-scheme: dark){text{fill:#ccc}.hash{fill:#d7ba7d}.meta{fill:#8b8b8b}.bg{fill:#1e1e1e}}',
  ].join('')
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><clipPath id="desc"><rect x="${textX}" y="0" width="${descW}" height="${height}"/></clipPath>` +
    `<clipPath id="author"><rect x="${authorX}" y="0" width="${authorW}" height="${height}"/></clipPath></defs>` +
    `<style>${style}</style>` +
    texts.join('') +
    `<g fill="none" stroke-width="2" stroke-linecap="round">${paths.join('')}</g>` +
    dots.join('') +
    '</svg>'
  return { source, width, height, layout: { textX, descW, authorW, dateW, rowH: ROW_H, rows: rows.length } }
}
