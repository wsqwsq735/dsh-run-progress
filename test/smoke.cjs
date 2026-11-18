/**
 * Offline smoke test for dsh-run-progress/client.js.
 *
 * The browser bundle talks to the Host through a module loader and React, so
 * this harness provides both: a loader that captures the factory, a minimal
 * React with the hooks the component uses, and a fake session binding carrying
 * a realistic event window. It then renders the slot entry and walks the tree
 * to prove the rail and the run-flow panel build real output.
 *
 * Run twice — `node test/smoke.cjs en` and `node test/smoke.cjs zh` (or set
 * SMOKE_LANG) — to check both dictionaries.
 */

const fs = require('node:fs')
const path = require('node:path')

const LANG_ARG = process.argv[2]
const LANG =
  LANG_ARG === 'zh'
    ? 'zh-CN'
    : LANG_ARG === 'en'
      ? 'en-US'
      : process.env.SMOKE_LANG === 'zh'
        ? 'zh-CN'
        : 'en-US'
Object.defineProperty(globalThis, 'navigator', {
  value: { language: LANG },
  configurable: true,
  writable: true,
})

/* ------------------------------------------------------------ fake React -- */

const Fragment = Symbol('Fragment')
let hookIndex = 0
let stateful = false
let slots = []

function resetHooks(useStateful) {
  hookIndex = 0
  stateful = useStateful
}

const FakeReact = {
  Fragment,
  Component: class FakeComponent {
    constructor(props) {
      this.props = props || {}
      this.state = {}
    }

    setState(next) {
      this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state) : next) }
    }
  },
  createElement(type, props, ...children) {
    const flat = []
    const push = (value) => {
      if (Array.isArray(value)) {
        for (const item of value) push(item)
      } else if (value !== null && value !== undefined && value !== false && value !== true) {
        flat.push(value)
      }
    }
    for (const child of children) push(child)
    return { type, props: props || {}, children: flat }
  },
  useState(initial) {
    const index = hookIndex++
    if (!stateful) return [typeof initial === 'function' ? initial() : initial, () => {}]
    if (slots[index] === undefined) {
      slots[index] = { value: typeof initial === 'function' ? initial() : initial }
    }
    const slot = slots[index]
    const set = (next) => {
      slot.value = typeof next === 'function' ? next(slot.value) : next
    }
    return [slot.value, set]
  },
  useMemo(factory, deps) {
    const index = hookIndex++
    if (!stateful) return factory()
    const slot = slots[index]
    if (
      slot &&
      Array.isArray(slot.deps) &&
      Array.isArray(deps) &&
      slot.deps.length === deps.length &&
      slot.deps.every((value, position) => Object.is(value, deps[position]))
    ) {
      return slot.value
    }
    const value = factory()
    slots[index] = { value, deps }
    return value
  },
  useEffect(fn, deps) {
    const index = hookIndex++
    if (!stateful) return
    const previous = slots[index]
    if (
      previous &&
      Array.isArray(previous.deps) &&
      Array.isArray(deps) &&
      previous.deps.length === deps.length &&
      previous.deps.every((value, position) => Object.is(value, deps[position]))
    ) {
      return
    }
    if (previous && typeof previous.cleanup === 'function') previous.cleanup()
    const slot = { deps, cleanup: undefined }
    slots[index] = slot
    slot.cleanup = fn()
  },
  useLayoutEffect() {},
  useCallback(fn) {
    hookIndex += 1
    return fn
  },
  useRef(initial) {
    hookIndex += 1
    return { current: initial }
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    hookIndex += 1
    return getSnapshot()
  },
}

/* -------------------------------------------------------------- walk tree -- */

function walk(node, out) {
  if (node === null || node === undefined || node === false || node === true) return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out)
    return
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.text.push(String(node))
    return
  }
  if (typeof node.type === 'function') {
    if (node.type.prototype instanceof FakeReact.Component) {
      const instance = new node.type({ ...node.props, children: node.children })
      walk(single(instance.render()), out)
      return
    }
    const savedIndex = hookIndex
    const statelessBefore = stateful
    hookIndex = 0
    stateful = false
    let rendered
    try {
      rendered = node.type({ ...node.props, children: node.children })
    } finally {
      stateful = statelessBefore
      hookIndex = savedIndex
    }
    walk(rendered, out)
    return
  }
  out.nodes.push({ type: node.type, props: node.props })
  if (node.type === 'style') return
  for (const child of node.children) walk(child, out)
}

function collect(node) {
  const out = { nodes: [], text: [] }
  walk(node, out)
  return out
}

/** Unwrap the single-child array a class boundary's render may hand back. */
function single(value) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value
}

/* ------------------------------------------------------------ fake session -- */

const BASE = Date.now() - 1600

/** Longer than the compact preview budget, so the detail view is what shows it all. */
const LONG_PROMPT =
  'add a progress rail on the far right edge of the window with a token pill that follows the main conversation and reports per-turn usage in the panel'

