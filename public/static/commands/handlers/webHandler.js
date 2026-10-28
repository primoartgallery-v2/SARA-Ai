/**
 * SARA AI - Web & Safe Navigation Action Handler (Phase 1C)
 *
 * Implements safe, allowlist-restricted external web navigation and Google Search.
 * Ensures zero unsafe protocol execution, strict HTTPS enforcement, exact domain
 * validation, and safe popup-blocking fallbacks.
 */

/**
 * Strict allowlist of permitted external domains for Phase 1C & 1D.
 * Deceptive domains (e.g., google.com.evil.com, youtube.com.evil.com) and arbitrary domains are strictly blocked.
 */
export const ALLOWED_DOMAINS = new Set([
  "google.com",
  "www.google.com",
  "wikipedia.org",
  "www.wikipedia.org",
  "github.com",
  "www.github.com",
  "youtube.com",
  "www.youtube.com"
]);

/**
 * Validates whether a given URL string is safe and points strictly to an allowlisted destination.
 *
 * Validation rules:
 * - Must be a valid parseable URL
 * - Must require HTTPS (rejects http:, javascript:, data:, file:, blob:)
 * - Rejects embedded user credentials (user:pass@host)
 * - Rejects localhost and private/local network IP destinations
 * - Hostname must strictly match an entry in ALLOWED_DOMAINS
 *
 * @param {string} rawUrl - Full URL string to validate
 * @returns {boolean} True if HTTPS and hostname is strictly on the allowlist
 */
export function isAllowedExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return false;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return false;
  }

  // Reject unsafe schemes early before URL parsing
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("vbscript:")
  ) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);

    // 1. Strict HTTPS requirement (rejects http:, file:, ftp:, etc.)
    if (parsed.protocol !== "https:") {
      return false;
    }

    // 2. Reject credentials in URL
    if (parsed.username || parsed.password) {
      return false;
    }

    // 3. Normalize hostname and remove trailing dot if any
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.endsWith(".")) {
      hostname = hostname.slice(0, -1);
    }

    // 4. Reject localhost, loopback, and private network IPs
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return false;
    }

    // 5. Strict Allowlist Match: exact match only
    if (!ALLOWED_DOMAINS.has(hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Safely constructs a Google search URL using the browser URL API.
 * Ensures the search query is properly URL-encoded and safe.
 *
 * @param {string} query - Raw search query text
 * @returns {string|null} Validated Google search URL, or null if invalid
 */
export function buildGoogleSearchUrl(query) {
  if (!query || typeof query !== "string") {
    return null;
  }

  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("q", trimmed);
    const urlString = url.toString();
    return isAllowedExternalUrl(urlString) ? urlString : null;
  } catch {
    return null;
  }
}

/**
 * Canonical home URLs for allowlisted sites in Phase 1C.
 */
const CANONICAL_SITE_URLS = {
  google: "https://www.google.com/",
  wikipedia: "https://www.wikipedia.org/",
  github: "https://github.com/"
};

/**
 * Handle validated Web command intents.
 *
 * @param {Object} parsedIntent - Structured intent from parser
 * @param {Object} [context={}] - Application UI context hooks
 * @returns {Promise<Object>} Execution result { handled: boolean, intent: string, blocked?: boolean, url?: string, label?: string }
 */
export async function handleWeb(parsedIntent, context = {}) {
  const intent = parsedIntent?.intent;

  try {
    let targetUrl = null;
    let label = "Google";

    switch (intent) {
      // A. Google Search
      case "web.google_search": {
        const query = parsedIntent?.query;
        if (!query) {
          return { handled: false };
        }
        targetUrl = buildGoogleSearchUrl(query);
        label = `Google Search ("${query}")`;
        break;
      }

      // B. Google Open
      case "web.open_google": {
        targetUrl = CANONICAL_SITE_URLS.google;
        label = "Google";
        break;
      }

      // C. Allowed Explicit Websites (Wikipedia, GitHub)
      case "web.open_allowed_site": {
        const siteKey = (parsedIntent?.site || "").toLowerCase();
        if (!siteKey || !CANONICAL_SITE_URLS[siteKey]) {
          return { handled: false };
        }
        targetUrl = CANONICAL_SITE_URLS[siteKey];
        label = siteKey === "wikipedia" ? "Wikipedia" : siteKey === "github" ? "GitHub" : siteKey;
        break;
      }

      default:
        return { handled: false };
    }

    // Verify safe URL validation
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
      console.warn("[SARA WebHandler] window.open failed:", openErr);
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
    console.warn("[SARA WebHandler] Error executing web command:", err);
    return { handled: false };
  }
}
