# dsh-run-progress

A slim progress rail pinned to the far right edge of the DeepSeek Harness Web GUI, with a
Run flow panel behind it.

## Install

Nothing to configure: once the plugin is enabled the rail appears on the right edge whenever a
turn runs.

**From the packaged tarball** (works without a registry):

1. Download [`release/dsh-run-progress-0.8.0.tgz`](https://github.com/wsqwsq735/dsh-run-progress/raw/main/release/dsh-run-progress-0.8.0.tgz)
   (it is committed to this repository, so the link works even when a release asset is missing;
   the same file is attached to [the latest release](https://github.com/wsqwsq735/dsh-run-progress/releases/latest))
2. **Plugins → Add plugin** and pick that file, or ask the agent in a session to run
   `install_bundle` with the absolute path of the downloaded `.tgz`
3. Refresh the page once (`Ctrl+R`) when the install finishes

**From npm** — the registry package is the same bundle:

```
npm i dsh-run-progress
```

If the registry lookup fails (not published yet), use the tarball above; it is byte-for-byte the
same package.

**From a checkout** — install the folder, which is linked rather than copied, so local edits go
live on refresh:

```
install_bundle → D:\path\to\dsh-run-progress
```

Check **Plugins**: the row `dsh-run-progress` should be listed as enabled.

## What it shows

- **Rail** — appears while the Session in the main conversation view is running, and stays
  for a few seconds after the turn settles. Fill and colour follow the current turn; when the
  agent keeps a task list (`todo_write`), the fill is that list's completion instead of an
  invented estimate. Without a task list the rail shows a moving activity pulse.
- **Token track, percentage and readout** — a second thin bar beside the rail is the context
  window's occupancy. The vertical number under the bars is a percentage: the **task progress**
  when the agent keeps a task list (matching the bar it sits beside), otherwise the context
  occupancy (yellow past 75%, red past 90%); elapsed time is never printed at the edge. The pill
  below keeps the token sizes readable in real time (`12.3k/51.2k`), idle or not.
- **Movable pill** — drag the token pill anywhere on the window; the position is remembered in
  this browser (`localStorage`, not the Session log) and stays inside the viewport on resize.
  Double-click it to return to the default seat under the rail. A drag never opens the panel;
  a click (or Enter/Space) still does.
- **Token → RMB estimate** — the pill appends the estimated cost of the Session's billable
  usage (`315k/1.0M · ≈¥0.63`), and the panel's Token section breaks it down per bucket, states
  the rate it used, and marks the figure as an estimate. Defaults are ¥2 / ¥0.2 / ¥2 / ¥3 per
  1M tokens (uncached input / cache read / cache write / output). This is a status readout, not
  billing — the prices are local constants, not something DSH reports.
- **Per-model prices** — the price table can carry one row per provider model, so a flash turn and
  a pro turn are not billed at the same rate. Each settlement carries the model that produced it
  (`message.source.model`), so every turn is priced at its own row; the Session total is priced at
  the newest turn's row and names it, and each turn's tooltip names the row it used. Store a table
  in this browser:
  `localStorage['dsh-run-progress:pricing'] = {"default":{"input":2,"cacheRead":0.2,"cacheWrite":2,"output":3},"models":{"deepseek-v4-flash":{"input":0.5,"cacheRead":0.05,"cacheWrite":0.5,"output":1}}}`
  A legacy flat row (`{"input":2,...}`) is still understood and prices every turn at the default.
- **A task list, so the percentage means something** — the Host half contributes one short
  system-prompt section asking the agent to call `todo_write` before multi-step work and keep it
  current. The section is empty when the todo tool is not installed, so the prompt never names a
  missing tool, and `DSH_RUN_PROGRESS_TODO_NUDGE=0` turns it off for profiles that carry their own
  policy.
- **Run flow panel** — click the rail or the pill. A Token section first (context occupancy,
  input / cache read / cache write / output, Session total), then the newest turns (up to eight)
  as compact cards: turn number, state, step count, elapsed time, one-line prompt and reply
  previews, and **each turn's own Token line** (that turn's reported usage split by bucket with
  its estimated cost).
- **Turn detail: click to open, click to close** — a turn card shows only its summary, previews and
  Token line until you click its header; the click (▸) opens that turn's full detail: every step,
  every tool call with its whole argument summary, and the untruncated prompt and reply. A second
  click collapses it. Nothing expands on hover, and only one card is open at a time.

## Where the data comes from

The rail follows the Session the main conversation retains (`retainedBy.mainView`), borrows its
binding with `ctx.sessions.binding()` without extending its lifetime, and reads faces the
browser already holds: the contiguous event window for `turn/*`, `step/*`, `tool/call` and
`tool/result` records (plus each `assistant/message` settlement's `usage`, which is what the
per-turn Token lines sum), the `todos` projection, and two token units — `contextPressure`
(prompt-side pressure of the newest request paired with the newest known window, plus the
meter's estimate of surface movement since that sample) and `tokenUsage` (whole-log buckets:
uncached input, cache read, cache write, output). The plugin writes nothing to the Session log
and keeps no state of its own.

## Limitations

- One Session at a time — the one open in the main conversation. Subagent Sessions are not
  listed.
- The event window is the browser's loaded page, so very old turns fall out of the panel; the
  panel folds up to eight turns and every turn it shows carries its own Token line. The current
  turn is always complete.
- Progress is a percentage only when the agent keeps a task list; otherwise the rail is an
  activity indicator, not a measurement.
- Token figures are a status readout: provider-reported samples for the prompt side, heuristic
  repricing for surface movement. They are not billing numbers and may lag the current turn
  until the next request reports usage.
- The RMB figure is a local estimate from the four token buckets times a price table this
  plugin carries; it is not an invoice and does not know about discounts, free tiers, or a
  route whose prices differ from the defaults.

## Tests

Four suites, all runnable without a DSH install:

```sh
npm test            # offline render suite (hand-written React stand-in), 119 checks
npm run test:zh     # the same suite driving the Chinese dictionary
npm run test:host   # the Host half against a fake system-prompt/tools context
```

The stand-in verifies the rendered tree but cannot enforce React's hook rules, so a
fourth run renders the real entry with `react-dom` in jsdom and lets React itself
check them:

```sh
pnpm add react react-dom jsdom --dir "$env:TEMP\dsh-react-check" --registry=https://registry.npmmirror.com
set DSH_TEST_DEPS=%TEMP%\dsh-react-check\package.json
npm run test:dom    # 23 checks; exits 0 with SKIP when react-dom is absent
```

## Composition

`cordis.patch.yml` inserts the `run-progress` row. The browser half registers one entry in
`shell.overlay`, the frame-wide floating layer, so the rail never reflows the three-column
layout.