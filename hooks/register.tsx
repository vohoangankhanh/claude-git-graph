import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileChange, GraphSnapshot, GraphView } from '../types'

import { boxGraph } from './boxdraw'
import type { Row } from './parse'
import { buildRows, DATE_FORMAT, diffHunks, LOG_FORMAT, MAX_INLINE_FILES, parseNameStatus, STATUS_COLOR } from './parse'
import type { GridGlyph, GridMessage, GridProps, GridRow } from './grid'
import type { ToolbarMessage, ToolbarProps } from './toolbar'
import { renderGraphSvg } from './svg'

const PANE = 'git-graph'
/** Pane diff riêng của bản cũ — desktop không cho tự chuyển sang tab của nó, nay diff hiện ngay trong pane graph. */
const OLD_DIFF_PANE = 'git-diff'
/**
 * Kích thước một ô chữ trên desktop (px), đo từ ảnh chụp 14/10: pane 117 ô ≈ 935px; các dòng lưới
 * cách nhau 19px. Chế độ "Ảnh" vẽ mỗi dòng SVG cao đúng 1 ô để lớp bấm đè lên khớp từng dòng.
 * Engine không cho biết tỉ lệ ô↔px — đổi zoom/cỡ chữ của app thì phải đo lại.
 */
const CELL_PX = { w: 8, h: 19 }
const PX_PER_COLUMN = CELL_PX.w
const MAX_LINKS = 200
const MAX_MD_CHARS = 9500
const FILE_LINK = 'https://git-graph.invalid/file/'
const VIEW_LABEL: Record<GraphView, string> = { grid: 'Grid', graph: 'Image', mono: 'Plain', color: 'Color' }
const graph = atom({ plugin: 'git-graph', key: 'graph' } as const, {
  lines: [],
  at: '',
  error: '',
  all: false,
} as GraphSnapshot)

/** Pane đang mở hay không — cho nút bật/tắt trên ô chat (desktop). */
const paneOpen = atom({ plugin: 'git-graph', key: 'paneOpen' } as const, false)

const openPane = async ($: EngineInterface) => {
  await update($, paneOpen, () => true)
  return $.ui.open({ id: PANE, title: 'Git graph' })
}

const refresh = async ($: EngineInterface, all?: boolean) => {
  const prev = await read($, graph)
  const showAll = all ?? prev.all
  const argv = ['git', 'log', '--graph', `--date=${DATE_FORMAT}`, `--format=${LOG_FORMAT}`, '-n', '80']
  if (showAll) argv.push('--all')
  try {
    const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs: 10000 })
    await update($, graph, g => ({
      ...g,
      lines: exitCode === 0 ? stdout.split('\n').filter(Boolean) : [],
      at: new Date().toLocaleTimeString(),
      error: exitCode === 0 ? '' : stderr.trim() || `git exited ${exitCode}`,
      all: showAll,
    }))
  } catch (err) {
    await update($, graph, g => ({ ...g, error: String(err), at: new Date().toLocaleTimeString() }))
  }
}

const closeCommit = ($: EngineInterface) => update($, graph, ({ open: _open, ...g }) => g)

/** Mở danh sách file của commit (bấm lại commit đang mở thì đóng). Merge: so với parent đầu. */
const toggleCommit = async ($: EngineInterface, hash: string) => {
  const cur = await read($, graph)
  if (cur.open?.hash === hash) {
    await closeCommit($)
    return
  }
  await update($, graph, g => ({ ...g, open: { hash, files: null, error: '' } }))
  const argv = ['git', 'show', '--format=', '--name-status', '--diff-merges=first-parent', hash]
  let files: ReturnType<typeof parseNameStatus> = []
  let error = ''
  try {
    const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs: 10000 })
    if (exitCode === 0) files = parseNameStatus(stdout)
    else error = stderr.trim() || `git exited ${exitCode}`
  } catch (err) {
    error = String(err)
  }
  // Người dùng có thể đã mở commit khác trong lúc chờ.
  await update($, graph, g => (g.open?.hash === hash ? { ...g, open: { hash, files, error } } : g))
}

