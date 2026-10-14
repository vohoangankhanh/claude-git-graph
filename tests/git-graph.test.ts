import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { clickGraph, clickImage, pressToolbar, VIEWPORT } from './helpers'

const S = '\x1f'
const GRAPH = [
  `* f9c5c3f${S}Alice${S}14/10/26 10:00${S}HEAD -> feature/x${S}Merge main`,
  '|\\',
  `| * 677b60b${S}Bob${S}13/10/26 09:00${S}${S}fix: thing`,
  `* | eaf28fe${S}Alice${S}12/10/26 08:00${S}${S}fix(core): suggest`,
  '',
].join('\n')
const DIFF = 'diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n const x = 1\n-const y = 2\n+const y = 3\n'
const FILES = 'M\tsrc/a.ts\nA\tsrc/b.ts\nR087\told.ts\tnew.ts\n'

const mockGit = (on: Parameters<TestBody>[1], shows: string[][]) => {
  on('process.run', async (_$, e) => {
    if (e.argv[1] === 'show') {
      shows.push([...e.argv])
      const isDiff = e.argv.includes('--')
      return { value: { exitCode: 0, stdout: isDiff ? DIFF : FILES, stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: GRAPH, stderr: '' } }
  })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
}

const mountDesktop = ($: Parameters<TestBody>[0]) =>
  $.ui.mount({
    plugin: 'commit-lanes',
    surface: 'desktop',
    component: 'Pane',
    props: {} as never,
    requestId: 'git-graph',
    viewport: VIEWPORT,
  })

const render = async ($: Parameters<TestBody>[0], surface: 'terminal' | 'desktop') =>
  JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'git-graph', surface } as never))

test('/git-graph shows commits with author and date on terminal and desktop', async ($, on) => {
  const shows: string[][] = []
  mockGit(on, shows)

  const out = await $.command.run({ command: 'git-graph' } as never)
  expect(out).toEqual(expect.objectContaining({ text: 'Git graph pane opened.' }))

  const terminal = await render($, 'terminal')
  for (const piece of ['f9c5c3f', 'HEAD → ', 'feature/x', ' Merge main', '677b60b', 'Bob', '13/10/26 09:00', '●', '├', '╮']) {
    expect(terminal.includes(piece)).toBe(true)
  }
  expect(terminal.includes('<svg')).toBe(false)

  const desktop = await render($, 'desktop')
  for (const piece of ['hooks/grid.tsx', 'f9c5c3f', '→ feature/x', 'Merge main', 'Alice', '12/10/26 08:00', '●', '╮']) {
    expect(desktop.includes(piece)).toBe(true)
  }
})

test('pressing a commit row on the terminal lists its files, pressing again closes', async ($, on) => {
  const shows: string[][] = []
  mockGit(on, shows)
  await $.command.run({ command: 'git-graph' } as never)
  await render($, 'terminal')

  await $.ui.press({ plugin: 'commit-lanes', key: '677b60b', surface: 'terminal' })
  expect(shows[0]?.slice(-1)).toEqual(['677b60b'])
  const opened = await render($, 'terminal')
  for (const piece of ['src/a.ts', 'src/b.ts', 'old.ts → new.ts']) expect(opened.includes(piece)).toBe(true)

  await $.ui.press({ plugin: 'commit-lanes', key: '677b60b', surface: 'terminal' })
  expect((await render($, 'terminal')).includes('src/a.ts')).toBe(false)
})

test('clicking a commit on the desktop grid lists its files inline; no dropdown; Ảnh view still renders', async ($, on) => {
  const shows: string[][] = []
  mockGit(on, shows)
  await $.command.run({ command: 'git-graph' } as never)
  const ui = await mountDesktop($)
  expect(JSON.stringify(await ui.drawn()).includes('"Select"')).toBe(false)

  await clickGraph(ui, 'c:f9c5c3f')
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.includes('src/b.ts')).toBe(true)
  expect(drawn.includes('Close files')).toBe(true)
  // ≤ 40 file: không có danh sách link (file đã nằm trong graph, bấm được).
  expect(drawn.includes('git-graph.invalid')).toBe(false)

  // Chế độ "Image" (SVG, chỉ xem) vẫn vẽ được.
  await pressToolbar(ui, 'Image')
  expect(JSON.stringify(await ui.drawn()).includes('<svg')).toBe(true)
})

