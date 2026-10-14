/**
 * Thanh nút trên desktop, vẽ bằng Client thay cho Button native: sau một cú bấm vào lưới (Client),
 * cú bấm đầu tiên vào Button native bị nuốt (kiểm tra bằng click thật 14/10). Nút trong Client thì
 * bấm liên tiếp với lưới không bị mất.
 */
import type { ClientModule } from 'claude-code'

export type ToolbarProps = {
  buttons: { id: string; label: string }[]
  /** Chữ mờ cuối thanh (giờ cập nhật, file đang xem…). */
  status: string
}

/** `cols`: bề rộng pane theo ô (Client rộng 100%) — viewport.columns của engine nhỏ hơn bề rộng thật. */
export type ToolbarMessage = { press?: { id: string; at: string }; cols?: number }

type ToolbarState = { hover?: string; down?: string }

const timers = new WeakMap<object, { cols: number }>()

const BUTTON_BG = '#3a3d41'
const HOVER_BG = '#4a4e53'
const DOWN_BG = '#0e639c'

/** Mỗi nút rộng `label + 2` ô (lề 1 ô hai bên), cách nhau 1 ô. */
const layout = (buttons: ToolbarProps['buttons']) => {
  let x = 0
  return buttons.map(b => {
    const w = b.label.length + 2
    const span = { ...b, x, w }
    x += w + 1
    return span
  })
}

const Toolbar: ClientModule<ToolbarProps, ToolbarState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const st = surface.state ?? {}
  // Báo bề rộng pane (ô) khi đổi — post bằng timer, không post trong lúc vẽ.
  if (!timers.has(surface)) {
    const memo = { cols: -1 }
    timers.set(surface, memo)
    surface.every(500, () => {
      if (surface.columns > 0 && surface.columns !== memo.cols) {
        memo.cols = surface.columns
        surface.post({ cols: surface.columns } satisfies ToolbarMessage)
      }
    })
  }
  const spans = layout(props.buttons)
  const at = (x: number, y: number) => (y === 0 ? spans.find(s => x >= s.x && x < s.x + s.w)?.id : undefined)

  surface.onPointer(ev => {
    const cur = surface.state ?? {}
    const id = at(ev.x, ev.y)
    if (ev.type === 'down' && ev.button === 'left') surface.setState({ ...cur, down: id })
    else if (ev.type === 'up') {
      surface.setState({ ...cur, down: undefined })
      if (id && id === cur.down) {
        surface.post({ press: { id, at: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` } })
      }
    } else if (ev.type === 'move' && id !== cur.hover) surface.setState({ ...cur, hover: id })
    else if (ev.type === 'leave' && cur.hover) surface.setState({ ...cur, hover: undefined })
  })

  return (
    <Box flexDirection="row" height={1}>
      {spans.map(s => (
        <Box
          width={s.w}
          marginRight={1}
          flexShrink={0}
          backgroundColor={st.down === s.id ? DOWN_BG : st.hover === s.id ? HOVER_BG : BUTTON_BG}
        >
          <Text wrap="truncate">{` ${s.label} `}</Text>
        </Box>
      ))}
      <Text dimColor wrap="truncate">{props.status}</Text>
    </Box>
  )
}

export default Toolbar
