(function () {
  if (window.__relconSaveButtonAnimationLoaded) return;
  window.__relconSaveButtonAnimationLoaded = true;

  const STYLE_ID = "relcon-save-button-animation-style";
  const SAVE_TEXT_RE = /\b(save|saving|update|updating)\b/i;
  const SUBMIT_SAVE_RE = /\b(submit|submitting)\b/i;
  const activeButtons = new Set();

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .save-anim-btn {
        position: relative;
        overflow: hidden;
        isolation: isolate;
        transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
      }

      .save-anim-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        filter: saturate(1.04);
      }

      .save-anim-btn::before {
        content: "";
        position: absolute;
        inset: -2px;
        z-index: -1;
        background: linear-gradient(115deg, transparent 0%, rgba(255,255,255,.08) 28%, rgba(255,255,255,.5) 45%, rgba(255,255,255,.12) 62%, transparent 100%);
        transform: translateX(-130%) skewX(-18deg);
        opacity: 0;
        pointer-events: none;
      }

      .save-anim-btn::after {
        content: "";
        width: 13px;
        height: 13px;
        border: 2px solid currentColor;
        border-top-color: transparent;
        border-radius: 50%;
        display: inline-block;
        flex: 0 0 auto;
        margin-left: 7px;
        opacity: 0;
        transform: scale(.7);
        vertical-align: -2px;
        pointer-events: none;
      }

      .save-anim-btn[data-save-animating="true"] {
        box-shadow: 0 0 0 3px rgba(46,132,74,.16), 0 8px 20px rgba(46,132,74,.22) !important;
        animation: relconSavePulse 1.05s ease-in-out infinite;
      }

      .save-anim-btn[data-save-animating="true"]::before {
        opacity: 1;
        animation: relconSaveSweep 1.15s ease-in-out infinite;
      }

      .save-anim-btn[data-save-animating="true"]::after {
        opacity: 1;
        transform: scale(1);
        animation: relconSaveSpin .72s linear infinite;
      }

      .save-anim-btn[data-save-complete="true"] {
        animation: relconSaveComplete .55s ease;
      }

      @keyframes relconSaveSpin {
        to { transform: scale(1) rotate(360deg); }
      }

      @keyframes relconSaveSweep {
        0% { transform: translateX(-130%) skewX(-18deg); }
        100% { transform: translateX(130%) skewX(-18deg); }
      }

      @keyframes relconSavePulse {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-1px) scale(1.015); }
      }

      @keyframes relconSaveComplete {
        0% { box-shadow: 0 0 0 0 rgba(46,132,74,.28); }
        55% { box-shadow: 0 0 0 7px rgba(46,132,74,.12); }
        100% { box-shadow: 0 0 0 0 rgba(46,132,74,0); }
      }

      @media (prefers-reduced-motion: reduce) {
        .save-anim-btn,
        .save-anim-btn::before,
        .save-anim-btn::after {
          animation: none !important;
          transition: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buttonText(button) {
    return (button.innerText || button.textContent || button.getAttribute("aria-label") || button.title || "").trim();
  }

  function isSaveButton(button) {
    if (!button || button.dataset.noSaveAnimation === "true") return false;
    const text = buttonText(button);
    const iconLooksLikeSave = !!button.querySelector(".fa-floppy-disk, .fa-save");
    const handler = button.getAttribute("onclick") || "";
    const id = button.id || "";

    if (SAVE_TEXT_RE.test(text) || iconLooksLikeSave) return true;
    if (/save|update/i.test(handler) || /save|update/i.test(id)) return true;
    return SUBMIT_SAVE_RE.test(text) && /attendance|record|task|plan|status|transfer/i.test(text + " " + handler + " " + id);
  }

  function enhanceButton(button) {
    if (!isSaveButton(button)) return;
    button.classList.add("save-anim-btn");
  }

  function scan(root) {
    const scope = root || document;
    if (scope.matches && scope.matches("button")) enhanceButton(scope);
    scope.querySelectorAll?.("button").forEach(enhanceButton);
  }

  function start(button) {
    if (!button || !button.classList.contains("save-anim-btn") || button.disabled) return;
    button.dataset.saveAnimating = "true";
    button.dataset.saveComplete = "false";
    button.dataset.saveStartedAt = String(Date.now());
    activeButtons.add(button);
    clearTimeout(button.__saveAnimTimeout);
    button.__saveAnimTimeout = setTimeout(() => finish(button), 7000);
  }

  function finish(button) {
    if (!button || !activeButtons.has(button)) return;
    const elapsed = Date.now() - Number(button.dataset.saveStartedAt || 0);
    if (elapsed < 650) {
      clearTimeout(button.__saveAnimTimeout);
      button.__saveAnimTimeout = setTimeout(() => finish(button), 650 - elapsed);
      return;
    }
    activeButtons.delete(button);
    button.dataset.saveAnimating = "false";
    button.dataset.saveComplete = "true";
    clearTimeout(button.__saveAnimTimeout);
    setTimeout(() => {
      if (button.dataset.saveAnimating !== "true") button.dataset.saveComplete = "false";
    }, 650);
  }

  function finishActiveButtons() {
    activeButtons.forEach((button) => finish(button));
  }

  function wireEvents() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest?.("button");
      if (!button) return;
      enhanceButton(button);
      start(button);
    }, true);

    document.addEventListener("submit", (event) => {
      const form = event.target;
      const button = form?.querySelector?.('button[type="submit"], button:not([type])');
      if (!button) return;
      enhanceButton(button);
      start(button);
    }, true);

    if (typeof window.fetch === "function" && !window.fetch.__relconSaveAnimationWrapped) {
      const originalFetch = window.fetch.bind(window);
      const wrappedFetch = function () {
        return originalFetch.apply(window, arguments).finally(() => {
          if (activeButtons.size) setTimeout(finishActiveButtons, 250);
        });
      };
      wrappedFetch.__relconSaveAnimationWrapped = true;
      window.fetch = wrappedFetch;
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) scan(node);
        });
        if (mutation.type === "childList" && mutation.target?.matches?.("button")) {
          enhanceButton(mutation.target);
        }
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.RelconSaveAnimation = {
    start,
    finish,
  };

  function init() {
    injectStyle();
    scan(document);
    wireEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
