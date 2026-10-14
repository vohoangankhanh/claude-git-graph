/**
 * Đọc output `git log --graph --format=LOG_FORMAT` thành các dòng (commit / dòng nối / file),
 * dùng chung cho cả SVG lẫn bản ký tự khung.
 */
import type { FileChange, OpenCommit } from '../types'

export const SEP = '\x1f'
/** hash · author · ngày · refs (%D, không ngoặc) · subject, cách nhau bằng \x1f. */
export const LOG_FORMAT = ['%h', '%an', '%ad', '%D', '%s'].join('%x1f')
export const DATE_FORMAT = 'format:%d/%m/%y %H:%M'

/** Số file chèn vào graph tối đa — giữ SVG dưới giới hạn 131072 ký tự. */
export const MAX_INLINE_FILES = 40

const GRAPH_CHARS = new Set(['*', '|', '/', '\\', '_', ' ', '.', '-'])

export type Commit = { hash: string; author: string; date: string; refs: string[]; subject: string }

export type Row =
  | { kind: 'commit'; graph: string; commit: Commit; open: boolean }
  | { kind: 'link'; graph: string }
  | { kind: 'file'; graph: string; file: FileChange }
  | { kind: 'note'; graph: string; text: string }

export const parseLine = (line: string): { graph: string; commit?: Commit } => {
  let i = 0
  while (i < line.length && GRAPH_CHARS.has(line[i] ?? '')) i++
  const graph = line.slice(0, i).replace(/\s+$/, '')
  const rest = line.slice(i)
  if (!rest.includes(SEP)) return { graph }
  const [hash = '', author = '', date = '', refs = '', ...subject] = rest.split(SEP)
  return {
    graph,
    commit: { hash, author, date, refs: refs ? refs.split(', ') : [], subject: subject.join(SEP) },
  }
}

/** Cột có nét đi qua mép dưới của dòng `g`. */
const bottomCols = (g: string): Set<number> => {
  const s = new Set<number>()
  for (let c = 0; c < g.length; c++) {
    const ch = g[c]
    if (ch === '|' || ch === '*') s.add(c)
    else if (ch === '\\') s.add(c + 1)
    else if (ch === '/') s.add(c - 1)
  }
  return s
}

/** Cột có nét đi vào mép trên của dòng `g`. */
const topCols = (g: string): Set<number> => {
  const s = new Set<number>()
  for (let c = 0; c < g.length; c++) {
    const ch = g[c]
    if (ch === '|' || ch === '*') s.add(c)
    else if (ch === '\\') s.add(c - 1)
    else if (ch === '/') s.add(c + 1)
  }
  return s
}

/** Graph của dòng chèn giữa `cur` và `next`: chỉ các nét thẳng đi xuyên qua. */
const passThrough = (cur: string, next: string | undefined): string => {
  const down = bottomCols(cur)
  const up = next === undefined ? down : topCols(next)
  const width = Math.max(cur.length, next?.length ?? 0)
  let out = ''
  for (let c = 0; c < width; c++) out += down.has(c) && up.has(c) ? '|' : ' '
  return out.replace(/\s+$/, '')
}

export const parseNameStatus = (stdout: string): FileChange[] =>
  stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [status = '?', ...paths] = line.split('\t')
      return { status: status.charAt(0), path: paths.length > 1 ? paths.join(' → ') : (paths[0] ?? ''), paths }
    })

/** `maxFiles`: số file chèn vào graph (SVG có giới hạn kích thước; lưới desktop thì chèn hết). */
export const buildRows = (lines: string[], open?: OpenCommit, maxFiles = MAX_INLINE_FILES): Row[] => {
  const parsed = lines.map(parseLine)
  const rows: Row[] = []
  parsed.forEach((p, i) => {
    if (!p.commit) {
      rows.push({ kind: 'link', graph: p.graph })
      return
    }
    const isOpen = open?.hash === p.commit.hash
    rows.push({ kind: 'commit', graph: p.graph, commit: p.commit, open: isOpen })
    if (!open || !isOpen) return
    const graph = passThrough(p.graph, parsed[i + 1]?.graph)
    if (open.error) rows.push({ kind: 'note', graph, text: open.error })
    else if (open.files === null) rows.push({ kind: 'note', graph, text: 'loading…' })
    else if (open.files.length === 0) rows.push({ kind: 'note', graph, text: '(no changed files)' })
    else {
      open.files.slice(0, maxFiles).forEach(file => rows.push({ kind: 'file', graph, file }))
      const more = open.files.length - maxFiles
      if (more > 0) rows.push({ kind: 'note', graph, text: `… ${more} more files (see the list above)` })
    }
  })
  return rows
}

export const STATUS_COLOR: Record<string, string> = {
  A: '#73c991',
  M: '#e2c08d',
  D: '#f14c4c',
  R: '#4fc1ff',
  C: '#4fc1ff',
  T: '#c586c0',
}

const MAX_DIFF = 90000

/** Bỏ header (`diff --git`, `index`, `---/+++`) tới hunk đầu; quá dài thì cắt ở ranh giới hunk. */
export const diffHunks = (stdout: string): { text: string; cut: boolean } => {
  const start = stdout.startsWith('@@') ? 0 : stdout.indexOf('\n@@') + 1
  if (start <= 0 && !stdout.startsWith('@@')) return { text: '', cut: false }
  const body = stdout.slice(start)
  if (body.length <= MAX_DIFF) return { text: body.replace(/\n$/, ''), cut: false }
  const end = body.lastIndexOf('\n@@', MAX_DIFF)
  return { text: body.slice(0, end > 0 ? end : MAX_DIFF), cut: true }
}
