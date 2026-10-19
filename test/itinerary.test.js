/* "Not happy with it? Say what to change": the requests that kept breaking. A place asked for ON A DAY goes on that
   day (it was only "included", so "Dubai Mall on day 1" changed nothing), places named without "include"/"add"
   ("I am thinking to cover …", "Dubai Mall on day 1") are understood, a misspelt name still matches, and what the
   planner cannot do is handed to the AI instead of ending as "Nothing in the plan changed". */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path'), fs = require('fs');
const store = {};
global.localStorage = {getItem: k=>k in store ? store[k] : null, setItem: (k, v)=>{ store[k] = String(v); }, removeItem: k=>{ delete store[k]; }};
const brainPath = path.join(__dirname, '../../Anilgupta2606.github.io/ai/brain.js');
const have = fs.existsSync(brainPath);
global.MoneyBrain = have ? require(brainPath) : null;
global.Rules = require('../rules.js');
const TripBrain = require('../think.js');
const skip = !have && 'brain.js not found next to this repo';

const L = (kind, name, lat, lng, hours, area) => ({kind, name, lat, lng, hours: hours || '', area: area || 'Bur Dubai', note: '', price: ''});
const know = {
  hotelLoc: {lat: 25.2509, lng: 55.2925}, loc: {lat: 25.2509, lng: 55.2925}, used: ['travel guide'],
  guide: {title: 'Dubai', url: 'x', listings: [
    L('see', 'Dubai Museum', 25.2632, 55.2972, 'Sa-Th 8:30AM-8:30PM, Fr 2:30PM-8:30PM'),
    L('see', 'Al Fahidi Historical Neighbourhood', 25.2637, 55.2995, ''),
    L('see', 'Burj Khalifa', 25.1972, 55.2744, '8:30AM-11PM', 'Downtown'),
    L('see', 'The Dubai Fountain', 25.1955, 55.2754, '6PM-11PM', 'Downtown'),
    L('see', 'Dubai Frame', 25.2350, 55.3004, '9AM-9PM', 'Zabeel'),
    L('see', 'Gold Souk', 25.2708, 55.2966, '10AM-10PM', 'Deira'),
    L('see', 'Spice Souk', 25.2690, 55.2980, '9AM-10PM', 'Deira'),
    L('see', 'Jumeirah Mosque', 25.2338, 55.2655, 'Sa-Th 10AM-11AM', 'Jumeirah'),
    L('buy', 'The Dubai Mall', 25.1985, 55.2796, '10AM-midnight', 'Downtown'),
    L('see', 'Zabeel Park', 25.2380, 55.2990, '8AM-10PM', 'Zabeel'),
    L('see', 'Atlantis', 25.1304, 55.1171, '10AM-10PM', 'Palm Jumeirah'),
    L('see', 'Palm Islands', 25.1124, 55.1390, '', 'Palm Jumeirah'),
    L('eat', 'Saravana Bhavan', 25.2600, 55.2950, '7AM-11PM'),
    L('eat', 'Puranmal', 25.1990, 55.2790, '9AM-11PM', 'Downtown'),
  ]},
  nearby: [],
};
// the trip in the report: Dubai 23-28 Dec, arriving in the morning of day 1
const ctx = {city: 'Dubai', country: 'United Arab Emirates', start: '2026-12-23', end: '2026-12-28', hotel: {name: 'Grand Excelsior Hotel Bur Dubai', address: 'Bur Dubai'},
  arrival: {date: '2026-12-23', arr: '08:25', flight: '6E1461', to: 'DXB'}, departure: {date: '2026-12-28', dep: '19:40', flight: '6E1462', from: 'DXB', international: true}, rules: {}};
const dayOf = (days, name) => { const d = days.find(x=>x.items.some(i=>i.title === name)); return d ? d.date : null; };
const count = (days, name) => days.reduce((n, d)=>n + d.items.filter(i=>i.title === name).length, 0);
// a request, as the app makes it: understood, then planned over the plan you have
const ask = (text, prevDays, c) => {
  c = c || ctx;
  const r = TripBrain.apply(text, c, prevDays);
  const next = TripBrain.plan(Object.assign({}, c, {rules: r.rules}), know, {}, {days: prevDays});
  return {r, next, c2: Object.assign({}, c, {rules: r.rules})};
};

