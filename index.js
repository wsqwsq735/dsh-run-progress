/**
 * Host half of dsh-run-progress.
 *
 * The visible feature is a browser surface: the rail and its run-flow panel are
 * registered from `client.js` into the Web GUI's frame-wide overlay slot.
 *
 * This half exists for the one thing a browser half cannot do. The rail's
 * percentage is a real measurement only while the agent keeps a task list: the
 * client reads the `todos` projection, which the built-in `todo_write` tool
 * fills. A model asked to "do this" tends to skip the list for anything under a
 * handful of steps, so this row contributes one short system-prompt section that
 * asks for the list on multi-step work — and contributes an empty section when
 * the tool is not installed, so the prompt never names a tool that is missing.
 *
 * Nothing else here touches Host state; the section is registered as an effect
 * and disappears with the row.
 *
 * @module dsh-run-progress
 */

/** No hard service dependency: every service below is looked up optionally. */
export const inject = []

/** Section name: unique in the layer, so a profile override can shadow it. */
const SECTION_NAME = 'run-progress-task-list'

/**
 * Placement: after the plan/team policies (500/600) and before the per-tool
 * sections (900+), which is where behavioural instructions already live.
 */
const SECTION_ORDER = 650

/** The instruction, kept short because it is prepended to every model request. */
const NUDGE = [
  '## Task progress',
  'Before starting a task that needs more than a couple of steps, call `todo_write`',
  'with one item per concrete step, then keep that list current: mark items completed',
  'as they finish and add what you discover. The user reads this list as a progress',
  'bar, so a list that is not maintained reports the wrong progress.',
].join('\n')

/**
 * Whether the todo tool is registered right now.
 *
 * Read on every prompt assembly rather than once at activation: another plugin
 * can enable or disable the tool while this row stays loaded.
 */
function todoToolAvailable(ctx) {
  const tools = ctx.get('tools')
  if (!tools || typeof tools.get !== 'function') return false
  try {
    return Boolean(tools.get('todo_write'))
  } catch (error) {
    return false
  }
}

/**
 * Activate the Host row.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the row's context.
 * @returns {void}
 */
export function apply(ctx) {
  // An escape hatch for profiles that already carry their own task-list policy.
  if (process.env.DSH_RUN_PROGRESS_TODO_NUDGE === '0') return
  const systemPrompt = ctx.get('systemPrompt')
  if (!systemPrompt || typeof systemPrompt.section !== 'function') return
  ctx.effect(() =>
    systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: () => (todoToolAvailable(ctx) ? NUDGE : ''),
    }),
  )
}