let token = localStorage.getItem("token") || "";
let curSession = null;
let msgs = [];
let allSessions = [];
let modelMode = localStorage.getItem("sara_model_mode") || "smart"; // 'smart' | 'thinking' | 'fast'
let personalityMode = localStorage.getItem("sara_personality_mode") || "normal"; // 'normal' | 'romantic'

function setPersonalityMode(mode) {
  personalityMode = mode === "romantic" ? "romantic" : "normal";
  try {
    localStorage.setItem("sara_personality_mode", personalityMode);
  } catch {}
  document.querySelectorAll("#personality-opts .opt").forEach((o) => {
    const isMatch = o.dataset.mode === personalityMode;
    o.classList.toggle("active", isMatch);
    o.setAttribute("aria-pressed", isMatch ? "true" : "false");
  });
  if (token) {
    api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ personality_mode: personalityMode })
    }).catch(() => {});
  }
  return personalityMode;
}
let webSearchActive = false;
let ac = null;
let gen = false;
let attachedFiles = [];
let attachedFile = null;
let recognition = null;
let isRecording = false;

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {}),
    ...(options.headers || {})
  };
  try {
    const r = await fetch(path, { ...options, headers });
    if (r.status === 401) {
      showAuth();
      throw new Error("Authentication failed");
    }
    return r;
  } catch (err) {
    if (!navigator.onLine || /failed to fetch|networkerror|network error/i.test(err.message || "")) {
      throw new Error("I'm offline right now, so I can't complete that request. Please reconnect to the internet and try again.");
    }
    throw err;
  }
}

function showAuth() {
  document.getElementById("auth").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
  token = "";
  localStorage.removeItem("token");
}

function showApp() {
  document.getElementById("auth").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  loadSessions();
  loadSettings();
}

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t;
  return d.innerHTML;
}

function setupCodeCopyButtons() {
  document.querySelectorAll(".msg-c pre").forEach((pre) => {
    if (pre.parentElement && pre.parentElement.classList.contains("code-wrapper")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "code-wrapper";
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const btn = document.createElement("button");
    btn.className = "copy-code-btn";
    btn.textContent = "Copy";
    btn.onclick = () => {
      const code = pre.querySelector("code");
      const text = code ? code.innerText : pre.innerText;
      copyText(text, btn);
    };
    wrapper.appendChild(btn);
  });
}

function hardenLinks(html) {
  if (!html || typeof html !== "string") return "";
  if (typeof DOMParser === "undefined") {
    return html;
  }
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const anchors = doc.body.querySelectorAll("a");
    for (const a of anchors) {
      const href = (a.getAttribute("href") || "").trim();
      const lower = href.toLowerCase();
      if (lower.startsWith("https://") || lower.startsWith("http://")) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      } else if (lower.startsWith("/") || lower.startsWith("#")) {
        // Safe relative / internal anchor
        a.removeAttribute("target");
        a.removeAttribute("rel");
      } else {
        // Neutralize dangerous or unapproved schemes (javascript:, data:, file:, blob:, vbscript:, etc.)
        a.removeAttribute("href");
        a.removeAttribute("target");
        a.removeAttribute("rel");
      }
    }
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

if (typeof marked !== "undefined" && typeof marked.setOptions === "function") {
  try {
    marked.setOptions({ breaks: true, gfm: true });
  } catch {}
}

function md(t, isStreaming = false) {
  if (!t) return "";

  // Fail-closed rule: rich Markdown is strictly permitted ONLY if both marked and DOMPurify are available
  if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
    return esc(t).replace(/\n/g, "<br>");
  }

  try {
    const rawHtml = marked.parse(t);
    if (!rawHtml || typeof rawHtml !== "string") {
      return esc(t).replace(/\n/g, "<br>");
    }

    let sanitized = DOMPurify.sanitize(rawHtml);
    if (typeof sanitized !== "string") {
      return esc(t).replace(/\n/g, "<br>");
    }

    sanitized = hardenLinks(sanitized);

    // During active SSE streaming, defer expensive syntax highlighting and button attachment
    if (!isStreaming) {
      setTimeout(() => {
        try {
          if (typeof hljs !== "undefined" && typeof hljs.highlightElement === "function") {
            document.querySelectorAll("pre code").forEach((b) => {
              try {
                hljs.highlightElement(b);
              } catch {}
            });
          }
          setupCodeCopyButtons();
        } catch {}
      }, 0);
    }

    return sanitized;
  } catch (err) {
    // Fail-closed fallback: never send raw or partially parsed HTML to innerHTML
    console.warn("[SARA] Markdown rendering error, falling back to safe text:", err);
    return esc(t).replace(/\n/g, "<br>");
  }
}

function renderMessageContent(rawText, isStreaming = false) {
  if (!rawText) return "";
  const thinkStart = rawText.indexOf("<think>");
  if (thinkStart !== -1) {
    const thinkEnd = rawText.indexOf("</think>");
    if (thinkEnd !== -1) {
      const thought = rawText.substring(thinkStart + 7, thinkEnd).trim();
      const rest = rawText.substring(thinkEnd + 8).trim();
      return (
        '<details class="think-box">' +
        '<summary class="think-summary"><span>🧠 Deep Thinking Process</span><span class="think-badge">DeepSeek R1</span></summary>' +
        '<div class="think-content">' + md(thought, isStreaming) + '</div>' +
        '</details>' +
        (rest ? md(rest, isStreaming) : "")
      );
    } else {
      const thought = rawText.substring(thinkStart + 7).trim();
      return (
        '<details class="think-box" open>' +
        '<summary class="think-summary live"><span>🧠 Thinking in progress...</span><div class="think-dots"><span></span><span></span><span></span></div><span class="think-badge">DeepSeek R1</span></summary>' +
        '<div class="think-content">' + (thought ? esc(thought) : "Analyzing and reasoning step-by-step...") + '</div>' +
        '</details>'
      );
    }
  }
  return md(rawText, isStreaming);
}

