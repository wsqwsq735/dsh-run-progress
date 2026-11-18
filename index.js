/**
 * Host half of dsh-run-progress.
 *
 * The whole feature is a browser surface: the rail and its run-flow panel are
 * registered from `client.js` into the Web GUI's frame-wide overlay slot. The
 * Host row exists so the bundle has an inventory entry that can be enabled and
 * disabled, and so `client.js` is loaded beside it. It owns no Host state.
 *
 * @module dsh-run-progress
 */

/** Nothing to inject: this half registers no Host resource. */
export const inject = []

/**
 * Activate the Host row.
 * @returns {void}
 */
export function apply() {}