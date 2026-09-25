// Global search (the box in the top bar). Pure, so scripts/test-helpers.mjs
// can import it. The caller passes only what the user may see.

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const digits = (s) => String(s ?? '').replace(/\D/g, '');

export function tokenize(q) {
  return norm(q).split(/\s+/).map(t => t.trim()).filter(Boolean);
}

// Every token must appear somewhere. A token of 3+ digits also matches phone
// numbers however they're formatted ("3175550104" finds "317-555-0104").
function matches(tokens, text, digitText) {
  return tokens.every(t => text.includes(t) || (/^\d{3,}$/.test(digits(t)) && digitText.includes(digits(t))));
}

// Lower is better: a name that starts with the query beats a match in the email.
function rank(tokens, primary) {
  const p = norm(primary);
  const q = tokens.join(' ');
  if (p === q) return 0;
  if (p.startsWith(q)) return 1;
  if (p.split(/\s+/).some(w => w.startsWith(tokens[0]))) return 2;
  return 3;
}

function run(items, q, fieldsOf, primaryOf, dateOf, limit) {
  const tokens = tokenize(q);
  if (!tokens.length) return [];
  const out = [];
  for (const it of items || []) {
    const parts = fieldsOf(it).filter(v => v !== undefined && v !== null && v !== '');
    const text = norm(parts.join(' \u0001 '));
    if (!matches(tokens, text, digits(parts.join(' ')))) continue;
    out.push({ item: it, score: rank(tokens, primaryOf(it) || ''), date: dateOf(it) || '' });
  }
  out.sort((a, b) => a.score - b.score || String(b.date).localeCompare(String(a.date)));
  return out.slice(0, limit).map(x => x.item);
}

export function searchLeads(leads, q, limit = 8) {
  return run(leads, q,
    (l) => [l.customerName, l.companyName, l.contactEmail, l.phone, l.zip, l.branch,
            l.deal && l.deal.model, l.salesRequest && l.salesRequest.customerName],
    (l) => l.customerName || l.companyName,
    (l) => l.createdDate || l.dateSubmitted,
    limit);
}

export function searchRequests(requests, q, limit = 4) {
  return run(requests, q,
    (r) => [r.customerName, r.customerAddress, r.equipmentRequest, r.serviceOrderNumber, r.fromLocation, r.toLocation, ...(r.requestTypes || [])],
    (r) => r.customerName,
    (r) => r.createdAt,
    limit);
}

export function searchTradeIns(tradeIns, q, limit = 4) {
  return run(tradeIns, q,
    (t) => [t.customerName, t.make, t.model, t.year, t.serial],
    (t) => t.customerName,
    (t) => t.createdAt,
    limit);
}

export function searchFinance(deals, q, limit = 4) {
  return run(deals, q,
    (d) => [d.customerName, d.assetToFinance, d.admin && d.admin.lenderName, d.admin && d.admin.bcOrderNumber, d.preludeNumber, d.orderNumber],
    (d) => d.customerName,
    (d) => d.createdAt,
    limit);
}

// Leads a record belongs to also match through the record: searching a serial
// number finds the trade-in, and the trade-in links back to its lead.
export function searchAll({ leads = [], requests = [], tradeIns = [], finance = [] }, q) {
  return {
    leads: searchLeads(leads, q),
    requests: searchRequests(requests, q),
    tradeIns: searchTradeIns(tradeIns, q),
    finance: searchFinance(finance, q),
  };
}