function copyText(text, btn) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      if (btn) {
        const old = btn.textContent;
        btn.textContent = "Copied! ✓";
        setTimeout(() => (btn.textContent = old), 1500);
      }
    });
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    if (btn) {
      const old = btn.textContent;
      btn.textContent = "Copied! ✓";
      setTimeout(() => (btn.textContent = old), 1500);
    }
  }
}

// Text-to-Speech
let speakingBtn = null;
function speakText(text, btn) {
  if (!("speechSynthesis" in window)) {
    alert("Speech Synthesis is not supported in this browser.");
    return;
  }
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    if (speakingBtn) {
      speakingBtn.textContent = "🔊 Listen";
      speakingBtn.classList.remove("speaking");
    }
    if (speakingBtn === btn) {
      speakingBtn = null;
      return;
    }
  }

  const clean = text.replace(/[*#`_\[\]()]/g, " ").trim();
  const utt = new SpeechSynthesisUtterance(clean);
  utt.rate = 1.0;

  btn.textContent = "⏹ Stop";
  btn.classList.add("speaking");
  speakingBtn = btn;

  utt.onend = () => {
    btn.textContent = "🔊 Listen";
    btn.classList.remove("speaking");
    speakingBtn = null;
  };
  utt.onerror = () => {
    btn.textContent = "🔊 Listen";
    btn.classList.remove("speaking");
    speakingBtn = null;
  };
  window.speechSynthesis.speak(utt);
}

// Auth Tabs
document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".form").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    const target = document.getElementById(t.dataset.t + "-f");
    if (target) target.classList.add("active");
    const errBox = document.getElementById("auth-err");
    if (errBox) errBox.textContent = "";
  };
});

// Login
document.getElementById("login-f").onsubmit = async (e) => {
  e.preventDefault();
  const errBox = document.getElementById("auth-err");
  errBox.textContent = "";
  const email = document.getElementById("l-email").value.trim();
  const password = document.getElementById("l-pass").value;
  try {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if (!r.ok || d.error) {
      errBox.textContent = d.error || "Login failed";
      return;
    }
    token = d.token;
    localStorage.setItem("token", token);
    showApp();
  } catch (err) {
    errBox.textContent = !navigator.onLine
      ? "You're offline. Please reconnect to the internet to log in."
      : "Login failed. Please check network connection.";
  }
};

// Signup
document.getElementById("signup-f").onsubmit = async (e) => {
  e.preventDefault();
  const errBox = document.getElementById("auth-err");
  errBox.textContent = "";
  const name = document.getElementById("s-name").value.trim();
  const email = document.getElementById("s-email").value.trim();
  const password = document.getElementById("s-pass").value;
  try {
    const r = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name })
    });
    const d = await r.json();
    if (!r.ok || d.error) {
      errBox.textContent = d.error || "Signup failed";
      return;
    }
    token = d.token;
    localStorage.setItem("token", token);
    showApp();
  } catch (err) {
    errBox.textContent = !navigator.onLine
      ? "You're offline. Please reconnect to the internet to sign up."
      : "Signup failed. Please try again.";
  }
};

// Logout
document.getElementById("logout").onclick = async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}
  showAuth();
};

// Sessions List
async function loadSessions() {
  try {
    const r = await api("/api/sessions");
    const d = await r.json();
    if (d.sessions) {
      allSessions = d.sessions;
      renderList(allSessions);
      if (!curSession && allSessions.length > 0) {
        switchS(allSessions[0].id, allSessions[0].title);
      } else if (!curSession && allSessions.length === 0) {
        renderMsgs();
      }
    }
  } catch (e) {}
}

function renderList(sessions) {
  const l = document.getElementById("chat-list");
  l.innerHTML = "";
  sessions.forEach((x) => {
    const i = document.createElement("div");
    i.className = "chat-item" + (x.id === curSession ? " active" : "") + (x.pinned ? " pinned" : "");
    i.innerHTML =
      "<span>" +
      (x.pinned ? "📌 " : "") +
      esc(x.title) +
      "</span>" +
      '<div class="chat-btns">' +
      '<button class="btn-pin" title="' +
      (x.pinned ? "Unpin chat" : "Pin chat") +
      '">' +
      (x.pinned ? "📍" : "📌") +
      "</button>" +
      '<button class="btn-del" title="Delete chat">✕</button>' +
      "</div>";

    i.onclick = () => switchS(x.id, x.title);

    const pinBtn = i.querySelector(".btn-pin");
    pinBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await api("/api/sessions/" + x.id, {
          method: "PUT",
          body: JSON.stringify({ pinned: !x.pinned })
        });
        await loadSessions();
      } catch {}
    };

    const delBtn = i.querySelector(".btn-del");
    delBtn.onclick = (e) => {
      e.stopPropagation();
      delS(x.id);
    };

    l.appendChild(i);
  });
}

// Search Chats Filter
const searchInput = document.getElementById("chat-search");
if (searchInput) {
  searchInput.oninput = () => {
    const q = searchInput.value.toLowerCase().trim();
    if (!q) {
      renderList(allSessions);
    } else {
      const filtered = allSessions.filter((s) => s.title.toLowerCase().includes(q));
      renderList(filtered);
    }
  };
}

async function newChat() {
  try {
    const r = await api("/api/sessions", { method: "POST", body: JSON.stringify({}) });
    const d = await r.json();
    curSession = d.id;
    msgs = [];
    document.getElementById("chat-title").textContent = d.title || "New Chat";
    renderMsgs();
    await loadSessions();
  } catch (e) {}
  const sb = document.getElementById("sidebar");
  if (sb) sb.classList.remove("open");
}

