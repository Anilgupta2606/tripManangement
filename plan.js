"use strict";
/* =========================================================
   ITINERARY — pick the city, the dates and the hotel (filled in from the
   trip's documents), then plan with AI or lay out the fixed parts built-in.
   Every plan is held to the rules (rules.js); edit anything by hand, lock
   what must stay, and tell the AI what you don't like in the issues box.
   ========================================================= */

const planState = {city: '', busy: false, ctl: null};
const planKey = (tripId, city) => tripId + '|' + String(city || '').toLowerCase();
const LOCAL_WEATHER = {};

/* Everything the planner needs to know about this city stay. */
function planContext(trip, city, plan){
  const span = tripSpan(trip);
  const hotels = hotelsOf(trip.id);
  const lc = String(city || '').toLowerCase();
  const hotelHere = hotels.find(h=>(h.city || '').toLowerCase() === lc || (h.address || '').toLowerCase().indexOf(lc) >= 0) || (hotels.length === 1 ? hotels[0] : null);
  const start = (plan && plan.start) || (hotelHere && hotelHere.checkIn) || span.start;
  const end = (plan && plan.end) || (hotelHere && hotelHere.checkOut) || span.end;
  const airports = cityAirports(city, plan && plan.loc);
  const fl = flightsOf(trip.id);
  const a = Rules.tripAnchors(fl, airports, start || '0000', end || '9999');
  const hotel = plan && plan.hotel && plan.hotel.name ? plan.hotel : hotelHere ? {name: hotelHere.name, address: hotelHere.address} : {name: '', address: ''};
  const rules = Object.assign({}, S.settings.rules || {});
  if(hotelHere && hotelHere.checkInTime) rules.checkInTime = hotelHere.checkInTime;
  if(hotelHere && hotelHere.checkOutTime) rules.checkOutTime = hotelHere.checkOutTime;
  return {trip, city, country: (plan && plan.country) || trip.country || '', start, end, hotel, arrival: a.arrival, departure: a.departure, airports, flights: fl, rules,
    weather: LOCAL_WEATHER[planKey(trip.id, city)] || null};
}

