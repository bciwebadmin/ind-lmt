// src/lib/firestoreData.js
// Data access layer for the CRM. Each function returns a promise (writes)
// or accepts a callback subscription (reads). The App component sets up
// onSnapshot subscriptions once on mount and the rest is automatic.

import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  onSnapshot, query, orderBy, writeBatch, getDocs, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { db } from '../firebase';

/* ===================== LEADS ===================== */

export function subscribeToLeads(callback) {
  const q = query(collection(db, 'leads'), orderBy('createdDate', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error('subscribeToLeads error:', err);
  });
}

export async function addLeadDoc(leadShape) {
  // leadShape should NOT contain an `id` field — Firestore generates it
  const ref = await addDoc(collection(db, 'leads'), leadShape);
  return ref.id;
}

export async function updateLeadDoc(id, patch) {
  // patch is a partial Firestore update — only included fields are modified
  await updateDoc(doc(db, 'leads', id), patch);
}

export async function deleteLeadDoc(id) {
  await deleteDoc(doc(db, 'leads', id));
}

export async function bulkImportLeads(leadShapes) {
  // Firestore allows up to 500 ops per batch
  const CHUNK = 450;
  for (let i = 0; i < leadShapes.length; i += CHUNK) {
    const batch = writeBatch(db);
    const slice = leadShapes.slice(i, i + CHUNK);
    slice.forEach(shape => {
      const ref = doc(collection(db, 'leads'));
      batch.set(ref, shape);
    });
    await batch.commit();
  }
}

export async function clearAllLeads() {
  // Used by Settings → Danger Zone. Deletes leads in batches.
  const snap = await getDocs(collection(db, 'leads'));
  const CHUNK = 450;
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

// Delete a specific list of leads by ID. Used by the Archived Leads "Clear All"
// flow — passes in only the archived IDs so we don't recompute the archival
// rule server-side.
export async function bulkDeleteLeads(ids) {
  if (!ids || ids.length === 0) return;
  const CHUNK = 450;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = writeBatch(db);
    ids.slice(i, i + CHUNK).forEach(id => batch.delete(doc(db, 'leads', id)));
    await batch.commit();
  }
}

/* ===================== CONFIG ===================== */

// Stored as a single document `config/app` for simplicity.
// Contains: statuses, branches, sources, scoringRules, staleness, duplicateDetection
const CONFIG_DOC = doc(db, 'config', 'app');

export function subscribeToConfig(callback) {
  return onSnapshot(CONFIG_DOC, (snap) => {
    callback(snap.exists() ? snap.data() : {});
  });
}

export async function saveConfigDoc(patch) {
  // Uses setDoc with merge so it creates the doc on first write
  await setDoc(CONFIG_DOC, patch, { merge: true });
}

/* ===================== USERS ===================== */

export function subscribeToUsers(callback) {
  return onSnapshot(collection(db, 'users'), (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function saveUserDoc(userId, data) {
  // Use setDoc so it creates if missing
  await setDoc(doc(db, 'users', userId), data, { merge: true });
}

export async function deleteUserDoc(userId) {
  if (userId === 'u_1') throw new Error('Cannot delete system user');
  await deleteDoc(doc(db, 'users', userId));
}

/* ===================== ACCESS REQUESTS ===================== */

export function subscribeToAccessRequests(callback) {
  const q = query(collection(db, 'accessRequests'), orderBy('requestedAt', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function addAccessRequestDoc(shape) {
  // shape: { name, email, reason, requestedAt }
  // NOTE: No password here — admin creates the auth user on approval (via Cloud Function)
  const ref = await addDoc(collection(db, 'accessRequests'), shape);
  return ref.id;
}

export async function deleteAccessRequestDoc(requestId) {
  await deleteDoc(doc(db, 'accessRequests', requestId));
}

/* ===================== INDY RECORDS: requests, trade-ins, finance ===================== */
// Three collections that hang off leads but can also stand alone, so they are
// not fields on the lead:
//   requests — delivery / get-ready / demo / parts / pick-up / service requests
//   tradeIns — trade-in evaluations awaiting a sales manager's value
//   finance  — the finance team's funding tracker (Indy's Sales Tracker)
// All share one shape convention: leadId (or null), salesPerson, status fields,
// createdAt, createdBy, history[]. Field lists live in ./pipeline.js.
export const RECORD_COLLECTIONS = ['requests', 'tradeIns', 'finance'];

export function subscribeToRecords(collectionName, callback) {
  const q = query(collection(db, collectionName), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error(`subscribe ${collectionName} error:`, err);
  });
}

export async function addRecordDoc(collectionName, shape) {
  const ref = await addDoc(collection(db, collectionName), shape);
  return ref.id;
}

export async function updateRecordDoc(collectionName, id, patch) {
  await updateDoc(doc(db, collectionName, id), patch);
}

/* ===================== ATTACHMENT LISTS ===================== */
// Add or remove entries in a document's `attachments` array atomically, so two
// people adding files to the same lead at once can't overwrite each other.
// collectionName: 'leads' | 'requests' | 'tradeIns'.
export async function addAttachmentRecords(collectionName, id, records) {
  if (!records || !records.length) return;
  await updateDoc(doc(db, collectionName, id), { attachments: arrayUnion(...records) });
}

export async function removeAttachmentRecord(collectionName, id, record) {
  await updateDoc(doc(db, collectionName, id), { attachments: arrayRemove(record) });
}