function makeEntries() {
  const event = (offset, type, data, seq) => ({
    type: 'event',
    event: { type, seq, time: BASE + offset, data },
  })
  return [
    event(-500, 'turn/start', { turn: 1 }, 101),
    event(-450, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'first question' }] }, 102),
    event(-400, 'step/start', { turn: 1, step: 1 }, 103),
    event(
      -380,
      'assistant/message',
      {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: 'first answer' }] },
        stream: [],
        usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      104,
    ),
    event(-300, 'step/end', { turn: 1, step: 1 }, 105),
    event(-200, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 106),
    event(0, 'turn/start', { turn: 2 }, 1),
    event(50, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: LONG_PROMPT }] }, 2),
    event(80, 'step/start', { turn: 2, step: 1 }, 3),
    event(120, 'tool/call', { turn: 2, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"pnpm test"}' }, 4),
    event(900, 'tool/result', { turn: 2, step: 1, message: { role: 'tool', toolCallId: 'call-1', isError: false, content: [] } }, 5),
    event(
      950,
      'assistant/message',
      {
        turn: 2,
        step: 1,
        message: { content: [{ type: 'text', text: 'Tests pass, writing the UI now.' }] },
        stream: [],
        usage: { inputTokens: 3200, outputTokens: 1100, cacheReadTokens: 12000, cacheWriteTokens: 0 },
      },
      6,
    ),
    event(1000, 'step/end', { turn: 2, step: 1 }, 7),
    event(1100, 'step/start', { turn: 2, step: 2 }, 8),
    event(1200, 'tool/call', { turn: 2, step: 2, callId: 'call-2', name: 'read', arguments: '{"file_path":"src/AppFrame.tsx"}' }, 9),
    event(1400, 'tool/result', { turn: 2, step: 2, message: { role: 'tool', toolCallId: 'call-2', isError: true, content: [] }, error: { name: 'FsError', code: 'ENOENT' } }, 10),
    event(1500, 'tool/call', { turn: 2, step: 2, callId: 'call-3', name: 'grep', arguments: '{"pattern":"shell.overlay"}' }, 11),
  ]
}

const TODOS = [
  { content: 'survey the right-edge slots', status: 'completed' },
  { content: 'build the rail and the panel', status: 'in_progress' },
  { content: 'verify it in the GUI', status: 'pending' },
]

const TOKEN_USAGE = {
  uncachedInputTokens: 8100,
  outputTokens: 1400,
  cacheReadTokens: 3200,
  cacheWriteTokens: 0,
}

const CONTEXT_PRESSURE = {
  pressureTokens: 11500,
  projectedTokens: 12300,
  contextWindow: 51200,
}

function makeWorld(options) {
  const entries = options.entries || makeEntries()
  const todos = options.todos === undefined ? TODOS : options.todos
  const tokenUsage = options.tokenUsage === undefined ? TOKEN_USAGE : options.tokenUsage
  const contextPressure = options.contextPressure === undefined ? CONTEXT_PRESSURE : options.contextPressure
  const running = options.running !== false
  const sessionId = options.sessionId || 'session-1'
  const windowSource = {
    getSnapshot: () => ({ entries, hasMore: false, revision: 1 }),
    subscribe: () => () => {},
  }
  const session = {
    getSnapshot: () => ({ running, openState: 'open' }),
    subscribe: () => () => {},
    projections: {
      faceOf: (key) => {
        if (options.faceOfThrows) throw new Error('projection store unavailable')
        return {
          getSnapshot: () =>
            key === 'todos'
              ? todos
              : key === 'tokenUsage'
                ? tokenUsage
                : key === 'contextPressure'
                  ? contextPressure
                  : undefined,
          subscribe: () => () => {},
        }
      },
    },
  }
  const binding = { sessionId, session, eventSource: windowSource }
  const sessionsApi = options.sessionsApi || {
    binding: () => binding,
    retainInfo: () => ({ getSnapshot: () => ({ referenceCount: 1 }), subscribe: () => () => {} }),
  }
  const listState = {
    ids: [sessionId],
    byId: {
      [sessionId]: {
        id: sessionId,
        displayTitle: 'Progress rail',
        running,
        retainedBy: { mainView: 1 },
      },
    },
    phase: 'ready',
    projectionsBySession: {},
  }
  return {
    sessionsApi,
    useSessions: (selector) => selector(listState),
  }
}

/* ------------------------------------------------------------------ setup -- */

// The chip's ticker would keep the process alive; the harness drives time itself.
const realSetInterval = globalThis.setInterval
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

const clientPath = path.join(__dirname, '..', 'client.js')
const source = fs.readFileSync(clientPath, 'utf8')

let captured
const fakeWindow = {
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener: () => {},
  removeEventListener: () => {},
  __ModuleLoader__: {
    load(definition) {
      captured = definition
    },
  },
}

/** Stand-in for the browser's localStorage, which the chip position uses. */
const storage = new Map()
const localStorageStub = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => {
    storage.set(key, String(value))
  },
  removeItem: (key) => {
    storage.delete(key)
  },
}
try {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageStub,
    configurable: true,
    writable: true,
  })
} catch (error) {
  globalThis.localStorage = localStorageStub
}

new Function('window', `${source}\n`)(fakeWindow)
if (!captured || captured.id !== 'dsh-run-progress') throw new Error('factory was not captured')

const moduleExports = captured.factory((name) => {
  if (name === 'react') return FakeReact
  throw new Error(`unexpected module ${name}`)
})

const registered = []
const fakeCtx = {
  effect: (fn) => {
    fn()
    return () => {}
  },
  // The real Cordis Context resolves services through get(); mirror that so the
  // entry's inject callback runs against the same shape.
  get: (key) => fakeCtx[key],
  locale: { register: () => () => {} },
  slots: {
    inject: (_key, callback) => callback(),
    register: (options, component) => {
      registered.push({ options, component })
      return () => {}
    },
  },
}
moduleExports.apply(fakeCtx)