async function switchS(id, title) {
  curSession = id;
  document.getElementById("chat-title").textContent = title || "Chat";
  document.querySelectorAll(".chat-item").forEach((it) => it.classList.remove("active"));
  document.querySelectorAll(".chat-item").forEach((it) => {
    if (it.textContent.includes(title)) it.classList.add("active");
  });
  try {
    const r = await api("/api/sessions/" + id + "/messages");
    const d = await r.json();
    msgs = d.messages || [];
    renderMsgs();
  } catch (e) {}
  document.getElementById("sidebar").classList.remove("open");
}

async function delS(id) {
  if (!confirm("Are you sure you want to delete this chat?")) return;
  try {
    await api("/api/sessions/" + id, { method: "DELETE" });
    if (id === curSession) {
      curSession = null;
      msgs = [];
      document.getElementById("chat-title").textContent = "New Chat";
      renderMsgs();
    }
    await loadSessions();
  } catch (e) {}
}

// Clear Messages in Current Chat
const clearBtn = document.getElementById("clear-btn");
if (clearBtn) {
  clearBtn.onclick = async () => {
    if (!curSession) return;
    if (!confirm("Clear all messages in this conversation?")) return;
    try {
      await api("/api/sessions/" + curSession + "/clear", { method: "POST" });
      msgs = [];
      renderMsgs();
    } catch (e) {
      alert("Failed to clear chat");
    }
  };
}

document.getElementById("new-chat").onclick = newChat;

window.quickPrompt = (txt) => {
  const inp = document.getElementById("input");
  inp.value = txt;
  send();
};

function welcome() {
  return '<div class="welcome"><div style="font-size:64px">🤖</div><h2>Welcome to SARA AI</h2><p>Ask me anything, upload documents, or generate AI art!</p><div class="qp"><button onclick="quickPrompt(\'Explain quantum computing\')">Explain quantum computing</button><button onclick="quickPrompt(\'Write a poem about the ocean\')">Write a poem</button><button onclick="quickPrompt(\'Help me write a professional email\')">Help me write an email</button><button onclick="quickPrompt(\'/image a cute futuristic robot in cyberpunk city\')">🎨 Generate Robot Image</button></div></div>';
}

function renderMsgs() {
  const c = document.getElementById("msgs");
  c.innerHTML = "";
  if (!msgs || msgs.length === 0) {
    c.innerHTML = welcome();
    return;
  }
  msgs.forEach((m) => {
    c.appendChild(mkMsg(m.role, m.content, m.image_url, null, m.attachment, m.attachments));
  });
  c.scrollTop = c.scrollHeight;
}

function mkMsg(role, content, img, webQuery, attachment, attachments) {
  const d = document.createElement("div");
  d.className = "msg " + role;
  let h = "";
  if (role === "assistant") {
    h += '<div class="msg-av">🤖</div>';
  }
  h += '<div class="msg-c">';
  if (role === "assistant" && webQuery) {
    h += '<div class="web-search-pill">🌐 Searched web for: <strong>"' + esc(webQuery) + '"</strong></div>';
  }
  if (img) {
    h += '<div style="margin: 8px 0;"><img src="' + esc(img) + '" style="max-width: 100%; max-height: 480px; border-radius: 12px; display: block; box-shadow: 0 4px 14px rgba(0,0,0,0.3);"><a href="' + esc(img) + '" download="sara_ai_image.png" style="display:inline-block;margin-top:6px;font-size:12px;text-decoration:none;">⬇ Download Image</a></div>';
  }
  const allAttachments = Array.isArray(attachments) && attachments.length > 0
    ? attachments
    : (Array.isArray(attachment) && attachment.length > 0
      ? attachment
      : (attachment && attachment.filename ? [attachment] : []));

  if (content || allAttachments.length > 0) {
    if (role === "assistant") {
      h += renderMessageContent(content, false);
    } else {
      let userDisplay = content || "";
      if (allAttachments.length > 0) {
        const attachHeaders = allAttachments.map((a) => `📎 **[${a.filename}]**`).join("\n");
        userDisplay = `${attachHeaders}\n\n${userDisplay}`;
      } else if (userDisplay.startsWith("[Attached Document: ")) {
        // Legacy row compatibility (requirement 23): parse filename and user request cleanly without dumping raw extracted text
        const legacyMatch = userDisplay.match(/\[Attached Document:\s*([^\]]+)\][\s\S]*?User Request:\s*([\s\S]*?)(?=\n\nAssistant Instructions:|$)/i);
        if (legacyMatch) {
          const legacyFilename = legacyMatch[1].trim();
          const legacyReq = legacyMatch[2].trim() || "Please summarize and extract the details from this document.";
          userDisplay = `📎 **[${legacyFilename}]**\n\n${legacyReq}`;
        }
      }
      h += md(userDisplay);
    }
  }

  if (role === "assistant") {
    h += '<div class="msg-actions">';
    h += '<button class="msg-act-btn btn-copy-msg" title="Copy entire response">📋 Copy All Text</button>';
    h += '<button class="msg-act-btn btn-speak-msg" title="Listen to response">🔊 Listen</button>';
    h += '</div>';
  }

  h += "</div>";
  d.innerHTML = h;

  if (role === "assistant") {
    const cleanContent = (content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim() || content;
    const copyBtn = d.querySelector(".btn-copy-msg");
    if (copyBtn) {
      copyBtn.onclick = () => copyText(cleanContent || "", copyBtn);
    }
    const speakBtn = d.querySelector(".btn-speak-msg");
    if (speakBtn) {
      speakBtn.onclick = () => speakText(cleanContent || "", speakBtn);
    }
  }

  return d;
}

