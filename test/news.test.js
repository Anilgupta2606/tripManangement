/* News: the internet first (the web's news through your Mac, and GDELT), then the AI's summary of it. The columns
   stayed empty when GDELT said "Too Many Requests" (it does to everyone, often); a check that failed wiped what the
   last one found; and the AI only searched the web when a checkbox was ticked. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), vm = require('vm');

const NOW = Date.parse('2026-10-19T00:00:00Z');
const day = n => new Date(NOW - n * 86400000).toISOString();
const results = {
  city: [{title: 'Emaar founder doubles down on Dubai property market', url: 'https://msn.com/a', date: day(2), snippet: 'Dubai property'},
    {title: 'Passenger flight crashes upon landing at Calicut airport in India', url: 'https://en.wikinews.org/wiki/x', date: '2024-12-18T00:00:00', snippet: ''},
    {title: 'Daredevil climbs Dubai skyscrapers', url: 'https://msn.com/b', date: '', snippet: ''},
    {title: 'Dubai has a plan to double tourism', url: 'https://www.forbes.com/sites/x/2024/10/03/dubai', date: '', snippet: ''}],
  security: [{title: 'UAE names co-pilot in FlyDubai attack', url: 'https://msn.com/c', date: day(5), snippet: ''},
    {title: 'Boats carrying Kyoto students capsize off Okinawa', url: 'https://en.wikinews.org/wiki/y', date: day(3), snippet: ''}],
  travel: [{title: 'Air France extends Dubai flight suspension into November', url: 'https://msn.com/d', date: day(1), snippet: ''},
    {title: 'Dubai airport diverts flights as exceptional weather hits Gulf', url: 'https://phys.org/news/2024-04-dubai-airport.html', date: '', snippet: ''}],
};
const which = q => /airport flights/.test(q) ? 'travel' : /security/.test(q) ? 'security' : 'city';

function load(opts){
  const calls = {mac: [], gdelt: 0, chat: []};
  const ctx = {Parse: require('../parse.js'), console, URL, AbortController, Date: class extends Date { constructor(...a){ if(a.length) super(...a); else super(NOW); } static now(){ return NOW; } },
    // GDELT's waits (6.5 s between questions, 9 s before a retry) run at once here; the 45 s web timeout never fires
    setTimeout: (f, ms) => ms >= 40000 ? 0 : setImmediate(f), clearTimeout: ()=>{},
    MoneyAI: {macMaybe: ()=>opts.mac !== false, macFetch: async (p)=>{
      calls.mac.push(decodeURIComponent(p));
      if(opts.mac === false) throw new Error('offline');
      const q = decodeURIComponent(p.split('q=')[1]);
      return {ok: true, json: async ()=>({provider: 'your SearXNG', results: results[which(q)]})};
    }},
    fetch: async (url)=>{
      calls.gdelt++;
      if(opts.gdelt === 'busy') return {text: async ()=>'Please limit requests to one every 5 seconds'};
      return {text: async ()=>JSON.stringify({articles: [{title: 'GDELT story about Dubai ' + calls.gdelt, url: 'https://g.example/' + calls.gdelt, domain: 'g.example', seendate: '20261018T100000Z'},
        {title: 'US ambassador to Israel condemns attack on journalist', url: 'https://g.example/il' + calls.gdelt, domain: 'g.example', seendate: '20261018T100000Z'}]})};
    },
    Cloud: {chat: async (system, turns, o)=>{ calls.chat.push({system, msg: turns[0].content, o}); return {text: '{"status":"caution","headline":"h","points":["p"],"flights":"f","advice":"a"}', provider: 'Your own AI', model: 'auto', sources: []}; },
      json: t=>JSON.parse(t)},
  };
  vm.runInNewContext(fs.readFileSync(__dirname + '/../services.js', 'utf8') + '\nthis.News = News;', ctx);
  return {News: ctx.News, calls, ctx};
}

test('only recent news about the place is kept', ()=>{
  const {News} = load({});
  const keep = News.relevant(results.city, ['Dubai'], 7, NOW).map(a=>a.title);
  assert.deepEqual(keep, ['Emaar founder doubles down on Dubai property market', 'Daredevil climbs Dubai skyscrapers']);
  // short words match whole words only: "UAE" not inside another word
  const sec = News.relevant(results.security, ['Dubai', 'United Arab Emirates', 'uae'], 10, NOW).map(a=>a.title);
  assert.deepEqual(sec, ['UAE names co-pilot in FlyDubai attack']);
  assert.equal(News.merge([{title: 'A b', url: 'u1', date: day(3)}], [{title: 'a B', url: 'u2', date: day(1)}, {title: 'C', url: 'u3', date: day(1)}]).length, 2, 'no story twice');
});

test('GDELT busy: the columns are filled from the web, nothing reported missing', async ()=>{
  const {News, calls} = load({gdelt: 'busy'});
  const h = await News.headlines('Dubai', 'United Arab Emirates', ['DXB']);
  assert.ok(h.city.length && h.security.length && h.travel.length, JSON.stringify(h));
  assert.deepEqual(h.errors, []);
  assert.ok(h.from.some(f=>/web/.test(f)));
  assert.ok(calls.mac.every(p=>/q=!news /.test(p)), 'asks the news search: ' + calls.mac);
  assert.ok(!h.travel.some(a=>/phys\.org/.test(a.url)), 'a 2024 story is not this week\'s news');
});

test('the Mac out of reach: GDELT fills the columns', async ()=>{
  const {News} = load({mac: false});
  const h = await News.headlines('Dubai', 'United Arab Emirates', ['DXB']);
  assert.ok(h.city.length && h.security.length && h.travel.length);
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.from, ['GDELT (worldwide news)']);
  // live, GDELT put Israel's news in Dubai's Safety column: a story must name the place
  ['city', 'security', 'travel'].forEach(k=>assert.ok(!h[k].some(a=>/Israel/.test(a.title)), k + ': ' + h[k].map(a=>a.title)));
});

test('both out: every column says why', async ()=>{
  const {News} = load({mac: false, gdelt: 'busy'});
  const h = await News.headlines('Dubai', 'United Arab Emirates', ['DXB']);
  assert.equal(h.errors.length, 3);
  assert.match(h.errors[0], /^news from Dubai: .*Mac.*busy/);
});

test('the AI summary reads what was found (with the stories\' text) and searches the web when asked', async ()=>{
  const {News, calls} = load({gdelt: 'busy'});
  const h = await News.headlines('Dubai', 'United Arab Emirates', ['DXB']);
  const s = await News.summarise({city: 'Dubai', country: 'United Arab Emirates', start: '2026-12-23', end: '2026-12-28', flights: []}, h, {search: true});
  assert.equal(s.status, 'caution');
  const c = calls.chat[0];
  assert.match(c.msg, /Air France extends Dubai flight suspension/);
  assert.match(c.msg, /Dubai property/);                                // the snippet, not only the title
  assert.equal(c.o.search, true); assert.equal(c.o.searchOptional, true); assert.match(c.o.webQuestion, /Dubai/);
  assert.match(s.by, /Your own AI/);
});

test('News tab: no checkbox; a failed source keeps the last headlines; the AI always gets the internet\'s news first', async ()=>{
  const {News, calls} = load({mac: false, gdelt: 'busy'});
  const el = {};
  const ctx = {console, Date, setTimeout, News, Rules: {addDays: d=>d}, LOCAL: {news: {'t1|dubai': {at: 1, city: [{title: 'old city'}], security: [{title: 'old sec'}], travel: [], summary: {status: 'clear', at: 1}}}},
    newsState: null, tab: 'news', VIEWS: {}, $: id=>el[id] || null, esc: s=>String(s), tripSpan: ()=>({start: '2026-12-23', end: '2026-12-28'}), flightsOf: ()=>[], cityAirports: ()=>['DXB'],
    cityLoc: async ()=>null, Geo: {}, todayISO: ()=>'2026-10-19', daysUntil: ()=>60, saveLocal: ()=>{}, toast: ()=>{}, render: ()=>{},
    Cloud: {aiAvailable: ()=>true, canSearch: ()=>false}, citiesOf: ()=>[{city: 'Dubai', country: 'United Arab Emirates'}], ago: ()=>'now', icon: ()=>'', fmtDate: s=>s, wxIcon: ()=>''};
  const src = fs.readFileSync(__dirname + '/../live.js', 'utf8');
  assert.doesNotMatch(src, /AI also searches the web/);
  vm.runInNewContext(src + '\nthis.checkNews = checkNews;', ctx);
  News.summarise = async (trip, n, o)=>{ calls.summ = o; return {status: 'clear', headline: 'x', points: [], at: 2}; };
  await ctx.checkNews({id: 't1'}, 'Dubai', 'United Arab Emirates');
  const n = ctx.LOCAL.news['t1|dubai'];
  assert.deepEqual(n.city.map(a=>a.title), ['old city']);
  assert.deepEqual(n.security.map(a=>a.title), ['old sec']);
  assert.deepEqual(n.kept, ['News from Dubai', 'Safety']);
  assert.equal(calls.summ.search, true, 'little found: the AI searches the web too, without a checkbox');
});