VIEWS.plan = function(main, cur){
  if(!cur){ main.innerHTML = `<div class="card"><p>Create a trip (or upload a ticket) first — the itinerary is built from its dates, flights and hotel.</p><button class="btn primary" onclick="VIEWS.newTrip()">New trip</button></div>`; return; }
  const cities = citiesOf(cur);
  if(!planState.city || planState.trip !== cur.id){ planState.trip = cur.id; planState.city = (cities[0] || {}).city || ''; }
  const key = planKey(cur.id, planState.city);
  const plan = S.plans[key] || null;
  const ctx = planContext(cur, planState.city, plan);
  const problems = plan ? Rules.check(plan, ctx.rules, ctx) : [];
  const nErr = problems.filter(p=>p.level === 'error').length, nWarn = problems.filter(p=>p.level === 'warn').length;

  main.innerHTML = `
  <section class="section-head"><div><p class="eyebrow">Itinerary</p><h1>${esc(cur.name)}</h1></div>
    <div class="row">${plan ? `<button class="btn ghost" id="p-undo" ${plan.versions && plan.versions.length ? '' : 'disabled'}>Undo</button><button class="btn ghost" id="p-copy">Copy as text</button>` : ''}<button class="btn soft" id="p-rules">${icon('shield')} Rules</button></div></section>
  <section class="card plan-setup">
    <div class="grid4">
      <label>City<input id="p-city" list="p-cities" value="${esc(planState.city)}" placeholder="Where"><datalist id="p-cities">${cities.map(c=>`<option value="${esc(c.city)}">`).join('')}</datalist></label>
      <label>From<input type="date" id="p-start" value="${esc(ctx.start || '')}"></label>
      <label>To<input type="date" id="p-end" value="${esc(ctx.end || '')}"></label>
      <label>Staying at<input id="p-hotel" list="p-hotels" value="${esc(ctx.hotel.name)}" placeholder="Hotel or area"><datalist id="p-hotels">${hotelsOf(cur.id).map(h=>`<option value="${esc(h.name)}">`).join('')}</datalist></label>
    </div>
    <div class="ctx">
      ${ctx.arrival ? `<span class="chip">🛬 ${esc(ctx.arrival.flight)} lands ${esc(fmtDate(ctx.arrival.date))} ${esc(ctx.arrival.arr || '')}</span>` : '<span class="chip soft">No arrival flight found</span>'}
      ${ctx.departure ? `<span class="chip">🛫 ${esc(ctx.departure.flight)} leaves ${esc(fmtDate(ctx.departure.date))} ${esc(ctx.departure.dep || '')}${ctx.departure.international ? ' · international' : ''}</span>` : '<span class="chip soft">No departure flight found</span>'}
      ${ctx.hotel.address ? `<span class="chip">🏨 <a href="${mapsLink(ctx.hotel.address)}" target="_blank" rel="noopener">${esc(ctx.hotel.address.slice(0, 60))}</a></span>` : ''}
    </div>
    <div class="weather-strip" id="p-weather"></div>
    <div class="row">
      <button class="btn primary" id="p-ai" ${Cloud.aiAvailable() ? '' : 'disabled title="Add a free AI key in Settings"'}>${icon('spark')} ${plan ? 'Re-plan with AI' : 'Plan with AI'}</button>
      <button class="btn soft" id="p-skel">${plan ? 'Reset to built-in layout' : 'Lay out the days (no AI)'}</button>
      ${Cloud.aiAvailable() ? '' : '<span class="muted small">AI planning needs a free key — <a href="#" id="p-key">add one</a>.</span>'}
      <span class="muted small" id="p-status"></span>
    </div>
  </section>
  ${plan ? `
  <section class="card checker ${nErr ? 'bad' : nWarn ? 'meh' : 'good'}">
    <div class="row"><b>${nErr ? nErr + ' rule break' + (nErr === 1 ? '' : 's') : nWarn ? 'Follows the must-rules' : 'Follows every rule'}</b>
      <span class="muted small">${nWarn ? nWarn + ' warning' + (nWarn === 1 ? '' : 's') + ' · ' : ''}${problems.filter(p=>p.level === 'info').length} note(s)</span><span class="grow"></span>
      ${(nErr || nWarn) && Cloud.aiAvailable() ? `<button class="btn soft small" id="p-fix">${icon('spark')} Fix these with AI</button>` : ''}</div>
    ${problems.length ? `<ul class="problems">${problems.map(p=>`<li class="${p.level}" ${p.day !== null ? `data-goto="${p.day}"` : ''}><span class="lvl">${p.level === 'error' ? 'Must fix' : p.level === 'warn' ? 'Warning' : 'Note'}</span> ${esc(p.text)}</li>`).join('')}</ul>` : ''}
  </section>
  <section class="days" id="days">${plan.days.map((d, di)=>dayCard(d, di, problems, ctx)).join('')}</section>
  <section class="card issues">
    <h2>${icon('spark')} Not happy with it? Tell the AI</h2>
    <p class="muted small">For example: “Day 2 is too packed”, “I have a meeting on the 14th at 3 pm”, “add a beach day”, “we are vegetarian”, “no temples, more food places”. Items you lock ${icon('lock')} are kept as they are.</p>
    <textarea id="p-issue" rows="3" placeholder="What should change?"></textarea>
    <div class="row"><button class="btn primary" id="p-send" ${Cloud.aiAvailable() ? '' : 'disabled'}>Update the plan</button><span class="muted small">${plan.by ? 'Last planned by ' + esc(plan.by) : ''}</span></div>
    ${(plan.history || []).length ? `<details><summary class="small">What was asked before (${plan.history.length})</summary><ul class="history small">${plan.history.slice().reverse().map(h=>`<li><span class="muted">${esc(ago(h.at))}</span> ${esc(h.text)}</li>`).join('')}</ul></details>` : ''}
  </section>` : `<section class="card"><p class="muted">No plan for ${esc(planState.city || 'this city')} yet. <b>Plan with AI</b> builds every day around your flights and hotel, following the rules; <b>Lay out the days</b> puts in only the fixed parts (flights, transfers, check-in/out, meals) for you to fill.</p></section>`}`;

  // setup
  const reSetup = ()=>{
    const city = $('p-city').value.trim();
    if(city !== planState.city){ planState.city = city; render(); return; }
    const p = S.plans[key];
    if(p){ p.start = $('p-start').value; p.end = $('p-end').value; p.hotel = Object.assign({}, p.hotel, {name: $('p-hotel').value.trim()}); touch(p); save(); render(); }
  };
  ['p-city', 'p-start', 'p-end', 'p-hotel'].forEach(id=>$(id).onchange = reSetup);
  $('p-rules').onclick = ()=>openRules();
  if($('p-key')) $('p-key').onclick = e=>{ e.preventDefault(); openSettings('ai'); };
  $('p-skel').onclick = async ()=>{
    if(plan && !(await confirmBox('Replace the plan?', 'The current plan is kept in Undo.', 'Replace'))) return;
    const c = readSetup(ctx);
    if(!c) return;
    const sk = Rules.skeleton({city: c.city, start: c.start, end: c.end, hotel: c.hotel, arrival: c.arrival, departure: c.departure}, c.rules);
    storePlan(cur, c, sk.days, 'Built-in layout', 'Laid out the fixed parts');
  };
  $('p-ai').onclick = ()=>{ const c = readSetup(ctx); if(c) aiPlan(cur, c, ''); };
  if(!plan) { loadWeather(cur, ctx); return; }
  loadWeather(cur, ctx);
  if($('p-fix')) $('p-fix').onclick = ()=>{ const c = readSetup(ctx); if(c) aiPlan(cur, c, 'Fix these rule problems: ' + problems.filter(p=>p.level !== 'info').map(p=>p.text).join(' | ')); };
  $('p-send').onclick = ()=>{ const t = $('p-issue').value.trim(); if(!t) return $('p-issue').focus(); const c = readSetup(ctx); if(c) aiPlan(cur, c, t); };
  $('p-undo').onclick = ()=>{ const v = plan.versions.pop(); if(v){ plan.days = v.days; touch(plan); save(); render(); toast('Undone.'); } };
  $('p-copy').onclick = ()=>{ navigator.clipboard.writeText(planText(plan, ctx)).then(()=>toast('Copied — paste it anywhere.')); };
  main.querySelectorAll('[data-goto]').forEach(li=>li.onclick = ()=>{ const el = document.querySelector(`[data-day="${li.dataset.goto}"]`); if(el) el.scrollIntoView({behavior: 'smooth', block: 'start'}); });
  bindDays(main, plan, ctx);
};

