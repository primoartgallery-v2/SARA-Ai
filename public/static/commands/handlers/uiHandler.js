/**
 * SARA AI - Internal UI Action Handler (Phase 1B)
 *
 * Executes local browser actions directly by invoking application UI controllers
 * provided via the command execution context.
 */

/**
 * Handle validated UI command intents.
 *
 * @param {Object} parsedIntent - Structured intent from parser
 * @param {Object} context - Application UI context hooks
 * @returns {Promise<Object>} Execution result { handled: boolean, intent: string }
 */
export async function handleUI(parsedIntent, context = {}) {
  const intent = parsedIntent?.intent;

  switch (intent) {
    // A. New Chat
    case "ui.new_chat": {
      if (typeof context.newChat === "function") {
        await context.newChat();
        return { handled: true, intent: "ui.new_chat" };
      }
      return { handled: false };
    }

    // B. Clear Chat (preserves existing confirmation dialog)
    case "ui.clear_chat": {
      if (typeof context.clearChat === "function") {
        context.clearChat();
        return { handled: true, intent: "ui.clear_chat" };
      }
      return { handled: false };
    }

    // C. Dark Mode
    case "ui.theme_dark": {
      if (typeof context.setTheme === "function") {
        context.setTheme("dark");
        return { handled: true, intent: "ui.theme_dark" };
      }
      return { handled: false };
    }

    // D. Light Mode
    case "ui.theme_light": {
      if (typeof context.setTheme === "function") {
        context.setTheme("light");
        return { handled: true, intent: "ui.theme_light" };
      }
      return { handled: false };
    }

    // E. Web Search ON (ensures final state = ON)
    case "ui.toggle_web_on": {
      if (typeof context.setWebSearch === "function") {
        context.setWebSearch(true);
        return { handled: true, intent: "ui.toggle_web_on" };
      }
      return { handled: false };
    }

    // F. Web Search OFF (ensures final state = OFF)
    case "ui.toggle_web_off": {
      if (typeof context.setWebSearch === "function") {
        context.setWebSearch(false);
        return { handled: true, intent: "ui.toggle_web_off" };
      }
      return { handled: false };
    }

    // G. Stop Generation (safe handling whether generating or idle)
    case "ui.stop_generation": {
      if (typeof context.stopGeneration === "function") {
        context.stopGeneration();
        return { handled: true, intent: "ui.stop_generation" };
      }
      return { handled: false };
    }

    // H. Personality Mode (Phase 3C)
    case "personality.set_mode": {
      const targetMode = parsedIntent?.mode === "romantic" ? "romantic" : "normal";
      if (typeof context.setPersonalityMode === "function") {
        await context.setPersonalityMode(targetMode);
        const romanticConfirmations = [
          "Romantic mode on kar diya ❤️ Ab se thodi aur sweetness aur pyaar ke saath baat karenge!",
          "Romantic mode active ho gaya hai ❤️ Batao, aaj kya special chal raha hai?",
          "Romantic mode on ❤️ Main ab aur bhi warmth aur care ke saath sun rahi hoon!"
        ];
        const normalConfirmations = [
          "Default mode wapas set ho gaya hai 😊 Chalo, normal friendly vibe mein baat karte hain!",
          "Normal mode wapas active ho gaya hai. Main ready hoon!",
          "Romantic mode off kar diya. Back to default mode 😊"
        ];
        const list = targetMode === "romantic" ? romanticConfirmations : normalConfirmations;
        const msg = list[Math.floor(Math.random() * list.length)];
        return {
          handled: true,
          intent: "personality.set_mode",
          mode: targetMode,
          message: msg,
          speak: true
        };
      }
      return { handled: false };
    }

    default:
      return { handled: false };
  }
}
