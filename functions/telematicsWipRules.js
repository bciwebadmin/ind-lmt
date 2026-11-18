// Telematics step 4 — the WIP report and follow-ups. Pure (node's crypto
// only), tested in scripts/test-helpers.mjs. See CLAUDE.md → "Telematics".
//
// The daily WIP export (open work orders) is emailed to the LMT's private
// Resend receiving address. Resend posts an `email.received` webhook to
// telematicsWipInbound, which checks Resend's signature, downloads the CSV,
// and matches it: a work order on a "Sent to service" case's serial number,
// opened on or after the day Carter sent it, completes the case.
// telematicsFollowUps (hourly) bumps the destination + Carter when there is
// still no match, then escalates to Tanner.
//
// followUpSettings / followUpState are duplicated in src/lib/telematics.js
// for the board; a test fails if they drift.

const crypto = require('crypto');

/* ---------- Resend webhook signatures (Svix scheme) ----------
   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
   key            = base64-decode(secret without the "whsec_" prefix)
   signature      = base64(HMAC-SHA256(key, content)); the header holds one or
                    more space-separated "v1,<signature>" values.
   Timestamps more than 5 minutes off are refused (replays). */
function verifyResendSignature({ id, timestamp, signature, body, secret, now = Date.now(), toleranceSec = 300 }) {
  if (!id || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const s = String(secret).trim();
  let key;
  try { key = Buffer.from(s.startsWith('whsec_') ? s.slice(6) : s, 'base64'); } catch { return false; }
  if (!key.length) return false;
  const content = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''))]);
  const expected = crypto.createHmac('sha256', key).update(content).digest();
  return String(signature).split(' ').some(part => {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig) return false;
    let got;
    try { got = Buffer.from(sig, 'base64'); } catch { return false; }
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

/* ---------- CSV ---------- */
// RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

// "11/02/26" or "11/02/2026" → "2026-11-02".
function usDate(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return '';
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// Work order number prefix: M1–M6 look like the branch shops (the Sales
// Request location codes: M1 Indy, M2 Anderson, M3 Indy North,
// M4 Ellettsville, M6 Columbus); T* like field trucks. Unconfirmed (Tanner) —
// stored for information only, never required for a match.
const SHOP_PREFIX_BRANCH = { M1: 'Indy', M2: 'Anderson', M3: 'Indy North', M4: 'Ellettsville', M6: 'Columbus' };
function workOrderKind(order) {
  const o = String(order || '').toUpperCase();
  if (/^T\d/.test(o)) return 'field';
  if (/^M\d/.test(o)) return 'shop';
  return '';
}

// The WIP CSV → one entry per work order that has a serial number. Keeps only
// what matching needs — no customer names, contacts or dollar amounts.
// → { ok, reason?, workOrders: [{ order, openedOn, serial, model, kind, branch }], rows }
function parseWip(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { ok: false, reason: 'empty', workOrders: [], rows: 0 };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.includes(h));
  const iOrder = col('order#', 'order', 'order #', 'wo', 'work order');
  const iDate = col('ord date', 'order date', 'open date', 'opened');
  const iSerial = col('serial #', 'serial', 'serial number', 'serial#');
  const iModel = col('model num', 'model');
  if (iOrder < 0 || iDate < 0 || iSerial < 0) return { ok: false, reason: 'missing-columns', workOrders: [], rows: rows.length - 1 };
  const byOrder = new Map();
  for (const r of rows.slice(1)) {
    const order = String(r[iOrder] || '').trim().toUpperCase();
    const serial = String(r[iSerial] || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!order || !/^[A-Z0-9]{5,20}$/.test(serial)) continue;
    const key = `${order}|${serial}`;
    if (byOrder.has(key)) continue;
    const kind = workOrderKind(order);
    byOrder.set(key, {
      order, serial,
      openedOn: usDate(r[iDate]),
      model: iModel >= 0 ? String(r[iModel] || '').trim().slice(0, 40) : '',
      kind,
      branch: kind === 'shop' ? (SHOP_PREFIX_BRANCH[order.slice(0, 2)] || '') : ''
    });
  }
  return { ok: true, workOrders: [...byOrder.values()], rows: rows.length - 1 };
}

// The calendar day in Indianapolis, "YYYY-MM-DD".
function indyDate(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Indiana/Indianapolis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}

// A "Sent to service" Field / Shop case → the work order that completes it:
// same serial, opened on or after the day it was sent. Earliest wins.
function matchWorkOrder(c, workOrders = []) {
  if (!c || c.status !== 'sent') return null;
  const o = c.outcome || {};
  if (o.result !== 'won' || !['field', 'shop'].includes(o.tier) || !o.sentAt) return null;
  const serial = String(c.serial || '').toUpperCase();
  const sentDay = indyDate(o.sentAt);
  const hits = workOrders.filter(w => w.serial === serial && w.openedOn && w.openedOn >= sentDay)
    .sort((a, b) => a.openedOn.localeCompare(b.openedOn) || a.order.localeCompare(b.order));
  return hits[0] || null;
}

/* ---------- Follow-ups (bumps) ---------- */
// Settings → Telematics → Follow-ups. Every key may be absent.
const FOLLOW_UP_DEFAULTS = { fieldHours: 48, shopHours: 168, bumpEveryHours: 24, maxBumps: 3, wipStaleHours: 36 };
function followUpSettings(settings) {
  const f = (settings && settings.followUps) || {};
  const num = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
  return {
    fieldHours: num(f.fieldHours, FOLLOW_UP_DEFAULTS.fieldHours, 1, 24 * 60),
    shopHours: num(f.shopHours, FOLLOW_UP_DEFAULTS.shopHours, 1, 24 * 60),
    bumpEveryHours: num(f.bumpEveryHours, FOLLOW_UP_DEFAULTS.bumpEveryHours, 1, 24 * 30),
    maxBumps: Math.round(num(f.maxBumps, FOLLOW_UP_DEFAULTS.maxBumps, 0, 10)),
    wipStaleHours: num(f.wipStaleHours, FOLLOW_UP_DEFAULTS.wipStaleHours, 1, 24 * 14)
  };
}

// Where a case's follow-up stands. A bump (or the escalation) is only due once
// a WIP report received AFTER its deadline still shows no work order — so a
// late or broken WIP feed pauses bumps instead of nagging service wrongly.
// → { action: 'none' | 'wait' | 'waiting-for-wip' | 'bump' | 'escalate', dueAt, n }
function followUpState(c, settings, { wipReceivedAt = '', now = Date.now() } = {}) {
  const o = (c && c.outcome) || {};
  if (!c || c.status !== 'sent' || o.result !== 'won' || !['field', 'shop'].includes(o.tier) || !o.sentAt) return { action: 'none' };
  const cfg = followUpSettings(settings);
  const fu = c.followUp || {};
  if (fu.escalatedAt) return { action: 'none', escalated: true };
  const n = Number(fu.bumps) || 0;
  const H = 3600e3;
  const first = new Date(o.sentAt).getTime() + (o.tier === 'field' ? cfg.fieldHours : cfg.shopHours) * H;
  // Never sooner than one interval after the last reminder, so a case that
  // was already overdue (a late WIP, or go-live day) doesn't get them all at once.
  const sinceLast = fu.lastBumpAt ? new Date(fu.lastBumpAt).getTime() + cfg.bumpEveryHours * H : 0;
  const dueMs = Math.max(first + Math.min(n, cfg.maxBumps) * cfg.bumpEveryHours * H, n ? sinceLast : 0);
  const dueAt = new Date(dueMs).toISOString();
  const next = n < cfg.maxBumps ? { action: 'bump', n: n + 1 } : { action: 'escalate', n };
  if (now < dueMs) return { action: 'wait', dueAt, n };
  if (!wipReceivedAt || new Date(wipReceivedAt).getTime() < dueMs) return { action: 'waiting-for-wip', dueAt, n };
  return { ...next, dueAt };
}

module.exports = {
  verifyResendSignature, parseCsv, usDate, workOrderKind, parseWip, indyDate, matchWorkOrder,
  FOLLOW_UP_DEFAULTS, followUpSettings, followUpState, SHOP_PREFIX_BRANCH
};
