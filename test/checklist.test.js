const test = require('node:test');
const assert = require('node:assert');
const Rules = require('../rules.js');

const trip = {id: 't1', start: '2026-12-23', end: '2026-12-28', country: 'United Arab Emirates', international: true, hasFlights: true};
const docs = [
  {id: 'p1', type: 'passport', person: 'Anil Gupta', tripId: '', fields: {validUntil: '2031-05-01'}},
  {id: 'p2', type: 'passport', person: 'Priya Gupta', tripId: '', fields: {validUntil: '2027-03-01'}},       // not 6 months after return
  {id: 'v1', type: 'visa', person: 'Anil Gupta', tripId: 't1', fields: {validUntil: '2027-02-01'}},
  {id: 'b1', type: 'boarding-pass', person: 'Anil Gupta', tripId: 't1', fields: {}},
  {id: 'f1', type: 'flight', person: 'Anil Gupta', tripId: 't1', fields: {passengers: ['PRIYA GUPTA', 'Anil Gupta']}},
];

test('checklist: per traveller, auto-ticked by documents, expiry, manual ticks, custom items', ()=>{
  const items = Rules.checklist(trip, ['Anil Gupta', 'Priya Gupta'], docs, Rules.DOC_RULES, {'forex|trip': {done: true}}, [{id: 'x', text: 'Printed hotel address', per: 'trip'}]);
  const st = k => (items.find(i=>i.key === k) || {}).status;
  assert.equal(st('passport|anil gupta'), 'done');
  assert.equal(st('passport|gupta priya'), 'expiring');
  assert.match(items.find(i=>i.key === 'passport|gupta priya').why, /2027-06-28/);
  assert.equal(st('visa|anil gupta'), 'done');
  assert.equal(st('visa|gupta priya'), 'missing');
  assert.equal(st('tickets|gupta priya'), 'done');               // named on the family ticket
  assert.equal(st('hotel|trip'), 'missing');
  assert.equal(st('forex|trip'), 'ticked');
  assert.equal(st('c-x|trip'), 'missing');
  assert.ok(!items.some(i=>i.rule.id === 'photo-id'));           // a domestic rule, not for Dubai
});

test('rules: when, countries and "not for"', ()=>{
  const r = Object.assign({}, Rules.DOC_RULES[1], {except: 'Thailand, Nepal'});
  assert.equal(Rules.applies(r, Object.assign({}, trip, {country: 'Thailand'})), false);
  assert.equal(Rules.applies(r, trip), true);
  assert.equal(Rules.applies({when: 'countries', countries: 'united arab emirates'}, trip), true);
  assert.equal(Rules.applies({when: 'domestic'}, trip), false);
  assert.ok(Rules.asPrompt({custom: ['No sightseeing on the first evening']}).includes('13. No sightseeing on the first evening'));
});
