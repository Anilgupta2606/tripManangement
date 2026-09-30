"use strict";
/* =========================================================
   RULES — how a day of the itinerary has to look, and the checker that holds
   every plan to it, whether the AI wrote it, the built-in planner did, or you
   edited it by hand. The same rules are written into the AI's instructions,
   so it plans to them in the first place; the checker then says where a plan
   still breaks one.
   Pure functions; runs in the browser and in node (tests).
   ========================================================= */
const Rules = (function(){

  /* Every rule has a default you can change in Itinerary → Rules. */
  const DEFAULTS = {
    dayStart: '09:00',          // nothing planned before this (except flights / check-out)
    dayEnd: '21:30',            // back at the hotel by this
    pace: 'balanced',           // relaxed | balanced | packed
    maxSights: {relaxed: 2, balanced: 3, packed: 5},
    bufferMin: 20,              // minimum gap between two stops in different places
    lunch: ['12:30', '14:30'],
    dinner: ['19:00', '21:30'],
    arrivalBufferMin: 90,       // from landing to the first plan (bags, immigration, transfer)
    domesticAirportMin: 120,    // at the airport this long before a domestic departure
    internationalAirportMin: 180,
    transferMin: 60,            // hotel <-> airport, when not known
    checkInTime: '14:00',
    checkOutTime: '11:00',
    maxTravelMin: 45,           // one hop between stops, by the usual transport
    rainChance: 60,             // % rain at which outdoor plans are flagged
    heatC: 38,                  // max temperature at which midday outdoor plans are flagged
    interests: '',              // "history, food, shopping"
    travellers: '',             // "2 adults, 1 child (6)"
    food: '',                   // "vegetarian"
    budget: 'mid-range',        // budget | mid-range | luxury
    transport: 'cab / metro',
    avoid: '',                  // "no treks, avoid crowded markets"
    extra: '',                  // anything else, in your words
  };
  const KINDS = ['sight', 'activity', 'meal', 'shopping', 'rest', 'transit', 'flight', 'hotel', 'free'];
  const SIGHTS = new Set(['sight', 'activity', 'shopping']);

  const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
  const toTime = n => { n = Math.max(0, Math.min(24 * 60 - 1, Math.round(n))); return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); };
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const merge = r => Object.assign({}, DEFAULTS, r || {}, {maxSights: Object.assign({}, DEFAULTS.maxSights, (r || {}).maxSights || {})});

  /* The rules as instructions, for the AI planner. `ctx` adds this trip's facts. */
  function asPrompt(rules, ctx){
    const r = merge(rules);
    const lines = [
      `1. Days run ${r.dayStart}–${r.dayEnd}. Nothing before ${r.dayStart} except flights, trains or check-out; everyone is back at the hotel by ${r.dayEnd}.`,
      `2. Pace is "${r.pace}": at most ${r.maxSights[r.pace]} sights/activities/shopping stops a day (meals, rest and transfers do not count).`,
      `3. Items never overlap, and there are at least ${r.bufferMin} minutes between stops in different places, plus the real travel time. One hop should take under ${r.maxTravelMin} minutes by ${r.transport}; group each day's stops by neighbourhood so the day is a loop from the hotel, not a zig-zag across the city.`,
      `4. Lunch between ${r.lunch[0]} and ${r.lunch[1]}, dinner between ${r.dinner[0]} and ${r.dinner[1]}, every full day, near where you are at that time${r.food ? ` (${r.food})` : ''}. Name a real place or a real street/area known for food.`,
      `5. Arrival day: nothing until ${r.arrivalBufferMin} minutes after landing plus the transfer; hotel check-in is from ${r.checkInTime}. Keep that day light and near the hotel.`,
      `6. Departure day: check out by ${r.checkOutTime}; be at the airport ${r.domesticAirportMin} minutes before a domestic flight or ${r.internationalAirportMin} before an international one, after a ${r.transferMin}-minute transfer (use the real distance from the hotel if you know it). Plan only what fits before leaving, close to the hotel.`,
      `7. Respect real opening hours and weekly closing days of each place (for example many museums close on Mondays). If unsure, say "check timings" in the notes.`,
      `8. On days with ${r.rainChance}%+ chance of rain choose indoor plans; on days hotter than ${r.heatC}°C keep 12:00–16:00 indoors. Mark outdoor items with "outdoor": true.`,
      `9. Do not repeat a place on two days. Put the must-see places early in the trip, so a delay or bad weather does not cost them.`,
      `10. Keep to what is safe and allowed: skip areas under travel warnings, and follow any local restrictions in the news you are given.`,
      `11. Budget is ${r.budget}; getting around by ${r.transport}.${r.travellers ? ' Travellers: ' + r.travellers + ' — plan for them (walking, stairs, rests, kid- or elder-friendly).' : ''}${r.interests ? ' Interests: ' + r.interests + '.' : ''}${r.avoid ? ' Avoid: ' + r.avoid + '.' : ''}`,
      `12. Items marked "locked": true were set by the traveller — keep them exactly (time, place, title) and plan around them.`,
    ];
    if(r.extra) lines.push('13. Also: ' + r.extra);
    (r.custom || []).forEach((t, i)=>lines.push((r.extra ? 14 : 13) + i + '. ' + t));      // the traveller's own rules
    if(ctx && ctx.issues) lines.push('The traveller\'s latest requests override rules 1–11 where they conflict, but never rule 12.');
    return lines.join('\n');
  }

  /* ---------------------------------------------------------------- context from the trip's documents */
  /* flights: [{flight, from, to, date, dep, arr, international}], hotel: {name, checkIn, checkOut, checkInTime, checkOutTime}
     -> arrival (the flight landing in this city on/near the first day) and departure */
  function tripAnchors(flights, cityAirports, start, end){
    const inCity = code => cityAirports.indexOf(code) >= 0;
    const arr = (flights || []).filter(f=>inCity(f.to) && f.date && f.date >= addDays(start, -1) && f.date <= end).sort((a, b)=>(a.date + (a.arr || '')).localeCompare(b.date + (b.arr || '')))[0] || null;
    const dep = (flights || []).filter(f=>inCity(f.from) && f.date && f.date >= start && f.date <= addDays(end, 1)).sort((a, b)=>(b.date + (b.dep || '')).localeCompare(a.date + (a.dep || '')))[0] || null;
    return {arrival: arr, departure: dep};
  }

  /* ---------------------------------------------------------------- the checker */
  /* plan: {days:[{date, items:[{start,end,title,place,kind,outdoor,locked}]}]}
     ctx: {start, end, arrival, departure, weather:{date:{rain, tmax}}}
     -> [{level:'error'|'warn'|'info', day, item, rule, text}] */
  function check(plan, rules, ctx){
    const r = merge(rules), out = [];
    ctx = ctx || {};
    const push = (level, day, item, rule, text) => out.push({level, day, item, rule, text});
    const seenPlaces = {};
    const days = (plan && plan.days) || [];
    days.forEach((day, di)=>{
      const items = (day.items || []).slice();
      const isArrival = ctx.arrival && ctx.arrival.date === day.date;
      const isDeparture = ctx.departure && ctx.departure.date === day.date;
      if(ctx.start && day.date < ctx.start || ctx.end && day.date > ctx.end) push('warn', di, null, 'dates', `${day.date} is outside the trip (${ctx.start} – ${ctx.end}).`);
      // times that make sense
      items.forEach((it, ii)=>{
        const s = toMin(it.start), e = toMin(it.end);
        if(s === null) push('warn', di, ii, 'time', `“${it.title}” has no start time.`);
        else if(e !== null && e <= s && !(it.kind === 'flight' || it.kind === 'transit')) push('error', di, ii, 'time', `“${it.title}” ends before it starts (${it.start}–${it.end}).`);
      });
      const timed = items.map((it, ii)=>({it, ii, s: toMin(it.start), e: toMin(it.end) !== null && toMin(it.end) > toMin(it.start) ? toMin(it.end) : toMin(it.start) + 30}))
        .filter(x=>x.s !== null).sort((a, b)=>a.s - b.s);
      // rule 1: the day's window
      timed.forEach(x=>{
        if(['flight', 'transit', 'hotel'].indexOf(x.it.kind) >= 0) return;
        if(x.s < toMin(r.dayStart)) push('warn', di, x.ii, 'window', `“${x.it.title}” starts at ${x.it.start}, before the day starts (${r.dayStart}).`);
        if(x.e > toMin(r.dayEnd)) push('warn', di, x.ii, 'window', `“${x.it.title}” runs to ${toTime(x.e)}, after ${r.dayEnd}.`);
      });
      // rule 3: overlaps and buffers
      for(let k = 1; k < timed.length; k++){
        const a = timed[k - 1], b = timed[k];
        if(b.s < a.e) push('error', di, b.ii, 'overlap', `“${b.it.title}” (${b.it.start}) starts before “${a.it.title}” ends (${toTime(a.e)}).`);
        else if(b.s - a.e < r.bufferMin && norm(a.it.place) !== norm(b.it.place) && ['meal', 'rest', 'free'].indexOf(b.it.kind) < 0 && ['transit', 'flight'].indexOf(a.it.kind) < 0 && ['transit', 'flight'].indexOf(b.it.kind) < 0)
          push('warn', di, b.ii, 'buffer', `Only ${b.s - a.e} min from “${a.it.title}” to “${b.it.title}” (rule: ${r.bufferMin}+ min plus travel).`);
      }
      // rule 2: pace
      const sights = items.filter(it=>SIGHTS.has(it.kind)).length, max = r.maxSights[r.pace] || 3;
      if(sights > max) push('warn', di, null, 'pace', `${sights} sights/activities on ${day.date}; a ${r.pace} day has at most ${max}.`);
      // rule 4: meals on full days
      const full = !isArrival && !isDeparture;
      const mealIn = (w) => timed.some(x=>x.it.kind === 'meal' && x.s >= toMin(w[0]) - 30 && x.s <= toMin(w[1]));
      if(full && timed.length && !mealIn(r.lunch)) push('info', di, null, 'meals', `No lunch between ${r.lunch[0]} and ${r.lunch[1]} on ${day.date}.`);
      if(full && timed.length && !mealIn(r.dinner)) push('info', di, null, 'meals', `No dinner between ${r.dinner[0]} and ${r.dinner[1]} on ${day.date}.`);
      // rule 5: arrival
      if(isArrival && ctx.arrival.arr){
        const free = toMin(ctx.arrival.arr) + r.arrivalBufferMin + r.transferMin;
        timed.forEach(x=>{ if(['flight', 'transit', 'hotel'].indexOf(x.it.kind) < 0 && x.s < free) push('error', di, x.ii, 'arrival', `“${x.it.title}” is at ${x.it.start}, but you land at ${ctx.arrival.arr} (${ctx.arrival.flight}) and reach the hotel around ${toTime(free)}.`); });
      }
      // rule 6: departure
      if(isDeparture && ctx.departure.dep){
        const need = ctx.departure.international ? r.internationalAirportMin : r.domesticAirportMin;
        const leave = toMin(ctx.departure.dep) - need - r.transferMin;
        timed.forEach(x=>{ if(['flight', 'transit', 'hotel'].indexOf(x.it.kind) < 0 && x.e > leave) push('error', di, x.ii, 'departure', `“${x.it.title}” ends ${toTime(x.e)}; to make ${ctx.departure.flight} at ${ctx.departure.dep} you should leave for the airport by ${toTime(Math.max(0, leave))}.`); });
        if(leave < toMin(r.checkOutTime) && leave > 0) push('info', di, null, 'departure', `Leave the hotel by ${toTime(leave)} for ${ctx.departure.flight}.`);
      }
      // rule 8: weather
      const w = ctx.weather && ctx.weather[day.date];
      if(w){
        timed.forEach(x=>{
          if(!x.it.outdoor) return;
          if(w.rain >= r.rainChance) push('warn', di, x.ii, 'weather', `“${x.it.title}” is outdoors and rain is ${w.rain}% likely on ${day.date}.`);
          if(w.tmax >= r.heatC && x.s < 16 * 60 && x.e > 12 * 60) push('warn', di, x.ii, 'weather', `“${x.it.title}” is outdoors in the midday heat (${Math.round(w.tmax)}°C).`);
        });
      }
      // rule 9: no repeats
      items.forEach((it, ii)=>{
        if(!SIGHTS.has(it.kind)) return;
        const k = norm(it.place || it.title);
        if(!k) return;
        if(seenPlaces[k] !== undefined && seenPlaces[k] !== di) push('warn', di, ii, 'repeat', `“${it.title}” is also on ${days[seenPlaces[k]].date}.`);
        else seenPlaces[k] = di;
      });
      // the traveller's own "avoid"
      if(r.avoid){
        const words = r.avoid.split(/[,;]/).map(norm).filter(w=>w.length > 3);
        items.forEach((it, ii)=>{ const t = norm(it.title + ' ' + it.place + ' ' + it.notes); const hit = words.find(w=>t.indexOf(w) >= 0); if(hit) push('warn', di, ii, 'avoid', `“${it.title}” matches something you asked to avoid (“${hit}”).`); });
      }
    });
    // every trip day is planned
    if(ctx.start && ctx.end){
      for(let d = ctx.start; d <= ctx.end; d = addDays(d, 1)) if(!days.some(x=>x.date === d)) push('info', null, null, 'dates', `${d} has no plan yet.`);
    }
    return out;
  }

  /* ---------------------------------------------------------------- the built-in planner (no AI)
     Lays out the fixed parts — flights, transfers, check-in/out, meals — and leaves
     open slots to fill by hand or with AI. */
  function skeleton(ctx, rules){
    const r = merge(rules);
    const days = [], hotel = ctx.hotel || {};
    const hotelName = hotel.name || 'Hotel';
    const n = Math.max(0, daysBetween(ctx.start, ctx.end));
    let id = 0;
    const it = (start, end, title, kind, extra) => Object.assign({id: 'k' + (++id) + Math.random().toString(36).slice(2, 6), start, end, title, place: '', kind, notes: ''}, extra || {});
    for(let i = 0; i <= n; i++){
      const date = addDays(ctx.start, i), items = [];
      const arrival = ctx.arrival && ctx.arrival.date === date ? ctx.arrival : null;
      const departure = ctx.departure && ctx.departure.date === date ? ctx.departure : null;
      let from = toMin(r.dayStart), until = toMin(r.dayEnd);
      if(arrival){
        const land = toMin(arrival.arr) !== null ? toMin(arrival.arr) : 12 * 60;
        items.push(it(toTime(land - 5), toTime(land), `Land in ${ctx.city} — ${arrival.flight}`, 'flight', {place: arrival.to, locked: true}));
        const atHotel = land + r.arrivalBufferMin + r.transferMin;
        items.push(it(toTime(land + r.arrivalBufferMin - 30), toTime(atHotel), 'Transfer to the hotel', 'transit', {place: hotelName}));
        items.push(it(toTime(Math.max(atHotel, toMin(r.checkInTime))), toTime(Math.max(atHotel, toMin(r.checkInTime)) + 30), 'Check in', 'hotel', {place: hotelName}));
        from = Math.max(atHotel, toMin(r.checkInTime)) + 60;
      } else if(i === 0){
        items.push(it(r.checkInTime, toTime(toMin(r.checkInTime) + 30), 'Check in', 'hotel', {place: hotelName}));
        from = toMin(r.checkInTime) + 60;
      }
      if(departure){
        const dep = toMin(departure.dep) !== null ? toMin(departure.dep) : 18 * 60;
        const need = departure.international ? r.internationalAirportMin : r.domesticAirportMin;
        const leave = dep - need - r.transferMin;
        const out = Math.min(toMin(r.checkOutTime), leave);
        items.push(it(toTime(out - 20), toTime(out), 'Check out', 'hotel', {place: hotelName}));
        items.push(it(toTime(leave), toTime(dep - need), 'Transfer to the airport', 'transit', {place: departure.from}));
        items.push(it(toTime(dep), toTime(toMin(departure.arr) || dep + 60), `${departure.flight} to ${departure.to}`, 'flight', {place: departure.from, locked: true}));
        until = Math.min(until, leave - r.bufferMin);
      } else if(i === n && !departure){
        items.push(it(toTime(toMin(r.checkOutTime) - 20), r.checkOutTime, 'Check out', 'hotel', {place: hotelName}));
      }
      // open slots and meals inside [from, until], fitted around the fixed items
      const fixed = items.map(x=>[toMin(x.start), Math.max(toMin(x.end), toMin(x.start) + 1)]);
      const fit = (s, e, min) => {
        s = Math.max(s, from); e = Math.min(e, until);
        const pieces = [[s, e]];
        fixed.forEach(([fs, fe])=>{
          for(let k = pieces.length - 1; k >= 0; k--){
            const [ps, pe] = pieces[k];
            if(fe + r.bufferMin <= ps || fs - r.bufferMin >= pe) continue;
            pieces.splice(k, 1, [ps, fs - r.bufferMin], [fe + r.bufferMin, pe]);
          }
        });
        const best = pieces.filter(([ps, pe])=>pe - ps >= min).sort((x, y)=>(y[1] - y[0]) - (x[1] - x[0]))[0];
        return best || null;
      };
      const lunchS = toMin(r.lunch[0]), dinnerS = toMin(r.dinner[0]);
      const slots = [
        [toMin(r.dayStart), lunchS - r.bufferMin, 'Morning — open', 'free', 60],
        [lunchS, toMin(r.lunch[1]), 'Lunch', 'meal', 45],
        [lunchS + 60 + r.bufferMin, dinnerS - r.bufferMin, 'Afternoon — open', 'free', 60],
        [dinnerS, toMin(r.dinner[1]), arrival ? 'Dinner near the hotel' : 'Dinner', 'meal', 45],
      ];
      slots.forEach(([s, e, title, kind, min])=>{
        const got = fit(s, e, min);
        if(!got) return;
        const end = kind === 'meal' ? Math.min(got[1], got[0] + (title.startsWith('Dinner') ? 75 : 60)) : got[1];
        items.push(it(toTime(got[0]), toTime(end), title, kind));
        fixed.push([got[0], end]);
      });
      items.sort((a, b)=>(toMin(a.start) || 0) - (toMin(b.start) || 0));
      days.push({date, title: arrival ? 'Arrival' : departure ? 'Departure' : (i === n ? 'Last day' : 'Day ' + (i + 1)), items});
    }
    return {days};
  }

  /* An AI answer -> a clean plan (drops junk, keeps locked items exactly as they were). */
  function clean(raw, previous){
    const days = (raw && raw.days || []).filter(d=>d && /^\d{4}-\d{2}-\d{2}$/.test(d.date)).map(d=>({
      date: d.date, title: String(d.title || '').slice(0, 80),
      items: (d.items || []).filter(i=>i && i.title).map(i=>({
        id: i.id || ('a' + Math.random().toString(36).slice(2, 9)),
        start: toMin(i.start) !== null ? toTime(toMin(i.start)) : '', end: toMin(i.end) !== null ? toTime(toMin(i.end)) : '',
        title: String(i.title).slice(0, 120), place: String(i.place || '').slice(0, 160),
        kind: KINDS.indexOf(i.kind) >= 0 ? i.kind : 'sight', notes: String(i.notes || '').slice(0, 400),
        outdoor: !!i.outdoor, cost: i.cost ? String(i.cost).slice(0, 40) : '', locked: !!i.locked,
      })).sort((a, b)=>(toMin(a.start) || 0) - (toMin(b.start) || 0)),
    })).sort((a, b)=>a.date.localeCompare(b.date));
    // locked items survive whatever the AI did with them
    if(previous && previous.days){
      previous.days.forEach(pd=>(pd.items || []).filter(i=>i.locked).forEach(li=>{
        let day = days.find(d=>d.date === pd.date);
        if(!day){ day = {date: pd.date, title: pd.title || '', items: []}; days.push(day); }
        const same = day.items.findIndex(i=>i.id === li.id || (norm(i.title) === norm(li.title) && i.start === li.start));
        if(same >= 0) day.items[same] = Object.assign({}, li);
        else day.items.push(Object.assign({}, li));
        day.items.sort((a, b)=>(toMin(a.start) || 0) - (toMin(b.start) || 0));
      }));
      days.sort((a, b)=>a.date.localeCompare(b.date));
    }
    return {days};
  }

  /* ---------------------------------------------------------------- the fixer (no AI)
     Moves whatever breaks a time rule to the first time that is allowed, keeping the order of the day: after landing
     and the transfer, before leaving for the airport, inside the day, never overlapping and with the gap between
     stops. What no longer fits goes to the nearest day with room, or is taken out. Too many sights on a day go to a
     lighter day; a place already seen on an earlier day is taken out. Flights, transfers, check-in/out and locked
     items never move. The same helpers schedule the places an AI picked into a day's open slots (fill).
     -> {days, changes: [text]} */
  const FIXED = it => !!it.locked || ['flight', 'transit', 'hotel'].indexOf(it.kind) >= 0;
  const TRAVEL = k => k === 'transit' || k === 'flight';
  const spanOf = it => { const s = toMin(it.start), e = toMin(it.end); return {s, e: s === null ? null : e !== null && e > s ? e : s + 30}; };
  const lengthOf = it => { const s = toMin(it.start), e = toMin(it.end); return s !== null && e !== null && e > s ? e - s : it.kind === 'meal' ? 60 : 90; };
  function windowOf(date, r, ctx){
    let from = toMin(r.dayStart), until = toMin(r.dayEnd);
    if(ctx.arrival && ctx.arrival.date === date && toMin(ctx.arrival.arr) !== null) from = Math.max(from, toMin(ctx.arrival.arr) + r.arrivalBufferMin + r.transferMin);
    if(ctx.departure && ctx.departure.date === date && toMin(ctx.departure.dep) !== null){
      const need = ctx.departure.international ? r.internationalAirportMin : r.domesticAirportMin;
      until = Math.min(until, toMin(ctx.departure.dep) - need - r.transferMin);
    }
    return {from, until};
  }
  // the gap the checker wants between two stops that follow each other
  const gapBetween = (a, b, r) => a && b && norm(a.place) !== norm(b.place) && ['meal', 'rest', 'free'].indexOf(b.kind) < 0 && !TRAVEL(a.kind) && !TRAVEL(b.kind) ? r.bufferMin : 0;
  /* The first start >= earliest where `it` (for `len` minutes) fits among `busy` [{s, e, it}] and ends by `until`.
     A sight or a meal may be shortened to 45 minutes to fit. -> {s, e} or null */
  function slotFor(busy, it, len, earliest, until, r){
    // a meal: a shorter one on time beats a full one late
    if(it.kind === 'meal' && len > 45 && !r.noShort && !r.short){ const a = slotFor(busy, it, len, earliest, until, Object.assign({}, r, {noShort: 1})), b = slotFor(busy, it, 45, earliest, until, Object.assign({}, r, {short: 1})); return !a ? b : b && b.s < a.s ? b : a; }
    for(const d of len > 45 && SIGHTS.has(it.kind) && !r.noShort ? [len, 45] : [len]){
      let s = earliest;
      for(let n = 0; n < 60; n++){
        const hit = busy.find(b=>!(s >= b.e + gapBetween(b.it, it, r) || s + d + gapBetween(it, b.it, r) <= b.s));
        if(!hit) break;
        s = hit.e + gapBetween(hit.it, it, r);
      }
      if(s + d <= until) return {s, e: s + d};
      // shorten to what is left, if that is still a real visit
      if(SIGHTS.has(it.kind) && !r.noShort && until - s >= 45 && until - s < d && !busy.some(b=>!(s >= b.e + gapBetween(b.it, it, r) || until + gapBetween(it, b.it, r) <= b.s))) return {s, e: until};
    }
    return null;
  }
  const busyOf = (items, skip) => items.filter(x=>x !== skip && toMin(x.start) !== null).map(x=>Object.assign({it: x}, spanOf(x)));
  const setTimes = (it, p) => { it.start = toTime(p.s); it.end = toTime(p.e); };
  const niceDate = d => { const x = new Date(d + 'T00:00:00Z'); return x.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getUTCMonth()]; };
  const byStart = (a, b) => (toMin(a.start) || 0) - (toMin(b.start) || 0);

  /* A day with its open slots filled: picks [{slot: id of an open ("free") item, item}] are laid one after another
     inside that slot's hours; a slot that got picks goes. -> {day, unplaced: [item]} */
  function fill(day, picks, rules, ctx){
    const r = merge(rules), w = windowOf(day.date, r, ctx || {});
    const items = day.items.map(x=>Object.assign({}, x)), unplaced = [];
    const used = new Set(picks.map(p=>p.slot));
    const slots = {};
    items.forEach(x=>{ if(used.has(x.id) && x.kind === 'free') slots[x.id] = spanOf(x); });
    let out = items.filter(x=>!slots[x.id]);
    picks.forEach(p=>{
      const slot = slots[p.slot] || {s: w.from, e: w.until};
      const it = Object.assign({}, p.item);
      const got = slotFor(busyOf(out), it, lengthOf(it), Math.max(slot.s, w.from), Math.min(slot.e, w.until), r);
      if(got){ setTimes(it, got); out.push(it); } else unplaced.push(it);
    });
    out.sort(byStart);
    return {day: Object.assign({}, day, {items: out}), unplaced};
  }

  function repair(plan, rules, ctx){
    const r = merge(rules), changes = [];
    ctx = ctx || {};
    const days = ((plan && plan.days) || []).map(d=>Object.assign({}, d, {items: (d.items || []).map(x=>Object.assign({}, x))}));
    const max = r.maxSights[r.pace] || 3;
    const sightsOn = d => d.items.filter(x=>SIGHTS.has(x.kind)).length;
    const homeless = [];
    // 1. each day: the movable items, in their order, each at the first allowed time
    days.forEach(day=>{
      const w = windowOf(day.date, r, ctx);
      // open blocks are only placeholders: they give way, and fill what time is left afterwards
      const open = day.items.filter(x=>x.kind === 'free' && !x.locked);
      const fixed = day.items.filter(FIXED), movable = day.items.filter(x=>!FIXED(x) && open.indexOf(x) < 0).sort(byStart);
      const placed = fixed.slice();
      let prev = null, cursor = w.from;
      movable.forEach(it=>{
        const was = it.start, wasEnd = it.end, own = toMin(it.start);
        const earliest = Math.max(w.from, own === null ? cursor : own, prev ? cursor + gapBetween(prev, it, r) : w.from);
        const got = slotFor(busyOf(placed), it, lengthOf(it), earliest, w.until, r);
        if(!got){ homeless.push({it, from: day}); return; }
        setTimes(it, got);
        if(it.start !== was) changes.push(`Moved “${it.title}” on ${niceDate(day.date)} from ${was || 'no time'} to ${it.start}.`);
        else if(it.end !== wasEnd && wasEnd) changes.push(`Shortened “${it.title}” on ${niceDate(day.date)} to end at ${it.end}.`);
        placed.push(it); prev = it; cursor = got.e;
      });
      open.forEach(o=>{
        const sp = spanOf(o);
        if(sp.s === null) return;
        // the longest free stretch inside the block's own hours, between what is planned (with the gaps)
        const busy = busyOf(placed).sort((a, b)=>a.s - b.s);
        let best = null, from = Math.max(sp.s, w.from);
        busy.concat([{s: Math.min(sp.e, w.until), e: Infinity}]).forEach(bz=>{
          const end = Math.min(bz.s - (bz.it ? r.bufferMin : 0), sp.e, w.until);
          if(end - from >= 45 && (!best || end - from > best.e - best.s)) best = {s: from, e: end};
          if(bz.it) from = Math.max(from, bz.e + r.bufferMin);
        });
        if(best){ setTimes(o, best); placed.push(o); }
      });
      day.items = placed.sort(byStart);
    });
    // 2. a day with too many sights passes its last ones on
    days.forEach(day=>{
      const extra = sightsOn(day) - max;
      if(extra <= 0) return;
      day.items.filter(x=>SIGHTS.has(x.kind) && !x.locked).slice(-extra).forEach(it=>{ day.items = day.items.filter(x=>x !== it); homeless.push({it, from: day, pace: true}); });
    });
    // 3. what did not fit: the nearest day with room (never a meal or an open block - every day has its own)
    const di = d => days.indexOf(d);
    const placeKey = it => norm(it.place || it.title);
    const onAnother = (it, from) => days.some(d=>d !== from && d.items.some(x=>SIGHTS.has(x.kind) && placeKey(x) === placeKey(it)));
    homeless.forEach(({it, from, pace})=>{
      if(SIGHTS.has(it.kind) && placeKey(it) && onAnother(it, from)){ changes.push(`Took out “${it.title}” on ${niceDate(from.date)} — already on another day.`); return; }
      if(!SIGHTS.has(it.kind)){ changes.push(`Took out “${it.title}” on ${niceDate(from.date)} — no time left for it that day.`); return; }
      const order = days.filter(d=>d !== from).sort((a, b)=>Math.abs(di(a) - di(from)) - Math.abs(di(b) - di(from)) || di(a) - di(b));
      for(const day of order){
        if(sightsOn(day) >= max) continue;
        const w = windowOf(day.date, r, ctx);
        const got = slotFor(busyOf(day.items), it, lengthOf(it), w.from, w.until, r);
        if(!got) continue;
        const was = it.start; setTimes(it, got);
        day.items.push(it); day.items.sort(byStart);
        changes.push(`Moved “${it.title}” from ${niceDate(from.date)}${was ? ' ' + was : ''} to ${niceDate(day.date)} ${it.start}${pace ? ' (too many sights that day)' : ''}.`);
        return;
      }
      if(pace){ from.items.push(it); from.items.sort(byStart); return; }        // nowhere lighter: it stays, the checker still says so
      changes.push(`Took out “${it.title}” from ${niceDate(from.date)} — no room left on any day.`);
    });
    // 4. the same place twice: the later visit goes
    const seen = {};
    days.forEach(day=>{
      day.items = day.items.filter(it=>{
        if(!SIGHTS.has(it.kind) || it.locked) return true;
        const k = norm(it.place || it.title);
        if(!k) return true;
        if(seen[k]){ changes.push(`Took out “${it.title}” on ${niceDate(day.date)} — already on ${niceDate(seen[k])}.`); return false; }
        seen[k] = day.date; return true;
      });
    });
    return {days, changes};
  }

  /* ---------------------------------------------------------------- the documents checklist
     Rules say which documents a trip needs; the trip's documents tick them off by themselves. Every rule is editable. */
  const DOC_RULES = [
    {id: 'passport', name: 'Passport', per: 'traveller', when: 'international', types: ['passport'], required: true, anyTrip: true, validMonths: 6,
     note: 'Valid at least 6 months after you come back.'},
    {id: 'visa', name: 'Visa or e-Visa', per: 'traveller', when: 'international', types: ['visa'], required: true, validThrough: true, except: '',
     note: 'Not needed for visa-free countries — add them under “Not for”.'},
    {id: 'tickets', name: 'Flight ticket or boarding pass', per: 'traveller', when: 'flights', types: ['flight', 'boarding-pass'], required: true},
    {id: 'hotel', name: 'Hotel booking', per: 'trip', when: 'always', types: ['hotel'], required: true},
    {id: 'insurance', name: 'Travel insurance', per: 'traveller', when: 'international', types: ['insurance'], required: false},
    {id: 'photo-id', name: 'Photo ID (Aadhaar, PAN, driving licence or voter ID)', per: 'traveller', when: 'domestic', types: ['aadhaar', 'pan', 'licence', 'voter-id', 'passport'], required: true, anyTrip: true},
    {id: 'forex', name: 'Forex card or local cash', per: 'trip', when: 'international', types: [], required: false},
  ];
  const WHEN = {always: 'Always', international: 'International trips', domestic: 'Trips at home', flights: 'When flying', countries: 'Only these countries'};
  const nk = n => String(n || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const listOf = t => String(t || '').split(/[,;\n]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
  const addMonths = (iso, m) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };

  /* Does a rule apply to this trip? trip: {country, international, hasFlights} */
  function applies(rule, trip){
    const c = String(trip.country || '').toLowerCase();
    if(rule.except && listOf(rule.except).indexOf(c) >= 0) return false;
    switch(rule.when){
      case 'international': return !!trip.international;
      case 'domestic': return !trip.international;
      case 'flights': return !!trip.hasFlights;
      case 'countries': return listOf(rule.countries).indexOf(c) >= 0;
      default: return true;
    }
  }
  /* The checklist -> [{key, rule, person, status: 'done'|'ticked'|'expiring'|'missing', doc, why}]
     trip: {id, start, end, country, international, hasFlights}; travellers: names; docs: every document;
     ticks: {key: {done}}; custom: [{id, text, per, required}] (this trip's own items). */
  function checklist(trip, travellers, docs, rules, ticks, custom){
    const out = [];
    ticks = ticks || {};
    const mine = (d, person) => nk(d.person) === nk(person) || (d.fields && (d.fields.passengers || []).some(n=>nk(n) === nk(person)));
    const item = (rule, person) => {
      const key = rule.id + '|' + (person ? nk(person) : 'trip');
      const pool = docs.filter(d=>(rule.types || []).indexOf(d.type) >= 0 && (rule.anyTrip || d.tripId === trip.id) && (!person || mine(d, person)));
      let status = 'missing', doc = null, why = '';
      // the best one: valid long enough, else the latest to expire
      const need = rule.validMonths && trip.end ? addMonths(trip.end, rule.validMonths) : rule.validThrough && trip.end ? trip.end : '';
      const ok = d => !need || !d.fields || !d.fields.validUntil || d.fields.validUntil >= need;
      doc = pool.find(ok) || pool.slice().sort((a, b)=>String((b.fields || {}).validUntil).localeCompare(String((a.fields || {}).validUntil)))[0] || null;
      if(doc){
        if(ok(doc)) status = 'done';
        else { status = 'expiring'; why = 'valid until ' + doc.fields.validUntil + ' — needs ' + (rule.validMonths ? rule.validMonths + ' months after you return (' + need + ')' : 'the whole trip (to ' + need + ')'); }
      }
      if(status !== 'done' && ticks[key] && ticks[key].done){ status = 'ticked'; }
      out.push({key, rule, person: person || '', status, doc, why});
    };
    (rules || []).filter(r=>r && r.name && r.off !== true && applies(r, trip)).forEach(r=>{
      if(r.per === 'trip') item(r, '');
      else (travellers.length ? travellers : ['']).forEach(p=>item(r, p));
    });
    (custom || []).forEach(c=>{
      const r = {id: 'c-' + c.id, name: c.text, per: c.per, types: [], required: c.required !== false, custom: true, cid: c.id};
      if(c.per === 'trip' || !travellers.length) item(r, '');
      else travellers.forEach(p=>item(r, p));
    });
    return out;
  }

  return {DEFAULTS, KINDS, merge, asPrompt, check, skeleton, clean, repair, fill, windowOf, tripAnchors, toMin, toTime, addDays, daysBetween, DOC_RULES, WHEN, applies, checklist};
})();
if(typeof module !== 'undefined') module.exports = Rules;
