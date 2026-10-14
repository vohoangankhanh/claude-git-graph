# git-graph — a git commit graph pane for Claude Code

A live **git log graph** inside Claude Code, like VS Code's Git Graph: colored lanes, branch/tag
badges, author and date columns. Click a commit to list its files, click a file to see its diff.

## Install

At the prompt of a Claude Code session:

```
/plugin install git-graph --marketplace vohoangankhanh/claude-git-graph
```

Answer `y` to add the marketplace, then pick a scope (user scope = every session).

## Use

- **Open / close**: the **⎇ Git graph** button above the prompt (desktop app), or `/git-graph`.
- **Click a commit** to expand the files it changed (merges are compared with their first parent);
  click it again, or **Close files**, to collapse.
- **Click a file** to show its diff in the pane; **← Graph** goes back.
- **All branches / Current branch** toggles `git log --all`.
- **Views** (desktop): **Grid** (default — clickable, resizable columns: drag the `│` in the
  header; **Reset columns** restores auto width), **Image** (SVG with smooth curved lanes, also
  clickable), **Plain** (monospace text). The terminal shows a box-drawing colored view where the
  commit hash and file names are clickable.
- The graph refreshes every 15 s while the pane is open, and after any `git` command Claude runs.

## What it runs and sends

- Runs only local, read-only `git` commands in the session's working directory:
  `git log --graph` (last 80 commits, `--all` when toggled) and `git show --name-status` /
  `git show -- <file>` for the commit or file you click.
- Sends nothing over the network, reads no credentials, and writes no files. All state (the graph,
  open commit, column widths) lives in the Claude Code session's plugin state.

## Notes

- Shows the last 80 commits of the session's working directory.
- The **Image** view maps clicks to rows assuming the desktop app's default zoom (a text cell of
  8×19 px); with another zoom level use the **Grid** view.

## Develop

```
claude plugin validate .
claude plugin test .
```

## License

MIT
