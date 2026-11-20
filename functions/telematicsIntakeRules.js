// Telematics email intake — pure rules, no Firebase (tested in
// scripts/test-helpers.mjs against a made-up copy of a real Bobcat email).
//
// Bobcat's "Critical Fault Code" emails reach the web admin inbox, and a Zap
// posts each one (subject + HTML body) to the telematicsIntake function. The
// email is read HERE, not in Zapier: a change in Bobcat's layout then fails a
// test or logs a [telematics-intake] error (→ self-repair), instead of
// silently filling cases with blanks — Tanner's Power Automate scrape broke on
// ~15% of rows that way.
//
// The layout (Nov 2026 samples): labelled lines in sections —
//   Asset Information     Serial Number, Inventory Status, Model, Hours,
//                         Location: <city> (<lat>, <lng>)
//   Customer Information  Retail Customer, Telephone (optional), Address
//   Owner Account         (optional) Owner Account: <name>, then contact, email
//   Fault Information     Start Date, Primary Code: CRITICAL - M0217, Summary,
//                         Other Active Fault Codes: (lines), Code / Description /
//                         Possible Cause (sometimes)
//   Service Information   Planned Maintenance End Date / End Hours
//   Servicing Dealer      AR Number, Name: BRIGHT EQUIPMENT INC. BOBCAT OF INDY NORTH
//
// Service Due (Nov 19, Erin): "<n> Hr Service Due - <customer> - <serial> -
// <model>". Same sections minus Fault Information; Service Information holds
//   PM End Date, PM End Hours, Next Maintenance Interval: 1500,
//   Event Date: Nov 18, 2026 01:12 PM (CST), Kit Number: 7402488 (may be blank)
// and Customer / Owner Account may be missing altogether.
//
// Both arrive forwarded ("Fw: …" with the forwarder's signature and a
// From / Sent / To / Subject header above Bobcat's text). That preamble lands
// before the first section heading and is ignored.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', reg: '®', copy: '©', deg: '°', trade: '™', ndash: '–', mdash: '—' };

function htmlToText(html) {
  return String(html || '')
    .replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|ul|ol)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ');
}

const SECTIONS = ['Asset Information', 'Customer Information', 'Owner Account', 'Fault Information',
  'Service Information', 'Servicing Dealer Information', 'Action Items', 'Questions?'];

// { section name → lines }. A heading is a line that is exactly the name
// ("Owner Account" heading vs the "Owner Account: X" field line).
function sectionsOf(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const out = { _all: lines };
  let cur = '_pre';
  for (const l of lines) {
    const h = SECTIONS.find(s => l.toLowerCase() === s.toLowerCase());
    if (h) { cur = h; out[cur] = out[cur] || []; continue; }
    (out[cur] = out[cur] || []).push(l);
  }
  return out;
}

const LABEL_RE = /^([A-Za-z][A-Za-z /?-]{1,40}):\s*(.*)$/;
function field(lines = [], label) {
  const want = label.toLowerCase();
  for (const l of lines) {
    const m = l.match(LABEL_RE);
    if (m && m[1].trim().toLowerCase() === want) return m[2].trim();
  }
  return '';
}

// The text after `label:` up to the next of `stops` (multi-line blocks).
function block(lines = [], label, stops = []) {
  const i = lines.findIndex(l => l.toLowerCase().startsWith(label.toLowerCase() + ':'));
  if (i < 0) return '';
  const out = [lines[i].slice(label.length + 1).trim()];
  for (let j = i + 1; j < lines.length; j++) {
    if (stops.some(s => lines[j].toLowerCase().startsWith(s.toLowerCase()))) break;
    out.push(lines[j]);
  }
  return out.join('\n').replace(/^[\s|]+|[\s|]+$/g, '').replace(/\n?\s*\|\s*\n?/g, '\n').trim();
}

