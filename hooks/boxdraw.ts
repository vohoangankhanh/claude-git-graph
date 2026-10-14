/**
 * Đổi phần graph ASCII của git (`| / \ *`) sang ký tự khung kiểu lazygit (`│ ├─╮ ├─╯ ●`).
 * Ký tự chéo của git không chạm mép ô nên nét đứt; ký tự khung luôn chạm mép → nét liền.
 *
 * Mỗi ô giữ một mask hướng nối (lên/xuống/trái/phải); mỗi ký tự git cộng hướng vào ô của nó
 * và ô bên cạnh, cuối cùng mask → ký tự khung. Chỉ cần đúng dòng đó, không cần dòng trên/dưới.
 */
const U = 1
const D = 2
const L = 4
const R = 8

const BOX: Record<number, string> = {
  [U]: '│',
  [D]: '│',
  [U | D]: '│',
  [L]: '─',
  [R]: '─',
  [L | R]: '─',
  [U | D | R]: '├',
  [U | D | L]: '┤',
  [U | R]: '╰',
  [U | L]: '╯',
  [D | R]: '╭',
  [D | L]: '╮',
  [L | R | D]: '┬',
  [L | R | U]: '┴',
  [U | D | L | R]: '┼',
}

/** Một ô sau khi đổi: ký tự + cột lane quyết định màu (undefined = khoảng trắng). */
export type BoxCell = { ch: string; lane?: number; commit?: boolean }

export const boxGraph = (graph: string): BoxCell[] => {
  const n = graph.length + 1
  const mask = new Array<number>(n).fill(0)
  const lane = new Array<number | undefined>(n).fill(undefined)
  const commit = new Array<boolean>(n).fill(false)
  // Màu: nét đứng giữ màu cột của nó; nhánh rẽ/nhập tô màu lane bên phải (nhánh đang tách/nhập).
  const paint = (c: number, l: number, strong: boolean) => {
    if (c < 0 || c >= n) return
    if (strong || lane[c] === undefined) lane[c] = l
  }
  const add = (c: number, bits: number) => {
    if (c >= 0 && c < n) mask[c] = (mask[c] ?? 0) | bits
  }

  for (let c = 0; c < graph.length; c++) {
    const ch = graph[c]
    const own = Math.floor(c / 2)
    if (ch === '*') {
      commit[c] = true
      paint(c, own, true)
    } else if (ch === '|') {
      add(c, U | D)
      paint(c, own, true)
    } else if (ch === '\\') {
      // lane trên ở c-1 tách sang lane dưới ở c+1
      const l = Math.floor((c + 1) / 2)
      add(c - 1, U | R)
      add(c, L | R)
      add(c + 1, L | D)
      ;[c - 1, c, c + 1].forEach(k => paint(k, l, false))
    } else if (ch === '/') {
      // lane trên ở c+1 nhập về lane dưới ở c-1
      const l = Math.floor((c + 1) / 2)
      add(c + 1, U | L)
      add(c, L | R)
      add(c - 1, R | D)
      ;[c - 1, c, c + 1].forEach(k => paint(k, l, false))
    } else if (ch === '_' || ch === '-') {
      add(c, L | R)
      paint(c, own, false)
    }
  }

  // Bỏ ô trống thừa ở cuối (do '\' ở cột cuối thêm 1 ô).
  let end = n
  while (end > 0 && !commit[end - 1] && (mask[end - 1] ?? 0) === 0) end--
  const cells: BoxCell[] = []
  for (let c = 0; c < end; c++) {
    if (commit[c]) cells.push({ ch: '●', lane: lane[c], commit: true })
    else if ((mask[c] ?? 0) === 0) cells.push({ ch: ' ' })
    else cells.push({ ch: BOX[mask[c] ?? 0] ?? '┼', lane: lane[c] })
  }
  return cells
}
