/* The no-AI fixer: every time rule break it can fix is gone, locked and fixed items stay put. */
const test = require('node:test');
const assert = require('node:assert');
const Rules = require('../rules.js');

const ctx = {start: '2026-12-23', end: '2026-12-25',
  arrival: {date: '2026-12-23', arr: '10:25', flight: '6E1461', to: 'DXB'},
  departure: {date: '2026-12-25', dep: '10:40', flight: '6E1462', from: 'DXB', international: true}};
const I = (start, end, title, kind, extra) => Object.assign({id: title, start, end, title, place: title, kind, notes: ''}, extra || {});
const plan = () => ({days: [
  {date: '2026-12-23', items: [
    I('10:25', '10:55', 'Landing - Indigo 6E1461', 'flight', {locked: true}),
    I('10:55', '11:30', 'Taxi to Hotel', 'transit'),
    I('12:30', '13:30', 'Lunch - Al Karama Cafe', 'meal'),
    I('14:00', '14:30', 'Check in', 'hotel'),
    I('16:00', '17:00', 'Abra to Deira Side', 'activity'),
    I('17:15', '18:15', 'Spice Souk', 'shopping'),
    I('19:30', '20:30', 'Dinner', 'meal'),
  ]},
  {date: '2026-12-24', items: [
    I('06:30', '07:15', 'Early Breakfast', 'meal'),
    I('09:30', '11:30', 'Dubai Museum', 'sight'),
    I('12:00', '13:00', 'Burj Khalifa', 'sight'),
    I('13:00', '14:00', 'Lunch', 'meal'),
    I('14:30', '16:30', 'Dubai Mall', 'shopping'),
    I('17:00', '18:00', 'Dubai Fountain', 'sight'),
    I('19:30', '21:00', 'Dinner', 'meal'),
  ]},
  {date: '2026-12-25', items: [
    I('05:30', '06:00', 'Check out', 'hotel'),
    I('06:00', '07:00', 'Transfer to the airport', 'transit'),
    I('08:00', '09:00', 'Spice Souk', 'shopping'),
    I('10:40', '14:00', '6E1462 to Delhi', 'flight', {locked: true}),
  ]},
]});

test('the checker finds the screenshot\'s breaks first', ()=>{
  const p = Rules.check(plan(), {}, ctx).map(x=>x.rule);
  ['arrival', 'buffer', 'window', 'pace', 'departure'].forEach(r=>assert.ok(p.indexOf(r) >= 0, r));
});

test('repair leaves no rule break and no timing warning', ()=>{
  const {days, changes} = Rules.repair(plan(), {}, ctx);
  const left = Rules.check({days}, {}, ctx).filter(x=>x.level !== 'info');
  assert.deepStrictEqual(left.map(x=>x.text), []);
  assert.ok(changes.length >= 4, changes.join('\n'));
  // lunch now after reaching the hotel (10:25 + 90 + 60 = 12:55)
  const lunch = days[0].items.find(x=>/Lunch/.test(x.title));
  assert.ok(Rules.toMin(lunch.start) >= Rules.toMin('12:55'), lunch.start);
});

test('fixed and locked items never move', ()=>{
  const {days} = Rules.repair(plan(), {}, ctx);
  const f = days[0].items.find(x=>/Landing/.test(x.title)), t = days[2].items.find(x=>/Transfer/.test(x.title));
  assert.strictEqual(f.start, '10:25');
  assert.strictEqual(t.start, '06:00');
});

test('a sight with no room on the departure day moves or goes, never stays broken', ()=>{
  const {days, changes} = Rules.repair(plan(), {}, ctx);
  assert.ok(!days[2].items.some(x=>x.title === 'Spice Souk'));
  assert.ok(changes.some(c=>/Spice Souk/.test(c)));
});

test('too many sights: the extra one goes to a lighter day', ()=>{
  const p = plan();
  p.days[1].items.push(I('18:20', '19:10', 'Gold Souk', 'shopping'));
  const {days} = Rules.repair(p, {pace: 'balanced'}, ctx);
  const n = d => d.items.filter(x=>['sight', 'activity', 'shopping'].indexOf(x.kind) >= 0).length;
  // day 3 is the early departure (no time at all), so day 1 takes one and the other stays: the checker still says so
  assert.strictEqual(n(days[1]), 4);
  assert.strictEqual(n(days[0]), 3);
});

test('fill lays the picks inside their slot with gaps', ()=>{
  const sk = Rules.skeleton({city: 'Dubai', start: '2026-12-23', end: '2026-12-25', hotel: {name: 'Hotel'}, arrival: ctx.arrival, departure: ctx.departure}, {});
  const day = sk.days[1], slot = day.items.find(x=>x.kind === 'free');
  const {day: out, unplaced} = Rules.fill(day, [
    {slot: slot.id, item: {id: 'a', title: 'Dubai Museum', place: 'Dubai Museum', kind: 'sight', start: '', end: '', notes: ''}},
    {slot: slot.id, item: {id: 'b', title: 'Abra ride', place: 'Creek', kind: 'activity', start: '', end: '', notes: ''}},
  ], {}, ctx);
  assert.deepStrictEqual(unplaced, []);
  assert.ok(!out.items.some(x=>x.id === slot.id));
  const left = Rules.check({days: [out]}, {}, ctx).filter(x=>x.level !== 'info');
  assert.deepStrictEqual(left.map(x=>x.text), []);
});