const blankish = (v) => !v || /^(invalid date|undefined|null|n\/a|-)$/i.test(String(v).trim());
const clean = (v, max = 300) => (blankish(v) ? '' : String(v).trim().slice(0, max));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Nov 11, 2026 04:35 PM (CST)" → ISO. US zones Bobcat uses; unknown → as UTC.
const TZ = { CST: -6, CDT: -5, EST: -5, EDT: -4, MST: -7, MDT: -6, PST: -8, PDT: -7, UTC: 0, GMT: 0 };
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseBobcatDate(s) {
  const m = String(s || '').match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})\s*(AM|PM)?\s*(?:\(([A-Z]{2,4})\))?/i);
  if (!m) return '';
  const mon = MONTHS[m[1].toLowerCase()];
  if (mon === undefined) return '';
  let h = Number(m[4]) % 12;
  if ((m[6] || '').toUpperCase() === 'PM') h += 12;
  if (!m[6]) h = Number(m[4]);
  const off = TZ[(m[7] || 'UTC').toUpperCase()] ?? 0;
  const t = Date.UTC(Number(m[3]), mon, Number(m[2]), h - off, Number(m[5]));
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

// "CRITICAL - M0217" → { severity, code }; "WARNING - E00009714 - Water in Fuel" → + summary.
function parseCodeLine(s) {
  const m = String(s || '').trim().match(/^([A-Za-z]+)\s*-\s*([A-Za-z0-9][A-Za-z0-9-]*?)(?:\s+-\s+(.*))?$/);
  if (!m) return null;
  return { severity: m[1].toUpperCase(), code: m[2].toUpperCase(), summary: (m[3] || '').trim() };
}

// The servicing dealer → one of the LMT's branches. The name carries it
// ("… BOBCAT OF INDY NORTH"); longest branch first so Indy North isn't Indy.
// Known AR numbers are a fallback for an oddly-named email.
const KNOWN_AR = { '2000007726': 'Indy', '2000008174': 'Indy North', '2000008159': 'Anderson', '2000007727': 'Ellettsville', '2000007728': 'Columbus' };
function branchFromDealer({ ar = '', name = '' } = {}, branches = []) {
  const n = String(name).toUpperCase().replace(/\s+/g, ' ');
  const byLength = [...branches].sort((a, b) => b.length - a.length);
  const hit = byLength.find(b => n.includes(`BOBCAT OF ${String(b).toUpperCase()}`));
  if (hit) return hit;
  const k = KNOWN_AR[String(ar).trim()];
  return k && branches.includes(k) ? k : '';
}

function looksLikeFaultEmail(subject, text) {
  return /fault code/i.test(String(subject || '')) || /reported a (critical )?fault code/i.test(String(text || '')) || /^Primary Code:/im.test(String(text || ''));
}

function looksLikeServiceEmail(subject, text) {
  return /\bHr Service Due\b/i.test(String(subject || '')) || /coming due for service/i.test(String(text || '')) || /^Next Maintenance Interval:/im.test(String(text || ''));
}

// The parts both emails share: machine, customer, owner, location, dealer.
function commonParts(S, branches) {
  const asset = S['Asset Information'] || [];
  const cust = S['Customer Information'] || [];
  const owner = S['Owner Account'] || [];
  const dealer = S['Servicing Dealer Information'] || [];
  const serial = clean(field(asset, 'Serial Number'), 30).toUpperCase().replace(/\s+/g, '');
  const locRaw = field(asset, 'Location');
  const lm = locRaw.match(/^(.*?)\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*$/);
  const lat = lm ? Number(lm[2]) : null, lng = lm ? Number(lm[3]) : null;
  const okCoord = lm && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  const hoursRaw = field(asset, 'Hours');
  const hours = /^\d+(\.\d+)?$/.test(hoursRaw) ? Number(hoursRaw) : null;

  // Owner Account: name on the field line, then a contact line and an email.
  const ownerName = clean(field(owner, 'Owner Account'), 200);
  const ownerRest = owner.filter(l => !/^Owner Account:/i.test(l));
  const ownerEmail = ownerRest.find(l => EMAIL_RE.test(l)) || '';
  const ownerContact = ownerRest.find(l => !EMAIL_RE.test(l) && !LABEL_RE.test(l)) || '';
  const dealerName = clean(field(dealer, 'Name'), 200);
  const dealerAr = clean(field(dealer, 'AR Number'), 20);
  return {
    serial,
    model: clean(field(asset, 'Model'), 40),
    hours,
    inventoryStatus: clean(field(asset, 'Inventory Status'), 60),
    customer: {
      name: clean(field(cust, 'Retail Customer'), 200),
      phone: clean(field(cust, 'Telephone'), 40),
      address: clean(field(cust, 'Address'), 300),
      ownerAccount: ownerName,
      ownerContact: clean(ownerContact, 120),
      ownerEmail: clean(ownerEmail, 254)
    },
    location: {
      city: clean(lm ? lm[1] : locRaw, 120).replace(/\s+US$/, ''),
      lat: okCoord ? lat : null,
      lng: okCoord ? lng : null
    },
    dealer: { ar: dealerAr, name: dealerName },
    branch: branchFromDealer({ ar: dealerAr, name: dealerName }, branches)
  };
}

