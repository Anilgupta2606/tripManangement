"use strict";
/* =========================================================
   THINK — Trip Vault's own planner, on the site's Money Brain (/ai/brain.js).
   No AI model: it takes what the internet says about the city (the travel
   guide's places with their opening hours and map positions, places near the
   hotel, the weather), what it has learned about you (the kinds of places you
   keep or remove, your meal times, your food), and your rules; then for every
   day it searches for the best set of places in the best order — open when
   you get there, close to each other, indoors in the heat or rain, around
   your flights, hotel and meals — and says why it chose each one.
   It also understands the usual requests typed in "Not happy with it?"
   and learns from every edit you make to a plan.
   Pure functions over plain data (runs in node for the tests too).
   ========================================================= */
const TripBrain = (function(){
  const B = () => (typeof MoneyBrain !== 'undefined' ? MoneyBrain : null);
  const R = () => (typeof Rules !== 'undefined' ? Rules : require('./rules.js'));
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const KIND = {market: 'shopping', mall: 'shopping', fun: 'activity', desert: 'activity', boat: 'activity', animals: 'activity', beach: 'activity'};
  const MINUTES = {museum: 90, mall: 120, market: 75, mosque: 45, temple: 45, church: 40, park: 60, view: 90, fort: 75, animals: 150, fun: 240, beach: 120, desert: 300, boat: 60, sight: 75};
  const OUTDOOR = {market: true, park: true, beach: true, fort: true, desert: true, boat: true, animals: true, view: false, fun: true};
  const hhmm = m => R().toTime(m);
  const ampm = m => { const h = Math.floor(m / 60) % 24, mm = m % 60; return ((h + 11) % 12 + 1) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (h < 12 ? ' am' : ' pm'); };

  /* What it has learned (and what your rules say) about the kinds of places you like. */
  function preferences(rules){
    const b = B(), r = R().merge(rules), out = {cat: {}, why: {}, food: r.food || '', lessWalking: false, kids: /child|kid|toddler|baby/i.test(r.travellers || '')};
    if(b){
      b.CATEGORIES.concat([{id: 'food', name: 'food places'}]).forEach(c=>{
        const l = b.recall('trip', 'like', c.id);
        if(l){ out.cat[c.id] = (l.value === 'like' ? 0.5 : -1.2) * l.confidence; out.why[c.id] = l.value === 'like' ? 'you like ' + b.categoryName(c.id) : 'you usually skip ' + b.categoryName(c.id); }
      });
      if(!out.food){ const f = b.recall('trip', 'food', 'diet'); if(f) out.food = f.value; }
      const w = b.recall('trip', 'walking', 'amount'); if(w && w.value === 'less') out.lessWalking = true;
    }
    // your rules: interests and things to avoid
    if(b && r.interests) b.understand('I like ' + r.interests).filter(a=>a.do === 'like').forEach(a=>{ out.cat[a.category] = Math.max(out.cat[a.category] || 0, 0.4); out.why[a.category] = out.why[a.category] || 'on your interests list'; });
    if(b && r.avoid) b.understand('avoid ' + r.avoid).filter(a=>a.do === 'dislike').forEach(a=>{ out.cat[a.category] = -3; out.why[a.category] = 'you asked to avoid ' + b.categoryName(a.category); });
    out.avoidWords = String(r.avoid || '').toLowerCase().split(/[,;]/).map(x=>x.trim()).filter(x=>x.length > 3);
    return out;
  }

  /* Is it a place to visit? Wikipedia's one-line description says what a page is ("Buddhist temple in Bangkok",
     "University in Bangkok", "Motor race", "Hotel in Singapore"). */
  const VISIT = /\b(museum|gallery|temple|wat|shrine|mosque|church|cathedral|basilica|synagogue|monastery|palace|fort|fortress|castle|citadel|park|garden|zoo|aquarium|beach|island|lake|waterfall|market|bazaar|souk|mall|square|plaza|monument|memorial|landmark|tower|observation|viewpoint|bridge|statue|fountain|ruins?|archaeological|amphitheatre|stadium tour|old town|historic (district|site|house|building|quarter|neighbourhood)|heritage|attraction|theme park|amusement|water park|botanical|opera house|theatre|library|cemetery|tomb|mausoleum|gate|canal|harbour|pier|promenade|street market|night market|skyscraper|world heritage)\b/i;
  const NOT_VISIT = /\b(hotel|resort|university|college|school|institute|academy|company|corporation|bank|headquarters|embassy|consulate|nunciature|ministry|government|agency|station|railway|metro|airport|hospital|clinic|office building|office|business|apartment|residential|housing|neighbourhood|neighborhood|district|ward|suburb|area|region|village in|town in|city in|road|street|highway|expressway|avenue|grand prix|race|festival|convention|con\b|election|bombing|attack|fire|disaster|riot|massacre|incident|war|battle|siege|treaty|empire|dynasty|era|period|organi[sz]ation|club|team|television|radio|newspaper|film|album|song|restaurant|shop|brand|retailer|company|politician|person|footballer|actor|singer|family|record label|software|video game|holiday|celebration|observance|new year|novel|book|poem|opera\b|play by|musical|painting|sculpture by|retail|discount store|convenience store|department store chain|shopping (centre|center|mall) chain|chain of|franchise|manga|anime|character|magazine)\b/i;
  const ADULT = /\b(sex|erotic|lovemaking|red[- ]light|go-go|strip club|brothel|cabaret show|adult (show|entertainment))\b/i;
  const EVENT = /\b(new year|festival|celebration|parade|marathon|grand prix|season)\b/i;
  const PERSON = /\(\d{3,4}\s*[–-]\s*\d{3,4}\)|\b(born|died|politician|statesman|soldier|general|writer|poet|painter|king|queen|emperor|prince|princess|sultan|actor|actress|singer|musician|businessman|footballer|cricketer|scientist|philosopher|saint)\b/i;
  function isPlace(name, desc, fromGuide, views, cat){
    if(cat && /beaches|temples|shrines|churches|mosques|museums|parks|gardens|forts|castles|palaces|monuments|waterfalls/i.test(cat)) return !PERSON.test(desc || '');   // filed as one by Wikipedia
    if(!desc) return fromGuide;                                             // the guide lists places; without a description, trust it
    if(PERSON.test(desc)) return false;                                     // the page found is about a person of that name
    // a skyscraper is a sight only when people come to see it (Burj Khalifa), not every office tower
    if(/\b(skyscraper|office|tower block|high-rise)\b/i.test(desc) && !/observation|observatory|tallest|landmark/i.test(desc)) return (views || 0) > 20000;
    if(VISIT.test(desc) && !/\b(hotel|university|station|school|office)\b/i.test(desc)) return true;
    if(NOT_VISIT.test(desc)) return false;
    return fromGuide;
  }

  /* Every place worth considering, with a value and what we know of it. know: from Knowledge.gather */
  function candidates(know, ctx, prefs){
    const b = B(), out = [], seen = {};
    const hotel = know && (know.hotelLoc || know.loc) ? {lat: (know.hotelLoc || know.loc).lat, lng: (know.hotelLoc || know.loc).lng} : null;
    const near = {}; ((know && know.nearby) || []).forEach(p=>{ near[norm(p.name)] = p; });
    const add = (name, o) => {
      const k = norm(name);
      if(!k || seen[k]) { if(seen[k] && o.fame) seen[k].value += 0.15; return; }
      const look = String(o.key || name).toLowerCase();
      const desc = know && know.desc ? know.desc[look] || '' : '';
      if(!isPlace(name, desc, o.source === 'guide', know && know.fame ? know.fame[look] : 0, o.cat)) return;
      if(ADULT.test(name + ' ' + (o.note || '') + ' ' + desc) || EVENT.test(name)) return;              // a family planner: no adult venues; events are not places
      const cat0 = b.categoryOf(name, o.note);
      const category = cat0 !== 'sight' ? cat0 : b.categoryOf(desc, '') !== 'sight' ? b.categoryOf(desc, '') : b.categoryOf(o.cat || '', '');
      const pos = o.lat != null ? {lat: o.lat, lng: o.lng} : near[k] ? {lat: near[k].lat, lng: near[k].lng} : null;
      let value = o.base + (near[k] && o.base > 0.5 ? 0.15 : 0);                          // in the guide and near the hotel: well known
      const why = [];
      // how well known it is: Wikipedia readers in a month (Burj Khalifa ~125,000; a small museum ~900)
      // readers of a page about this city's place count fully; a chain, brand or event page (Madame Tussauds, a store
      // chain, a tennis tournament) is read worldwide, so its readers say nothing about this city
      const local = new RegExp('\\b(' + [ctx.city, ctx.country, o.area].filter(Boolean).map(x=>String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');
      const factor = !desc ? 0.8 : /\b(chain|franchise|brand|company|tournament|championship|series|event)\b/i.test(desc) ? 0 : local.test(desc) || local.test(name) ? 1 : 0.5;
      const views = know && know.fame && know.fame[look] !== undefined ? Math.round(know.fame[look] * factor) : undefined;
      if(views > 0){ const f = Math.max(-0.1, Math.min(0.9, (Math.log10(views) - 3) * 0.4)); value += f; if(f >= 0.5) why.push('one of the best-known sights here'); }
      if(prefs.cat[category]){ value += prefs.cat[category]; why.push(prefs.why[category]); }
      if(prefs.kids && /animals|fun|beach|park/.test(category)){ value += 0.3; why.push('good with children'); }
      if(prefs.lessWalking && /market|park|fort|desert/.test(category)) value -= 0.25;
      if(prefs.avoidWords.some(w=>(name + ' ' + (o.note || '')).toLowerCase().indexOf(w) >= 0)) value = -10;
      if(!pos) value -= 0.2;                                                                  // no map position: we cannot place it well
      const c = {id: 'c' + out.length, name, category, kind: KIND[category] || 'sight', lat: pos ? pos.lat : null, lng: pos ? pos.lng : null,
        minutes: Math.round((MINUTES[category] || 75) * (prefs.lessWalking && /market|park|museum/.test(category) ? 0.8 : 1)), flex: 45,
        hours: b.parseHours(o.hours), hoursText: o.hours || '', outdoor: !!OUTDOOR[category] && !/aquarium|dolphinarium|indoor|museum|mall|cinema|ski dubai/i.test(name), note: o.note || '', area: o.area || '', price: o.price || '',
        value, why, source: o.source, km: hotel && pos ? b.km(hotel, pos) : null, views: views || 0};
      if(c.km != null && c.km > 60) return;                                                    // another city
      if(value >= 1.3) c.flex = 0;                                                              // a top sight gets its full time, never squeezed
      seen[k] = c; out.push(c);
    };
    // guide entries that are tips, not places ("Gold Price Checking", "Getting a SIM")
    const TIP = /\b(checking|check the|tips?|how to|getting|price of|prices|advice|beware|warning|note:)\b/i;
    const listings = (know && know.guide ? know.guide.listings : []).filter(l=>!TIP.test(l.name));
    listings.forEach(l=>{
      if(l.kind === 'see') add(l.name, Object.assign({base: 1.0, source: 'guide', fame: true}, l));
      else if(l.kind === 'do') add(l.name, Object.assign({base: 0.85, source: 'guide'}, l));
      else if(l.kind === 'buy' && /market|mall/.test(b.categoryOf(l.name, l.note))) add(l.name, Object.assign({base: 0.6, source: 'guide'}, l));
    });
    // the city's attractions as Wikipedia files them (with map positions): a place to visit when its description says so
    ((know && know.attractions) || []).forEach(a=>{ add(a.name.replace(/,\s*[A-Z][a-z]+$/, '').replace(/\s*\([^)]*\)$/, ''), {base: 0.55, lat: a.lat, lng: a.lng, source: 'attractions', note: '', key: a.name, cat: a.cat}); });
    // places near the hotel from Wikipedia: only the ones its description calls a place to visit
    ((know && know.nearby) || []).forEach(p=>{ const cat = b.categoryOf(p.name, (know.desc || {})[p.name.toLowerCase()] || ''); add(p.name, {base: cat === 'sight' ? 0.35 : 0.55, lat: p.lat, lng: p.lng, source: 'nearby'}); });
    return out;
  }
  /* Places to eat, with their positions (for "near where you are at lunch"). */
  function eateries(know, prefs){
    const veg = /veg|jain|vegan/i.test(prefs.food || '');
    return ((know && know.guide ? know.guide.listings : [])).filter(l=>l.kind === 'eat' || l.kind === 'drink' && /cafe|coffee|tea/i.test(l.name + l.note))
      .map(l=>({name: l.name, lat: l.lat, lng: l.lng, note: l.note || '', price: l.price || '', area: l.area || '', hours: B().parseHours(l.hours),
        veg: /\b(veg|vegetarian|vegan|jain|saravana|sangeetha|udupi|dosa|thali|south indian)\b/i.test(l.name + ' ' + l.note) && !/non[- ]?veg/i.test(l.note)}))
      .map(e=>Object.assign(e, {fit: (veg ? (e.veg ? 1 : 0.2) : 1) * (/gelat|ice ?cream|sweets?\b|dessert|bakery|patisserie|lassi|juice|chocolat|pastry|donut|doughnut|bubble tea|station\b/i.test(e.name + ' ' + e.note) ? 0.15 : 1)}));
  }

  /* The whole stay, day by day. ctx: planContext (dates, arrival, departure, hotel, rules, city);
     know: Knowledge.gather; weather: {date: {rain, tmax}}; prev: the plan now (its locked items stay).
     -> {days, summary, used} */
  function plan(ctx, know, weather, prev){
    const b = B(), Ru = R(), r = Ru.merge(ctx.rules), prefs = preferences(ctx.rules);
    weather = weather || {};
    const hotel = know && (know.hotelLoc || know.loc) ? {lat: (know.hotelLoc || know.loc).lat, lng: (know.hotelLoc || know.loc).lng, name: ctx.hotel && ctx.hotel.name} : null;
    // learned meal times move the meal blocks (inside your rules' windows)
    const rules = Object.assign({}, ctx.rules || {});
    const lunchAt = b.recall('trip', 'time', 'lunch'), dinnerAt = b.recall('trip', 'time', 'dinner');
    const sk = Ru.skeleton({city: ctx.city, start: ctx.start, end: ctx.end, hotel: ctx.hotel, arrival: ctx.arrival, departure: ctx.departure}, rules);
    const locked = prev && prev.days ? {days: prev.days.map(d=>({date: d.date, items: (d.items || []).filter(i=>i.locked && ['flight', 'transit', 'hotel'].indexOf(i.kind) < 0)}))} : null;
    const days = Ru.clean({days: sk.days}, locked).days;
    const all = candidates(know, ctx, prefs), food = eateries(know, prefs);
    const used = new Set(), ate = new Set();
    // the trip's must-sees: the best-known places (by Wikipedia readers), about two for every full day - planned
    // first, as the anchors of the days, so a famous place is never left out for a lesser one nearer the hotel
    const fullDays = Math.max(1, days.length - (ctx.arrival ? 1 : 0) - (ctx.departure ? 1 : 0));
    const views = c => c.views || 0;
    const must = all.filter(c=>c.value > 0 && c.lat != null && (c.km == null || c.km < 35) && views(c) > 2000)
      .sort((a, b)=>views(b) - views(a)).slice(0, Math.min(14, fullDays * 2 + 1));
    const mustIds = new Set(must.map(c=>c.id));
    (locked ? locked.days : []).forEach(d=>d.items.forEach(i=>used.add(norm(i.place || i.title).split(' ').slice(0, 3).join(' '))));
    const isUsed = c => used.has(norm(c.name).split(' ').slice(0, 3).join(' '));
    // arrival day: light (one place when relaxed, two otherwise); every day: what fits its hours
    const maxOf = (d, i) => { const n = r.maxSights[r.pace] || 3; const w = Ru.windowOf(d.date, r, ctx);
      const arr = ctx.arrival && ctx.arrival.date === d.date;
      return Math.max(0, Math.min(arr ? (r.pace === 'relaxed' ? 1 : 2) : n, Math.floor((w.until - w.from) / 150))); };
    days.forEach((day, di)=>{
      const w = Ru.windowOf(day.date, r, ctx), wx = weather[day.date];
      // meal blocks at the times you keep (learned), inside the rules' windows
      day.items.forEach(it=>{
        if(it.kind !== 'meal') return;
        const learnt = /lunch/i.test(it.title) ? lunchAt : /dinner/i.test(it.title) ? dinnerAt : null;
        const win = /lunch/i.test(it.title) ? r.lunch : r.dinner;
        if(learnt){ const len = Ru.toMin(it.end) - Ru.toMin(it.start); const s = Math.min(Math.max(Math.round(learnt.value / 5) * 5, Ru.toMin(win[0])), Ru.toMin(win[1]) - 30);
          if(s >= w.from && s + len <= Math.max(w.until, Ru.toMin(it.end))){ it.start = hhmm(s); it.end = hhmm(s + len); it.notes = 'At the time you usually have ' + (/lunch/i.test(it.title) ? 'lunch' : 'dinner') + '.'; } }
      });
      const fixed = day.items.filter(it=>it.kind !== 'free');
      const busy = fixed.filter(it=>Ru.toMin(it.start) !== null).map(it=>({s: Ru.toMin(it.start), e: Math.max(Ru.toMin(it.end) || 0, Ru.toMin(it.start) + 1), title: it.title,
        lat: /hotel|check/i.test(it.title) && hotel ? hotel.lat : null, lng: /hotel|check/i.test(it.title) && hotel ? hotel.lng : null}));
      const max = maxOf(day, di) - fixed.filter(it=>['sight', 'activity', 'shopping'].indexOf(it.kind) >= 0).length;
      let stops = [];
      if(max > 0){
        // one area a day: the best place left anchors the day, the rest are valued by how close they are to it
        const left = all.filter(c=>!isUsed(c) && c.value > 0 && (c.km == null || c.km < 35));
        const arrivalDay = ctx.arrival && ctx.arrival.date === day.date, lastDay = ctx.departure && ctx.departure.date === day.date;
        const pool = left.filter(c=>!(arrivalDay || lastDay) || c.km == null || c.km < 4);
        // the day's anchor: the best-known must-see not yet planned (open that day); else the best place left
        const openThatDay = c => { const h = c.hours && c.hours.days[new Date(day.date + 'T00:00:00Z').getUTCDay()]; return !h || h.length > 0; };
        const anchor = pool.filter(c=>mustIds.has(c.id) && openThatDay(c)).sort((a, b)=>views(b) - views(a))[0] || pool.slice().sort((a, b)=>b.value - a.value)[0];
        const dayCands = pool.map(c=>Object.assign({}, c, {value: c.value + (mustIds.has(c.id) ? 0.6 : 0) + (anchor && c.id === anchor.id ? 0.5 : 0)
            - (anchor && c.lat != null && anchor.lat != null ? 0.07 * b.km(anchor, c) : 0.15)}))
          .sort((a, b)=>b.value - a.value).slice(0, 24);
        const res = b.planDay({date: day.date, window: w, start: hotel, busy, candidates: dayCands, max, buffer: r.bufferMin,
          valueAt: (c, s) => {
            let v = 0;
            if(c.outdoor && wx && wx.rain >= r.rainChance) v -= 0.8;
            if(c.outdoor && wx && wx.tmax >= r.heatC && s < 16 * 60 && s + c.minutes > 11 * 60 + 30) v -= 0.9;
            if(c.outdoor && s >= 16 * 60 + 30 && (!wx || wx.tmax >= 30)) v += 0.15;                                 // markets and waterfronts: better in the evening
            if(c.category === 'view' && s >= 17 * 60 && s <= 19 * 60) v += 0.2;                                   // towers at sunset
            return v;
          }});
        stops = res.stops;
      }
      stops.forEach(x=>used.add(norm(x.c.name).split(' ').slice(0, 3).join(' ')));
      // the day's items: fixed ones, the stops (with why), open time left as rest
      const items = fixed.map(it=>Object.assign({}, it));
      let prevStop = null;
      stops.forEach(x=>{
        const c = x.c, why = [];
        if(c.hoursText) why.push('open ' + String(c.hoursText).slice(0, 60));
        else why.push('opening hours not listed — check before going');
        const from = prevStop ? prevStop.c.name : hotel ? 'the hotel' : '';
        if(from) why.push(x.travel <= 12 ? x.travel + ' min walk from ' + from : 'about ' + x.travel + ' min by ' + (r.transport || 'cab') + ' from ' + from);
        if(c.outdoor && wx && wx.rain >= r.rainChance) why.push('outdoors — ' + wx.rain + '% rain forecast, keep a plan B');
        else if(!c.outdoor && wx && (wx.rain >= r.rainChance || (wx.tmax >= r.heatC && x.s < 16 * 60 && x.e > 12 * 60))) why.push('indoors — ' + (wx.rain >= r.rainChance ? 'rain likely' : 'hot afternoon (' + Math.round(wx.tmax) + '°C)'));
        why.push.apply(why, c.why);
        items.push({id: 'b' + Math.random().toString(36).slice(2, 9), start: hhmm(x.s), end: hhmm(x.e), title: c.name, place: c.name + ', ' + ctx.city, kind: c.kind,
          notes: (c.note ? c.note.replace(/\s+/g, ' ').slice(0, 140) + (c.note.length > 140 ? '…' : '') + ' · ' : '') + why.filter(Boolean).join(' · '), outdoor: c.outdoor, cost: c.price ? String(c.price).slice(0, 40) : '', locked: false, by: 'brain'});
        prevStop = x;
      });
      // meals: a place to eat near where you are then
      items.forEach(it=>{
        if(it.kind !== 'meal' || !food.length) return;
        const s = Ru.toMin(it.start);
        const before = stops.filter(x=>x.e <= s).pop();
        const at = before ? before.c : hotel;
        const pick = food.filter(f=>!ate.has(f.name)).map(f=>{
          const d = at && f.lat != null && at.lat != null ? b.km(at, f) : 3;
          const open = b.openDuring(f.hours, day.date, s, s + 45);
          return {f, score: f.fit * 2 - d * 0.4 - (open === false ? 5 : 0), d};
        }).sort((a, b)=>b.score - a.score)[0];
        if(!pick || pick.score < -3) return;
        ate.add(pick.f.name);
        it.title = it.title.replace(/ near the hotel$/, '') + ' — ' + pick.f.name;
        it.place = pick.f.name + ', ' + ctx.city;
        it.notes = [pick.f.note ? pick.f.note.slice(0, 120) : '', pick.d != null && pick.d < 1.5 ? 'a short walk from ' + (before ? before.c.name : 'the hotel') : '',
          /veg/i.test(prefs.food || '') ? (pick.f.veg ? 'vegetarian food' : 'ask for vegetarian dishes') : '', pick.f.price ? 'about ' + String(pick.f.price).slice(0, 30) : ''].filter(Boolean).join(' · ');
      });
      // a long empty afternoon in the heat: rest at the hotel
      items.sort((a, b)=>(Ru.toMin(a.start) || 0) - (Ru.toMin(b.start) || 0));
      const full = !(ctx.arrival && ctx.arrival.date === day.date) && !(ctx.departure && ctx.departure.date === day.date);
      const needRest = (wx && wx.tmax >= 32) || r.pace === 'relaxed' || prefs.lessWalking || prefs.kids;
      if(full && needRest) for(let k = 1; k < items.length; k++){
        const gapS = Ru.toMin(items[k - 1].end) + r.bufferMin, gapE = Ru.toMin(items[k].start) - r.bufferMin;
        if(gapE - gapS >= 120 && gapS >= 12 * 60 && gapS < 17 * 60){ items.splice(k, 0, {id: 'r' + k + Math.random().toString(36).slice(2, 6), start: hhmm(gapS), end: hhmm(Math.min(gapE, gapS + 120)), title: 'Rest at the hotel', place: ctx.hotel && ctx.hotel.name || '', kind: 'rest', notes: wx && wx.tmax >= 32 ? 'The hottest part of the day.' : 'A break between plans.', outdoor: false, locked: false}); break; }
      }
      // the day's name: the area it spends most time in
      const areas = {}; stops.forEach(x=>{ if(x.c.area) areas[x.c.area] = (areas[x.c.area] || 0) + x.c.minutes; });
      const area = Object.entries(areas).sort((a, b)=>b[1] - a[1])[0];
      const cats = Array.from(new Set(stops.map(x=>b.categoryName(x.c.category).split(' ')[0]))).slice(0, 2);
      day.title = ctx.arrival && ctx.arrival.date === day.date ? 'Arrival' + (stops.length ? ' · ' + stops[0].c.name : '') : ctx.departure && ctx.departure.date === day.date ? 'Departure' :
        (area ? area[0] + (cats.length ? ': ' + cats.join(' & ') : '') : cats.length ? cats.join(' & ').replace(/^./, c=>c.toUpperCase()) : day.title);
      day.items = items;
    });
    const fixedUp = Ru.repair({days}, ctx.rules, Object.assign({}, ctx, {weather}));
    const n = fixedUp.days.reduce((s, d)=>s + d.items.filter(i=>i.by === 'brain').length, 0);
    const used2 = (know ? know.used : []).slice();
    return {days: fixedUp.days, fixes: fixedUp.changes, summary: n + ' places over ' + days.length + ' days, chosen from ' + all.filter(c=>c.value > 0).length + ' — open when you get there, close together, around your flights, hotel and meals', used: used2, candidates: all.length};
  }

  /* "Not happy with it?" typed in plain words -> changes to the rules and lessons, and what to tell you.
     -> {rules (new), fixed: [{date, item}], free: [{date, part}], said: [text], understood: bool} */
  function apply(text, ctx, days, given){
    const b = B(), out = {rules: Object.assign({}, ctx.rules || {}), fixed: [], free: [], said: [], understood: false};
    delete out.rules.custom;
    const acts = given || b.understand(text, {app: 'trip'});
    const dayOf = ref => {
      if(!ref || !days || !days.length) return null;
      if(ref.day) return (ref.day === -1 ? days[days.length - 1] : days[ref.day - 1]) || null;
      if(ref.date) return days.find(d=>+d.date.slice(8, 10) === ref.date) || null;
      return null;
    };
    acts.forEach(a=>{
      out.understood = true;
      if(a.do === 'pace'){ out.rules.pace = a.value; out.said.push((a.value === 'relaxed' ? 'Fewer places a day' : 'More places a day') + ' (pace: ' + a.value + ')'); }
      if(a.do === 'food'){ out.rules.food = a.value; b.learn('trip', 'food', 'diet', a.value, {weight: 3, label: 'Food: ' + a.value, why: 'You said: “' + text.slice(0, 80) + '”'}); out.said.push('Meals: ' + a.value); }
      if(a.do === 'like' || a.do === 'dislike'){
        b.learn('trip', 'like', a.category, a.do, {weight: 2, label: (a.do === 'like' ? 'Likes ' : 'Skips ') + (a.category === 'food' ? 'food places' : b.categoryName(a.category)), why: 'You said: “' + text.slice(0, 80) + '”'});
        if(a.do === 'dislike'){ const av = String(out.rules.avoid || ''); const word = b.categoryName(a.category); if(av.toLowerCase().indexOf(word) < 0) out.rules.avoid = (av ? av + ', ' : '') + word; }
        out.said.push((a.do === 'like' ? 'More ' : 'No ') + (a.category === 'food' ? 'food places' : b.categoryName(a.category)));
      }
      if(a.do === 'avoid'){ out.rules.avoid = (out.rules.avoid ? out.rules.avoid + ', ' : '') + a.words; out.said.push('Avoid: ' + a.words); }
      if(a.do === 'dayStart'){ const m = a.min != null ? a.min : R().toMin(R().merge(out.rules).dayStart) + a.shift; out.rules.dayStart = R().toTime(m); out.said.push('Days start at ' + ampm(m)); }
      if(a.do === 'dayEnd'){ out.rules.dayEnd = R().toTime(a.min); out.said.push('Back at the hotel by ' + ampm(a.min)); }
      if(a.do === 'travellers'){ out.rules.travellers = (out.rules.travellers ? out.rules.travellers + ', ' : '') + a.value; out.said.push('Planned for children'); }
      if(a.do === 'walking'){ b.learn('trip', 'walking', 'amount', 'less', {weight: 3, label: 'Less walking', why: 'You said: “' + text.slice(0, 80) + '”'}); out.said.push('Less walking'); }
      if(a.do === 'fixed'){ const d = dayOf(a.day); if(d){ out.fixed.push({date: d.date, item: {id: 'u' + Math.random().toString(36).slice(2, 9), start: R().toTime(a.min), end: R().toTime(a.min + a.minutes), title: a.title.replace(/^./, c=>c.toUpperCase()), place: '', kind: /dinner|lunch/.test(a.title) ? 'meal' : 'activity', notes: 'You asked for this.', outdoor: false, locked: true}}); out.said.push(a.title + ' on ' + d.date.slice(8) + ' at ' + ampm(a.min)); } else out.said.push('(which day for “' + a.title + '”? say “on day 2” or “on the 24th”)'); }
      if(a.do === 'free'){ const d = dayOf(a.day); out.free.push({date: d ? d.date : null, part: a.part}); out.said.push('Free ' + a.part + (d ? ' on ' + d.date.slice(8) : '')); }
    });
    return out;
  }
  /* A free morning/afternoon/evening: a locked "free time" block the planner keeps clear. */
  function freeBlock(part){
    const span = {morning: [9 * 60, 12 * 60 + 30], afternoon: [14 * 60, 18 * 60], evening: [18 * 60 + 30, 21 * 60], day: [9 * 60, 21 * 60]}[part] || [18 * 60 + 30, 21 * 60];
    return {id: 'f' + Math.random().toString(36).slice(2, 9), start: R().toTime(span[0]), end: R().toTime(span[1]), title: 'Free ' + part, place: '', kind: 'rest', notes: 'Kept free, as you asked.', outdoor: false, locked: true};
  }

  /* ---- learning from what you do with a plan */
  function learnFromEdit(what, item, extra){
    const b = B();
    if(!b || !item) return;
    const cat = b.categoryOf(item.title, item.notes);
    const nm = String(item.title || '').slice(0, 60);
    if(what === 'remove' && ['sight', 'activity', 'shopping'].indexOf(item.kind) >= 0 && cat !== 'sight')
      b.learn('trip', 'like', cat, 'dislike', {weight: 0.7, label: 'Skips ' + b.categoryName(cat), why: 'You removed “' + nm + '” from a plan'});
    if(what === 'lock' && ['sight', 'activity', 'shopping'].indexOf(item.kind) >= 0 && cat !== 'sight')
      b.learn('trip', 'like', cat, 'like', {weight: 1, label: 'Likes ' + b.categoryName(cat), why: 'You locked “' + nm + '” in a plan'});
    if(what === 'add' && cat !== 'sight')
      b.learn('trip', 'like', cat, 'like', {weight: 1, label: 'Likes ' + b.categoryName(cat), why: 'You added “' + nm + '” to a plan'});
    if(what === 'time' && item.kind === 'meal'){
      const meal = /lunch/i.test(item.title) ? 'lunch' : /dinner/i.test(item.title) ? 'dinner' : /breakfast/i.test(item.title) ? 'breakfast' : null;
      if(meal) b.learn('trip', 'time', meal, R().toMin(item.start), {label: meal.replace(/^./, c=>c.toUpperCase()) + ' at about {time}', why: 'You set ' + meal + ' at ' + item.start});
    }
  }

  /* The AI as a translator, not a planner: a request Money Brain could not read becomes its own actions (checked
     here, so a wrong answer cannot do harm), and the words are remembered for next time. -> actions or [] */
  const ACTION_SYSTEM = cats => `You turn a traveller's request about their trip plan into actions. Answer with JSON only: {"actions":[...]}, using only these forms:
{"do":"pace","value":"relaxed"|"packed","day":{"day":N}|null}
{"do":"food","value":"vegetarian"|"vegan"|"jain vegetarian"|"halal"}
{"do":"like"|"dislike","category":${cats.map(c=>'"' + c + '"').join('|')}|"food"}
{"do":"fixed","title":"short name","min":minutes after midnight,"minutes":60,"day":{"day":N}|{"date":D}}
{"do":"free","part":"morning"|"afternoon"|"evening"|"day","day":{"day":N}|{"date":D}|null}
{"do":"dayStart","min":minutes after midnight} or {"do":"dayStart","shift":60|-60}
{"do":"dayEnd","min":minutes after midnight} or {"do":"dayEnd","shift":60|-60}
{"do":"walking","value":"less"}
{"do":"travellers","value":"with children"}
Day N counts from 1 (-1 = the last day); D is the day of the month. If the request is about something else (a named place, a question, thanks), answer {"actions":[]}.`;
  function checkActions(list){
    const b = B(), cats = b.CATEGORIES.map(c=>c.id).concat(['food']);
    const okDay = d => d === null || d === undefined || (d && (Number.isInteger(d.day) || Number.isInteger(d.date)));
    return (Array.isArray(list) ? list : []).filter(a=>a && typeof a === 'object').filter(a=>{
      if(a.do === 'pace') return /^(relaxed|packed)$/.test(a.value) && okDay(a.day);
      if(a.do === 'food') return /^(vegetarian|vegan|jain vegetarian|halal)$/.test(a.value);
      if(a.do === 'like' || a.do === 'dislike') return cats.indexOf(a.category) >= 0;
      if(a.do === 'fixed') return a.title && Number.isInteger(a.min) && a.min >= 0 && a.min < 1440 && okDay(a.day) && a.day;
      if(a.do === 'free') return /^(morning|afternoon|evening|day)$/.test(a.part) && okDay(a.day);
      if(a.do === 'dayStart' || a.do === 'dayEnd') return (Number.isInteger(a.min) && a.min > 0 && a.min < 1440) || a.shift === 60 || a.shift === -60;
      if(a.do === 'walking') return a.value === 'less';
      if(a.do === 'travellers') return a.value === 'with children';
      return false;
    }).map(a=>Object.assign({}, a, {minutes: a.do === 'fixed' ? Math.max(30, Math.min(240, +a.minutes || 60)) : undefined}));
  }
  async function translate(text, chat, json){
    const b = B();
    const r = await chat(ACTION_SYSTEM(b.CATEGORIES.map(c=>c.id)), [{role: 'user', content: text}], {tier: 'fast', maxTokens: 400});
    const acts = checkActions((json(r.text) || {}).actions);
    if(acts.length) b.rememberPhrase('trip', text, acts);
    return {acts, by: r.provider};
  }

  return {preferences, candidates, eateries, plan, apply, freeBlock, learnFromEdit, ampm, translate, checkActions};
})();
if(typeof module !== 'undefined') module.exports = TripBrain;