test('pressing a file shows its diff (hunks only) inside the graph pane, ← Graph goes back', async ($, on) => {
  const shows: string[][] = []
  mockGit(on, shows)
  await $.command.run({ command: 'git-graph' } as never)
  await render($, 'terminal')
  await $.ui.press({ plugin: 'commit-lanes', key: '677b60b', surface: 'terminal' })
  await render($, 'terminal')

  await $.ui.press({ plugin: 'commit-lanes', key: 'file:src/a.ts', surface: 'terminal' })
  expect(shows[1]?.slice(-3)).toEqual(['677b60b', '--', 'src/a.ts'])
  // Diff hiện ngay trong pane graph, có nút quay lại.
  const diff = await render($, 'terminal')
  expect(diff.includes('+const y = 3')).toBe(true)
  expect(diff.includes('diff --git')).toBe(false)
  expect(diff.includes('← Graph')).toBe(true)
  await $.ui.press({ plugin: 'commit-lanes', key: '← Graph', surface: 'terminal' })
  expect((await render($, 'terminal')).includes('677b60b')).toBe(true)
})

test('desktop: >40 files — grid inlines all (clickable); Ảnh view inlines 40 + markdown links', async ($, on) => {
  const shows: string[][] = []
  const many = Array.from({ length: 45 }, (_v, i) => `M\tsrc/f${i}.ts`).join('\n') + '\nR087\told.ts\tnew.ts\n'
  on('process.run', async (_$, e) => {
    if (e.argv[1] === 'show') shows.push([...e.argv])
    const stdout = e.argv[1] !== 'show' ? GRAPH : e.argv.includes('--') ? DIFF : many
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'git-graph' } as never)
  const ui = await mountDesktop($)
  await clickGraph(ui, 'c:f9c5c3f')
  // Lưới: chèn hết 46 file vào graph, không có danh sách link; file cuối bấm được.
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.includes('more files')).toBe(false)
  expect(drawn.includes('git-graph.invalid')).toBe(false)
  await clickGraph(ui, 'f:45')
  expect(shows.at(-1)?.slice(-3)).toEqual(['--', 'old.ts', 'new.ts'])
  expect(JSON.stringify(await ui.drawn()).includes('+const y = 3')).toBe(true)
  await pressToolbar(ui, '← Graph')

  // Chế độ "Image" (SVG có giới hạn kích thước): 40 file trong graph + link cho phần còn lại.
  await pressToolbar(ui, 'Image')
  expect(JSON.stringify(await ui.drawn()).includes('more files')).toBe(true)
  await ui.press({ key: 'files', link: { href: 'https://git-graph.invalid/file/44' } })
  expect(shows.at(-1)?.slice(-3)).toEqual(['f9c5c3f', '--', 'src/f44.ts'])
})

test('desktop: clicking graph rows repeatedly — commit, file, close, other commits', async ($, on) => {
  const shows: string[][] = []
  mockGit(on, shows)
  await $.command.run({ command: 'git-graph' } as never)
  const ui = await mountDesktop($)

  await clickGraph(ui, 'c:677b60b')
  expect(shows.at(-1)?.slice(-1)).toEqual(['677b60b'])
  await clickGraph(ui, 'f:1')
  expect(shows.at(-1)?.slice(-3)).toEqual(['677b60b', '--', 'src/b.ts'])
  // Pane chuyển sang diff của file; ← Graph quay lại, commit vẫn đang mở.
  expect(JSON.stringify(await ui.drawn()).includes('+const y = 3')).toBe(true)
  await pressToolbar(ui, '← Graph')
  expect(JSON.stringify(await ui.drawn()).includes('src/b.ts')).toBe(true)
  await clickGraph(ui, 'c:677b60b')
  expect(JSON.stringify(await ui.drawn()).includes('src/b.ts')).toBe(false)
  // Commit ở các làn khác nhau, kể cả dòng cuối.
  await clickGraph(ui, 'c:eaf28fe')
  expect(shows.at(-1)?.slice(-1)).toEqual(['eaf28fe'])
  await clickGraph(ui, 'c:f9c5c3f')
  expect(shows.at(-1)?.slice(-1)).toEqual(['f9c5c3f'])
})

