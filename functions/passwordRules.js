// Password resets (Nov 2026). Pure, tested in scripts/test-helpers.mjs.
// See CLAUDE.md → "Password resets".
//
// passwordProblem is duplicated in src/lib/password.js for the browser; a
// test fails if the two drift.

// Rules for a password an admin sets, or one a user chooses after a reset.
// Firebase's own minimum is 6; new passwords here need 8.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
function passwordProblem(pw) {
  const s = typeof pw === 'string' ? pw : '';
  if (!s) return 'Enter a password.';
  if (s.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (s.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  if (/^\s|\s$/.test(s)) return 'Password can\'t start or end with a space.';
  return '';
}

// "  Erin@Example.COM " → "erin@example.com"; anything that isn't an email → ''.
function normalizeEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

// "Forgot password?" throttle, per email address: at most one email a minute
// and five an hour. `prev` is the stored doc ({ times: [ms, …] }) or null.
// → { allowed, next } — store `next` only when allowed.
const RESET_MIN_GAP_MS = 60e3;
const RESET_MAX_PER_HOUR = 5;
function resetRateDecision(prev, now = Date.now()) {
  const hourAgo = now - 3600e3;
  const recent = ((prev && Array.isArray(prev.times)) ? prev.times : [])
    .map(Number).filter(t => Number.isFinite(t) && t > hourAgo && t <= now)
    .sort((a, b) => a - b);
  const last = recent[recent.length - 1] || 0;
  if (recent.length >= RESET_MAX_PER_HOUR || (last && now - last < RESET_MIN_GAP_MS)) {
    return { allowed: false, next: null };
  }
  return { allowed: true, next: { times: [...recent, now], updatedAt: new Date(now).toISOString() } };
}

module.exports = {
  PASSWORD_MIN, PASSWORD_MAX, passwordProblem, normalizeEmail,
  RESET_MIN_GAP_MS, RESET_MAX_PER_HOUR, resetRateDecision
};
