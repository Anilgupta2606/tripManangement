"use strict";
/* =========================================================
   CHECKLIST — the documents a trip must have, for each traveller and for the trip,
   ticked off by the documents you upload (with passport and visa validity checked),
   or by hand; and RULES — which documents are required, and your own planning rules,
   all editable.
   ========================================================= */

const checkState = {view: 'list'};
const docRules = () => S.settings.docRules || Rules.DOC_RULES.map(r=>Object.assign({}, r));
function saveDocRules(list){ S.settings.docRules = list; save(); }
const tripChecks = id => { S.checks = S.checks || {}; return S.checks[id] || (S.checks[id] = {ticks: {}, custom: []}); };
const STATUS = {done: ['✓', 'Ready'], ticked: ['✓', 'Ticked'], expiring: ['!', 'Check validity'], missing: ['', 'Missing']};

/* The checklist of a trip, with what it is built from. */
function checklistOf(trip){
  const span = tripSpan(trip);
  const t = {id: trip.id, start: span.start, end: span.end, country: trip.country || '', international: isInternationalTrip(trip), hasFlights: flightsOf(trip.id).length > 0};
  const people = travellersOf(trip);
  const c = tripChecks(trip.id);
  const items = Rules.checklist(t, people, S.docs, docRules(), c.ticks, c.custom);
  const needed = items.filter(i=>i.rule.required);
  return {t, people, items, ready: items.filter(i=>i.status === 'done' || i.status === 'ticked').length,
    missing: needed.filter(i=>i.status === 'missing' || i.status === 'expiring')};
}

VIEWS.check = function(main, cur){
  const seg = `<div class="seg" role="tablist" aria-label="Checklist or rules">
    <button role="tab" class="${checkState.view === 'list' ? 'on' : ''}" aria-selected="${checkState.view === 'list'}" data-view="list">${icon('check')} Checklist</button>
    <button role="tab" class="${checkState.view === 'rules' ? 'on' : ''}" aria-selected="${checkState.view === 'rules'}" data-view="rules">${icon('shield')} Rules</button></div>`;
  if(checkState.view === 'rules') drawRules(main, seg);
  else if(!cur){ main.innerHTML = `<section class="section-head"><h1>Checklist</h1>${seg}</section><div class="card"><p>Create a trip first — its checklist follows from where you go and who travels.</p><button class="btn primary" onclick="VIEWS.newTrip()">New trip</button></div>`; }
  else drawChecklist(main, cur, seg);
  main.querySelectorAll('[data-view]').forEach(b=>b.onclick = ()=>{ checkState.view = b.dataset.view; render(); });
};