const failures = []
function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`)
  } else {
    failures.push(label)
    console.log(`FAIL ${label}${detail === undefined ? '' : ` -> ${detail}`}`)
  }
}

/** Same assertion in either language, so one harness covers both dictionaries. */
function pick(english, chinese) {
  return LANG.startsWith('zh') ? chinese : english
}

check('registers exactly one shell.overlay entry', registered.length === 1 && registered[0].options.name === 'shell.overlay')
check('entry id is run-progress', !!registered[0] && registered[0].options.id === 'run-progress')
check('entry declares the locale namespace', !!registered[0] && registered[0].options.locale === 'run-progress')
check('entry injects the sessions service', !!registered[0] && typeof registered[0].options.inject === 'function')

const Entry = registered[0].component

/**
 * Mount the slot entry: `Entry` returns the element for the real component, so
 * this expands that second level with persistent hook state, then every further
 * render keeps the same slots (that is what lets a click open the panel).
 */
function mount(worldData) {
  let current = worldData
  let mine = []
  const render = () => {
    // Each mount owns its hook slots, so several mounted instances can be
    // exercised without stealing each other's state. Props are rebuilt per
    // render so a mount can be pointed at another Session.
    fakeCtx.sessions = current.sessionsApi
    const injected = registered[0].options.inject()
    const props = { useSessions: current.useSessions, t: undefined, ...injected }
    const saved = slots
    slots = mine
    resetHooks(true)
    try {
      let element = Entry(props)
      if (element && typeof element.type === 'function' && element.type.prototype instanceof FakeReact.Component) {
        const instance = new element.type({ ...element.props, children: element.children })
        element = single(instance.render())
      }
      if (!element || typeof element.type !== 'function') return element
      return element.type({ ...element.props, children: element.children })
    } finally {
      mine = slots
      slots = saved
    }
  }
  return {
    render,
    /** Point this mount at another world (a Session switch) for the next render. */
    use(nextWorld) {
      current = nextWorld
    },
  }
}

const world = makeWorld({})
const runningMount = mount(world)
const runningTree = runningMount.render()
const runningView = collect(runningTree)

check('rail renders while the session runs', runningView.nodes.some((node) => node.type === 'button' && String(node.props.className).includes('drp-rail')))
check('panel stays closed initially', !runningView.nodes.some((node) => node.type === 'aside'))
check('styles are shipped with the rail', Array.isArray(runningTree.children) && runningTree.children.some((child) => child && child.type === 'style'))

const railButton = runningView.nodes.find((node) => node.type === 'button')
check('rail exposes an accessible label', !!railButton && typeof railButton.props['aria-label'] === 'string' && railButton.props['aria-label'].length > 0)
check('rail label names the running turn', !!railButton && /2/.test(railButton.props['aria-label']), railButton && railButton.props['aria-label'])
check('rail shows the task percentage at the edge', runningView.text.some((value) => value === '33%'), runningView.text.join('|'))
check(
  'rail prints no elapsed time at the edge',
  !runningView.text.some((value) => /^\d+(m\d+)?s$/.test(value) || /^\d+h\d+m$/.test(value)),
  runningView.text.join('|'),
)
check('rail title explains the click', !!railButton && String(railButton.props.title).includes(pick('Open the run-flow panel', '查看详细运行流程')))
check('rail reports the context in its label', !!railButton && String(railButton.props['aria-label']).includes('12.3k'), railButton && railButton.props['aria-label'])

const tracks = runningView.nodes.filter((node) => node.type === 'span' && node.props.className === 'drp-track')
check('rail carries a task track and a token track', tracks.length === 2, tracks.length)
const tokenFill = runningView.nodes.find(
  (node) => node.type === 'span' && String(node.props.className).includes('drp-fill') && node.props['data-phase'] === 'ok' && node.props.style && String(node.props.style.height).endsWith('%'),
)
check('token track fills to the context ratio', !!tokenFill && tokenFill.props.style.height === '24%', tokenFill && tokenFill.props.style.height)

const chip = runningView.nodes.find((node) => node.type === 'button' && String(node.props.className).includes('drp-tokens'))
check('token chip renders beside the rail', !!chip)
check(
  'token chip shows the absolute sizes',
  !!chip && runningView.text.some((value) => value === '12.3k/51.2k · ≈¥0.021'),
  runningView.text.join('|'),
)
check(
  'token chip converts the usage into RMB',
  !!chip && String(chip.props.title).includes('¥0.021'),
  chip && chip.props.title,
)
check('token chip explains itself on hover', !!chip && String(chip.props.title).includes('24%'), chip && chip.props.title)

/* --------------------------------------------------- chip: drag to reposition -- */

check(
  'token chip is draggable',
  !!chip &&
    chip.props['data-draggable'] === 'true' &&
    typeof chip.props.onPointerDown === 'function' &&
    typeof chip.props.onPointerMove === 'function' &&
    typeof chip.props.onPointerUp === 'function',
)
check('token chip resets on double click', !!chip && typeof chip.props.onDoubleClick === 'function')
check('token chip starts at its default seat', !!chip && chip.props.style === undefined, chip && JSON.stringify(chip.props.style))
check(
  'chip position is clamped to the window',
  JSON.stringify(moduleExports.clampChipPosition({ right: -40, top: 9999 }, { width: 800, height: 600 })) ===
    JSON.stringify({ right: 4, top: 572 }),
  JSON.stringify(moduleExports.clampChipPosition({ right: -40, top: 9999 }, { width: 800, height: 600 })),
)

const dragTarget = {
  getBoundingClientRect: () => ({ right: 1260, top: 520, left: 1200, bottom: 540, width: 60, height: 20 }),
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
}
let toggledByDrag = 0
const dragMount = mount(world)
const dragBefore = collect(dragMount.render())
const dragChip = dragBefore.nodes.find((node) => node.type === 'button' && String(node.props.className).includes('drp-tokens'))
dragChip.props.onPointerDown({ button: 0, pointerId: 7, clientX: 100, clientY: 100, currentTarget: dragTarget })
dragChip.props.onPointerMove({ clientX: 60, clientY: 140, currentTarget: dragTarget })
dragChip.props.onPointerUp({ clientX: 60, clientY: 140, currentTarget: dragTarget })
const draggedView = collect(dragMount.render())
const movedChip = draggedView.nodes.find((node) => node.type === 'button' && String(node.props.className).includes('drp-tokens'))
check(
  'dragging moves the chip and remembers it',
  !!movedChip && movedChip.props.style && movedChip.props.style.right === '60px' && movedChip.props.style.top === '560px',
  movedChip && JSON.stringify(movedChip.props.style),
)
check('dragging does not open the panel', toggledByDrag === 0 && !draggedView.nodes.some((node) => node.type === 'aside'))
check(
  'the dragged position is stored for the next load',
  storage.get('dsh-run-progress:chip-position') === JSON.stringify({ right: 60, top: 560 }),
  storage.get('dsh-run-progress:chip-position'),
)

// The remembered position is read in a mount effect, so the second render is
// the one that shows it.
const reloadMount = mount(world)
reloadMount.render()
const reloadView = collect(reloadMount.render())
const reloadedChip = reloadView.nodes.find((node) => node.type === 'button' && String(node.props.className).includes('drp-tokens'))
check(
  'a stored position survives a reload',
  !!reloadedChip && reloadedChip.props.style && reloadedChip.props.style.right === '60px',
  reloadedChip && JSON.stringify(reloadedChip.props.style),
)

reloadedChip.props.onDoubleClick()
const resetView = collect(reloadMount.render())
const resetChip = resetView.nodes.find((node) => node.type === 'button' && String(node.props.className).includes('drp-tokens'))
check('double click returns the chip to its default seat', !!resetChip && resetChip.props.style === undefined)
check('double click clears the stored position', !storage.has('dsh-run-progress:chip-position'))

/* ------------------------------------------------------- panel: open + draw -- */

railButton.props.onClick()
const openView = collect(runningMount.render())
const panel = openView.nodes.find((node) => node.type === 'aside')

check('clicking the rail opens the panel', !!panel)
check('panel is a dialog with a label', !!panel && panel.props.role === 'dialog' && panel.props['aria-label'] === pick('Run flow', '运行流程'))
const text = openView.text.join(' ')
check('panel lists the current turn', new RegExp(pick('Turn 2', '第 2 轮')).test(text), text.slice(0, 80))
check('panel lists both steps', new RegExp(pick('Step 1', '第 1 步')).test(text) && new RegExp(pick('Step 2', '第 2 步')).test(text))
check('panel lists the bash tool', text.includes('bash'))
check('panel carries the argument hint', text.includes('pnpm test'))
check('panel lists the failing read tool', text.includes('read'))
check('panel shows a duration', /\d+(ms|s|m\d+s|h\d+m)/.test(text))
check('panel shows the task list', text.includes(pick('Tasks', '任务进度')))
check('panel shows the task count', /1\/3/.test(text), text.match(/\d\/\d/g))
check('panel shows a task row', text.includes('build the rail and the panel'))
check('panel shows prompt and reply previews', text.includes('add a progress rail') && text.includes('Tests pass'))
check('panel reports the failure count', new RegExp(pick('1 failed', '1 失败')).test(text), text.slice(0, 160))
check('panel shows the token block', text.includes(pick('Tokens', 'Token 用量')))
check('panel shows context occupancy', new RegExp(pick('12.3k / 51.2k used', '已用 12.3k / 51.2k')).test(text), text.slice(0, 200))
check('panel shows every usage bucket', text.includes(pick('Input', '输入')) && text.includes('8.1k') && text.includes('3.2k') && text.includes('1.4k'))
check('panel shows the session total', text.includes('12.7k'), (text.match(/[\d.]+k/g) || []).join(','))
check(
  'panel shows the estimated cost',
  text.includes(pick('Cost', '费用')) && text.includes('≈¥0.021'),
  text.slice(-160),
)
check(
  'panel shows each bucket cost',
  text.includes('¥0.016') && text.includes('¥0.0006') && text.includes('¥0.0042'),
  text.match(/¥[\d.]+/g),
)
check(
  'panel states the rate basis',
  new RegExp(`¥2 / ¥0\\.2 / ¥2 / ¥3`).test(text),
  text.slice(-120),
)
check(
  'panel lists every rendered turn',
  new RegExp(pick('Turn 1', '第 1 轮')).test(text) && new RegExp(pick('Turn 2', '第 2 轮')).test(text),
)
check(
  'every turn shows its own token usage',
  text.includes('12.0k') && text.includes('1.1k') && text.includes('1.0k'),
  (text.match(/[\d.]+k/g) || []).join(','),
)
check(
  'every turn shows its own cost',
  text.includes('≈¥0.0035') && text.includes('≈¥0.012'),
  (text.match(/≈¥[\d.]+/g) || []).join(','),
)
check('per-turn usage is labelled as tokens', new RegExp(pick('Tokens', 'Token 用量')).test(text))

/* --------------------------------------------------- hover detail and pinning -- */

const turnSections = openView.nodes.filter(
  (node) => node.type === 'section' && String(node.props.className).includes('drp-turn'),
)
const toggleButtons = openView.nodes.filter(
  (node) => node.type === 'button' && String(node.props.className).includes('drp-turn-toggle'),
)
check('every turn card has a pin toggle', turnSections.length >= 2 && toggleButtons.length === turnSections.length, `${turnSections.length}/${toggleButtons.length}`)
check(
  'every turn card carries a full detail block',
  openView.nodes.filter((node) => node.type === 'div' && String(node.props.className).includes('drp-turn-detail')).length === turnSections.length,
)
check(
  'the detail expands every tool argument',
  openView.nodes.filter((node) => node.type === 'span' && String(node.props.className).includes('drp-tool-args')).length >= 2,
)
check('the detail shows the untruncated prompt', openView.text.includes(LONG_PROMPT))
check(
  'the card keeps a truncated preview alongside it',
  openView.text.some((value) => typeof value === 'string' && value.endsWith('…') && LONG_PROMPT.startsWith(value.slice(0, -1).trimEnd())),
  openView.text.filter((value) => typeof value === 'string' && value.endsWith('…')).join('|'),
)
check(
  'turns start collapsed',
  turnSections.every((node) => node.props['data-expanded'] === 'false'),
)
check(
  'nothing expands without a click',
  !openView.nodes.some((node) => node.type === 'section' && node.props['data-expanded'] === 'true'),
)

toggleButtons[toggleButtons.length - 1].props.onClick()
const expandedView = collect(runningMount.render())
const openSections = expandedView.nodes.filter(
  (node) => node.type === 'section' && node.props['data-expanded'] === 'true',
)
check('clicking a turn expands exactly one card', openSections.length === 1)
check(
  'the expanded card is the clicked one and marks its state',
  openSections.length === 1 &&
    String(openSections[0].props.className).includes('drp-turn-open') &&
    expandedView.nodes.some((node) => node.type === 'button' && node.props['aria-expanded'] === 'true'),
)
check(
  'expansion is click-only, with no hover hint',
  !expandedView.text.some((value) => typeof value === 'string' && /hover|悬停/.test(value)),
)

const togglesAfter = expandedView.nodes.filter(
  (node) => node.type === 'button' && String(node.props.className).includes('drp-turn-toggle'),
)
togglesAfter[togglesAfter.length - 1].props.onClick()
const collapsedView = collect(runningMount.render())
check(
  'clicking the same turn again collapses it',
  !collapsedView.nodes.some((node) => node.type === 'section' && node.props['data-expanded'] === 'true'),
)

const dots = openView.nodes.filter((node) => node.type === 'span' && node.props['data-s'] !== undefined)
check('tool rows carry their status', dots.some((node) => node.props['data-s'] === 'failed') && dots.some((node) => node.props['data-s'] === 'running'))

/* ------------------------------------------------------------- idle: hidden -- */

const idleView = collect(mount(makeWorld({ running: false })).render())
check(
  'rail hides when the session is idle',
  !idleView.nodes.some((node) => node.type === 'button' && String(node.props.className).includes('drp-rail')),
)
check(
  'token chip stays readable while idle',
  idleView.nodes.some((node) => node.type === 'button' && String(node.props.className).includes('drp-tokens')),
)

const blankTree = mount(makeWorld({ running: false, tokenUsage: null, contextPressure: null })).render()
check('nothing renders without a run and without tokens', blankTree === null, String(blankTree && blankTree.type))

/* ------------------------------------------------------- hot context banding -- */

const hotView = collect(
  mount(makeWorld({ contextPressure: { pressureTokens: 48000, projectedTokens: 49000, contextWindow: 51200 } })).render(),
)
const hotChip = hotView.nodes.find((node) => node.type === 'button' && String(node.props.className).includes('drp-tokens'))
check('near-full context raises the chip level', !!hotChip && hotChip.props['data-level'] === 'high', hotChip && hotChip.props['data-level'])

/* --------------------------------------------- running without a task list -- */

const noTodosView = collect(mount(makeWorld({ todos: null })).render())
check('rail renders without a task list', noTodosView.nodes.some((node) => node.type === 'button'))
check(
  'indeterminate pulse replaces the fill',
  noTodosView.nodes.some((node) => node.type === 'span' && String(node.props.className).includes('drp-pulse')),
)
check(
  'label falls back to the context percentage without a task list',
  noTodosView.text.some((value) => value === '24%'),
  noTodosView.text.join('|'),
)

const planOnlyView = collect(mount(makeWorld({ tokenUsage: null, contextPressure: null })).render())
check(
  'task percentage shows when no token sample exists',
  planOnlyView.text.some((value) => value === '33%'),
  planOnlyView.text.join('|'),
)
check(
  'no cost is invented without token usage',
  !planOnlyView.text.some((value) => String(value).includes('¥')),
  planOnlyView.text.join('|'),
)

/* ------------------------------------------------------------ rate overrides -- */

storage.set('dsh-run-progress:pricing', JSON.stringify({ input: 0, cacheRead: 0, cacheWrite: 0, output: 1000 }))
const pricedMount = mount(world)
pricedMount.render()
const pricedView = collect(pricedMount.render())
const pricedChip = pricedView.nodes.find((node) => node.type === 'button' && String(node.props.className).includes('drp-tokens'))
check(
  'a stored rate table overrides the defaults',
  !!pricedChip && String(pricedChip.props.title).includes('¥1.40'),
  pricedChip && pricedChip.props.title,
)
storage.delete('dsh-run-progress:pricing')

/* ------------------------------------------------------- empty event window -- */

const emptyView = collect(mount(makeWorld({ entries: [] })).render())
check('rail still renders with an empty window', emptyView.nodes.some((node) => node.type === 'button'))

/* --------------------------------------------------------- completed outcome -- */

const doneEntries = makeEntries().concat([
  { type: 'event', event: { type: 'turn/end', seq: 12, time: BASE + 1600, data: { turn: 2, reason: { kind: 'completed' } } } },
])
const doneView = collect(mount(makeWorld({ entries: doneEntries, running: false })).render())
const doneButton = doneView.nodes.find((node) => node.type === 'button' && String(node.props.className).includes('drp-rail'))
check('rail lingers briefly after a completed turn', !!doneButton)
check(
  'completed rail reports the settle state',
  !!doneButton && String(doneButton.props['aria-label']).includes(pick('Turn complete', '本轮已完成')),
  doneButton && doneButton.props['aria-label'],
)
check(
  'completed rail fills the track',
  doneView.nodes.some((node) => node.type === 'span' && String(node.props.className).includes('drp-fill') && node.props['data-phase'] === 'done'),
)

/* ============================================================ audit cases === */

/* 1. The durable window key ignores live stream frames. */
const durable = makeEntries()
const durableKey = moduleExports.durableWindowKey({ entries: durable, hasMore: false })
const withTransient = durable.concat([
  { type: 'transient', event: { type: 'assistant/live-chunk', seq: 900, time: BASE, data: { attemptId: 'a', turn: 2, step: 2, chunk: {} } } },
  { type: 'transient', event: { type: 'assistant/live-chunk', seq: 901, time: BASE, data: { attemptId: 'a', turn: 2, step: 2, chunk: {} } } },
])
check(
  'live stream frames do not change the durable window key',
  moduleExports.durableWindowKey({ entries: withTransient, hasMore: false }) === durableKey,
  durableKey,
)
check(
  'a durable append does change the durable window key',
  moduleExports.durableWindowKey({
    entries: durable.concat([
      { type: 'event', event: { type: 'turn/start', seq: 500, time: BASE, data: { turn: 3 } } },
    ]),
    hasMore: false,
  }) !== durableKey,
)
check('a missing window has an inert key', moduleExports.durableWindowKey(undefined) === 'none')

/* 2. A hostile sessions service degrades instead of crashing. */
const hostileApi = {
  binding: () => {
    throw new Error('binding unavailable')
  },
  retainInfo: () => {
    throw new Error('retain unavailable')
  },
}
let hostileCrash = null
let hostileTree = null
try {
  hostileTree = mount(makeWorld({ sessionsApi: hostileApi })).render()
} catch (error) {
  hostileCrash = error
}
check('a throwing sessions service does not crash the entry', hostileCrash === null, hostileCrash && hostileCrash.message)
check('without a binding nothing renders', hostileTree === null)

/* 3. A throwing projection store degrades instead of crashing. */
let projectionCrash = null
let projectionView = null
try {
  projectionView = collect(mount(makeWorld({ faceOfThrows: true })).render())
} catch (error) {
  projectionCrash = error
}
check('a throwing projection face does not crash the entry', projectionCrash === null, projectionCrash && projectionCrash.message)
check(
  'without projections the rail still renders and the pill stays away',
  !!projectionView &&
    projectionView.nodes.some((node) => node.type === 'button' && String(node.props.className).includes('drp-rail')) &&
    !projectionView.nodes.some((node) => node.type === 'button' && String(node.props.className).includes('drp-tokens')),
)

/* 4. Blocked storage must not break mount. */
const realGetItem = localStorageStub.getItem
localStorageStub.getItem = () => {
  throw new Error('storage blocked')
}
let storageCrash = null
let storageTree = null
try {
  storageTree = mount(world).render()
} catch (error) {
  storageCrash = error
}
localStorageStub.getItem = realGetItem
check('blocked storage does not crash the entry', storageCrash === null, storageCrash && storageCrash.message)
check('blocked storage still renders the rail', storageTree !== null)

/* 5. Oversized tool arguments stay bounded. */
const giantArguments = JSON.stringify({ command: 'x'.repeat(5000) })
const giantEntries = makeEntries().concat([
  { type: 'event', event: { type: 'tool/call', seq: 60, time: BASE + 1550, data: { turn: 2, step: 2, callId: 'call-9', name: 'bash', arguments: giantArguments } } },
])
const giantMount = mount(makeWorld({ entries: giantEntries }))
const giantRail = collect(giantMount.render()).nodes.find(
  (node) => node.type === 'button' && String(node.props.className).includes('drp-rail'),
)
giantRail.props.onClick()
const giantPanel = collect(giantMount.render())
const giantArgs = giantPanel.nodes.filter((node) => node.type === 'span' && String(node.props.className).includes('drp-tool-args'))
check('oversized arguments still render one bounded row', giantArgs.length >= 1)
const giantTexts = giantPanel.text.filter((value) => typeof value === 'string' && value.length > 400)
check(
  'oversized arguments are clipped, not dumped',
  giantTexts.length >= 1 && giantTexts.every((value) => value.length <= 601 && value.endsWith('…')),
  giantTexts.map((value) => value.length).join(','),
)

/* 6. The panel folds at most eight turns. */
const manyTurns = []
for (let turn = 1; turn <= 10; turn += 1) {
  manyTurns.push({ type: 'event', event: { type: 'turn/start', seq: 1000 + turn * 10, time: BASE + turn, data: { turn } } })
  manyTurns.push({ type: 'event', event: { type: 'step/start', seq: 1001 + turn * 10, time: BASE + turn, data: { turn, step: 1 } } })
  manyTurns.push({ type: 'event', event: { type: 'step/end', seq: 1002 + turn * 10, time: BASE + turn, data: { turn, step: 1 } } })
  manyTurns.push({ type: 'event', event: { type: 'turn/end', seq: 1003 + turn * 10, time: BASE + turn, data: { turn, reason: { kind: 'completed' } } } })
}
const manyMount = mount(makeWorld({ entries: manyTurns, running: false, todos: null }))
const manyRail = collect(manyMount.render()).nodes.find(
  (node) => node.type === 'button' && String(node.props.className).includes('drp-rail'),
)
manyRail.props.onClick()
const manyPanel = collect(manyMount.render())
check(
  'the panel folds at most eight turns',
  manyPanel.nodes.filter((node) => node.type === 'section' && String(node.props.className).includes('drp-turn')).length === 8,
  manyPanel.nodes.filter((node) => node.type === 'section' && String(node.props.className).includes('drp-turn')).length,
)

/* 7. Switching Session collapses the expanded card. */
const switchMount = mount(makeWorld({}))
const switchRail = collect(switchMount.render()).nodes.find(
  (node) => node.type === 'button' && String(node.props.className).includes('drp-rail'),
)
switchRail.props.onClick()
const beforeSwitch = collect(switchMount.render())
beforeSwitch.nodes
  .filter((node) => node.type === 'button' && String(node.props.className).includes('drp-turn-toggle'))
  .pop()
  .props.onClick()
const openedBeforeSwitch = collect(switchMount.render()).nodes.filter(
  (node) => node.type === 'section' && node.props['data-expanded'] === 'true',
)
switchMount.use(makeWorld({ sessionId: 'session-2' }))
switchMount.render() // the reset effect runs after the first switched render
const afterSwitch = collect(switchMount.render()).nodes.filter(
  (node) => node.type === 'section' && node.props['data-expanded'] === 'true',
)
check('a card can be opened before the switch', openedBeforeSwitch.length === 1)
check('switching Session collapses the open card', afterSwitch.length === 0)

/* 8. A turn without reported usage gets no Token line. */
const noUsageEntries = [
  { type: 'event', event: { type: 'turn/start', seq: 1, time: BASE, data: { turn: 1 } } },
  { type: 'event', event: { type: 'step/start', seq: 2, time: BASE + 10, data: { turn: 1, step: 1 } } },
  { type: 'event', event: { type: 'step/end', seq: 3, time: BASE + 20, data: { turn: 1, step: 1 } } },
  { type: 'event', event: { type: 'turn/end', seq: 4, time: BASE + 30, data: { turn: 1, reason: { kind: 'completed' } } } },
]
const noUsageMount = mount(makeWorld({ entries: noUsageEntries, running: false, todos: null }))
const noUsageRail = collect(noUsageMount.render()).nodes.find(
  (node) => node.type === 'button' && String(node.props.className).includes('drp-rail'),
)
noUsageRail.props.onClick()
const noUsagePanel = collect(noUsageMount.render())
check(
  'a turn without usage has no Token line',
  noUsagePanel.nodes.filter((node) => node.type === 'div' && String(node.props.className).includes('drp-turn-tokens')).length === 0,
)

/* 9. The entry is inert without the session hook. */
check('the entry is inert without the session hook', Entry({}) === null)

/* 11. A drag writes storage once, on release — not on every pointer move. */
storage.delete('dsh-run-progress:chip-position')
const storageDragMount = mount(world)
storageDragMount.render()
const storageChip = collect(storageDragMount.render()).nodes.find(
  (node) => node.type === 'button' && String(node.props.className).includes('drp-tokens'),
)
storageChip.props.onPointerDown({ button: 0, pointerId: 11, clientX: 100, clientY: 100, currentTarget: dragTarget })
storageChip.props.onPointerMove({ clientX: 60, clientY: 140, buttons: 1, currentTarget: dragTarget })
check('moving a drag does not write storage yet', !storage.has('dsh-run-progress:chip-position'))
const storageChipAfter = collect(storageDragMount.render()).nodes.find(
  (node) => node.type === 'button' && String(node.props.className).includes('drp-tokens'),
)
storageChipAfter.props.onPointerUp({ clientX: 60, clientY: 140, currentTarget: dragTarget })
check(
  'releasing the drag writes the position once',
  storage.get('dsh-run-progress:chip-position') === JSON.stringify({ right: 60, top: 560 }),
  storage.get('dsh-run-progress:chip-position'),
)
storage.delete('dsh-run-progress:chip-position')

/* 12. A pointer released outside the pill must not leave a drag armed. */
const zeroMount = mount(world)
zeroMount.render()
const zeroChip = collect(zeroMount.render()).nodes.find(
  (node) => node.type === 'button' && String(node.props.className).includes('drp-tokens'),
)
zeroChip.props.onPointerDown({ button: 0, pointerId: 12, clientX: 100, clientY: 100, currentTarget: dragTarget })
zeroChip.props.onPointerMove({ clientX: 10, clientY: 10, buttons: 0, currentTarget: dragTarget })
const zeroChipAfter = collect(zeroMount.render()).nodes.find(
  (node) => node.type === 'button' && String(node.props.className).includes('drp-tokens'),
)
check('a released pointer disarms the drag', zeroChipAfter.props.style === undefined)
check('an aborted drag writes nothing', !storage.has('dsh-run-progress:chip-position'))

/* 13. Every literal t() key exists in both dictionaries. */
const tKeys = [...new Set([...source.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)].map((match) => match[1]))]
const zhKeys = new Set(Object.keys(moduleExports.messages.zh))
const enKeys = new Set(Object.keys(moduleExports.messages.en))
const untranslated = tKeys.filter((key) => !zhKeys.has(key) || !enKeys.has(key))
check('every literal t() key is translated in both languages', untranslated.length === 0, untranslated.join(','))
check(
  'both dictionaries carry the same keys',
  zhKeys.size === enKeys.size && [...zhKeys].every((key) => enKeys.has(key)),
  `${zhKeys.size}/${enKeys.size}`,
)
const statusKeys = ['statusDone', 'statusFailed', 'statusAborted', 'statusInterrupted', 'statusBlocked', 'statusMaxTokens', 'statusForked']
check(
  'every status reason has copy',
  statusKeys.every((key) => zhKeys.has(key) && enKeys.has(key)),
  statusKeys.filter((key) => !zhKeys.has(key) || !enKeys.has(key)).join(','),
)
check(
  'the host receives exactly the zh/en dictionary pair',
  Object.keys(moduleExports.messages).sort().join(',') === 'en,zh',
  Object.keys(moduleExports.messages).join(','),
)

/* ================================ hook-order guard (React #310 / #300) ====== */

/**
 * A hook called after a conditional `return` changes the hook count between
 * renders, and React rejects that outright:
 *   #310 "Rendered more hooks than during the previous render."
 *   #300 "Rendered fewer hooks than expected…"
 * The offline harness below cannot reproduce it (its React is a slot allocator
 * without hook-order validation), so the rule is enforced statically instead.
 *
 * Returns `<component>:<line>` for every component that calls a hook after an
 * early `return null` / `return undefined` at statement indentation.
 */
function hooksAfterEarlyReturn(text) {
  const lines = text.split('\n')
  const violations = []
  let component = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const declaration = /^ {4}function ([A-Za-z_$][\w$]*)\(/.exec(line)
    if (declaration) {
      component = { name: declaration[1], earlyReturn: false }
      continue
    }
    if (!component) continue
    if (/^ {6}if \(.*\) return (?:null|undefined)\s*$/.test(line)) {
      component.earlyReturn = true
      continue
    }
    // A component body ends at the next top-level declaration of any kind.
    if (/^ {4}(?:function|class|const|let|var) /.test(line) && !/^ {4}function /.test(line)) {
      component = null
      continue
    }
    if (component.earlyReturn && /React\.use[A-Z]/.test(line)) {
      violations.push(`${component.name}:${index + 1}`)
    }
  }
  return violations
}

const violations = hooksAfterEarlyReturn(source)
check('no hook after an early return in any component', violations.length === 0, violations.join(', '))

// The guard itself must be able to fail, or it proves nothing.
const guardSample = [
  '    function Demo(props) {',
  '      const [value] = React.useState(0)',
  '      if (!props.ok) return null',
  '      const stable = React.useCallback(() => value, [])',
  '      return stable',
  '    }',
  '',
].join('\n')
check('the hook-order guard detects a planted violation', hooksAfterEarlyReturn(guardSample).length === 1)

/**
 * The rest of the rules-of-hooks, which the fake React cannot see either:
 *  - a hook may not live inside a block (if / for / try) — only at statement level
 *  - a function that calls a hook must be named `use*` or like a component
 */
function hookPlacementViolations(text) {
  const lines = text.split(/\r?\n/)
  const problems = []
  let owner = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const declaration = /^ {4}function ([A-Za-z_$][\w$]*)\(/.exec(line)
    if (declaration) {
      owner = declaration[1]
      continue
    }
    if (!owner) continue
    if (/^ {4}(?:class|const|let|var) /.test(line)) {
      owner = null
      continue
    }
    if (!/React\.use[A-Z]/.test(line)) continue
    const indent = /^( *)/.exec(line)[1].length
    if (indent > 6) problems.push(`${owner}:${index + 1} hook inside a block`)
    if (!/^use[A-Z]/.test(owner) && !/^[A-Z]/.test(owner)) {
      problems.push(`${owner}:${index + 1} hook in a non-hook function`)
    }
  }
  return problems
}

const placement = hookPlacementViolations(source)
check('every hook sits at statement level and in a hook/component function', placement.length === 0, placement.join(', '))
const placementSample = [
  '    function Demo(props) {',
  '      if (props.ok) {',
  '        const [value] = React.useState(0)',
  '      }',
  '      return null',
  '    }',
  '',
].join('\n')
check('the placement guard detects a planted violation', hookPlacementViolations(placementSample).length > 0)

/* ====================== null -> content state transition (#310 repro) ======= */

/**
 * The failure only shows up on ONE component instance changing shape: it renders
 * the empty early return first (idle, no projections yet) and then the full tree
 * (a turn starts, or token usage arrives). Under real React a hook placed after
 * that early return makes this render throw.
 */
const transitionMount = mount(makeWorld({ running: false, tokenUsage: null, contextPressure: null, entries: [] }))
const transitionEmpty = transitionMount.render()
check('the entry is empty while idle and without projections', transitionEmpty === null, String(transitionEmpty && transitionEmpty.type))

let transitionCrash = null
let transitionView = null
try {
  transitionMount.use(makeWorld({}))
  transitionView = collect(transitionMount.render())
} catch (error) {
  transitionCrash = error
}
check(
  'idle-empty -> running renders instead of throwing',
  transitionCrash === null && !!transitionView,
  transitionCrash && transitionCrash.message,
)
check(
  'the rail appears after that transition',
  !!transitionView && transitionView.nodes.some((node) => node.type === 'button' && String(node.props.className).includes('drp-rail')),
)

// And back again: content -> empty must not throw either (#300 direction).
let backCrash = null
let backTree = 'unset'
try {
  transitionMount.use(makeWorld({ running: false, tokenUsage: null, contextPressure: null, entries: [] }))
  backTree = transitionMount.render()
} catch (error) {
  backCrash = error
}
check('running -> idle-empty returns to nothing without throwing', backCrash === null && backTree === null, backCrash && backCrash.message)

// Opening the panel and closing it again is the other legal shape change.
let panelCrash = null
let panelOpen = null
try {
  transitionMount.use(makeWorld({}))
  const rail = collect(transitionMount.render()).nodes.find(
    (node) => node.type === 'button' && String(node.props.className).includes('drp-rail'),
  )
  rail.props.onClick()
  panelOpen = collect(transitionMount.render())
  const panel = panelOpen.nodes.find((node) => node.type === 'aside')
  const closeButton = panel && panelOpen.nodes.find((node) => node.type === 'button' && String(node.props.className).includes('drp-panel-close'))
  if (closeButton) closeButton.props.onClick()
  transitionMount.render()
} catch (error) {
  panelCrash = error
}
check('opening and closing the panel keeps rendering', panelCrash === null, panelCrash && panelCrash.message)
check('the panel opens on that transition', !!panelOpen && !!panelOpen.nodes.find((node) => node.type === 'aside'))

console.log('')
globalThis.setInterval = realSetInterval
if (failures.length > 0) {
  console.log(`FAILED ${failures.length}: ${failures.join(', ')}`)
  process.exit(1)
} else {
  console.log('all checks passed')
  process.exit(0)
}