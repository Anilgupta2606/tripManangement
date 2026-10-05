/* The plan's history (plan.js storePlan): each update lists what it changed against the plan BEFORE it - it once
   compared the new plan with itself and said "Nothing in the plan changed" every time - and says when a place
   asked for was already in the plan. Loads plan.js with small stand-ins for the page. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

function load(){
  const ctx = {console, Date, JSON, Math, Object, Array, String, Set, Map, Promise, setTimeout,
    Rules: require('../rules.js'), VIEWS: {}, S: {plans: {}, settings: {}}, save(){}, render(){}, touch: x=>x,
    fmtDate: (d, dow)=>d + (dow ? ' (dow)' : '')};
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
