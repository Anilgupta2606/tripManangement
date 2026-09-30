"use strict";
/* =========================================================
   SHOPPING — one list per place of the trip: what to buy at home before
   leaving (Delhi) and what to buy there (Dubai). Tick things off as they
   are bought, say who it is for and where to get it; the city guide's
   shopping places (Wikivoyage "Buy") are suggested for each city.
   Syncs like everything else, so the phone and the laptop share it.
   ========================================================= */

/* Cut at a word, with an ellipsis */
const clip = (t, n) => { t = String(t || '').trim(); if(t.length <= n) return t; const c = t.slice(0, n); return c.slice(0, Math.max(c.lastIndexOf(' '), n * .6)).replace(/[,;:.\s]+$/, '') + '…'; };
const shopState = {guides: {}, open: {}, loading: new Set()};

/* The trip's places: home first (where the first flight leaves from), then every city of the trip. */
function shopPlaces(trip){
  const out = [];
  const add = (city, country, home) => { if(city && !out.some(x=>x.city.toLowerCase() === city.toLowerCase())) out.push({city, country: country || '', home: !!home}); };
  const fl = flightsOf(trip.id);
  const first = fl[0] && Parse.airport(fl[0].from);
  if(first && first.city) add(first.city, first.countryName, true);
  citiesOf(trip).forEach(c=>add(c.city, c.country));
  // things bought "anywhere" or in a place no longer on the trip still show
  (S.shopping || []).filter(x=>x.tripId === trip.id).forEach(x=>add(x.city, ''));
  if(!out.length) add(trip.city || 'Anywhere', trip.country);
  return out;
}
const shopItems = (trip, city) => (S.shopping || []).filter(x=>x.tripId === trip.id && String(x.city).toLowerCase() === String(city).toLowerCase())
  .sort((a, b)=>(a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.createdAt || 0) - (b.createdAt || 0));

VIEWS.shop = function(main, cur){
  if(!cur){ main.innerHTML = `<div class="card"><p>Create a trip first — the shopping lists follow its places.</p><button class="btn primary" onclick="VIEWS.newTrip()">New trip</button></div>`; return; }
  S.shopping = S.shopping || [];
  const places = shopPlaces(cur);
  const all = S.shopping.filter(x=>x.tripId === cur.id), done = all.filter(x=>x.done).length;
  const people = Array.from(new Set(S.people.map(p=>p.name).concat(travellersOf(cur)))).filter(Boolean);
  main.innerHTML = `
  <section class="section-head"><div><h1>${esc(cur.name)}</h1><p class="muted small">${all.length ? `${done} of ${all.length} bought` : 'One list for each place: what to buy before you leave, and what to buy there.'}</p></div>
    <div class="row">${all.length ? `<button class="btn ghost" id="sh-copy">Copy as text</button>` : ''}</div></section>
  <datalist id="sh-people">${people.map(p=>`<option value="${esc(p)}">`).join('')}</datalist>
  <section class="shop-grid">${places.map((p, i)=>shopCard(cur, p, i)).join('')}</section>`;
  places.forEach((p, i)=>bindShopCard(cur, p, i, places));
  if($('sh-copy')) $('sh-copy').onclick = ()=>navigator.clipboard.writeText(shopText(cur, places)).then(()=>toast('Copied — paste it in WhatsApp or Notes.'));
  places.filter(p=>!p.home).forEach(p=>loadShopGuide(p));
};

