import type { Mounted } from 'claude-code/testing'

export const VIEWPORT = { columns: 120, rows: 40 }

const CHUNK = 30

/** Mục tiêu của từng dòng lưới (`c:<hash>` / `f:<index>` / ''), theo thứ tự dòng. */
export const gridTargets = async (ui: Mounted<'desktop', 'Pane'>) =>
  [...JSON.stringify(await ui.drawn()).matchAll(/"target":"([^"]*)"/g)].map(m => m[1] ?? '')

/** Bấm vào dòng lưới có mục tiêu `target`: khối `grid` (có tiêu đề ở dòng 0), `grid-1`, `grid-2`… */
export const clickGraph = async (ui: Mounted<'desktop', 'Pane'>, target: string) => {
  const targets = await gridTargets(ui)
  const row = targets.indexOf(target)
  if (row < 0) throw new Error(`no graph row for ${target}: ${targets.join(',')}`)
  const k = Math.floor(row / CHUNK)
  const at = { x: 40, y: (row % CHUNK) + (k === 0 ? 1 : 0), button: 'left' as const, in: k === 0 ? 'grid' : `grid-${k}` }
  await ui.pointer({ type: 'down', ...at })
  await ui.pointer({ type: 'up', ...at })
}

/** Bấm nút trên thanh Client (desktop) theo nhãn: tính vị trí như toolbar.tsx (rộng label+2, cách 1). */
export const pressToolbar = async (ui: Mounted<'desktop', 'Pane'>, label: string) => {
  const tree = JSON.stringify(await ui.drawn())
  const buttons = JSON.parse(/"buttons":(\[[^\]]*\])/.exec(tree)?.[1] ?? '[]') as { id: string; label: string }[]
  let x = 0
  for (const b of buttons) {
    if (b.label === label) {
      const at = { x: x + 1, y: 0, button: 'left' as const, in: 'toolbar' }
      await ui.pointer({ type: 'down', ...at })
      await ui.pointer({ type: 'up', ...at })
      return
    }
    x += b.label.length + 3
  }
  throw new Error(`no toolbar button ${label}: ${buttons.map(b => b.label).join(',')}`)
}

/** Bấm vào dòng có mục tiêu `target` trên lớp bấm của chế độ "Image" (mỗi dòng SVG = 1 ô). */
export const clickImage = async (ui: Mounted<'desktop', 'Pane'>, target: string) => {
  const tree = JSON.stringify(await ui.drawn())
  const targets = JSON.parse(/"targets":(\[[^\]]*\])/.exec(tree)?.[1] ?? '[]') as string[]
  const row = targets.indexOf(target)
  if (row < 0) throw new Error(`no image row for ${target}: ${targets.join(',')}`)
  const at = { x: 40, y: row, button: 'left' as const, in: 'grid-img' }
  await ui.pointer({ type: 'down', ...at })
  await ui.pointer({ type: 'up', ...at })
}