test('desktop: dragging the header separator of the grid stores column widths; reset clears them', async ($, on) => {
  mockGit(on, [])
  await $.command.run({ command: 'git-graph' } as never)
  const ui = await mountDesktop($)
  // Tiêu đề: Box [lead, mô tả, sep(1), author, sep(1), ngày] — lấy width của Box đầu dòng 0.
  const widths = async () =>
    [...JSON.stringify(await ui.drawn({ in: 'grid' })).matchAll(/"width":(\d+)/g)].map(m => Number(m[1]))
  const [lead = 0, desc = 0] = await widths()
  expect(desc).toBeGreaterThan(15)

  const sep = lead + desc
  await ui.pointer({ type: 'down', x: sep, y: 0, button: 'left', in: 'grid' })
  await ui.pointer({ type: 'move', x: sep - 10, y: 0, button: 'left', in: 'grid' })
  await ui.pointer({ type: 'up', x: sep - 10, y: 0, button: 'left', in: 'grid' })

  expect((await widths())[1]).toBe(desc - 10)
  expect(JSON.stringify(await ui.drawn()).includes('Reset columns')).toBe(true)

  await pressToolbar(ui, 'Reset columns')
  expect(JSON.stringify(await ui.drawn()).includes('Reset columns')).toBe(false)
})

test('desktop "Image" view: clicking a commit then a file on the image opens the diff', async ($, on) => {
  const shows: string[][] = []
  mockGit(on, shows)
  await $.command.run({ command: 'git-graph' } as never)
  const ui = await mountDesktop($)
  await pressToolbar(ui, 'Image')
  expect(JSON.stringify(await ui.drawn()).includes('<svg')).toBe(true)

  await clickImage(ui, 'c:677b60b')
  expect(shows.at(-1)?.slice(-1)).toEqual(['677b60b'])
  await clickImage(ui, 'f:2')
  expect(shows.at(-1)?.slice(-4)).toEqual(['677b60b', '--', 'old.ts', 'new.ts'])
  expect(JSON.stringify(await ui.drawn()).includes('+const y = 3')).toBe(true)
  // ← Graph quay lại đúng chế độ Ảnh.
  await pressToolbar(ui, '← Graph')
  expect(JSON.stringify(await ui.drawn()).includes('<svg')).toBe(true)
})

test('desktop: the button above the prompt toggles the pane; the pane × resets it', async ($, on) => {
  const opens: string[] = []
  const closes: string[] = []
  on('process.run', async () => ({ value: { exitCode: 0, stdout: GRAPH, stderr: '' } }))
  on('ui.open', async (_$, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', async (_$, e) => {
    closes.push(e.id)
    return { value: undefined }
  })
  await $.command.run({ command: 'git-graph' } as never)
  const band = await $.ui.mount({ plugin: 'commit-lanes', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } as never })
  expect(JSON.stringify(await band.drawn()).includes('⎇ Hide Git graph')).toBe(true)

  await band.press({ key: 'git-graph-toggle' })
  expect(closes.includes('git-graph')).toBe(true)
  expect(JSON.stringify(await band.drawn()).includes('"⎇ Git graph"')).toBe(true)

  const before = opens.length
  await band.press({ key: 'git-graph-toggle' })
  expect(opens.length).toBe(before + 1)
  expect(JSON.stringify(await band.drawn()).includes('⎇ Hide Git graph')).toBe(true)

})

test('a failing git shows its error instead of lines', async ($, on) => {
  on('process.run', async () => ({ value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))

  await $.command.run({ command: 'git-graph' } as never)

  expect((await render($, 'desktop')).includes('fatal: not a git repository')).toBe(true)
})
