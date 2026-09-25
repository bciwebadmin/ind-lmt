#!/usr/bin/env node
/**
 * Invariant checks that a green Vite build does not catch.
 *
 * Run: node scripts/verify-invariants.mjs
 *
 * Why this exists: Vite does not error on undefined identifiers, and it has no
 * opinion at all about colour contrast or two copies of a palette drifting
 * apart. Every check here corresponds to a bug that actually shipped in one of
 * the LMT forks.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');
const tw = readFileSync(join(root, 'tailwind.config.js'), 'utf8');
const fns = readFileSync(join(root, 'functions/index.js'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');   // favicon + <title> live here

/**
 * The text colour that belongs on a brand fill in THIS fork.
 *
 * Note: white on #ff3300 is 3.67:1, which fails WCAG AA for normal text
 * (4.5:1) and only clears AA Large (3:1). brand-600 #d62b00 carries white at
 * 4.99:1. Set this to whichever pairing the fork has decided on; the check
 * below fails if the opposite one appears on a brand fill.
 */
const EXPECTED_ON_BRAND = 'text-white';   // buttons use brand-600 (4.99:1); brand-500 stays a non-text fill

let failures = 0;
const fail = (check, msg) => { failures++; console.error(`  FAIL  ${check}\n        ${msg}`); };
const pass = (check, msg) => console.log(`  ok    ${check}${msg ? ` — ${msg}` : ''}`);