// File Attachment Handling
const fileInput = document.getElementById("file-input");
const attachBtn = document.getElementById("attach-btn");
const filePreview = document.getElementById("file-preview");

async function extractSingleFile(file) {
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const arrayBuffer = await file.arrayBuffer();
    if (typeof pdfjsLib === "undefined") {
      throw new Error("PDF reader is initializing, please try again in a few seconds.");
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    const maxPages = Math.min(pdf.numPages, 15);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(" ");
      fullText += `[Page ${i}]\n${pageText}\n\n`;
    }
    let cleanText = fullText.trim();
    let isTruncated = (pdf.numPages > 15) || (cleanText.length > 8000);
    if (cleanText.length > 8000) {
      cleanText = cleanText.slice(0, 8000) + "\n\n...[Document text truncated to fit model context limit]...";
    }
    return {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified || 0,
      file_type: "application/pdf",
      page_count: maxPages,
      truncated: isTruncated,
      content: cleanText || "PDF document attached (no extractable text)."
    };
  } else {
    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (evt) => resolve(evt.target.result || "");
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
    let isTruncated = text.length > 8000;
    let cleanText = text;
    if (cleanText.length > 8000) {
      cleanText = cleanText.slice(0, 8000) + "\n\n...[Document truncated to fit model context limit]...";
    }
    return {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified || 0,
      file_type: file.type || "text/plain",
      page_count: 1,
      truncated: isTruncated,
      content: cleanText
    };
  }
}

if (attachBtn && fileInput) {
  attachBtn.onclick = () => fileInput.click();
  fileInput.onchange = async (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    for (const file of selectedFiles) {
      if (attachedFiles.length >= 3) {
        alert("You can attach at most 3 documents per message.");
        break;
      }

      const isDuplicate = attachedFiles.some(
        (existing) =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === (file.lastModified || 0)
      );
      if (isDuplicate) {
        console.warn(`[SARA] Duplicate attachment skipped: ${file.name}`);
        continue;
      }

      try {
        const extracted = await extractSingleFile(file);
        if (attachedFiles.length < 3) {
          attachedFiles.push(extracted);
        } else {
          alert("You can attach at most 3 documents per message.");
          break;
        }
      } catch (err) {
        alert(`Failed to parse ${file.name}: ${err.message}`);
      }
    }

    attachedFile = attachedFiles[0] || null;
    fileInput.value = "";
    renderFilePreview();
  };
}

function renderFilePreview() {
  if (!attachedFiles || attachedFiles.length === 0) {
    filePreview.classList.add("hidden");
    filePreview.innerHTML = "";
    return;
  }
  filePreview.classList.remove("hidden");
  filePreview.innerHTML = attachedFiles.map((f, idx) => `
    <div class="file-chip">
      <span title="${esc(f.name)}">📄 ${esc(f.name)} (${Math.round((f.size || 0) / 1024)} KB)</span>
      <button type="button" onclick="removeAttachedFile(${idx})" aria-label="Remove ${esc(f.name)}" title="Remove ${esc(f.name)}">✕</button>
    </div>
  `).join("");
}

window.removeAttachedFile = (idx) => {
  if (typeof idx === "number" && idx >= 0 && idx < attachedFiles.length) {
    attachedFiles.splice(idx, 1);
  } else {
    attachedFiles = [];
  }
  attachedFile = attachedFiles[0] || null;
  renderFilePreview();
};

// Voice Input (Speech Recognition)
let lastVoiceTranscript = "";
let lastVoiceTimestamp = 0;
const micBtn = document.getElementById("mic-btn");
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRec && micBtn) {
  recognition = new SpeechRec();
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add("recording");
    micBtn.title = "Listening... Click to stop";
  };

  recognition.onresult = async (evt) => {
    let isFinal = false;
    let finalTranscript = "";
    let interimTranscript = "";

    for (let i = evt.resultIndex; i < evt.results.length; ++i) {
      if (evt.results[i].isFinal) {
        isFinal = true;
        finalTranscript += evt.results[i][0].transcript;
      } else {
        interimTranscript += evt.results[i][0].transcript;
      }
    }

    const inp = document.getElementById("input");

    // Interim results: visual feedback only, NEVER execute or dispatch
    if (!isFinal) {
      if (inp && interimTranscript) {
        inp.value = interimTranscript;
        inp.style.height = "auto";
        inp.style.height = Math.min(inp.scrollHeight, 200) + "px";
      }
      return;
    }

    // Final result received:
    const text = finalTranscript.trim();
    if (!text) return;

    // Duplicate execution protection (guard against rapid duplicate speech events)
    const now = Date.now();
    const normalized = text.toLowerCase().replace(/\s+/g, " ");
    if (normalized === lastVoiceTranscript && (now - lastVoiceTimestamp < 2000)) {
      return;
    }
    lastVoiceTranscript = normalized;
    lastVoiceTimestamp = now;

    // Place final recognized text into input
    if (inp) {
      inp.value = text;
      inp.style.height = "auto";
      inp.style.height = Math.min(inp.scrollHeight, 200) + "px";
    }

    // Safely stop recognition if still recording
    if (isRecording) {
      try {
        recognition.stop();
      } catch {}
    }

    // Auto-dispatch through existing Command Engine & Send flow
    try {
      await send();
    } catch (sendErr) {
      console.warn("[SARA] Error during voice auto-dispatch:", sendErr);
    }
  };

  recognition.onerror = () => {
    isRecording = false;
    micBtn.classList.remove("recording");
  };

  recognition.onend = () => {
    isRecording = false;
    micBtn.classList.remove("recording");
    micBtn.title = "Voice Input (Speech-to-Text)";
  };

  micBtn.onclick = () => {
    if (isRecording) {
      recognition.stop();
    } else {
      const langSel = document.getElementById("lang-sel");
      const chosenLang = langSel ? langSel.value : "auto";
      if (chosenLang === "hindi") recognition.lang = "hi-IN";
      else if (chosenLang === "bengali") recognition.lang = "bn-BD";
      else recognition.lang = "hi-IN"; // Default Hinglish/Hindi recognition
      recognition.start();
    }
  };
} else if (micBtn) {
  micBtn.style.display = "none";
}

