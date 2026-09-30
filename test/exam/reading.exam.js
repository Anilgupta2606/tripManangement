/* THE READING EXAM — does the checker catch and correct what readers (built-in or AI) get wrong, and stay quiet
   when a reading is right? Each case: a document's text, what a reader returned, and what the checker must do.
   Run: node test/exam/reading.exam.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const store = {};
global.localStorage = {getItem: k=>k in store ? store[k] : null, setItem: (k, v)=>{ store[k] = String(v); }};
const Brain = require(path.join(__dirname, '../../../Anilgupta2606.github.io/ai/brain.js'));
const Parse = require('../../parse.js');
// the airport list, as the app loads it
const AP = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/airports.json'), 'utf8'));
Parse.setReference({airports: AP.airports, countries: AP.countries, airlines: JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/airlines.json'), 'utf8'))});
// the usual routes (instead of the internet): 6E2134 flies DEL -> BOM
const fetch = async url => ({ok: true, json: async ()=>/6E2134/.test(url) ? {response: {flightroute: {airline: {name: 'IndiGo'}, origin: {iata_code: 'DEL'}, destination: {iata_code: 'BOM'}}}} : {response: 'unknown callsign'}});
const ctx = {window: {}, document: {}, navigator: {}, console, setTimeout, clearTimeout, Promise, fetch, Parse, MoneyBrain: Brain, Cloud: {aiAvailable: ()=>false}, Date, JSON, Math};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../services.js'), 'utf8') + '\nthis.Reader = Reader; this.Flights = Flights;', ctx);
const {Reader} = ctx;

// valid Aadhaar numbers for the cases (the last digit is the Verhoeff check digit)
const aadhaar = base => { for(let d = 0; d < 10; d++) if(Brain.verhoeff(base + d)) return base + d; };
const A1 = aadhaar('49911866524'), A2 = aadhaar('23456789012');
const sp = n => n.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
const wrongDigit = n => n.slice(0, 5) + ((+n[5] + 1) % 10) + n.slice(6);

const T = (type, text, fields, o) => Object.assign({type, text, fields, person: 'Anil Gupta'}, o || {});
const cases = [
  // ---- right readings: the checker must say nothing
  ['a correct Aadhaar', T('aadhaar', 'Government of India\nAnil Gupta\n' + sp(A1), {number: sp(A1)}), {quiet: true, number: A1}],
  ['a correct PAN', T('pan', 'Permanent Account Number\nABCPG1234K\nName: ANIL GUPTA', {number: 'ABCPG1234K'}), {quiet: true}],
  ['a correct driving licence', T('licence', 'DL No: MH12 20150012345\nValid Till: 13-03-2035', {number: 'MH12 20150012345', issuedOn: '2015-03-14', validUntil: '2035-03-13'}), {quiet: true}],
  ['a correct voter ID', T('voter-id', 'EPIC ABC1234567', {number: 'ABC1234567'}), {quiet: true}],
  ['a correct passport', T('passport', 'Passport No. Z1234567', {number: 'Z1234567', issuedOn: '2021-02-10', validUntil: '2031-02-09'}), {quiet: true}],
  ['a correct flight', T('flight', 'IndiGo 6E2134 DEL-BOM', {pnr: 'HB998Q', segments: [{flight: '6E2134', from: 'DEL', to: 'BOM', date: '2026-10-12'}]}), {quiet: true}],
  ['a correct hotel booking', T('hotel', 'Taj Lands End', {checkIn: '2026-10-12', checkOut: '2026-10-15'}), {quiet: true}],
  ['a masked Aadhaar', T('aadhaar', 'Aadhaar XXXX XXXX 5246', {number: 'XXXX XXXX 5246'}), {quiet: true}],
  // ---- misreads it can correct
  ['Aadhaar: a letter O read for a zero', T('aadhaar', sp(A1), {number: A1.replace(/0/, 'O') === A1 ? A1.slice(0, 11) + 'O' : A1.replace(/0/, 'O')}), {number: A1, fixed: true}],
  ['Aadhaar: the AI changed a digit, the right one is in the text', T('aadhaar', 'Aadhaar No: ' + sp(A2), {number: wrongDigit(A2)}), {number: A2, fixed: true}],
  ['Aadhaar: the right one next to a 16-digit VID', T('aadhaar', 'VID : 9134 5678 1234 5678\nAadhaar: ' + sp(A1), {number: wrongDigit(A1)}), {number: A1, fixed: true}],
  ['Aadhaar: missing, found in the text', T('aadhaar', 'Your Aadhaar No. ' + sp(A2), {}), {number: A2, fixed: true}],
  ['PAN: S read for 5', T('pan', 'PAN ABCPG12S4K', {number: 'ABCPG12S4K'}), {number: 'ABCPG1254K', fixed: true}],
  ['Voter ID: 8 read for B', T('voter-id', 'EPIC A8C1234567', {number: 'A8C1234567'}), {number: 'ABC1234567', fixed: true}],
  ['Flight: S read for 5', T('flight', '6E21S4', {segments: [{flight: '6E21S4', from: 'DEL', to: 'BOM', date: '2026-10-12'}]}), {fixed: true, flight: '6E2154'}],
  // ---- mistakes it must flag
  ['Aadhaar: wrong and not in the text', T('aadhaar', 'Aadhaar (unclear scan)', {number: wrongDigit(A1)}), {error: 'number'}],
  ['PAN: 5th letter is not the surname', T('pan', 'PAN ABCPS1234K', {number: 'ABCPS1234K'}), {warn: 'number'}],
  ['Licence: expiry before issue', T('licence', 'DL', {number: 'MH12 20150012345', issuedOn: '2025-03-14', validUntil: '2015-03-13'}), {error: 'validUntil'}],
  ['A date that does not exist', T('passport', 'Passport', {number: 'Z1234567', validUntil: '2031-02-30'}), {error: 'validUntil'}],
  ['Hotel: check-out before check-in', T('hotel', 'Hotel', {checkIn: '2026-10-15', checkOut: '2026-10-12'}), {error: 'checkOut'}],
  ['Flight: not an airport code', T('flight', 'x', {segments: [{flight: '6E2134', from: 'DEL', to: 'XQZ', date: '2026-10-12'}]}), {error: 'segments'}],
  ['Flight: from and to the same airport', T('flight', 'x', {segments: [{flight: 'AI101', from: 'DEL', to: 'DEL', date: '2026-10-12'}]}), {error: 'segments'}],
  ['Flight: the year misread (2062)', T('flight', 'x', {segments: [{flight: 'AI101', from: 'DEL', to: 'BOM', date: '2062-10-12'}]}), {warn: 'segments'}],
  ['Flight: the route does not match the flight number', T('flight', 'x', {segments: [{flight: '6E2134', from: 'DEL', to: 'GOI', date: '2026-10-12'}]}), {warn: 'segments'}],
  ['Expired document', T('passport', 'Passport', {number: 'Z1234567', issuedOn: '2010-02-10', validUntil: '2020-02-09'}), {warn: 'validUntil'}],
];

(async ()=>{
  let ok = 0;
  for(const [name, c, want] of cases){
    const result = {type: c.type, person: c.person, fields: JSON.parse(JSON.stringify(c.fields))};
    const checks = await Reader.checkReading(result, {text: c.text}, {fields: {}});
    const problems = [];
    if(want.quiet && checks.some(x=>x.level !== 'fixed')) problems.push('should be quiet, said: ' + checks.map(x=>x.text).join(' | '));
    if(want.quiet && checks.some(x=>x.level === 'fixed')) problems.push('changed a right reading: ' + checks.map(x=>x.text).join(' | '));
    if(want.number && String(result.fields.number || '').replace(/\s/g, '') !== want.number) problems.push('number is ' + result.fields.number + ', should be ' + want.number);
    if(want.flight && result.fields.segments[0].flight !== want.flight) problems.push('flight is ' + result.fields.segments[0].flight);
    if(want.fixed && !checks.some(x=>x.level === 'fixed')) problems.push('no correction reported');
    if(want.error && !checks.some(x=>x.level === 'error' && x.field === want.error)) problems.push('did not flag ' + want.error + ' as wrong' + (checks.length ? ' (said: ' + checks.map(x=>x.level + ' ' + x.text).join(' | ') + ')' : ''));
    if(want.warn && !checks.some(x=>(x.level === 'warn' || x.level === 'error') && x.field === want.warn)) problems.push('did not warn about ' + want.warn + (checks.length ? ' (said: ' + checks.map(x=>x.text).join(' | ') + ')' : ''));
    if(!problems.length) ok++; else console.log('  ✗ ' + name + ': ' + problems.join('; '));
  }
  console.log(`READING EXAM: ${ok} / ${cases.length} = ${Math.round(ok / cases.length * 100)}%`);
  process.exit(ok === cases.length ? 0 : 1);
})();
