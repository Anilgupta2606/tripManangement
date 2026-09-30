const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), vm = require('vm');
// mergeData lives in core.js (browser code): run just that function
const src = fs.readFileSync(__dirname + '/../core.js', 'utf8');
const fn = src.slice(src.indexOf('function mergeData'), src.indexOf('/* ---------------------------------------------------------------- sync'));
const ctx = {}; vm.runInNewContext(fn + '\nthis.mergeData = mergeData;', ctx);

test('merge keeps newest edits, deletions, and keys from both devices', ()=>{
  const laptop = {trips: [{id: 't1', name: 'Goa', updatedAt: 5}], docs: [{id: 'd1', updatedAt: 1}, {id: 'd2', updatedAt: 1}], people: [], memories: [], flightsExtra: [], plans: {}, deleted: {},
    settings: {flightKeys: {aerodatabox: 'A'}, sharedAi: {keys: {gemini: 'G', groq: 'Q'}}}};
  const phone = {trips: [{id: 't1', name: 'Goa trip', updatedAt: 9}], docs: [{id: 'd1', updatedAt: 1}, {id: 'd3', updatedAt: 3}], people: [], memories: [], flightsExtra: [], plans: {}, deleted: {d2: 4},
    settings: {flightKeys: {aerodatabox: ''}}};
  const m = ctx.mergeData(phone, laptop);
  assert.equal(m.trips[0].name, 'Goa trip');
  assert.deepEqual(m.docs.map(d=>d.id).sort(), ['d1', 'd3']);
  assert.equal(m.settings.flightKeys.aerodatabox, 'A');            // the phone's empty key does not wipe the laptop's
  assert.equal(m.settings.sharedAi.keys.gemini, 'G');               // the phone with no keys keeps the laptop's
});

test('a deleted plan stays deleted; one made again later survives', ()=>{
  const base = {trips: [], docs: [], people: [], memories: [], flightsExtra: [], settings: {}};
  const old = ctx.mergeData(Object.assign({}, base, {plans: {}, deleted: {'t1|dubai': 100}}), Object.assign({}, base, {plans: {'t1|dubai': {updatedAt: 50}}, deleted: {}}));
  assert.equal(old.plans['t1|dubai'], undefined);
  const again = ctx.mergeData(Object.assign({}, base, {plans: {'t1|dubai': {updatedAt: 200}}, deleted: {'t1|dubai': 100}}), Object.assign({}, base, {plans: {}, deleted: {'t1|dubai': 100}}));
  assert.ok(again.plans['t1|dubai']);
});