/** Mở pane git-diff cho một file của commit (merge: so với parent đầu). */
const openDiff = async ($: EngineInterface, hash: string, file: FileChange) => {
  await update($, graph, g => ({ ...g, diff: { hash, file, text: null, error: '' } }))
  const argv = ['git', 'show', '--format=', '--no-color', '--no-ext-diff', '-M', '--diff-merges=first-parent', hash]
  let text = ''
  let error = ''
  try {
    const { exitCode, stdout, stderr } = await $.process.run([...argv, '--', ...file.paths], { timeoutMs: 15000 })
    if (exitCode === 0) {
      const hunks = diffHunks(stdout)
      text = hunks.cut ? `${hunks.text}\n` : hunks.text
      if (hunks.cut) error = 'Diff too long — showing the first part only.'
    } else error = stderr.trim() || `git exited ${exitCode}`
  } catch (err) {
    error = String(err)
  }
  await update($, graph, g =>
    g.diff?.hash === hash && g.diff.file.path === file.path ? { ...g, diff: { hash, file, text, error } } : g,
  )
}

/**
 * Danh sách file dạng link Markdown (desktop bấm được link, không bấm được vào SVG).
 * Markdown nhận tối đa 10000 ký tự và 256 link: cắt theo ngân sách, báo số file còn lại.
 */
const fileLinks = (files: FileChange[]): { text: string; count: number } => {
  const lines: string[] = []
  let size = 0
  for (const [i, f] of files.entries()) {
    const line = `- **${f.status}** [\`${f.path.replace(/`/g, "'")}\`](${FILE_LINK}${i})`
    if (lines.length >= MAX_LINKS || size + line.length + 1 > MAX_MD_CHARS) break
    lines.push(line)
    size += line.length + 1
  }
  const more = files.length - lines.length
  return { text: lines.join('\n') + (more > 0 ? `\n\n… ${more} more files` : ''), count: lines.length }
}

/** Màu theo cột của graph (gần với palette Git Graph trên VS Code). */
const LANES = ['#4fc1ff', '#c586c0', '#4ec9b0', '#dcdcaa', '#f48771', '#b5cea8', '#ce9178', '#9cdcfe']

export type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean }

const refSegs = (ref: string): Seg[] => {
  if (ref.startsWith('HEAD -> ')) {
    return [
      { text: 'HEAD → ', color: '#4fc1ff', bold: true },
      { text: ref.slice('HEAD -> '.length), color: '#89d185', bold: true },
    ]
  }
  if (ref === 'HEAD') return [{ text: ref, color: '#4fc1ff', bold: true }]
  if (ref.startsWith('tag: ')) return [{ text: ref, color: '#e2c08d' }]
  if (ref.startsWith('origin/')) return [{ text: ref, color: '#f14c4c' }]
  return [{ text: ref, color: '#89d185' }]
}

/** Một dòng thành các đoạn có màu: graph bằng ký tự khung (nét liền) + hash/refs/message/author. */
export const rowSegs = (row: Row): Seg[] => {
  const segs: Seg[] = boxGraph(row.graph).map(cell =>
    cell.lane === undefined
      ? { text: cell.ch }
      : { text: cell.ch, color: LANES[cell.lane % LANES.length], bold: cell.commit },
  )
  if (row.kind === 'commit') {
    const { hash, refs, subject, author, date } = row.commit
    segs.push({ text: ' ' }, { text: hash, color: '#d7ba7d' })
    if (refs.length > 0) {
      segs.push({ text: ' (', dim: true })
      refs.forEach((ref, k) => {
        if (k > 0) segs.push({ text: ', ', dim: true })
        segs.push(...refSegs(ref))
      })
      segs.push({ text: ')', dim: true })
    }
    segs.push({ text: ` ${subject}` }, { text: ` · ${author} · ${date}`, dim: true })
  } else if (row.kind === 'file') {
    segs.push({ text: '   ' }, { text: row.file.status, color: STATUS_COLOR[row.file.status], bold: true })
    segs.push({ text: ` ${row.file.path}` })
  } else if (row.kind === 'note') {
    segs.push({ text: `   ${row.text}`, dim: true })
  }
  return segs
}