test('the requests are read: places, with the day they are wanted on', ()=>{
  const q = TripBrain.placeRequests;
  assert.deepEqual(q('Dubai Mall on day 1'), [{name: 'Dubai Mall', day: {day: 1}}]);
  assert.deepEqual(q('I am thinking to cover bruj khalifa and dubai mall and fountain show on day 1'),
    [{name: 'bruj khalifa', day: {day: 1}}, {name: 'dubai mall', day: {day: 1}}, {name: 'fountain show', day: {day: 1}}]);
  assert.deepEqual(q('Please include Dubai mall also'), [{name: 'Dubai mall', day: null}]);
  assert.deepEqual(q('move the Gold Souk to day 3'), [{name: 'Gold Souk', day: {day: 3}}]);
  assert.deepEqual(q('Burj Khalifa on the 25th'), [{name: 'Burj Khalifa', day: {date: 25}}]);
  assert.deepEqual(q('want to see Atlantis on the last day'), [{name: 'Atlantis', day: {day: -1}}]);
  assert.deepEqual(q('visit Dubai Frame on 24 Dec, and Gold Souk on day 4'), [{name: 'Dubai Frame', day: {date: 24}}, {name: 'Gold Souk', day: {day: 4}}]);
  // not places
  assert.deepEqual(q('day 2 is too packed'), []);
  assert.deepEqual(q('we are vegetarian'), []);
  assert.deepEqual(q('keep the evening free on day 3'), []);
  assert.deepEqual(q('add a beach day'), []);
  assert.deepEqual(q('I have a meeting on the 24th at 3 pm'), []);
});

test('"Dubai Mall on day 1" puts the mall on day 1 (it stayed on day 5 and nothing changed)', {skip}, ()=>{
  const before = TripBrain.plan(ctx, know, {}, null).days;
  const {r, next} = ask('Dubai Mall on day 1', before);
  assert.ok(r.understood);
  assert.match(r.said.join(' · '), /Dubai Mall on 23/);
  assert.equal(dayOf(next.days, 'The Dubai Mall'), '2026-12-23', next.days.map(d=>d.date + ': ' + d.items.map(i=>i.title).join(', ')).join('\n'));
  assert.equal(count(next.days, 'The Dubai Mall'), 1, 'never twice');
  assert.deepEqual(next.asked.unplaced, []);
  assert.ok(Rules.diffPlans(before, next.days).length > 0, 'the plan changed');
});

test('"cover bruj khalifa and dubai mall and fountain show on day 1": all three on day 1, despite the typo', {skip}, ()=>{
  const before = TripBrain.plan(ctx, know, {}, null).days;
  const {next} = ask('I am thinking to cover bruj khalifa and dubai mall and fountain show on day 1', before);
  const d1 = next.days[0].items.map(i=>i.title);
  ['Burj Khalifa', 'The Dubai Mall', 'The Dubai Fountain'].forEach(n=>assert.ok(d1.indexOf(n) >= 0, n + ' not on day 1: ' + d1.join(', ')));
  ['Burj Khalifa', 'The Dubai Mall', 'The Dubai Fountain'].forEach(n=>assert.equal(count(next.days, n), 1, n + ' twice'));
  // the fountain shows are in the evening: planned when it is on
  const f = next.days[0].items.find(i=>i.title === 'The Dubai Fountain');
  assert.ok(Rules.toMin(f.start) >= 18 * 60, 'fountain before the shows: ' + f.start);
  assert.deepEqual(next.asked.notFound, []);
  const errs = Rules.check({days: next.days}, ctx.rules, ctx).filter(p=>p.level === 'error');
  assert.deepEqual(errs.map(e=>e.text), []);
});

test('a place wanted on a later day is not used up by an earlier one', {skip}, ()=>{
  const before = TripBrain.plan(ctx, know, {}, null).days;
  const {next} = ask('Burj Khalifa on day 4', before);
  assert.equal(dayOf(next.days, 'Burj Khalifa'), '2026-12-26');
  assert.equal(count(next.days, 'Burj Khalifa'), 1);
});

test('the day stays wanted: a later request keeps the earlier one where it was asked for', {skip}, ()=>{
  const before = TripBrain.plan(ctx, know, {}, null).days;
  const one = ask('Dubai Mall on day 1', before);
  const two = ask('we are vegetarian', one.next.days, one.c2);
  assert.equal(dayOf(two.next.days, 'The Dubai Mall'), '2026-12-23');
});