/* The setup fields as they are now, over the detected context. */
function readSetup(ctx){
  const c = Object.assign({}, ctx);
  c.city = $('p-city').value.trim() || ctx.city;
  c.start = $('p-start').value || ctx.start; c.end = $('p-end').value || ctx.end;
  const hn = $('p-hotel').value.trim();
  if(hn !== ctx.hotel.name){ const h = hotelsOf(ctx.trip.id).find(x=>x.name === hn); c.hotel = {name: hn, address: h ? h.address : ''}; }
  if(!c.start || !c.end){ toast('Set the dates first (or upload the tickets and hotel booking).', 'error'); return null; }
  return c;
}
function storePlan(trip, c, days, by, what){
  const key = planKey(trip.id, c.city);
  const p = S.plans[key] || {tripId: trip.id, city: c.city, history: [], versions: []};
  if(p.days) p.versions = (p.versions || []).concat([{at: Date.now(), days: p.days}]).slice(-15);
  Object.assign(p, {city: c.city, country: c.country, start: c.start, end: c.end, hotel: c.hotel, days, by});
  if(what) p.history = (p.history || []).concat([{at: Date.now(), text: what}]).slice(-30);
  S.plans[key] = touch(p);
  save(); render();
}

async function loadWeather(trip, ctx){
  const key = planKey(trip.id, ctx.city);
  const box = $('p-weather');
  const draw = w => { if(!box) return; const days = Object.entries(w || {}); box.innerHTML = days.length ? days.map(([d, x])=>`<span class="wx ${x.rain >= (Rules.merge(ctx.rules).rainChance) ? 'wet' : ''}" title="${esc(x.text)}"><b>${esc(fmtDate(d))}</b> ${wxIcon(x.code)} ${Math.round(x.tmax)}° · ${x.rain}%☂</span>`).join('') : `<span class="muted small">${ctx.start && daysUntil(ctx.start) > 15 ? 'Weather forecast shows up about two weeks before the trip.' : ''}</span>`; };
  if(LOCAL_WEATHER[key]){ draw(LOCAL_WEATHER[key]); return; }
  if(!ctx.city || !ctx.start || daysUntil(ctx.start) > 15 || daysUntil(ctx.end) < 0) { draw(null); return; }
  try{
    const loc = await cityLoc(ctx.city, ctx.country);
    if(!loc) return;
    LOCAL_WEATHER[key] = await Geo.weather(loc, ctx.start, ctx.end);
    if(tab === 'plan' && planState.city === ctx.city) render();
  }catch(e){ draw(null); }
}
const wxIcon = c => c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 67 || (c >= 80 && c <= 82) ? '🌧️' : c <= 77 || c <= 86 ? '❄️' : '⛈️';

