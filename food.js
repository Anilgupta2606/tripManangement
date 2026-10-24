"use strict";
/* =========================================================
   FOOD TO TRY — one list per city of the trip: dishes to taste and
   restaurants to eat at. Each entry is a Food, a Restaurant, or Both
   (a dish at a named place: "Al Machboos at Al Fanar"). Tick it off once
   tried, add a note; restaurants open in Maps. The city guide's places to
   eat (Wikivoyage "Eat" and "Drink") are offered to add in one tap.
   Syncs like everything else.
   ========================================================= */

const FOOD_KINDS = {food: 'Food', restaurant: 'Restaurant', both: 'Food at a restaurant'};
const foodState = {guides: {}, open: {}, loading: new Set()};

/* The trip's cities (not home: food to try is where you are going), plus any city an entry was kept for. */
function foodPlaces(trip){
  const out = [];
  const add = (city, country) => { if(city && !out.some(x=>x.city.toLowerCase() === city.toLowerCase())) out.push({city, country: country || ''}); };
  citiesOf(trip).forEach(c=>add(c.city, c.country));
  (S.food || []).filter(x=>x.tripId === trip.id).forEach(x=>add(x.city, ''));
  if(!out.length) add(trip.city || 'Anywhere', trip.country);
  return out;
}
const foodItems = (trip, city) => (S.food || []).filter(x=>x.tripId === trip.id && String(x.city).toLowerCase() === String(city).toLowerCase())
  .sort((a, b)=>(a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.createdAt || 0) - (b.createdAt || 0));

/* What the entry says: "Al Machboos", "Al Fanar", or "Al Machboos at Al Fanar" */
function foodTitle(x){
  if(x.kind === 'both') return [x.dish, x.place].filter(Boolean).join(' at ');
  return x.kind === 'restaurant' ? x.place : x.dish;
}

VIEWS.food = function(main, cur){
  if(!cur){ main.innerHTML = `<div class="card"><p>Create a trip first — the lists follow its cities.</p><button class="btn primary" onclick="VIEWS.newTrip()">New trip</button></div>`; return; }
  S.food = S.food || [];
  const places = foodPlaces(cur);
  const all = S.food.filter(x=>x.tripId === cur.id), done = all.filter(x=>x.done).length;
  main.innerHTML = `
  <section class="section-head"><div><h1>${esc(cur.name)}</h1><p class="muted small">${all.length ? `${done} of ${all.length} tried` : 'Dishes to taste and restaurants to eat at, for each city.'}</p></div>
    <div class="row">${all.length ? `<button class="btn ghost" id="fd-copy">Copy as text</button>` : ''}</div></section>
  <section class="shop-grid">${places.map((p, i)=>foodCard(cur, p, i)).join('')}</section>`;
  places.forEach((p, i)=>bindFoodCard(cur, p, i, places));
  if($('fd-copy')) $('fd-copy').onclick = ()=>navigator.clipboard.writeText(foodText(cur, places)).then(()=>toast('Copied — paste it in WhatsApp or Notes.'));
  places.forEach(p=>loadFoodGuide(p));
};

