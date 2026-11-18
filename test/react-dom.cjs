/**
 * Real-React check.
 *
 * `test/smoke.cjs` renders with a hand-written React stand-in: it verifies the
 * output tree, but it cannot enforce React's hook rules (it allocates hook slots
 * by index and never counts them), which is exactly how an early-return hook bug
 * shipped unnoticed (React error #310). This file renders the same entry with
 * real `react-dom` into jsdom, so React's own invariants run.
 *
 * The failure mode to catch is quiet: the entry wraps itself in an error
 * boundary, so a throwing render shows up as a `.drp-failure` pill instead of an
 * exception. Every step therefore asserts BOTH "no throw" and "no failure pill",
 * plus an empty console.error.
 *
 * Requires react, react-dom and jsdom. Point DSH_TEST_DEPS at a package.json that
 * can resolve them:
 *
 *   pnpm add react react-dom jsdom --dir "$env:TEMP\dsh-react-check" --registry=https://registry.npmmirror.com
 *   $env:DSH_TEST_DEPS = "$env:TEMP\dsh-react-check\package.json"
 *   node test/react-dom.cjs
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')

const depsPath = process.env.DSH_TEST_DEPS || path.join(os.tmpdir(), 'dsh-react-check', 'package.json')
let depRequire
try {
  depRequire = createRequire(depsPath)
} catch (error) {
  console.log(`SKIP: cannot resolve test dependencies from ${depsPath}`)
  process.exit(0)
}
let React
let ReactDOMClient
let JSDOM
try {
  React = depRequire('react')
  ReactDOMClient = depRequire('react-dom/client')
  JSDOM = depRequire('jsdom').JSDOM
} catch (error) {
  console.log(`SKIP: react / react-dom / jsdom not installed next to ${depsPath}`)
  process.exit(0)
}

/* ------------------------------------------------------------------- setup -- */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.navigator = window.navigator
globalThis.localStorage = window.localStorage
globalThis.HTMLElement = window.HTMLElement
globalThis.Node = window.Node
globalThis.Event = window.Event
globalThis.MouseEvent = window.MouseEvent
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const act = React.act || depRequire('react-dom/test-utils').act

const errors = []
const warnings = []
const realError = console.error
const realWarn = console.warn
console.error = (...args) => {
  errors.push(args.map((value) => (value && value.message) || String(value)).join(' '))
}
console.warn = (...args) => {
  warnings.push(args.map((value) => String(value)).join(' '))
}

/* -------------------------------------------------------------- load plugin -- */

// DSH_CLIENT_PATH lets a mutation run point at a deliberately broken copy.
const clientPath = process.env.DSH_CLIENT_PATH || path.join(__dirname, '..', 'client.js')
const source = fs.readFileSync(clientPath, 'utf8')

let captured
window.__ModuleLoader__ = {
  load(definition) {
    captured = definition
  },
}
new Function('window', `${source}\n`)(window)
if (!captured || captured.id !== 'dsh-run-progress') throw new Error('factory was not captured')

