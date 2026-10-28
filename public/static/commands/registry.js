/**
 * SARA AI - Action Registry (Phase 1A Foundation)
 *
 * Centralized registry mapping command intents to action handlers.
 * Avoids large if/else or switch-case chains.
 */

const registry = new Map();

/**
 * Register an action handler for a specific intent name.
 * @param {string} name - Action intent identifier (e.g. 'youtube.search')
 * @param {Function} handler - Handler function (async)
 */
export function registerCommand(name, handler) {
  if (!name || typeof handler !== "function") return;
  registry.set(String(name).toLowerCase().trim(), handler);
}

/**
 * Retrieve registered action handler by intent name.
 * @param {string} name - Action intent identifier
 * @returns {Function|undefined}
 */
export function getCommand(name) {
  if (!name) return undefined;
  return registry.get(String(name).toLowerCase().trim());
}

/**
 * Check if an intent has a registered handler.
 * @param {string} name - Action intent identifier
 * @returns {boolean}
 */
export function hasCommand(name) {
  if (!name) return false;
  return registry.has(String(name).toLowerCase().trim());
}

/**
 * List all registered action intent names.
 * @returns {string[]}
 */
export function getAllCommands() {
  return Array.from(registry.keys());
}

/**
 * Clear all registered actions (primarily for testing).
 */
export function clearCommands() {
  registry.clear();
}
