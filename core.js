"use strict";
/* =========================================================
   CORE — the saved data, the page shell, sign-in, settings and sync.
   Data lives in this browser (IndexedDB): the trips, documents' details,
   itineraries and memories in one record, each file in its own. Sync copies
   both, encrypted, to private GitHub Gists so the phone sees what the laptop has.
   ========================================================= */

/* ---------------------------------------------------------------- small helpers */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = p => (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function fmtDate(iso, withDow){
  if(!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return iso || '';
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return (withDow ? DOW[d.getDay()] + ', ' : '') + d.getDate() + ' ' + MON[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
}
const fmtRange = (a, b) => a && b ? (a === b ? fmtDate(a) : fmtDate(a) + ' – ' + fmtDate(b)) : fmtDate(a || b);
function ago(ts){
  const s = Math.round((Date.now() - ts) / 1000);
  if(s < 60) return 'just now'; if(s < 3600) return Math.round(s / 60) + ' min ago'; if(s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
const daysUntil = iso => Math.round((Date.parse(iso + 'T00:00:00') - Date.parse(todayISO() + 'T00:00:00')) / 86400000);
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const mapsLink = (q, city) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([q, city].filter(Boolean).join(', '));
function toast(msg, kind){
  const t = $('toast');
  t.textContent = msg; t.className = 'toast show ' + (kind || '');
  clearTimeout(toast.t); toast.t = setTimeout(()=>{ t.className = 'toast'; }, kind === 'error' ? 6000 : 3000);
}
function icon(name){
  const P = {
    plane: '<path d="M2 16l20-8-20-8 4 8-4 8z" transform="rotate(-30 12 8) translate(0 4)"/>',
    doc: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/>',
    map: '<path d="M9 3L3 6v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15M15 6v15"/>',
    news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
    photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-5-5-9 9"/>',
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
    check: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 13l2 2 4-4"/>',
    apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    sync: '<path d="M21 12a9 9 0 01-15.5 6.2M3 12A9 9 0 0118.5 5.8"/><path d="M21 4v5h-5M3 20v-5h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>', down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>', camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/>',
    refresh: '<path d="M20 11A8 8 0 104 13"/><path d="M20 4v7h-7"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    download: '<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  };
  return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';
}

/* ---------------------------------------------------------------- the saved data */
const Store = (function(){
  let dbp = null;
  function db(){
    if(dbp) return dbp;
    dbp = new Promise((res, rej)=>{
      const r = indexedDB.open('trip-vault', 1);
      r.onupgradeneeded = ()=>{ const d = r.result; if(!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); if(!d.objectStoreNames.contains('files')) d.createObjectStore('files'); };
      r.onsuccess = ()=>res(r.result); r.onerror = ()=>rej(r.error);
    });
    return dbp;
  }
  async function op(store, mode, fn){
    const d = await db();
    return new Promise((res, rej)=>{
      const tx = d.transaction(store, mode), st = tx.objectStore(store);
      const r = fn(st);
      tx.oncomplete = ()=>res(r && 'result' in r ? r.result : undefined);
      tx.onerror = ()=>rej(tx.error); tx.onabort = ()=>rej(tx.error || new Error('Storage full?'));
    });
  }
  return {
    get: k => op('kv', 'readonly', s=>s.get(k)),
    put: (k, v) => op('kv', 'readwrite', s=>s.put(v, k)),
    getFile: id => op('files', 'readonly', s=>s.get(id)),
    putFile: (id, v) => op('files', 'readwrite', s=>s.put(v, id)),
    delFile: id => op('files', 'readwrite', s=>s.delete(id)),
    fileIds: () => op('files', 'readonly', s=>s.getAllKeys()),
  };
})();

const EMPTY = () => ({v: 1, people: [], trips: [], docs: [], plans: {}, memories: [], flightsExtra: [], deleted: {}, checks: {},
  settings: {readerMode: 'builtin-ai', flightKeys: {}, rules: {}, lastTrip: ''}});
let S = EMPTY();
/* What syncs (everything but this device's keys and caches). */
const LOCAL = {flightStatus: {}, news: {}};

async function load(){
  const s = await Store.get('state');
  S = Object.assign(EMPTY(), s || {});
  S.settings = Object.assign(EMPTY().settings, S.settings || {});
  const l = await Store.get('local');
  Object.assign(LOCAL, l || {});
}
let saveTimer = null;
function save(opts){
  (opts && opts.quiet) || Cloud.markSaved();
  S.savedAt = Date.now();
  return Store.put('state', S).then(()=>{
    if(!(opts && opts.noSync)){ clearTimeout(saveTimer); saveTimer = setTimeout(()=>autoSync(), 4000); }
  }).catch(e=>toast('Could not save: ' + e.message, 'error'));
}
const saveLocal = () => Store.put('local', LOCAL).catch(()=>{});
const touch = o => { o.updatedAt = Date.now(); return o; };
function remove(listName, id){
  S[listName] = S[listName].filter(x=>x.id !== id);
  S.deleted[id] = Date.now();
}

/* Two devices' data -> one. Newest edit of each trip/document/memory/plan wins; deletions stick. */
function mergeData(mine, theirs){
  const out = JSON.parse(JSON.stringify(mine));
  out.deleted = Object.assign({}, theirs.deleted || {}, mine.deleted || {});
  ['people', 'trips', 'docs', 'memories', 'flightsExtra'].forEach(k=>{
    const by = {};
    (theirs[k] || []).concat(mine[k] || []).forEach(x=>{ if(!by[x.id] || (x.updatedAt || 0) >= (by[x.id].updatedAt || 0)) by[x.id] = x; });
    out[k] = Object.values(by).filter(x=>!out.deleted[x.id] || (x.updatedAt || 0) > out.deleted[x.id]);
  });
  out.plans = Object.assign({}, theirs.plans || {});
  Object.entries(mine.plans || {}).forEach(([k, p])=>{ if(!out.plans[k] || (p.updatedAt || 0) >= (out.plans[k].updatedAt || 0)) out.plans[k] = p; });
  Object.keys(out.plans).forEach(k=>{ if(out.deleted[k] && out.deleted[k] >= (out.plans[k].updatedAt || 0)) delete out.plans[k]; });   // a plan made again later stays
  // each trip's checklist (ticks and its own items): the newer one
  out.checks = Object.assign({}, theirs.checks || {});
  Object.entries(mine.checks || {}).forEach(([k, c])=>{ if(!out.checks[k] || (c.updatedAt || 0) >= (out.checks[k].updatedAt || 0)) out.checks[k] = c; });
  // settings: this device's, but keys either device has are kept (this device's win)
  const ms = mine.settings || {}, ts = theirs.settings || {};
  out.settings = Object.assign({}, ts, ms);
  out.settings.flightKeys = Object.assign({}, ts.flightKeys || {}, Object.fromEntries(Object.entries(ms.flightKeys || {}).filter(([, v])=>v)));
  if(ms.sharedAi || ts.sharedAi) out.settings.sharedAi = Object.assign({}, ts.sharedAi || {}, ms.sharedAi || {},
    {keys: Object.assign({}, (ts.sharedAi || {}).keys || {}, (ms.sharedAi || {}).keys || {})});
  return out;
}

/* ---------------------------------------------------------------- sync */
let syncing = false;
async function autoSync(manual){
  if(!Cloud.syncConfig() || syncing) return;
  syncing = true; setSyncBadge('busy');
  try{
    await pushFiles();
    // your AI and flight keys travel with the data (encrypted), so the phone needs no setup; switch off in Settings
    if(S.settings.shareKeys !== false){
      const ai = Cloud.shareableAi();
      if(Object.keys(ai.keys).length && JSON.stringify(ai) !== JSON.stringify(S.settings.sharedAi || null)){ S.settings.sharedAi = ai; Cloud.markSaved(); await Store.put('state', S); }
    } else if(S.settings.sharedAi){ delete S.settings.sharedAi; Cloud.markSaved(); await Store.put('state', S); }
    // documents kept on this device only never leave it: not sent, and kept when the other device's data comes in
    const shared = () => Object.assign({}, S, {docs: S.docs.filter(d=>!d.localOnly)});
    const result = await Cloud.syncNow(shared, async data=>{
      const keep = S.settings, theirs = data.settings || {};
      const mineOnly = S.docs.filter(d=>d.localOnly);
      S = Object.assign(EMPTY(), data);
      S.docs = S.docs.filter(d=>!mineOnly.some(m=>m.id === d.id)).concat(mineOnly);
      // this device's own choices win; keys it does not have come from the other device
      const fk = Object.assign({}, theirs.flightKeys || {});
      Object.entries(keep.flightKeys || {}).forEach(([k, v])=>{ if(v) fk[k] = v; });
      S.settings = Object.assign({}, EMPTY().settings, theirs, {flightKeys: fk, lastTrip: keep.lastTrip, readerMode: keep.readerMode || theirs.readerMode});
      Cloud.takeSyncedAi(theirs.shareKeys === false ? null : theirs.sharedAi);
      await Store.put('state', S);
      render();
    }, (mine, theirs)=>mergeData(Object.assign({}, mine, {docs: (mine.docs || []).filter(d=>!d.localOnly)}), theirs));
    setSyncBadge('ok');
    if(result === 'pulled' || result === 'merged'){ render(); if(manual) toast('Brought in the changes from your other device.'); }
    else if(manual) toast(result === 'pushed' ? 'Synced.' : 'Already up to date.');
  }catch(e){
    setSyncBadge('error', e.message);
    if(manual) toast(e.message, 'error');
  }finally{ syncing = false; }
}
/* Documents and photos added here that are not on GitHub yet. */
async function pushFiles(){
  const items = S.docs.filter(d=>!d.localOnly).map(d=>({o: d, fileId: d.fileId})).concat(S.memories.flatMap(m=>(m.photos || []).map(p=>({o: p, fileId: p.fileId}))));
  let changed = false;
  for(const it of items){
    if(it.o.remote || it.o.tooLarge || !it.fileId) continue;
    const f = await Store.getFile(it.fileId);
    if(!f) continue;
    try{ it.o.remote = await Cloud.uploadFile(it.fileId, new Uint8Array(f.bytes), f.mime); }
    catch(e){ if(/too large/i.test(e.message)) it.o.tooLarge = true; else throw e; }
    touch(it.o.docRef || it.o); changed = true;
  }
  if(changed){ memTouch(); await save({noSync: true}); }
}
/* a photo's location is inside its memory: the memory is what syncs as one record */
function memTouch(){ S.memories.forEach(m=>{ if((m.photos || []).some(p=>p.updatedAt && p.updatedAt > (m.updatedAt || 0))) m.updatedAt = Date.now(); }); }
/* A document's file: from this device, else fetched (and kept) from GitHub. */
async function fileFor(o){
  const f = await Store.getFile(o.fileId);
  if(f) return {bytes: new Uint8Array(f.bytes), mime: f.mime};
  if(!o.remote) throw new Error(o.tooLarge ? 'This file was too large to sync; it is only on the device that added it.' : 'This file is on your other device and has not synced yet. Open Trip Vault there to send it.');
  const got = await Cloud.downloadFile(o.remote);
  await Store.putFile(o.fileId, {bytes: got.bytes.buffer, mime: got.mime});
  return got;
}
function setSyncBadge(state, msg){
  const b = $('sync-btn');
  if(!b) return;
  b.dataset.state = state;
  b.title = state === 'error' ? 'Sync problem: ' + msg : state === 'busy' ? 'Syncing…' : Cloud.syncConfig() ? 'Synced ' + (Cloud.syncConfig().syncedAt ? ago(Cloud.syncConfig().syncedAt) : '') : 'Sync is off — set it up in Settings';
}

/* ---------------------------------------------------------------- reference data */
let REF = {airports: {}, countries: {}, airlines: {}};
async function loadReference(){
  try{
    const [a, l] = await Promise.all([fetch('data/airports.json').then(r=>r.json()), fetch('data/airlines.json').then(r=>r.json())]);
    REF = {airports: a.airports, countries: a.countries, airlines: l};
    Parse.setReference(REF);
  }catch(e){ console.warn('reference data', e); }
}
/* The airports that serve a city (by name, else within 60 km). */
function cityAirports(city, loc){
  const c = String(city || '').toLowerCase().trim();
  const out = [];
  Object.entries(REF.airports).forEach(([code, a])=>{
    const m = String(Parse.airport(code).city || '').toLowerCase(), raw = String(a[1] || '').toLowerCase();
    const same = x => x && (x === c || (x.length > 3 && c.length > 3 && (x.indexOf(c) === 0 || c.indexOf(x) === 0)));
    if(c && (same(m) || same(raw))) out.push(code);
    else if(loc && Geo.km(loc, {lat: a[3], lng: a[4]}) < 60) out.push(code);
  });
  return out;
}
/* Where a city is, for the weather: its airport, else the geocoder, else OpenStreetMap. */
async function cityLoc(city, country){
  const ap = cityAirports(city)[0];
  if(ap){ const a = Parse.airport(ap); return {name: city, lat: a.lat, lng: a.lng, country: a.countryName}; }
  const g = await Geo.city(city, country).catch(()=>null);
  if(g) return g;
  const p = await Geo.place([city, country].filter(Boolean).join(', ')).catch(()=>null);
  return p ? {name: city, lat: p.lat, lng: p.lng, country: p.country || country} : null;
}
const isInternational = f => { const a = Parse.airport(f.from), b = Parse.airport(f.to); return !!(a && b && a.country !== b.country); };

/* ---------------------------------------------------------------- what the documents say, per trip */
const tripById = id => S.trips.find(t=>t.id === id);
const docsOf = tripId => S.docs.filter(d=>!tripId || d.tripId === tripId);
/* Every flight in a trip, once each: the tickets and boarding passes of everyone on it are gathered together,
   with each traveller (the document's owner and every passenger named on it) and their seat when known. */
const nameKey = n => String(n || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
function flightsOf(tripId){
  const out = [];
  const addPerson = (f, name, seat) => {
    name = Parse.titleCase(String(name || '').trim());
    if(!name) return;
    let p = f.travellers.find(x=>nameKey(x.name) === nameKey(name));
    if(!p){ p = {name, seat: ''}; f.travellers.push(p); }
    if(seat && !p.seat) p.seat = seat;
  };
  docsOf(tripId).forEach(d=>(d.fields && d.fields.segments || []).forEach(s=>{
    if(!s.flight) return;
    const k = s.flight + '|' + s.date;
    let f = out.find(x=>x.key === k);
    if(f){ Object.keys(s).forEach(x=>{ if(s[x] && !f[x] && x !== 'seat') f[x] = s[x]; }); }
    else { f = Object.assign({key: k, docs: [], passes: [], travellers: []}, s); delete f.seat; out.push(f); }
    if(f.docs.indexOf(d.id) < 0) f.docs.push(d.id);
    if(d.type === 'boarding-pass' && f.passes.indexOf(d.id) < 0) f.passes.push(d.id);
    // a boarding pass is one person's: its seat is theirs; a ticket may name several passengers
    const names = (d.fields.passengers || []).length ? d.fields.passengers : [d.person];
    names.forEach(n=>addPerson(f, n, d.type === 'boarding-pass' && names.length === 1 ? s.seat : ''));
    if(d.person && d.type !== 'boarding-pass' && !(d.fields.passengers || []).length) addPerson(f, d.person, '');
  }));
  S.flightsExtra.filter(f=>!tripId || f.tripId === tripId).forEach(f=>{ if(!out.some(x=>x.key === f.flight + '|' + f.date)) out.push(Object.assign({key: f.flight + '|' + f.date, docs: [], passes: [], travellers: f.person ? [{name: f.person, seat: ''}] : [], manual: f.id}, f)); });
  out.forEach(f=>{
    f.international = isInternational(f);
    f.person = f.travellers.map(p=>p.name).join(', ');           // everyone on it
    f.seat = f.travellers.map(p=>p.seat).filter(Boolean).join(', ');
    f.boardingPass = f.passes[0] || '';
    f.allDocs = f.passes.concat(f.docs.filter(id=>f.passes.indexOf(id) < 0));   // boarding passes first, then the tickets
  });
  return out.sort((a, b)=>(a.date + (a.dep || '')).localeCompare(b.date + (b.dep || '')));
}
/* Who is on a trip: everyone its documents name, plus those added by hand, less those taken off. */
function travellersOf(trip){
  const out = [], seen = new Set();
  const add = n => { n = Parse.titleCase(String(n || '').trim()); const k = nameKey(n); if(n && !seen.has(k)){ seen.add(k); out.push(n); } };
  docsOf(trip.id).forEach(d=>{ add(d.person); ((d.fields || {}).passengers || []).forEach(add); ((d.fields || {}).guests || []).forEach(add); });
  (trip.travellers || []).forEach(add);
  const off = (trip.notTravelling || []).map(nameKey);
  return out.filter(n=>off.indexOf(nameKey(n)) < 0);
}
const homeCountry = () => S.settings.homeCountry || 'India';
function isInternationalTrip(trip){
  if(flightsOf(trip.id).some(f=>f.international)) return true;
  return !!(trip.country && trip.country.toLowerCase() !== homeCountry().toLowerCase());
}
/* "Anil Gupta (23A), Priya Gupta (23B), Aarav Gupta" */
const travellersText = f => (f.travellers || []).map(p=>p.name + (p.seat ? ' (' + p.seat + ')' : '')).join(', ');
function hotelsOf(tripId){
  return docsOf(tripId).filter(d=>d.type === 'hotel').map(d=>({doc: d.id, name: d.fields.hotelName || d.title, address: d.fields.address || '', city: d.fields.city || '', country: d.fields.country || '',
    checkIn: d.fields.checkIn, checkOut: d.fields.checkOut, checkInTime: d.fields.checkInTime, checkOutTime: d.fields.checkOutTime, confirmation: d.fields.confirmation, phone: d.fields.phone}))
    .sort((a, b)=>String(a.checkIn).localeCompare(String(b.checkIn)));
}
/* A trip's cities: its own city, plus every city a hotel or an arriving flight points to. */
function citiesOf(trip){
  const out = [];
  const add = (c, country) => { if(c && !out.some(x=>x.city.toLowerCase() === c.toLowerCase())) out.push({city: c, country: country || ''}); };
  if(trip.city) add(trip.city, trip.country);
  hotelsOf(trip.id).forEach(h=>{ if(h.city) add(h.city, h.country); });
  const fl = flightsOf(trip.id);
  fl.forEach((f, i)=>{ const next = fl[i + 1]; if(next && next.from === f.to){ const a = Parse.airport(f.to); if(a && a.city && !fl.some((x, j)=>j > i + 1 && x.to === f.to)) return; } const a = Parse.airport(f.to); if(a && i < fl.length - 1) add(a.city, a.countryName); });
  return out;
}
/* Trip dates from its documents when not set by hand. */
function tripSpan(trip){
  if(trip.start && trip.end) return {start: trip.start, end: trip.end};
  const ds = [];
  docsOf(trip.id).forEach(d=>{ const s = Parse.span(d); if(s.start) ds.push(s.start); if(s.end) ds.push(s.end); });
  ds.sort();
  return {start: trip.start || ds[0] || '', end: trip.end || ds[ds.length - 1] || ''};
}

/* ---------------------------------------------------------------- shell */
const TABS = [
  {id: 'trips', label: 'Trips', icon: 'home'},
  {id: 'docs', label: 'Documents', icon: 'doc'},
  {id: 'check', label: 'Checklist', icon: 'check'},
  {id: 'plan', label: 'Itinerary', icon: 'map'},
  {id: 'news', label: 'News', icon: 'news'},
  {id: 'flights', label: 'Flights', icon: 'plane'},
  {id: 'memories', label: 'Memories', icon: 'photo'},
];
const VIEWS = {};
let tab = 'trips';
function currentTrip(){
  let t = tripById(S.settings.lastTrip);
  if(!t){
    const up = S.trips.map(x=>Object.assign({}, x, tripSpan(x))).filter(x=>!x.end || x.end >= todayISO()).sort((a, b)=>String(a.start).localeCompare(String(b.start)))[0];
    t = up ? tripById(up.id) : S.trips[S.trips.length - 1];
  }
  return t || null;
}
/* The address says where to open: #plan, #docs, #docs/personal (also #vault, #personal) … */
function route(){
  let [t, sub] = location.hash.slice(1).split('/');
  if(t === 'vault' || t === 'personal'){ t = 'docs'; sub = 'personal'; }
  if(!TABS.some(x=>x.id === t)) return false;
  tab = t;
  // #docs/personal and #docs/trip pick the side; plain #docs keeps the one used last
  if(t === 'docs' && typeof docFilter !== 'undefined' && sub) docFilter.kind = sub === 'personal' ? 'personal' : 'travel';
  return true;
}
function setTrip(id){ S.settings.lastTrip = id; save({quiet: true, noSync: true}); render(); }

function shell(){
  document.body.innerHTML = `
  <div class="app">
    <header class="top">
      <div class="top-in">
        <a class="brand" href="#trips">${logo()}<span><b>Trip</b> Vault</span></a>
        <label class="trip-pick"><span class="sr">Trip</span><select id="trip-pick" aria-label="Current trip"></select></label>
        <div class="top-actions">
          <a class="icon-btn home-link" href="/" title="Money Home — all your apps" aria-label="Money Home — all your apps">${icon('apps')}</a>
          <span id="ai-switch"></span>
          <button class="icon-btn" id="sync-btn" data-state="off" aria-label="Sync now">${icon('sync')}</button>
          <button class="icon-btn" id="settings-btn" aria-label="Settings">${icon('gear')}</button>
        </div>
      </div>
      <nav class="tabs" id="tabs" role="tablist"></nav>
    </header>
    <main id="main" tabindex="-1"></main>
  </div>
  <nav class="bottom-nav" id="bottom-nav"></nav>
  <div class="modal" id="modal" hidden><div class="modal-card" id="modal-card" role="dialog" aria-modal="true"></div></div>
  <div class="viewer" id="viewer" hidden></div>
  <div class="toast" id="toast" role="status"></div>`;
  if(typeof MoneyAI !== 'undefined' && MoneyAI.widget) MoneyAI.widget($('ai-switch'));      // which AI answers, and switching it
  $('sync-btn').onclick = ()=>Cloud.syncConfig() ? autoSync(true) : openSettings('sync');
  $('settings-btn').onclick = ()=>openSettings();
  $('trip-pick').onchange = e=>{ if(e.target.value === '__new') { e.target.value = S.settings.lastTrip || ''; VIEWS.newTrip(); } else setTrip(e.target.value); };
  $('modal').addEventListener('click', e=>{ if(e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape'){ if(!$('modal').hidden) closeModal(); else if(!$('viewer').hidden) closeViewer(); } });   // the top one first
  window.addEventListener('hashchange', ()=>{ if(route() || true) render(); });
  setSyncBadge(Cloud.syncConfig() ? 'ok' : 'off');
}
const logo = () => `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="var(--brand-bg)"/><path d="M14 40l36-14-36-14 7 14z" fill="var(--brand-fg)"/><path d="M21 26h29" stroke="var(--brand-bg)" stroke-width="3"/><circle cx="46" cy="46" r="6" fill="none" stroke="var(--brand-fg)" stroke-width="3.5"/></svg>`;

function render(){
  const trips = S.trips.slice().map(t=>Object.assign({}, t, tripSpan(t))).sort((a, b)=>String(b.start).localeCompare(String(a.start)));
  const cur = currentTrip();
  $('trip-pick').innerHTML = (trips.length ? '' : '<option value="">No trips yet</option>') +
    trips.map(t=>`<option value="${esc(t.id)}"${cur && cur.id === t.id ? ' selected' : ''}>${esc(t.name)}${t.start ? ' · ' + esc(fmtRange(t.start, t.end)) : ''}</option>`).join('') + '<option value="__new">+ New trip…</option>';
  const nav = TABS.map(t=>`<a role="tab" href="#${t.id}" class="${t.id === tab ? 'on' : ''}" aria-selected="${t.id === tab}">${icon(t.icon)}<span>${t.label}</span></a>`).join('');
  $('tabs').innerHTML = nav; $('bottom-nav').innerHTML = nav;
  const main = $('main');
  try{ VIEWS[tab](main, cur); }
  catch(e){ console.error(e); main.innerHTML = `<div class="card error">Something went wrong drawing this tab: ${esc(e.message)}</div>`; }
}

/* ---------------------------------------------------------------- "the AI is working": a panel that stays in view
   Busy.start(title, onStop) · Busy.step(text) · Busy.done(text, error) */
const Busy = (function(){
  let el = null, timer = null, t0 = 0;
  function start(title, onStop){
    stop();
    el = document.createElement('div');
    el.className = 'busy'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = `<span class="spinner"></span><div class="busy-text"><b>${esc(title)}</b><span class="busy-step"></span></div><span class="busy-time">0 s</span>${onStop ? '<button class="btn ghost small busy-stop">Stop</button>' : ''}`;
    document.body.appendChild(el);
    if(onStop) el.querySelector('.busy-stop').onclick = onStop;
    t0 = Date.now();
    timer = setInterval(()=>{ const s = Math.round((Date.now() - t0) / 1000); el.querySelector('.busy-time').textContent = s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; }, 1000);
  }
  const step = t => { if(el) el.querySelector('.busy-step').textContent = t; };
  function done(text, error){
    if(!el) return;
    clearInterval(timer);
    const secs = Math.round((Date.now() - t0) / 1000);
    el.classList.add(error ? 'bad' : 'ok');
    el.innerHTML = `<span class="busy-mark">${error ? '!' : '✓'}</span><div class="busy-text"><b>${esc(text)}</b>${error ? '' : `<span class="busy-step">in ${secs < 60 ? secs + ' s' : Math.floor(secs / 60) + ' min ' + (secs % 60) + ' s'}</span>`}</div><button class="btn ghost small busy-stop">Close</button>`;
    const mine = el; mine.querySelector('.busy-stop').onclick = ()=>mine.remove();
    setTimeout(()=>{ if(mine.isConnected) mine.remove(); }, error ? 12000 : 5000);
    el = null;
  }
  function stop(){ clearInterval(timer); if(el) el.remove(); el = null; }
  return {start, step, done, stop};
})();

/* ---------------------------------------------------------------- modal */
function openModal(html, opts){
  $('modal-card').className = 'modal-card' + (opts && opts.wide ? ' wide' : '');
  $('modal-card').innerHTML = `<button class="icon-btn modal-x" aria-label="Close" data-close>${icon('x')}</button>` + html;
  $('modal').hidden = false;
  document.body.classList.add('noscroll');
  $('modal-card').querySelectorAll('[data-close]').forEach(b=>b.onclick = closeModal);
  const f = $('modal-card').querySelector('input:not([type=hidden]),select,textarea');
  if(f && !(opts && opts.noFocus) && matchMedia('(pointer:fine)').matches) f.focus();
  return $('modal-card');
}
function closeModal(){ $('modal').hidden = true; $('modal-card').innerHTML = ''; document.body.classList.remove('noscroll'); }
function ask(title, label, opts){
  return new Promise(res=>{
    const card = openModal(`<h2>${esc(title)}</h2><form id="ask-f"><label>${esc(label)}<input id="ask-v" type="${opts && opts.password ? 'password' : 'text'}" autocomplete="off"></label>
      ${opts && opts.note ? `<p class="muted">${esc(opts.note)}</p>` : ''}<div class="row end"><button type="button" class="btn ghost" id="ask-no">Cancel</button><button class="btn primary">OK</button></div></form>`);
    card.querySelector('#ask-f').onsubmit = e=>{ e.preventDefault(); const v = $('ask-v').value; closeModal(); res(v); };
    card.querySelector('#ask-no').onclick = ()=>{ closeModal(); res(null); };
    card.querySelector('[data-close]').onclick = ()=>{ closeModal(); res(null); };
    setTimeout(()=>$('ask-v') && $('ask-v').focus(), 50);
  });
}
function confirmBox(title, text, yes){
  return new Promise(res=>{
    const card = openModal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="row end"><button class="btn ghost" id="c-no">Cancel</button><button class="btn danger" id="c-yes">${esc(yes || 'Delete')}</button></div>`, {noFocus: true});
    card.querySelector('#c-no').onclick = ()=>{ closeModal(); res(false); };
    card.querySelector('#c-yes').onclick = ()=>{ closeModal(); res(true); };
  });
}

/* ---------------------------------------------------------------- sign-in */
const SESSION = 'tripvault-session';
const signedIn = () => { try{ return sessionStorage.getItem(SESSION) === 'yes' || localStorage.getItem(SESSION) === 'yes'; }catch(e){ return false; } };
async function gate(){
  const src = await Cloud.loginSource();
  document.body.innerHTML = `<div class="gate"><form id="lf">
    <div class="brand big">${logo()}<span><b>Trip</b> Vault</span></div>
    <h1>Welcome back</h1><p class="muted">Tickets, stays, plans and memories — on every device.</p>
    <label>Username<input id="u" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
    <label>Password<input id="p" type="password" autocomplete="current-password" required></label>
    <label class="check"><input type="checkbox" id="remember"> Keep me signed in on this device</label>
    <p class="err" id="e" hidden>That username or password is wrong.</p>
    <button class="btn primary wide">Sign in</button>
    <p class="muted small">${src === 'expense-tracker' ? 'The same sign-in as the Expense Tracker.' : src === 'ledger' ? 'The same sign-in as the Ledger.' : 'Your Trip Vault sign-in.'}</p></form></div>`;
  $('u').focus();
  $('lf').onsubmit = async e=>{
    e.preventDefault();
    if(!(await Cloud.checkLogin($('u').value, $('p').value, S.settings.auth))){ $('e').hidden = false; $('p').select(); return; }
    try{ sessionStorage.setItem(SESSION, 'yes'); if($('remember').checked) localStorage.setItem(SESSION, 'yes'); }catch(_){}
    start();
  };
}
function signOut(){ try{ sessionStorage.removeItem(SESSION); localStorage.removeItem(SESSION); }catch(e){} location.reload(); }

/* ---------------------------------------------------------------- settings */
function openSettings(section){
  const ai = Cloud.aiSettings(), sync = Cloud.syncConfig(), other = Cloud.otherAppSync();
  const own = Cloud.aiLocal();
  const fk = S.settings.flightKeys || {};
  const card = openModal(`<h2>Settings</h2>
  <div class="settings">
    <details ${!section || section === 'ai' ? 'open' : ''}><summary>${icon('spark')} AI assistants</summary>
      ${Cloud.central ? `<p class="muted">AI reads your documents, plans the itinerary and summarises the news. Its keys are shared by all your apps and set in one place.</p>
      <p class="small">${Cloud.aiStatus().length ? 'Answering: ' + Cloud.aiStatus().map(x=>esc(x.name) + (x.model ? ' <em class="muted">(' + esc(x.model) + ')</em>' : '') + (x.resting ? ' — resting' : '')).join(' → ') : '<span class="warn-text">No AI key yet.</span>'}</p>
      <a class="btn soft" href="/setup/#ai">${icon('spark')} AI keys and order — in Setup</a>` : `
      <p class="muted">Free AI keys read your documents, plan the itinerary and summarise the news. ${Cloud.central ? 'These are the <b>shared keys of all your apps</b> — the same in Money Home, the Ledger and the Expense Tracker. <a href="/ai/">Open the AI hub</a> to test them.' : 'Keys from your Expense Tracker / Ledger in this browser are used automatically.'}
      A <b>Google Gemini</b> key is the most useful: it reads photos and scans, and can search the web for live news and flight status.</p>
      <div class="keys">${Cloud.PROVIDERS.map(p=>`<label class="key-row"><span>${esc(p.name)} ${ai.from[p.id] && ['trip-vault', 'hub'].indexOf(ai.from[p.id]) < 0 ? `<em class="chip soft">from ${({ledger: 'Ledger', synced: 'your other device', 'expense-tracker': 'Expense Tracker'})[ai.from[p.id]] || ai.from[p.id]}</em>` : ''} <a href="${p.signupUrl}" target="_blank" rel="noopener" class="small">get a key</a></span>
        <input data-ai="${p.id}" type="password" autocomplete="off" placeholder="${esc(ai.from[p.id] && ['trip-vault', 'hub'].indexOf(ai.from[p.id]) < 0 ? '(using the other app’s key)' : p.placeholder)}" value="${esc((own.keys || {})[p.id] || '')}"></label>`).join('')}</div>
      <div class="grid2">
        <label>Which AI goes first
          <select id="ai-first"><option value="auto">Auto — the best one that answers, free ones first</option>${Cloud.PROVIDERS.map(p=>`<option value="${p.id}"${ai.first === p.id ? ' selected' : ''}${ai.keys[p.id] ? '' : ' disabled'}>${esc(p.name)}${ai.keys[p.id] ? '' : ' (no key)'}</option>`).join('')}</select></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="ai-fallback" ${ai.fallback ? 'checked' : ''}> If it fails or is out of quota, try the others</label>
      </div>
      <p class="muted small">${Cloud.aiStatus().length ? 'Tried in this order: ' + Cloud.aiStatus().map(x=>esc(x.name) + (x.model ? ' <em>(' + esc(x.model) + ')</em>' : '') + (x.resting ? ' — resting' : '')).join(' → ') + '. Each tries its best model first, then the next.' : 'No AI set up yet.'}</p>
      `}
      <label>Document reader
        <select id="reader-mode">
          <option value="builtin-ai">Built-in reader first, then AI fills the gaps (recommended)</option>
          <option value="ai">AI reader first (built-in if AI is unavailable)</option>
          <option value="builtin">Built-in reader only — nothing leaves the device</option>
        </select></label>
    </details>
    <details ${section === 'flights' ? 'open' : ''}><summary>${icon('plane')} Flight status</summary>
      <p class="muted">Live status comes from a free flight-data key, else from Gemini searching the web. <b>AeroDataBox</b> (free on RapidAPI, a few hundred checks a month) works for any date; <b>AirLabs</b> (1,000 free a month) for flights in the next day or so.</p>
      <label>AeroDataBox RapidAPI key <a class="small" href="https://rapidapi.com/aedbx-aedbx/api/aerodatabox" target="_blank" rel="noopener">get one</a><input id="k-adb" type="password" autocomplete="off" value="${esc(fk.aerodatabox || '')}"></label>
      <label>AirLabs key <a class="small" href="https://airlabs.co/signup" target="_blank" rel="noopener">get one</a><input id="k-al" type="password" autocomplete="off" value="${esc(fk.airlabs || '')}"></label>
    </details>
    <details ${section === 'sync' ? 'open' : ''}><summary>${icon('sync')} Phone ↔ laptop sync</summary>
      ${Cloud.shared ? `<p class="muted">Your trips and documents are encrypted on this device, then kept in a private GitHub Gist, so the phone and the laptop see the same vault.</p>
      ${sync ? `<p>Sync is <b>on</b>${sync.syncedAt ? ' · last synced ' + esc(ago(sync.syncedAt)) : ''}${sync.lastError ? `<br><span class="err">${esc(sync.lastError)}</span>` : ''}</p>
        <div class="row"><button class="btn primary" id="sync-now">${icon('sync')} Sync now</button><a class="btn ghost" href="/setup/#sync">Sync settings — in Setup</a></div>`
      : `<p>Sync is <b>off</b> on this device.</p><a class="btn primary" href="/setup/#sync">${icon('sync')} Turn it on in Setup (once for all your apps)</a>`}` : `
      <p class="muted">Your trips and documents are encrypted on this device with a passphrase, then kept in private GitHub Gists. Use the same token and passphrase on the phone and they see the same vault. GitHub only ever holds unreadable data.</p>
      ${sync ? `<p>Sync is <b>on</b>${sync.syncedAt ? ' · last synced ' + esc(ago(sync.syncedAt)) : ''}${sync.lastError ? `<br><span class="err">${esc(sync.lastError)}</span>` : ''}</p>
        <label class="check"><input type="checkbox" id="share-keys" ${S.settings.shareKeys === false ? '' : 'checked'}> Carry my AI and flight keys to my other devices (inside the encrypted sync)</label>
        <div class="row"><button class="btn primary" id="sync-now">${icon('sync')} Sync now</button><button class="btn ghost" id="sync-off">Turn off on this device</button></div>`
      : `${other ? `<button class="btn soft" id="sync-reuse">Use the same sync as my Expense Tracker / Ledger</button><p class="muted small">or enter them:</p>` : ''}
        <label>GitHub token (fine-grained, permission “Gists: read and write”) <a class="small" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">create</a><input id="s-token" type="password" autocomplete="off"></label>
        <label>Sync passphrase (the same on every device; it cannot be recovered)<input id="s-pass" type="password" autocomplete="new-password"></label>
        <button class="btn primary" id="sync-on">Turn on sync</button>`}
      `}
    </details>
    <details ${section === 'people' ? 'open' : ''}><summary>${icon('user')} People</summary>
      <p class="muted">Whose documents: add everyone you travel with. New names from uploads are added here too.</p>
      <div id="people-list" class="chips">${S.people.map(p=>`<span class="chip">${esc(p.name)} <button class="chip-x" data-del-person="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button></span>`).join('') || '<span class="muted">No one yet.</span>'}</div>
      <form id="person-f" class="row"><input id="person-n" placeholder="Name"><button class="btn soft">Add</button></form>
    </details>
    <details><summary>${icon('lock')} Sign-in, theme, backup</summary>
      ${Cloud.loginSource ? '<p class="muted" id="login-note"></p>' : ''}
      <form id="pw-f" hidden><label>Username<input id="pw-u" autocomplete="username"></label><label>New password<input id="pw-p" type="password" autocomplete="new-password"></label><button class="btn soft">Set sign-in</button></form>
      <label>Theme<select id="theme"><option value="">Match the device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <div class="row"><button class="btn soft" id="backup">${icon('download')} Download a backup (details only)</button><label class="btn soft file-btn">Restore backup<input type="file" id="restore" accept=".json,application/json" hidden></label></div>
      <div class="row"><a class="btn soft" href="/">${icon('apps')} Money Home — all your apps</a><button class="btn ghost" id="signout">Sign out</button></div>
    </details>
  </div>
  <div class="row end sticky-foot"><button class="btn ghost" data-close>Close</button><button class="btn primary" id="settings-save">Save</button></div>`, {wide: true, noFocus: true});

  card.querySelector('#reader-mode').value = S.settings.readerMode || 'builtin-ai';
  let theme = ''; try{ theme = localStorage.getItem('tripvault-theme') || ''; }catch(e){}
  card.querySelector('#theme').value = theme;
  card.querySelector('#theme').onchange = e=>applyTheme(e.target.value, true);
  Cloud.loginSource().then(src=>{
    const n = $('login-note');
    if(!n) return;
    if(Cloud.shared && src !== 'own'){ n.textContent = 'One sign-in for all your apps: your Expense Tracker username and password — change it there.'; return; }
    if(Cloud.shared){ n.innerHTML = 'Turn on sync in <a href="/setup/#sync">Setup</a> and this device uses the same sign-in as your other device.'; return; }
    if(src === 'expense-tracker') n.textContent = 'You sign in with your Expense Tracker username and password — change it there.';
    else if(src === 'ledger') n.textContent = 'You sign in with your Ledger username and password — change it there.';
    else { n.textContent = S.settings.auth ? 'Change your Trip Vault sign-in:' : 'You are using admin / admin. Set your own:'; $('pw-f').hidden = false; }
  });
  card.querySelector('#pw-f').onsubmit = async e=>{
    e.preventDefault();
    const u = $('pw-u').value.trim().toLowerCase(), p = $('pw-p').value;
    if(!u || p.length < 4) return toast('Pick a username and a password of 4+ characters.', 'error');
    S.settings.auth = {user: u, hash: await Cloud.sha256(u + ':' + p)};
    save(); toast('Sign-in changed.');
  };
  card.querySelector('#person-f').onsubmit = e=>{ e.preventDefault(); const n = $('person-n').value.trim(); if(n){ addPerson(n); save(); openSettings('people'); } };
  card.querySelectorAll('[data-del-person]').forEach(b=>b.onclick = ()=>{ remove('people', b.dataset.delPerson); save(); openSettings('people'); });
  card.querySelector('#settings-save').onclick = ()=>{
    if($('ai-first')){                         // the key editor (only in a copy without the shared Setup)
      const o = Cloud.aiLocal(); o.keys = o.keys || {};
      card.querySelectorAll('[data-ai]').forEach(i=>{ const v = i.value.trim(); if(v) o.keys[i.dataset.ai] = v; else delete o.keys[i.dataset.ai]; });
      o.first = $('ai-first').value; o.fallback = $('ai-fallback').checked;
      Cloud.saveAiLocal(o);
    }
    S.settings.readerMode = $('reader-mode').value;
    S.settings.flightKeys = {aerodatabox: $('k-adb').value.trim(), airlabs: $('k-al').value.trim()};
    save({quiet: true});
    closeModal(); render(); toast('Settings saved.');
  };
  const on = async (token, pass)=>{
    if(!token || !pass) return toast('Enter both the token and the passphrase.', 'error');
    Cloud.saveSyncConfig({token, pass});
    closeModal(); toast('Sync is on. Syncing…');
    await autoSync(true);
  };
  if(card.querySelector('#sync-on')) card.querySelector('#sync-on').onclick = ()=>on($('s-token').value.trim(), $('s-pass').value);
  if(card.querySelector('#sync-reuse')) card.querySelector('#sync-reuse').onclick = ()=>on(other.token, other.pass);
  if(card.querySelector('#share-keys')) card.querySelector('#share-keys').onchange = e=>{ S.settings.shareKeys = e.target.checked; save({quiet: true}); };
  if(card.querySelector('#sync-now')) card.querySelector('#sync-now').onclick = ()=>{ closeModal(); autoSync(true); };
  if(card.querySelector('#sync-off')) card.querySelector('#sync-off').onclick = ()=>{ Cloud.forgetSync(); setSyncBadge('off'); openSettings('sync'); };
  card.querySelector('#backup').onclick = ()=>{
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], {type: 'application/json'}));
    a.download = 'trip-vault-backup-' + todayISO() + '.json'; a.click();
  };
  card.querySelector('#restore').onchange = async e=>{
    const f = e.target.files[0]; if(!f) return;
    try{
      const d = JSON.parse(await f.text());
      if(!Array.isArray(d.trips) || !Array.isArray(d.docs)) throw new Error('Not a Trip Vault backup.');
      S = mergeData(S, d); await save(); closeModal(); render(); toast('Backup restored (merged with what was here).');
    }catch(err){ toast(err.message, 'error'); }
  };
  card.querySelector('#signout').onclick = signOut;
}
function addPerson(name){
  name = String(name || '').trim();
  if(!name) return null;
  const have = S.people.find(p=>p.name.toLowerCase() === name.toLowerCase());
  if(have) return have;
  const p = touch({id: uid('p'), name});
  S.people.push(p);
  return p;
}
function applyTheme(t, store){
  if(t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  if(store) try{ if(t) localStorage.setItem('tripvault-theme', t); else localStorage.removeItem('tripvault-theme'); }catch(e){}
}

/* ---------------------------------------------------------------- start */
async function start(){
  shell();
  route();
  render();
  Cloud.loadAi().then(async ()=>{
    if(Cloud.shared) await Cloud.shared.quiet().catch(()=>null);     // settings (AI keys, sign-in) from your other device
    render(); autoSync();
  });
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') autoSync(); });
}
window.addEventListener('DOMContentLoaded', async function boot(){
  try{ applyTheme(localStorage.getItem('tripvault-theme') || ''); }catch(e){}
  await Promise.all([load(), loadReference()]);
  if('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).catch(()=>{});
  if(signedIn()) start(); else gate();
});

/* ---------------------------------------------------------------- places: city and country pickers
   Type a city: matching cities appear with their country - from the airports list and popular places
   (works offline), then from a worldwide place search. Picking one fills the city and the country. */
const Places = (function(){
  // popular places with no airport of their own (the airports list covers the rest)
  const EXTRA = [['Manali','IN'],['Shimla','IN'],['Munnar','IN'],['Ooty','IN'],['Rishikesh','IN'],['Haridwar','IN'],['Mussoorie','IN'],['Nainital','IN'],['Darjeeling','IN'],['Gangtok','IN'],
    ['Coorg','IN'],['Alleppey','IN'],['Kochi','IN'],['Pondicherry','IN'],['Hampi','IN'],['Gokarna','IN'],['Varkala','IN'],['Kovalam','IN'],['Lonavala','IN'],['Mahabaleshwar','IN'],['Matheran','IN'],
    ['Alibaug','IN'],['Kodaikanal','IN'],['Mount Abu','IN'],['Pushkar','IN'],['Ranthambore','IN'],['Jim Corbett','IN'],['Auli','IN'],['Kasol','IN'],['Dharamshala','IN'],['McLeod Ganj','IN'],
    ['Spiti Valley','IN'],['Havelock Island','IN'],['Mahabalipuram','IN'],['Agra','IN'],['Mathura','IN'],['Vrindavan','IN'],['Ajmer','IN'],['Jaipur','IN'],['Shirdi','IN'],['Tirupati','IN'],
    ['Interlaken','CH'],['Zermatt','CH'],['Lucerne','CH'],['Grindelwald','CH'],['Hallstatt','AT'],['Salzburg','AT'],['Bruges','BE'],['Cappadocia','TR'],['Pamukkale','TR'],['Santorini','GR'],
    ['Kyoto','JP'],['Nara','JP'],['Hakone','JP'],['Ubud','ID'],['Phi Phi Islands','TH'],['Pattaya','TH'],['Chiang Mai','TH'],['Sentosa','SG'],['Genting Highlands','MY'],['Pokhara','NP'],
    ['Thimphu','BT'],['Paro','BT'],['Maafushi','MV'],['Kandy','LK'],['Ella','LK'],['Galle','LK'],['Ha Long Bay','VN'],['Hoi An','VN'],['Siem Reap','KH'],['Cotswolds','GB'],['Edinburgh','GB'],
    ['Florence','IT'],['Venice','IT'],['Amalfi','IT'],['Cinque Terre','IT'],['Nice','FR'],['Versailles','FR'],['Niagara Falls','CA'],['Banff','CA'],['Queenstown','NZ'],['Cairns','AU']];
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  let list = null;
  function all(){
    if(list) return list;
    const seen = new Set(); list = [];
    const add = (city, cc) => { if(!city) return; const k = norm(city) + '|' + cc; if(seen.has(k)) return; seen.add(k); list.push({city, country: REF.countries[cc] || cc, key: norm(city)}); };
    EXTRA.forEach(([c, cc])=>add(c, cc));
    Object.keys(REF.airports).forEach(code=>{ const a = Parse.airport(code); add(a.city, a.country); });
    return list;
  }
  const countries = () => Object.values(REF.countries).sort((a, b)=>a.localeCompare(b));
  /* the offline list, best first: exact, then starts with, then a word starts with */
  function local(q){
    const n = norm(q);
    if(n.length < 2) return [];
    const rank = p => p.key === n ? 0 : p.key.indexOf(n) === 0 ? 1 : p.key.split(/[\s-]+/).some(w=>w.indexOf(n) === 0) ? 2 : 9;
    return all().map(p=>[rank(p), p]).filter(x=>x[0] < 9).sort((a, b)=>a[0] - b[0] || a[1].city.length - b[1].city.length).slice(0, 8).map(x=>x[1]);
  }
  const cache = {};
  /* the worldwide search (any town), biggest places first */
  async function online(q){
    const n = norm(q);
    if(n.length < 3) return [];
    if(cache[n]) return cache[n];
    try{
      const d = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&name=' + encodeURIComponent(q.trim()))).json();
      return cache[n] = (d.results || []).sort((a, b)=>(b.population || 0) - (a.population || 0))
        .map(r=>({city: r.name, country: r.country || '', region: r.admin1 || '', key: norm(r.name)}));
    }catch(e){ return []; }
  }
  /* the country of a city typed in full, when there is only one such city */
  function countryOf(city){
    const n = norm(city), hits = all().filter(p=>p.key === n);
    const cs = Array.from(new Set(hits.map(h=>h.country)));
    return cs.length === 1 ? cs[0] : '';
  }
  return {local, online, countries, countryOf, norm};
})();

/* Suggestions under a city box; picking one fills the city and (if given) the country box.
   opts.first: places to offer before typing (e.g. the trip's cities); opts.onPick(place). */
function citySuggest(cityInput, countryInput, opts){
  opts = opts || {};
  if(!cityInput || cityInput.dataset.suggest) return;
  cityInput.dataset.suggest = '1';
  cityInput.setAttribute('autocomplete', 'off');
  cityInput.removeAttribute('list');
  const box = document.createElement('div');
  box.className = 'suggest'; box.hidden = true; box.setAttribute('role', 'listbox');
  cityInput.insertAdjacentElement('afterend', box);
  if(cityInput.parentElement) cityInput.parentElement.classList.add('has-suggest');
  if(countryInput) countryPicker(countryInput);
  let items = [], active = -1, seq = 0;
  const draw = () => {
    box.innerHTML = items.map((p, i)=>`<div class="sg${i === active ? ' on' : ''}" role="option" data-i="${i}"><b>${esc(p.city)}</b><span>${esc([p.region, p.country].filter(Boolean).join(', '))}</span></div>`).join('');
    box.hidden = !items.length;
  };
  const merge = (a, b) => { const seen = new Set(); return a.concat(b).filter(p=>{ const k = Places.norm(p.city) + '|' + Places.norm(p.country); if(seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10); };
  const pick = p => {
    cityInput.value = p.city;
    if(countryInput && p.country) countryInput.value = p.country;
    items = []; draw();
    if(opts.onPick) opts.onPick(p);
    cityInput.dispatchEvent(new Event('change', {bubbles: true}));
  };
  const update = async () => {
    const q = cityInput.value, my = ++seq;
    const firsts = (opts.first || []).filter(p=>!q || Places.norm(p.city).indexOf(Places.norm(q)) === 0);
    items = merge(firsts, Places.local(q)); active = -1; draw();
    if(q.trim().length >= 3){
      const more = await Places.online(q);
      if(my === seq && document.activeElement === cityInput){ items = merge(items, more); draw(); }
    }
  };
  let t = null;
  cityInput.addEventListener('input', ()=>{ clearTimeout(t); t = setTimeout(update, 180); });
  cityInput.addEventListener('focus', ()=>{ if(opts.first && opts.first.length && !cityInput.value) update(); });
  cityInput.addEventListener('keydown', e=>{
    if(box.hidden) return;
    if(e.key === 'ArrowDown'){ active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
    else if(e.key === 'ArrowUp'){ active = Math.max(0, active - 1); draw(); e.preventDefault(); }
    else if(e.key === 'Enter' && active >= 0){ e.preventDefault(); pick(items[active]); }
    else if(e.key === 'Escape'){ items = []; draw(); }
  });
  box.addEventListener('mousedown', e=>{ const el = e.target.closest('.sg'); if(el){ e.preventDefault(); pick(items[+el.dataset.i]); } });
  cityInput.addEventListener('blur', ()=>setTimeout(()=>{
    items = []; draw();
    // a city typed in full: its country, when there is only one such city
    if(countryInput && !countryInput.value.trim() && cityInput.value.trim()){ const c = Places.countryOf(cityInput.value); if(c) countryInput.value = c; }
  }, 150));
}
/* Every country, to pick from as you type. */
function countryPicker(input){
  if(!input) return;
  let dl = document.getElementById('dl-countries');
  if(!dl){ dl = document.createElement('datalist'); dl.id = 'dl-countries'; dl.innerHTML = Places.countries().map(c=>`<option value="${esc(c)}">`).join(''); document.body.appendChild(dl); }
  input.setAttribute('list', 'dl-countries');
  input.setAttribute('autocomplete', 'off');
}
