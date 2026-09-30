const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const Parse = require('../parse.js');
const ap = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/airports.json')));
Parse.setReference({airports: ap.airports, countries: ap.countries, airlines: JSON.parse(fs.readFileSync(path.join(__dirname, '../data/airlines.json')))});

test('boarding pass barcode', ()=>{
  const bc = 'M1' + 'GUPTA/ANIL MR'.padEnd(20) + 'E' + 'ABC123 DELBOM6E 0203 287Y012A0045 100';
  const r = Parse.parseBCBP(bc, new Date('2026-10-01'));
  assert.equal(r.passenger, 'ANIL GUPTA');
  assert.deepEqual([r.legs[0].pnr, r.legs[0].from, r.legs[0].to, r.legs[0].flight, r.legs[0].seat, r.legs[0].date], ['ABC123', 'DEL', 'BOM', '6E203', '12A', '2026-10-14']);
  const read = Parse.read('BOARDING PASS\nGate 42B  Boarding 06:15', bc, {ref: new Date('2026-10-01')});
  assert.equal(read.type, 'boarding-pass');
  assert.equal(read.fields.segments[0].gate, '42B');
  assert.equal(read.fields.segments[0].boarding, '06:15');
});

test('two-leg barcode', ()=>{
  const bc = 'M2' + 'DOE/JANE'.padEnd(20) + 'E' + 'XYZ987 BOMDXBEK 0501 300Y034C0012 100' + 'XYZ987 DXBLHREK 0003 301Y061A0020 100';
  const r = Parse.parseBCBP(bc, new Date('2026-10-20'));
  assert.equal(r.legs.length, 2);
  assert.equal(r.legs[1].flight, 'EK3');
  assert.equal(r.legs[1].to, 'LHR');
});

test('e-ticket text', ()=>{
  const t = `IndiGo e-Ticket / Itinerary
PNR: K7XQ2M   Booking Date: 20 Sep 2026
Passenger: MR ANIL GUPTA
Flight 6E 2134   DEL - BOM   Depart 12 Oct 2026 07:45  Arrive 09:55  Terminal 1
Flight 6E 5321   BOM - DEL   Depart 16 Oct 2026 19:10  Arrive 21:20`;
  const r = Parse.read(t, null, {ref: new Date('2026-09-29')});
  assert.equal(r.type, 'flight');
  assert.equal(r.fields.pnr, 'K7XQ2M');
  assert.equal(r.fields.segments.length, 2);
  assert.deepEqual(r.fields.segments[0], {flight:'6E2134', airline: r.fields.segments[0].airline, from:'DEL', to:'BOM', date:'2026-10-12', dep:'07:45', arr:'09:55'});
  assert.equal(r.fields.segments[1].date, '2026-10-16');
  assert.ok(r.fields.passengers.includes('ANIL GUPTA'));
  assert.equal(Parse.span({type:'flight', fields:r.fields}).city, 'Mumbai');
});

test('hotel voucher', ()=>{
  const t = `Booking confirmation
Booking ID: HB99812345
Taj Lands End
Band Stand, Bandra West, Mumbai 400050
Check-in: Mon, 12 Oct 2026 (from 14:00)
Check-out: Fri, 16 Oct 2026 (until 12:00)
2 Guests, 1 Room, 4 nights`;
  const r = Parse.read(t, null, {ref: new Date('2026-09-29')});
  assert.equal(r.type, 'hotel');
  assert.equal(r.fields.hotelName, 'Taj Lands End');
  assert.equal(r.fields.checkIn, '2026-10-12');
  assert.equal(r.fields.checkOut, '2026-10-16');
  assert.equal(r.fields.checkInTime, '14:00');
  assert.equal(r.fields.checkOutTime, '12:00');
  assert.equal(r.fields.confirmation, 'HB99812345');
  assert.match(r.fields.address, /Bandra/);
});

test('dates and times', ()=>{
  assert.deepEqual(Parse.findDates('12/10/2026 and Oct 3, 2026 and 2026-11-01').map(d=>d.date), ['2026-10-12', '2026-10-03', '2026-11-01']);
  assert.equal(Parse.time24('7:05 pm'), '19:05');
  assert.equal(Parse.time24('12:30 AM'), '00:30');
});

test('second flight on a ticket keeps its own route and times; hotel city from address', ()=>{
  const t = `PNR: K7XQ2M
Passenger: MR ANIL GUPTA
Flight 6E 2134   DEL - GOI   Depart 12 Oct 2026 07:45   Arrive 10:20
Flight 6E 5321   GOI - DEL   Depart 16 Oct 2026 19:10   Arrive 21:50`;
  const r = Parse.read(t, null, {ref: new Date('2026-09-29')});
  assert.deepEqual(r.fields.segments.map(s=>[s.flight, s.from, s.to, s.date, s.dep, s.arr]),
    [['6E2134', 'DEL', 'GOI', '2026-10-12', '07:45', '10:20'], ['6E5321', 'GOI', 'DEL', '2026-10-16', '19:10', '21:50']]);
  assert.deepEqual(r.fields.passengers, ['ANIL GUPTA']);
  assert.equal(Parse.span({type: 'flight', fields: r.fields}).city, 'Goa');
  const h = Parse.read('Booking ID: HB99812345\nTaj Holiday Village Resort & Spa\nSinquerim, Candolim, Goa 403515\nCheck-in: 12 Oct 2026\nCheck-out: 16 Oct 2026', null, {ref: new Date('2026-09-29')});
  assert.equal(h.fields.city, 'Goa');
});