// Image Generation Button
const imgGenBtn = document.getElementById("img-gen-btn");
if (imgGenBtn) {
  imgGenBtn.onclick = () => {
    const prompt = window.prompt("Enter image description (e.g. 'A futuristic robot in neon city'):");
    if (prompt && prompt.trim()) {
      generateImage(prompt.trim());
    }
  };
}

async function generateImage(prompt) {
  if (gen) return;
  if (!curSession) await newChat();

  const c = document.getElementById("msgs");
  const w = c.querySelector(".welcome");
  if (w) w.remove();

  msgs.push({ role: "user", content: `🎨 /image ${prompt}` });
  c.appendChild(mkMsg("user", `🎨 /image ${prompt}`));

  const ai = document.createElement("div");
  ai.className = "msg assistant";
  ai.innerHTML = '<div class="msg-av">🤖</div><div class="msg-c"><p><em>Generating image... 🎨</em></p><div class="typing"><span></span><span></span><span></span></div></div>';
  c.appendChild(ai);
  c.scrollTop = c.scrollHeight;

  gen = true;
  document.getElementById("send").classList.add("hidden");
  document.getElementById("stop").classList.add("hidden");

  if (!navigator.onLine) {
    ai.querySelector(".msg-c").innerHTML = "<p style='color:var(--dr)'>I'm offline right now, so I can't complete that request. Please reconnect to the internet and try again.</p>";
    gen = false;
    document.getElementById("send").classList.remove("hidden");
    return;
  }

  try {
    const r = await api("/api/image", {
      method: "POST",
      body: JSON.stringify({ session_id: curSession, prompt })
    });
    const data = await r.json();
    if (data.assistant_message) {
      msgs.push(data.assistant_message);
      ai.replaceWith(mkMsg("assistant", data.assistant_message.content, data.assistant_message.image_url));
      c.scrollTop = c.scrollHeight;
    } else {
      ai.querySelector(".msg-c").innerHTML = "<p style='color:var(--dr)'>Error generating image.</p>";
    }
    await loadSessions();
  } catch (err) {
    const isOfflineErr = !navigator.onLine || /offline/i.test(err.message || "");
    const msgText = isOfflineErr
      ? "I'm offline right now, so I can't complete that request. Please reconnect to the internet and try again."
      : "Error: " + esc(err.message);
    ai.querySelector(".msg-c").innerHTML = "<p style='color:var(--dr)'>" + (isOfflineErr ? msgText : esc(msgText)) + "</p>";
  }

  gen = false;
  document.getElementById("send").classList.remove("hidden");
}

function extractImagePrompt(text) {
  const t = text.trim();
  if (t.toLowerCase().startsWith("/image ")) {
    return t.slice(7).trim();
  }
  const patterns = [
    /^(?:please\s+)?(?:generate|create|make|draw)\s+(?:an?\s+)?image\s+(?:of\s+)?(.+)/i,
    /^(?:please\s+)?(?:generate|create|make|draw)\s+(?:a\s+)?picture\s+(?:of\s+)?(.+)/i,
    /^(?:please\s+)?(?:generate|create|make|draw)\s+(?:a\s+)?photo\s+(?:of\s+)?(.+)/i,
    /^(?:image|picture|photo)\s+(?:of\s+)?(.+)/i,
    /^(?:generate\s+a\s+)?(.+?)\s+image$/i,
    /^(?:generate\s+a\s+)?(.+?)\s+photo$/i,
    /^(.+?)\s+(?:ki\s+)?(?:image|photo|picture)\s+(?:banao|banado|generate\s+karo)/i
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m && m[1] && m[1].trim().length > 1) {
      return m[1].trim();
    }
  }
  return null;
}

function showPopupBlockedNotice(url, label) {
  const c = document.getElementById("msgs");
  if (!c) return;
  const w = c.querySelector(".welcome");
  if (w) w.remove();

  const msgDiv = document.createElement("div");
  msgDiv.className = "msg assistant popup-blocked-notice";

  const av = document.createElement("div");
  av.className = "msg-av";
  av.textContent = "🌐";

  const mc = document.createElement("div");
  mc.className = "msg-c";
  mc.style.background = "var(--bg3)";
  mc.style.border = "1px solid var(--bd)";
  mc.style.borderRadius = "12px";
  mc.style.padding = "10px 16px";

  const p = document.createElement("p");
  p.style.margin = "0";

  const span = document.createElement("span");
  span.textContent = "Opening was blocked. ";

  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener,noreferrer";
  a.style.color = "var(--p)";
  a.style.textDecoration = "underline";
  a.style.fontWeight = "600";
  a.textContent = "Tap here to open " + (label || "link");

  p.appendChild(span);
  p.appendChild(a);
  mc.appendChild(p);
  msgDiv.appendChild(av);
  msgDiv.appendChild(mc);

  c.appendChild(msgDiv);
  c.scrollTop = c.scrollHeight;
}

