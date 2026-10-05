/* Trip Vault's own planner on Money Brain: a Dubai stay planned without AI, held to every rule. */
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

const L = (kind, name, lat, lng, hours, area, note) => ({kind, name, lat, lng, hours: hours || '', area: area || 'Bur Dubai', note: note || '', price: ''});
const know = {
  hotelLoc: {lat: 25.2509, lng: 55.2925}, loc: {lat: 25.2509, lng: 55.2925}, used: ['travel guide (14 places)'],
  guide: {title: 'Dubai', url: 'x', listings: [
    L('see', 'Dubai Museum', 25.2632, 55.2972, 'Sa-Th 8:30AM-8:30PM, Fr 2:30PM-8:30PM', 'Bur Dubai', 'In Al Fahidi Fort, the oldest building in Dubai.'),
    L('see', 'Al Fahidi Historical Neighbourhood', 25.2637, 55.2995, '', 'Bur Dubai'),
    L('see', 'Grand Mosque', 25.2640, 55.2940, 'Sa-Th 9AM-12PM', 'Bur Dubai'),
    L('see', 'Burj Khalifa', 25.1972, 55.2744, '8:30AM-11PM', 'Downtown'),
    L('see', 'Dubai Frame', 25.2350, 55.3004, '9AM-9PM', 'Zabeel'),
    L('see', 'Gold Souk', 25.2708, 55.2966, '10AM-10PM', 'Deira'),
    L('see', 'Spice Souk', 25.2690, 55.2980, '9AM-10PM', 'Deira'),
    L('do', 'Abra ride across the creek', 25.2630, 55.2970, '', 'Bur Dubai'),
    L('see', 'Jumeirah Mosque', 25.2338, 55.2655, 'Sa-Th 10AM-11AM', 'Jumeirah'),
    L('buy', 'The Dubai Mall', 25.1985, 55.2796, '10AM-midnight', 'Downtown'),
    L('see', 'Zabeel Park', 25.2380, 55.2990, '8AM-10PM', 'Zabeel'),
    L('eat', 'Saravana Bhavan', 25.2600, 55.2950, '7AM-11PM', 'Bur Dubai', 'South Indian vegetarian thalis and dosas.'),
    L('eat', 'Arabian Tea House', 25.2640, 55.2990, '7:30AM-10PM', 'Bur Dubai', 'Emirati breakfast in a courtyard.'),
    L('eat', 'Al Ustad Special Kabab', 25.2560, 55.2960, '12PM-4PM, 6PM-1AM', 'Bur Dubai', 'Iranian kebabs.'),
    L('eat', 'Puranmal', 25.1990, 55.2790, '9AM-11PM', 'Downtown', 'Pure veg North Indian.'),
  ]},
  nearby: [{name: 'Al Mankhool', km: 0.5, lat: 25.252, lng: 55.293}, {name: 'Dubai Museum', km: 1.4, lat: 25.2632, lng: 55.2972}],
};
const ctx = {city: 'Dubai', country: 'United Arab Emirates', start: '2026-12-23', end: '2026-12-27', hotel: {name: 'Grand Excelsior Hotel Bur Dubai', address: 'Bur Dubai'},
  arrival: {date: '2026-12-23', arr: '10:25', flight: '6E1461', to: 'DXB'}, departure: {date: '2026-12-27', dep: '19:40', flight: '6E1462', from: 'DXB', international: true}, rules: {}};
const weather = {'2026-12-26': {rain: 80, tmax: 24}};
const sights = d => d.items.filter(i=>['sight', 'activity', 'shopping'].indexOf(i.kind) >= 0);

test('a Dubai stay planned without AI follows every rule', {skip: !have && 'brain.js not found next to this repo'}, ()=>{
  const r = TripBrain.plan(ctx, know, weather, null);
  assert.equal(r.days.length, 5);
  const errs = Rules.check({days: r.days}, ctx.rules, Object.assign({}, ctx, {weather})).filter(p=>p.level !== 'info');
  assert.deepEqual(errs.map(e=>e.text), []);
  // full days have places, none repeated
  [1, 2, 3].forEach(i=>assert.ok(sights(r.days[i]).length >= 2, r.days[i].date + ': ' + sights(r.days[i]).map(x=>x.title)));
  const names = r.days.flatMap(d=>sights(d).map(x=>x.title));
  assert.equal(new Set(names).size, names.length, 'no place twice');
  // every choice says why, with travel time
  sights(r.days[1]).forEach(x=>assert.match(x.notes, /min (walk|by)/));
  // meals are real places
  assert.ok(r.days[1].items.some(i=>i.kind === 'meal' && / — /.test(i.title)));
  // Friday 25 Dec: the Dubai Museum only after 14:30; the Grand Mosque not at all (closed Fridays)
  const fri = r.days.find(d=>d.date === '2026-12-25');
  const dm = fri.items.find(i=>i.title === 'Dubai Museum');
  if(dm) assert.ok(Rules.toMin(dm.start) >= 14 * 60 + 30);
  assert.ok(!fri.items.some(i=>i.title === 'Grand Mosque'));
  // rainy 26 Dec: nothing outdoors
  const rain = r.days.find(d=>d.date === '2026-12-26');
  assert.ok(!sights(rain).some(x=>x.outdoor), 'outdoor on a rainy day: ' + sights(rain).filter(x=>x.outdoor).map(x=>x.title));
});

