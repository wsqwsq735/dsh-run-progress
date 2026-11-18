/**
 * dsh-run-progress — browser half.
 *
 * Adds a live progress rail pinned to the far right edge of the DSH Web GUI and
 * a run-flow panel behind it.
 *
 * Placement: one entry in `shell.overlay`, the frame-wide floating layer above
 * every column and outside their scroll containers. The rail is fixed to the
 * window edge, so it sits at the far right of the application regardless of
 * which right sidebar tab is open, and it never reflows the layout.
 *
 * Data: the rail follows the Session the main conversation view retains
 * (`SessionSummary.retainedBy.mainView`), borrows its binding with
 * `ctx.sessions.binding()` (no extra retention), and reads two published faces
 * the client already holds — the contiguous event window
 * (`binding.eventSource`) for turn/step/tool records, and the `todos`
 * projection for plan progress. Nothing is written back to the session log.
 */

window.__ModuleLoader__.load({
  id: 'dsh-run-progress',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'run-progress'
    const ENTRY_ID = 'run-progress'
    /** How long the rail stays after a turn settles, so the finish is visible. */
    const RECENT_MS = 4000

    /* ---------------------------------------------------------------- copy -- */

    const DICT = {
      zh: {
        rail: '运行流程',
        railRunning: '运行中',
        railDone: '本轮已完成',
        railFailed: '本轮出错',
        openHint: '点击查看详细运行流程',
        panelTitle: '运行流程',
        close: '关闭',
        statusRunning: '运行中',
        statusDone: '已完成',
        statusFailed: '出错',
        statusAborted: '已中止',
        statusInterrupted: '已中断',
        statusBlocked: '已阻塞',
        statusMaxTokens: '达到上限',
        statusForked: '已分叉',
        turn: '第 {n} 轮',
        step: '第 {n} 步',
        tools: '{n} 个工具',
        toolRunning: '执行中',
        toolOk: '完成',
        toolFailed: '失败',
        todos: '任务进度',
        todosCount: '{done}/{total}',
        elapsed: '已用 {t}',
        empty: '本轮还没有步骤记录。',
        prompt: '请求',
        reply: '回复',
        tokens: 'Token 用量',
        context: '上下文',
        contextUsed: '已用 {used} / {window}',
        contextUsedOnly: '已用 {used}',
        input: '输入',
        cacheRead: '缓存读',
        cacheWrite: '缓存写',
        output: '输出',
        total: '会话累计',
        noTokens: '还没有上报 token 用量。',
        tokenChip: '上下文 {size}（{percent}%），点击查看运行流程',
        tokenChipNoWindow: '会话累计 {size} token，点击查看运行流程',
        chipDrag: '可拖动，双击复位',
        cost: '费用',
        costEstimate: '估算',
        rateBasis: '按 ¥{input} / ¥{cacheRead} / ¥{cacheWrite} / ¥{output} 每百万 token',
        rateModelBasis: '按 {model} 价目',
        expand: '点击展开详情',
        collapse: '点击收起详情',
        stepsCount: '{n} 步',
      },
      en: {
        rail: 'Run flow',
        railRunning: 'Running',
        railDone: 'Turn complete',
        railFailed: 'Turn failed',
        openHint: 'Open the run-flow panel',
        panelTitle: 'Run flow',
        close: 'Close',
        statusRunning: 'Running',
        statusDone: 'Completed',
        statusFailed: 'Failed',
        statusAborted: 'Aborted',
        statusInterrupted: 'Interrupted',
        statusBlocked: 'Blocked',
        statusMaxTokens: 'Token limit',
        statusForked: 'Forked',
        turn: 'Turn {n}',
        step: 'Step {n}',
        tools: '{n} tools',
        toolRunning: 'running',
        toolOk: 'done',
        toolFailed: 'failed',
        todos: 'Tasks',
        todosCount: '{done}/{total}',
        elapsed: '{t} elapsed',
        empty: 'No steps recorded in this turn yet.',
        prompt: 'Prompt',
        reply: 'Reply',
        tokens: 'Tokens',
        context: 'Context',
        contextUsed: '{used} / {window} used',
        contextUsedOnly: '{used} used',
        input: 'Input',
        cacheRead: 'Cache read',
        cacheWrite: 'Cache write',
        output: 'Output',
        total: 'Session total',
        noTokens: 'No token usage reported yet.',
        tokenChip: 'Context {size} ({percent}%), click to open the run flow',
        tokenChipNoWindow: '{size} tokens this session, click to open the run flow',
        chipDrag: 'drag to move, double-click to reset',
        cost: 'Cost',
        costEstimate: 'estimate',
        rateBasis: 'at ¥{input} / ¥{cacheRead} / ¥{cacheWrite} / ¥{output} per 1M tokens',
        rateModelBasis: 'priced at {model} rates',
        expand: 'click to expand the details',
        collapse: 'click to collapse the details',
        stepsCount: '{n} steps',
      },
    }

    /** Fallback language for the local dictionary when the host provides no `t`. */
    const FALLBACK_LANG = (() => {
      const nav = typeof navigator === 'undefined' ? '' : String(navigator.language || '')
      return nav.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
    })()

    function localText(lang, key, params) {
      const table = DICT[lang] || DICT.en
      const raw = table[key] !== undefined ? table[key] : DICT.en[key]
      if (raw === undefined) return key
      if (!params) return raw
      return raw.replace(/\{(\w+)\}/g, (whole, name) =>
        params[name] === undefined ? whole : String(params[name]),
      )
    }

    /**
     * Bind the host translator when the slot hands one over, falling back to
     * the bundle's own dictionary for any key the host namespace lacks.
     */
    function makeTranslate(hostT) {
      const fallback = (key, params) => localText(FALLBACK_LANG, key, params)
      if (typeof hostT !== 'function') return fallback
      return (key, params) => {
        let value
        try {
          value = hostT(key, params)
        } catch (error) {
          return fallback(key, params)
        }
        if (typeof value !== 'string' || value === '' || value === key) return fallback(key, params)
        return value
      }
    }

    /* -------------------------------------------------------------- format -- */

    /** Compact duration: `12s`, `1m23s`, `2h5m`; sub-second reads in ms. */
    function formatDuration(ms) {
      if (!(ms > 0)) return '0s'
      if (ms < 1000) return `${Math.floor(ms)}ms`
      const total = Math.floor(ms / 1000)
      if (total < 60) return `${total}s`
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      if (minutes < 60) return `${minutes}m${seconds}s`
      return `${Math.floor(minutes / 60)}h${minutes % 60}m`
    }

    /** Compact token count: `842`, `12.3k`, `1.4M`. */
    function formatTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return ''
      if (value < 1000) return String(Math.round(value))
      if (value < 100000) return `${(value / 1000).toFixed(1)}k`
      if (value < 1000000) return `${Math.round(value / 1000)}k`
      return `${(value / 1000000).toFixed(1)}M`
    }

    /** Occupancy band of a 0..1 ratio, used for colour on the token surfaces. */
    function usageLevel(ratio) {
      if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return 'ok'
      if (ratio >= 0.9) return 'high'
      if (ratio >= 0.75) return 'warn'
      return 'ok'
    }

    /**
     * Fold the two Host token projections into one display record.
     *
     * `contextPressure` carries the prompt side of the newest request (plus the
     * heuristic repricing since it was sampled) and the newest known window;
     * `tokenUsage` carries the whole-log buckets. Either may be absent — the
     * units are client-visible but a fresh Session has no sample yet.
     */
    function deriveUsage(tokenUsage, pressure) {
      const totals = tokenUsage && typeof tokenUsage === 'object' ? tokenUsage : {}
      const read = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
      const input = read(totals.uncachedInputTokens)
      const output = read(totals.outputTokens)
      const cacheRead = read(totals.cacheReadTokens)
      const cacheWrite = read(totals.cacheWriteTokens)
      const buckets = [input, output, cacheRead, cacheWrite]
      const total = buckets.some((value) => value !== undefined)
        ? buckets.reduce((sum, value) => sum + (value || 0), 0)
        : undefined
      const p = pressure && typeof pressure === 'object' ? pressure : {}
      const contextWindow = read(p.contextWindow)
      const used = read(p.projectedTokens) !== undefined ? read(p.projectedTokens) : read(p.pressureTokens)
      const ratio = contextWindow !== undefined && contextWindow > 0 && used !== undefined
        ? Math.min(1, used / contextWindow)
        : undefined
      return { input, output, cacheRead, cacheWrite, total, window: contextWindow, used, ratio }
    }

    /** One-line, whitespace-collapsed clip with an ellipsis when shortened. */
    function clip(text, limit) {
      const normalized = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
      if (normalized.length <= limit) return normalized
      return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
    }

    /** Space-joined text blocks of a message payload. */
    function textOfMessage(message) {
      if (!message) return ''
      const content = message.content
      if (!Array.isArray(content)) return ''
      let out = ''
      for (const block of content) {
        if (!block || block.type !== 'text' || typeof block.text !== 'string') continue
        out = out === '' ? block.text : `${out} ${block.text}`
        if (out.length > 400) break
      }
      return out
    }

    /** A short, human hint for one tool invocation's raw JSON arguments. */
    function hintOfArguments(raw, limit) {
      const cap = typeof limit === 'number' && limit > 0 ? limit : 72
      if (typeof raw !== 'string' || raw === '') return ''
      let args
      if (raw.length <= 4000) {
        try {
          args = JSON.parse(raw)
        } catch (error) {
          args = undefined
        }
      }
      if (args && typeof args === 'object' && !Array.isArray(args)) {
        const preferred = [
          'command',
          'file_path',
          'path',
          'pattern',
          'query',
          'url',
          'prompt',
          'description',
          'content',
          'text',
        ]
        for (const key of preferred) {
          const value = args[key]
          if (typeof value === 'string' && value !== '') return clip(value, cap)
        }
        for (const key of Object.keys(args)) {
          const value = args[key]
          if (typeof value === 'string' && value !== '') return clip(value, cap)
        }
        return clip(raw, cap)
      }
      return clip(raw, cap)
    }

    /* ---------------------------------------------------------------- fold -- */

    /** Index of the start of the Nth-newest turn, or 0 when the window is shorter. */
    function turnStartIndex(entries, maxTurns) {
      let seen = 0
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (!entry || entry.type !== 'event' || !entry.event) continue
        if (entry.event.type !== 'turn/start') continue
        seen += 1
        if (seen >= maxTurns) return index
      }
      return 0
    }

    function stepOf(turn, number) {
      for (let index = turn.steps.length - 1; index >= 0; index -= 1) {
        if (turn.steps[index].number === number) return turn.steps[index]
      }
      return undefined
    }

    /**
     * Fold the newest `maxTurns` turns out of the contiguous event window into
     * plain records: turn boundaries, steps, tool calls with their result and
     * duration, and short prompt/reply previews. Transient stream frames and
     * every other event type are skipped.
     */
    function foldFlow(entries, maxTurns) {
      if (!Array.isArray(entries) || entries.length === 0) return { turns: [] }
      const turns = []
      let turn
      const start = turnStartIndex(entries, maxTurns)
      for (let index = start; index < entries.length; index += 1) {
        const entry = entries[index]
        if (!entry || entry.type !== 'event' || !entry.event) continue
        const event = entry.event
        const data = event.data || {}
        if (event.type === 'turn/start') {
          turn = {
            number: data.turn,
            startedAt: event.time,
            endedAt: 0,
            reason: '',
            prompt: '',
            reply: '',
            model: '',
            steps: [],
            tools: [],
          }
          turns.push(turn)
          continue
        }
        if (!turn) continue
        switch (event.type) {
          case 'user/message': {
            if (turn.prompt !== '') break
            if (data.source && data.source.kind !== 'user') break
            const text = textOfMessage(data)
            turn.prompt = clip(text, 90)
            turn.promptText = clip(text, 2000)
            break
          }
          case 'step/start': {
            turn.steps.push({ number: data.step, startedAt: event.time, endedAt: 0, tools: [] })
            break
          }
          case 'step/end': {
            const step = stepOf(turn, data.step)
            if (step) step.endedAt = event.time
            break
          }
          case 'tool/call': {
            const tool = {
              callId: data.callId,
              name: String(data.name || ''),
              hint: hintOfArguments(data.arguments),
              hintFull: hintOfArguments(data.arguments, 600),
              startedAt: event.time,
              endedAt: 0,
              status: 'running',
              isError: false,
            }
            turn.tools.push(tool)
            const step = stepOf(turn, data.step)
            if (step) step.tools.push(tool)
            break
          }
          case 'tool/result': {
            const message = data.message || {}
            let tool
            for (let i = turn.tools.length - 1; i >= 0; i -= 1) {
              if (turn.tools[i].callId === message.toolCallId) {
                tool = turn.tools[i]
                break
              }
            }
            if (tool) {
              tool.endedAt = event.time
              tool.isError = message.isError === true
              tool.status = tool.isError ? 'failed' : 'done'
            }
            break
          }
          case 'assistant/message': {
            const text = textOfMessage(data.message)
            if (text !== '') {
              turn.reply = clip(text, 140)
              turn.replyText = clip(text, 4000)
            }
            // The settlement names the provider route it came from, which is what
            // makes per-model pricing possible: the turn remembers its own model.
            const source = data.message && data.message.source
            if (source && typeof source.model === 'string' && source.model !== '') turn.model = source.model
            // Provider-reported usage of this settlement, attributed to its own
            // turn: the per-turn figures the panel shows beside the session total.
            const usage = data.usage
            if (usage && typeof usage === 'object') {
              const read = (value) =>
                typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
              if (!turn.usage) turn.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
              turn.usage.input += read(usage.inputTokens)
              turn.usage.output += read(usage.outputTokens)
              turn.usage.cacheRead += read(usage.cacheReadTokens)
              turn.usage.cacheWrite += read(usage.cacheWriteTokens)
            }
            break
          }
          case 'turn/end': {
            turn.endedAt = event.time
            const reason = data.reason
            turn.reason =
              typeof reason === 'string'
                ? reason
                : reason && typeof reason.kind === 'string'
                  ? reason.kind
                  : 'completed'
            break
          }
          default:
            break
        }
      }
      return { turns }
    }

    /** Aggregate numbers the rail and the panel header share. */
    function summarize(turns, todos) {
      const current = turns.length > 0 ? turns[turns.length - 1] : undefined
      const tools = current ? current.tools : []
      let done = 0
      let failed = 0
      let runningTool
      for (const tool of tools) {
        if (tool.status === 'done') done += 1
        else if (tool.status === 'failed') failed += 1
        else if (!runningTool) runningTool = tool
      }
      const lastStep = current && current.steps.length > 0 ? current.steps[current.steps.length - 1] : undefined
      const items = Array.isArray(todos) ? todos : []
      let completed = 0
      for (const item of items) {
        if (item && item.status === 'completed') completed += 1
      }
      return {
        current,
        toolCount: tools.length,
        done,
        failed,
        runningTool,
        step: lastStep ? lastStep.number : 0,
        todos: items,
        hasTodos: items.length > 0,
        completed,
        fraction: items.length > 0 ? completed / items.length : 0,
        ended: current ? current.endedAt > 0 : false,
      }
    }

    function statusKey(reason) {
      switch (reason) {
        case 'completed':
          return 'statusDone'
        case 'error':
          return 'statusFailed'
        case 'aborted':
          return 'statusAborted'
        case 'interrupted':
          return 'statusInterrupted'
        case 'blocked':
          return 'statusBlocked'
        case 'max-tokens':
          return 'statusMaxTokens'
        case 'forked':
          return 'statusForked'
        default:
          return ''
      }
    }

    /* --------------------------------------------------------------- hooks -- */

    const noopSubscribe = () => () => {}

    /** React 18 `useSyncExternalStore`, with a small fallback for older tables. */
    const useStore =
      typeof React.useSyncExternalStore === 'function'
        ? React.useSyncExternalStore.bind(React)
        : function useStoreFallback(subscribe, getSnapshot) {
            const [value, setValue] = React.useState(getSnapshot)
            React.useEffect(() => {
              const update = () => setValue(() => getSnapshot())
              update()
              return subscribe(update)
            }, [subscribe, getSnapshot])
            return value
          }

    /** The Session the main conversation view retains, exactly as session slots see it. */
    function useMainSessionId(useSessions) {
      return useSessions((state) => {
        if (!state || !state.byId) return undefined
        const ids = Array.isArray(state.ids) ? state.ids : Object.keys(state.byId)
        for (const id of ids) {
          const row = state.byId[id]
          const counts = row && row.retainedBy
          if (counts && (counts.mainView || 0) > 0) return id
        }
        return undefined
      })
    }

    function useSessionTitle(useSessions, sessionId) {
      return useSessions((state) => {
        if (!sessionId || !state || !state.byId) return ''
        const row = state.byId[sessionId]
        return row && typeof row.displayTitle === 'string' ? row.displayTitle : ''
      })
    }

    /** Borrow the live binding without extending the Session's lifetime. */
    function useBinding(sessions, sessionId) {
      const info = React.useMemo(() => {
        if (!sessions || !sessionId) return undefined
        try {
          return sessions.retainInfo(sessionId)
        } catch (error) {
          return undefined
        }
      }, [sessions, sessionId])
      const subscribe = React.useMemo(
        () => (info ? (listener) => info.subscribe(listener) : noopSubscribe),
        [info],
      )
      const getSnapshot = React.useMemo(
        () => () => {
          if (!sessions || !sessionId) return undefined
          try {
            return sessions.binding(sessionId)
          } catch (error) {
            return undefined
          }
        },
        [sessions, sessionId],
      )
      return useStore(subscribe, getSnapshot)
    }

    /**
     * Identity key of a window's DURABLE events only.
     *
     * The live assistant stream appends transient frames (`assistant/live-chunk`)
     * to the same window on every token, and this entry never reads them: folding
     * them would re-run the whole turn fold — tool arguments included — once per
     * token. Comparing this key instead of the window reference keeps a
     * transient-only append from re-rendering the entry at all.
     */
    function durableWindowKey(window) {
      const entries = window && Array.isArray(window.entries) ? window.entries : undefined
      if (!entries) return 'none'
      let durable = 0
      let first = 0
      let last = 0
      for (const entry of entries) {
        if (!entry || entry.type !== 'event' || !entry.event) continue
        const seq = entry.event.seq
        if (typeof seq !== 'number') continue
        durable += 1
        if (durable === 1) first = seq
        last = seq
      }
      return `${durable}:${first}:${last}:${window && window.hasMore ? 1 : 0}`
    }

    /** The event window with an identity that only changes when a durable event lands. */
    function useDurableWindow(source) {
      const subscribe = React.useMemo(
        () => (source ? (listener) => source.subscribe(listener) : noopSubscribe),
        [source],
      )
      const getSnapshot = React.useMemo(() => {
        if (!source) return () => undefined
        let cached
        let cachedKey
        return () => {
          const window = source.getSnapshot()
          if (!window || !Array.isArray(window.entries)) return window
          const key = durableWindowKey(window)
          if (cached !== undefined && cachedKey === key) return cached
          cached = window
          cachedKey = key
          return window
        }
      }, [source])
      return useStore(subscribe, getSnapshot)
    }

    function useSnapshotSource(source, empty) {
      const subscribe = React.useMemo(
        () => (source ? (listener) => source.subscribe(listener) : noopSubscribe),
        [source],
      )
      const getSnapshot = React.useMemo(
        () => (source ? () => source.getSnapshot() : () => empty),
        [source, empty],
      )
      return useStore(subscribe, getSnapshot)
    }

    function useProjectionValue(session, key) {
      const face = React.useMemo(() => {
        if (!session || !session.projections) return undefined
        try {
          return session.projections.faceOf(key)
        } catch (error) {
          return undefined
        }
      }, [session, key])
      return useSnapshotSource(face, undefined)
    }

    /** Re-render once a second while `active`, so elapsed time and the fade-out stay live. */
    function useNow(active) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (!active) return undefined
        setNow(Date.now())
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
      }, [active])
      return now
    }

    /* ----------------------------------------------------------- components -- */

    function Rail(props) {
      const { open, t, summary, phase, percent, usage, onToggle, now } = props
      const current = summary.current
      let label = t('rail')
      if (current && !summary.ended) {
        label = [t('railRunning'), t('turn', { n: current.number })]
          .concat(summary.step > 0 ? [t('step', { n: summary.step })] : [])
          .concat(summary.toolCount > 0 ? [t('tools', { n: summary.toolCount })] : [])
          .join(' · ')
      } else if (current) {
        const head = phase === 'failed' ? t('railFailed') : t('railDone')
        label = [head, formatDuration((current.endedAt || now) - current.startedAt)].join(' · ')
      } else {
        label = t('rail')
      }
      if (summary.hasTodos) label = `${label} · ${t('todosCount', { done: summary.completed, total: summary.todos.length })}`
      if (usage.used !== undefined) {
        label = `${label} · ${t('context')} ${
          usage.window !== undefined
            ? t('contextUsed', { used: formatTokens(usage.used), window: formatTokens(usage.window) })
            : t('contextUsedOnly', { used: formatTokens(usage.used) })
        }`
      }
      return h(
        'button',
        {
          type: 'button',
          className: 'drp-rail' + (open ? ' drp-rail-open' : ''),
          title: `${label} — ${t('openHint')}`,
          'aria-label': label,
          'aria-expanded': open ? 'true' : 'false',
          'aria-controls': 'drp-panel',
          onClick: onToggle,
        },
        h(
          'span',
          { className: 'drp-tracks', 'aria-hidden': 'true' },
          h(
            'span',
            { className: 'drp-track' },
            summary.hasTodos
              ? h('span', {
                  className: 'drp-fill',
                  'data-phase': phase,
                  style: { height: `${Math.round(percent * 100)}%` },
                })
              : h('span', { className: 'drp-pulse', 'data-phase': phase }),
          ),
          usage.ratio !== undefined
            ? h(
                'span',
                { className: 'drp-track' },
                h('span', {
                  className: 'drp-fill',
                  'data-phase': usageLevel(usage.ratio),
                  style: { height: `${Math.round(usage.ratio * 100)}%` },
                }),
              )
            : null,
        ),
        // The visible number is the task progress whenever the agent keeps a list,
        // so it matches the bar it sits beside; without a list it falls back to
        // context occupancy rather than printing elapsed time at the edge.
        summary.hasTodos
          ? h('span', { className: 'drp-pct', 'aria-hidden': 'true' }, `${Math.round(percent * 100)}%`)
          : usage.ratio !== undefined
            ? h(
                'span',
                { className: 'drp-pct', 'data-level': usageLevel(usage.ratio), 'aria-hidden': 'true' },
                `${Math.round(usage.ratio * 100)}%`,
              )
            : null,
      )
    }

    /**
     * Estimate rate for the token → RMB conversion, CNY per 1M tokens.
     *
     * DeepSeek publishes cache-hit / cache-miss input and output prices; a cache
     * write is billed at the miss rate here. These defaults are an ESTIMATE: the
     * panel always shows the numbers it used, and a user can replace them in this
     * browser with `localStorage['dsh-run-progress:pricing']` holding
     * `{"input":2,"cacheRead":0.2,"cacheWrite":2,"output":3}`.
     */
    const DEFAULT_PRICING = { input: 2, cacheRead: 0.2, cacheWrite: 2, output: 3 }
    const PRICING_STORAGE_KEY = 'dsh-run-progress:pricing'

    /** One rate row; unusable fields keep the default, so a partial row is safe. */
    function normalizeRates(value) {
      if (!value || typeof value !== 'object') return undefined
      const rates = { ...DEFAULT_PRICING }
      let touched = false
      for (const key of Object.keys(DEFAULT_PRICING)) {
        const amount = value[key]
        if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) {
          rates[key] = amount
          touched = true
        }
      }
      return touched ? rates : undefined
    }

    /**
     * The stored price table.
     *
     * v1 was one flat rate row for every model. v2 keeps that row as `default`
     * and adds a row per provider model id, so a flash turn and a pro turn are
     * not priced as if they cost the same. A v1 value is still understood.
     */
    function normalizePricing(value) {
      const table = { default: { ...DEFAULT_PRICING }, models: {} }
      if (!value || typeof value !== 'object') return table
      const flat = normalizeRates(value)
      if (flat) {
        table.default = flat
        return table
      }
      const base = normalizeRates(value.default)
      if (base) table.default = base
      if (value.models && typeof value.models === 'object') {
        for (const id of Object.keys(value.models)) {
          const rates = normalizeRates(value.models[id])
          if (rates && id !== '') table.models[id] = rates
        }
      }
      return table
    }

    /** The row a model resolves to, and the model id when a specific row matched. */
    function ratesFor(pricing, model) {
      const table = pricing && pricing.default && pricing.models ? pricing : normalizePricing(pricing)
      const id = typeof model === 'string' ? model : ''
      const row = id !== '' && table.models[id] ? table.models[id] : table.default
      return { rates: row || DEFAULT_PRICING, model: id !== '' && table.models[id] ? id : '' }
    }

    /** The price table this browser saved, normalised; a blocked store keeps defaults. */
    function readStoredPricing() {
      try {
        if (typeof localStorage === 'undefined') return normalizePricing(undefined)
        const raw = localStorage.getItem(PRICING_STORAGE_KEY)
        if (!raw) return normalizePricing(undefined)
        return normalizePricing(JSON.parse(raw))
      } catch (error) {
        return normalizePricing(undefined)
      }
    }

    /** Estimated CNY cost of the four buckets at the row this model resolves to. */
    function costOf(usage, pricing, model) {
      const resolved = ratesFor(pricing, model)
      const rates = resolved.rates
      const part = (tokens, rate) =>
        typeof tokens === 'number' && Number.isFinite(tokens) ? (tokens / 1_000_000) * rate : 0
      const input = part(usage.input, rates.input)
      const cacheRead = part(usage.cacheRead, rates.cacheRead)
      const cacheWrite = part(usage.cacheWrite, rates.cacheWrite)
      const output = part(usage.output, rates.output)
      const known = [usage.input, usage.cacheRead, usage.cacheWrite, usage.output].some(
        (value) => typeof value === 'number' && Number.isFinite(value),
      )
      return {
        input,
        cacheRead,
        cacheWrite,
        output,
        total: input + cacheRead + cacheWrite + output,
        known,
        rates,
        model: resolved.model,
      }
    }

    /** Money at a precision that keeps sub-cent estimates readable. */
    function formatCny(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      if (value < 0.01) return `¥${value.toFixed(4)}`
      if (value < 1) return `¥${value.toFixed(3)}`
      return `¥${value.toFixed(2)}`
    }

    /** In-flight drag of the token pill; exactly one pill exists at a time. */
    let chipDrag = null

    /** Clear the in-flight drag and release pointer capture. */
    function finishChipDrag(event) {
      const state = chipDrag
      chipDrag = null
      const target = event && event.currentTarget
      if (
        state &&
        target &&
        typeof target.releasePointerCapture === 'function' &&
        state.pointerId !== undefined
      ) {
        try {
          target.releasePointerCapture(state.pointerId)
        } catch (error) {
          // Capture may already be gone; nothing else to release.
        }
      }
      return state
    }

    /**
     * Locally remembered position of the token pill, in pixels from the
     * window's right and top edges. Kept out of the Session log: it is a browser
     * preference, not session data.
     */
    const CHIP_STORAGE_KEY = 'dsh-run-progress:chip-position'

    /** Live window size, with a plausible fallback outside a browser. */
    function viewportSize() {
      return {
        width: typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280,
        height: typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800,
      }
    }

    /** Keep a dragged pill inside the window (exported for the smoke test). */
    function clampChipPosition(position, viewport) {
      const size = viewport || viewportSize()
      const width = size.width > 0 ? size.width : 1280
      const height = size.height > 0 ? size.height : 800
      const right = Math.min(Math.max(Number(position.right) || 0, 4), Math.max(4, width - 56))
      const top = Math.min(Math.max(Number(position.top) || 0, 4), Math.max(4, height - 28))
      return { right: Math.round(right), top: Math.round(top) }
    }

    function readStoredChipPosition() {
      try {
        if (typeof localStorage === 'undefined') return undefined
        const raw = localStorage.getItem(CHIP_STORAGE_KEY)
        if (!raw) return undefined
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return undefined
        if (!Number.isFinite(parsed.right) || !Number.isFinite(parsed.top)) return undefined
        return clampChipPosition(parsed, viewportSize())
      } catch (error) {
        return undefined
      }
    }

    function storeChipPosition(position) {
      try {
        if (typeof localStorage === 'undefined') return
        if (!position) localStorage.removeItem(CHIP_STORAGE_KEY)
        else localStorage.setItem(CHIP_STORAGE_KEY, JSON.stringify(position))
      } catch (error) {
        // Blocked or full storage must not break the pill.
      }
    }

    /**
     * Compact token readout below the rail: sizes only, since the rail's
     * vertical label carries the percentage. It stays visible whenever the
     * Session has any token record, running or not, and can be dragged anywhere
     * on the window; the position survives reloads and a double-click returns it
     * to the default seat under the rail.
     */
    function TokenChip(props) {
      const { t, usage, cost, onToggle, position, onMove, onCommit, onReset } = props
      if (usage.used === undefined && usage.total === undefined) return null
      const percent = usage.ratio !== undefined ? Math.round(usage.ratio * 100) : undefined
      const size = usage.used !== undefined ? formatTokens(usage.used) : formatTokens(usage.total)
      const detail =
        usage.window !== undefined
          ? t('contextUsed', { used: size, window: formatTokens(usage.window) })
          : t('contextUsedOnly', { used: size })
      const money = cost && cost.known ? `≈${formatCny(cost.total)}` : ''
      const title = [
        percent !== undefined
          ? t('tokenChip', { size: detail, percent })
          : t('tokenChipNoWindow', { size: size || detail }),
        money === '' ? '' : `${t('cost')} ${money}${t('costEstimate')}`,
        t('chipDrag'),
      ]
        .filter(Boolean)
        .join(' · ')
      const base =
        usage.used !== undefined && usage.window !== undefined
          ? `${size}/${formatTokens(usage.window)}`
          : size
      const text = money === '' ? base : `${base} · ${money}`
      return h(
        'button',
        {
          type: 'button',
          className: 'drp-tokens' + (chipDrag && chipDrag.moved ? ' drp-tokens-dragging' : ''),
          'data-level': usageLevel(usage.ratio),
          'data-draggable': 'true',
          title: `${title} · ${t('chipDrag')}`,
          'aria-label': title,
          style: position ? { right: `${position.right}px`, top: `${position.top}px` } : undefined,
          onClick: (event) => {
            // A keyboard activation has no pointer sequence; a drag must not toggle.
            if (!event || event.detail === 0) onToggle()
          },
          onDoubleClick: () => onReset(),
          onPointerDown: (event) => {
            if (event && event.button !== undefined && event.button !== 0) return
            const target = event && event.currentTarget
            if (!target || typeof target.getBoundingClientRect !== 'function') return
            const rect = target.getBoundingClientRect()
            chipDrag = {
              pointerId: event.pointerId,
              startX: event.clientX || 0,
              startY: event.clientY || 0,
              right: viewportSize().width - rect.right,
              top: rect.top,
              moved: false,
            }
            if (typeof target.setPointerCapture === 'function' && event.pointerId !== undefined) {
              try {
                target.setPointerCapture(event.pointerId)
              } catch (error) {
                // Capture is a convenience; dragging still works without it.
              }
            }
          },
          onPointerMove: (event) => {
            if (!chipDrag) return
            // A lost release (no pointer capture) must not leave a "drag" armed.
            if (typeof event.buttons === 'number' && event.buttons === 0) {
              finishChipDrag(event)
              return
            }
            const dx = (event.clientX || 0) - chipDrag.startX
            const dy = (event.clientY || 0) - chipDrag.startY
            if (!chipDrag.moved && Math.abs(dx) + Math.abs(dy) < 4) return
            chipDrag.moved = true
            const next = clampChipPosition(
              { right: chipDrag.right - dx, top: chipDrag.top + dy },
              viewportSize(),
            )
            chipDrag.last = next
            onMove(next)
          },
          onPointerUp: (event) => {
            const state = finishChipDrag(event)
            if (!state) return
            // Persist once per gesture instead of on every pointer move.
            if (state.moved) {
              if (state.last) onCommit(state.last)
            } else {
              onToggle()
            }
          },
          onPointerCancel: (event) => {
            const state = finishChipDrag(event)
            if (state && state.moved && state.last) onCommit(state.last)
          },
          onLostPointerCapture: () => {
            const state = chipDrag
            chipDrag = null
            if (state && state.moved && state.last) onCommit(state.last)
          },
        },
        h('span', { className: 'drp-tokens-text' }, text),
      )
    }

    function ToolRow(props) {
      const { tool, t, now, full } = props
      const duration = tool.endedAt > 0 ? tool.endedAt - tool.startedAt : tool.startedAt > 0 ? now - tool.startedAt : 0
      const status = tool.status === 'failed' ? t('toolFailed') : tool.status === 'done' ? t('toolOk') : t('toolRunning')
      if (full) {
        return h(
          'div',
          { className: 'drp-tool drp-tool-full' },
          h(
            'span',
            { className: 'drp-tool-line' },
            h('span', { className: 'drp-dot', 'data-s': tool.status, 'aria-hidden': 'true' }),
            h('span', { className: 'drp-name' }, tool.name || 'tool'),
            h('span', { className: 'drp-dur', title: status }, formatDuration(duration)),
          ),
          tool.hintFull ? h('span', { className: 'drp-tool-args' }, tool.hintFull) : null,
        )
      }
      return h(
        'div',
        { className: 'drp-tool' },
        h('span', { className: 'drp-dot', 'data-s': tool.status, 'aria-hidden': 'true' }),
        h('span', { className: 'drp-name' }, tool.name || 'tool'),
        tool.hint ? h('span', { className: 'drp-detail', title: tool.hint }, tool.hint) : null,
        h('span', { className: 'drp-dur', title: status }, formatDuration(duration)),
      )
    }

    /**
     * One turn card. The header is the only switch: nothing expands on hover, a
     * click opens that turn's full detail (every step, every tool with its whole
     * argument summary, and untruncated prompt/reply text) and a second click
     * closes it. The summary, one-line previews and the per-turn Token line stay
     * visible in both states.
     */
    function TurnBlock(props) {
      const { turn, t, now, newest, pricing, expanded, onToggle } = props
      const elapsed = (turn.endedAt > 0 ? turn.endedAt : now) - turn.startedAt
      const turnCost = costOf(turn.usage || {}, pricing, turn.model)
      const reasonKey = statusKey(turn.reason)
      const state = turn.endedAt === 0 ? t('statusRunning') : reasonKey ? t(reasonKey) : ''
      return h(
        'section',
        {
          className: 'drp-turn' + (newest ? ' drp-turn-newest' : '') + (expanded ? ' drp-turn-open' : ''),
          'data-expanded': expanded ? 'true' : 'false',
        },
        h(
          'button',
          {
            type: 'button',
            className: 'drp-turn-head drp-turn-toggle',
            'aria-expanded': expanded ? 'true' : 'false',
            title: expanded ? t('collapse') : t('expand'),
            onClick: () => onToggle(turn.number),
          },
          h('span', { className: 'drp-chevron', 'aria-hidden': 'true' }, '▸'),
          h('span', { className: 'drp-turn-title' }, t('turn', { n: turn.number })),
          h('span', { className: 'drp-sep', 'aria-hidden': 'true' }, '·'),
          h('span', null, state),
          h('span', { className: 'drp-turn-summary' }, t('stepsCount', { n: turn.steps.length })),
          h('span', { className: 'drp-dur drp-dur-end' }, formatDuration(elapsed)),
        ),
        turn.prompt
          ? h(
              'div',
              { className: 'drp-line' },
              h('span', { className: 'drp-line-key' }, t('prompt')),
              h('span', { className: 'drp-line-value', title: turn.promptText || turn.prompt }, turn.prompt),
            )
          : null,
        turn.reply
          ? h(
              'div',
              { className: 'drp-line drp-line-reply' },
              h('span', { className: 'drp-line-key' }, t('reply')),
              h('span', { className: 'drp-line-value', title: turn.replyText || turn.reply }, turn.reply),
            )
          : null,
        turn.usage
          ? h(
              'div',
              { className: 'drp-turn-tokens' },
              h(
                'div',
                { className: 'drp-turn-tokens-head' },
                h('span', null, t('tokens')),
                h(
                  'span',
                  {
                    className: 'drp-turn-cost',
                    // The tooltip names the price row this turn was billed at, so a
                    // per-model table is auditable per turn instead of only in total.
                    title: turnCost.model
                      ? `${t('costEstimate')} · ${t('rateModelBasis', { model: turnCost.model })}`
                      : t('costEstimate'),
                  },
                  `≈${formatCny(turnCost.total)}`,
                ),
              ),
              h(
                'span',
                { className: 'drp-turn-tokens-parts' },
                [
                  `${t('input')} ${formatTokens(turn.usage.input)}`,
                  `${t('cacheRead')} ${formatTokens(turn.usage.cacheRead)}`,
                  `${t('cacheWrite')} ${formatTokens(turn.usage.cacheWrite)}`,
                  `${t('output')} ${formatTokens(turn.usage.output)}`,
                ].join(' · '),
              ),
            )
          : null,
        h(
          'div',
          { className: 'drp-turn-detail' },
          turn.promptText
            ? h(
                'div',
                { className: 'drp-detail-block' },
                h('span', { className: 'drp-detail-key' }, t('prompt')),
                h('span', { className: 'drp-detail-text' }, turn.promptText),
              )
            : null,
          turn.steps.length > 0
            ? turn.steps.map((step) =>
                h(
                  'div',
                  { className: 'drp-step', key: `step-${turn.number}-${step.number}` },
                  h(
                    'div',
                    { className: 'drp-step-head' },
                    h('span', null, t('step', { n: step.number })),
                    step.tools.length > 0
                      ? h('span', { className: 'drp-sep', 'aria-hidden': 'true' }, '·')
                      : null,
                    step.tools.length > 0 ? h('span', null, t('tools', { n: step.tools.length })) : null,
                    step.endedAt > 0
                      ? h(
                          'span',
                          { className: 'drp-dur drp-dur-end' },
                          formatDuration(step.endedAt - step.startedAt),
                        )
                      : null,
                  ),
                  step.tools.map((tool) =>
                    h(ToolRow, { key: `tool-${tool.callId}`, tool, t, now, full: true }),
                  ),
                ),
              )
            : h('div', { className: 'drp-empty' }, t('empty')),
          turn.replyText
            ? h(
                'div',
                { className: 'drp-detail-block' },
                h('span', { className: 'drp-detail-key' }, t('reply')),
                h('span', { className: 'drp-detail-text' }, turn.replyText),
              )
            : null,
        ),
      )
    }

    /**
     * Token block of the panel: context occupancy with its banded bar, the four
     * disjoint whole-log buckets, and the Session total.
     */
    function TokenBlock(props) {
      const { t, usage, cost } = props
      const hasUsage =
        usage.input !== undefined ||
        usage.output !== undefined ||
        usage.cacheRead !== undefined ||
        usage.cacheWrite !== undefined
      const percent = usage.ratio !== undefined ? Math.round(usage.ratio * 100) : undefined
      const head =
        usage.window !== undefined && usage.used !== undefined
          ? t('contextUsed', { used: formatTokens(usage.used), window: formatTokens(usage.window) })
          : usage.used !== undefined
            ? t('contextUsedOnly', { used: formatTokens(usage.used) })
            : ''
      const bucket = (key, label, value) =>
        value === undefined
          ? null
          : h(
              'span',
              { className: 'drp-bucket', key },
              h('span', null, label),
              h('span', { className: 'drp-bucket-value' }, formatTokens(value)),
            )
      return h(
        'section',
        { className: 'drp-tokens-block' },
        h(
          'div',
          { className: 'drp-tokens-head' },
          h('span', null, t('tokens')),
          h('span', { className: 'drp-tokens-count' }, percent !== undefined ? `${head} · ${percent}%` : head),
        ),
        usage.ratio !== undefined
          ? h(
              'div',
              { className: 'drp-tokens-bar' },
              h('span', {
                className: 'drp-tokens-fill',
                'data-level': usageLevel(usage.ratio),
                style: { width: `${percent}%` },
              }),
            )
          : null,
        hasUsage
          ? h(
              'div',
              { className: 'drp-buckets' },
              bucket('input', t('input'), usage.input),
              bucket('cacheRead', t('cacheRead'), usage.cacheRead),
              bucket('cacheWrite', t('cacheWrite'), usage.cacheWrite),
              bucket('output', t('output'), usage.output),
            )
          : h('div', { className: 'drp-empty' }, t('noTokens')),
        usage.total !== undefined
          ? h(
              'div',
              { className: 'drp-bucket drp-bucket-total' },
              h('span', null, t('total')),
              h('span', { className: 'drp-bucket-value' }, formatTokens(usage.total)),
            )
          : null,
        cost && cost.known
          ? h(
              'div',
              { className: 'drp-cost' },
              h(
                'div',
                { className: 'drp-cost-head' },
                h('span', null, t('cost')),
                h('span', { className: 'drp-cost-value', title: `${t('costEstimate')} ≈${formatCny(cost.total)}` }, `≈${formatCny(cost.total)}`),
              ),
              h(
                'div',
                { className: 'drp-cost-parts' },
                [
                  `${t('input')} ${formatCny(cost.input)}`,
                  `${t('cacheRead')} ${formatCny(cost.cacheRead)}`,
                  `${t('cacheWrite')} ${formatCny(cost.cacheWrite)}`,
                  `${t('output')} ${formatCny(cost.output)}`,
                ].join(' · '),
              ),
              cost.model
                ? h('div', { className: 'drp-cost-rate drp-cost-model' }, t('rateModelBasis', { model: cost.model }))
                : null,
              h(
                'div',
                { className: 'drp-cost-rate' },
                t('rateBasis', {
                  input: cost.rates.input,
                  cacheRead: cost.rates.cacheRead,
                  cacheWrite: cost.rates.cacheWrite,
                  output: cost.rates.output,
                }),
              ),
            )
          : null,
      )
    }

    function Panel(props) {
      const { t, title, summary, turns, phase, percent, usage, cost, pricing, expandedTurn, onToggleTurn, now, onClose } = props
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      const current = summary.current
      const elapsed = current ? (current.endedAt > 0 ? current.endedAt : now) - current.startedAt : 0
      const reasonKey = current ? statusKey(current.reason) : ''
      const headState =
        !current || (current.endedAt === 0 && !summary.ended)
          ? t('statusRunning')
          : reasonKey
            ? t(reasonKey)
            : t('statusDone')
      const newest = turns.length > 0 ? turns[turns.length - 1] : undefined
      return h(
        'aside',
        { className: 'drp-panel', id: 'drp-panel', role: 'dialog', 'aria-label': t('panelTitle') },
        h(
          'header',
          { className: 'drp-head' },
          h(
            'div',
            { className: 'drp-head-main' },
            h('div', { className: 'drp-title' }, t('panelTitle')),
            h(
              'div',
              { className: 'drp-sub', title: title || '' },
              [headState, title].filter(Boolean).join(' · '),
            ),
            h(
              'div',
              { className: 'drp-meta' },
              current ? h('span', null, t('turn', { n: current.number })) : null,
              current && summary.step > 0 ? h('span', null, t('step', { n: summary.step })) : null,
              summary.toolCount > 0
                ? h(
                    'span',
                    null,
                    `${t('tools', { n: summary.toolCount })}${summary.failed > 0 ? ` (${summary.failed} ${t('toolFailed')})` : ''}`,
                  )
                : null,
              current ? h('span', null, t('elapsed', { t: formatDuration(elapsed) })) : null,
            ),
          ),
          h(
            'button',
            { type: 'button', className: 'drp-x', onClick: onClose, title: t('close'), 'aria-label': t('close') },
            '✕',
          ),
        ),
        h(
          'div',
          { className: 'drp-body' },
          h(TokenBlock, { key: 'tokens', t, usage, cost }),
          summary.hasTodos
            ? h(
                'div',
                { className: 'drp-todos' },
                h(
                  'div',
                  { className: 'drp-todos-head' },
                  h('span', null, t('todos')),
                  h(
                    'span',
                    { className: 'drp-todos-count' },
                    `${t('todosCount', { done: summary.completed, total: summary.todos.length })} · ${Math.round(percent * 100)}%`,
                  ),
                ),
                h(
                  'div',
                  { className: 'drp-todos-bar' },
                  h('span', { className: 'drp-todos-fill', style: { width: `${Math.round(percent * 100)}%` } }),
                ),
                h(
                  'ul',
                  { className: 'drp-todos-list' },
                  summary.todos.map((item, index) =>
                    h(
                      'li',
                      { className: 'drp-todo', 'data-s': item.status, key: `todo-${index}` },
                      h('span', { className: 'drp-todo-mark', 'aria-hidden': 'true' }, item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '•' : '○'),
                      h('span', { className: 'drp-todo-text', title: item.content }, item.content),
                    ),
                  ),
                ),
              )
            : null,
          turns.length === 0
            ? h('div', { className: 'drp-empty drp-empty-block' }, t('empty'))
            : turns
                .slice()
                .reverse()
                .map((turn) =>
                  h(TurnBlock, {
                    key: `turn-${turn.number}`,
                    turn,
                    t,
                    now,
                    newest: turn === newest,
                    pricing,
                    expanded: expandedTurn === turn.number,
                    onToggle: onToggleTurn,
                  }),
                ),
        ),
      )
    }

    function RunProgress(props) {
      const { useSessions, sessionsApi } = props
      const t = React.useMemo(() => makeTranslate(props.t), [props.t])
      const sessionId = useMainSessionId(useSessions)
      const title = useSessionTitle(useSessions, sessionId)
      const binding = useBinding(sessionsApi, sessionId)
      const session = binding ? binding.session : undefined
      const snapshot = useSnapshotSource(session, undefined)
      const eventWindow = useDurableWindow(binding ? binding.eventSource : undefined)
      const todos = useProjectionValue(session, 'todos')
      const tokenUsage = useProjectionValue(session, 'tokenUsage')
      const contextPressure = useProjectionValue(session, 'contextPressure')
      const [open, setOpen] = React.useState(false)
      const [expandedTurn, setExpandedTurn] = React.useState(null)
      // A remembered position is read after mount: the first render must not
      // touch browser storage, and a blocked storage must not break the pill.
      const [chipPosition, setChipPosition] = React.useState(undefined)
      const [pricing, setPricing] = React.useState(DEFAULT_PRICING)
      React.useEffect(() => {
        setPricing(readStoredPricing())
      }, [])
      React.useEffect(() => {
        setChipPosition(readStoredChipPosition())
      }, [])
      React.useEffect(() => {
        // An expanded card belongs to the Session it was opened in.
        setExpandedTurn(null)
      }, [sessionId])
      const moveChip = (next) => setChipPosition(next)
      const commitChip = (next) => storeChipPosition(next)
      const resetChip = () => {
        setChipPosition(undefined)
        storeChipPosition(undefined)
      }
      React.useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const onResize = () => {
          setChipPosition((current) => (current ? clampChipPosition(current, viewportSize()) : current))
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      const running = !!(snapshot && snapshot.running)
      const entries = eventWindow && Array.isArray(eventWindow.entries) ? eventWindow.entries : undefined
      const flow = React.useMemo(() => foldFlow(entries, open ? 8 : 1), [entries, open])
      const summary = React.useMemo(() => summarize(flow.turns, todos), [flow, todos])
      const usage = React.useMemo(() => deriveUsage(tokenUsage, contextPressure), [tokenUsage, contextPressure])
      const cost = React.useMemo(() => {
        const model = summary.current && summary.current.model ? summary.current.model : ''
        return costOf(usage, pricing, model)
      }, [usage, pricing, summary])
      const current = summary.current
      const endedAt = current && current.endedAt > 0 ? current.endedAt : 0

      // Stay on screen for a moment after the turn settles, so the finish is
      // visible without a second state machine: the clock read is pure per
      // render decision and the ticker below re-evaluates it.
      const clock = Date.now()
      const endedRecently = endedAt > 0 && clock >= endedAt && clock - endedAt < RECENT_MS
      const railVisible = running || endedRecently
      const hasTokens = usage.used !== undefined || usage.total !== undefined
      const now = useNow(railVisible)
      // Stable identity for the panel's Escape listener. Declared ABOVE the early
      // return below: a hook after a conditional return changes the hook count
      // between renders, which React rejects outright (#310 / #300).
      const close = React.useCallback(() => setOpen(false), [])
      if (!railVisible && !hasTokens && !open) return null

      // The rail reports how the TURN ended, not how individual tool calls went: a
      // failed call the model recovered from is a detail of the panel, not a
      // failed run.
      const turnReason = current ? current.reason : ''
      const phase = summary.ended
        ? turnReason === '' || turnReason === 'completed'
          ? 'done'
          : 'failed'
        : 'running'
      const percent = summary.hasTodos ? Math.min(1, Math.max(0, summary.fraction)) : 1
      const toggle = () => setOpen((value) => !value)
      const toggleTurn = (number) =>
        setExpandedTurn((current) => (current === number ? null : number))

      return h(
        React.Fragment,
        null,
        h('style', { key: 'styles' }, CSS),
        railVisible
          ? h(Rail, {
              key: 'rail',
              open,
              t,
              summary,
              phase,
              percent,
              usage,
              now,
              onToggle: toggle,
            })
          : null,
        hasTokens
          ? h(TokenChip, {
              key: 'tokens',
              t,
              usage,
              cost,
              position: chipPosition,
              onMove: moveChip,
              onCommit: commitChip,
              onReset: resetChip,
              onToggle: toggle,
            })
          : null,
        open
          ? h(Panel, {
              key: 'panel',
              t,
              title,
              summary,
              turns: flow.turns,
              phase,
              percent,
              usage,
              cost,
              pricing,
              expandedTurn,
              onToggleTurn: toggleTurn,
              now,
              onClose: close,
            })
          : null,
      )
    }

    /**
     * Last-resort surface for this entry.
     *
     * The slot core ABDICATES an entry whose render throws: it is removed from
     * the rendered set for good and leaves no trace on screen, which is
     * impossible to diagnose from the page. Catching the failure here keeps the
     * reason visible instead — one small pill at the right edge with the message
     * in its tooltip; clicking it retries the render.
     */
    class RunProgressBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        const error = this.state.error
        if (error === null) return this.props.children
        const message = String(
          error && typeof error === 'object' && 'message' in error ? error.message : error,
        )
        return h(
          'button',
          {
            type: 'button',
            className: 'drp-failure',
            title: message,
            onClick: () => this.setState({ error: null }),
          },
          h('span', { className: 'drp-failure-title' }, 'run-progress'),
          h('span', { className: 'drp-failure-message' }, clip(message, 160) || 'render failed'),
        )
      }
    }

    /**
     * Guard entry: the standard kit hands `useSessions` to every root-scoped
     * entry. Without it there is nothing to follow, and returning before the
     * hooks live in `RunProgress` keeps hook order stable.
     */
    function Entry(props) {
      if (typeof props.useSessions !== 'function') return null
      return h(RunProgressBoundary, null, h(RunProgress, props))
    }

    /* ----------------------------------------------------------------- css -- */

    const CSS = `
.drp-rail{position:fixed;top:50%;right:3px;transform:translateY(-50%);display:flex;flex-direction:column;
align-items:center;gap:4px;width:14px;height:220px;padding:3px 0;margin:0;border:0;border-radius:8px;
background:transparent;cursor:pointer;pointer-events:auto;z-index:40;outline:none}
.drp-rail:hover,.drp-rail:focus-visible{background:var(--dsw-alias-bg-layer-2)}
.drp-rail-open{background:var(--dsw-alias-bg-layer-2)}
.drp-tracks{display:flex;flex:1 1 auto;gap:2px;width:100%;justify-content:center}
.drp-track{position:relative;flex:1 1 auto;min-width:4px;max-width:5px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}
.drp-fill{position:absolute;left:0;right:0;bottom:0;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:height .4s ease}
.drp-fill[data-phase=done]{background:var(--dsw-alias-state-success-primary)}
.drp-fill[data-phase=failed]{background:var(--dsw-alias-state-error-primary)}
.drp-fill[data-phase=warn]{background:var(--dsw-alias-state-warn-primary)}
.drp-fill[data-phase=high]{background:var(--dsw-alias-state-error-primary)}
.drp-pulse{position:absolute;left:0;right:0;bottom:0;height:38%;border-radius:999px;
background:linear-gradient(180deg,transparent,var(--dsw-alias-brand-primary),transparent);animation:drp-slide 1.6s ease-in-out infinite alternate}
.drp-pulse[data-phase=failed]{background:linear-gradient(180deg,transparent,var(--dsw-alias-state-error-primary),transparent)}
@keyframes drp-slide{from{bottom:0}to{bottom:62%}}
.drp-pct{writing-mode:vertical-rl;font-size:10px;line-height:1;letter-spacing:.02em;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.drp-pct[data-level=warn]{color:var(--dsw-alias-state-warn-primary)}
.drp-pct[data-level=high]{color:var(--dsw-alias-state-error-primary)}
.drp-tokens{position:fixed;right:20px;top:calc(50% + 124px);display:inline-flex;align-items:center;justify-content:flex-end;
max-width:180px;padding:2px 7px;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;
background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10px;line-height:14px;
font-variant-numeric:tabular-nums;white-space:nowrap;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;
pointer-events:auto;z-index:40;outline:none}
.drp-tokens-dragging{z-index:42;cursor:grabbing;box-shadow:0 6px 18px rgba(0,0,0,.25)}
.drp-tokens:hover,.drp-tokens:focus-visible{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.drp-tokens[data-level=warn]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.drp-tokens[data-level=high]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.drp-tokens-text{overflow:hidden;text-overflow:ellipsis}
.drp-failure{position:fixed;right:12px;top:calc(50% + 150px);display:flex;flex-direction:column;gap:1px;
max-width:300px;padding:4px 8px;margin:0;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;
background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-state-error-primary);font:inherit;font-size:10px;
line-height:13px;text-align:left;cursor:pointer;pointer-events:auto;z-index:50}
.drp-failure-title{font-weight:600}
.drp-failure-message{color:var(--dsw-alias-label-secondary);word-break:break-word}
.drp-panel{position:fixed;top:56px;right:22px;bottom:28px;width:380px;max-width:calc(100vw - 44px);display:flex;
flex-direction:column;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);
border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.22);
overflow:hidden;pointer-events:auto;z-index:41;font:inherit;font-size:13px;line-height:18px}
.drp-head{display:flex;align-items:flex-start;gap:8px;padding:12px 12px 10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.drp-head-main{min-width:0;flex:1 1 auto}
.drp-title{font-size:13px;font-weight:600}
.drp-sub{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drp-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.drp-x{flex:none;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;
color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;line-height:24px;text-align:center}
.drp-x:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.drp-body{flex:1 1 auto;overflow:auto;padding:10px 12px 14px;display:flex;flex-direction:column;gap:10px}
.drp-turn{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:4px}
.drp-turn-newest{border-color:var(--dsw-alias-border-l2)}
.drp-turn-head{display:flex;align-items:baseline;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.drp-turn-toggle{width:100%;padding:0;margin:0;border:0;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer}
.drp-turn-toggle:hover .drp-turn-title,.drp-turn-toggle:focus-visible .drp-turn-title{text-decoration:underline}
.drp-turn-summary{font-size:11px;color:var(--dsw-alias-label-secondary)}
.drp-chevron{flex:none;font-size:10px;line-height:1;color:var(--dsw-alias-label-secondary);transition:transform .15s ease}
.drp-turn[data-expanded=true] .drp-chevron{transform:rotate(90deg)}
.drp-turn-detail{display:none;flex-direction:column;gap:6px;padding-top:5px;margin-top:2px;
border-top:1px dashed var(--dsw-alias-border-l1)}
.drp-turn[data-expanded=true] .drp-turn-detail{display:flex}
.drp-detail-block{display:flex;flex-direction:column;gap:1px}
.drp-detail-key{font-size:10px;color:var(--dsw-alias-label-secondary)}
.drp-detail-text{font-size:12px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
.drp-tool-full{flex-direction:column;align-items:stretch;gap:1px}
.drp-tool-line{display:flex;align-items:baseline;gap:6px}
.drp-tool-args{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.drp-turn-title{font-weight:600;color:var(--dsw-alias-label-primary)}
.drp-sep{color:var(--dsw-alias-label-secondary);opacity:.7}
.drp-step{display:flex;flex-direction:column;gap:2px;padding:2px 0 2px 2px}
.drp-step-head{display:flex;align-items:baseline;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.drp-tool{display:flex;align-items:baseline;gap:6px;font-size:12px;min-width:0}
.drp-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);transform:translateY(-1px)}
.drp-dot[data-s=running]{background:var(--dsw-alias-brand-primary);animation:drp-blink 1s ease-in-out infinite}
.drp-dot[data-s=done]{background:var(--dsw-alias-state-success-primary)}
.drp-dot[data-s=failed]{background:var(--dsw-alias-state-error-primary)}
@keyframes drp-blink{0%,100%{opacity:1}50%{opacity:.35}}
.drp-name{flex:none;font-weight:600;max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drp-detail{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drp-dur{flex:none;margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}
.drp-dur-end{margin-left:auto}
.drp-line{display:flex;gap:6px;font-size:11px;min-width:0;color:var(--dsw-alias-label-secondary)}
.drp-line-key{flex:none;color:var(--dsw-alias-label-secondary);opacity:.8}
.drp-line-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drp-line-reply{margin-top:2px}
.drp-turn-tokens{display:flex;flex-direction:column;gap:1px;margin-top:2px;padding-top:4px;
border-top:1px dashed var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.drp-turn-tokens-head{display:flex;align-items:baseline;gap:8px}
.drp-turn-cost{margin-left:auto;color:var(--dsw-alias-label-primary)}
.drp-turn-tokens-parts{word-break:break-word}
.drp-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:2px 0}
.drp-empty-block{padding:14px 4px}
.drp-todos{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px}
.drp-tokens-block{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px}
.drp-tokens-head{display:flex;align-items:baseline;gap:8px;font-size:12px;font-weight:600}
.drp-tokens-count{margin-left:auto;font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}
.drp-tokens-bar{height:4px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}
.drp-tokens-fill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.drp-tokens-fill[data-level=warn]{background:var(--dsw-alias-state-warn-primary)}
.drp-tokens-fill[data-level=high]{background:var(--dsw-alias-state-error-primary)}
.drp-buckets{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.drp-bucket{display:flex;gap:4px;min-width:0}
.drp-bucket-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.drp-bucket-total{font-size:11px;color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l1);padding-top:5px;margin-top:1px}
.drp-cost{display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:5px;margin-top:1px;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.drp-cost-head{display:flex;align-items:baseline;gap:8px}
.drp-cost-value{margin-left:auto;color:var(--dsw-alias-label-primary);font-weight:600}
.drp-cost-parts{word-break:break-word}
.drp-cost-rate{opacity:.8}
.drp-todos-head{display:flex;align-items:baseline;gap:8px;font-size:12px;font-weight:600}
.drp-todos-count{margin-left:auto;font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.drp-todos-bar{height:4px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}
.drp-todos-fill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary);transition:width .4s ease}
.drp-todos-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.drp-todo{display:flex;gap:6px;font-size:12px;min-width:0;color:var(--dsw-alias-label-secondary)}
.drp-todo[data-s=in_progress]{color:var(--dsw-alias-label-primary)}
.drp-todo[data-s=completed] .drp-todo-text{text-decoration:line-through;opacity:.75}
.drp-todo-mark{flex:none;width:12px;text-align:center;font-size:11px}
.drp-todo-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:720px){
  .drp-panel{top:12px;right:12px;left:12px;bottom:12px;width:auto;max-width:none}
  .drp-rail{height:170px}
}
@media (prefers-reduced-motion:reduce){
  .drp-pulse{animation:none;bottom:30%}
  .drp-dot[data-s=running]{animation:none}
  .drp-fill,.drp-todos-fill{transition:none}
}
`

    /* -------------------------------------------------------------- plugin -- */

    /** The slot, locale namespace, and the Shared Session object layer. */
    const inject = ['slots', 'sessions', 'locale']

    /**
     * Client plugin body: register the rail entry and its dictionaries.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      if (ctx.locale) {
        ctx.effect(
          () => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }),
          'run-progress: dictionaries',
        )
      }
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: ENTRY_ID,
            order: 60,
            label: 'run-progress',
            locale: NS,
            inject: () => ({ sessionsApi: typeof ctx.get === 'function' ? ctx.get('sessions') : ctx.sessions }),
          },
          Entry,
        ),
      )
    }

    return {
      inject,
      apply,
      Entry,
      clampChipPosition,
      durableWindowKey,
      messages: DICT,
    }
  },
})