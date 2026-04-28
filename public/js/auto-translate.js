/**
 * DOM-based auto-translation for Voigt-Garten.
 * Walks the DOM on page load and translates German text to English
 * using the /api/translate backend (DeepL Free API with SQLite cache).
 */
(function () {
  'use strict';

  var LANG_KEY = 'voigt-garten-lang';
  var lang = localStorage.getItem(LANG_KEY) || 'de';
  if (lang !== 'en') return;

  document.documentElement.lang = 'en';

  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, SVG: 1, CODE: 1, PRE: 1 };
  var cache = {};
  var done = new WeakSet();
  var busy = false;
  var API = document.body.getAttribute('data-api-url') || '';
  var MAX_HIDE_MS = 3000;

  // Preload cache, then translate
  fetch(API + '/api/translations/preload?lang=en')
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.translations) cache = d.translations; })
    .catch(function () {})
    .then(function () { return translatePage(); })
    .then(function () {
      document.documentElement.classList.remove('translating');
      observe();
    });

  // Safety timeout: show page even if translation is slow
  setTimeout(function () {
    document.documentElement.classList.remove('translating');
  }, MAX_HIDE_MS);

  function shouldSkip(el) {
    if (!el) return true;
    if (SKIP[el.tagName]) return true;
    if (el.closest && el.closest('[data-no-translate]')) return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function isTranslatable(text) {
    if (!text || text.length < 2) return false;
    if (/^[\d\s.,€$%+\-:\/|·©@#&()\[\]{}!?;'"„""→←↑↓…><=*_~^`]+$/.test(text)) return false;
    if (/^https?:\/\//.test(text)) return false;
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(text)) return false;
    return true;
  }

  function collectTextNodes() {
    var nodes = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      if (done.has(n)) continue;
      if (shouldSkip(n.parentElement)) continue;
      var t = n.nodeValue && n.nodeValue.trim();
      if (!isTranslatable(t)) continue;
      nodes.push(n);
    }
    return nodes;
  }

  function translatePage() {
    var nodes = collectTextNodes();
    var missingMap = {};
    var missingList = [];

    nodes.forEach(function (n) {
      var t = n.nodeValue.trim();
      if (cache[t]) {
        busy = true;
        n.nodeValue = n.nodeValue.replace(t, cache[t]);
        done.add(n);
        busy = false;
      } else {
        if (!missingMap[t]) { missingMap[t] = []; missingList.push(t); }
        missingMap[t].push(n);
      }
    });

    // Translate attributes: placeholder, title, aria-label, alt
    var attrEls = document.body.querySelectorAll(
      '[placeholder], [title], [aria-label], img[alt]'
    );
    var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
    for (var i = 0; i < attrEls.length; i++) {
      var el = attrEls[i];
      if (el.closest && el.closest('[data-no-translate]')) continue;
      for (var j = 0; j < ATTRS.length; j++) {
        var attr = ATTRS[j];
        var val = el.getAttribute(attr);
        if (!val) continue;
        var vt = val.trim();
        if (!isTranslatable(vt)) continue;
        var doneKey = '_t_' + attr;
        if (el[doneKey]) continue;
        if (cache[vt]) {
          el.setAttribute(attr, val.replace(vt, cache[vt]));
          el[doneKey] = true;
        } else {
          if (!missingMap[vt]) { missingMap[vt] = []; missingList.push(vt); }
          missingMap[vt].push({ el: el, attr: attr, val: val });
        }
      }
    }

    if (missingList.length === 0) return Promise.resolve();

    // Batch translate (max 50 per request)
    var promises = [];
    for (var k = 0; k < missingList.length; k += 50) {
      (function (batch) {
        promises.push(
          fetch(API + '/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: batch, target_lang: 'en' })
          })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (!data || !data.translations) return;
              var tr = data.translations;
              Object.keys(tr).forEach(function (src) {
                cache[src] = tr[src];
                var targets = missingMap[src];
                if (!targets) return;
                busy = true;
                targets.forEach(function (item) {
                  if (item.nodeValue !== undefined) {
                    // Text node
                    if (item.parentNode) {
                      item.nodeValue = item.nodeValue.replace(src, tr[src]);
                      done.add(item);
                    }
                  } else if (item.el && item.attr) {
                    // Attribute
                    item.el.setAttribute(item.attr, item.val.replace(src, tr[src]));
                    item.el['_t_' + item.attr] = true;
                  }
                });
                busy = false;
              });
            })
            .catch(function () {})
        );
      })(missingList.slice(k, k + 50));
    }

    return Promise.all(promises);
  }

  // MutationObserver for React islands and dynamic content
  var oTimer;
  function observe() {
    var obs = new MutationObserver(function () {
      if (busy) return;
      clearTimeout(oTimer);
      oTimer = setTimeout(function () { translatePage(); }, 250);
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
})();
