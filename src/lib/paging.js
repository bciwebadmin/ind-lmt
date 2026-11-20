// Paging for every list in the LMT (Erin, Nov 2026): never more than 50 rows
// on screen at once. Pure — tested in scripts/test-helpers.mjs. The React
// side is usePaged() + PaginationControls in App.jsx.

export const MAX_PAGE_SIZE = 50;
export const PAGE_SIZE_OPTIONS = [25, 50];
export const DEFAULT_PAGE_SIZE = 50;

// A stored or chosen page size → one we allow. Anything above the cap (an old
// saved 100 / 200) comes back as 50.
export function clampPageSize(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_PAGE_SIZE;
  if (v >= MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return PAGE_SIZE_OPTIONS.filter(o => o <= v).pop() || PAGE_SIZE_OPTIONS[0];
}

export function pageCount(total, size) {
  return Math.max(1, Math.ceil((Number(total) || 0) / clampPageSize(size)));
}

// 1-based, always inside 1…pageCount.
export function clampPage(page, total, size) {
  const p = Math.floor(Number(page) || 1);
  return Math.min(Math.max(1, p), pageCount(total, size));
}

// The rows on that page.
export function pageOf(list = [], page = 1, size = DEFAULT_PAGE_SIZE) {
  const s = clampPageSize(size);
  const p = clampPage(page, list.length, s);
  return list.slice((p - 1) * s, p * s);
}

// The page a row at `index` is on (for opening a linked record).
export function pageContaining(index, size = DEFAULT_PAGE_SIZE) {
  const i = Number(index);
  if (!Number.isFinite(i) || i < 0) return 1;
  return Math.floor(i / clampPageSize(size)) + 1;
}
