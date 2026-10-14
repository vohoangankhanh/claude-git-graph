/**
 * Graph trên desktop vẽ theo lưới ô chữ trong một Client: tiêu đề cột + mỗi dòng graph đúng 1 ô.
 * Desktop đo Client theo ô còn Svg theo px và không cho biết tỉ lệ, nên lớp bấm đè lên SVG không
 * khớp được; vẽ hết trong lưới ô thì bấm, hover, kéo cột đều trúng tuyệt đối.
 *
 * Chữ trên desktop là font không đều → mọi cột canh bằng Box có `width` theo ô (không đệm dấu
 * cách), kể cả từng ký tự graph.
 */
import type { ClientModule } from 'claude-code'

/** Một đoạn graph: ký tự (hoặc dải dấu cách) + màu. */
export type GridGlyph = [text: string, color: string]

export type GridRow = {
  /** `c:<hash>` / `f:<index>` / '' — gửi về hook khi bấm. */
  target: string
  graph: GridGlyph[]
  kind: 'commit' | 'file' | 'note' | 'link'
  hash?: string
  refs?: [label: string, color: string][]
  text?: string
  textColor?: string
  author?: string
  date?: string
  open?: boolean
  bold?: boolean
}

export type GridProps = {
  rows: GridRow[]
  /** Số ô của phần graph (cột đầu). */
  lead: number
  /** Độ rộng người dùng đã kéo (ô); absent = cột mô tả lấp đầy. */
  colW?: { desc: number; author: number }
  /** Lưới chia nhiều khối (mỗi Client tối đa 100000 ký tự cây); chỉ khối đầu có tiêu đề cột. */
  header: boolean
}

export type GridMessage = {
  click?: { target: string; id: string }
  cols?: { desc: number; author: number }
}

type Sep = 'desc' | 'author'
type GridState = {
  hoverRow?: number
  hoverSep?: Sep
  downRow?: number
  drag?: { sep: Sep; startX: number; desc: number; author: number }
  live?: { desc: number; author: number }
  /** Độ rộng vừa thả, giữ tới khi props mới về — khỏi nháy về giá trị cũ. */
  pending?: { desc: number; author: number }
}

export const MIN_DESC = 15
export const MIN_AUTHOR = 6
const DEFAULT_AUTHOR = 18
const DATE = 15
const HOVER_BG = '#2a2d2e'
const OPEN_BG = '#1d3349'
const TREE_BUDGET = 90000

/**
 * Đường dẫn không có dấu cách: quá dài thì engine đẩy cả chữ xuống dòng sau (bị cắt, dòng trống).
 * Rút gọn ở đầu, giữ phần cuối (tên file) cho vừa cột.
 */
const fitPath = (path: string, max: number) => (path.length <= max || max < 4 ? path : `…${path.slice(path.length - max + 1)}`)

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