test('it learns: skip mosques and they leave the plan; vegetarian meals', {skip: !have && 'no brain'}, ()=>{
  MoneyBrain._reset();
  const said = TripBrain.apply('no mosques please, we are vegetarian, day 2 is too packed', ctx, TripBrain.plan(ctx, know, weather, null).days);
  assert.ok(said.understood);
  assert.equal(said.rules.pace, 'relaxed');
  const r = TripBrain.plan(Object.assign({}, ctx, {rules: said.rules}), know, weather, null);
  const all = r.days.flatMap(d=>sights(d).map(x=>x.title));
  assert.ok(!all.some(n=>/mosque/i.test(n)), all.join());
  const meals = r.days.flatMap(d=>d.items.filter(i=>i.kind === 'meal' && / — /.test(i.title)));
  assert.ok(meals.length >= 1);
  assert.ok(meals.some(m=>/Saravana|Puranmal/.test(m.title)), meals.map(m=>m.title).join());
  r.days.slice(1, 4).forEach(d=>assert.ok(sights(d).length <= 2, 'relaxed pace'));
});

test('learning from edits: removing souks twice, then the plan skips them', {skip: !have && 'no brain'}, ()=>{
  MoneyBrain._reset();
  TripBrain.learnFromEdit('remove', {title: 'Gold Souk', kind: 'shopping'});
  TripBrain.learnFromEdit('remove', {title: 'Spice Souk', kind: 'shopping'});
  TripBrain.learnFromEdit('remove', {title: 'Textile Souk', kind: 'shopping'});
  TripBrain.learnFromEdit('remove', {title: 'Meena Bazaar', kind: 'shopping'});
  const p = TripBrain.preferences({});
  assert.ok(p.cat.market < 0, JSON.stringify(p.cat));
  const r = TripBrain.plan(ctx, know, {}, null);
  const all = r.days.flatMap(d=>sights(d).map(x=>x.title));
  assert.ok(!all.some(n=>/souk/i.test(n)), all.join());
  // a meeting on the 24th at 3 pm is kept, locked
  const plan = TripBrain.plan(ctx, know, {}, null);
  const said = TripBrain.apply('I have a meeting on the 24th at 3 pm', ctx, plan.days);
  assert.equal(said.fixed[0].date, '2026-12-24');
  assert.equal(said.fixed[0].item.start, '15:00');
});

test('an unread request: the AI translates it, bad parts are dropped, and the words are remembered', {skip: !have && 'no brain'}, async ()=>{
  MoneyBrain._reset();
  const text = 'we fancy a bit of culture and nothing too sweaty';
  assert.deepEqual(MoneyBrain.understand(text, {app: 'trip'}), []);
  let asked = 0;
  const chat = async ()=>{ asked++; return {provider: 'Fake AI', text: JSON.stringify({actions: [
    {do: 'like', category: 'museum'}, {do: 'pace', value: 'relaxed', day: null},
    {do: 'like', category: 'casino'},                 // not a kind it knows: dropped
    {do: 'delete everything'},                        // not an action: dropped
    {do: 'fixed', title: 'x', min: 5000, day: {day: 1}},   // impossible time: dropped
  ]})}; };
  const tr = await TripBrain.translate(text, chat, JSON.parse);
  assert.equal(asked, 1);
  assert.deepEqual(tr.acts.map(a=>a.do + ':' + (a.category || a.value)), ['like:museum', 'pace:relaxed']);
  // next time: read from memory, no AI
  assert.deepEqual(MoneyBrain.understand(text, {app: 'trip'}).map(a=>a.do + ':' + (a.category || a.value)), ['like:museum', 'pace:relaxed']);
  assert.deepEqual(MoneyBrain.understand('We fancy a bit of culture, and nothing too sweaty!', {app: 'trip'}).map(a=>a.do), ['like', 'pace'], 'the same words, other punctuation');
});

test('vegetarian: never a meat place, and the vegetarian ones come back before anything else', {skip: !have && 'brain.js not found next to this repo'}, ()=>{
  const veg = Object.assign({}, ctx, {rules: {food: 'vegetarian'}});
  const r = TripBrain.plan(veg, know, weather, null);
  const meals = r.days.flatMap(d=>d.items.filter(i=>i.kind === 'meal' && / — /.test(i.title)).map(i=>i.title.split(' — ')[1]));
  assert.ok(meals.length >= 4, meals.join(', '));
  assert.ok(!meals.some(m=>/Kabab/.test(m)), 'a kebab house for a vegetarian: ' + meals.join(', '));
  const vegPlaces = meals.filter(m=>/Saravana|Puranmal/.test(m)).length;
  assert.ok(vegPlaces >= meals.length / 2, 'mostly vegetarian places: ' + meals.join(', '));
  const last = r.days[r.days.length - 1].items.find(i=>i.kind === 'flight');
  assert.ok(!/undefined/.test(last.title), last.title);
});
