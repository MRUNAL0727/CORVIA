/* ═══════════════════════════════════════════════════════════
   CORVIA FLOATING AI CHAT WIDGET
   Include after corvia-chat.css on every page.
   Automatically injects the widget into <body>.
   Calls /api/chat — no extra config needed.
═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────
  let isOpen       = false;
  let chatHistory  = [];
  let welcomeShown = true;

  // ── Inject HTML into page ────────────────────────────────
  function injectWidget() {
    // Avoid double-injection
    if (document.getElementById('corvia-chat-trigger')) return;

    // Floating trigger button
    const trigger = document.createElement('button');
    trigger.id = 'corvia-chat-trigger';
    trigger.setAttribute('aria-label', 'Open CORVIA AI chat');
    trigger.innerHTML = `
      <span class="chat-icon-heart">🤖</span>
      <span class="chat-icon-close">✕</span>
      <span id="corvia-chat-badge">1</span>
    `;

    // Chat window
    const win = document.createElement('div');
    win.id = 'corvia-chat-window';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', 'CorVia AI Chat');
    win.innerHTML = `
      <!-- Header -->
      <div class="cw-header">
        <div class="cw-header-avatar">🤖</div>
        <div class="cw-header-info">
          <div class="cw-header-name">CORVIA AI</div>
          <div class="cw-header-status">
            <span class="cw-status-dot"></span>
            Gemini 2.5 Flash · Online
          </div>
        </div>
        <button class="cw-clear-btn" id="cw-clear">Clear</button>
      </div>

      <!-- Messages -->
      <div class="cw-messages" id="cw-messages" aria-live="polite">
        <div class="cw-welcome" id="cw-welcome">
          <div class="cw-welcome-icon">🤖</div>
          <div class="cw-welcome-title">CORVIA AI ready</div>
          <div class="cw-welcome-sub">Ask me anything about heart health, your risk score, medications, diet or lifestyle.</div>
          <div class="cw-quick-grid">
            <button class="cw-quick-btn" data-q="What does my cardiovascular risk score mean?">What does my risk score mean?</button>
            <button class="cw-quick-btn" data-q="Give me a 6-month plan to reduce my heart risk">6-month action plan</button>
            <button class="cw-quick-btn" data-q="How can I lower my cholesterol naturally?">Lower cholesterol naturally</button>
            <button class="cw-quick-btn" data-q="What lifestyle changes help heart health the most?">Best lifestyle changes</button>
          </div>
        </div>
      </div>

      <!-- Footer / input -->
      <div class="cw-footer">
        <input
          class="cw-input"
          id="cw-input"
          type="text"
          placeholder="Ask about heart health…"
          autocomplete="off"
          aria-label="Chat message"
          maxlength="500"
        >
        <button class="cw-send-btn" id="cw-send" aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
    `;

    document.body.appendChild(trigger);
    document.body.appendChild(win);

    // ── Wire events ───────────────────────────────────────
    trigger.addEventListener('click', toggleChat);

    document.getElementById('cw-send').addEventListener('click', sendMessage);

    document.getElementById('cw-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    document.getElementById('cw-clear').addEventListener('click', clearChat);

    // Quick prompt buttons (event delegation)
    document.getElementById('cw-messages').addEventListener('click', function (e) {
      const btn = e.target.closest('.cw-quick-btn');
      if (btn) {
        const q = btn.getAttribute('data-q');
        if (q) sendQuick(q);
      }
    });

    // Show badge after 3s if not opened yet
    setTimeout(function () {
      if (!isOpen) showBadge();
    }, 3000);
  }

  // ── Toggle open/close ─────────────────────────────────────
  function toggleChat() {
    isOpen = !isOpen;
    const trigger = document.getElementById('corvia-chat-trigger');
    const win     = document.getElementById('corvia-chat-window');

    trigger.classList.toggle('open', isOpen);
    win.classList.toggle('open', isOpen);

    if (isOpen) {
      hideBadge();
      // Focus input
      setTimeout(function () {
        const inp = document.getElementById('cw-input');
        if (inp) inp.focus();
      }, 320);
    }
  }

  function openChat() {
    if (!isOpen) toggleChat();
  }

  // ── Badge ─────────────────────────────────────────────────
  function showBadge() {
    const b = document.getElementById('corvia-chat-badge');
    if (b) b.classList.add('visible');
  }
  function hideBadge() {
    const b = document.getElementById('corvia-chat-badge');
    if (b) b.classList.remove('visible');
  }

  // ── Send message ──────────────────────────────────────────
  function sendMessage() {
    const inp  = document.getElementById('cw-input');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    dispatchMessage(text);
  }

  function sendQuick(text) {
    openChat();
    setTimeout(function () { dispatchMessage(text); }, 350);
  }

  async function dispatchMessage(text) {
    // Remove welcome screen on first message
    if (welcomeShown) {
      const welcome = document.getElementById('cw-welcome');
      if (welcome) welcome.remove();
      welcomeShown = false;
    }

    addBubble('user', text);
    addTyping();

    // Build context from sessionStorage if available (set by risk-check page)
    let ctx = null;
    try {
      const risk = sessionStorage.getItem('risk');
      if (risk) {
        ctx = {
          age:        sessionStorage.getItem('age'),
          sex:        sessionStorage.getItem('sex'),
          risk:       risk,
          category:   sessionStorage.getItem('category'),
          sys_bp:     sessionStorage.getItem('sys_bp'),
          total_chol: sessionStorage.getItem('total_chol'),
          hdl_chol:   sessionStorage.getItem('hdl_chol'),
          steps:      sessionStorage.getItem('steps'),
          smoker:     sessionStorage.getItem('smoker'),
          diabetes:   sessionStorage.getItem('diabetes'),
        };
      }
    } catch (e) { /* sessionStorage unavailable */ }

    try {
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          message: text,
          history: chatHistory,
          result:  ctx,
        }),
      });
      const data = await res.json();
      removeTyping();
      const reply = data.reply || 'Sorry, I could not generate a response.';
      addBubble('bot', reply);
      chatHistory.push({ user: text, assistant: reply });
      // Keep history to last 10 exchanges
      if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);
    } catch (err) {
      removeTyping();
      addBubble('bot', '⚠️ Connection error. Please try again.');
    }
  }

  // ── DOM helpers ───────────────────────────────────────────
  function addBubble(role, text) {
    const box  = document.getElementById('cw-messages');
    const wrap = document.createElement('div');
    wrap.className = 'cw-msg ' + role;

    // Render **bold**, *italic*, newlines
    const safe = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');

    wrap.innerHTML =
      '<div class="cw-msg-label">' + (role === 'user' ? 'You' : 'CorVia AI') + '</div>' +
      '<div class="cw-bubble">' + safe + '</div>';

    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
  }

  function addTyping() {
    const box  = document.getElementById('cw-messages');
    const wrap = document.createElement('div');
    wrap.className = 'cw-msg bot cw-typing';
    wrap.id = 'cw-typing-indicator';
    wrap.innerHTML =
      '<div class="cw-msg-label">CorVia AI</div>' +
      '<div class="cw-bubble">' +
        '<span class="cw-typing-dot"></span>' +
        '<span class="cw-typing-dot"></span>' +
        '<span class="cw-typing-dot"></span>' +
      '</div>';
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
  }

  function removeTyping() {
    const el = document.getElementById('cw-typing-indicator');
    if (el) el.remove();
  }

  function clearChat() {
    chatHistory  = [];
    welcomeShown = true;
    const box = document.getElementById('cw-messages');
    box.innerHTML = `
      <div class="cw-welcome" id="cw-welcome">
        <div class="cw-welcome-icon">🤖</div>
        <div class="cw-welcome-title">CorVia AI ready</div>
        <div class="cw-welcome-sub">Ask me anything about heart health, your risk score, medications, diet or lifestyle.</div>
        <div class="cw-quick-grid">
          <button class="cw-quick-btn" data-q="What does my cardiovascular risk score mean?">What does my risk score mean?</button>
          <button class="cw-quick-btn" data-q="Give me a 6-month plan to reduce my heart risk">6-month action plan</button>
          <button class="cw-quick-btn" data-q="How can I lower my cholesterol naturally?">Lower cholesterol naturally</button>
          <button class="cw-quick-btn" data-q="What lifestyle changes help heart health the most?">Best lifestyle changes</button>
        </div>
      </div>`;
  }

  // ── Boot ──────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectWidget);
  } else {
    injectWidget();
  }

})();