function foodCard(trip, p, i){
  const items = foodItems(trip, p.city), left = items.filter(x=>!x.done).length;
  const g = foodState.guides[p.city.toLowerCase()];
  const taken = new Set(items.map(x=>String(x.place || '').toLowerCase()));
  const eats = g && g.length ? g.filter(s=>!taken.has(s.name.toLowerCase())) : null;
  return `<article class="card shop food" data-food="${i}">
    <header class="shop-head"><div><h2>🍽 ${esc(p.city)}</h2><p class="muted small">${items.length ? (left ? left + ' to try' : 'all tried ✓') : 'Nothing yet'}</p></div></header>
    <form class="food-add" data-add="${i}">
      <select name="kind" aria-label="Food, restaurant or both">${Object.entries(FOOD_KINDS).map(([k, l])=>`<option value="${k}">${esc(l)}</option>`).join('')}</select>
      <input name="name" placeholder="Dish to try, e.g. shawarma" aria-label="Name" autocomplete="off" required>
      <input name="place" placeholder="At which restaurant" aria-label="Restaurant" autocomplete="off" list="fd-eat-${i}" hidden>
      <datalist id="fd-eat-${i}">${(g || []).map(s=>`<option value="${esc(s.name)}">`).join('')}</datalist>
      <button class="btn primary small">${icon('plus')} Add</button>
    </form>
    <ul class="shop-list">${items.map(x=>foodRow(x)).join('') || `<li class="muted small empty">Add a dish, a restaurant, or a dish at a restaurant.</li>`}</ul>
    <details class="shop-where"${foodState.open[p.city] ? ' open' : ''} data-where="${esc(p.city)}"><summary class="small">Places to eat in ${esc(p.city)}${eats ? ' (' + eats.length + ')' : ''}</summary>
      ${eats ? `<ul class="history small">${eats.map((s, k)=>`<li><a href="${mapsLink(s.name, p.city)}" target="_blank" rel="noopener">${esc(s.name)}</a>${s.area ? ` <span class="muted">· ${esc(s.area)}</span>` : ''}${s.price ? ` <span class="muted">· ${esc(s.price.slice(0, 40))}</span>` : ''}
          <button type="button" class="link-btn small" data-pick="${k}">+ Add</button>${s.note ? `<div class="muted">${esc(clip(s.note, 130))}</div>` : ''}</li>`).join('')}</ul>`
        : `<p class="muted small">${g === null ? 'The travel guide has no list of places to eat for ' + esc(p.city) + '.' : 'Looking it up…'}</p>`}</details>
  </article>`;
}
function foodRow(x){
  const place = x.kind !== 'food' && x.place;
  return `<li class="shop-item${x.done ? ' done' : ''}" data-item="${esc(x.id)}">
    <label class="tick"><input type="checkbox" data-done ${x.done ? 'checked' : ''} aria-label="Tried"><span>${esc(foodTitle(x))}</span></label>
    <span class="meta small muted">${[`<span class="food-kind ${esc(x.kind)}">${esc(FOOD_KINDS[x.kind] || 'Food')}</span>`, place ? `<a href="${mapsLink(x.place, x.city)}" target="_blank" rel="noopener">Map</a>` : '', x.note ? esc(x.note) : ''].filter(Boolean).join(' · ')}</span>
    <span class="acts"><button class="icon-btn small" data-edit aria-label="Edit">${icon('edit')}</button><button class="icon-btn small" data-del aria-label="Remove">${icon('trash')}</button></span>
  </li>`;
}
/* The form follows the kind: Food asks for the dish; Restaurant for the place; Both for the dish and where */
function foodFormKind(f){
  const k = f.kind.value, name = f.name, place = f.place;
  name.placeholder = k === 'restaurant' ? 'Restaurant, e.g. Al Fanar' : 'Dish to try, e.g. shawarma';
  name.setAttribute('list', k === 'restaurant' ? place.getAttribute('list') : '');
  place.hidden = k !== 'both'; place.required = k === 'both';
}
function foodEntry(kind, name, place){
  return kind === 'restaurant' ? {kind, dish: '', place: name} : kind === 'both' ? {kind, dish: name, place} : {kind: 'food', dish: name, place: ''};
}
function bindFoodCard(trip, p, i, places){
  const card = document.querySelector(`[data-food="${i}"]`);
  if(!card) return;
  const f = card.querySelector('[data-add]');
  f.kind.onchange = ()=>{ foodFormKind(f); f.name.focus(); };
  foodFormKind(f);
  f.onsubmit = e=>{
    e.preventDefault();
    const kind = f.kind.value, name = f.name.value.trim(), place = f.place.value.trim();
    if(!name || (kind === 'both' && !place)) return;
    S.food.push(touch(Object.assign({id: uid('f'), tripId: trip.id, city: p.city, note: '', done: false, createdAt: Date.now()}, foodEntry(kind, name, place))));
    save(); render();
    setTimeout(()=>{ const c = document.querySelector(`[data-food="${i}"] [data-add]`); if(c){ c.kind.value = kind; foodFormKind(c); c.name.focus(); } }, 0);
  };
  card.querySelectorAll('[data-item]').forEach(li=>{
    const x = S.food.find(s=>s.id === li.dataset.item);
    if(!x) return;
    li.querySelector('[data-done]').onchange = e=>{ x.done = e.target.checked; x.triedAt = x.done ? Date.now() : 0; touch(x); save(); render(); };
    li.querySelector('[data-del]').onclick = ()=>{ remove('food', x.id); save(); render(); };
    li.querySelector('[data-edit]').onclick = ()=>editFood(x, places);
  });
  const g = foodState.guides[p.city.toLowerCase()] || [];
  const taken = new Set(foodItems(trip, p.city).map(x=>String(x.place || '').toLowerCase()));
  const eats = g.filter(s=>!taken.has(s.name.toLowerCase()));
  card.querySelectorAll('[data-pick]').forEach(b=>b.onclick = ()=>{
    const s = eats[+b.dataset.pick]; if(!s) return;
    S.food.push(touch({id: uid('f'), tripId: trip.id, city: p.city, kind: 'restaurant', dish: '', place: s.name, note: [s.area, s.price].filter(Boolean).join(' · ').slice(0, 120), done: false, createdAt: Date.now()}));
    save(); render(); toast('Added ' + s.name);
  });
  const where = card.querySelector('[data-where]');
  if(where) where.ontoggle = ()=>{ foodState.open[p.city] = where.open; };
}
function editFood(x, places){
  const g = foodState.guides[String(x.city).toLowerCase()] || [];
  const card = openModal(`<h2>Edit</h2><form id="fd-f" class="grid2">
    <label class="span2">What it is<select id="fd-kind">${Object.entries(FOOD_KINDS).map(([k, l])=>`<option value="${k}"${k === x.kind ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label id="fd-dish-l">Dish<input id="fd-dish" value="${esc(x.dish || '')}" placeholder="e.g. shawarma"></label>
    <label id="fd-place-l">Restaurant<input id="fd-place" value="${esc(x.place || '')}" list="fd-eats" placeholder="e.g. Al Fanar"><datalist id="fd-eats">${g.map(s=>`<option value="${esc(s.name)}">`).join('')}</datalist></label>
    <label class="span2">Note<input id="fd-note" value="${esc(x.note || '')}" placeholder="Who recommended it, what to order, booking…"></label>
    <label class="span2">City<select id="fd-city">${places.map(p=>`<option${p.city === x.city ? ' selected' : ''}>${esc(p.city)}</option>`).join('')}</select></label>
    <div class="row end span2"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
  const kind = card.querySelector('#fd-kind');
  const show = () => { card.querySelector('#fd-dish-l').hidden = kind.value === 'restaurant'; card.querySelector('#fd-place-l').hidden = kind.value === 'food'; };
  kind.onchange = show; show();
  card.querySelector('#fd-f').onsubmit = e=>{
    e.preventDefault();
    const k = kind.value, dish = $('fd-dish').value.trim(), place = $('fd-place').value.trim();
    if((k !== 'restaurant' && !dish) || (k !== 'food' && !place)) return toast(k === 'restaurant' ? 'Name the restaurant' : k === 'food' ? 'Name the dish' : 'Name the dish and the restaurant', 'error');
    Object.assign(x, {kind: k, dish: k === 'restaurant' ? '' : dish, place: k === 'food' ? '' : place, note: $('fd-note').value.trim(), city: $('fd-city').value});
    touch(x); save(); closeModal(); render();
  };
}

/* The city guide's places to eat and drink - from the internet, no AI */
async function loadFoodGuide(p){
  const k = p.city.toLowerCase();
  if(k in foodState.guides || foodState.loading.has(k)) return;
  foodState.loading.add(k);
  try{
    const g = await Knowledge.guide(p.city, '');
    foodState.guides[k] = g ? g.listings.filter(l=>l.kind === 'eat' || l.kind === 'drink').slice(0, 30) : null;
    if(foodState.guides[k] && !foodState.guides[k].length) foodState.guides[k] = null;
  }catch(e){ foodState.guides[k] = null; }
  foodState.loading.delete(k);
  if(tab === 'food') render();
}
function foodText(trip, places){
  return trip.name + ' — food to try\n' + places.map(p=>{
    const items = foodItems(trip, p.city);
    if(!items.length) return '';
    return '\n' + p.city + ':\n' + items.map(x=>(x.done ? '✓ ' : '☐ ') + foodTitle(x) + (x.kind === 'restaurant' ? ' (restaurant)' : '') + (x.note ? ' — ' + x.note : '')).join('\n');
  }).join('\n').trim();
}

if(typeof module !== 'undefined') module.exports = {FOOD_KINDS, foodTitle, foodEntry};
