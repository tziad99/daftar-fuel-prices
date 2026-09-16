// Fetches the current UAE fuel prices from IPT Energy's public prices page and updates
// fuel-prices.json in this repo — the same file Daftar already reads via FUEL_PRICE_JSON_URL.
//
// Safety design: every parsed value is checked against a plausible absolute range AND
// against how much it changed from the currently-committed value. If anything looks wrong
// (page structure changed, a value came back garbled, etc.), the script exits with an error
// and commits NOTHING — a stale-but-correct price is safer than a silently wrong one.
//
// Assumes this runs on/after the 1st of the month (once IPT has published that month's
// prices) — the "month" label is taken from the run date, not scraped from the page.

const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://www.ipt-energy.com/uae/fuel-prices';
const OUTPUT_PATH = path.join(__dirname, 'fuel-prices.json');
const PLAUSIBLE_MIN = 1.0;   // AED/L — well below any realistic UAE price
const PLAUSIBLE_MAX = 8.0;   // AED/L — well above any realistic UAE price
const MAX_CHANGE_PCT = 0.30; // reject a parse that swings more than 30% from last known value

const FUEL_LABELS = {
  super98:   'Super 98',
  special95: 'Special 95',
  eplus91:   'E-plus 91',
  diesel:    'Diesel',
};

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function parsePrice(text, label) {
  const re = new RegExp(label.replace('-', '[-\\s]?') + '\\s*([\\d.]+)\\s*AED', 'i');
  const m = text.match(re);
  return m ? parseFloat(m[1]) : null;
}

function validate(key, newVal, prevVal) {
  if (newVal === null || isNaN(newVal)) {
    return { ok: false, reason: `${key}: could not find/parse a value on the page` };
  }
  if (newVal < PLAUSIBLE_MIN || newVal > PLAUSIBLE_MAX) {
    return { ok: false, reason: `${key}: parsed value ${newVal} is outside the plausible range (${PLAUSIBLE_MIN}-${PLAUSIBLE_MAX} AED/L)` };
  }
  if (typeof prevVal === 'number' && prevVal > 0) {
    const pctChange = Math.abs(newVal - prevVal) / prevVal;
    if (pctChange > MAX_CHANGE_PCT) {
      return { ok: false, reason: `${key}: ${prevVal} -> ${newVal} is a ${(pctChange*100).toFixed(0)}% change, over the ${MAX_CHANGE_PCT*100}% sanity threshold — likely a bad parse, not a real price move` };
    }
  }
  return { ok: true };
}

function monthLabel(date) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

async function main() {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    console.error(`Fetch failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const html = await res.text();
  const text = stripHtml(html);

  const current = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));

  const parsed = {};
  const errors = [];
  for (const [key, label] of Object.entries(FUEL_LABELS)) {
    const val = parsePrice(text, label);
    const check = validate(key, val, current[key]);
    if (!check.ok) errors.push(check.reason);
    parsed[key] = val;
  }

  if (errors.length) {
    console.error('Validation failed — nothing was changed:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  const unchanged = FUEL_LABELS && Object.keys(FUEL_LABELS).every(k => parsed[k] === current[k]);
  if (unchanged) {
    console.log('Prices unchanged from what is already committed — nothing to do.');
    return;
  }

  const updated = { ...parsed, month: monthLabel(new Date()) };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(updated, null, 2) + '\n');
  console.log('Updated fuel-prices.json:', JSON.stringify(updated));
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