test('what the planner cannot do is reported, so the AI is asked (not "nothing changed")', {skip}, ()=>{
  const before = TripBrain.plan(ctx, know, {}, null).days;
  // Jumeirah Mosque is open 10-11 Sat-Thu; 25 Dec 2026 is a Friday: it cannot go on day 3
  const {next} = ask('Jumeirah Mosque on day 3', before);
  assert.notEqual(dayOf(next.days, 'Jumeirah Mosque'), '2026-12-25');
  assert.ok(next.asked.unplaced.some(x=>/Jumeirah Mosque/.test(x)), JSON.stringify(next.asked));
  assert.deepEqual(TripBrain.forAI(next.asked, 5), ['Jumeirah Mosque on 25 Dec']);
  // a request it understood that changed nothing goes to the AI too
  assert.deepEqual(TripBrain.forAI({placed: [], unplaced: [], notFound: []}, 0), ['the change you asked for']);
  assert.deepEqual(TripBrain.forAI({placed: ['The Dubai Mall'], unplaced: [], notFound: []}, 3), []);
  assert.deepEqual(TripBrain.forAI({placed: [], unplaced: [], notFound: ['Ski Dubai']}, 2), ['Ski Dubai']);
});

/* The AI's answer, as it reached the plan. "I am thinking to cover bruj khalifa and dubai mall and fountain show on
   day 1" went on to the AI, whose answer had no readable days: the locked landing flight made one day, the rest came
   from the empty skeleton, and the whole plan was wiped (only "Land in Dubai" and open blocks were left). */
test('an AI answer with no readable days never replaces the plan', {skip}, ()=>{
  const before = TripBrain.plan(ctx, know, {}, null).days;
  const prev = {days: before.map(d=>Object.assign({}, d, {items: d.items.map(i=>/Land in|6E14/.test(i.title) ? Object.assign({}, i, {locked: true}) : i)}))};
  const sk = Rules.skeleton(ctx, ctx.rules).days;
  assert.equal(Rules.fromAI({summary: 'Moved them to day 1'}, prev, sk).days, null);
  assert.equal(Rules.fromAI({days: [{date: '23 Dec', items: []}]}, prev, sk).days, null);
  assert.equal(Rules.fromAI(null, prev, sk).days, null);
});

test('a day the AI leaves out keeps the day you had; other answer shapes are read', {skip}, ()=>{
  const before = TripBrain.plan(ctx, know, {}, null).days;
  const prev = {days: before};
  const sk = Rules.skeleton(ctx, ctx.rules).days;
  const day1 = {date: '2026-12-23', items: [{start: '13:00', end: '15:00', title: 'Burj Khalifa', kind: 'sight'}, {start: '15:30', end: '17:30', title: 'The Dubai Mall', kind: 'shopping'}, {start: '19:00', end: '19:30', title: 'The Dubai Fountain', kind: 'sight'}]};
  for(const answer of [{days: [day1]}, {plan: {days: [day1]}}, {itinerary: [day1]}, [day1], {days: [Object.assign({}, day1, {date: '2026-12-23T00:00:00'})]}, {days: [Object.assign({}, day1, {date: undefined, day: 1})]}]){
    const g = Rules.fromAI(answer, prev, sk);
    assert.equal(g.given, 1, JSON.stringify(answer).slice(0, 60));
    assert.deepEqual(g.days[0].items.map(i=>i.title).filter(t=>!/6E14/.test(t)), ['Burj Khalifa', 'The Dubai Mall', 'The Dubai Fountain']);   // and the locked landing flight
    // days 2-6: the plan you had, not "Morning — open"
    g.days.slice(1).forEach((d, i)=>assert.deepEqual(d.items.map(x=>x.title), before[i + 1].items.map(x=>x.title)));
  }
});

test('a change that removes most places is refused unless you asked for less', ()=>{
  const day = (date, n) => ({date, items: Array.from({length: n}, (_, i)=>({title: 'P' + i, kind: 'sight'}))});
  const full = [day('2026-12-23', 2), day('2026-12-24', 3), day('2026-12-25', 3)], empty = [day('2026-12-23', 0), day('2026-12-24', 0), day('2026-12-25', 0)];
  assert.equal(Rules.wipes(full, empty, 'I am thinking to cover bruj khalifa and dubai mall and fountain show on day 1'), true);
  assert.equal(Rules.wipes(full, empty, 'clear everything, we want free days'), false);
  assert.equal(Rules.wipes(full, [day('2026-12-23', 3), day('2026-12-24', 2), day('2026-12-25', 2)], 'Dubai Mall on day 1'), false);
});
