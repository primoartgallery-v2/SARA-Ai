/**
 * SARA AI - Intent Parser (Phase 1D - YouTube, Web & UI Commands)
 *
 * Safely parses user input for:
 * - Local UI commands (Phase 1B)
 * - Google search & website navigation (Phase 1C)
 * - YouTube navigation, search & play (Phase 1D)
 * Strictly isolates conversational inquiries and normal chat.
 */

/**
 * Question & Inquiry indicators for conversational queries about systems/topics
 * rather than imperative actions.
 */
const QUESTION_INDICATORS = [
  /\b(?:kya\s+hai|kya\s+hota|kya\s+hoti|kya\s+hote|kya\s+matlab|kya\s+cheez)\b/i,
  /\b(?:kaise|kaise\s+kaam\s+karta|kaise\s+karte\s+hain|kaise\s+karein|kivabe)\b/i,
  /\b(?:kyun|kyon|keno|why)\b/i,
  /\b(?:baare\s+mein|bare\s+me|samparke)\b/i,
  /\b(?:samjhao|samjha\s+do|batao|bata\s+do|bujhiye|explain|tell\s+me\s+about|tell\s+me)\b/i,
  /\b(?:what\s+is|what\s+does|how\s+to|how\s+does|how\s+is|who\s+is|where\s+is)\b/i,
  /\b(?:can\s+you|could\s+you|kya\s+tum|tumi\s+ki)\b/i
];

/**
 * Phase 1B: Local UI command patterns.
 */
const UI_COMMAND_PATTERNS = [
  // A. New Chat
  {
    intent: "ui.new_chat",
    pattern: /^(?:(?:new|naya|nayi|notun)\s+chat(?:\s+(?:kholo|khol\s+do|start\s+karo|shuru\s+karo|karo|open|create))?|(?:open|start|create)\s+(?:a\s+)?(?:new|naya)\s+chat|nayi\s+conversation\s+kholo)$/i
  },

  // B. Clear Chat
  {
    intent: "ui.clear_chat",
    pattern: /^(?:(?:chat|conversation|messages)\s+(?:clear|saaf)(?:\s+(?:karo|kar\s+do|koro|korun))?|(?:clear|purge)\s+(?:the\s+)?(?:chat|conversation|messages)|clear\s+chat)$/i
  },

  // C. Dark Mode
  {
    intent: "ui.theme_dark",
    pattern: /^(?:dark\s+(?:mode|theme)(?:\s+(?:on|enable|laga\s+do|lagao|set|activate|chalu))?(?:\s+(?:karo|kar\s+do|koro))?|(?:turn\s+on|enable|activate|switch\s+to)\s+dark\s+(?:mode|theme))$/i
  },

  // D. Light Mode
  {
    intent: "ui.theme_light",
    pattern: /^(?:light\s+(?:mode|theme)(?:\s+(?:on|enable|laga\s+do|lagao|set|activate|chalu))?(?:\s+(?:karo|kar\s+do|koro))?|(?:turn\s+on|enable|activate|switch\s+to)\s+light\s+(?:mode|theme))$/i
  },

  // E. Web Search ON
  {
    intent: "ui.toggle_web_on",
    pattern: /^(?:web\s+(?:search\s+)?(?:on|enable|chalu|activate)(?:\s+(?:karo|kar\s+do|koro))?|(?:turn\s+on|enable|activate)\s+web\s+(?:search)?)$/i
  },

  // F. Web Search OFF
  {
    intent: "ui.toggle_web_off",
    pattern: /^(?:web\s+(?:search\s+)?(?:off|disable|band|deactivate)(?:\s+(?:karo|kar\s+do|koro))?|(?:turn\s+off|disable|deactivate)\s+web\s+(?:search)?)$/i
  },

  // G. Stop Generation
  {
    intent: "ui.stop_generation",
    pattern: /^(?:stop|ruko|ruk\s+jao|(?:generation|response|answer)\s+(?:stop|ruko)(?:\s+(?:karo|kar\s+do))?|stop\s+(?:generation|generating|response|answer))$/i
  }
];

