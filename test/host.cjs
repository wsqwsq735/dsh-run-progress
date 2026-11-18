/**
 * Host-half check: `index.js` registers one system-prompt section that asks for a
 * task list, and stays inert when the todo tool is absent or the nudge is off.
 *
 * A Host plugin is ESM, so this file imports it dynamically; the fake context
 * below is only as large as the code under test.
 */

const path = require('node:path')
const { pathToFileURL } = require('node:url')

const failures = []
function check(label, condition, detail) {
  if (condition) console.log(`ok   ${label}`)
  else {
    failures.push(label)
    console.log(`FAIL ${label}${detail === undefined ? '' : ` -> ${detail}`}`)
  }
}

/** Activation harness: records what the plugin registers on a fake context. */
function activate(services) {
  const registered = []
  const disposers = []
  const ctx = {
    get: (key) => services[key],
    effect: (fn) => {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
  }
  return { ctx, registered, disposers }
}

function hostContext(options = {}) {
  const sections = []
  const services = {
    systemPrompt: {
      section: (definition) => {
        sections.push(definition)
        return () => {}
      },
    },
  }
  if (options.todoTool !== false) {
    services.tools = { get: (name) => (name === 'todo_write' ? { name: 'todo_write' } : undefined) }
  }
  return { services, sections }
}

;(async () => {
  const entry = await import(pathToFileURL(path.join(__dirname, '..', 'index.js')).href)

  check('the host half exports apply', typeof entry.apply === 'function')
  check('the host half declares no hard injection', Array.isArray(entry.inject) && entry.inject.length === 0)

  // 1. The todo tool exists: one section, and its text is the instruction.
  {
    const { services, sections } = hostContext()
    const harness = activate(services)
    entry.apply(harness.ctx)
    check('registers exactly one prompt section', sections.length === 1, String(sections.length))
    const section = sections[0] || {}
    check('the section has a stable name', section.name === 'run-progress-task-list', section.name)
    check('the section sorts before the per-tool sections', section.order > 0 && section.order < 900, String(section.order))
    const text = typeof section.text === 'function' ? section.text({}) : section.text
    check('the instruction names the todo tool', typeof text === 'string' && text.includes('todo_write'), String(text).slice(0, 60))
    check('the instruction explains why', typeof text === 'string' && /progress/i.test(text))
    check('activation is registered as an effect', harness.disposers.length === 1, String(harness.disposers.length))
  }

  // 2. No todo tool in this profile: the section contributes nothing.
  {
    const { services, sections } = hostContext({ todoTool: false })
    entry.apply(activate(services).ctx)
    const section = sections[0] || {}
    const text = typeof section.text === 'function' ? section.text({}) : section.text
    check('an absent todo tool yields an empty section', text === '', String(text).slice(0, 40))
  }

  // 3. The environment opt-out.
  {
    const { services, sections } = hostContext()
    process.env.DSH_RUN_PROGRESS_TODO_NUDGE = '0'
    entry.apply(activate(services).ctx)
    delete process.env.DSH_RUN_PROGRESS_TODO_NUDGE
    check('DSH_RUN_PROGRESS_TODO_NUDGE=0 disables the section', sections.length === 0, String(sections.length))
  }

  // 4. A host without the system-prompt service must not throw.
  {
    const harness = activate({})
    let crash = null
    try {
      entry.apply(harness.ctx)
    } catch (error) {
      crash = error
    }
    check('a host without systemPrompt is tolerated', crash === null, crash && crash.message)
  }

  console.log('')
  if (failures.length > 0) {
    console.log(`FAILED ${failures.length}: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('all host checks passed')
  process.exit(0)
})().catch((error) => {
  console.log(`CRASHED: ${error && error.stack ? error.stack : error}`)
  process.exit(1)
})