/** Mục tiêu khi bấm một dòng: `c:<hash>` (commit), `f:<index>` (file của commit đang mở), '' (dòng nối). */
const rowTarget = (row: Row, openFiles: FileChange[]) =>
  row.kind === 'commit'
    ? `c:${row.commit.hash}`
    : row.kind === 'file'
      ? `f:${openFiles.findIndex(f => f.path === row.file.path)}`
      : ''

const REF_COLOR = (ref: string) =>
  ref.startsWith('HEAD') ? '#4fc1ff' : ref.startsWith('tag: ') ? '#e2c08d' : ref.startsWith('origin/') ? '#f14c4c' : '#89d185'

/** Dữ liệu cho lưới desktop: graph bằng ký tự khung (dải dấu cách gộp lại), refs ≤ 3 + "+N". */
const toGridRows = (rows: Row[], openFiles: FileChange[]): { rows: GridRow[]; lead: number } => {
  const glyphs = (graphStr: string): GridGlyph[] => {
    const out: GridGlyph[] = []
    for (const cell of boxGraph(graphStr)) {
      const color = cell.lane === undefined ? '' : (LANES[cell.lane % LANES.length] ?? '')
      const last = out[out.length - 1]
      if (cell.ch === ' ' && last && last[0].trim() === '') last[0] += ' '
      else out.push([cell.ch, color])
    }
    return out
  }
  const lead = Math.max(1, ...rows.map(r => boxGraph(r.graph).length)) + 1
  const gridRows = rows.map((row): GridRow => {
    const graph = glyphs(row.graph)
    if (row.kind === 'commit') {
      const { hash, refs, subject, author, date } = row.commit
      const ordered = [...refs].sort((a, b) => Number(a.startsWith('tag: ')) - Number(b.startsWith('tag: ')))
      const shown = ordered.slice(0, 3).map((ref): [string, string] => [ref.replace(/^HEAD -> /, '→ '), REF_COLOR(ref)])
      if (ordered.length > 3) shown.push([`+${ordered.length - 3}`, '#888888'])
      return { target: `c:${hash}`, graph, kind: 'commit', hash, refs: shown, text: subject, author, date, open: row.open }
    }
    if (row.kind === 'file') {
      const index = openFiles.findIndex(f => f.path === row.file.path)
      return {
        target: `f:${index}`,
        graph,
        kind: 'file',
        hash: `  ${row.file.status}`,
        text: row.file.path,
        textColor: STATUS_COLOR[row.file.status] ?? '',
        open: true,
      }
    }
    if (row.kind === 'note') return { target: '', graph, kind: 'note', text: row.text, open: true }
    return { target: '', graph, kind: 'link' }
  })
  return { rows: gridRows, lead }
}

/** Số dòng mỗi khối Client của lưới (cây mỗi Client tối đa 100000 ký tự). */
const GRID_CHUNK = 30


/** Tách đoạn hash ra để làm nút bấm (Button chỉ nhận một chuỗi, không nhận Text có màu). */
const splitAtHash = (row: Extract<Row, { kind: 'commit' }>) => {
  const segs = rowSegs(row)
  const k = segs.findIndex(seg => seg.text === row.commit.hash)
  return { before: segs.slice(0, k), after: segs.slice(k + 1) }
}

/** Chế độ xem trên desktop (có Client): Lưới → Ảnh → Thẳng hàng. */
const DESKTOP_VIEWS: GraphView[] = ['grid', 'graph', 'mono']

const toolbarProps = (g: GraphSnapshot, nextView: GraphView, isGrid: boolean): ToolbarProps => ({
  buttons: [
    { id: 'refresh', label: 'Refresh' },
    { id: 'all', label: g.all ? 'Current branch' : 'All branches' },
    { id: 'view', label: VIEW_LABEL[nextView] },
    ...(g.open ? [{ id: 'close', label: 'Close files' }] : []),
    ...(isGrid && g.colW ? [{ id: 'resetCols', label: 'Reset columns' }] : []),
  ],
  status: g.at ? `updated ${g.at}` : 'loading…',
})