/* ---------------------------------------------------------------- AI planning */
const PLAN_SYSTEM = rules => `You are a careful local travel planner. You write a realistic day-by-day itinerary for one city and answer with JSON only:
{"days":[{"date":"YYYY-MM-DD","title":"short theme of the day","items":[{"id":"keep existing ids","start":"HH:MM","end":"HH:MM","title":"what","place":"exact place name (for Google Maps)","kind":"sight|activity|meal|shopping|rest|transit|flight|hotel|free","notes":"one line: why, tips, tickets, timings","outdoor":true|false,"cost":"approx per person, local currency","locked":true|false}]}],"summary":"one line on what changed or the idea of the plan"}
Include every date from start to end. Include flights, transfers, hotel check-in/out as items. Use real places that exist in the city, close to each other on the same day.
THE RULES (follow all of them):
${rules}`;
async function aiPlan(trip, c, issue){
  if(planState.busy){ planState.ctl && planState.ctl.abort(); return; }
  const key = planKey(trip.id, c.city);
  const prev = S.plans[key];
  const st = $('p-status');
  const btns = ['p-ai', 'p-send', 'p-fix'].map($).filter(Boolean);
  planState.busy = true; planState.ctl = new AbortController();
  btns.forEach(b=>{ b.dataset.label = b.innerHTML; });
  const btn = issue ? ($('p-send') || $('p-fix')) : $('p-ai');
  if(btn) btn.innerHTML = '<span class="spinner"></span> Planning… (tap to stop)';
  if(st) st.textContent = '';
  try{
    let news = '';
    const cachedNews = LOCAL.news[trip.id];
    if(cachedNews && cachedNews.summary) news = `Current situation (${ago(cachedNews.summary.at)}): ${cachedNews.summary.headline} ${cachedNews.summary.points.join(' ')} ${cachedNews.summary.advice}`;
    const facts = {
      city: c.city, country: c.country, start: c.start, end: c.end,
      hotel: c.hotel, arrival: c.arrival ? {flight: c.arrival.flight, from: c.arrival.from, date: c.arrival.date, lands: c.arrival.arr} : null,
      departure: c.departure ? {flight: c.departure.flight, to: c.departure.to, date: c.departure.date, departs: c.departure.dep, international: c.departure.international} : null,
      weather: c.weather || LOCAL_WEATHER[key] || 'no forecast yet',
      travellers: Array.from(new Set(docsOf(trip.id).map(d=>d.person).filter(Boolean))),
      bookings: docsOf(trip.id).filter(d=>['activity', 'car', 'train', 'bus'].indexOf(d.type) >= 0).map(d=>({what: d.title, date: d.fields.date, time: d.fields.dep})),
      notes: trip.notes || '',
    };
    const turns = [{role: 'user', content: `Plan the stay.\nFacts: ${JSON.stringify(facts)}${news ? '\n' + news : ''}` +
      (prev && prev.days ? `\n\nThe current plan (keep what works; items with "locked": true must stay exactly):\n${JSON.stringify({days: prev.days})}` : '') +
      (issue ? `\n\nThe traveller asks: "${issue}"\nChange the plan to do this, following the rules.` : '')}];
    const r = await Cloud.chat(PLAN_SYSTEM(Rules.asPrompt(c.rules, {issues: !!issue})), turns, {}, planState.ctl.signal);
    const j = Cloud.json(r.text);
    const clean = Rules.clean(j, prev);
    if(!clean.days.length) throw new Error('The AI returned an empty plan. Try again.');
    // days outside the stay are dropped; missing days come from the built-in layout
    const sk = Rules.skeleton({city: c.city, start: c.start, end: c.end, hotel: c.hotel, arrival: c.arrival, departure: c.departure}, c.rules);
    const days = sk.days.map(d=>clean.days.find(x=>x.date === d.date) || d);
    storePlan(trip, c, days, r.provider + ' · ' + r.model, issue ? issue : (prev ? 'Re-planned with AI' : 'Planned with AI') + (j.summary ? ': ' + j.summary : ''));
    const probs = Rules.check({days}, c.rules, Object.assign({}, c, {weather: LOCAL_WEATHER[key]}));
    toast(j.summary ? j.summary : 'Plan updated.' + (probs.some(p=>p.level === 'error') ? ' Some rules still break — see the checker.' : ''));
  }catch(e){
    if(e && e.code !== 'cancelled' && e.message) toast(e.message, 'error');
    btns.forEach(b=>{ if(b.dataset.label) b.innerHTML = b.dataset.label; });
  }finally{ planState.busy = false; planState.ctl = null; }
}

