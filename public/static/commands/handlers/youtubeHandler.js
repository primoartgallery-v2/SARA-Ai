/**
 * SARA AI - YouTube Action Handler (Phase 1D)
 *
 * Implements safe, allowlist-restricted YouTube navigation, search, and play commands.
 * Reuses the centralized Phase 1C security infrastructure (isAllowedExternalUrl)
 * to guarantee strict HTTPS enforcement, exact domain validation, and safe popup-blocking handling.
 */

import { isAllowedExternalUrl } from "./webHandler.js";

/**
 * Safely constructs a YouTube search URL using the browser URL API.
 * Ensures the search query is properly URL-encoded and safe.
 *
 * @param {string} query - Raw search query text
 * @returns {string|null} Validated YouTube search URL, or null if invalid
 */
export function buildYouTubeSearchUrl(query) {
  if (!query || typeof query !== "string") {
    return null;
  }

  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL("https://www.youtube.com/results");
    url.searchParams.set("search_query", trimmed);
    const urlString = url.toString();
    return isAllowedExternalUrl(urlString) ? urlString : null;
  } catch {
    return null;
  }
}

/**
 * Handle validated YouTube command intents (youtube.open, youtube.search, youtube.play).
 *
 * Note on Autoplay Limitation (Section 8):
 * Due to browser autoplay policies and cross-origin sandboxing, third-party browser
 * restrictions prevent guaranteed unmuted autoplay.
 * Therefore, youtube.play safely navigates to the relevant YouTube search results page,
 * where the user selects and plays the desired media. SARA does not inject scripts or
 * attempt to bypass browser autoplay security restrictions.
 *
 * @param {Object} parsedIntent - Structured intent from parser
 * @param {Object} [context={}] - Application UI context hooks
 * @returns {Promise<Object>} Execution result { handled: boolean, intent: string, blocked?: boolean, url?: string, label?: string }
 */
export async function handleYouTube(parsedIntent, context = {}) {
  const intent = parsedIntent?.intent;

  try {
    let targetUrl = null;
    let label = "YouTube";

    switch (intent) {
      // A. YouTube Open
      case "youtube.open": {
        targetUrl = "https://www.youtube.com/";
        label = "YouTube";
        break;
      }

      // B. YouTube Search
      case "youtube.search": {
        const query = parsedIntent?.query;
        if (!query) {
          return { handled: false };
        }
        targetUrl = buildYouTubeSearchUrl(query);
        label = `YouTube Search ("${query}")`;
        break;
      }

      // C. YouTube Play
      case "youtube.play": {
        const query = parsedIntent?.query;
        if (!query) {
          return { handled: false };
        }
        targetUrl = buildYouTubeSearchUrl(query);
        label = `YouTube Play ("${query}")`;
        break;
      }

      default:
        return { handled: false };
    }

    // Verify safe URL validation using centralized security check
    if (!targetUrl || !isAllowedExternalUrl(targetUrl)) {
      return { handled: false };
    }

    // Attempt browser navigation safely
    let win = null;
    try {
      if (typeof context.openWindow === "function") {
        win = context.openWindow(targetUrl, "_blank", "noopener,noreferrer");
      } else if (typeof window !== "undefined" && typeof window.open === "function") {
        win = window.open(targetUrl, "_blank", "noopener,noreferrer");
      }
    } catch (openErr) {
      console.warn("[SARA YouTubeHandler] window.open failed:", openErr);
      win = null;
    }

    // Detect popup blocking
    const isBlocked = !win;

    return {
      handled: true,
      intent,
      blocked: isBlocked,
      url: targetUrl,
      label
    };
  } catch (err) {
    console.warn("[SARA YouTubeHandler] Error executing YouTube command:", err);
    return { handled: false };
  }
}