/** Nút của thanh Client (desktop) — cùng hành động với Button native trên terminal. */
const toolbarAction = async ($: EngineInterface, id: string) => {
  const g = await read($, graph)
  if (id === 'refresh') await refresh($)
  else if (id === 'all') await refresh($, !g.all)
  else if (id === 'view') {
    const cur = DESKTOP_VIEWS.includes(g.view ?? 'grid') ? (g.view ?? 'grid') : 'grid'
    const view = DESKTOP_VIEWS[(DESKTOP_VIEWS.indexOf(cur) + 1) % DESKTOP_VIEWS.length] ?? 'grid'
    await update($, graph, s => ({ ...s, view }))
  } else if (id === 'close') await closeCommit($)
  else if (id === 'resetCols') await update($, graph, ({ colW: _c, ...s }) => s)
  else if (id === 'back') await update($, graph, ({ diff: _d, ...s }) => s)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'git-graph', description: 'Show the git commit graph in a pane' })
    void $.ui.close({ id: OLD_DIFF_PANE })
    // Cài cho mọi session: không tự mở pane; mở bằng nút ⎇ trên ô chat hoặc /git-graph.
    // Chỉ chạy git log định kỳ khi pane đang mở.
    $.clock.every(15000, async () => {
      if (await read($, paneOpen)) await refresh($)
    })
    return next(e)
  })

  on('command.run', { command: 'git-graph' }, async $ => {
    await refresh($)
    await openPane($)
    return { text: 'Git graph pane opened.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bgit\b/.test(e.command)) await refresh($)
    return ran
  })

  // Đóng pane (dấu × của người dùng, hoặc nút trên ô chat) → nút đổi về "Git graph".
  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, paneOpen, () => false)
    return next(e)
  })

  // Nút bật/tắt pane ngay trên ô chat (desktop): mod không thêm được icon vào thanh icon của app.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const isOpen = await read($, paneOpen)
    const onToggle = async () => {
      if (isOpen) {
        await update($, paneOpen, () => false)
        await $.ui.close({ id: PANE })
      } else {
        await refresh($)
        await openPane($)
      }
    }
    return (
      <Box flexDirection="row">
        <Button key="git-graph-toggle" plain dimColor label={isOpen ? '⎇ Hide Git graph' : '⎇ Git graph'} onPress={onToggle} />
      </Box>
    )
  })

  // Lưới graph trên desktop (Client "grid") gửi về: click vào dòng, độ rộng cột vừa kéo.
  let lastClickId = ''
  let lastPressAt = ''
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    if (e.element === 'toolbar') {
      const cols = (e.data as Partial<ToolbarMessage> | undefined)?.cols
      if (typeof cols === 'number' && cols > 0) {
        const g = await read($, graph)
        if (g.paneCols !== cols) await update($, graph, cur => ({ ...cur, paneCols: cols }))
      }
      const press = (e.data as Partial<ToolbarMessage> | undefined)?.press
      if (press && press.at !== lastPressAt) {
        lastPressAt = press.at
        await toolbarAction($, press.id)
      }
      return {}
    }
    if (!e.element.startsWith('grid')) return next(e)
    const data = (e.data ?? {}) as GridMessage
    if (data.cols && typeof data.cols.desc === 'number' && typeof data.cols.author === 'number') {
      const colW = { desc: Math.round(data.cols.desc), author: Math.round(data.cols.author) }
      await update($, graph, g => ({ ...g, colW }))
    }
    const click = data.click && data.click.id !== lastClickId ? data.click : undefined
    if (click) {
      lastClickId = click.id
      if (click.target.startsWith('c:')) await toggleCommit($, click.target.slice(2))
      else if (click.target.startsWith('f:')) {
        const g = await read($, graph)
        const file = g.open?.files?.[Number(click.target.slice(2))]
        if (file && g.open) await openDiff($, g.open.hash, file)
      }
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Code } = els
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
    const g = await read($, graph)
    // Client (nhận chuột, vẽ theo lưới ô) chỉ dùng trên desktop; terminal bấm vào hash/tên file.
    const Client = e.surface === 'desktop' && 'Client' in els ? els.Client : undefined
    // Bấm một file: pane chuyển sang diff của file đó (desktop không cho tự chuyển sang tab khác).
    if (g.diff) {
      const { hash, file, text, error } = g.diff
      const onBack = () => update($, graph, ({ diff: _d, ...cur }) => cur)
      const backBar: ToolbarProps = { buttons: [{ id: 'back', label: '← Graph' }], status: `${file.status} ${file.path} @ ${hash}` }
      return (
        <Box flexDirection="column">
          {Client ? (
            <Client key="toolbar" module="./toolbar.tsx" props={backBar} width="100%" height={1} />
          ) : (
            <Box flexDirection="row" gap={1}>
              <Button onPress={onBack}>← Graph</Button>
              <Text bold color={STATUS_COLOR[file.status]}>
                {file.status}
              </Text>
              <Text bold wrap="truncate-start">{file.path}</Text>
              <Text dimColor>@ {hash}</Text>
            </Box>
          )}
          {error !== '' && <Text color="yellow">{error}</Text>}
          {text === null && <Text dimColor>loading…</Text>}
          {text === '' && error === '' && (
            <Text dimColor>(binary file or rename/mode change only — no content diff)</Text>
          )}
          {text && <Code source={text} format="diff" path={file.paths.at(-1)} />}
        </Box>
      )
    }
    // SVG cuộn được trong pane nên không cần cắt theo viewport; Text/Code thì cắt cho vừa.
    const room = Svg ? g.lines.length : Math.max(5, (e.viewport?.rows ?? 40) - 4)
    const views: GraphView[] = Client ? ['grid', 'graph', 'mono'] : Svg ? ['graph', 'mono', 'color'] : ['color', 'mono']
    const view = views.includes(g.view ?? 'grid') ? (g.view ?? 'grid') : (views[0] ?? 'mono')
    const nextView = views[(views.indexOf(view) + 1) % views.length] ?? 'mono'
    const onRefresh = () => refresh($)
    const onToggle = () => refresh($, !g.all)
    const onStyle = () => update($, graph, cur => ({ ...cur, view: nextView }))
    const onClose = () => closeCommit($)
    const pressRow = (hash: string) => () => toggleCommit($, hash)
    const openHash = g.open?.hash ?? ''
    const openFiles = g.open?.files ?? []
    const pressFile = (file: FileChange) => () => openDiff($, openHash, file)
    const onFileLink = (link: { href: string }) => {
      const file = openFiles[Number(link.href.slice(FILE_LINK.length))]
      if (link.href.startsWith(FILE_LINK) && file) void openDiff($, openHash, file)
    }
    const { Markdown } = els
    // Graph chỉ chèn MAX_INLINE_FILES file đầu (bấm được trên graph); quá thì liệt kê link cho phần còn lại.
    const links = openFiles.length > MAX_INLINE_FILES ? fileLinks(openFiles) : undefined

    // Lưới desktop chèn hết file (chia khối, không giới hạn kích thước như SVG).
    const rows = buildRows(g.lines.slice(0, room), g.open, view === 'grid' ? Infinity : MAX_INLINE_FILES)
    const mono = rows.map(row => rowSegs(row).map(seg => seg.text).join('')).join('\n')
    const columns = e.viewport?.columns
    // Chế độ ảnh (chỉ xem): nét cong SVG; bề rộng ước lượng theo ô.
    const svg =
      Svg && view === 'graph' && rows.length > 0
        ? renderGraphSvg(rows, {
            // Bề rộng thật do thanh nút (Client 100%) báo; viewport.columns của engine nhỏ hơn pane.
            maxWidth: (g.paneCols ?? columns) ? Math.max(360, (g.paneCols ?? columns ?? 0) * PX_PER_COLUMN - 8) : undefined,
            // Có lớp bấm (desktop): mỗi dòng đúng 1 ô chữ.
            ...(Client ? { rowH: CELL_PX.h } : {}),
          })
        : undefined
    const grid = Client && view === 'grid' && rows.length > 0 ? toGridRows(rows, openFiles) : undefined
    const gridChunks: GridProps[] = []
    for (let i = 0; grid && i < grid.rows.length; i += GRID_CHUNK) {
      gridChunks.push({
        rows: grid.rows.slice(i, i + GRID_CHUNK),
        lead: grid.lead,
        header: i === 0,
        ...(g.colW ? { colW: g.colW } : {}),
      })
    }
    const onResetCols = () => update($, graph, ({ colW: _c, ...cur }) => cur)
    const commits = rows.flatMap(row => (row.kind === 'commit' ? [row.commit] : []))
    // alt tối đa 10000 ký tự: tóm tắt, không nhét cả graph.
    const svgAlt = `Git graph: ${commits.length} commit${commits[0] ? `, latest ${commits[0].hash} ${commits[0].subject}` : ''}`.slice(0, 500)

    const segText = (seg: Seg) => (
      <Text color={seg.color} bold={seg.bold} dimColor={seg.dim} wrap="truncate">
        {seg.text}
      </Text>
    )

    return (
      <Box flexDirection="column">
        {Client ? (
          <Client key="toolbar" module="./toolbar.tsx" props={toolbarProps(g, nextView, !!grid)} width="100%" height={1} />
        ) : (
          <Box flexDirection="row" gap={1}>
            <Button onPress={onRefresh}>Refresh</Button>
            <Button onPress={onToggle}>{g.all ? 'Current branch' : 'All branches'}</Button>
            <Button onPress={onStyle}>{VIEW_LABEL[nextView]}</Button>
            {g.open && <Button onPress={onClose}>Close files</Button>}
            {grid && g.colW && <Button onPress={onResetCols}>Reset columns</Button>}
            <Text dimColor>{g.at ? `updated ${g.at}` : 'loading…'}</Text>
          </Box>
        )}
        {view === 'graph' && links && (
          <Markdown
            key="files"
            text={links.text}
            onLinkPress={onFileLink}
            pressableLinks={openFiles.slice(0, links.count).map((_f, i) => `${FILE_LINK}${i}`)}
          />
        )}
        {g.error !== '' && <Text color="red">{g.error}</Text>}
        {Client &&
          gridChunks.map((chunk, k) => (
            <Client
              key={k === 0 ? 'grid' : `grid-${k}`}
              module="./grid.tsx"
              props={chunk}
              width="100%"
              height={chunk.rows.length + (chunk.header ? 1 : 0)}
            />
          ))}
        {/* Không đặt width/height: ảnh lỡ rộng hơn pane thì tự co cho vừa, không tràn. */}
        {Svg && svg && (
          <Box key="img" position="relative" flexDirection="column">
            <Svg source={svg.source} alt={svgAlt} />
            {Client && (
              <Box position="absolute" top={0} left={0} width="100%" height={svg.layout.rows}>
                <Client
                  key="grid-img"
                  module="./imghit.tsx"
                  props={{ targets: rows.slice(0, svg.layout.rows).map(row => rowTarget(row, openFiles)) }}
                  width="100%"
                  height={svg.layout.rows}
                />
              </Box>
            )}
          </Box>
        )}
        {view === 'mono' && rows.length > 0 && <Code source={mono} language="text" />}
        {view === 'color' &&
          rows.map(row =>
            row.kind === 'commit' ? (
              <Box flexDirection="row">
                {splitAtHash(row).before.map(segText)}
                <Button plain key={row.commit.hash} label={row.commit.hash} onPress={pressRow(row.commit.hash)} />
                {splitAtHash(row).after.map(segText)}
              </Box>
            ) : row.kind === 'file' && g.open ? (
              <Box flexDirection="row">
                {rowSegs(row).slice(0, -1).map(segText)}
                <Text> </Text>
                <Button plain key={`file:${row.file.path}`} label={row.file.path} onPress={pressFile(row.file)} />
              </Box>
            ) : (
              <Box flexDirection="row">{rowSegs(row).map(segText)}</Box>
            ),
          )}
      </Box>
    )
  })
}
