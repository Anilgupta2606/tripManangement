/* The plan's history (plan.js storePlan): each update lists what it changed against the plan BEFORE it - it once
   compared the new plan with itself and said "Nothing in the plan changed" every time - and says when a place
   asked for was already in the plan. Loads plan.js with small stand-ins for the page. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

function load(){
  const ctx = {console, Date, JSON, Math, Object, Array, String, Set, Map, Promise, setTimeout,
    Rules: require('../rules.js'), VIEWS: {}, S: {plans: {}, settings: {}}, save(){}, render(){}, touch: x=>x,
    fmtDate: (d, dow)=>d + (dow ? ' (dow)' : ''), esc: s=>String(s == null ? '' : s).replace(/[&<>"]/g, ch=>({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[ch])};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../plan.js'), 'utf8'), ctx);
  return ctx;
}
const day = (date, items) => ({date, items});
const it = (start, title, kind) => ({start, end: start, title, kind: kind || 'sight'});

test('history: an update lists what changed against the plan before it', ()=>{
  const c = load(), trip = {id: 't1'}, city = {city: 'Dubai'};
  c.storePlan(trip, city, [day('2026-12-23', [it('10:00', 'Dubai Frame'), it('12:30', 'Lunch — Puranmal', 'meal')])], 'Trip Vault planner (no AI)', 'Planned');
  c.storePlan(trip, city, [day('2026-12-23', [it('10:00', 'Dubai Frame'), it('12:30', 'Lunch — Saravana Bhavan', 'meal'), it('17:25', 'Creek Park')])],
    'Trip Vault planner (no AI)', 'add creek park also', {asked: {placed: ['Creek Park'], unplaced: [], notFound: []}});
  const h = c.S.plans['t1|dubai'].history;
  assert.deepEqual(h[1].changes, ['Added Creek Park — Wed 23 Dec, 17:25', 'Lunch, Wed 23 Dec: Puranmal → Saravana Bhavan']);
  assert.equal(h[1].why, 'Included as you asked: Creek Park');
  // asked again: nothing changes, and it says where the place already is
  c.storePlan(trip, city, c.S.plans['t1|dubai'].days, 'Trip Vault planner (no AI)', 'add creek park also', {asked: {placed: ['Creek Park'], unplaced: [], notFound: []}});
  const last = c.S.plans['t1|dubai'].history[2];
  assert.deepEqual(last.changes, []);
  assert.equal(last.why, 'Already in your plan: Creek Park — 2026-12-23 (dow), 17:25');
});

test('history explains: what was removed or moved to fit a new place sits under it, with why', ()=>{
  const Rules = require('../rules.js');
  const before = [day('2026-12-23', [it('15:00', 'Dinosaur Park'), it('19:00', 'Dinner — Al Fresco', 'meal')]),
                  day('2026-12-25', [it('10:20', 'Palm Islands'), it('15:30', 'Lost Chambers')])];
  const after = [day('2026-12-23', [it('17:25', 'Creek Park'), it('19:00', 'Dinner — Legends Steakhouse', 'meal')]),
                 day('2026-12-25', [it('10:20', 'Lost Chambers'), it('15:30', 'Palm Islands')])];
  const ex = Rules.explainPlans(before, after);
  assert.equal(ex[0].text, 'Added Creek Park — Wed 23 Dec, 17:25');
  assert.deepEqual(ex[0].sub.map(x=>[x.text, x.because]), [
    ['Removed Dinosaur Park — Wed 23 Dec', 'to make room for Creek Park'],
    ['Dinner, Wed 23 Dec: Al Fresco → Legends Steakhouse', 'nearer to Creek Park']]);
  assert.deepEqual(ex.slice(1).map(x=>x.because), ['order changed on that day', 'order changed on that day']);
  // and the page shows it nested, with the reasons
  const c = load();
  const html = c.changeTree(ex);
  assert.match(html, /Added Creek Park[\s\S]*<ul class="changes sub">[\s\S]*to make room for Creek Park/);
});

test('an entry saved by the broken version shows its real changes, rebuilt from the saved versions', ()=>{
  const c = load();
  const v1 = [day('2026-12-23', [it('15:00', 'Dinosaur Park')])], v2 = [day('2026-12-23', [it('16:15', 'Global Village')])], now = [day('2026-12-23', [it('16:15', 'Global Village'), it('18:40', 'Creek Park')])];
  const plan = {days: now, versions: [{at: 1000, days: v1}, {at: 5000, days: v2}],
    history: [{at: 1001, text: 'Add global village', changes: []}, {at: 5002, text: 'add creek park also', changes: []}]};
  const a = c.entryChanges(plan, plan.history[0]), b = c.entryChanges(plan, plan.history[1]);
  assert.equal(a[0].text, 'Added Global Village — Wed 23 Dec, 16:15');
  assert.deepEqual(a[0].sub.map(x=>x.because), ['to make room for Global Village']);
  assert.deepEqual(b.map(x=>x.text), ['Added Creek Park — Wed 23 Dec, 18:40']);
  assert.equal(c.entryChanges({days: now, versions: []}, {at: 9, changes: []}), null);   // versions gone (Undo): the old line stays
});