const Grid: ClientModule<GridProps, GridState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const st = surface.state ?? {}
  const caughtUp =
    st.pending && props.colW && st.pending.desc === props.colW.desc && st.pending.author === props.colW.author
  if (caughtUp) surface.setState({ ...st, pending: undefined })

  const cols = (st.drag && st.live) || (!caughtUp && st.pending) || props.colW
  const author = cols?.author ?? DEFAULT_AUTHOR
  const room = Math.max(0, surface.columns) - props.lead - author - DATE - 2
  const desc = cols?.desc ?? Math.max(MIN_DESC, room)
  const sepDesc = props.lead + desc
  const sepAuthor = sepDesc + 1 + author
  const nearSep = (x: number): Sep | undefined =>
    Math.abs(x - sepDesc) <= 1 ? 'desc' : Math.abs(x - sepAuthor) <= 1 ? 'author' : undefined

  // Gắn lại mỗi lần vẽ (thay listener cũ) để handler thấy props/độ rộng mới nhất.
  surface.onPointer(ev => {
    const cur = surface.state ?? {}
    const top = props.header ? 1 : 0
    const row = ev.y - top
    if (ev.type === 'down' && ev.button === 'left') {
      const sep = props.header && ev.y === 0 ? nearSep(ev.x) : undefined
      if (sep) surface.setState({ ...cur, drag: { sep, startX: ev.x, desc, author }, live: { desc, author } })
      else surface.setState({ ...cur, downRow: row })
    } else if (ev.type === 'move' && cur.drag) {
      const delta = ev.x - cur.drag.startX
      const live =
        cur.drag.sep === 'desc'
          ? { desc: Math.max(MIN_DESC, cur.drag.desc + delta), author: cur.drag.author }
          : { desc: cur.drag.desc, author: Math.max(MIN_AUTHOR, cur.drag.author + delta) }
      if (live.desc !== cur.live?.desc || live.author !== cur.live?.author) surface.setState({ ...cur, live })
    } else if (ev.type === 'up' && cur.drag) {
      if (cur.live) surface.post({ cols: cur.live } satisfies GridMessage)
      surface.setState({ pending: cur.live })
    } else if (ev.type === 'up') {
      const target = cur.downRow === row ? props.rows[row]?.target : undefined
      surface.setState({ ...cur, downRow: undefined })
      if (target) surface.post({ click: { target, id: newId() } } satisfies GridMessage)
    } else if (ev.type === 'move') {
      const hoverSep = props.header && ev.y === 0 ? nearSep(ev.x) : undefined
      const hoverRow = ev.y >= top && props.rows[row]?.target ? row : undefined
      if (hoverSep !== cur.hoverSep || hoverRow !== cur.hoverRow) surface.setState({ ...cur, hoverSep, hoverRow })
    } else if (ev.type === 'leave' && (cur.hoverRow !== undefined || cur.hoverSep)) {
      surface.setState({ ...cur, hoverRow: undefined, hoverSep: undefined })
    }
  })

  const activeSep = st.drag?.sep ?? st.hoverSep
  const sep = (which: Sep) => (
    <Box width={1} flexShrink={0}>
      <Text color={activeSep === which ? '#4fc1ff' : undefined} dimColor={activeSep !== which}>
        {activeSep === which ? '┃' : '│'}
      </Text>
    </Box>
  )

  const header = (
    <Box flexDirection="row" height={1}>
      <Box width={props.lead} flexShrink={0} />
      <Box width={desc} flexShrink={0}>
        <Text bold dimColor wrap="truncate">
          {st.drag ? `Description  ${desc} · ${author}` : 'Description'}
        </Text>
      </Box>
      {sep('desc')}
      <Box width={author} flexShrink={0}>
        <Text bold dimColor wrap="truncate"> Author</Text>
      </Box>
      {sep('author')}
      <Box width={DATE} flexShrink={0}>
        <Text bold dimColor wrap="truncate"> Date</Text>
      </Box>
    </Box>
  )

  const rowEl = (r: GridRow, i: number) => {
    const bg = r.open && r.kind === 'commit' ? OPEN_BG : st.hoverRow === i ? HOVER_BG : undefined
    return (
      <Box flexDirection="row" height={1} backgroundColor={bg}>
        <Box width={props.lead} flexShrink={0} flexDirection="row">
          {r.graph.map(([text, color]) =>
            text.trim() === '' ? (
              <Box width={text.length} />
            ) : (
              <Box width={1}>
                <Text color={color || undefined}>{text}</Text>
              </Box>
            ),
          )}
        </Box>
        <Box width={desc} flexShrink={0} overflow="hidden">
          <Text wrap="truncate">
            {r.hash ? <Text color={r.kind === 'file' ? r.textColor : '#d7ba7d'}>{`${r.hash} `}</Text> : null}
            {(r.refs ?? []).map(([label, color]) => (
              <Text color={color} bold>{`[${label}] `}</Text>
            ))}
            <Text color={r.kind === 'file' ? undefined : r.textColor} dimColor={r.kind === 'note'}>
              {r.kind === 'file' ? fitPath(r.text ?? '', desc - (r.hash?.length ?? 0) - 2) : (r.text ?? '')}
            </Text>
          </Text>
        </Box>
        {r.author ? (
          <Box width={author} marginLeft={1} flexShrink={0}>
            <Text dimColor wrap="truncate">{` ${r.author}`}</Text>
          </Box>
        ) : null}
        {r.date ? (
          <Box width={DATE} marginLeft={1} flexShrink={0}>
            <Text dimColor wrap="truncate">{` ${r.date}`}</Text>
          </Box>
        ) : null}
      </Box>
    )
  }

  // Cây của Client tối đa 100000 ký tự: vẽ dòng tới khi gần chạm thì dừng, báo số dòng còn lại.
  const out = props.header ? [header] : []
  let size = props.header ? JSON.stringify(header).length : 0
  let shown = 0
  for (const [i, r] of props.rows.entries()) {
    const el = rowEl(r, i)
    size += JSON.stringify(el).length
    if (size > TREE_BUDGET) break
    out.push(el)
    shown++
  }
  if (shown < props.rows.length) {
    out.push(
      <Text dimColor wrap="truncate">{`  … ${props.rows.length - shown} more rows not drawn`}</Text>,
    )
  }

  return <Box flexDirection="column">{out}</Box>
}

export default Grid
