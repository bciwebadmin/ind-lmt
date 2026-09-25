// src/lib/firestoreAuth.js
// Authentication layer using Firebase Auth.
// Replaces the prototype's plain-text password approach with real hashed credentials.

import { initializeApp, getApp, getApps, deleteApp } from 'firebase/app';
import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  getAuth
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, app, fns } from '../firebase';

export function watchAuthState(callback) {
  // callback receives the Firebase user object (with .uid, .email) or null
  return onAuthStateChanged(auth, (firebaseUser) => {
    callback(firebaseUser);
  });
}

export async function signInWithCredentials(email, password) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function signOutCurrent() {
  return fbSignOut(auth);
}

export async function registerNewUser(email, password) {
  // Used only by the admin-side "approve access request" flow.
  // For self-signup, prefer the access request → admin approval pattern.
  return createUserWithEmailAndPassword(auth, email.trim(), password);
}

export async function sendResetEmail(email) {
  // Lets users recover forgotten passwords without admin intervention
  return sendPasswordResetEmail(auth, email.trim());
}

export function getCurrentUserId() {
  return auth.currentUser?.uid || null;
}

export function getCurrentUserEmail() {
  return auth.currentUser?.email || null;
}

/**
 * Create a Firebase Auth user via a SECONDARY app instance so the admin's
 * own session is not affected. Without this, calling createUserWithEmailAndPassword
 * on the main auth instance would log the admin out and sign them in as the new user.
 *
 * Used by the "approve access request" flow.
 *
 * @returns {Promise<string>} The new user's Firebase UID
 */
export async function createUserOnSecondaryApp(email, password) {
  // Reuse existing config from the primary app
  const primaryConfig = app.options;

  // Initialize a secondary app (unique name) — or reuse if already present
  const SECONDARY_NAME = 'secondary-auth';
  const existing = getApps().find(a => a.name === SECONDARY_NAME);
  const secondaryApp = existing || initializeApp(primaryConfig, SECONDARY_NAME);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password);
    const newUid = cred.user.uid;

    // Sign the secondary auth out and tear down the secondary app so it doesn't
    // sit around holding the new user's session.
    await fbSignOut(secondaryAuth);
    await deleteApp(secondaryApp);

    return newUid;
  } catch (err) {
    // Best-effort cleanup on error
    try { await deleteApp(secondaryApp); } catch (_) {}
    throw err;
  }
}

/**
 * Send a welcome email to a newly-created user with their login credentials.
 * Calls the sendWelcomeEmail Cloud Function (which verifies the caller is an admin).
 *
 * Best-effort: throws on failure, but the caller should NOT roll back user creation —
 * the admin can share credentials manually if the email fails.
 */
/**
 * Fire-and-report the post-import digest. Recipients live in config on the server —
 * this only supplies the tally, so a caller can never redirect the mail.
 * Never throws: a failed notification must not make a successful import look failed.
 */
export async function sendImportSummaryEmailViaFunction({ imported, unassigned, branches }) {
  try {
    const fn = httpsCallable(fns, 'sendImportSummaryEmail');
    const res = await fn({ imported, unassigned, branches });
    return res?.data || { sent: false, reason: 'no-response' };
  } catch (e) {
    console.error('[import-summary] callable failed:', e);
    return { sent: false, reason: 'error' };
  }
}

/**
 * Email a submitted sales request to the order desk (Settings → Sales Request
 * recipients) and the rep. Only the lead id is sent: the server reads the lead,
 * and the request saved on it, from Firestore itself.
 *
 * Never throws — the lead has already moved to Sales Request by the time this
 * runs, and a failed email must not make that look like it failed too.
 */
export async function sendSalesRequestEmailViaFunction({ leadId }) {
  try {
    const fn = httpsCallable(fns, 'sendSalesRequestEmail');
    const res = await fn({ leadId });
    return res?.data || { sent: false, reason: 'no-response' };
  } catch (e) {
    console.error('[sales-request] callable failed:', e);
    return { sent: false, reason: 'error' };
  }
}

/**
 * Email a new request / trade-in evaluation / finance deal to whoever handles
 * it. kind is the collection: 'requests' | 'tradeIns' | 'finance'. Only the id
 * is sent; the server reads the record itself. Never throws — the record is
 * already saved when this runs.
 */
export async function sendRecordEmailViaFunction({ kind, id }) {
  try {
    const fn = httpsCallable(fns, 'sendRecordEmail');
    const res = await fn({ kind, id });
    return res?.data || { sent: false, reason: 'no-response' };
  } catch (e) {
    console.error(`[${kind}] callable failed:`, e);
    return { sent: false, reason: 'error' };
  }
}

export async function sendWelcomeEmailToUser({ email, name, password }) {
  const fn = httpsCallable(fns, 'sendWelcomeEmail');
  return fn({ email, name, password });
}

/**
 * Bulk-reassign all of one user's leads to another user.
 * Called before deleting a user or putting them on LOA.
 *
 * @param mode 'delete' (default) | 'loa' — recorded in lead history so
 *             returning-from-LOA can later identify which leads to restore.
 *
 * Returns: { ok: true, reassigned: number }
 */
export async function reassignUserLeadsViaFunction({ fromUserId, toUserId, deletedUserName, mode = 'delete' }) {
  const fn = httpsCallable(fns, 'reassignUserLeads');
  const result = await fn({ fromUserId, toUserId, deletedUserName, mode });
  return result.data;
}

/**
 * Restore a user's pre-leave leads when they return from LOA.
 * Finds leads with a 'loa'-mode bulk reassignment from this user that haven't
 * been moved elsewhere since, and moves them all back. Sends a welcome-back email.
 *
 * Returns: { ok: true, restored: number }
 */
export async function restoreLoaLeadsForUserViaFunction({ userId }) {
  const fn = httpsCallable(fns, 'restoreLoaLeadsForUser');
  const result = await fn({ userId });
  return result.data;
}

/**
 * Admin-triggered password reset for another user.
 * The Cloud Function generates a random password, updates Firebase Auth,
 * and emails the new password directly to the target user. The admin who
 * initiated the reset never sees the new password themselves.
 *
 * @param targetUid the Firestore doc id / Auth uid of the user to reset
 * Returns: { ok: true, emailSentTo: string }
 * Throws on failure (permission, network, email send failure). If email fails
 * but the password was successfully reset, the error message will contain
 * the new password so the admin can share it manually.
 */
export async function adminResetUserPasswordViaFunction({ targetUid }) {
  const fn = httpsCallable(fns, 'adminResetUserPassword');
  const result = await fn({ targetUid });
  return result.data;
}