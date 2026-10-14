/**
 * Lớp trong suốt đè lên ảnh SVG (chế độ "Ảnh"): Svg là ảnh tĩnh, không nhận chuột. Mỗi dòng SVG
 * cao đúng 1 ô chữ (CELL_PX.h) và lớp này cao đúng số dòng (đặt bằng số, không "100%"), nên ô
 * bấm `y` chính là dòng graph `y`. Gửi click cùng dạng với lưới (GridMessage).
 */
import type { ClientModule } from 'claude-code'

import type { GridMessage } from './grid'

export type ImgHitProps = { targets: string[] }

type ImgHitState = { downRow?: number }

const ImgHit: ClientModule<ImgHitProps, ImgHitState> = (props, surface) => {
  const { Box } = surface.elements
  surface.onPointer(ev => {
    if (ev.button !== 'left') return
    if (ev.type === 'down') surface.setState({ downRow: ev.y })
    else if (ev.type === 'up') {
      const target = surface.state?.downRow === ev.y ? props.targets[ev.y] : undefined
      surface.setState({})
      if (target) {
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
        surface.post({ click: { target, id } } satisfies GridMessage)
      }
    }
  })
  return <Box width="100%" height={props.targets.length} />
}

export default ImgHit
