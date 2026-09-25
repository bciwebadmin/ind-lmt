// src/lib/attachments.js
// Upload / open / delete files in Firebase Storage. The file lives at
//   attachments/<ownerPath>/<id>-<name>
// and a small record of it ({ id, name, path, size, contentType, uploadedAt,
// uploadedBy, category? }) is kept in an `attachments` array on the Firestore
// document it belongs to — the lead, request or trade-in. Limits live in
// ./pipeline.js (checkAttachment) and are enforced again by storage.rules.

import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { app } from '../firebase';
import { attachmentContentType, safeFileName } from './pipeline';

const storage = getStorage(app);

const newId = () => `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export async function uploadAttachment(ownerPath, file, { uploadedBy, category } = {}) {
  const id = newId();
  const path = `attachments/${ownerPath}/${id}-${safeFileName(file.name)}`;
  const contentType = attachmentContentType(file);
  await uploadBytes(ref(storage, path), file, { contentType, customMetadata: { uploadedBy: uploadedBy || '' } });
  const rec = {
    id, name: file.name, path, size: file.size, contentType,
    uploadedAt: new Date().toISOString(), uploadedBy: uploadedBy || null
  };
  if (category) rec.category = category;
  return rec;
}

/** Upload several; returns the ones that made it and the names that failed. */
export async function uploadAttachments(ownerPath, files, opts) {
  const done = [];
  const failed = [];
  for (const f of files) {
    try { done.push(await uploadAttachment(ownerPath, f, opts)); }
    catch (e) { console.error('[attachments] upload failed:', f.name, e); failed.push(f.name); }
  }
  return { done, failed };
}

export function attachmentUrl(path) {
  return getDownloadURL(ref(storage, path));
}

export async function deleteAttachmentFile(path) {
  try {
    await deleteObject(ref(storage, path));
  } catch (e) {
    // Already gone is fine — the record is what's being removed.
    if (e && e.code !== 'storage/object-not-found') throw e;
  }
}
