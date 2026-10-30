// src/lib/errorReporter.js
//
// Self-repair loop, browser side: crashes and unhandled errors are written to
// Firestore `errorReports` (create-only) and folded into incidents by the
// onErrorReportCreate function. See CLAUDE.md → "Self-repair loop".
//
// Best-effort and quiet: never throws, sends nothing until someone is signed
// in (the rules require it), skips repeats, and stops after a handful per page
// load so a render loop can't flood Firestore.

import { addErrorReportDoc } from './firestoreData';

/* global __BUILD__ */
export const BUILD_ID = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';

const MAX_PER_PAGE = 10;
const REPEAT_MS = 5 * 60e3;
const ctx = { userId: '', view: '' };
const lastSent = new Map();
let sentCount = 0;

export function setErrorContext(patch) {
  Object.assign(ctx, patch);
}

// Extensions and the like — not our code, not worth a report.
function foreign(message, stack) {
  return /chrome-extension:|moz-extension:|safari-extension:|ResizeObserver loop/i.test(`${message}\n${stack}`);
}

export function reportError(error, kind = 'error', extra = {}) {
  try {
    if (!ctx.userId) return;
    const message = String((error && (error.message || error.reason)) || error || 'Unknown error').slice(0, 2000);
    const stack = String((error && error.stack) || '').slice(0, 6000) + (extra.componentStack ? `\nComponent stack:${String(extra.componentStack).slice(0, 1900)}` : '');
    if (foreign(message, stack)) return;
    const key = `${kind}|${message}`;
    const t = Date.now();
    if (t - (lastSent.get(key) || 0) < REPEAT_MS) return;
    if (sentCount >= MAX_PER_PAGE) return;
    lastSent.set(key, t);
    sentCount++;
    addErrorReportDoc({
      message, stack: stack.slice(0, 8000), kind: String(kind).slice(0, 40), build: BUILD_ID,
      view: String(ctx.view || '').slice(0, 80), userId: ctx.userId,
      url: String(window.location.pathname + window.location.search).slice(0, 300),
      userAgent: String(navigator.userAgent || '').slice(0, 300), at: new Date().toISOString()
    }).catch(() => {});
  } catch { /* never let reporting break the app */ }
}

let installed = false;
export function installErrorReporter() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    // Resource load errors (a missing image) have no error object — skip them.
    if (!e || (!e.error && !e.message)) return;
    reportError(e.error || { message: e.message, stack: `${e.filename || ''}:${e.lineno || ''}` }, 'window');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    reportError(r instanceof Error ? r : { message: typeof r === 'string' ? r : JSON.stringify(r ?? 'rejection') }, 'promise');
  });
}