function shopCard(trip, p, i){
  const items = shopItems(trip, p.city), left = items.filter(x=>!x.done).length;
  const g = shopState.guides[p.city.toLowerCase()];
  const shops = g && g.length ? g : null;
  return `<article class="card shop" data-shop="${i}">
    <header class="shop-head"><div><h2>${p.home ? '🏠' : '📍'} ${esc(p.city)}</h2><p class="muted small">${p.home ? 'Buy before you leave' : 'Buy there'}${items.length ? ' · ' + (left ? left + ' to buy' : 'all bought ✓') : ''}</p></div></header>
    <form class="shop-add" data-add="${i}">
      <input name="text" placeholder="${p.home ? 'Add an item, e.g. adapter' : 'Add an item, e.g. dates'}" aria-label="Item" autocomplete="off" required>
      <input name="qty" placeholder="Qty" aria-label="How many" class="qty">
      <input name="who" placeholder="For" aria-label="For whom" list="sh-people" class="who">
      <button class="btn primary small">${icon('plus')} Add</button>
    </form>
    <ul class="shop-list">${items.map(x=>shopRow(x)).join('') || `<li class="muted small empty">Nothing yet.</li>`}</ul>
    ${!p.home ? `<details class="shop-where"${shopState.open[p.city] ? ' open' : ''} data-where="${esc(p.city)}"><summary class="small">Where to shop in ${esc(p.city)}${shops ? ' (' + shops.length + ')' : ''}</summary>
      ${shops ? `<ul class="history small">${shops.map(s=>`<li><a href="${mapsLink(s.name + ', ' + p.city)}" target="_blank" rel="noopener">${esc(s.name)}</a>${s.area ? ` <span class="muted">· ${esc(s.area)}</span>` : ''}${s.hours ? ` <span class="muted">· ${esc(s.hours.slice(0, 50))}</span>` : ''}${s.note ? `<div class="muted">${esc(clip(s.note, 130))}</div>` : ''}</li>`).join('')}</ul>`
        : `<p class="muted small">${g === null ? 'The travel guide has no shopping list for ' + esc(p.city) + '.' : 'Looking it up…'}</p>`}</details>` : ''}
  </article>`;
}
function shopRow(x){
  return `<li class="shop-item${x.done ? ' done' : ''}" data-item="${esc(x.id)}">
    <label class="tick"><input type="checkbox" data-done ${x.done ? 'checked' : ''} aria-label="Bought"><span>${esc(x.text)}</span></label>
    <span class="meta small muted">${[x.qty ? '× ' + esc(x.qty) : '', x.who ? 'for ' + esc(x.who) : '', x.where ? '@ ' + esc(x.where) : '', x.price ? esc(x.price) : ''].filter(Boolean).join(' · ')}</span>
    <span class="acts"><button class="icon-btn small" data-edit aria-label="Edit">${icon('edit')}</button><button class="icon-btn small" data-del aria-label="Remove">${icon('trash')}</button></span>
  </li>`;
}
function bindShopCard(trip, p, i, places){
  const card = document.querySelector(`[data-shop="${i}"]`);
  if(!card) return;
  card.querySelector('[data-add]').onsubmit = e=>{
    e.preventDefault();
    const f = e.target, text = f.text.value.trim();
    if(!text) return;
    S.shopping.push(touch({id: uid('s'), tripId: trip.id, city: p.city, text, qty: f.qty.value.trim(), who: f.who.value.trim(), where: '', price: '', done: false, createdAt: Date.now()}));
    save(); render();
    setTimeout(()=>{ const inp = document.querySelector(`[data-shop="${i}"] [name=text]`); if(inp) inp.focus(); }, 0);
  };
  card.querySelectorAll('[data-item]').forEach(li=>{
    const x = S.shopping.find(s=>s.id === li.dataset.item);
    if(!x) return;
    li.querySelector('[data-done]').onchange = e=>{ x.done = e.target.checked; x.boughtAt = x.done ? Date.now() : 0; touch(x); save(); render(); };
    li.querySelector('[data-del]').onclick = ()=>{ remove('shopping', x.id); save(); render(); };
    li.querySelector('[data-edit]').onclick = ()=>editShopItem(x, places);
  });
  const where = card.querySelector('[data-where]');
  if(where) where.ontoggle = ()=>{ shopState.open[p.city] = where.open; };
}
function editShopItem(x, places){
  const shops = shopState.guides[String(x.city).toLowerCase()] || [];
  const card = openModal(`<h2>Edit</h2><form id="sh-f" class="grid2">
    <label class="span2">What<input id="sh-text" value="${esc(x.text)}" required></label>
    <label>How many<input id="sh-qty" value="${esc(x.qty || '')}"></label>
    <label>For<input id="sh-who" list="sh-people" value="${esc(x.who || '')}"></label>
    <label>Where to buy it<input id="sh-where" list="sh-shops" value="${esc(x.where || '')}" placeholder="Shop, market or mall"><datalist id="sh-shops">${shops.map(s=>`<option value="${esc(s.name)}">`).join('')}</datalist></label>
    <label>Price / budget<input id="sh-price" value="${esc(x.price || '')}" placeholder="e.g. 150 AED"></label>
    <label class="span2">Buy it in<select id="sh-city">${places.map(p=>`<option${p.city === x.city ? ' selected' : ''}>${esc(p.city)}</option>`).join('')}</select></label>
    <div class="row end span2"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
  card.querySelector('#sh-f').onsubmit = e=>{
    e.preventDefault();
    Object.assign(x, {text: $('sh-text').value.trim() || x.text, qty: $('sh-qty').value.trim(), who: $('sh-who').value.trim(), where: $('sh-where').value.trim(), price: $('sh-price').value.trim(), city: $('sh-city').value});
    touch(x); save(); closeModal(); render();
  };
}
/* The city guide's shopping places (markets, malls, souks) - from the internet, no AI. */
async function loadShopGuide(p){
  const k = p.city.toLowerCase();
  if(k in shopState.guides || shopState.loading.has(k)) return;
  shopState.loading.add(k);
  try{
    const g = await Knowledge.guide(p.city, '');
    shopState.guides[k] = g ? g.listings.filter(l=>l.kind === 'buy').slice(0, 25) : null;
    if(shopState.guides[k] && !shopState.guides[k].length) shopState.guides[k] = null;
  }catch(e){ shopState.guides[k] = null; }
  shopState.loading.delete(k);
  if(tab === 'shop') render();
}
function shopText(trip, places){
  return trip.name + ' — shopping\n' + places.map(p=>{
    const items = shopItems(trip, p.city);
    if(!items.length) return '';
    return '\n' + (p.home ? 'Before leaving (' + p.city + ')' : p.city) + ':\n' + items.map(x=>(x.done ? '✓ ' : '☐ ') + x.text + (x.qty ? ' × ' + x.qty : '') + (x.who ? ' (for ' + x.who + ')' : '') + (x.where ? ' @ ' + x.where : '')).join('\n');
  }).join('\n').trim();
}