/* ---------------------------------------------------------------- the checklist */
function drawChecklist(main, trip, seg){
  const L = checklistOf(trip), total = L.items.length;
  const pct = total ? Math.round(L.ready / total * 100) : 0;
  const row = i => {
    const [mark, label] = STATUS[i.status];
    const req = i.rule.required ? '<span class="req">Required</span>' : '<span class="opt">Optional</span>';
    const what = i.doc ? `<button class="linkish" data-open-doc="${esc(i.doc.id)}">${esc(i.doc.title)}</button>` : '';
    return `<li class="ck ck-${i.status}">
      <button class="ck-box" data-tick="${esc(i.key)}" ${i.status === 'done' ? 'disabled title="Ticked by the uploaded document"' : ''} aria-label="${i.status === 'ticked' ? 'Untick' : 'Tick'} ${esc(i.rule.name)}">${mark}</button>
      <div class="ck-text"><b>${esc(i.rule.name)}</b> ${req}
        <div class="small muted">${i.status === 'expiring' ? `<span class="warn-text">${esc(i.why)}</span> · ` : ''}${what || (i.status === 'ticked' ? 'Ticked by hand' : i.rule.types && i.rule.types.length ? 'Upload it and it ticks itself' : 'Tick it when you have it')}${i.rule.note && i.status !== 'done' ? ' · ' + esc(i.rule.note) : ''}</div></div>
      <div class="ck-act">${i.status === 'missing' && i.rule.types && i.rule.types.length ? `<button class="btn soft small" data-upload="${esc(i.person)}">${icon('upload')} Upload</button>` : ''}
        ${i.rule.custom ? `<button class="icon-btn small" data-del-item="${esc(i.rule.cid)}" aria-label="Remove this item">${icon('trash')}</button>` : ''}</div>
    </li>`;
  };
  const groups = L.people.map(p=>({title: p, items: L.items.filter(i=>i.person === p)})).concat([{title: 'For the trip', items: L.items.filter(i=>!i.person)}]).filter(g=>g.items.length);
  const others = S.people.map(p=>p.name).filter(n=>!L.people.some(x=>nameKey(x) === nameKey(n)));
  main.innerHTML = `
  <section class="section-head"><div><h1>Checklist</h1><p class="muted">${esc(trip.name)} — ${L.t.international ? 'international trip' : 'trip at home'}${trip.country ? ' to ' + esc(trip.country) : ''}</p></div>${seg}</section>
  <section class="card ck-sum ${L.missing.length ? 'has-missing' : 'all-good'}">
    <div class="ck-sum-top"><div><b class="ck-big">${L.ready} of ${total}</b> ready</div>
      <span class="status-pill ${L.missing.length ? 't-warn' : 't-good'}">${L.missing.length ? L.missing.length + ' required missing' : 'All required documents are here'}</span></div>
    <div class="ck-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
    <div class="ck-people"><span class="muted small">Travelling:</span> ${L.people.map(p=>`<span class="chip">${esc(p)} <button class="chip-x" data-off="${esc(p)}" aria-label="${esc(p)} is not travelling">×</button></span>`).join('') || '<span class="muted small">no one yet — add who travels</span>'}
      <form id="add-trav" class="inline-add"><input id="trav-n" list="trav-dl" placeholder="Add a traveller"><datalist id="trav-dl">${others.map(n=>`<option value="${esc(n)}">`).join('')}</datalist><button class="btn soft small">Add</button></form></div>
  </section>
  ${groups.map(g=>`<section class="card ck-group"><h2>${g.title === 'For the trip' ? icon('home') : icon('user')} ${esc(g.title)} <span class="muted small">${g.items.filter(i=>i.status === 'done' || i.status === 'ticked').length} of ${g.items.length}</span></h2><ul class="ck-list">${g.items.map(row).join('')}</ul></section>`).join('')
    || `<section class="card"><p class="muted">No rule applies to this trip yet. Add items below, or check the <a href="#" data-view="rules">rules</a>.</p></section>`}
  <section class="card">
    <h2>Add an item to this trip</h2>
    <form id="add-item" class="grid4">
      <label class="span2">What<input id="it-text" required placeholder="Printed hotel address, vaccination card…"></label>
      <label>For<select id="it-per"><option value="trip">The trip</option><option value="traveller">Each traveller</option></select></label>
      <label class="check" style="align-self:end"><input type="checkbox" id="it-req" checked> Required</label>
      <div class="row end span4"><button class="btn primary">Add to the checklist</button></div>
    </form>
  </section>`;
  const c = tripChecks(trip.id);
  const changed = () => { c.updatedAt = Date.now(); save(); render(); };
  main.querySelectorAll('[data-tick]').forEach(b=>b.onclick = ()=>{
    const k = b.dataset.tick;
    if(c.ticks[k] && c.ticks[k].done) delete c.ticks[k]; else c.ticks[k] = {done: true, at: Date.now()};
    changed();
  });
  main.querySelectorAll('[data-del-item]').forEach(b=>b.onclick = ()=>{ c.custom = c.custom.filter(x=>x.id !== b.dataset.delItem); changed(); });
  main.querySelectorAll('[data-upload]').forEach(b=>b.onclick = ()=>{ location.hash = 'docs'; setTimeout(()=>$('file-in') && $('file-in').click(), 60); });
  main.querySelectorAll('[data-open-doc]').forEach(b=>b.onclick = ()=>openViewer(b.dataset.openDoc));
  main.querySelectorAll('[data-off]').forEach(b=>b.onclick = ()=>{
    const n = b.dataset.off;
    trip.travellers = (trip.travellers || []).filter(x=>nameKey(x) !== nameKey(n));
    trip.notTravelling = (trip.notTravelling || []).concat([n]);
    touch(trip); save(); render();
  });
  $('add-trav').onsubmit = e=>{
    e.preventDefault();
    const n = $('trav-n').value.trim();
    if(!n) return;
    addPerson(n);
    trip.notTravelling = (trip.notTravelling || []).filter(x=>nameKey(x) !== nameKey(n));
    if(!(trip.travellers || []).some(x=>nameKey(x) === nameKey(n))) trip.travellers = (trip.travellers || []).concat([Parse.titleCase(n)]);
    touch(trip); save(); render();
  };
  $('add-item').onsubmit = e=>{
    e.preventDefault();
    c.custom.push({id: uid('i'), text: $('it-text').value.trim(), per: $('it-per').value, required: $('it-req').checked});
    changed(); toast('Added to the checklist.');
  };
}