async function send() {
  const inp = document.getElementById("input");
  let msg = inp.value.trim();
  const hasAttachments = attachedFiles && attachedFiles.length > 0;
  if (!msg && !hasAttachments) return;

  // Phase 1B: Modular Command Engine hook (local UI commands + safe fallback to normal chat)
  if (!hasAttachments) {
    try {
      if (window.commandEngine && typeof window.commandEngine.handle === "function") {
        const cmdContext = {
          newChat: typeof newChat === "function" ? newChat : null,
          clearChat: () => {
            const btn = document.getElementById("clear-btn");
            if (btn) btn.click();
          },
          setTheme: (theme) => {
            const t = theme === "light" ? "light" : "dark";
            document.documentElement.setAttribute("data-theme", t);
            document.querySelectorAll("#theme-opts .opt").forEach((x) => x.classList.toggle("active", x.dataset.theme === t));
            if (token) {
              api("/api/settings", { method: "PUT", body: JSON.stringify({ theme: t }) }).catch(() => {});
            }
          },
          setPersonalityMode: async (mode) => {
            return setPersonalityMode(mode);
          },
          setWebSearch: (enable) => {
            webSearchActive = Boolean(enable);
            const webBtn = document.getElementById("web-btn");
            if (webBtn) {
              webBtn.classList.toggle("active", webSearchActive);
              webBtn.title = webSearchActive ? "Web Search ON (Click to disable)" : "Live Web Search (Search Internet)";
            }
          },
          stopGeneration: () => {
            if (ac) ac.abort();
            const stopBtn = document.getElementById("stop");
            if (stopBtn && !stopBtn.classList.contains("hidden")) {
              stopBtn.click();
            }
          }
        };

        const cmdResult = await window.commandEngine.handle(msg, cmdContext);
        if (cmdResult && cmdResult.handled) {
          inp.value = "";
          inp.style.height = "auto";
          if (cmdResult.blocked && cmdResult.url) {
            showPopupBlockedNotice(cmdResult.url, cmdResult.label);
          }
          if (cmdResult.message) {
            const c = document.getElementById("msgs");
            const w = c.querySelector(".welcome");
            if (w) w.remove();
            msgs.push({ role: "assistant", content: cmdResult.message });
            const msgEl = mkMsg("assistant", cmdResult.message);
            c.appendChild(msgEl);
            c.scrollTop = c.scrollHeight;
            if (cmdResult.speak) {
              const speakBtn = msgEl.querySelector(".btn-speak-msg");
              if (speakBtn && typeof speakText === "function") {
                speakText(cmdResult.message, speakBtn);
              }
            }
          }
          return;
        }
      }
    } catch (cmdErr) {
      console.warn("[SARA] Command processing fallback to chat:", cmdErr);
    }
  }

  if (gen) return;

  // Check if it's an image generation command or natural language image request
  const imgPrompt = extractImagePrompt(msg);
  if (imgPrompt && !hasAttachments) {
    inp.value = "";
    inp.style.height = "auto";
    generateImage(imgPrompt);
    return;
  }

  let userVisibleText = msg.trim();
  const attachmentsPayload = hasAttachments
    ? attachedFiles.map((f) => ({
        filename: f.name,
        file_type: f.file_type || "text/plain",
        file_size: f.size || 0,
        content: f.content || "",
        page_count: f.page_count || 1,
        truncated: Boolean(f.truncated)
      }))
    : [];

  if (!userVisibleText && attachmentsPayload.length > 0) {
    userVisibleText = attachmentsPayload.length === 1
      ? "Please analyze the attached document."
      : "Please analyze the attached documents.";
  }

  const currentAttachmentsMeta = attachmentsPayload.map((a) => ({
    filename: a.filename,
    file_type: a.file_type,
    file_size: a.file_size,
    page_count: a.page_count,
    truncated: a.truncated
  }));

  attachedFiles = [];
  attachedFile = null;
  renderFilePreview();

  if (!curSession) {
    await newChat();
  }

  inp.value = "";
  inp.style.height = "auto";
  const c = document.getElementById("msgs");
  const w = c.querySelector(".welcome");
  if (w) w.remove();

  msgs.push({
    role: "user",
    content: userVisibleText,
    attachments: currentAttachmentsMeta,
    attachment: currentAttachmentsMeta[0] || null
  });
  c.appendChild(mkMsg("user", userVisibleText, null, null, currentAttachmentsMeta[0] || null, currentAttachmentsMeta));

  const ai = document.createElement("div");
  ai.className = "msg assistant";
  ai.innerHTML = '<div class="msg-av">🤖</div><div class="msg-c"><div class="typing"><span></span><span></span><span></span></div></div>';
  c.appendChild(ai);
  c.scrollTop = c.scrollHeight;

  gen = true;
  document.getElementById("send").classList.add("hidden");
  document.getElementById("stop").classList.remove("hidden");
  ac = new AbortController();
  let full = "";
  let currentWebQuery = "";

  if (!navigator.onLine) {
    ai.querySelector(".msg-c").innerHTML = "<p style='color:var(--dr)'>I'm offline right now, so I can't complete that request. Please reconnect to the internet and try again.</p>";
    gen = false;
    document.getElementById("send").classList.remove("hidden");
    document.getElementById("stop").classList.add("hidden");
    return;
  }

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({
        session_id: curSession,
        message: userVisibleText,
        attachments: attachmentsPayload,
        attachment: attachmentsPayload[0] || null,
        model_mode: modelMode,
        use_web: webSearchActive,
        personality_mode: personalityMode
      }),
      signal: ac.signal
    });

    if (!r.ok) {
      const errData = await r.json().catch(() => ({ error: "Server returned " + r.status }));
      throw new Error(errData.error || "Failed to generate response");
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    while (true) {
      const res = await reader.read();
      if (res.done) break;
      buf += dec.decode(res.value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;

        try {
          const d = JSON.parse(jsonStr);
          if (d.web_search) {
            currentWebQuery = d.web_search;
          }
          if (d.content) {
            full += d.content;
            let html = "";
            if (currentWebQuery) {
              html += '<div class="web-search-pill">🌐 Searched web for: <strong>"' + esc(currentWebQuery) + '"</strong></div>';
            }
            html += renderMessageContent(full, true);
            ai.querySelector(".msg-c").innerHTML = html;
            c.scrollTop = c.scrollHeight;
          }
          if (d.title) {
            document.getElementById("chat-title").textContent = d.title;
          }
          if (d.error) {
            ai.querySelector(".msg-c").innerHTML = "<p style='color:var(--dr)'>Error: " + esc(d.error) + "</p>";
          }
        } catch {}
      }
    }

    if (full) {
      msgs.push({ role: "assistant", content: full, web_query: currentWebQuery });
      // Replace with clean message that includes action buttons
      ai.replaceWith(mkMsg("assistant", full, null, currentWebQuery));
    }
    await loadSessions();
  } catch (e) {
    if (e.name !== "AbortError") {
      const isOfflineErr = !navigator.onLine || /failed to fetch|networkerror|network error|offline/i.test(e.message || "");
      const msgText = isOfflineErr
        ? "I'm offline right now, so I can't complete that request. Please reconnect to the internet and try again."
        : "Error: " + esc(e.message);
      ai.querySelector(".msg-c").innerHTML = "<p style='color:var(--dr)'>" + (isOfflineErr ? msgText : esc(msgText)) + "</p>";
    } else {
      if (full) {
        msgs.push({ role: "assistant", content: full, web_query: currentWebQuery });
        ai.replaceWith(mkMsg("assistant", full, null, currentWebQuery));
      }
    }
  }

  gen = false;
  document.getElementById("send").classList.remove("hidden");
  document.getElementById("stop").classList.add("hidden");
}

