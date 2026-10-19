/* Currency: a foreign price in rupees at its own day's rate (Frankfurter, else fawazahmed0's exchange-api through
   jsDelivr for what the central banks do not publish), kept in this browser so a past day is asked for only once. */
const test = require('node:test');
const assert = require('node:assert');
const FX = require('../fx.js');

const mem = () => { const m = {}; return {getItem: k=>k in m ? m[k] : null, setItem: (k, v)=>{ m[k] = String(v); }, m}; };
const res = (status, body) => ({ok: status >= 200 && status < 300, status, json: async ()=>body});
const NOW = new Date('2026-10-19T10:00:00+05:30').getTime();

test('a price as typed: amount and currency (codes, symbols, local words)', ()=>{
  const p = (t, f) => { const r = FX.parse(t, f); return r && r.amount + ' ' + r.currency; };
  assert.equal(p('150 AED'), '150 AED'); assert.equal(p('AED 150'), '150 AED'); assert.equal(p('2k dhs'), '2000 AED');
  assert.equal(p('$20'), '20 USD'); assert.equal(p('s$20'), '20 SGD'); assert.equal(p('€ 15.50'), '15.5 EUR');
  assert.equal(p('1,234 THB'), '1234 THB'); assert.equal(p('₫50,000'), '50000 VND'); assert.equal(p('Rs.500'), '500 INR');
  assert.equal(p('about 150 for mom'), null, 'no currency: not guessed'); assert.equal(p('150', 'aed'), '150 AED', 'the city\'s currency when given');
  assert.equal(p('nothing'), null); assert.equal(p(''), null);
});

test('the rate of the expense\'s own day from Frankfurter, cached: a past day is never asked again', async ()=>{
  const store = mem(); FX.useStore(store); const urls = [];
  const fetch = async u => { urls.push(u); return res(200, [{date: '2026-10-14', base: 'USD', quote: 'INR', rate: 95.15}]); };
  const r = await FX.toINR(20, 'USD', '2026-10-14', {fetch, now: NOW});
  assert.equal(r.inr, 1903); assert.equal(r.source, 'Frankfurter'); assert.equal(r.date, '2026-10-14');
  assert.match(urls[0], /^https:\/\/api\.frankfurter\.dev\/v2\/rates\?base=USD&quotes=INR&date=2026-10-14$/);
  await FX.toINR(5, 'USD', '2026-10-14', {fetch, now: NOW + 30 * 864e5});
  assert.equal(urls.length, 1, 'from the cache');
  assert.equal((await FX.toINR(100, 'INR', '2026-10-14', {fetch, now: NOW})).inr, 100); assert.equal(urls.length, 1, 'rupees need no rate');
});

test('a currency Frankfurter lacks comes from exchange-api on jsDelivr (that day, else the day before)', async ()=>{
  FX.useStore(mem()); const urls = [];
  const fetch = async u => { urls.push(u);
    if(/frankfurter/.test(u)) return res(422, {message: 'invalid currency'});
    if(/@2026-10-19\//.test(u)) return res(404, {});
    return res(200, {date: '2026-10-18', aed: {inr: 25.9}}); };
  const r = await FX.toINR(150, 'AED', '2026-10-25', {fetch, now: NOW});
  assert.equal(r.source, 'exchange-api'); assert.equal(r.inr, 3885); assert.equal(r.date, '2026-10-18');
  assert.match(urls[1], /cdn\.jsdelivr\.net\/npm\/@fawazahmed0\/currency-api@2026-10-19\/v1\/currencies\/aed\.min\.json/, 'a future date uses today');
  assert.match(urls[2], /@2026-10-18\//);
});

test('today\'s rate is asked again after 6 hours; offline, the last known one is used; nothing known is an error', async ()=>{
  FX.useStore(mem()); let n = 0, up = true;
  const fetch = async () => { n++; if(!up) throw new Error('offline'); return res(200, [{date: '2026-10-19', quote: 'INR', rate: 25.9}]); };
  await FX.rate('AED', 'INR', '', {fetch, now: NOW}); await FX.rate('AED', 'INR', '', {fetch, now: NOW + 3600e3}); assert.equal(n, 1);
  up = false; const r = await FX.rate('AED', 'INR', '', {fetch, now: NOW + 7 * 3600e3});
  assert.equal(r.rate, 25.9); assert.equal(r.stale, true);
  await assert.rejects(FX.rate('VND', 'INR', '2026-10-01', {fetch, now: NOW}), /No exchange rate for VND/);
  await assert.rejects(FX.rate('dollars', 'INR'), /Not a currency/);
});
