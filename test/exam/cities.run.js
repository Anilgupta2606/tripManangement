/* Plans every exam city in a real browser (the local site on :8794) and scores each plan out of 100:
   rules kept 25 · the answer key's 5 must-sees 25 · full days filled 15 · short hops 15 · variety 10 · meals at named places 10 */
const puppeteer = require('puppeteer-core');
const cities = require('./cities.exam.js');
const only = process.argv[2];
(async ()=>{
  const b = await puppeteer.launch({executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new'});
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:8794/tripManangement/', {waitUntil: 'networkidle0'});
  let total = 0, n = 0;
  for(const c of cities.filter(x=>!only || x.city === only)){
    const r = await p.evaluate(async (c)=>{
      const ctx = {city: c.city, country: c.country, start: '2026-11-10', end: '2026-11-13', hotel: {name: c.hotel, address: ''}, arrival: null, departure: null, rules: {}};
      const know = await Knowledge.gather(c.city, c.country, ctx.hotel);
      const res = TripBrain.plan(ctx, know, {}, null);
      const cands = TripBrain.candidates(know, ctx, TripBrain.preferences({}));
      const famous = cands.filter(x=>x.value > 0 && x.views > 0).sort((a, b)=>b.views - a.views).slice(0, 5).map(x=>x.name);
      const S = ['sight', 'activity', 'shopping'];
      const stops = res.days.map(d=>d.items.filter(i=>S.includes(i.kind)));
      const names = stops.flat().map(i=>i.title);
      const lc = x => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const hit = m => m.split('|').some(alt=>names.some(n=>lc(n).includes(lc(alt)) || lc(alt).includes(lc(n)) && lc(n).length > 5));
      const mustHit = c.must.filter(hit), mustMiss = c.must.filter(m=>!hit(m));
      const probs = Rules.check({days: res.days}, {}, ctx).filter(x=>x.level !== 'info');
      const full = res.days.slice(1, -1);
      const hops = res.days.flatMap(d=>d.items.filter(i=>S.includes(i.kind)).map(i=>{ const m = /(\d+) min (walk|by)/.exec(i.notes || ''); return m ? +m[1] : null; })).filter(x=>x != null);
      const avgHop = hops.length ? hops.reduce((s, x)=>s + x, 0) / hops.length : 60;
      const dayCats = stops.map(list=>list.map(i=>MoneyBrain.categoryOf(i.title, '')).filter(x=>x !== 'sight'));
      const varied = dayCats.filter(cs=>new Set(cs).size === cs.length).length / Math.max(1, dayCats.length);
      const meals = res.days.flatMap(d=>d.items.filter(i=>i.kind === 'meal')), named = meals.filter(i=>/ — /.test(i.title)).length / Math.max(1, meals.length);
      const score = {
        rules: Math.max(0, 25 - 5 * probs.length),
        famous: Math.round(25 * mustHit.length / c.must.length),
        filled: Math.round(15 * full.filter(d=>d.items.filter(i=>S.includes(i.kind)).length >= 2).length / Math.max(1, full.length)),
        hops: Math.round(15 * Math.max(0, Math.min(1, (45 - avgHop) / 25))),
        variety: Math.round(10 * varied),
        meals: Math.round(10 * named),
      };
      return {city: c.city, score, total: Object.values(score).reduce((s, x)=>s + x, 0), famous, missed: mustMiss, mustHit, avgHop: Math.round(avgHop), probs: probs.map(x=>x.text),
        guide: know.guide ? know.guide.title + ' (' + know.guide.listings.length + ')' : 'none', hotel: !!know.hotelLoc, cands: cands.length,
        days: res.days.map(d=>d.date.slice(5) + ' ' + d.title + ': ' + d.items.filter(i=>i.kind !== 'hotel').map(i=>i.start + ' ' + i.title).join(' | '))};
    }, c).catch(e=>({city: c.city, error: e.message, total: 0}));
    n++; total += r.total || 0;
    console.log(`\n=== ${r.city}: ${r.total}/100 ${r.error ? 'ERROR ' + r.error : JSON.stringify(r.score)}  guide ${r.guide} · hotel found ${r.hotel} · ${r.cands} places · avg hop ${r.avgHop} min`);
    if(r.famous) console.log('  must-sees: ' + r.mustHit.length + '/5' + (r.missed.length ? '   MISSED: ' + r.missed.join(', ') : '') + '   (its best-known by fame: ' + r.famous.slice(0, 5).join(', ') + ')');
    (r.probs || []).forEach(x=>console.log('  rule: ' + x));
    (r.days || []).forEach(x=>console.log('  ' + x));
  }
  console.log(`\nPLANNING EXAM: average ${Math.round(total / Math.max(1, n))}/100 over ${n} cities`);
  await b.close();
})();