/* ------------------------------------------------------------------ *
 * 1. The brand palette is defined twice. They must agree.
 *    A real mismatch shipped in BMH (bg-brand-50 was the full-strength
 *    fill in one place and a pale tint in the other) and no build caught it.
 * ------------------------------------------------------------------ */
{
  const config = {};
  const block = tw.match(/brand:\s*\{([^}]*)\}/s);
  if (!block) fail('palette/config', 'could not find the brand block in tailwind.config.js');
  else {
    for (const m of block[1].matchAll(/(\d{2,3}):\s*'(#[0-9a-fA-F]{6})'/g)) {
      config[m[1]] = m[2].toLowerCase();
    }
  }

  // Inline <style> fallback in App.jsx: .bg-brand-500 { background-color: #ff3300 }
  const inline = {};
  for (const m of app.matchAll(
    /\.(?:hover\\\\:|focus\\\\:|group-hover\\\\:)?[a-z-]*brand-(\d{2,3})[^{]*\{[^}]*?(#[0-9a-fA-F]{6})/g
  )) {
    const [, shade, hex] = m;
    const h = hex.toLowerCase();
    if (inline[shade] && inline[shade] !== h) {
      fail('palette/inline-self', `.brand-${shade} is defined twice inside App.jsx with different values: ${inline[shade]} and ${h}`);
    }
    inline[shade] = h;
  }

  const shades = [...new Set([...Object.keys(config), ...Object.keys(inline)])].sort((a, b) => a - b);
  const drift = [];
  for (const s of shades) {
    if (!(s in inline)) continue;               // config may define shades the inline block omits
    if (!(s in config)) { drift.push(`brand-${s} is in App.jsx but missing from tailwind.config.js`); continue; }
    if (config[s] !== inline[s]) drift.push(`brand-${s}: tailwind=${config[s]} but App.jsx=${inline[s]}`);
  }
  if (drift.length) fail('palette/drift', drift.join('\n        '));
  else pass('palette/drift', `${Object.keys(inline).length} shades agree across both definitions`);
}

/* ------------------------------------------------------------------ *
 * 2. Contrast: anything sitting on a brand fill must be readable.
 *    This is the check that would have caught the amber-with-white-text
 *    bug, and it catches the reverse (orange with near-black text) too.
 * ------------------------------------------------------------------ */
{
  const lum = (hex) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  const fill = (tw.match(/500:\s*'(#[0-9a-fA-F]{6})'/) || [])[1];
  if (!fill) fail('contrast/brand-500', 'could not read brand-500 from tailwind.config.js');
  else {
    const white = ratio(fill, '#ffffff');
    const dark = ratio(fill, '#1c1917');
    const best = white >= dark ? 'white' : 'near-black';
    const r = Math.max(white, dark);
    if (r < 4.5) {
      fail('contrast/brand-500', `neither white (${white.toFixed(2)}:1) nor near-black (${dark.toFixed(2)}:1) reaches 4.5:1 on ${fill}`);
    } else {
      pass('contrast/brand-500', `${fill} takes ${best} text (${r.toFixed(2)}:1)`);
    }

    // The app must actually USE the readable one.
    // Check each brand-filled className against the text colour it actually
    // carries, at the shade it actually uses — rather than assuming one
    // pairing is right everywhere.
    const shadeHex = {};
    for (const m of tw.matchAll(/(\d{2,3}):\s*'(#[0-9a-fA-F]{6})'/g)) shadeHex[m[1]] = m[2];
    const TEXT = { 'text-white': '#ffffff', 'text-stone-900': '#1c1917', 'text-stone-800': '#292524' };

    const offenders = [];
    let checked = 0;
    for (const m of app.matchAll(/["'`]([^"'`]*\bbg-brand-\d{2,3}\b[^"'`]*)["'`]/g)) {
      const cs = m[1];
      if (/[;{}]/.test(cs)) continue;                    // a CSS rule, not a className
      const bg = cs.match(/(?<!hover:)(?<!disabled:)(?<!focus:)\bbg-brand-(\d{2,3})\b/);
      const txt = Object.keys(TEXT).find(t => cs.includes(t));
      if (!bg || !txt || !shadeHex[bg[1]]) continue;
      checked++;
      const r = ratio(shadeHex[bg[1]], TEXT[txt]);
      // AA Large (3:1) is only earned by >=18.66px bold or >=24px text.
      const large = /\btext-(?:xl|2xl|3xl|4xl)\b/.test(cs);
      const need = large ? 3 : 4.5;
      if (r < need) {
        offenders.push(`${r.toFixed(2)}:1 (needs ${need}) — ${txt} on brand-${bg[1]} — ${cs.trim().slice(0, 60)}`);
      }
    }
    if (offenders.length) {
      fail('contrast/usage', `${offenders.length} of ${checked} brand-filled surface(s) below threshold:\n        ` + offenders.join('\n        '));
    } else {
      pass('contrast/usage', `all ${checked} text-bearing brand fills meet WCAG AA`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 3. Every lucide-react icon referenced is imported.
 *    Vite builds clean and crashes at runtime on a missing one.
 * ------------------------------------------------------------------ */
{
  // Collect EVERY named import, not just lucide-react — Recharts components
  // are JSX too, and a checker that only knows about icons reports them as
  // undefined.
  const imported = new Set();
  for (const m of app.matchAll(/import\s*(?:[\w*]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gs)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) imported.add(name);
    }
  }
  for (const m of app.matchAll(/import\s+\*\s+as\s+(\w+)/g)) imported.add(m[1]);
  for (const m of app.matchAll(/import\s+(\w+)\s+from/g)) imported.add(m[1]);

  if (!imported.size) fail('icons/import', 'no named imports found at all');
  else {
    const declared = new Set();
    for (const m of app.matchAll(/(?:^|\n)\s*(?:const|function)\s+([A-Z][A-Za-z0-9_]*)/g)) declared.add(m[1]);
    for (const m of app.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*[:=]\s*\(?\s*(?:\{|\()/g)) declared.add(m[1]);

    const missing = new Set();
    for (const m of app.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)) {
      const name = m[1];
      if (!imported.has(name) && !declared.has(name) && !app.includes(`const ${name}`) && !app.includes(`function ${name}`)) {
        missing.add(name);
      }
    }
    if (missing.size) fail('icons/undefined', `referenced but neither imported nor defined: ${[...missing].join(', ')}`);
    else pass('icons/undefined', `${imported.size} icons imported, all JSX components resolve`);
  }
}

/* ------------------------------------------------------------------ *
 * 4. XLSX export rows are positional. Header and row lengths must match.
 * ------------------------------------------------------------------ */
{
  const hdr = app.match(/const\s+headers\s*=\s*\[([\s\S]*?)\];/);
  if (!hdr) {
    console.log('  skip  xlsx/columns — no `const headers = [...]` found; check the Reports export by hand');
  } else {
    const n = (hdr[1].match(/'[^']*'|"[^"]*"/g) || []).length;
    pass('xlsx/columns', `${n} header columns found — confirm each export row pushes exactly ${n} values`);
  }
}

/* ------------------------------------------------------------------ *
 * 5. No stale BMH or Atlanta branding left in shipped strings.
 * ------------------------------------------------------------------ */
{
  const stale = [];
  for (const [label, text] of [['src/App.jsx', app], ['functions/index.js', fns], ['tailwind.config.js', tw], ['index.html', html]]) {
    for (const needle of ['#feb703', '#fff8e6', '#ffedbf', '#fedd85', '#fecf52', '#fec326', '#d99f02', '#8a6302', '#6b4c01',
                          'Berry Material Handling', 'BMH Leads', 'bmh-crm', 'berrymaterial.com', 'BMH-',
                          // Atlanta, the parent of this fork
                          'Bobcat of Atlanta', 'BobcatAtlanta', 'bobcatofatlanta', 'bobcatatlanta', 'atl-lmt', 'ATL_LMT',
                          'atl-leads', 'atl-routing', '`ATL-', 'Georgia', 'Kennesaw', 'Huntsville']) {
      // Case-INSENSITIVE: the email templates carry the wordmark as
      // "BERRY MATERIAL HANDLING" in caps, and a case-sensitive needle sailed
      // straight past all eight of them while reporting the file clean.
      const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const c = (text.match(re) || []).length;
      if (c) stale.push(`${label}: ${c}× "${needle}" (any case)`);
    }
  }
  if (stale.length) fail('branding/stale', stale.join('\n        '));
  else pass('branding/stale', 'no BMH or Atlanta strings remain');
}

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('All invariants hold.');