const stripFw = (subject) => String(subject || '').replace(/&amp;/gi, '&').replace(/^\s*((fw|fwd|re):\s*)+/i, '').trim();

// → { ok: true, alert } | { ok: false, reason }
// reason: 'not-a-fault-email' (skip quietly) | 'unreadable' (Bobcat changed the layout).
function parseFaultEmail({ subject = '', html = '', text = '' } = {}, branches = []) {
  const body = html ? htmlToText(html) : String(text || '');
  if (!looksLikeFaultEmail(subject, body)) return { ok: false, reason: 'not-a-fault-email' };
  const S = sectionsOf(body);
  const fault = S['Fault Information'] || [];
  const svc = S['Service Information'] || [];
  const base = commonParts(S, branches);
  const serial = base.serial;
  const primary = parseCodeLine(field(fault, 'Primary Code'));
  if (!/^[A-Z0-9]{5,20}$/.test(serial) || !primary) {
    return { ok: false, reason: 'unreadable', detail: !serial ? 'no serial number' : 'no primary code' };
  }

  // "Other Active Fault Codes:" — one code per line after the label.
  const otherCodes = [];
  const oi = fault.findIndex(l => /^Other Active Fault Codes:/i.test(l));
  if (oi >= 0) {
    for (let j = oi + 1; j < fault.length; j++) {
      const c = parseCodeLine(fault[j]);
      if (!c) break;
      if (!(c.code === primary.code && c.severity === primary.severity)) otherCodes.push(c);
    }
  }

  const sm = stripFw(subject).match(/^Critical Fault Code - (.+) - (.+) - (.+)$/i);

  return {
    ok: true,
    alert: {
      ...base,
      kind: 'fault',
      model: base.model || (sm ? sm[3].trim() : ''),
      customer: { ...base.customer, name: base.customer.name || (sm ? sm[1].trim() : '') },
      fault: {
        severity: primary.severity,
        code: primary.code,
        summary: clean(field(fault, 'Summary'), 200) || primary.summary || (sm ? sm[2].trim() : ''),
        startAt: parseBobcatDate(field(fault, 'Start Date')),
        otherCodes: otherCodes.slice(0, 20),
        description: clean(block(fault, 'Description', ['Possible Cause:', 'Conditions for Code:', 'This guide']), 3000),
        possibleCause: clean(block(fault, 'Possible Cause', ['Conditions for Code:', 'Conditions for Clearing Code:', 'This guide']), 3000)
      },
      planned: {
        endDate: clean(field(svc, 'End Date'), 40),
        endHours: clean(field(svc, 'End Hours'), 20)
      }
    }
  };
}