document.getElementById("send").onclick = send;
document.getElementById("stop").onclick = () => {
  if (ac) ac.abort();
};

document.getElementById("input").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
};

document.getElementById("input").oninput = function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 200) + "px";
};

// Model switch (Smart -> Deep Think -> Fast)
function updateModelBtn() {
  const b = document.getElementById("model-btn");
  if (!b) return;
  b.className = "btn-m " + modelMode;
  if (modelMode === "smart") {
    b.innerHTML = "💡 Smart";
    b.title = "Smart Mode (Llama 3.3 70B - Deep knowledge & coding)";
  } else if (modelMode === "thinking") {
    b.innerHTML = "🧠 Deep Think";
    b.title = "Deep Think Mode (DeepSeek R1 - Advanced Reasoning & CoT)";
  } else if (modelMode === "fast") {
    b.innerHTML = "⚡ Fast";
    b.title = "Fast Mode (GLM 4.7 Flash - High speed responses)";
  }
}

const modelBtn = document.getElementById("model-btn");
if (modelBtn) {
  modelBtn.onclick = () => {
    if (modelMode === "smart") modelMode = "thinking";
    else if (modelMode === "thinking") modelMode = "fast";
    else modelMode = "smart";
    localStorage.setItem("sara_model_mode", modelMode);
    updateModelBtn();
  };
  updateModelBtn();
}

// Web search toggle
const webBtn = document.getElementById("web-btn");
if (webBtn) {
  webBtn.onclick = () => {
    webSearchActive = !webSearchActive;
    webBtn.classList.toggle("active", webSearchActive);
    webBtn.title = webSearchActive ? "Web Search ON (Click to disable)" : "Live Web Search (Search Internet)";
  };
}

// Export Chat
document.getElementById("export-btn").onclick = async () => {
  if (!curSession) {
    alert("No chat selected to export.");
    return;
  }
  const choice = window.prompt("Export Options:\nType 'pdf' to Print / Save as PDF\nType 'txt' to Download Text File\n", "txt");
  if (!choice) return;

  if (choice.toLowerCase() === "pdf") {
    window.print();
    return;
  }

  try {
    const r = await api("/api/sessions/" + curSession + "/export?format=text");
    if (!r.ok) throw new Error("Export failed");
    const text = await r.text();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const title = document.getElementById("chat-title").textContent.trim() || "chat";
    a.href = url;
    a.download = title.replace(/[^a-z0-9_-]/gi, "_") + ".txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Could not export chat: " + err.message);
  }
};

// Settings
document.getElementById("settings-btn").onclick = () => {
  document.getElementById("settings").classList.remove("hidden");
  loadSettings();
};

document.getElementById("set-close").onclick = () => {
  document.getElementById("settings").classList.add("hidden");
};

document.getElementById("settings").onclick = function (e) {
  if (e.target === this) this.classList.add("hidden");
};

async function loadSettings() {
  if (!token) return;
  try {
    const r = await api("/api/settings");
    const d = await r.json();
    const s = d.settings || {};
    if (s.theme) {
      document.documentElement.setAttribute("data-theme", s.theme);
      document.querySelectorAll("#theme-opts .opt").forEach((o) => {
        o.classList.toggle("active", o.dataset.theme === s.theme);
      });
    }
    if (s.primary_color) {
      document.documentElement.style.setProperty("--p", s.primary_color);
      document.documentElement.style.setProperty("--ph", s.primary_color);
      document.querySelectorAll(".clr").forEach((o) => {
        o.classList.toggle("active", o.dataset.c === s.primary_color);
      });
    }
    if (s.font_size) {
      const sz = { small: "13px", medium: "15px", large: "17px" };
      document.documentElement.style.setProperty("--fs", sz[s.font_size] || "15px");
      document.getElementById("font-sel").value = s.font_size;
    }
    if (s.language && document.getElementById("lang-sel")) {
      document.getElementById("lang-sel").value = s.language;
    }
    if (s.personality_mode) {
      personalityMode = s.personality_mode === "romantic" ? "romantic" : "normal";
      try {
        localStorage.setItem("sara_personality_mode", personalityMode);
      } catch {}
    }
    document.querySelectorAll("#personality-opts .opt").forEach((o) => {
      const isMatch = o.dataset.mode === personalityMode;
      o.classList.toggle("active", isMatch);
      o.setAttribute("aria-pressed", isMatch ? "true" : "false");
    });
    if (s.system_prompt) {
      document.getElementById("sys-prompt").value = s.system_prompt;
    }
    await loadMemories();
  } catch (e) {}
}