const moduleExports = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected module ${name}`)
})

const registered = []
const ctx = {
  effect: (fn) => {
    fn()
    return () => {}
  },
  get: (key) => ctx[key],
  locale: { register: () => () => {} },
  slots: {
    inject: (_key, callback) => callback(),
    register: (options, component) => {
      registered.push({ options, component })
      return () => {}
    },
  },
}
moduleExports.apply(ctx)
const Entry = registered[0].component

/* --------------------------------------------------------------- fake world -- */

const BASE = 1_700_000_000_000
const TODOS = [
  { content: 'Audit the bundle', status: 'completed' },
  { content: 'Ship the fix', status: 'in_progress' },
]
const TOKEN_USAGE = { uncachedInputTokens: 9_000, outputTokens: 2_100, cacheReadTokens: 4_200, cacheWriteTokens: 1_100 }
const CONTEXT = { pressureTokens: 14_000, projectedTokens: 15_500, contextWindow: 51_200 }

const ENTRIES = [
  { type: 'event', event: { type: 'turn/start', seq: 1, time: BASE, data: { turn: 1 } } },
  { type: 'event', event: { type: 'user/message', seq: 2, time: BASE + 10, data: { source: { kind: 'user' }, content: 'Check the rail renderer.' } } },
  { type: 'event', event: { type: 'step/start', seq: 3, time: BASE + 20, data: { turn: 1, step: 1 } } },
  { type: 'event', event: { type: 'tool/call', seq: 4, time: BASE + 30, data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"file_path":"client.js"}' } } },
  { type: 'event', event: { type: 'tool/result', seq: 5, time: BASE + 40, data: { turn: 1, step: 1, message: { toolCallId: 'c1', isError: false } } } },
  { type: 'event', event: { type: 'assistant/message', seq: 6, time: BASE + 50, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Rail renders fine.' }] }, usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, cacheWriteTokens: 0 } } } },
  { type: 'event', event: { type: 'step/end', seq: 7, time: BASE + 60, data: { turn: 1, step: 1 } } },
  { type: 'event', event: { type: 'turn/end', seq: 8, time: BASE + 70, data: { turn: 1, reason: { kind: 'completed' } } } },
]

/** One immutable snapshot per source, so useSyncExternalStore sees stable refs. */
function makeSource(initial) {
  let value = initial
  const listeners = new Set()
  const snapshot = { current: value }
  return {
    set(next) {
      value = next
      snapshot.current = next
      for (const listener of listeners) listener()
    },
    getSnapshot: () => snapshot.current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function makeWorld(options) {
  const running = options.running === true
  const entries = options.entries === undefined ? ENTRIES : options.entries
  const todos = options.todos === undefined ? TODOS : options.todos
  const tokenUsage = options.tokenUsage === undefined ? TOKEN_USAGE : options.tokenUsage
  const contextPressure = options.contextPressure === undefined ? CONTEXT : options.contextPressure
  const sessionId = options.sessionId || 'session-1'

  const sessionSource = makeSource({ running, openState: 'open' })
  const eventSource = makeSource({ entries, hasMore: false, revision: 1 })
  const faces = {
    todos: makeSource(todos),
    tokenUsage: makeSource(tokenUsage),
    contextPressure: makeSource(contextPressure),
  }
  const session = {
    getSnapshot: sessionSource.getSnapshot,
    subscribe: sessionSource.subscribe,
    projections: {
      faceOf(key) {
        return faces[key] || makeSource(undefined)
      },
    },
  }
  const binding = { sessionId, session, eventSource }
  const listSource = makeSource({
    ids: [sessionId],
    byId: { [sessionId]: { id: sessionId, displayTitle: 'Rail', running, retainedBy: { mainView: 1 } } },
    phase: 'ready',
    projectionsBySession: {},
  })
  const sessionsApi = {
    binding: () => binding,
    retainInfo: () => ({ getSnapshot: () => ({ referenceCount: 1 }), subscribe: () => () => {} }),
  }
  return {
    sessionId,
    sessionsApi,
    useSessions: (selector) => selector(listSource.getSnapshot()),
    sessionSource,
    eventSource,
  }
}

/* ------------------------------------------------------------------ harness -- */

const failures = []
function check(label, condition, detail) {
  if (condition) console.log(`ok   ${label}`)
  else {
    failures.push(label)
    console.log(`FAIL ${label}${detail === undefined ? '' : ` -> ${detail}`}`)
  }
}

const container = window.document.getElementById('root')
const root = ReactDOMClient.createRoot(container)

/** Render the entry for one world; never let a throw escape unnoticed. */
async function render(world, injected) {
  let thrown = null
  try {
    await act(async () => {
      root.render(React.createElement(Entry, { useSessions: world.useSessions, t: undefined, ...injected }))
    })
  } catch (error) {
    thrown = error
  }
  return {
    thrown,
    errorCount: errors.length,
    html: container.innerHTML,
    failurePill: container.querySelector('.drp-failure'),
    rail: container.querySelector('.drp-rail'),
    chip: container.querySelector('.drp-tokens'),
    panel: container.querySelector('aside.drp-panel'),
  }
}

function click(selector) {
  const element = container.querySelector(selector)
  if (!element) throw new Error(`cannot click ${selector}`)
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
}

;(async () => {
  const idle = makeWorld({ running: false, entries: [], todos: null, tokenUsage: null, contextPressure: null })
  const live = makeWorld({ running: true })

  // The entry is inert before a Session is bound.
  await act(async () => {
    root.render(null)
  })

  const injected = () => {
    ctx.sessions = currentWorld.sessionsApi
    return registered[0].options.inject()
  }
  let currentWorld = idle
  let view = await render(idle, injected())

  check('idle + no projections renders nothing', view.html === '' && view.rail === null, view.html.slice(0, 80))
  check('the idle render does not throw', view.thrown === null, view.thrown && view.thrown.message)
  check('the idle render raises no React error', view.errorCount === 0, errors.join(' | '))

  // THE transition that produced #310 under real React.
  currentWorld = live
  view = await render(live, injected())
  check('empty -> running does not throw', view.thrown === null, view.thrown && view.thrown.message)
  check('empty -> running shows no failure pill', view.failurePill === null, view.failurePill && view.failurePill.textContent)
  check('empty -> running renders the rail', view.rail !== null)
  check('the chip renders with token usage', view.chip !== null)
  check('no React error after the transition', view.errorCount === 0, errors.join(' | '))

  // Open the panel (adds a subtree with its own hook, legally).
  await act(async () => {
    click('.drp-rail')
  })
  view = await render(live, injected())
  check('the panel opens', view.panel !== null)
  check('opening the panel shows no failure pill', view.failurePill === null, view.failurePill && view.failurePill.textContent)

  // Expand one turn.
  await act(async () => {
    click('.drp-turn-toggle')
  })
  check('a turn expands', container.querySelector('[data-expanded="true"]') !== null)
  check('expanding shows no failure pill', container.querySelector('.drp-failure') === null)

  // Close the panel again.
  await act(async () => {
    click('.drp-x')
  })
  view = await render(live, injected())
  check('the panel closes', view.panel === null)
  check('closing shows no failure pill', view.failurePill === null, view.failurePill && view.failurePill.textContent)

  // Back to empty: the #300 direction (fewer hooks than the previous render).
  currentWorld = idle
  view = await render(idle, injected())
  check('running -> empty does not throw', view.thrown === null, view.thrown && view.thrown.message)
  check('running -> empty shows no failure pill', view.failurePill === null, view.failurePill && view.failurePill.textContent)
  check('running -> empty renders nothing again', view.rail === null, view.html.slice(0, 80))

  // And once more, so a stable instance survives repeat transitions.
  currentWorld = live
  view = await render(live, injected())
  check('empty -> running a second time is clean', view.thrown === null && view.failurePill === null, view.thrown && view.thrown.message)
  check('the rail is back', view.rail !== null)

  // A Session switch must not disturb the hook order either.
  const other = makeWorld({ sessionId: 'session-2', running: true })
  currentWorld = other
  view = await render(other, injected())
  check('switching Session does not throw', view.thrown === null, view.thrown && view.thrown.message)
  check('switching Session shows no failure pill', view.failurePill === null, view.failurePill && view.failurePill.textContent)

  check('no React warning was logged', warnings.length === 0, warnings.join(' | '))
  check('no console.error was logged', errors.length === 0, errors.join(' | '))

  await act(async () => {
    root.unmount()
  })

  console.error = realError
  console.warn = realWarn
  console.log('')
  if (failures.length > 0) {
    console.log(`FAILED ${failures.length}: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('all real-React checks passed')
  process.exit(0)
})().catch((error) => {
  console.error = realError
  console.log(`CRASHED: ${error && error.stack ? error.stack : error}`)
  process.exit(1)
})