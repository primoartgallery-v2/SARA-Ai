/**
 * SARA AI - Modular Command Engine (Phase 1A Foundation)
 *
 * Orchestrates intent parsing, action registry lookups, and error-isolated execution.
 * In Phase 1A, all inputs resolve safely to { handled: false }, ensuring 100%
 * zero regression for all existing chat, streaming, and model flows.
 */

import { parseCommand } from "./parser.js";
import { registerCommand, getCommand, hasCommand } from "./registry.js";
import { handleYouTube } from "./handlers/youtubeHandler.js";
import { handleWeb } from "./handlers/webHandler.js";
import { handleUI } from "./handlers/uiHandler.js";

// Initialize handler bindings in the registry
registerCommand("youtube.open", handleYouTube);
registerCommand("youtube.search", handleYouTube);
registerCommand("youtube.play", handleYouTube);
registerCommand("web.google_search", handleWeb);
registerCommand("web.open_google", handleWeb);
registerCommand("web.open_allowed_site", handleWeb);
registerCommand("ui.new_chat", handleUI);
registerCommand("ui.clear_chat", handleUI);
registerCommand("ui.theme_dark", handleUI);
registerCommand("ui.theme_light", handleUI);
registerCommand("ui.toggle_web_on", handleUI);
registerCommand("ui.toggle_web_off", handleUI);
registerCommand("ui.stop_generation", handleUI);
registerCommand("model.switch", handleUI);
registerCommand("personality.set_mode", handleUI);

/**
 * Handle incoming user input (voice or typed).
 *
 * @param {string} input - User message text
 * @param {Object} [context={}] - Optional application state/context
 * @returns {Promise<Object>} Standardized result: { handled: boolean, action?: string, message?: string }
 */
export async function handleCommand(input, context = {}) {
  try {
    if (!input || typeof input !== "string") {
      return { handled: false };
    }

    // Step 1: Parse input for potential command intent
    const parsed = parseCommand(input);
    if (!parsed || !parsed.matched || !parsed.intent) {
      return { handled: false };
    }

    // Step 2: Look up action in the registry
    if (!hasCommand(parsed.intent)) {
      return { handled: false };
    }

    const handler = getCommand(parsed.intent);
    if (typeof handler !== "function") {
      return { handled: false };
    }

    // Step 3: Execute handler safely
    const result = await handler(parsed, context);
    return result && typeof result.handled === "boolean" ? result : { handled: false };
  } catch (err) {
    // CRITICAL ERROR ISOLATION:
    // Any unexpected exception inside command processing must be caught and logged,
    // NEVER interrupting the user's primary chat experience.
    console.warn("[SARA CommandEngine] Non-fatal evaluation error:", err);
    return { handled: false };
  }
}

// Global browser hook for non-invasive consumption by app.js
if (typeof window !== "undefined") {
  window.commandEngine = {
    handle: handleCommand,
    version: "1.0.0-phase1e"
  };
}
