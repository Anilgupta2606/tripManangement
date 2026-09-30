const test = require('node:test');
const assert = require('node:assert');
const Rules = require('../rules.js');

const ctx = {city: 'Mumbai', start: '2026-10-12', end: '2026-10-16', hotel: {name: 'Taj Lands End'},
  arrival: {flight: '6E2134', from: 'DEL', to: 'BOM', date: '2026-10-12', dep: '07:45', arr: '09:55'},
  departure: {flight: '6E5321', from: 'BOM', to: 'DEL', date: '2026-10-16', dep: '19:10', arr: '21:20'}};

test('skeleton covers every day and follows its own rules', ()=>{
  const plan = Rules.skeleton(ctx);
  assert.equal(plan.days.length, 5);
  assert.equal(plan.days[0].items[0].kind, 'flight');
  assert.ok(plan.days[4].items.some(i=>i.title.startsWith('6E5321')));
  const errors = Rules.check(plan, {}, ctx).filter(p=>p.level === 'error');
  assert.deepEqual(errors, []);
});

test('checker catches overlaps, arrival and departure clashes, pace, repeats, weather', ()=>{
  const plan = {days: [
    {date: '2026-10-12', items: [{start: '10:00', end: '11:00', title: 'Gateway of India', kind: 'sight'}]},
    {date: '2026-10-13', items: [
      {start: '09:30', end: '11:00', title: 'Elephanta Caves', kind: 'sight', outdoor: true},
      {start: '10:30', end: '12:00', title: 'Museum', kind: 'sight'},
      {start: '12:30', end: '13:30', title: 'Lunch', kind: 'meal'},
      {start: '14:00', end: '15:00', title: 'Gateway of India', kind: 'sight'},
      {start: '15:30', end: '16:30', title: 'Colaba Causeway', kind: 'shopping'},
      {start: '19:30', end: '20:30', title: 'Dinner', kind: 'meal'}]},
    {date: '2026-10-16', items: [{start: '15:00', end: '17:00', title: 'Juhu Beach', kind: 'sight'}]},
  ]};
  const probs = Rules.check(plan, {}, Object.assign({}, ctx, {weather: {'2026-10-13': {rain: 80, tmax: 30}}}));
  const rules = probs.map(p=>p.rule);
  ['overlap', 'arrival', 'departure', 'pace', 'repeat', 'weather'].forEach(r=>assert.ok(rules.includes(r), r));
  assert.ok(probs.some(p=>p.rule === 'dates' && /2026-10-14/.test(p.text)));
});

test('clean keeps locked items', ()=>{
  const prev = {days: [{date: '2026-10-13', items: [{id: 'x1', start: '15:00', end: '16:00', title: 'Meeting', kind: 'activity', locked: true}]}]};
  const ai = {days: [{date: '2026-10-13', items: [{start: '09:00', end: '10:00', title: 'Walk', kind: 'sight'}, {start: '8:5', title: 'bad'}]}]};
  const out = Rules.clean(ai, prev);
  assert.equal(out.days[0].items.length, 3);
  assert.ok(out.days[0].items.some(i=>i.id === 'x1' && i.start === '15:00'));
  assert.ok(Rules.asPrompt({pace: 'relaxed'}).includes('at most 2'));
});
