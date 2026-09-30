const test = require('node:test');
const assert = require('node:assert');
const Parse = require('../parse.js');

const SAMPLES = {
  aadhaar: ['Government of India\nUnique Identification Authority of India\nAnil Gupta\nDOB: 12/06/1994\nMale\n4821 7734 9012\nआधार - आम आदमी का अधिकार', '4821 7734 9012'],
  pan: ['INCOME TAX DEPARTMENT  GOVT. OF INDIA\nPermanent Account Number Card\nABCPG1234K\nName: ANIL GUPTA\nFather\'s Name: RAKESH GUPTA', 'ABCPG1234K'],
  licence: ['Union of India\nDriving Licence\nDL No: MH12 20150012345\nDate of Issue: 14-03-2015\nValid Till: 13-03-2035\nClass of Vehicle: LMV, MCWG', 'MH12 20150012345'],
  'voter-id': ['ELECTION COMMISSION OF INDIA\nElector\'s Photo Identity Card\nABC1234567\nName: Anil Gupta\nAssembly Constituency: Pune', 'ABC1234567'],
  tax: ['FORM NO. 16\nCertificate under section 203 of the Income-tax Act, 1961 for tax deducted at source on salary\nPAN of the Employee: ABCPG1234K\nAssessment Year: 2026-27', 'ABCPG1234K'],
  bank: ['HDFC BANK\nStatement of Account\nAccount No: XXXXXXXX4521\nIFSC: HDFC0000123\nOpening Balance 1,20,000.00\nDate Narration Withdrawal Deposit Closing Balance', 'XXXXXXXX4521'],
  investment: ['Consolidated Account Statement (CAS)\nNSDL\nFolio No: 12345678/90\nISIN INF209K01VP1  Units 120.45  NAV 64.21', '12345678/90'],
  property: ['LEAVE AND LICENSE AGREEMENT\nThis agreement is made between the Licensor Mr. R. Shah and the Licensee Mr. Anil Gupta\nfor the flat of 850 sq. ft. at Baner, Pune\nStamp duty paid', ''],
  vehicle: ['Certificate of Registration\nRegistration No: MH 12 AB 1234\nChassis No: MA3EUA61S00123456\nEngine No: K12MN1234567\nFuel Type: Petrol', 'MH 12 AB 1234'],
  medical: ['City Hospital\nPatient: Anil Gupta   Age: 32\nLab Report - Complete Blood Count\nHaemoglobin 14.2 g/dL\nDr. S. Mehta, MD Pathology', ''],
  education: ['University of Pune\nStatement of Marks (Mark Sheet)\nBachelor of Engineering\nSeat No / Roll No: 12345\nSGPA 8.4  CGPA 8.1', ''],
  employment: ['ACME Technologies Pvt Ltd\nSalary Slip for September 2026\nEmployee ID: E1024\nDesignation: Senior Engineer\nBasic Pay 80,000  HRA 32,000  Net Pay 1,45,000', ''],
  bill: ['TAX INVOICE\nInvoice No: INV-2026-0931\nGSTIN: 27ABCDE1234F1Z5\nSamsung Galaxy S26 — Serial No: R3CX12345\nWarranty: 1 year', ''],
  insurance: ['Star Health Insurance\nPolicy Schedule — Family Health Optima\nPolicy No: P/211111/01/2026/001234\nPolicy Period: 01/04/2026 to 31/03/2027\nSum Insured: 10,00,000\nInsured persons: Anil Gupta, Priya Gupta', 'P/211111/01/2026/001234'],
  passport: ['REPUBLIC OF INDIA\nPASSPORT\nPassport No. Z1234567\nSurname: GUPTA  Given Name: ANIL\nNationality: INDIAN\nDate of Issue: 10/02/2021\nDate of Expiry: 09/02/2031\nPlace of Birth: DELHI', 'Z1234567'],
};

for(const [type, [text, number]] of Object.entries(SAMPLES)){
  test('recognises ' + type, ()=>{
    const r = Parse.read(text, null, {ref: new Date('2026-09-30')});
    assert.equal(r.type, type);
    if(number) assert.equal(r.fields.number, number);
  });
}

test('expiry and issue dates; masking; groups', ()=>{
  const dl = Parse.read(SAMPLES.licence[0], null, {ref: new Date('2026-09-30')});
  assert.equal(dl.fields.validUntil, '2035-03-13');
  assert.equal(dl.fields.issuedOn, '2015-03-14');
  assert.equal(Parse.read(SAMPLES.passport[0], null, {ref: new Date('2026-09-30')}).fields.validUntil, '2031-02-09');
  assert.equal(Parse.read(SAMPLES.tax[0], null, {ref: new Date('2026-09-30')}).fields.reference, 'AY 2026-27');
  assert.equal(Parse.mask('4821 7734 9012', 'aadhaar'), '•••• 9012');
  assert.equal(Parse.mask('MH 12 AB 1234', 'vehicle'), 'MH 12 AB 1234');
  assert.ok(Parse.isTravel('hotel') && !Parse.isTravel('aadhaar'));
  const all = Parse.GROUPS.flatMap(g=>g.types);
  Object.keys(Parse.TYPE_LABEL).forEach(t=>assert.ok(all.includes(t), t + ' is in a group'));
});

test('whose it is, and a policy period', ()=>{
  const a = Parse.read(SAMPLES.aadhaar[0], null, {ref: new Date('2026-09-30')});
  assert.deepEqual(a.fields.people, ['Anil Gupta']);
  const p = Parse.read(SAMPLES.pan[0], null, {ref: new Date('2026-09-30')});
  assert.equal(p.fields.people[0], 'Anil Gupta');
  const i = Parse.read(SAMPLES.insurance[0], null, {ref: new Date('2026-09-30')});
  assert.equal(i.fields.validUntil, '2027-03-31');
  assert.deepEqual(i.fields.passengers, ['Anil Gupta', 'Priya Gupta']);
});

test('a name in the middle of a line', ()=>{
  const r = Parse.read('ACME Technologies Pvt Ltd\nSalary Slip for September 2026\nEmployee ID: E1024   Name: Anil Gupta\nNet Pay 1,45,000', null, {ref: new Date('2026-09-30')});
  assert.equal(r.type, 'employment');
  assert.deepEqual(r.fields.people, ['Anil Gupta']);
});

test('names after a single space; not the father', ()=>{
  const r = Parse.read('Salary Slip for September 2026\nEmployee ID: E1024 Name: Anil Gupta Designation: Engineer', null, {ref: new Date('2026-09-30')});
  assert.equal(r.fields.people[0], 'Anil Gupta');
  const p = Parse.read('INCOME TAX DEPARTMENT\nPermanent Account Number Card\nABCPG1234K\nName: PRIYA GUPTA\nFather\'s Name: SURESH SHARMA', null, {ref: new Date('2026-09-30')});
  assert.deepEqual(p.fields.people, ['Priya Gupta']);
});