/**
 * Phase 3C: Personality Mode Command patterns (Romantic Mode / Normal Mode)
 */
const PERSONALITY_COMMAND_PATTERNS = [
  // 1. Romantic Mode ON
  {
    intent: "personality.set_mode",
    mode: "romantic",
    pattern: /^(?:(?:turn\s+on|enable|activate|switch\s+to)\s+romantic\s+mode|romantic\s+mode(?:\s+(?:on|enable|activate|chalu|start))(?:\s+(?:karo|kar\s+do|koro|kardena))?|romantic\s+mode\s+(?:karo|kar\s+do|koro|kardena))$/i
  },

  // 2. Romantic Mode OFF / Normal Mode ON
  {
    intent: "personality.set_mode",
    mode: "normal",
    pattern: /^(?:(?:turn\s+off|disable|deactivate)\s+romantic\s+mode|romantic\s+mode\s+(?:off|disable|band|deactivate)(?:\s+(?:karo|kar\s+do|koro|kardena))?|(?:turn\s+on|enable|activate|switch\s+to)\s+(?:normal|default)\s+mode|(?:normal|default)\s+mode(?:\s+(?:on|set|chalu|enable))?(?:\s+(?:karo|kar\s+do|koro))?)$/i
  }
];

/**
 * Phase 1C: Direct site opening patterns.
 */
const GOOGLE_OPEN_PATTERN = /^(?:(?:open\s+google(?:\s+website)?)|(?:google(?:\s+website)?\s+(?:kholo|open\s+karo|khol\s+do|open|koro|khulun|खोलो)))$/i;

const ALLOWED_SITE_PATTERNS = [
  {
    site: "wikipedia",
    pattern: /^(?:(?:open\s+wikipedia(?:\s+website)?)|(?:wikipedia(?:\s+website)?\s+(?:kholo|open\s+karo|khol\s+do|open|koro|khulun|खोलो)))$/i
  },
  {
    site: "github",
    pattern: /^(?:(?:open\s+github(?:\s+website)?)|(?:github(?:\s+website)?\s+(?:kholo|open\s+karo|khol\s+do|open|koro|khulun|खोलो)))$/i
  }
];

/**
 * Phase 1C: Google Search command patterns.
 */
const GOOGLE_SEARCH_PREFIX = /^(?:search\s+google\s+(?:for|on)\s+|google\s+search\s+(?:for\s+|karo\s+|kar\s+do\s+|koro\s+)?|google\s+(?:pe|par|per|me|e|te|पर)\s+(?:search\s+(?:karo|kar\s+do|koro)|khojo|खोजो)\s+|google\s+(?:par|पर)\s+khojo\s+)(.+)$/i;
const GOOGLE_SEARCH_MIDDLE = /^google\s+(?:pe|par|per|me|e|te|पर)\s+(.+?)\s+(?:search\s+(?:karo|kar\s+do|koro)|khojo|खोजो)$/i;
const GOOGLE_SEARCH_SUFFIX = /^(.+?)\s+(?:(?:google\s+(?:pe|par|per|me|e|te|पर)\s+search\s*(?:karo|kar\s+do|koro)?)|(?:google\s+search\s*(?:karo|kar\s+do|koro)?)|(?:search\s+on\s+google)|(?:search\s+google))$/i;

/**
 * Phase 1D: YouTube command patterns.
 */
// 1. YouTube Open
const YOUTUBE_OPEN_PATTERN = /^(?:(?:open\s+youtube(?:\s+website)?)|(?:youtube(?:\s+website)?\s+(?:kholo|open\s+karo|khol\s+do|open|koro|khulun|खोलो)))$/i;

