/**
 * Auto-Error-Reporter — Standalone Module
 *
 * Faengt globale Fehler ab (JS-Errors, Promise-Rejections, HTTP 5xx/XHR),
 * macht einen Screenshot vom aktuellen Viewport und oeffnet ein Feedback-Modal
 * mit vorausgefuellter Beschreibung.
 *
 * Ziel: User sollen Bugs mit minimalem Aufwand melden koennen.
 *
 * ===========================================================================
 * INTEGRATION (andere Apps):
 * ===========================================================================
 *   1. html2canvas via CDN laden:
 *      <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
 *   2. Diese Datei laden:
 *      <script src="/static/js/auto-error-reporter.js"></script>
 *   3. Konfigurieren (VOR Laden dieser Datei):
 *      <script>
 *        window.AutoErrorReporter = {
 *          endpoint: '/api/bug-report',    // erwartet FormData-POST
 *          onReport: (detail) => { ... },   // oder openFeedbackModal
 *        };
 *      </script>
 *   4. Backend: Endpoint akzeptiert FormData mit Feldern:
 *      type, title, description, page_url, priority, screenshot (File), auto_reported=1
 *
 * ===========================================================================
 * CONFIG (alle optional):
 * ===========================================================================
 *   enabled:                 Boolean — Module aktiv? (Default true)
 *   endpoint:                URL fuer Submit (Default '/feedback/api/submit')
 *   openFeedbackModal:       Alternative zum POST: oeffne stattdessen ein Modal
 *                            (Default: CustomEvent 'open-feedback' dispatchen)
 *   dedupMs:                 Dedup-Fenster in ms (Default 60000)
 *   maxPerSession:           Max Auto-Reports pro Seite (Default 20)
 *   captureScreenshots:      Screenshot machen? (Default true)
 *   triggers: {              Welche Fehler-Typen triggern
 *     jsError:               (Default true)
 *     unhandledRejection:    (Default true)
 *     http5xx:               (Default true — fetch + XHR)
 *     consoleError:          (Default false — sehr noisy)
 *   }
 *   ignorePatterns:          Array<RegExp> — Fehler mit passendem Pattern skipen
 *   skipEndpoints:           Array<String> — URLs die NICHT als Fehler zaehlen
 *   onBeforeReport:          (detail) => detail|null — Hook um Report zu modifizieren/canceln
 *
 * ===========================================================================
 * PRIVACY:
 * ===========================================================================
 *   - Elemente mit Klasse .no-screenshot werden vom Screenshot ausgeschlossen
 *   - Password-Felder werden automatisch ausgeschlossen
 *   - User kann komplett opt-outen: localStorage.setItem('autoErrorOptOut', '1')
 *
 * ===========================================================================
 * TESTING (Browser-Console):
 * ===========================================================================
 *   __autoErrorTest.jsError()         → JS-Error triggern
 *   __autoErrorTest.promiseReject()   → Promise-Rejection triggern
 *   __autoErrorTest.http500()         → Fake HTTP 500 triggern
 *   __autoErrorTest.stats()           → Dedup-Cache und Counter anzeigen
 *   __autoErrorTest.reset()           → Dedup-Cache und Counter zuruecksetzen
 */