// A "Service Due" email → { ok, alert } with alert.service instead of .fault.
function parseServiceEmail({ subject = '', html = '', text = '' } = {}, branches = []) {
  const body = html ? htmlToText(html) : String(text || '');
  if (!looksLikeServiceEmail(subject, body)) return { ok: false, reason: 'not-a-service-email' };
  const S = sectionsOf(body);
  const svc = S['Service Information'] || [];
  const base = commonParts(S, branches);
  // "1500 Hr Service Due - JAY CREW LANDSCAPE INC. - b4sb49895 - T66"; the customer part is sometimes missing.
  const sub = stripFw(subject);
  const sm = sub.match(/^(\d+)\s*Hr Service Due\s*-\s*(.+)$/i);
  const parts = sm ? sm[2].split(' - ').map(x => x.trim()) : [];
  const subModel = parts.length >= 2 ? parts[parts.length - 1] : '';
  const subSerial = parts.length >= 2 ? parts[parts.length - 2].toUpperCase().replace(/\s+/g, '') : '';
  const subCustomer = parts.length >= 3 ? parts.slice(0, -2).join(' - ') : '';
  const serial = base.serial || (/^[A-Z0-9]{5,20}$/.test(subSerial) ? subSerial : '');
  const intRaw = field(svc, 'Next Maintenance Interval') || (sm ? sm[1] : '');
  const interval = /^\d{2,6}$/.test(String(intRaw).trim()) ? Number(intRaw) : null;
  if (!/^[A-Z0-9]{5,20}$/.test(serial) || !interval) {
    return { ok: false, reason: 'unreadable', detail: !serial ? 'no serial number' : 'no maintenance interval' };
  }
  const kit = clean(field(svc, 'Kit Number'), 40);
  return {
    ok: true,
    alert: {
      ...base,
      kind: 'service',
      serial,
      model: base.model || subModel,
      customer: { ...base.customer, name: base.customer.name || subCustomer },
      service: {
        interval,
        dueAt: parseBobcatDate(field(svc, 'Event Date')),
        kitNumber: /^[A-Z0-9-]{3,40}$/i.test(kit) ? kit : '',
        pmEndDate: clean(field(svc, 'PM End Date'), 40),
        pmEndHours: clean(field(svc, 'PM End Hours'), 20)
      }
    }
  };
}

// Either kind of Bobcat email. → { ok, alert } | { ok: false, reason: 'not-bobcat' | 'unreadable', type?, detail? }
function parseBobcatEmail(msg = {}, branches = []) {
  const f = parseFaultEmail(msg, branches);
  if (f.ok || f.reason === 'unreadable') return { ...f, type: 'fault' };
  const s = parseServiceEmail(msg, branches);
  if (s.ok || s.reason === 'unreadable') return { ...s, type: 'service' };
  return { ok: false, reason: 'not-bobcat' };
}

const caseKindOf = (c) => (c && c.kind === 'service' ? 'service' : 'fault');

// Which existing case a new alert belongs to: the machine's open case, or
// — for a code the list keeps off the board — the auto-closed case already
// logging that same code. Otherwise null (start a new case).
const OPEN = ['new', 'working', 'sent'];
// Fault and service cases never share: a service reminder on a machine with
// an open fault case gets its own case on Service Due, and vice versa.
function caseForAlert(cases = [], alert) {
  const kind = alert.kind === 'service' ? 'service' : 'fault';
  const mine = cases.filter(c => c && caseKindOf(c) === kind && String(c.serial || '').toUpperCase() === alert.serial)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (kind === 'service') return mine.find(c => OPEN.includes(c.status || 'new')) || null;
  return mine.find(c => OPEN.includes(c.status || 'new'))
    || mine.find(c => c.status === 'closed' && c.closure && c.closure.auto && c.fault && c.fault.code === alert.fault.code)
    || null;
}

/* ---------- Repeat codes (Nov 20, Erin) ----------
   A Non-critical / Ignore code sent for the same serial `count` times within
   `days` days moves the case to Critical. Counted across all of the machine's
   fault cases (by when each alert arrived), this email included. Different
   machines are never combined, even for the same customer.
   REPEAT_DEFAULTS / repeatSettings are copies of src/lib/telematics.js. */
const REPEAT_DEFAULTS = { count: 3, days: 3 };
function repeatSettings(settings) {
  const r = (settings && settings.repeat) || {};
  const num = (v, d, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : d; };
  return { count: num(r.count, REPEAT_DEFAULTS.count, 2, 20), days: num(r.days, REPEAT_DEFAULTS.days, 1, 60) };
}

