// Password rules for the browser. Pure — tested in scripts/test-helpers.mjs.
// passwordProblem is a copy of functions/passwordRules.js (the server checks
// again); a test fails if the two drift.

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// '' when OK, otherwise the message to show.
export function passwordProblem(pw) {
  const s = typeof pw === 'string' ? pw : '';
  if (!s) return 'Enter a password.';
  if (s.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (s.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  if (/^\s|\s$/.test(s)) return 'Password can\'t start or end with a space.';
  return '';
}

// The "Choose a new password" screen after an admin reset.
// → '' when OK, otherwise the message to show.
export function newPasswordProblem({ current, next, confirm }) {
  if (!current) return 'Enter the temporary password you signed in with.';
  const p = passwordProblem(next);
  if (p) return p;
  if (next !== confirm) return 'The new passwords don\'t match.';
  if (next === current) return 'Choose a password different from the temporary one.';
  return '';
}

// Firebase Auth error code → a message for the change-password screen.
export function changePasswordError(code = '') {
  if (/wrong-password|invalid-credential|invalid-login/.test(code)) return 'The temporary password is incorrect.';
  if (/weak-password/.test(code)) return 'That password is too weak. Try a longer one.';
  if (/too-many-requests/.test(code)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/network/.test(code)) return 'No connection. Check your internet and try again.';
  return 'Could not change your password. Please try again.';
}