async function loadMemories() {
  const container = document.getElementById("memories-list");
  if (!container || !token) return;
  try {
    const r = await api("/api/memories");
    const d = await r.json();
    const list = d.memories || [];
    if (list.length === 0) {
      container.innerHTML = '<div style="font-size:12px;color:var(--tm);padding:6px 0;">No saved memories yet. SARA will auto-remember key facts as you chat!</div>';
      return;
    }
    container.innerHTML = "";
    list.forEach((m) => {
      const item = document.createElement("div");
      item.className = "mem-item";
      item.innerHTML = '<span>• ' + esc(m.content) + '</span><button class="mem-del" title="Delete memory">🗑️</button>';
      item.querySelector(".mem-del").onclick = async () => {
        try {
          await api("/api/memories/" + m.id, { method: "DELETE" });
          loadMemories();
        } catch {}
      };
      container.appendChild(item);
    });
  } catch {}
}

const addMemBtn = document.getElementById("add-mem-btn");
const newMemInput = document.getElementById("new-mem-input");
if (addMemBtn && newMemInput) {
  const submitMem = async () => {
    const val = newMemInput.value.trim();
    if (!val) return;
    try {
      await api("/api/memories", { method: "POST", body: JSON.stringify({ content: val }) });
      newMemInput.value = "";
      loadMemories();
    } catch (err) {
      alert("Failed to save memory: " + err.message);
    }
  };
  addMemBtn.onclick = submitMem;
  newMemInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitMem();
    }
  };
}

document.querySelectorAll("#theme-opts .opt").forEach((o) => {
  o.onclick = () => {
    document.querySelectorAll("#theme-opts .opt").forEach((x) => x.classList.remove("active"));
    o.classList.add("active");
    document.documentElement.setAttribute("data-theme", o.dataset.theme);
  };
});

document.querySelectorAll("#personality-opts .opt").forEach((o) => {
  o.onclick = () => {
    setPersonalityMode(o.dataset.mode);
  };
});

document.querySelectorAll(".clr").forEach((o) => {
  o.onclick = () => {
    document.querySelectorAll(".clr").forEach((x) => x.classList.remove("active"));
    o.classList.add("active");
    document.documentElement.style.setProperty("--p", o.dataset.c);
    document.documentElement.style.setProperty("--ph", o.dataset.c);
  };
});

document.getElementById("set-save").onclick = async () => {
  const th = document.querySelector("#theme-opts .opt.active") ? document.querySelector("#theme-opts .opt.active").dataset.theme : "dark";
  const cl = document.querySelector(".clr.active") ? document.querySelector(".clr.active").dataset.c : "#6366f1";
  const fs = document.getElementById("font-sel").value;
  const lang = document.getElementById("lang-sel") ? document.getElementById("lang-sel").value : "auto";
  const sp = document.getElementById("sys-prompt").value;
  const pers = document.querySelector("#personality-opts .opt.active") ? document.querySelector("#personality-opts .opt.active").dataset.mode : personalityMode;
  try {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ theme: th, primary_color: cl, font_size: fs, language: lang, system_prompt: sp, personality_mode: pers })
    });
    setPersonalityMode(pers);
    if (curSession && sp) {
      await api("/api/sessions/" + curSession, {
        method: "PUT",
        body: JSON.stringify({ system_prompt: sp })
      });
    }
  } catch {}
  document.getElementById("settings").classList.add("hidden");
};

// Sidebar Toggle
document.getElementById("sb-close").onclick = () => {
  document.getElementById("sidebar").classList.remove("open");
};

document.getElementById("sb-open").onclick = () => {
  document.getElementById("sidebar").classList.add("open");
};

const mainArea = document.querySelector(".main");
if (mainArea) {
  mainArea.addEventListener("click", (e) => {
    const sb = document.getElementById("sidebar");
    if (sb && sb.classList.contains("open") && !e.target.closest("#sb-open")) {
      sb.classList.remove("open");
    }
  });
}

// Network & Connection Status (Phase 2D)
let connTimer = null;
function updateConnectionStatus(isInitial = false) {
  const banner = document.getElementById("conn-banner");
  if (!banner) return;

  if (connTimer) {
    clearTimeout(connTimer);
    connTimer = null;
  }

  if (!navigator.onLine) {
    banner.className = "conn-banner offline";
    banner.innerHTML = "<span>⚠️ You're offline. SARA can still open the app, but AI chat, web search, image generation and other network features need internet.</span>";
  } else {
    if (isInitial) {
      banner.className = "conn-banner hidden";
      banner.innerHTML = "";
    } else {
      banner.className = "conn-banner online";
      banner.innerHTML = "<span>✓ You're back online. 💜</span>";
      connTimer = setTimeout(() => {
        banner.className = "conn-banner hidden";
        banner.innerHTML = "";
        connTimer = null;
      }, 3500);
    }
  }
}

window.addEventListener("online", () => updateConnectionStatus(false));
window.addEventListener("offline", () => updateConnectionStatus(false));

async function init() {
  updateConnectionStatus(true);
  if (token) {
    try {
      const r = await api("/api/auth/me");
      const d = await r.json();
      if (d.user) {
        showApp();
        return;
      }
    } catch (e) {
      if (!navigator.onLine && token) {
        showApp();
        return;
      }
    }
  }
  showAuth();
}

init();