/* ---------------------------------------------------------------- days and items */
const KIND_LABEL = {sight: 'Sight', activity: 'Activity', meal: 'Meal', shopping: 'Shopping', rest: 'Rest', transit: 'Travel', flight: 'Flight', hotel: 'Hotel', free: 'Open'};
function dayCard(d, di, problems, ctx){
  const w = (ctx.weather || LOCAL_WEATHER[planKey(ctx.trip.id, ctx.city)] || {})[d.date];
  const bad = new Set(problems.filter(p=>p.day === di && p.item !== null && p.level !== 'info').map(p=>p.item));
  const route = d.items.filter(i=>i.place && ['sight', 'activity', 'meal', 'shopping'].indexOf(i.kind) >= 0).map(i=>i.place);
  const routeUrl = route.length >= 2 ? 'https://www.google.com/maps/dir/' + [ctx.hotel.name || ctx.city].concat(route).map(p=>encodeURIComponent(p + ', ' + ctx.city)).join('/') : '';
  return `<article class="day card" data-day="${di}">
    <header class="day-head"><div><span class="day-n">Day ${di + 1}</span> <b>${esc(fmtDate(d.date, true))}</b>${d.title ? ` · <span class="muted">${esc(d.title)}</span>` : ''}</div>
      <div class="row">${w ? `<span class="wx small">${wxIcon(w.code)} ${Math.round(w.tmax)}° · ${w.rain}%☂</span>` : ''}${routeUrl ? `<a class="btn ghost small" href="${routeUrl}" target="_blank" rel="noopener">${icon('map')} Route</a>` : ''}<button class="btn ghost small" data-add="${di}">${icon('plus')} Add</button></div></header>
    <ol class="items">${d.items.map((it, ii)=>`<li class="item k-${esc(it.kind)} ${bad.has(ii) ? 'flag' : ''} ${it.locked ? 'locked' : ''}">
      <span class="time">${esc(it.start)}${it.end ? `<small>${esc(it.end)}</small>` : ''}</span>
      <div class="what"><b>${esc(it.title)}</b> <span class="kind">${esc(KIND_LABEL[it.kind] || it.kind)}</span>${it.outdoor ? ' <span class="kind">outdoor</span>' : ''}
        ${it.place ? `<div class="small"><a href="${mapsLink(it.place, ctx.city)}" target="_blank" rel="noopener">📍 ${esc(it.place)}</a></div>` : ''}
        ${it.notes || it.cost ? `<div class="small muted">${esc(it.notes)}${it.cost ? ' · ' + esc(it.cost) : ''}</div>` : ''}</div>
      <div class="item-tools">
        <button class="icon-btn small" data-lock="${di}:${ii}" aria-label="${it.locked ? 'Unlock' : 'Lock'}" title="${it.locked ? 'Locked — the AI keeps it' : 'Lock so the AI keeps it'}">${icon(it.locked ? 'lock' : 'unlock')}</button>
        <button class="icon-btn small" data-edit="${di}:${ii}" aria-label="Edit">${icon('edit')}</button>
        <button class="icon-btn small" data-up="${di}:${ii}" aria-label="Move earlier" ${ii === 0 ? 'disabled' : ''}>${icon('up')}</button>
        <button class="icon-btn small" data-down="${di}:${ii}" aria-label="Move later" ${ii === d.items.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
        <button class="icon-btn small" data-del="${di}:${ii}" aria-label="Delete">${icon('trash')}</button>
      </div></li>`).join('') || '<li class="muted small">Nothing planned.</li>'}</ol></article>`;
}
function bindDays(main, plan, ctx){
  const at = s => s.split(':').map(Number);
  const commit = what => { plan.versions = (plan.versions || []).concat([{at: Date.now(), days: JSON.parse(JSON.stringify(plan._before))}]).slice(-15); delete plan._before; touch(plan); save(); render(); if(what) toast(what); };
  const before = () => { plan._before = JSON.parse(JSON.stringify(plan.days)); };
  main.querySelectorAll('[data-lock]').forEach(b=>b.onclick = ()=>{ const [d, i] = at(b.dataset.lock); before(); plan.days[d].items[i].locked = !plan.days[d].items[i].locked; commit(); });
  main.querySelectorAll('[data-del]').forEach(b=>b.onclick = ()=>{ const [d, i] = at(b.dataset.del); before(); plan.days[d].items.splice(i, 1); commit('Removed — Undo brings it back.'); });
  // moving swaps the time slots, so the order and the times stay consistent
  const swap = (d, i, j) => {                       // i < j, next to each other
    const items = plan.days[d].items, A = items[i], B = items[j], m = Rules.toMin;
    const dur = x => m(x.end) !== null && m(x.start) !== null && m(x.end) > m(x.start) ? m(x.end) - m(x.start) : 60;
    const s0 = m(A.start) !== null ? m(A.start) : 9 * 60, dA = dur(A), dB = dur(B);
    const gap = m(B.start) !== null ? Math.max(0, m(B.start) - (s0 + dA)) : 20;
    B.start = Rules.toTime(s0); B.end = Rules.toTime(s0 + dB);
    A.start = Rules.toTime(s0 + dB + gap); A.end = Rules.toTime(s0 + dB + gap + dA);
    items.sort((x, y)=>(m(x.start) || 0) - (m(y.start) || 0));
  };
  main.querySelectorAll('[data-up]').forEach(b=>b.onclick = ()=>{ const [d, i] = at(b.dataset.up); before(); swap(d, i - 1, i); commit(); });
  main.querySelectorAll('[data-down]').forEach(b=>b.onclick = ()=>{ const [d, i] = at(b.dataset.down); before(); swap(d, i, i + 1); commit(); });
  main.querySelectorAll('[data-edit]').forEach(b=>b.onclick = ()=>{ const [d, i] = at(b.dataset.edit); editItem(plan, d, i, ctx); });
  main.querySelectorAll('[data-add]').forEach(b=>b.onclick = ()=>editItem(plan, +b.dataset.add, -1, ctx));
}
function editItem(plan, di, ii, ctx){
  const it = ii >= 0 ? plan.days[di].items[ii] : {start: '', end: '', title: '', place: '', kind: 'sight', notes: '', outdoor: false, locked: true};
  const card = openModal(`<h2>${ii >= 0 ? 'Edit' : 'Add to'} ${esc(fmtDate(plan.days[di].date, true))}</h2>
    <form id="it-f" class="grid4">
      <label class="span2">What<input id="i-title" required value="${esc(it.title)}"></label>
      <label>Starts<input type="time" id="i-start" value="${esc(it.start)}" required></label>
      <label>Ends<input type="time" id="i-end" value="${esc(it.end)}"></label>
      <label class="span2">Place (for maps)<input id="i-place" value="${esc(it.place)}"></label>
      <label>Kind<select id="i-kind">${Object.entries(KIND_LABEL).map(([k, v])=>`<option value="${k}"${k === it.kind ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Day<select id="i-day">${plan.days.map((d, k)=>`<option value="${k}"${k === di ? ' selected' : ''}>${esc(fmtDate(d.date, true))}</option>`).join('')}</select></label>
      <label class="span4">Notes<input id="i-notes" value="${esc(it.notes)}"></label>
      <label class="check span2"><input type="checkbox" id="i-out" ${it.outdoor ? 'checked' : ''}> Outdoors</label>
      <label class="check span2"><input type="checkbox" id="i-lock" ${it.locked ? 'checked' : ''}> Lock (the AI keeps it as is)</label>
      <div class="row end span4"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
  card.querySelector('#it-f').onsubmit = e=>{
    e.preventDefault();
    const before = JSON.parse(JSON.stringify(plan.days));
    const n = Object.assign({}, it, {id: it.id || uid('i'), title: $('i-title').value.trim(), start: $('i-start').value, end: $('i-end').value, place: $('i-place').value.trim(),
      kind: $('i-kind').value, notes: $('i-notes').value.trim(), outdoor: $('i-out').checked, locked: $('i-lock').checked});
    if(ii >= 0) plan.days[di].items.splice(ii, 1);
    const to = plan.days[+$('i-day').value];
    to.items.push(n);
    to.items.sort((a, b)=>(Rules.toMin(a.start) || 0) - (Rules.toMin(b.start) || 0));
    plan.versions = (plan.versions || []).concat([{at: Date.now(), days: before}]).slice(-15);
    touch(plan); save(); closeModal(); render();
  };
}

/* ---------------------------------------------------------------- rules editor */
function openRules(){
  const r = Rules.merge(S.settings.rules);
  const f = (id, label, v, type, extra) => `<label>${label}<input id="r-${id}" type="${type || 'text'}" value="${esc(v)}" ${extra || ''}></label>`;
  const card = openModal(`<h2>${icon('shield')} Itinerary rules</h2>
    <p class="muted">Every plan follows these — the AI is told them, and the checker flags any plan (AI-made or edited by hand) that breaks one.</p>
    <form id="rules-f">
    <h3>The day</h3><div class="grid4">
      ${f('dayStart', 'Start after', r.dayStart, 'time')}${f('dayEnd', 'Back at hotel by', r.dayEnd, 'time')}
      <label>Pace<select id="r-pace">${['relaxed', 'balanced', 'packed'].map(p=>`<option${p === r.pace ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
      ${f('bufferMin', 'Gap between stops (min)', r.bufferMin, 'number', 'min="0" max="120"')}
      ${f('max-relaxed', 'Max sights: relaxed', r.maxSights.relaxed, 'number', 'min="1" max="10"')}${f('max-balanced', 'balanced', r.maxSights.balanced, 'number', 'min="1" max="10"')}${f('max-packed', 'packed', r.maxSights.packed, 'number', 'min="1" max="12"')}
      ${f('maxTravelMin', 'Longest hop (min)', r.maxTravelMin, 'number')}
      ${f('lunch0', 'Lunch from', r.lunch[0], 'time')}${f('lunch1', 'to', r.lunch[1], 'time')}${f('dinner0', 'Dinner from', r.dinner[0], 'time')}${f('dinner1', 'to', r.dinner[1], 'time')}
    </div>
    <h3>Flights and hotel</h3><div class="grid4">
      ${f('arrivalBufferMin', 'After landing (min)', r.arrivalBufferMin, 'number')}${f('transferMin', 'Hotel ↔ airport (min)', r.transferMin, 'number')}
      ${f('domesticAirportMin', 'At airport, domestic (min)', r.domesticAirportMin, 'number')}${f('internationalAirportMin', 'At airport, international (min)', r.internationalAirportMin, 'number')}
      ${f('checkInTime', 'Hotel check-in', r.checkInTime, 'time')}${f('checkOutTime', 'Hotel check-out', r.checkOutTime, 'time')}
      ${f('rainChance', 'Rain % = indoor day', r.rainChance, 'number')}${f('heatC', 'Too hot at (°C)', r.heatC, 'number')}
    </div>
    <h3>You</h3><div class="grid2">
      ${f('travellers', 'Who is travelling', r.travellers, 'text', 'placeholder="2 adults, 1 child (6), grandparents"')}
      ${f('interests', 'Interests', r.interests, 'text', 'placeholder="history, food, beaches, shopping"')}
      ${f('food', 'Food', r.food, 'text', 'placeholder="vegetarian, Jain, no seafood"')}
      <label>Budget<select id="r-budget">${['budget', 'mid-range', 'luxury'].map(p=>`<option${p === r.budget ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
      ${f('transport', 'Getting around', r.transport)}
      ${f('avoid', 'Avoid', r.avoid, 'text', 'placeholder="treks, crowded markets"')}
      <label class="span2">Any other rule, in your words<textarea id="r-extra" rows="2">${esc(r.extra)}</textarea></label>
    </div>
    <div class="row end"><button type="button" class="btn ghost" id="r-reset">Defaults</button><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save rules</button></div></form>`, {wide: true, noFocus: true});
  card.querySelector('#r-reset').onclick = ()=>{ S.settings.rules = {}; save({quiet: true}); openRules(); };
  card.querySelector('#rules-f').onsubmit = e=>{
    e.preventDefault();
    const v = id => $('r-' + id).value, n = id => +$('r-' + id).value;
    S.settings.rules = {dayStart: v('dayStart'), dayEnd: v('dayEnd'), pace: v('pace'), bufferMin: n('bufferMin'), maxTravelMin: n('maxTravelMin'),
      maxSights: {relaxed: n('max-relaxed'), balanced: n('max-balanced'), packed: n('max-packed')},
      lunch: [v('lunch0'), v('lunch1')], dinner: [v('dinner0'), v('dinner1')],
      arrivalBufferMin: n('arrivalBufferMin'), transferMin: n('transferMin'), domesticAirportMin: n('domesticAirportMin'), internationalAirportMin: n('internationalAirportMin'),
      checkInTime: v('checkInTime'), checkOutTime: v('checkOutTime'), rainChance: n('rainChance'), heatC: n('heatC'),
      travellers: v('travellers').trim(), interests: v('interests').trim(), food: v('food').trim(), budget: v('budget'), transport: v('transport').trim(), avoid: v('avoid').trim(), extra: $('r-extra').value.trim()};
    save(); closeModal(); render(); toast('Rules saved — the checker uses them now; re-plan to have the AI follow them.');
  };
}

function planText(plan, ctx){
  return `${ctx.trip.name} — ${ctx.city} (${fmtRange(plan.start, plan.end)})${plan.hotel && plan.hotel.name ? '\nStaying at ' + plan.hotel.name : ''}\n\n` +
    plan.days.map((d, i)=>`Day ${i + 1} · ${fmtDate(d.date, true)}${d.title ? ' · ' + d.title : ''}\n` +
      d.items.map(it=>`  ${it.start}${it.end ? '–' + it.end : ''}  ${it.title}${it.place ? ' (' + it.place + ')' : ''}${it.notes ? ' — ' + it.notes : ''}`).join('\n')).join('\n\n');
}