// → null, or { count, days, code, level, seen, at } to store as case.repeatCritical.
function repeatCritical({ cases = [], alert, level, now, settings } = {}) {
  if (!alert || alert.kind === 'service' || !alert.fault) return null;
  if (level !== 'noncritical' && level !== 'ignore') return null;
  const cfg = repeatSettings(settings);
  const nowMs = new Date(now).getTime();
  const since = nowMs - cfg.days * 864e5;
  const code = String(alert.fault.code || '').toUpperCase();
  const serial = String(alert.serial || '').toUpperCase();
  let seen = 1;   // this email
  for (const c of cases) {
    if (!c || caseKindOf(c) !== 'fault' || String(c.serial || '').toUpperCase() !== serial) continue;
    for (const a of (Array.isArray(c.alerts) ? c.alerts : [])) {
      const t = new Date(a && a.at).getTime();
      if (String((a && a.code) || '').toUpperCase() === code && Number.isFinite(t) && t >= since && t <= nowMs) seen++;
    }
  }
  return seen >= cfg.count ? { count: cfg.count, days: cfg.days, code, level, seen, at: now } : null;
}

const LEVEL_WORD = { noncritical: 'Non-critical', ignore: 'Ignore' };
function repeatNoteText(rc) {
  return `Moved to Critical: Bobcat sent ${rc.code} for this machine ${rc.seen} times in ${rc.days} day${rc.days === 1 ? '' : 's'}. `
    + `On the Code List it's ${LEVEL_WORD[rc.level] || rc.level} — it's critical here because it keeps repeating.`;
}

// Already seen this exact email (Zapier retries)?
function isDuplicateMessage(cases = [], messageId) {
  if (!messageId) return false;
  return cases.some(c => (c.intake && c.intake.messageId === messageId)
    || (Array.isArray(c.alerts) && c.alerts.some(a => a.messageId === messageId)));
}

// Every new fault case starts in New, whatever its Code List level — Carter
// sorts through them (Erin, Nov 19; until then Non-critical / Ignore codes
// were filed straight into the Archive). The level is stored as `codeLevel`
// and colours the row; the board's level filter hides what he doesn't want.
// Old auto-archived cases (closure.auto) keep working: repeats still log there.

// A service-due email → a new case on Service Due (always New; there is no
// Code List for these).
function newServiceCaseFromAlert(alert, { now, messageId = '', receivedAt = '' } = {}) {
  const at = now || new Date().toISOString();
  const { dealer, branch, ...rest } = alert;
  return {
    ...rest,
    kind: 'service',
    source: 'email',
    status: 'new',
    branch: branch || '',
    dealer,
    alertCount: 1, lastAlertAt: at,
    alerts: [{ at, interval: alert.service.interval, dueAt: alert.service.dueAt, messageId }],
    intake: { messageId, receivedAt: receivedAt || at },
    notes: [],
    history: [{ id: `h_${at}_intake`, type: 'created', at, by: '', source: 'email', kind: 'service' }],
    createdAt: at, createdBy: 'intake', updatedAt: at
  };
}

// One line for a service case: "1500 hr service".
function serviceLabel(c) {
  const n = c && c.service && c.service.interval;
  return n ? `${n} hr service` : 'Service';
}

function newCaseFromAlert(alert, { level = 'critical', now, messageId = '', receivedAt = '' } = {}) {
  if (alert && alert.kind === 'service') return newServiceCaseFromAlert(alert, { now, messageId, receivedAt });
  const at = now || new Date().toISOString();
  const { dealer, planned, branch, ...rest } = alert;
  return {
    ...rest,
    kind: 'fault',
    source: 'email',
    status: 'new',
    codeLevel: level,
    branch: branch || '',
    dealer, planned,
    alertCount: 1, lastAlertAt: at,
    alerts: [{ at, code: alert.fault.code, summary: alert.fault.summary, startAt: alert.fault.startAt, messageId }],
    intake: { messageId, receivedAt: receivedAt || at },
    notes: [],
    history: [{ id: `h_${at}_intake`, type: 'created', at, by: '', source: 'email' }],
    createdAt: at, createdBy: 'intake', updatedAt: at
  };
}

module.exports = {
  htmlToText, sectionsOf, parseBobcatDate, parseCodeLine, branchFromDealer, looksLikeFaultEmail,
  looksLikeServiceEmail, parseFaultEmail, parseServiceEmail, parseBobcatEmail, caseKindOf, serviceLabel,
  caseForAlert, isDuplicateMessage, newCaseFromAlert, newServiceCaseFromAlert, KNOWN_AR,
  REPEAT_DEFAULTS, repeatSettings, repeatCritical, repeatNoteText
};