/* ---------------------------------------------------------------- the rules */
function drawRules(main, seg){
  const rules = docRules();
  const plan = S.settings.planRules || [];
  const typesText = r => (r.types || []).length ? r.types.map(t=>Parse.TYPE_LABEL[t] || t).join(' or ') : 'Ticked by hand';
  const r0 = Rules.merge(S.settings.rules);
  main.innerHTML = `
  <section class="section-head"><div><h1>Rules</h1><p class="muted">What every trip must have, and how its days are planned. Add, change or remove any rule.</p></div>${seg}</section>
  <section class="card">
    <div class="section-head"><h2>${icon('doc')} Documents a trip needs</h2><div class="row"><button class="btn ghost small" id="rules-reset">Restore the standard rules</button><button class="btn primary small" id="rule-add">${icon('plus')} Add a rule</button></div></div>
    <div class="rules-table" role="table">
      <div class="rt-head" role="row"><span>Document</span><span>Needed for</span><span>When</span><span>Ticked by</span><span></span></div>
      ${rules.map((r, i)=>`<div class="rt-row ${r.off ? 'off' : ''}" role="row">
        <span><b>${esc(r.name)}</b> ${r.required ? '<span class="req">Required</span>' : '<span class="opt">Optional</span>'}${r.validMonths ? `<div class="small muted">valid ${r.validMonths} months after return</div>` : r.validThrough ? '<div class="small muted">valid for the whole trip</div>' : ''}${r.except ? `<div class="small muted">not for ${esc(r.except)}</div>` : ''}</span>
        <span>${r.per === 'trip' ? 'The trip' : 'Each traveller'}</span>
        <span>${esc(Rules.WHEN[r.when] || r.when)}${r.when === 'countries' && r.countries ? ': ' + esc(r.countries) : ''}</span>
        <span>${esc(typesText(r))}</span>
        <span class="rt-act"><label class="check small" title="Use this rule"><input type="checkbox" data-rule-on="${i}" ${r.off ? '' : 'checked'}> on</label>
          <button class="icon-btn small" data-rule-edit="${i}" aria-label="Edit ${esc(r.name)}">${icon('edit')}</button>
          <button class="icon-btn small" data-rule-del="${i}" aria-label="Delete ${esc(r.name)}">${icon('trash')}</button></span>
      </div>`).join('')}
    </div>
    <div class="row" style="margin-top:12px"><label class="home-c">Home country (trips elsewhere are international)<input id="home-c" value="${esc(homeCountry())}"></label></div>
  </section>
  <section class="card">
    <div class="section-head"><h2>${icon('map')} How the days are planned</h2><button class="btn soft small" id="plan-rules">${icon('shield')} Edit the planning settings</button></div>
    <p class="small muted">Days run ${esc(r0.dayStart)}–${esc(r0.dayEnd)} · ${esc(r0.pace)} pace (${r0.maxSights[r0.pace]} sights a day) · ${r0.bufferMin} min between stops · lunch ${esc(r0.lunch[0])}–${esc(r0.lunch[1])}, dinner ${esc(r0.dinner[0])}–${esc(r0.dinner[1])} · at the airport ${r0.domesticAirportMin / 60} h before domestic, ${r0.internationalAirportMin / 60} h before international flights${r0.food ? ' · ' + esc(r0.food) : ''}.</p>
    <h3 class="sub-h">Your own rules</h3>
    <p class="small muted">In your words. The AI planner follows every rule that is on.</p>
    <ul class="own-rules">${plan.map((r, i)=>`<li class="${r.on === false ? 'off' : ''}"><label class="check"><input type="checkbox" data-pr-on="${i}" ${r.on === false ? '' : 'checked'}></label>
      <span class="own-text">${esc(r.text)}</span>
      <button class="icon-btn small" data-pr-edit="${i}" aria-label="Edit rule">${icon('edit')}</button><button class="icon-btn small" data-pr-del="${i}" aria-label="Delete rule">${icon('trash')}</button></li>`).join('') || '<li class="muted small">None yet.</li>'}</ul>
    <form id="pr-add" class="inline-add wide"><input id="pr-text" placeholder="e.g. No sightseeing on the first evening · Keep 2 hours free each afternoon" required><button class="btn primary small">${icon('plus')} Add</button></form>
  </section>`;
  const setRules = list => { saveDocRules(list); render(); };
  $('rule-add').onclick = ()=>editDocRule(-1);
  $('rules-reset').onclick = async ()=>{ if(await confirmBox('Restore the standard rules?', 'Your own document rules and changes are replaced by the standard ones.', 'Restore')){ delete S.settings.docRules; save(); render(); } };
  main.querySelectorAll('[data-rule-edit]').forEach(b=>b.onclick = ()=>editDocRule(+b.dataset.ruleEdit));
  main.querySelectorAll('[data-rule-del]').forEach(b=>b.onclick = async ()=>{ const list = docRules(); if(await confirmBox('Delete this rule?', list[+b.dataset.ruleDel].name)){ list.splice(+b.dataset.ruleDel, 1); setRules(list); } });
  main.querySelectorAll('[data-rule-on]').forEach(c=>c.onchange = ()=>{ const list = docRules(); list[+c.dataset.ruleOn].off = !c.checked; setRules(list); });
  $('home-c').onchange = e=>{ S.settings.homeCountry = e.target.value.trim() || 'India'; save(); toast('Home country saved.'); };
  countryPicker($('home-c'));
  $('plan-rules').onclick = ()=>openRules();
  const setPlan = list => { S.settings.planRules = list; save(); render(); };
  $('pr-add').onsubmit = e=>{ e.preventDefault(); const t = $('pr-text').value.trim(); if(t) setPlan(plan.concat([{id: uid('r'), text: t, on: true}])); };
  main.querySelectorAll('[data-pr-on]').forEach(c=>c.onchange = ()=>{ plan[+c.dataset.prOn].on = c.checked; setPlan(plan); });
  main.querySelectorAll('[data-pr-del]').forEach(b=>b.onclick = ()=>{ plan.splice(+b.dataset.prDel, 1); setPlan(plan); });
  main.querySelectorAll('[data-pr-edit]').forEach(b=>b.onclick = async ()=>{
    const i = +b.dataset.prEdit;
    const card = openModal(`<h2>Edit rule</h2><form id="pr-f"><label>Rule<textarea id="pr-v" rows="3">${esc(plan[i].text)}</textarea></label><div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
    card.querySelector('#pr-f').onsubmit = e=>{ e.preventDefault(); const t = $('pr-v').value.trim(); if(t){ plan[i].text = t; closeModal(); setPlan(plan); } };
  });
}

/* Add (i = -1) or change a document rule. */
function editDocRule(i){
  const list = docRules();
  const r = i >= 0 ? list[i] : {id: uid('r'), name: '', per: 'traveller', when: 'always', types: [], required: true};
  const types = Object.entries(Parse.TYPE_LABEL).filter(([k])=>k !== 'other');
  const card = openModal(`<h2>${i >= 0 ? 'Edit the rule' : 'Add a rule'}</h2>
    <form id="dr-f" class="grid2">
      <label class="span2">Document<input id="dr-name" required value="${esc(r.name)}" placeholder="e.g. Vaccination certificate"></label>
      <label>Needed for<select id="dr-per"><option value="traveller">Each traveller</option><option value="trip">The trip (once)</option></select></label>
      <label>When<select id="dr-when">${Object.entries(Rules.WHEN).map(([k, v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <label class="span2" id="dr-c-wrap">Countries (comma separated)<input id="dr-countries" value="${esc(r.countries || '')}" placeholder="Thailand, Singapore"></label>
      <label class="span2">Not for these countries<input id="dr-except" value="${esc(r.except || '')}" placeholder="e.g. visa-free: Thailand, Nepal, Bhutan"></label>
      <fieldset class="span2 types"><legend>Ticked by uploading</legend>${types.map(([k, v])=>`<label class="check"><input type="checkbox" value="${k}" ${(r.types || []).indexOf(k) >= 0 ? 'checked' : ''}> ${esc(v)}</label>`).join('')}
        <p class="small muted">None ticked: you tick it by hand.</p></fieldset>
      <label>Valid at least … months after return<input id="dr-months" type="number" min="0" max="24" value="${r.validMonths || ''}" placeholder="—"></label>
      <label class="check" style="align-self:end"><input type="checkbox" id="dr-through" ${r.validThrough ? 'checked' : ''}> Valid for the whole trip</label>
      <label class="check"><input type="checkbox" id="dr-req" ${r.required ? 'checked' : ''}> Required</label>
      <label class="check"><input type="checkbox" id="dr-any" ${r.anyTrip ? 'checked' : ''}> Use it from any trip (passports, IDs)</label>
      <label class="span2">Note<input id="dr-note" value="${esc(r.note || '')}"></label>
      <div class="row end span2"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${i >= 0 ? 'Save' : 'Add the rule'}</button></div>
    </form>`, {wide: true});
  card.querySelector('#dr-per').value = r.per || 'traveller';
  card.querySelector('#dr-when').value = r.when || 'always';
  const showC = () => { card.querySelector('#dr-c-wrap').hidden = card.querySelector('#dr-when').value !== 'countries'; };
  card.querySelector('#dr-when').onchange = showC; showC();
  card.querySelector('#dr-f').onsubmit = e=>{
    e.preventDefault();
    const n = Object.assign({}, r, {
      name: $('dr-name').value.trim(), per: $('dr-per').value, when: $('dr-when').value, countries: $('dr-countries').value.trim(), except: $('dr-except').value.trim(),
      types: Array.from(card.querySelectorAll('.types input:checked')).map(x=>x.value),
      validMonths: +$('dr-months').value || 0, validThrough: $('dr-through').checked, required: $('dr-req').checked, anyTrip: $('dr-any').checked, note: $('dr-note').value.trim()});
    if(i >= 0) list[i] = n; else list.push(n);
    closeModal(); saveDocRules(list); render(); toast(i >= 0 ? 'Rule saved.' : 'Rule added.');
  };
}
