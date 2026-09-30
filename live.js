"use strict";
/* =========================================================
   NEWS and FLIGHTS — what is happening now at the destination and to your flights.
   ========================================================= */

/* ================================================================ News */
const newsState = {busy: false, deep: false, autoDone: new Set()};
VIEWS.news = function(main, cur){
  if(!cur){ main.innerHTML = `<div class="card"><p>Pick or create a trip to see the news for where you are going.</p></div>`; return; }
  const cities = citiesOf(cur);
  const city = newsState.trip === cur.id && newsState.city ? newsState.city : ((cities[0] || {}).city || '');
  const country = ((cities.find(c=>c.city === city) || {}).country) || cur.country || '';
  newsState.trip = cur.id; newsState.city = city;
  const n = LOCAL.news[cur.id + '|' + city.toLowerCase()];
  const sum = n && n.summary;
  const STATUS = {clear: ['All clear', 'Nothing unusual reported'], caution: ['Be aware', 'Some things to keep an eye on'], serious: ['Serious', 'Read before you travel']};
  const art = a => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a><span class="muted small"> · ${esc(a.source)}${a.date ? ' · ' + esc(ago(Date.parse(a.date))) : ''}</span></li>`;
  const col = (title, list, emptyText) => `<section class="card news-col"><h2>${title}</h2>${list && list.length ? `<ul class="news-list">${list.slice(0, 12).map(art).join('')}</ul>` : `<p class="muted small">${emptyText}</p>`}</section>`;
  main.innerHTML = `
  <section class="section-head"><div><h1>${esc(city || cur.name)}${country && country !== city ? `<span class="muted">, ${esc(country)}</span>` : ''}</h1></div>
    <div class="row">
      ${cities.length > 1 ? `<select id="n-city">${cities.map(c=>`<option${c.city === city ? ' selected' : ''}>${esc(c.city)}</option>`).join('')}</select>` : ''}
      ${Cloud.canSearch() ? `<label class="check small"><input type="checkbox" id="n-deep" ${newsState.deep ? 'checked' : ''}> AI also searches the web</label>` : ''}
      <button class="btn primary" id="n-go" ${city ? '' : 'disabled'}>${icon('refresh')} ${n ? 'Check again' : 'Check now'}</button></div></section>
  ${!city ? '<div class="card">Set the trip’s city first (Trips → Edit).</div>' : ''}
  <div id="n-progress"></div>
  ${sum ? `<section class="card news-sum s-${esc(sum.status)}">
      <div class="sum-head"><span class="status-pill">${esc((STATUS[sum.status] || STATUS.clear)[0])}</span><b>${esc(sum.headline)}</b></div>
      <ul>${(sum.points || []).map(p=>`<li>${esc(p)}</li>`).join('')}</ul>
      ${sum.flights ? `<p>✈️ <b>Flights:</b> ${esc(sum.flights)}</p>` : ''}
      ${sum.advice ? `<p>👉 <b>What to do:</b> ${esc(sum.advice)}</p>` : ''}
      ${(sum.sources || []).length ? `<details><summary class="small">Web sources (${sum.sources.length})</summary><ul class="small">${sum.sources.slice(0, 10).map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a></li>`).join('')}</ul></details>` : ''}
      <p class="muted small">AI summary by ${esc(sum.by)} · ${esc(ago(sum.at))}. It can be wrong — check official sources for decisions.</p>
    </section>` : n && n.summaryError ? `<section class="card notice"><b>No AI summary:</b> ${esc(n.summaryError)}</section>` : ''}
  ${n && n.advisory ? `<section class="card advisory lvl-${n.advisory.level}">
      <div class="row">${icon('shield')}<b>${esc(n.advisory.levelText)}</b>${n.advisory.updated ? `<span class="muted small">updated ${esc(fmtDate(n.advisory.updated.slice(0, 10)))}</span>` : ''}</div>
      ${n.advisory.change ? `<p class="small">${esc(n.advisory.change)}</p>` : ''}
      ${n.advisory.summary ? `<details><summary class="small">Read the warnings</summary><p class="small">${esc(n.advisory.summary.slice(0, 2500))}</p></details>` : ''}
      ${n.advisory.url ? `<a class="small" href="${esc(n.advisory.url)}" target="_blank" rel="noopener">UK Foreign Office travel advice ${icon('ext')}</a>` : ''}
      <span class="muted small"> · also see your own government’s advisory (e.g. <a href="https://www.mea.gov.in" target="_blank" rel="noopener">MEA India</a>)</span>
    </section>` : ''}
  ${n && n.weather && Object.keys(n.weather).length ? `<section class="weather-strip card">${Object.entries(n.weather).map(([d, w])=>`<span class="wx ${w.rain >= 60 ? 'wet' : ''}"><b>${esc(fmtDate(d))}</b> ${wxIcon(w.code)} ${Math.round(w.tmax)}° · ${w.rain}%☂ <span class="muted">${esc(w.text)}</span></span>`).join('')}</section>` : ''}
  ${n ? `<div class="news-grid">
      ${col('✈️ Flights &amp; airports', n.travel, 'No reports of cancellations, closures or strikes in the last few days.')}
      ${col('🛡️ Safety &amp; geopolitics', n.security, 'No conflict, unrest or security news found in the last week.')}
      ${col('📰 ' + esc(city), n.city, 'No recent headlines found.')}
    </div>
    <p class="muted small">Checked ${esc(ago(n.at))} · headlines from GDELT (worldwide news), advice from gov.uk, weather from Open-Meteo.${(n.errors || []).length ? ' Problems: ' + esc(n.errors.join('; ')) : ''}</p>`
  : city ? `<section class="card"><p class="muted">Check what’s happening in ${esc(city)}: local news, war or unrest, strikes and flight cancellations, government travel advice and the weather — with an AI summary of what it means for your trip.</p></section>` : ''}`;
  if($('n-city')) $('n-city').onchange = e=>{ newsState.city = e.target.value; render(); };
  if($('n-deep')) $('n-deep').onchange = e=>{ newsState.deep = e.target.checked; };
  if($('n-go')) $('n-go').onclick = ()=>checkNews(cur, city, country);
  // stale (over 6 h) or never checked: check by itself when the tab opens
  const nk = cur.id + '|' + city.toLowerCase();
  if(city && (!n || Date.now() - n.at > 6 * 3600000) && !newsState.busy && !newsState.autoDone.has(nk)){ newsState.autoDone.add(nk); checkNews(cur, city, country); }
};
async function checkNews(trip, city, country){
  if(newsState.busy) return;
  newsState.busy = true;
  const prog = m => { const el = $('n-progress'); if(el) el.innerHTML = `<div class="card row"><span class="spinner"></span> ${esc(m)}</div>`; };
  try{
    const span = tripSpan(trip);
    const fl = flightsOf(trip.id);
    const airports = cityAirports(city).slice(0, 3);
    let loc = null;
    try{ loc = await cityLoc(city, country); }catch(e){}
    if(!country && loc) country = loc.country;
    prog('Reading the government travel advice…');
    const [advisory, weather] = await Promise.all([
      News.advisory(country).catch(()=>null),
      loc ? Geo.weather(loc, daysUntil(span.start || todayISO()) > 0 ? span.start : todayISO(), span.end && span.end >= todayISO() ? span.end : Rules.addDays(todayISO(), 6)).catch(()=>null) : null,
    ]);
    const h = await News.headlines(city, country, airports, prog);
    const n = Object.assign({at: Date.now(), advisory, weather}, h);
    if(Cloud.aiAvailable()){
      prog('The AI is reading it all…');
      // no headlines (the news service busy or down): the AI searches the web itself when it can
      const noHeadlines = !n.city.length && !n.security.length && !n.travel.length && n.errors.length;
      try{ n.summary = await News.summarise({city, country, start: span.start, end: span.end, flights: fl}, n, {search: (newsState.deep || noHeadlines) && Cloud.canSearch()}); }
      catch(e){ n.summaryError = e.message; }
    } else n.summaryError = 'Add a free AI key in Settings for a summary.';
    LOCAL.news[trip.id + '|' + city.toLowerCase()] = n;
    LOCAL.news[trip.id] = n;                    // the itinerary planner reads the latest
    saveLocal();
  }catch(e){ toast(e.message, 'error'); }
  finally{ newsState.busy = false; if(tab === 'news') render(); }
}

/* ================================================================ Flights */
const STATE_TEXT = {'scheduled': ['Scheduled', 'ok'], 'on-time': ['On time', 'good'], 'delayed': ['Delayed', 'warn'], 'boarding': ['Boarding', 'good'], 'departed': ['Departed', 'good'],
  'airborne': ['In the air', 'good'], 'landed': ['Landed', 'ok'], 'cancelled': ['Cancelled', 'bad'], 'diverted': ['Diverted', 'bad'], 'not-operating': ['Not operating that day', 'bad'], 'unknown': ['No live data yet', 'muted']};
let flightTimer = null;
VIEWS.flights = function(main, cur){
  const all = cur ? flightsOf(cur.id) : flightsOf('');
  const upcoming = all.filter(f=>!f.date || f.date >= Rules.addDays(todayISO(), -1));
  const past = all.filter(f=>f.date && f.date < Rules.addDays(todayISO(), -1));
  const fk = S.settings.flightKeys || {};
  const hasSource = fk.aerodatabox || fk.airlabs || Cloud.canSearch();
  main.innerHTML = `
  <section class="section-head"><div><h1>${esc(cur ? cur.name : 'All flights')}</h1></div>
    <div class="row"><button class="btn primary" id="fl-all" ${upcoming.length && hasSource ? '' : 'disabled'}>${icon('refresh')} Check all</button><button class="btn soft" id="fl-add">${icon('plus')} Add a flight</button></div></section>
  ${!hasSource ? `<section class="card notice"><b>Live status needs one free key.</b> Add an AeroDataBox or AirLabs key, or a Google Gemini key (AI searches the web) in <a href="#" id="fl-keys">Settings → Flight status</a>. The links on each flight work without one.</section>` : ''}
  <section class="flight-list">${upcoming.map(flightCard).join('') || `<div class="card muted">No upcoming flights${cur ? ' in this trip' : ''}. Upload a ticket or boarding pass, or add a flight by number.</div>`}</section>
  ${past.length ? `<details class="past"><summary>Past flights (${past.length})</summary><section class="flight-list">${past.map(flightCard).join('')}</section></details>` : ''}
  <p class="muted small">Flights leaving within 36 hours are re-checked every 10 minutes while this tab is open.</p>`;
  if($('fl-keys')) $('fl-keys').onclick = e=>{ e.preventDefault(); openSettings('flights'); };
  $('fl-add').onclick = ()=>addFlight(cur);
  $('fl-all').onclick = async ()=>{ for(const f of upcoming) await checkFlight(f); };
  main.querySelectorAll('[data-check]').forEach(b=>b.onclick = ()=>checkFlight(all.find(f=>f.key === b.dataset.check)));
  main.querySelectorAll('[data-open-doc]').forEach(b=>b.onclick = ()=>openViewer(b.dataset.openDoc));
  bindOpenDocs(main);
  main.querySelectorAll('[data-del-flight]').forEach(b=>b.onclick = ()=>{ remove('flightsExtra', b.dataset.delFlight); save(); render(); });
  // auto-check: flights soon, not checked in the last 10 minutes
  clearInterval(flightTimer);
  const due = () => hasSource && upcoming.filter(f=>{ const h = hoursUntil(f); const st = LOCAL.flightStatus[f.key]; return h > -6 && h < 36 && (!st || Date.now() - st.at > 10 * 60000); });
  const tick = async () => { if(tab !== 'flights'){ clearInterval(flightTimer); return; } for(const f of due() || []) await checkFlight(f, true); };
  flightTimer = setInterval(tick, 60000);
  tick();
};
function hoursUntil(f){
  if(!f.date) return 999;
  return (Date.parse(f.date + 'T' + (f.dep || '12:00') + ':00') - Date.now()) / 3600000;
}
function flightCard(f){
  const st = LOCAL.flightStatus[f.key];
  const [label, tone] = st ? (STATE_TEXT[st.state] || STATE_TEXT.unknown) : ['Not checked', 'muted'];
  const L = Flights.links(f.flight, f.date);
  const from = Parse.airport(f.from), to = Parse.airport(f.to);
  const dep = st && st.dep || {}, arr = st && st.arr || {};
  const h = hoursUntil(f);
  const when = h > 48 ? 'in ' + Math.round(h / 24) + ' days' : h > 1 ? 'in ' + Math.round(h) + ' h' : h > -1 ? 'now' : '';
  const t = (sched, est, act) => { const s = sched || ''; const e = act || est || ''; return e && s && e !== s ? `<s>${esc(s)}</s> <b class="warn-text">${esc(e)}</b>` : `<b>${esc(s || e || '—')}</b>`; };
  return `<article class="flight card tone-${tone}">
    <div class="fl-top"><div><span class="fl-no">${esc(f.flight)}</span> <span class="muted small">${esc(f.airline || Parse.airline(f.flight.slice(0, 2)) || '')}</span></div>
      <span class="status-pill t-${tone}">${esc(label)}${st && st.delayMin >= 5 && st.state !== 'cancelled' ? ' · ' + st.delayMin + ' min' : ''}</span></div>
    <div class="fl-route">
      <div><div class="iata">${esc(f.from || '???')}</div><div class="muted small">${esc(from ? from.city : '')}</div><div>${t(dep.scheduled || f.dep, dep.estimated, dep.actual)}</div>${dep.terminal || dep.gate || f.terminal || f.gate ? `<div class="small">${dep.terminal || f.terminal ? 'T' + esc(dep.terminal || f.terminal) : ''} ${dep.gate || f.gate ? '· Gate ' + esc(dep.gate || f.gate) : ''}</div>` : ''}</div>
      <div class="fl-mid">${icon('plane')}<div class="small muted">${esc(fmtDate(f.date, true))}${when ? ' · ' + esc(when) : ''}</div></div>
      <div class="right"><div class="iata">${esc(f.to || '???')}</div><div class="muted small">${esc(to ? to.city : '')}</div><div>${t(arr.scheduled || f.arr, arr.estimated, arr.actual)}</div>${arr.belt ? `<div class="small">Belt ${esc(arr.belt)}</div>` : ''}</div>
    </div>
    ${(f.travellers || []).length ? `<p class="small fl-people">${icon('user')} ${f.travellers.length > 1 ? f.travellers.length + ' travellers: ' : ''}${esc(travellersText(f))}</p>` : ''}
    ${st && st.note ? `<p class="small">${esc(st.note)}</p>` : ''}
    ${st && st.error ? `<p class="small err">${esc(st.error)}</p>` : ''}
    <div class="fl-foot small">
      <span class="muted">${st ? esc(st.source || '') + ' · ' + esc(ago(st.at)) + (st.approximate ? ' · from web search, confirm with the airline' : '') : ''}</span>
      <span class="grow"></span>
      ${f.passes.length ? `<button class="btn soft small" data-open-docs="${esc(f.allDocs.join(','))}">🎫 ${f.passes.length > 1 ? f.passes.length + ' boarding passes' : 'Boarding pass'}</button>` : f.docs.length ? `<button class="btn ghost small" data-open-docs="${esc(f.allDocs.join(','))}">${f.docs.length > 1 ? f.docs.length + ' tickets' : 'Ticket'}</button>` : ''}
      <a class="btn ghost small" href="${L.flightaware}" target="_blank" rel="noopener">FlightAware</a><a class="btn ghost small" href="${L.fr24}" target="_blank" rel="noopener">Flightradar24</a>
      ${f.manual ? `<button class="icon-btn small" data-del-flight="${esc(f.manual)}" aria-label="Remove">${icon('trash')}</button>` : ''}
      <button class="btn soft small" data-check="${esc(f.key)}">${icon('refresh')} Check</button>
    </div></article>`;
}
const checking = new Set();
async function checkFlight(f, quiet){
  if(!f || checking.has(f.key)) return;
  checking.add(f.key);
  const btn = document.querySelector(`[data-check="${CSS.escape(f.key)}"]`);
  if(btn) btn.innerHTML = '<span class="spinner"></span> Checking';
  try{
    if(!f.date) throw new Error('Add the flight date to check it.');
    const st = await Flights.status(f.flight, f.date, S.settings.flightKeys || {}, f);
    LOCAL.flightStatus[f.key] = st;
    const prev = LOCAL.flightStatus[f.key + '#last'];
    if(prev && prev !== st.state && ['delayed', 'cancelled', 'diverted'].indexOf(st.state) >= 0) notify(f, st);
    LOCAL.flightStatus[f.key + '#last'] = st.state;
  }catch(e){
    LOCAL.flightStatus[f.key] = Object.assign({}, LOCAL.flightStatus[f.key] || {state: 'unknown'}, {error: e.message, at: Date.now()});
    if(!quiet) toast(e.message, 'error');
  }finally{
    checking.delete(f.key); saveLocal();
    if(tab === 'flights') render();
  }
}
function notify(f, st){
  const text = `${f.flight} ${f.from}→${f.to}: ${(STATE_TEXT[st.state] || [st.state])[0]}${st.delayMin ? ' ' + st.delayMin + ' min' : ''}`;
  toast(text, 'error');
  try{ if('Notification' in window && Notification.permission === 'granted') new Notification('Trip Vault', {body: text}); }catch(e){}
}
function addFlight(cur){
  const card = openModal(`<h2>Add a flight</h2><form id="af" class="grid2">
    <label>Flight number<input id="af-no" required placeholder="6E 2134" autocapitalize="characters"></label>
    <label>Date<input id="af-date" type="date" required value="${esc(cur ? tripSpan(cur).start || '' : '')}"></label>
    <label>From (optional)<input id="af-from" maxlength="3" placeholder="DEL"></label><label>To (optional)<input id="af-to" maxlength="3" placeholder="BOM"></label>
    <label>Departs (optional)<input id="af-dep" type="time"></label><label>Who<input id="af-who" list="af-ppl"><datalist id="af-ppl">${S.people.map(p=>`<option value="${esc(p.name)}">`).join('')}</datalist></label>
    <div class="row end span2"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Add</button></div></form>`);
  card.querySelector('#af').onsubmit = e=>{
    e.preventDefault();
    const no = $('af-no').value.toUpperCase().replace(/[\s-]/g, '');
    if(!/^[A-Z0-9]{2}\d{1,4}$/.test(no)) return toast('A flight number looks like 6E2134 or AI101.', 'error');
    S.flightsExtra.push(touch({id: uid('x'), tripId: cur ? cur.id : '', flight: no, date: $('af-date').value, from: $('af-from').value.toUpperCase(), to: $('af-to').value.toUpperCase(), dep: $('af-dep').value, person: $('af-who').value.trim(), airline: Parse.airline(no.slice(0, 2))}));
    save(); closeModal(); render();
    try{ if('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }catch(err){}
  };
}
