"use strict";
/* =========================================================
   FX — a foreign price in rupees, at the rate of its own day (no key, straight from this browser):
   · Frankfurter (api.frankfurter.dev/v2: central-bank rates, history back to 1999),
   · else fawazahmed0's exchange-api through jsDelivr (dated files: every currency, AED, VND… included).
   Rates are kept in this browser: a past day's rate never changes, so it is asked for once; today's is
   asked again after 6 hours. A day that is not over yet (or a future date) uses today's rate.
     FX.parse('150 AED') -> {amount: 150, currency: 'AED'}      FX.toINR(150, 'AED', '2026-10-14') -> {inr, rate, date, source}
   ========================================================= */
const FX = (function(){
  const KEY = 'tripvault-fx', TODAY_TTL = 6 * 3600 * 1000;
  const FRANKFURTER = 'https://api.frankfurter.dev/v2/rates';
  const FAWAZ = d => 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@' + d + '/v1/currencies/';
  let store = null;                                             // this browser's localStorage (tests: useStore)
  const st = () => { if(store) return store; try{ return typeof window !== 'undefined' ? window.localStorage : null; }catch(e){ return null; } };
  const load = () => { try{ const s = st(); return JSON.parse((s && s.getItem(KEY)) || '{}') || {}; }catch(e){ return {}; } };
  const keep = c => { try{ const s = st(); if(s) s.setItem(KEY, JSON.stringify(c)); }catch(e){} };
  const useStore = s => { store = s; };

  /* "AED 150", "150 dhs", "$20", "€ 15.50", "1,234 THB", "Rs 500" -> {amount, currency}; null when there is no price */
  const SYMBOL = {'$': 'USD', 'us$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'rs': 'INR', 'rs.': 'INR', 'inr': 'INR', '฿': 'THB', '₫': 'VND', 's$': 'SGD', 'a$': 'AUD', 'c$': 'CAD', 'hk$': 'HKD', 'rm': 'MYR', '₩': 'KRW', 'dhs': 'AED', 'dh': 'AED', 'dirham': 'AED', 'dirhams': 'AED', 'aed': 'AED', 'baht': 'THB', 'dong': 'VND', 'yen': 'JPY', 'euro': 'EUR', 'euros': 'EUR', 'rupees': 'INR', 'riyal': 'SAR', 'riyals': 'SAR', 'sar': 'SAR', 'qr': 'QAR', 'rp': 'IDR', 'lkr': 'LKR', 'npr': 'NPR'};
  const ISO = new Set(('USD EUR GBP JPY CNY AED SAR QAR OMR KWD BHD THB VND SGD MYR IDR PHP LKR NPR BDT PKR MVR AUD NZD CAD CHF HKD KRW TWD ' +
    'TRY EGP ZAR KES MXN BRL ARS CLP COP PEN RUB SEK NOK DKK ISK PLN CZK HUF RON BGN ILS JOD GEL AZN KZT UZS MNT KHR LAK MMK MUR SCR FJD INR').split(' '));
  function parse(text, fallback){
    const s = String(text || '').trim().toLowerCase();
    const m = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k\b)?/.exec(s);
    if(!m) return null;
    const amount = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
    if(!isFinite(amount) || amount <= 0) return null;
    const rest = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    const syms = Object.keys(SYMBOL).filter(k=>!/^[a-z]+$/.test(k)).sort((a, b)=>b.length - a.length);
    let cur = '';
    for(const w of rest.split(/[\s/,()~≈-]+/).filter(Boolean)){
      if(SYMBOL[w]){ cur = SYMBOL[w]; break; }
      if(ISO.has(w.toUpperCase())){ cur = w.toUpperCase(); break; }
      const sym = syms.find(k=>w.startsWith(k) || w.endsWith(k));
      if(sym){ cur = SYMBOL[sym]; break; }
    }
    cur = cur || String(fallback || '').toUpperCase();
    return cur ? {amount, currency: cur} : null;
  }

  const iso = d => { const x = d instanceof Date ? d : new Date(d || Date.now()); return isNaN(x) ? '' : x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const dayBefore = d => iso(new Date(new Date(d + 'T12:00:00').getTime() - 864e5));

  async function getJson(url, fetchFn){
    const r = await fetchFn(url, {cache: 'default'});
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  async function frankfurter(from, to, date, fetchFn){
    const d = await getJson(FRANKFURTER + '?base=' + from + '&quotes=' + to + '&date=' + date, fetchFn);
    const x = Array.isArray(d) ? d.find(r=>r && r.quote === to) : null;
    if(!x || !(x.rate > 0)) throw new Error('no rate');
    return {rate: +x.rate, date: x.date || date, source: 'Frankfurter'};
  }
  async function fawaz(from, to, date, fetchFn){
    // a day's file appears after that day; today's may not be there yet, so the day before is tried too
    for(const d of [date, dayBefore(date)]){
      try{ const j = await getJson(FAWAZ(d) + from.toLowerCase() + '.min.json', fetchFn);
        const v = j && j[from.toLowerCase()] && j[from.toLowerCase()][to.toLowerCase()];
        if(v > 0) return {rate: +v, date: j.date || d, source: 'exchange-api'}; }catch(e){}
    }
    throw new Error('no rate');
  }

  /* 1 <from> in <to> on that day -> {rate, date, source} (date: the day the rate is of) */
  const asking = {};
  async function rate(from, to, date, o){
    o = o || {};
    from = String(from || '').toUpperCase(); to = String(to || 'INR').toUpperCase();
    if(!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw new Error('Not a currency: ' + from);
    const today = iso(o.now || Date.now());
    let day = iso(date || today); if(!day || day > today) day = today;
    if(from === to) return {rate: 1, date: day, source: ''};
    const k = from + '>' + to + '@' + day, cache = load(), hit = cache[k], now = +(o.now || Date.now());
    if(hit && hit.rate > 0 && (day < today || now - hit.at < TODAY_TTL)) return {rate: hit.rate, date: hit.date, source: hit.source};
    if(asking[k]) return asking[k];
    const fetchFn = o.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    asking[k] = (async ()=>{
      let r;
      try{ r = await frankfurter(from, to, day, fetchFn); }
      catch(e){ try{ r = await fawaz(from, to, day, fetchFn); }
        catch(e2){ if(hit && hit.rate > 0) return {rate: hit.rate, date: hit.date, source: hit.source, stale: true};   // offline: the last one known
          throw new Error('No exchange rate for ' + from + ' (offline?)'); } }
      const c = load(); c[k] = Object.assign({}, r, {at: now});
      // a small cache: the newest 400 rates
      const keys = Object.keys(c); if(keys.length > 400) keys.sort((a, b)=>(c[a].at || 0) - (c[b].at || 0)).slice(0, keys.length - 400).forEach(x=>delete c[x]);
      keep(c);
      return r;
    })().finally(()=>{ delete asking[k]; });
    return asking[k];
  }
  async function toINR(amount, currency, date, o){
    const r = await rate(currency, 'INR', date, o);
    return Object.assign({inr: Math.round(amount * r.rate * 100) / 100}, r);
  }
  const fmtINR = n => '₹' + Math.round(n).toLocaleString('en-IN');
  return {parse, rate, toINR, fmtINR, iso, KEY, useStore};
})();
if(typeof module !== 'undefined') module.exports = FX;
