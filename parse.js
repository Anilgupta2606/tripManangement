"use strict";
/* =========================================================
   PARSE — the built-in reader. Pure functions, no network, no DOM:
   · the boarding-pass barcode (IATA BCBP, the PDF417/Aztec/QR code on every pass),
   · text from a ticket, hotel voucher, train ticket or visa -> the fields that matter,
   · a guess at what kind of document it is.
   The AI reader, when switched on, starts from what this finds and fills the gaps.
   Runs in the browser and in node (tests).
   ========================================================= */
const Parse = (function(){

  const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12,
    january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
  const pad = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  function validDate(y, m, d){
    if(!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return false;
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  const fullYear = y => y < 100 ? 2000 + y : y;

  /* Every date in a piece of text, in the order they appear -> [{date:'YYYY-MM-DD', index}]
     Day-first for numeric dates (Indian and most international tickets); ISO wins where written. */
  function findDates(text, refYear){
    const out = [], seen = new Set();
    const add = (y, m, d, index) => { if(validDate(y, m, d)){ const k = index + ':' + iso(y, m, d); if(!seen.has(k)){ seen.add(k); out.push({date: iso(y, m, d), index}); } } };
    const mon = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
    let m;
    const r1 = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;                                     // 2026-10-12
    while((m = r1.exec(text))) add(+m[1], +m[2], +m[3], m.index);
    const r2 = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-\\/.,]*' + mon + '[a-z]*[\\s\\-\\/.,\']*(\\d{4}|\\d{2})?\\b', 'gi');   // 12 Oct 2026, 12-OCT-26, 12OCT
    while((m = r2.exec(text))){
      const y = m[3] ? fullYear(+m[3]) : (refYear || new Date().getFullYear());
      add(y, MONTHS[m[2].toLowerCase()], +m[1], m.index);
    }
    const r3 = new RegExp('\\b' + mon + '[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b', 'gi');      // Oct 12, 2026
    while((m = r3.exec(text))) add(+m[3], MONTHS[m[1].toLowerCase()], +m[2], m.index);
    const r4 = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/g;                     // 12/10/2026 (day first)
    while((m = r4.exec(text))){
      const a = +m[1], b = +m[2], y = fullYear(+m[3]);
      if(a > 12 && b <= 12) add(y, b, a, m.index);
      else if(b > 12 && a <= 12) add(y, a, b, m.index);                                // clearly month-first
      else add(y, b, a, m.index);
    }
    return out.sort((x, y)=>x.index - y.index);
  }

  /* Times -> [{time:'HH:MM', index}] (24h; "7:05 pm" becomes 19:05) */
  function findTimes(text){
    const out = []; let m;
    const r = /\b([01]?\d|2[0-3])[:.h]([0-5]\d)(?:\s*(?:hrs?|h))?\s*([AaPp]\.?[Mm]\.?)?(?![\d.:\/])/g;
    while((m = r.exec(text))){
      let h = +m[1];
      const ap = m[3] ? m[3][0].toLowerCase() : '';
      if(ap === 'p' && h < 12) h += 12;
      if(ap === 'a' && h === 12) h = 0;
      out.push({time: pad(h) + ':' + m[2], index: m.index});
    }
    return out;
  }
  const time24 = s => { const t = findTimes(String(s || '')); return t.length ? t[0].time : ''; };

  /* ---------------------------------------------------------------- boarding-pass barcode (IATA BCBP)
     M1SURNAME/GIVEN       EABC123 DELBOM6E 0123 287Y012A0045 100
     The flight date is a day of the year; the year is the one that puts it nearest to `ref`. */
  function julianToDate(doy, ref){
    ref = ref || new Date();
    let best = null;
    [-1, 0, 1].forEach(dy=>{
      const y = ref.getFullYear() + dy, d = new Date(Date.UTC(y, 0, 1) + (doy - 1) * 86400000);
      if(d.getUTCFullYear() !== y) return;
      const diff = d.getTime() - ref.getTime();
      // a boarding pass is for a flight in the recent past or near future
      const score = diff < -120 * 86400000 ? 1e15 + Math.abs(diff) : Math.abs(diff);
      if(!best || score < best.score) best = {score, d};
    });
    return best ? best.d.toISOString().slice(0, 10) : '';
  }
  function parseBCBP(raw, ref){
    const s = String(raw || '').replace(/\r?\n/g, '');
    if(!/^M[1-9]/.test(s) || s.length < 58) return null;
    const legsN = +s[1];
    const name = s.slice(2, 22).trim();
    const [surname, given] = name.split('/');
    const clean = v => v.trim().replace(/\s+(MR|MRS|MS|MISS|MSTR|DR)$/i, '');
    const passenger = given ? (clean(given) + ' ' + surname).replace(/\s+/g, ' ').trim() : name;
    const legs = [];
    let pos = 23;
    for(let i = 0; i < legsN && pos + 37 <= s.length; i++){
      const seg = s.slice(pos, pos + 37);           // PNR(7) from(3) to(3) carrier(3) flight(5) day(3) cabin(1) seat(4) seq(5) status(1) size(2)
      const carrier = seg.slice(13, 16).trim();
      legs.push({
        pnr: seg.slice(0, 7).trim(), from: seg.slice(7, 10).trim(), to: seg.slice(10, 13).trim(), carrier,
        flight: carrier + seg.slice(16, 21).trim().replace(/^0+/, ''),
        date: /^\d{3}$/.test(seg.slice(21, 24)) ? julianToDate(+seg.slice(21, 24), ref) : '',
        cabin: seg.slice(24, 25).trim(), seat: seg.slice(25, 29).trim().replace(/^0+/, ''), sequence: seg.slice(29, 34).trim().replace(/^0+/, ''),
      });
      const size = parseInt(s.slice(pos + 35, pos + 37), 16);
      pos += 37 + (isNaN(size) ? 0 : size);
    }
    if(!legs.length || !/^[A-Z]{3}$/.test(legs[0].from) || !/^[A-Z]{3}$/.test(legs[0].to)) return null;
    return {passenger, legs};
  }

  /* ---------------------------------------------------------------- reference data (airports, airlines) */
  let AIRPORTS = {}, AIRLINES = {}, COUNTRIES = {};
  function setReference(ref){
    if(ref.airports) AIRPORTS = ref.airports;
    if(ref.airlines) AIRLINES = ref.airlines;
    if(ref.countries) COUNTRIES = ref.countries;
  }
  const CITY_NAME = {GOI: 'Goa', GOX: 'Goa', DXB: 'Dubai', DWC: 'Dubai', NRT: 'Tokyo', HND: 'Tokyo', CDG: 'Paris', ORY: 'Paris', LHR: 'London', LGW: 'London', STN: 'London', JFK: 'New York', EWR: 'New York', LGA: 'New York',
    BOM: 'Mumbai', DEL: 'Delhi', BLR: 'Bengaluru', MAA: 'Chennai', CCU: 'Kolkata', HYD: 'Hyderabad', COK: 'Kochi', TRV: 'Thiruvananthapuram', IXB: 'Siliguri', ICN: 'Seoul', KIX: 'Osaka', BKK: 'Bangkok', DMK: 'Bangkok', HKT: 'Phuket', DPS: 'Bali', SIN: 'Singapore', KUL: 'Kuala Lumpur', MLE: 'Maldives', IST: 'Istanbul', SAW: 'Istanbul'};
  const airport = code => { const a = AIRPORTS[String(code || '').toUpperCase()]; return a ? {code: String(code).toUpperCase(), name: a[0], city: CITY_NAME[String(code).toUpperCase()] || a[1], country: a[2], countryName: COUNTRIES[a[2]] || a[2], lat: a[3], lng: a[4]} : null; };
  const airline = code => AIRLINES[String(code || '').toUpperCase()] || '';

  // three capital letters that are also words on tickets, not airports
  const NOT_AIRPORT = new Set('THE AND FOR PNR YOU ARE NOT ALL ANY WEB APP GST TAX FEE INR USD EUR AED GBP SGD MRS MSS DOB AGE ETA ETD STD STA REF VIA NON PAX ADT CHD INF BAG KGS PCS PER AIR SEA BUS CAR NET AMT TTL TOT ONE TWO MAX MIN NOS QTY VAT IGT SMS OTP TIN PAN UPI EMI ATM IST UTC GMT PDT PST CET BST AST EST HRS MIN SEC ECO BUS FLT DEP ARR TER GAT GRP CAB NEW OLD OUT OFF USE NOW MAY END ADD BOX FAX HOT INN VIP YES DAY ROW'.split(' '));

  const FLIGHT_RE = /\b([A-Z][A-Z0-9]|[0-9][A-Z])\s?-?\s?(\d{1,4})\b/g;
  function findFlights(text){
    const out = [], seen = new Set(); let m;
    const T = String(text || '');
    FLIGHT_RE.lastIndex = 0;
    while((m = FLIGHT_RE.exec(T))){
      const code = m[1].toUpperCase(), num = m[2].replace(/^0+/, '');
      if(!num || !AIRLINES[code]) continue;
      // "AI 2026" is far more often a year than a flight: need a flight word nearby or no space
      const around = T.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
      const tight = !/\s/.test(m[0]);
      if(!tight && !/flight|flt|airline|depart|dep\b|arriv|carrier|operated|boarding/i.test(around)) continue;
      if(/^(19|20)\d\d$/.test(m[2]) && !tight) continue;
      const k = code + num;
      if(seen.has(k)) continue;
      seen.add(k);
      out.push({flight: k, airline: airline(code), index: m.index});
    }
    return out;
  }
  function findAirports(text){
    const out = []; let m;
    const r = /\b([A-Z]{3})\b/g;
    while((m = r.exec(String(text || '')))){
      if(NOT_AIRPORT.has(m[1]) || !AIRPORTS[m[1]]) continue;
      out.push({code: m[1], index: m.index});
    }
    return out;
  }
  /* A known city name near a spot, for tickets that say "New Delhi → Mumbai" with no codes. */
  let CITY_INDEX = null;
  function cityIndex(){
    if(CITY_INDEX) return CITY_INDEX;
    CITY_INDEX = {};
    Object.entries(AIRPORTS).forEach(([code, a])=>{
      const c = String(a[1] || '').toLowerCase();
      if(c.length >= 4 && !CITY_INDEX[c]) CITY_INDEX[c] = code;
    });
    // common alternative names
    Object.assign(CITY_INDEX, {bengaluru:'BLR', bangalore:'BLR', delhi:'DEL', 'new delhi':'DEL', mumbai:'BOM', bombay:'BOM', kolkata:'CCU', calcutta:'CCU', chennai:'MAA', madras:'MAA', hyderabad:'HYD', goa:'GOI', dubai:'DXB', singapore:'SIN', bangkok:'BKK', london:'LHR', paris:'CDG', 'new york':'JFK'});
    return CITY_INDEX;
  }

  /* ---------------------------------------------------------------- what kind of document */
  const TYPES = [
    {id:'boarding-pass', label:'Boarding pass', words:[/boarding\s*pass/i, 3], more:[/\bgate\b/i, /\bseat\b/i, /boarding\s*time/i, /\bzone\b|\bgroup\b/i, /\bseq(?:uence)?\b/i]},
    {id:'flight', label:'Flight ticket', words:[/e-?ticket|electronic ticket|flight itinerary|ticket number|itinerary receipt/i, 2], more:[/\bflight\b/i, /\bPNR\b|booking reference|record locator/i, /\bbaggage\b/i, /\bdepart/i, /\bterminal\b/i, /\bairlines?\b/i]},
    {id:'hotel', label:'Hotel booking', words:[/\bhotel\b|\bresort\b|\bhostel\b|\bapartment\b|homestay|\bvilla\b|\bairbnb\b/i, 2], more:[/check[\s-]?in/i, /check[\s-]?out/i, /\broom\b/i, /\bguests?\b/i, /\bnights?\b/i, /booking\.com|agoda|makemytrip|goibibo|expedia|hotels\.com/i]},
    {id:'train', label:'Train ticket', words:[/\birctc\b|\brailways?\b|\btrain\s*(?:no|number|name)/i, 3], more:[/\bcoach\b/i, /\bberth\b/i, /\bquota\b/i, /\bboarding\s*station\b/i, /\bPNR\b/i]},
    {id:'bus', label:'Bus ticket', words:[/\bbus\b|redbus|\bKSRTC\b|\bMSRTC\b|volvo/i, 2], more:[/\bboarding\s*point\b/i, /\bseat\b/i, /\bdrop(?:ping)?\s*point\b/i]},
    {id:'visa', label:'Visa', words:[/\bvisa\b|\be-?visa\b|entry permit/i, 3], more:[/number of entries|entries/i, /valid (?:until|till|from)/i, /duration of stay/i]},
    {id:'passport', label:'Passport', words:[/\bpassport\b|P<[A-Z]{3}/i, 3], more:[/date of expiry|date of issue/i, /nationality/i, /place of birth/i]},
    {id:'insurance', label:'Insurance', words:[/\binsurance\b|\bpolicy\b/i, 2], more:[/\binsured\b/i, /\bpremium\b/i, /sum insured|coverage/i, /policy (?:no|number|period)/i]},
    {id:'car', label:'Car / cab booking', words:[/car rental|rent a car|\bcab\b|\btaxi\b|uber|\bola\b|chauffeur/i, 2], more:[/pick[\s-]?up/i, /drop[\s-]?off/i]},
    {id:'activity', label:'Activity / entry ticket', words:[/admission|entry ticket|\btour\b|\bmuseum\b|\bpark\b|\bshow\b|\bevent\b|klook|viator|getyourguide/i, 1], more:[/\bvisit date\b/i, /\btime slot\b/i]},
    // personal documents
    {id:'aadhaar', label:'Aadhaar', words:[/aadhaar|आधार|unique identification authority|\buidai\b/i, 5], more:[/\b\d{4}\s\d{4}\s\d{4}\b/, /government of india/i, /\bVID\b/]},
    {id:'pan', label:'PAN card', words:[/permanent account number|\bpan card\b|e-?pan/i, 5], more:[/income tax department/i, /\b[A-Z]{5}\d{4}[A-Z]\b/, /father'?s name/i]},
    {id:'licence', label:'Driving licence', words:[/driving licen[cs]e|licen[cs]e to drive|\bDL\s*No/i, 5], more:[/transport department|parivahan|\bRTO\b/i, /class of vehicle|\bCOV\b|\bLMV\b|\bMCWG\b/i, /valid (?:till|upto)/i]},
    {id:'voter-id', label:'Voter ID', words:[/election commission|elector'?s photo identity|\bEPIC\b|voter id/i, 5], more:[/\b[A-Z]{3}\d{7}\b/, /assembly constituency/i]},
    {id:'tax', label:'Tax (ITR, Form 16, 26AS)', words:[/form\s*(?:no\.?\s*)?16\b|form\s*26\s*as|income tax return|\bITR[-\s]?[1-7V]\b|annual information statement|\bAIS\b/i, 5], more:[/assessment year/i, /\bTDS\b|tax deducted/i, /acknowledgement number/i, /\b[A-Z]{5}\d{4}[A-Z]\b/]},
    {id:'bank', label:'Bank statement', words:[/statement of account|account statement|bank statement/i, 4], more:[/opening balance/i, /closing balance/i, /\bIFSC\b/i, /withdrawal|deposit|narration/i]},
    {id:'investment', label:'Investment (CAS, contract note, demat)', words:[/consolidated account statement|\bCAS\b|contract note|mutual fund|demat|\bNSDL\b|\bCDSL\b|\bfolio\b/i, 4], more:[/\bNAV\b|\bunits\b/i, /\bISIN\b/, /brokerage|\bSTT\b/i, /\bSIP\b/]},
    {id:'property', label:'Property / rent', words:[/sale deed|rent(?:al)? agreement|lease agreement|leave and licen[cs]e|property tax|conveyance deed|\bkhata\b/i, 5], more:[/\blessor\b|\blessee\b|licensor|landlord|tenant/i, /\bsq\.?\s*ft\b|square feet/i, /stamp duty|sub-?registrar/i]},
    {id:'vehicle', label:'Vehicle (RC, PUC)', words:[/registration certificate|pollution under control|\bPUCC?\b|certificate of registration/i, 5], more:[/chassis/i, /engine no/i, /\bmaker\b|fuel type/i, /\b[A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{1,3}[-\s]?\d{4}\b/]},
    {id:'medical', label:'Medical', words:[/prescription|discharge summary|lab(?:oratory)? report|pathology|radiology|vaccination certificate|\bpatient\b/i, 4], more:[/\bdr\.?\s|doctor|physician/i, /diagnosis|haemoglobin|hemoglobin|blood (?:test|group)|\bmg\b/i, /hospital|clinic/i]},
    {id:'education', label:'Education', words:[/mark\s*sheet|marksheet|degree certificate|diploma|transcript|board of (?:secondary|higher)|provisional certificate/i, 4], more:[/university|college|school/i, /\bCGPA\b|\bSGPA\b|grade|percentage/i, /roll (?:no|number)|enrolment/i]},
    {id:'employment', label:'Employment (offer, salary slip)', words:[/offer letter|appointment letter|salary slip|pay\s*slip|relieving letter|experience letter|employment contract/i, 5], more:[/basic (?:pay|salary)|\bHRA\b|gross (?:pay|salary)|net pay/i, /employee (?:id|code|no)/i, /designation|date of joining/i]},
    {id:'bill', label:'Bill / warranty', words:[/tax invoice|\binvoice\b|warranty|electricity bill|bill (?:no|number|date)|amount due/i, 3], more:[/\bGSTIN\b/i, /due date/i, /serial (?:no|number)/i, /consumer (?:no|number)/i]},
  ];
  /* Travel papers and personal documents, for the pickers and the Travel / Personal switch. */
  const TRAVEL_TYPES = ['boarding-pass', 'flight', 'hotel', 'train', 'bus', 'visa', 'car', 'activity'];
  const GROUPS = [
    {id: 'travel', label: 'Travel', types: ['boarding-pass', 'flight', 'hotel', 'train', 'bus', 'visa', 'car', 'activity']},
    {id: 'identity', label: 'Identity', types: ['passport', 'aadhaar', 'pan', 'licence', 'voter-id']},
    {id: 'money', label: 'Money and tax', types: ['tax', 'bank', 'investment', 'insurance']},
    {id: 'life', label: 'Home, health and work', types: ['property', 'vehicle', 'medical', 'education', 'employment', 'bill']},
    {id: 'other', label: 'Other', types: ['other']},
  ];
  const isTravel = t => TRAVEL_TYPES.indexOf(t) >= 0;
  /* A trip's own document: a travel one, or a passport, travel insurance or unsorted one attached to that trip.
     Aadhaar, PAN, bank, tax, medical, property and the rest are personal even when attached to a trip - they used to
     show among a trip's tickets. */
  const isTripDoc = d => !!d && (isTravel(d.type) || (!!d.tripId && ['passport', 'insurance', 'other'].indexOf(d.type) >= 0));
  /* ID numbers, shown masked in lists: •••• 1234 */
  const mask = (n, type) => { n = String(n || ''); if(!n) return ''; return ['aadhaar', 'pan', 'bank', 'voter-id', 'licence', 'passport'].indexOf(type) >= 0 && n.replace(/\s/g, '').length > 4 ? '•••• ' + n.replace(/\s/g, '').slice(-4) : n; };
  const TYPE_LABEL = Object.fromEntries(TYPES.map(t=>[t.id, t.label]).concat([['other', 'Other']]));
  function guessType(text, barcode){
    if(barcode && barcode.legs) return 'boarding-pass';
    const T = String(text || '');
    let best = 'other', bestScore = 1;
    TYPES.forEach(t=>{
      let s = t.words[0].test(T) ? t.words[1] : 0;
      t.more.forEach(r=>{ if(r.test(T)) s += 1; });
      if(s > bestScore){ best = t.id; bestScore = s; }
    });
    return best;
  }

  /* ---------------------------------------------------------------- labelled fields */
  function after(text, labelRe, valueRe, span){
    const r = new RegExp('(?:' + labelRe + ')[\\s:#.\\-]{0,8}(?:[^\\n]{0,' + (span || 0) + '}?)' + valueRe, 'i');
    const m = r.exec(text);
    return m ? m[m.length - 1].trim() : '';
  }
  function findPNR(text){
    const r = /(?:\bPNR\b(?:\s*(?:No\.?|Number))?|Booking\s*(?:Ref(?:erence)?|ID|Code|No\.?|Number)|Confirmation\s*(?:No\.?|Number|Code|#)?|Record\s*Locator|Reservation\s*(?:No\.?|Number|Code|ID)|Airline\s*PNR|Itinerary\s*(?:No\.?|Number))\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-]{4,15})\b/gi;
    let m;
    while((m = r.exec(text))){
      const v = m[1];
      r.lastIndex = m.index + 1;                      // "Booking confirmation / Booking ID: X" - keep looking past a word
      if(!/^[A-Z0-9\-]+$/.test(v)) continue;           // codes are written in capitals
      if(/^(NUMBER|DETAILS|STATUS|CONFIRMED|BOOKING|PASSENGER)$/.test(v)) continue;
      if(/\d/.test(v) || /^[A-Z]{6}$/.test(v)) return v;
    }
    return '';
  }
  function findPassengers(text){
    const out = new Set(); let m;
    const r = /\b(MR|MRS|MS|MISS|MSTR|DR)\.?[ \t]+([A-Z][A-Za-z'\-]+(?:[ \t]+[A-Z][A-Za-z'\-]+){0,3})/g;
    while((m = r.exec(text))){ const n = m[2].replace(/\s+(Passenger|Adult|Child|Infant|Seat|Ticket|Economy|Business).*$/i, '').trim(); if(n.length > 2) out.add(n); }
    const r2 = /(?:Passenger|Traveller|Traveler|Guest)[ \t]*(?:Name|\(s\))?[ \t]*[:\-][ \t]*([A-Z][A-Za-z'\-]+(?:[ \/][A-Z][A-Za-z'\-]+){0,3})/g;
    while((m = r2.exec(text))) out.add(m[1].replace('/', ' ').replace(/^(MR|MRS|MS|MISS|MSTR|DR)\.?\s+/i, '').trim());
    const r3 = /\b([A-Z]{2,})\/([A-Z]{2,}(?:\s[A-Z]{2,})?)\s*(MR|MRS|MS|MISS|MSTR)?\b/g;       // GUPTA/ANIL MR
    while((m = r3.exec(text))) if(!/[A-Z]{3}\/[A-Z]{3}$/.test(m[0]) || m[0].length > 8) out.add(titleCase(m[2] + ' ' + m[1]));
    const seen = new Set();
    return Array.from(out).filter(n=>{ const k = n.toLowerCase().split(/\s+/).sort().join(' '); if(seen.has(k)) return false; seen.add(k); return true; }).slice(0, 9);
  }
  const titleCase = s => String(s || '').toLowerCase().replace(/\b[a-z]/g, c=>c.toUpperCase());

  /* ---------------------------------------------------------------- flights: one segment per flight number */
  function flightSegments(text, refYear){
    const T = String(text || '');
    const flights = findFlights(T), airports = findAirports(T), dates = findDates(T, refYear), times = findTimes(T);
    const segs = flights.map((f, i)=>{
      const next = flights[i + 1] ? flights[i + 1].index : T.length;
      const prevEnd = i ? flights[i - 1].index + flights[i - 1].flight.length : 0;
      // this flight's own text: from its number to the next one's, plus what is on its line before it
      const lineStart = Math.max(T.lastIndexOf('\n', f.index) + 1, prevEnd);
      const lo = Math.max(lineStart, f.index - 200), hi = Math.min(next, f.index + 400);
      const inWin = x => x.index >= lo && x.index < hi;
      const win = T.slice(lo, hi);
      const route = /\b([A-Z]{3})\s*(?:-|–|—|→|->|>|\/|to)\s*([A-Z]{3})\b/.exec(win);
      let from = '', to = '';
      if(route && AIRPORTS[route[1]] && AIRPORTS[route[2]] && !NOT_AIRPORT.has(route[1]) && !NOT_AIRPORT.has(route[2])){ from = route[1]; to = route[2]; }
      else {
        const aps = airports.filter(inWin).map(a=>a.code).filter((c, j, arr)=>arr.indexOf(c) === j);
        from = aps[0] || ''; to = aps[1] || '';
      }
      if(!from || !to){
        const cities = cityIndex(), found = [];
        const low = win.toLowerCase();
        Object.keys(cities).forEach(c=>{ const k = low.indexOf(c); if(k >= 0 && new RegExp('\\b' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(low)) found.push({code: cities[c], k}); });
        found.sort((a, b)=>a.k - b.k);
        const codes = found.map(x=>x.code).filter((c, j, arr)=>arr.indexOf(c) === j);
        if(!from) from = codes[0] || '';
        if(!to) to = codes.find(c=>c !== from) || '';
      }
      const d = dates.filter(inWin).sort((a, b)=>Math.abs(a.index - f.index) - Math.abs(b.index - f.index));
      const ts = times.filter(inWin).sort((a, b)=>a.index - b.index);
      const dep = ts[0] ? ts[0].time : '', arr = ts[1] ? ts[1].time : '';
      return {flight: f.flight, airline: f.airline, from, to, date: d[0] ? d[0].date : (dates[0] ? dates[0].date : ''), dep, arr};
    });
    return segs;
  }

  /* ---------------------------------------------------------------- hotel */
  const HOTEL_WORDS = /\b(hotel|resort|inn|suites?|residency|palace|lodge|hostel|villa|apartments?|homestay|marriott|hyatt|hilton|taj|oberoi|itc|novotel|ibis|radisson|sheraton|westin|lemon tree|treebo|oyo|fabhotel|holiday inn|crowne plaza|leela|trident|vivanta|accor|mercure|pullman|sofitel|four points|jw|ritz|st\.? regis|intercontinental|courtyard|fairfield|aloft|w hotel|park plaza|zostel|airbnb)\b/i;
  function hotelFields(text, refYear){
    const T = String(text || '');
    const lines = T.split(/\n+/).map(l=>l.trim()).filter(Boolean);
    let name = after(T, 'Hotel\\s*Name|Property(?:\\s*Name)?|Accommodation', '([A-Z][^\\n,]{2,60})');
    if(!name){
      const l = lines.find(x=>HOTEL_WORDS.test(x) && x.length <= 70 && !/check|booking|confirm|thank|policy|cancel|dear|www\.|@|₹|\bINR\b|\$/i.test(x));
      if(l) name = l.replace(/^(?:hotel|property)\s*[:\-]\s*/i, '');
    }
    let address = after(T, 'Address|Location|Property\\s*Address', '([^\\n]{8,140})');
    if(!address && name){
      const i = lines.findIndex(l=>l.indexOf(name) >= 0);
      if(i >= 0 && lines[i + 1] && /\d|,/.test(lines[i + 1]) && lines[i + 1].length < 160) address = lines[i + 1];
    }
    const dateNear = re => { const m = re.exec(T); if(!m) return ''; const ds = findDates(T.slice(m.index, m.index + 90), refYear); return ds[0] ? ds[0].date : ''; };
    const timeNear = re => { const m = re.exec(T); if(!m) return ''; return time24(T.slice(m.index, m.index + 90)); };
    const checkIn = dateNear(/check[\s-]?in/i), checkOut = dateNear(/check[\s-]?out/i);
    const dates = findDates(T, refYear);
    const nights = +(after(T, '', '(\\d{1,2})\\s*nights?') || 0);
    // the town is the last part of the address that is not a postcode, state or country
    let city = '';
    if(address){
      const parts = address.split(',').map(x=>x.replace(/\b\d{3}\s?\d{3}\b|\b\d{4,6}\b/g, '').trim()).filter(Boolean);
      const skip = /^(india|maharashtra|karnataka|kerala|tamil nadu|rajasthan|uttar pradesh|west bengal|gujarat|telangana|delhi ncr|uae|united arab emirates|usa|uk)$/i;
      for(let k = parts.length - 1; k >= 0; k--){ if(!skip.test(parts[k]) && parts[k].length > 2 && !/\d/.test(parts[k])){ city = parts[k]; break; } }
    }
    return {
      hotelName: name, address, city,
      checkIn: checkIn || (dates[0] ? dates[0].date : ''),
      checkOut: checkOut || (dates[1] ? dates[1].date : ''),
      checkInTime: timeNear(/check[\s-]?in\s*(?:time|from|after)?/i), checkOutTime: timeNear(/check[\s-]?out\s*(?:time|by|before|until)?/i),
      nights: nights || undefined,
      phone: after(T, 'Phone|Tel(?:ephone)?|Contact(?:\\s*No\\.?)?', '(\\+?[\\d][\\d\\s\\-()]{7,18}\\d)'),
      rooms: after(T, '', '(\\d{1,2})\\s*rooms?'),
    };
  }

  /* ---------------------------------------------------------------- train (IRCTC style) */
  function trainFields(text, refYear){
    const T = String(text || '');
    const pnr = after(T, 'PNR(?:\\s*No\\.?|\\s*Number)?', '(\\d{10})') || '';
    const trainM = /train\s*(?:no\.?|number)?\s*(?:\/\s*name)?\s*[:\-]?\s*(\d{5})\s*[\/\-]?\s*([A-Z][A-Z .\-]{3,40})?/i.exec(T);
    const from = after(T, 'From|Boarding\\s*(?:At|Station)', '([A-Z][A-Za-z .]{2,40}?\\s*\\(([A-Z]{2,5})\\))');
    const to = after(T, 'To|Reservation\\s*Upto|Destination', '([A-Z][A-Za-z .]{2,40}?\\s*\\(([A-Z]{2,5})\\))');
    const dates = findDates(T, refYear);
    const ts = findTimes(T);
    return {pnr, trainNo: trainM ? trainM[1] : '', trainName: trainM && trainM[2] ? trainM[2].trim() : '',
      fromStation: from, toStation: to, date: dates[0] ? dates[0].date : '', dep: ts[0] ? ts[0].time : '', arr: ts[1] ? ts[1].time : '',
      coach: after(T, 'Coach', '([A-Z]{1,2}\\d{1,2})'), berth: after(T, 'Berth|Seat', '(\\d{1,2}(?:\\s*\\/\\s*[A-Z ]{2,12})?)'),
      class: after(T, 'Class', '(1A|2A|3A|3E|SL|CC|EC|2S|FC|EA)')};
  }

  /* ---------------------------------------------------------------- one entry point */
  /* text: all text read from the file; barcode: the raw barcode string if one was found.
     -> {type, fields, confidence, found:[what was recognised]} */
  function read(text, barcode, opts){
    opts = opts || {};
    const ref = opts.ref || new Date();
    const refYear = ref.getFullYear();
    const T = String(text || '');
    const bc = barcode ? parseBCBP(barcode, ref) : null;
    const type = opts.type && opts.type !== 'auto' ? opts.type : guessType(T, bc);
    const fields = {}, found = [];
    const pnr = findPNR(T);
    const people = findPassengers(T);
    if(bc){
      fields.passengers = [bc.passenger];
      fields.pnr = bc.legs[0].pnr;
      fields.segments = bc.legs.map(l=>({flight: l.flight, airline: airline(l.carrier), from: l.from, to: l.to, date: l.date, seat: l.seat, cabin: l.cabin, sequence: l.sequence}));
      found.push('barcode');
      // times, gate and terminal are printed, not in the barcode
      const seg = fields.segments[0];
      seg.boarding = time24(after(T, 'Boarding\\s*(?:Time)?', '([0-2]?\\d[:.][0-5]\\d\\s*(?:[AaPp][Mm])?)'));
      seg.gate = after(T, 'Gate', '([A-Z]?\\d{1,3}[A-Z]?)\\b');
      seg.terminal = after(T, 'Terminal', '([A-Z0-9]{1,3})\\b');
      const segs = flightSegments(T, refYear);
      const same = segs.find(s=>s.flight === seg.flight);
      if(same){ seg.dep = same.dep; seg.arr = same.arr; }
    } else if(type === 'flight' || type === 'boarding-pass'){
      fields.pnr = pnr;
      fields.passengers = people;
      fields.segments = flightSegments(T, refYear);
      if(type === 'boarding-pass' && fields.segments[0]){
        const seg = fields.segments[0];
        seg.seat = after(T, 'Seat(?:\\s*No\\.?)?', '(\\d{1,2}[A-K])\\b');
        seg.gate = after(T, 'Gate', '([A-Z]?\\d{1,3}[A-Z]?)\\b');
        seg.boarding = time24(after(T, 'Boarding\\s*(?:Time)?', '([0-2]?\\d[:.][0-5]\\d\\s*(?:[AaPp][Mm])?)'));
        seg.terminal = after(T, 'Terminal', '([A-Z0-9]{1,3})\\b');
      }
      if(fields.segments.length) found.push('flights');
      if(pnr) found.push('PNR');
    } else if(type === 'hotel'){
      Object.assign(fields, hotelFields(T, refYear));
      fields.confirmation = pnr;
      fields.guests = people;
      if(fields.hotelName) found.push('hotel name');
      if(fields.checkIn) found.push('dates');
    } else if(type === 'train'){
      Object.assign(fields, trainFields(T, refYear));
      fields.passengers = people;
      if(fields.trainNo) found.push('train');
      if(fields.pnr) found.push('PNR');
    } else {
      const dates = findDates(T, refYear);
      fields.reference = pnr;
      fields.people = people;
      fields.dates = dates.map(d=>d.date).filter((d, i, a)=>a.indexOf(d) === i).slice(0, 6);
      if(type === 'visa' || type === 'passport'){
        fields.number = after(T, '(?:Visa|Passport|Document)\\s*(?:No\\.?|Number)', '([A-Z0-9]{6,15})') || ((/\b([A-Z]\d{7})\b/.exec(T) || [])[1] || '');
      }
      // the number that identifies each kind of personal document
      const first = re => { const m = re.exec(T); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };
      const NUM = {
        aadhaar: /\b(\d{4}\s?\d{4}\s?\d{4})\b/, pan: /\b([A-Z]{5}\d{4}[A-Z])\b/, 'voter-id': /\b([A-Z]{3}\d{7})\b/,
        licence: /\b([A-Z]{2}[-\s]?\d{2}[-\s]?(?:\d{4}[-\s]?)?\d{7,11})\b/, vehicle: /\b([A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{1,3}[-\s]?\d{4})\b/,
        tax: /\b([A-Z]{5}\d{4}[A-Z])\b/, investment: /folio\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9\/]{5,20})/i,
        insurance: /policy\s*(?:no\.?|number)\s*[:\-]?\s*([A-Z0-9\/-]{5,25})/i, bank: /(?:account|a\/c)\s*(?:no\.?|number)\s*[:\-]?\s*([X*\d][X*\d\s-]{5,20}\d)/i,
      };
      if(NUM[type]) fields.number = first(NUM[type]);
      if(type === 'tax'){ const ay = /assessment year\s*[:\-]?\s*(\d{4}\s*-\s*\d{2,4})/i.exec(T); if(ay) fields.reference = 'AY ' + ay[1].replace(/\s/g, ''); }
      // valid until / expires, and the date it was issued
      const exp = /(?:date of expiry|expiry date|expires? on|valid\s*(?:until|till|to|upto|up to)|validity|policy (?:end|expiry)|renewal date)/i.exec(T);
      if(exp){ const d = findDates(T.slice(exp.index, exp.index + 80), refYear); if(d[0]) fields.validUntil = d[0].date; }
      const iss = /(?:date of issue|issue date|issued on|date of registration|dated)/i.exec(T);
      if(iss){ const d = findDates(T.slice(iss.index, iss.index + 60), refYear); if(d[0]) fields.issuedOn = d[0].date; }
      // a period "01/04/2026 to 31/03/2027": it ends on the second date
      if(!fields.validUntil){ const per = /(?:policy\s*)?period[^\n]{0,40}?\bto\b/i.exec(T); if(per){ const d = findDates(T.slice(per.index, per.index + 70), refYear); if(d[1]) fields.validUntil = d[1].date; } }
      // whose it is: "Name: …", the line above "DOB" (Aadhaar), "Insured persons: …"
      const names = [];
      const nm = /(?:^|\s)(?:Name|Holder'?s? name|Employee name|Patient(?: name)?|Insured(?: persons?)?)\s*[:\-]\s*([A-Za-z][A-Za-z .,']{2,80})/gi;
      let mm;
      while((mm = nm.exec(T))) if(!/(?:father|mother|husband|spouse|guardian|nominee)'?s?\s*$/i.test(T.slice(Math.max(0, mm.index - 14), mm.index + 1)))
        // "Name: Anil Gupta Designation: …" - the last word is the next label
        (T[mm.index + mm[0].length] === ':' ? mm[1].replace(/\s*\S+\s*$/, '') : mm[1]).split(/,| and /).map(x=>x.replace(/\s+(age|dob|male|female)\b.*$/i, '').trim()).filter(x=>x.length > 2 && /^[A-Za-z .']+$/.test(x)).forEach(x=>names.push(titleCase(x)));
      const lines = T.split(/\n/).map(l=>l.trim());
      const dobAt = lines.findIndex(l=>/\b(?:DOB|date of birth|year of birth)\b/i.test(l));
      if(dobAt > 0 && /^[A-Za-z][A-Za-z .']{2,40}$/.test(lines[dobAt - 1]) && !/government|authority|india|department/i.test(lines[dobAt - 1])) names.push(titleCase(lines[dobAt - 1]));
      fields.people = Array.from(new Set(names.concat(fields.people || []))).slice(0, 6);
      if(type === 'insurance' && names.length) fields.passengers = names;
      if(fields.number) found.push('number');
      if(fields.dates.length) found.push('dates');
    }
    const confidence = bc ? 0.95 : Math.min(0.9, 0.2 + found.length * 0.2 + (T.length > 200 ? 0.1 : 0));
    return {type, fields, confidence, found};
  }

  /* The trip dates a document implies -> {start, end, city, country} (any may be '') */
  function span(doc){
    const f = doc.fields || {}, dates = [];
    let city = '', country = '';
    (f.segments || []).forEach(s=>{ if(s.date) dates.push(s.date); });
    ['checkIn', 'checkOut', 'date', 'visitDate', 'pickup'].forEach(k=>{ if(/^\d{4}-\d{2}-\d{2}$/.test(f[k] || '')) dates.push(f[k]); });
    if(doc.type === 'hotel'){ city = f.city || ''; country = f.country || ''; }
    const segs = f.segments || [];
    if(!city && segs.length){
      const outbound = segs[0], ap = airport(outbound.to);
      if(ap){ city = ap.city; country = ap.countryName; }
    }
    dates.sort();
    return {start: dates[0] || '', end: dates[dates.length - 1] || '', city, country};
  }

  return {findDates, findTimes, time24, parseBCBP, julianToDate, findFlights, findAirports, findPNR, findPassengers,
    flightSegments, hotelFields, trainFields, guessType, read, span, setReference, airport, airline, TYPES, TYPE_LABEL, titleCase, GROUPS, isTravel, isTripDoc, mask};
})();
if(typeof module !== 'undefined') module.exports = Parse;