// 2. YouTube Search
const YOUTUBE_SEARCH_PREFIX = /^(?:search\s+youtube\s+(?:for|on)\s+|youtube\s+search\s+(?:for\s+|karo\s+|kar\s+do\s+|koro\s+)?|youtube\s+(?:pe|par|per|me|e|te|पर)\s+(?:search\s+(?:karo|kar\s+do|koro)|khojo|खोजो)\s+|youtube\s+(?:par|पर)\s+khojo\s+)(.+)$/i;
const YOUTUBE_SEARCH_MIDDLE = /^youtube\s+(?:pe|par|per|me|e|te|पर)\s+(.+?)\s+(?:search\s+(?:karo|kar\s+do|koro)|khojo|खोजो)$/i;
const YOUTUBE_SEARCH_SUFFIX = /^(.+?)\s+(?:(?:youtube\s+(?:pe|par|per|me|e|te|पर)\s+search\s*(?:karo|kar\s+do|koro)?)|(?:youtube\s+search\s*(?:karo|kar\s+do|koro)?)|(?:search\s+on\s+youtube)|(?:search\s+youtube))$/i;

// 3. YouTube Play
const YOUTUBE_PLAY_EN = /^play\s+(.+?)\s+(?:on|in)\s+youtube$/i;
const YOUTUBE_PLAY_MIDDLE = /^youtube\s+(?:pe|par|per|me|e|te|पर)\s+(.+?)\s+(?:chalao|chala\s+do|chalau|play\s+karo|play\s+kar\s+do|play|bajao|baja\s+do|bajan|chala|चलाओ|बजाओ)$/i;
const YOUTUBE_PLAY_PREFIX = /^youtube\s+(?:pe|par|per|me|e|te|पर)\s+(?:chalao|chala\s+do|play\s+karo|play|चलाओ|बजाओ)\s+(.+)$/i;

/**
 * Clean and normalize extracted search/play query.
 *
 * @param {string} rawQuery - Extracted raw query string
 * @returns {string|null} Cleaned search query or null if invalid
 */
function cleanSearchQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== "string") {
    return null;
  }

  let q = rawQuery.trim();

  // Strip wrapping quotes if symmetrically quoted
  if (
    (q.startsWith('"') && q.endsWith('"') && q.length >= 2) ||
    (q.startsWith("'") && q.endsWith("'") && q.length >= 2)
  ) {
    q = q.slice(1, -1).trim();
  }

  // Strip leading connectors if accidentally captured at boundary
  q = q.replace(/^(?:for|about|ke\s+baare\s+mein|ko)\s+/i, "");

  // Strip trailing connectors if accidentally captured
  q = q.replace(/\s+(?:ke\s+liye|ko)$/i, "");

  // Strip trailing periods or exclamation marks, but preserve question marks or symbol query suffixes
  q = q.replace(/[.!]+$/, "").trim();

  if (!q) {
    return null;
  }

  // Reject if query is purely command syntax words
  if (/^(?:search|karo|kar\s+do|koro|khojo|open|kholo|play|chalao)$/i.test(q)) {
    return null;
  }

  return q;
}

/**
 * Parse raw user input into a structured intent representation.
 *
 * @param {string} input - Raw text typed or transcribed from speech
 * @returns {Object} Structured command intent payload
 */