(function() {
    'use strict';

    // Default Config mergen mit User-Config
    const userConfig = window.AutoErrorReporter || {};
    const CFG = {
        enabled: true,
        endpoint: '/feedback/api/submit',
        openFeedbackModal: true,  // dispatch CustomEvent statt POST
        dedupMs: 60000,
        maxPerSession: 20,
        captureScreenshots: true,
        triggers: {
            jsError: true,
            unhandledRejection: true,
            http5xx: true,
            consoleError: false,
        },
        ignorePatterns: [
            /ResizeObserver loop/,
            /Non-Error promise rejection/,
            /^Script error\.?$/,           // Cross-origin Errors ohne Details
            /html2canvas|cdnjs\.cloudflare|cdn\.jsdelivr/,
            /Loading chunk \d+ failed/,     // Vite/Webpack chunk-reload
            /ChunkLoadError/,
            /The operation was aborted/,    // Cancelled requests
            /NetworkError when attempting to fetch/,  // Offline
        ],
        skipEndpoints: [
            '/feedback/api/submit',
            '/api/bug-report',
            '/api/feedback/submit',
            '/api/uploads',
            '/api/nav/track',
            '/api/nav/stats',
        ],
        onBeforeReport: null,
        ...userConfig,
        triggers: { ...{
            jsError: true,
            unhandledRejection: true,
            http5xx: true,
            consoleError: false,
        }, ...(userConfig.triggers || {}) },
    };

    // Opt-Out via localStorage
    if (!CFG.enabled) return;
    try {
        if (localStorage.getItem('autoErrorOptOut') === '1') {
            console.info('[AutoError] Opt-Out aktiv — Reporter deaktiviert');
            return;
        }
    } catch (_) { /* private mode */ }

    // State
    const recentErrors = new Map(); // fingerprint -> timestamp
    let sessionReportCount = 0;
    let reportingInProgress = false;

    function matchesIgnore(msg) {
        if (!msg) return false;
        return CFG.ignorePatterns.some(p => {
            try { return p.test(String(msg)); } catch (_) { return false; }
        });
    }

    function shouldReport(fp) {
        if (sessionReportCount >= CFG.maxPerSession) {
            console.warn('[AutoError] Session-Limit erreicht (' + CFG.maxPerSession + ')');
            return false;
        }
        const now = Date.now();
        const last = recentErrors.get(fp);
        if (last && now - last < CFG.dedupMs) return false;
        recentErrors.set(fp, now);
        // Alte Eintraege aufraeumen
        for (const [k, t] of recentErrors) {
            if (now - t > CFG.dedupMs * 3) recentErrors.delete(k);
        }
        return true;
    }

    async function takeScreenshot() {
        if (!CFG.captureScreenshots || !window.html2canvas) return null;
        try {
            const canvas = await window.html2canvas(document.body, {
                logging: false,
                useCORS: true,
                allowTaint: true,
                ignoreElements: (el) => {
                    // Feedback-Modal selbst (Alpine legacy + React data-attribute)
                    if (el.closest && el.closest('[x-data="feedbackForm()"]')) return true;
                    if (el.closest && el.closest('[data-feedback-modal]')) return true;
                    // Explizit markierte Elemente
                    if (el.classList && el.classList.contains('no-screenshot')) return true;
                    // Password-Inputs (sicherheitshalber)
                    if (el.tagName === 'INPUT' && el.type === 'password') return true;
                    return false;
                },
            });
            return canvas.toDataURL('image/png');
        } catch (e) {
            console.warn('[AutoError] Screenshot fehlgeschlagen:', e);
            return null;
        }
    }

    // Konvertiert data:image/png;base64,... direkt in ein File, ohne fetch()
    // (fetch auf data: kann unter strenger CSP mit connect-src blockiert werden).
    function dataUrlToFile(dataUrl, filename) {
        const comma = dataUrl.indexOf(',');
        const header = dataUrl.slice(0, comma);
        const data = dataUrl.slice(comma + 1);
        const mimeMatch = /data:([^;]+)/.exec(header);
        const mime = (mimeMatch && mimeMatch[1]) || 'image/png';
        const binary = atob(data);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return new File([bytes], filename, { type: mime });
    }

    function buildContext() {
        return {
            url: window.location.href,
            path: window.location.pathname,
            userAgent: navigator.userAgent,
            viewport: window.innerWidth + 'x' + window.innerHeight,
            timestamp: new Date().toISOString(),
        };
    }

    async function report(opts) {
        if (reportingInProgress) return;
        if (sessionReportCount >= CFG.maxPerSession) return;
        reportingInProgress = true;
        sessionReportCount++;
        try {
            // Screenshot VOR Modal-Oeffnung (Modal wuerde sonst im Bild sein)
            const dataUrl = await takeScreenshot();
            let screenshot = null, screenshotPreview = null, screenshotName = '';
            if (dataUrl) {
                screenshotPreview = dataUrl;
                screenshotName = 'auto-screenshot-' + Date.now() + '.png';
                try { screenshot = dataUrlToFile(dataUrl, screenshotName); } catch (_) {}
            }

            const detail = {
                type: 'bug',
                title: opts.title,
                description: opts.description,
                priority: opts.priority || 'high',
                screenshot, screenshotPreview, screenshotName,
                autoReported: true,
            };

            // onBeforeReport Hook — kann modifizieren oder null zurueckgeben = abbrechen
            if (typeof CFG.onBeforeReport === 'function') {
                const modified = CFG.onBeforeReport(detail);
                if (modified === null) return;  // abgebrochen
                Object.assign(detail, modified || {});
            }

            // Modal oeffnen (Default) oder direkt POST
            if (CFG.openFeedbackModal) {
                window.dispatchEvent(new CustomEvent('open-feedback', { detail }));
            } else {
                // Direkt POST ohne Modal
                const form = new FormData();
                form.append('type', detail.type);
                form.append('title', detail.title);
                form.append('description', detail.description);
                form.append('page_url', window.location.pathname);
                form.append('priority', detail.priority);
                form.append('auto_reported', '1');
                if (screenshot) form.append('screenshot', screenshot);
                try {
                    await fetch(CFG.endpoint, { method: 'POST', body: form });
                } catch (e) {
                    console.warn('[AutoError] Direct submit fehlgeschlagen:', e);
                }
            }
        } finally {
            reportingInProgress = false;
        }
    }

    // === 1) Uncaught JS Errors ===
    if (CFG.triggers.jsError) {
        window.addEventListener('error', function(e) {
            const msg = e.message || 'Unbekannt';
            if (matchesIgnore(msg)) return;
            if (e.filename && matchesIgnore(e.filename)) return;
            const fp = 'js|' + msg + '|' + (e.filename || '') + ':' + (e.lineno || '');
            if (!shouldReport(fp)) return;
            const ctx = buildContext();
            const desc = '[AUTO] JavaScript-Fehler\n\n' +
                         'Fehler: ' + msg + '\n' +
                         'Datei: ' + (e.filename || '?') + ':' + (e.lineno || '?') + ':' + (e.colno || '?') + '\n' +
                         'Stacktrace:\n' + (e.error && e.error.stack ? e.error.stack : '(nicht verfuegbar)') + '\n\n' +
                         'Seite: ' + ctx.url + '\n' +
                         'Viewport: ' + ctx.viewport + '\n' +
                         'User-Agent: ' + ctx.userAgent + '\n' +
                         'Zeitstempel: ' + ctx.timestamp + '\n\n' +
                         '--- Bitte ergaenze was du gemacht hast als der Fehler auftrat ---';
            report({ title: '[AUTO] JS-Fehler: ' + String(msg).slice(0, 60), description: desc });
        });
    }

    // === 2) Unhandled Promise Rejections ===
    if (CFG.triggers.unhandledRejection) {
        window.addEventListener('unhandledrejection', function(e) {
            const reason = e.reason;
            const msg = (reason && reason.message) ? reason.message : String(reason || 'Unbekannt');
            if (matchesIgnore(msg)) return;
            const fp = 'promise|' + msg.slice(0, 200);
            if (!shouldReport(fp)) return;
            const ctx = buildContext();
            const desc = '[AUTO] Promise-Rejection\n\n' +
                         'Fehler: ' + msg + '\n' +
                         'Stacktrace:\n' + (reason && reason.stack ? reason.stack : '(nicht verfuegbar)') + '\n\n' +
                         'Seite: ' + ctx.url + '\n' +
                         'Zeitstempel: ' + ctx.timestamp + '\n\n' +
                         '--- Bitte ergaenze was du gemacht hast ---';
            report({ title: '[AUTO] Promise-Fehler: ' + msg.slice(0, 60), description: desc });
        });
    }

    // === 3) HTTP 5xx (fetch + XHR) ===
    function isSkipEndpoint(url) {
        return CFG.skipEndpoints.some(ep => url.includes(ep));
    }

    function reportHttpError(url, status, method) {
        const fp = 'http|' + url + '|' + status;
        if (!shouldReport(fp)) return;
        const ctx = buildContext();
        const desc = '[AUTO] Server-Fehler (HTTP ' + status + ')\n\n' +
                     'Endpoint: ' + (method || 'GET') + ' ' + url + '\n' +
                     'Status: ' + status + '\n' +
                     'Seite: ' + ctx.url + '\n' +
                     'Zeitstempel: ' + ctx.timestamp + '\n\n' +
                     '--- Bitte ergaenze welche Aktion den Fehler ausgeloest hat ---';
        report({ title: '[AUTO] Server-Fehler ' + status + ': ' + url.slice(-50), description: desc });
    }

    if (CFG.triggers.http5xx) {
        // fetch Hook
        const origFetch = window.fetch;
        if (origFetch) {
            window.fetch = async function(...args) {
                const res = await origFetch.apply(this, args);
                try {
                    if (res.status >= 500 && res.status < 600) {
                        let url = '';
                        let method = 'GET';
                        try {
                            if (typeof args[0] === 'string') {
                                url = args[0];
                                method = (args[1] && args[1].method) || 'GET';
                            } else if (args[0]) {
                                url = args[0].url || '';
                                method = args[0].method || 'GET';
                            }
                        } catch (_) {}
                        if (url && !isSkipEndpoint(url)) reportHttpError(url, res.status, method);
                    }
                } catch (_) {}
                return res;
            };
        }

        // XMLHttpRequest Hook
        const XHR = window.XMLHttpRequest;
        if (XHR && XHR.prototype && XHR.prototype.open) {
            const origOpen = XHR.prototype.open;
            const origSend = XHR.prototype.send;
            XHR.prototype.open = function(method, url) {
                this.__aerMethod = method;
                this.__aerUrl = url;
                return origOpen.apply(this, arguments);
            };
            XHR.prototype.send = function() {
                this.addEventListener('loadend', function() {
                    try {
                        if (this.status >= 500 && this.status < 600) {
                            const url = this.__aerUrl || '';
                            if (url && !isSkipEndpoint(url)) {
                                reportHttpError(url, this.status, this.__aerMethod);
                            }
                        }
                    } catch (_) {}
                });
                return origSend.apply(this, arguments);
            };
        }
    }

    // === 4) Test-Helpers (global im dev-Mode verfuegbar) ===
    window.__autoErrorTest = {
        jsError: () => { setTimeout(() => { throw new Error('Test-JS-Error ' + Date.now()); }, 0); },
        promiseReject: () => { Promise.reject(new Error('Test-Promise-Rejection ' + Date.now())); },
        http500: async () => {
            try { await fetch('/__nonexistent_test_endpoint_' + Date.now()); } catch (_) {}
        },
        stats: () => ({
            sessionReportCount,
            recentErrorsCount: recentErrors.size,
            maxPerSession: CFG.maxPerSession,
            enabled: CFG.enabled,
            optedOut: (function() { try { return localStorage.getItem('autoErrorOptOut') === '1'; } catch(_) { return false; } })(),
        }),
        reset: () => {
            recentErrors.clear();
            sessionReportCount = 0;
            console.info('[AutoError] State zurueckgesetzt');
        },
        optOut: () => { try { localStorage.setItem('autoErrorOptOut', '1'); } catch(_){} console.info('Opt-Out gesetzt — Seite neu laden'); },
        optIn: () => { try { localStorage.removeItem('autoErrorOptOut'); } catch(_){} console.info('Opt-Out entfernt — Seite neu laden'); },
    };

    console.info('[AutoError] Reporter aktiv. Test via window.__autoErrorTest.*()');
})();
