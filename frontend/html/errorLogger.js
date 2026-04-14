/**
 * RELCON CRM — Global Error Logger v2.0
 * Include karo EVERY HTML page mein (before </body>):
 *   <script src="errorLogger.js"></script>
 */
(function () {
  'use strict';

  const BASE_URL = window.BACKEND_URL || 'https://relcon-crm.onrender.com';
  const LS_KEY    = 'relcon_error_logs';
  const RETRY_KEY = 'relcon_error_retry_queue';
  const MAX_LOCAL = 500;
  const MAX_RETRY = 50;

  function getPage() {
    try { return window.location.pathname.split('/').pop() || 'unknown'; } catch { return 'unknown'; }
  }

  function getUser() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return 'anonymous';
      const p = JSON.parse(atob(token.split('.')[1]));
      return p.engineerName || p.username || p.name || 'anonymous';
    } catch { return 'anonymous'; }
  }

  function buildEntry(type, message, details) {
    details = details || {};
    return {
      id:        Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      timestamp: new Date().toISOString(),
      type:      type,
      message:   String(message || '').slice(0, 500),
      page:      getPage(),
      user:      getUser(),
      url:       window.location.href,
      userAgent: navigator.userAgent.slice(0, 200),
      details: {
        stack:      details.stack      ? String(details.stack).slice(0, 1000) : undefined,
        filename:   details.filename   || undefined,
        lineno:     details.lineno     || undefined,
        colno:      details.colno      || undefined,
        statusCode: details.statusCode || undefined,
        endpoint:   details.endpoint   || undefined,
        method:     details.method     || undefined,
        response:   details.response   ? String(details.response).slice(0, 300) : undefined,
      },
    };
  }

  function saveLocal(entry) {
    try {
      var logs = [];
      try { logs = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch {}
      logs.unshift(entry);
      if (logs.length > MAX_LOCAL) logs = logs.slice(0, MAX_LOCAL);
      localStorage.setItem(LS_KEY, JSON.stringify(logs));
    } catch {}
  }

  function addToRetryQueue(entry) {
    try {
      var q = [];
      try { q = JSON.parse(localStorage.getItem(RETRY_KEY) || '[]'); } catch {}
      q.push(entry);
      if (q.length > MAX_RETRY) q = q.slice(-MAX_RETRY);
      localStorage.setItem(RETRY_KEY, JSON.stringify(q));
    } catch {}
  }

  function sendToBackend(entry) {
    try {
      var token = localStorage.getItem('token');
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      fetch(BASE_URL + '/audit/logError', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(entry),
        keepalive: true,
      }).then(function(res) {
        if (!res.ok) addToRetryQueue(entry);
      }).catch(function() {
        addToRetryQueue(entry);
      });
    } catch {}
  }

  function flushRetryQueue() {
    try {
      var q = [];
      try { q = JSON.parse(localStorage.getItem(RETRY_KEY) || '[]'); } catch { return; }
      if (!q.length) return;
      localStorage.removeItem(RETRY_KEY);
      var token = localStorage.getItem('token');
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      q.forEach(function(entry) {
        fetch(BASE_URL + '/audit/logError', {
          method: 'POST', headers: headers,
          body: JSON.stringify(entry), keepalive: true,
        }).catch(function() { addToRetryQueue(entry); });
      });
    } catch {}
  }

  function logError(type, message, details) {
    var entry = buildEntry(type, message, details);
    saveLocal(entry);
    sendToBackend(entry);
    return entry;
  }

  /* 1. Uncaught JS Errors */
  window.addEventListener('error', function(e) {
    if (!e.message || e.message === 'Script error.') return;
    logError('js_error', e.message, {
      stack: e.error && e.error.stack,
      filename: e.filename, lineno: e.lineno, colno: e.colno,
    });
  }, true);

  /* 2. Unhandled Promise Rejections */
  window.addEventListener('unhandledrejection', function(e) {
    var reason = e.reason;
    var msg = reason instanceof Error ? reason.message : String(reason || 'Unhandled Promise rejection');
    logError('promise_rejection', msg, { stack: reason instanceof Error ? reason.stack : undefined });
  });

  /* 3. console.error & console.warn */
  var _origError = console.error.bind(console);
  var _origWarn  = console.warn.bind(console);

  console.error = function() {
    _origError.apply(console, arguments);
    var msg = Array.from(arguments).map(function(a) {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
      return String(a);
    }).join(' ');
    logError('console_error', msg, { stack: arguments[0] instanceof Error ? arguments[0].stack : undefined });
  };

  console.warn = function() {
    _origWarn.apply(console, arguments);
    var msg = Array.from(arguments).map(function(a) {
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
      return String(a);
    }).join(' ');
    logError('console_warn', msg);
  };

  /* 4. Fetch Interceptor */
  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    var url    = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
    var method = ((init && init.method) || 'GET').toUpperCase();

    // Prevent infinite loop on the logging endpoint itself
    if (url.indexOf('/audit/logError') !== -1) return _fetch(input, init);

    return _fetch(input, init).then(function(response) {
      if (!response.ok) {
        response.clone().text().then(function(bodyText) {
          logError('fetch_error', 'HTTP ' + response.status + ' — ' + method + ' ' + url, {
            endpoint: url, method: method,
            statusCode: response.status,
            response: (bodyText || response.statusText).slice(0, 300),
          });
        }).catch(function() {
          logError('fetch_error', 'HTTP ' + response.status + ' — ' + method + ' ' + url, {
            endpoint: url, method: method, statusCode: response.status,
          });
        });
      }
      return response;
    }).catch(function(networkErr) {
      logError('fetch_error', 'Network error: ' + networkErr.message, {
        endpoint: url, method: method,
        response: 'Network unreachable / CORS / Offline',
      });
      throw networkErr;
    });
  };

  /* 5. Flush retry queue when back online */
  window.addEventListener('online', flushRetryQueue);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') flushRetryQueue();
  });
  setTimeout(flushRetryQueue, 3000);

  /* 6. Public API */
  window.RelconLogger = {
    log: function(message, type, details) { logError('manual_' + (type || 'info'), message, details || {}); },
    getAll: function() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } },
    getRetryQueue: function() { try { return JSON.parse(localStorage.getItem(RETRY_KEY) || '[]'); } catch { return []; } },
    clear: function() { localStorage.removeItem(LS_KEY); localStorage.removeItem(RETRY_KEY); },
    count: function() { return this.getAll().length; },
    flush: function() { flushRetryQueue(); },
  };

  console.info('%c[RELCON Logger v2] Active: ' + getPage(), 'color:#0176d3;font-weight:600;font-size:11px;');
})();