export function parseCommand(input) {
  const original = typeof input === "string" ? input : "";
  const trimmed = original.trim();

  const fallback = {
    matched: false,
    intent: null,
    platform: null,
    query: null,
    site: null,
    hasWakeWord: false,
    normalized: "",
    originalInput: original
  };

  if (!trimmed) {
    return fallback;
  }

  // 1. Strip optional leading wake words ("sara", "hey sara", "sara ji", "shuno sara")
  const wakeWordPattern = /^(?:(?:hey|shuno|listen)\s+)?sara(?:\s+ji)?(?:[,:\s]+|$)/i;
  const hasWakeWord = wakeWordPattern.test(trimmed);
  let rawWithoutWake = trimmed;
  if (hasWakeWord) {
    rawWithoutWake = trimmed.replace(wakeWordPattern, "").trim();
  }

  if (!rawWithoutWake) {
    return fallback;
  }

  // Normalize for structure checking
  const normalized = rawWithoutWake.replace(/\s+/g, " ").toLowerCase();
  const cleanedPunct = normalized.replace(/[.!]+$/, "").trim();

  // 2. CHECK PHASE 1B LOCAL UI COMMANDS
  let hasQuestionIndicator = false;
  for (const qPattern of QUESTION_INDICATORS) {
    if (qPattern.test(normalized) || qPattern.test(trimmed)) {
      hasQuestionIndicator = true;
      break;
    }
  }

  if (!hasQuestionIndicator && !trimmed.endsWith("?")) {
    for (const item of UI_COMMAND_PATTERNS) {
      if (item.pattern.test(cleanedPunct)) {
        return {
          matched: true,
          intent: item.intent,
          platform: "ui",
          query: null,
          site: null,
          hasWakeWord,
          normalized: cleanedPunct,
          originalInput: original
        };
      }
    }

    // Phase 3C: Personality Mode commands
    for (const item of PERSONALITY_COMMAND_PATTERNS) {
      if (item.pattern.test(cleanedPunct)) {
        return {
          matched: true,
          intent: item.intent,
          mode: item.mode,
          platform: "personality",
          query: null,
          site: null,
          hasWakeWord,
          normalized: cleanedPunct,
          originalInput: original
        };
      }
    }
  }

  // 3. CHECK PHASE 1C: DIRECT GOOGLE OPEN
  if (!hasQuestionIndicator && !trimmed.endsWith("?")) {
    if (GOOGLE_OPEN_PATTERN.test(cleanedPunct)) {
      return {
        matched: true,
        intent: "web.open_google",
        platform: "web",
        query: null,
        site: "google",
        hasWakeWord,
        normalized: cleanedPunct,
        originalInput: original
      };
    }
  }

  // 4. CHECK PHASE 1C: ALLOWED SITES OPEN (Wikipedia, GitHub)
  if (!hasQuestionIndicator && !trimmed.endsWith("?")) {
    for (const allowed of ALLOWED_SITE_PATTERNS) {
      if (allowed.pattern.test(cleanedPunct)) {
        return {
          matched: true,
          intent: "web.open_allowed_site",
          platform: "web",
          query: null,
          site: allowed.site,
          hasWakeWord,
          normalized: cleanedPunct,
          originalInput: original
        };
      }
    }
  }

  // 5. CHECK PHASE 1D: YOUTUBE OPEN
  if (!hasQuestionIndicator && !trimmed.endsWith("?")) {
    if (YOUTUBE_OPEN_PATTERN.test(cleanedPunct)) {
      return {
        matched: true,
        intent: "youtube.open",
        platform: "youtube",
        query: null,
        site: "youtube",
        hasWakeWord,
        normalized: cleanedPunct,
        originalInput: original
      };
    }
  }

  // 6. CHECK PHASE 1C: GOOGLE SEARCH COMMANDS
  const isQuestionAboutGoogle =
    /^(?:what\s+is\s+google|how\s+does\s+google|google\s+kya\s+hai|google\s+kaise|google\s+ke\s+baare\s+mein|google\s+pe\s+search\s+kaise)\b/i.test(normalized);

  const isAbilityQuestion =
    /^(?:kya\s+tum|can\s+you|could\s+you|tell\s+me\s+about|mujhe\s+.*batao)\b/i.test(normalized);

  if (!isQuestionAboutGoogle && !isAbilityQuestion) {
    let match = rawWithoutWake.match(GOOGLE_SEARCH_PREFIX);
    if (match && match[1]) {
      const extractedQuery = cleanSearchQuery(match[1]);
      if (extractedQuery) {
        return {
          matched: true,
          intent: "web.google_search",
          platform: "web",
          query: extractedQuery,
          site: "google",
          hasWakeWord,
          normalized,
          originalInput: original
        };
      }
    }

    match = rawWithoutWake.match(GOOGLE_SEARCH_MIDDLE);
    if (match && match[1]) {
      const extractedQuery = cleanSearchQuery(match[1]);
      if (extractedQuery) {
        return {
          matched: true,
          intent: "web.google_search",
          platform: "web",
          query: extractedQuery,
          site: "google",
          hasWakeWord,
          normalized,
          originalInput: original
        };
      }
    }

    match = rawWithoutWake.match(GOOGLE_SEARCH_SUFFIX);
    if (match && match[1]) {
      const extractedQuery = cleanSearchQuery(match[1]);
      if (extractedQuery) {
        return {
          matched: true,
          intent: "web.google_search",
          platform: "web",
          query: extractedQuery,
          site: "google",
          hasWakeWord,
          normalized,
          originalInput: original
        };
      }
    }
  }

  // 7. CHECK PHASE 1D: YOUTUBE SEARCH & PLAY COMMANDS
  // Distinguish questions about YouTube / how to play from actual imperative commands
  const isQuestionAboutYouTube =
    /^(?:what\s+is\s+youtube|how\s+does\s+youtube|youtube\s+kya\s+hai|youtube\s+kaise|youtube\s+ke\s+baare\s+mein|youtube\s+pe\s+search\s+kaise|youtube\s+par\s+search\s+kaise|can\s+you\s+explain\s+youtube)\b/i.test(normalized) ||
    /\b(?:kaise\s+chalate\s+hain|kaise\s+chalaun|kaise\s+chalae|kaise\s+karein|kaise\s+karte\s+hain)\b/i.test(normalized);

  if (!isQuestionAboutYouTube && !isAbilityQuestion) {
    // 7A. YouTube Play: English ("play <query> on/in youtube")
    let match = rawWithoutWake.match(YOUTUBE_PLAY_EN);
    if (match && match[1]) {
      const extractedQuery = cleanSearchQuery(match[1]);
      if (extractedQuery) {
        return {
          matched: true,
          intent: "youtube.play",
          platform: "youtube",
          query: extractedQuery,
          site: "youtube",
          hasWakeWord,
          normalized,
          originalInput: original
        };
      }
    }

    // 7B. YouTube Play: Middle ("youtube pe/par <query> chalao / play karo")
    match = rawWithoutWake.match(YOUTUBE_PLAY_MIDDLE);
    if (match && match[1]) {
      const extractedQuery = cleanSearchQuery(match[1]);
      if (extractedQuery) {
        return {
          matched: true,
          intent: "youtube.play",
          platform: "youtube",
          query: extractedQuery,
          site: "youtube",
          hasWakeWord,
          normalized,
          originalInput: original
        };
      }
    }

    // 7C. YouTube Play: Prefix ("youtube pe chalao <query>")
    match = rawWithoutWake.match(YOUTUBE_PLAY_PREFIX);
    if (match && match[1]) {
      const extractedQuery = cleanSearchQuery(match[1]);
      if (extractedQuery) {
        return {
          matched: true,
          intent: "youtube.play",
          platform: "youtube",
          query: extractedQuery,
          site: "youtube",
          hasWakeWord,
          normalized,
          originalInput: original
        };
      }
    }

    // 7D. YouTube Search: Prefix ("search youtube for <query>", "youtube pe search karo <query>")
    match = rawWithoutWake.match(YOUTUBE_SEARCH_PREFIX);
    if (match && match[1]) {
      const extractedQuery = cleanSearchQuery(match[1]);
      if (extractedQuery) {
        return {
          matched: true,
          intent: "youtube.search",
          platform: "youtube",
          query: extractedQuery,
          site: "youtube",
          hasWakeWord,
          normalized,
          originalInput: original
        };
      }
    }

    // 7E. YouTube Search: Middle ("youtube pe <query> search karo")
    match = rawWithoutWake.match(YOUTUBE_SEARCH_MIDDLE);
    if (match && match[1]) {
      const extractedQuery = cleanSearchQuery(match[1]);
      if (extractedQuery) {
        return {
          matched: true,
          intent: "youtube.search",
          platform: "youtube",
          query: extractedQuery,
          site: "youtube",
          hasWakeWord,
          normalized,
          originalInput: original
        };
      }
    }

    // 7F. YouTube Search: Suffix ("<query> youtube pe search karo")
    match = rawWithoutWake.match(YOUTUBE_SEARCH_SUFFIX);
    if (match && match[1]) {
      const extractedQuery = cleanSearchQuery(match[1]);
      if (extractedQuery) {
        return {
          matched: true,
          intent: "youtube.search",
          platform: "youtube",
          query: extractedQuery,
          site: "youtube",
          hasWakeWord,
          normalized,
          originalInput: original
        };
      }
    }
  }

  // No match -> Fallback to normal chat
  return fallback;
}
