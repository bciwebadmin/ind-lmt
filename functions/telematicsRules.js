// Telematics hand-off rules for the server — pure, no Firebase (tested in
// scripts/test-helpers.mjs). The client's copies live in src/lib/telematics.js;
// a test fails if WIN_TIERS, resolveRecipients or mapsUrl drift apart.
// The server resolves recipients itself from telematicsConfig/settings, so a
// browser can't choose who the email goes to.

const WIN_TIERS = [
  { id: 'field', label: 'Field Service',   destKind: 'field',   needsWorkOrder: true  },
  { id: 'shop',  label: 'Shop (in-house)', destKind: 'service', needsWorkOrder: true  },
  { id: 'parts', label: 'Parts',           destKind: 'parts',   needsWorkOrder: false }
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail = (e) => EMAIL_RE.test(String(e || '').trim());

function resolveRecipients(dest) {
  const seen = new Set();
  const pick = (list) => (Array.isArray(list) ? list : [])
    .map(r => String((r && r.email) || '').trim())
    .filter(e => {
      const k = e.toLowerCase();
      if (!isEmail(e) || seen.has(k)) return false;
      seen.add(k); return true;
    });
  let to = pick(dest && dest.to);
  let cc = pick(dest && dest.cc);
  let promotedCc = false;
  if (!to.length && cc.length) { to = cc; cc = []; promotedCc = true; }
  return { to, cc, promotedCc };
}

function mapsUrl(lat, lng) {
  const a = Number(lat), b = Number(lng);
  if (lat === '' || lng === '' || lat == null || lng == null || !isFinite(a) || !isFinite(b)) return '';
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return '';
  return `https://www.google.com/maps/search/?api=1&query=${a},${b}`;
}

const assetUrl = (serial) => serial
  ? `https://dealer.bobcat.com/dmiq/AssetDetails/${encodeURIComponent(String(serial).trim().toLowerCase())}`
  : '';

// May this user send a hand-off? Same model as src/lib/access.js.
function canUseTelematics(user) {
  return !!user && (user.role === 'admin' || user.telematicsAccess === true);
}

// What a send is allowed to act on: a won case with a destination.
function handoffError(c) {
  if (!c) return 'Case not found.';
  const o = c.outcome || {};
  if (o.result !== 'won' || !o.destinationId) return 'This case hasn’t been won to a destination.';
  if (!WIN_TIERS.some(t => t.id === o.tier)) return 'Unknown win tier.';
  return '';
}

// "Field Service — FOXY LNDSCP LLC — T770 T4 AT6330022 — M0217 Hydraulic Filter Plugged"
function handoffSubject(c) {
  const tier = WIN_TIERS.find(t => t.id === (c.outcome && c.outcome.tier));
  const machine = [c.model, c.serial].filter(Boolean).join(' ');
  const fault = [c.fault && c.fault.code, c.fault && c.fault.summary].filter(Boolean).join(' ');
  return ['Telematics: ' + (tier ? tier.label : 'Hand-off'), c.customer && c.customer.name, machine, fault]
    .filter(Boolean).join(' — ').slice(0, 180);
}

module.exports = { WIN_TIERS, isEmail, resolveRecipients, mapsUrl, assetUrl, canUseTelematics, handoffError, handoffSubject };
