export type GraphView = 'grid' | 'graph' | 'mono' | 'color'
/** `path` để hiển thị (đổi tên: `cũ → mới`); `paths` truyền cho `git show --` (đổi tên: cả hai). */
export type FileChange = { status: string; path: string; paths: string[] }
/** Diff đang xem ở pane git-diff; `text: null` = đang tải. */
export type DiffView = { hash: string; file: FileChange; text: string | null; error: string }
/** Commit đang xổ danh sách file; `files: null` = đang tải. */
export type OpenCommit = { hash: string; files: FileChange[] | null; error: string }

export type GraphSnapshot = {
  lines: string[]
  at: string
  error: string
  all: boolean
  view?: GraphView
  open?: OpenCommit
  diff?: DiffView
  /** Độ rộng cột người dùng kéo (ô chữ); absent = tự động lấp đầy. */
  colW?: { desc: number; author: number }
  /** Bề rộng pane theo ô chữ (desktop), do thanh nút Client báo. */
  paneCols?: number
}

declare module 'claude-code' {
  interface PluginState {
    'commit-lanes': { graph: GraphSnapshot; paneOpen: boolean }
  }
}
