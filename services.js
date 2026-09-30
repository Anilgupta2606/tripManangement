"use strict";
/* =========================================================
   SERVICES — what Trip Vault asks the outside world, all straight from this browser:
   · Reader: text from a PDF (pdf.js), scans and photos (Tesseract OCR, on the device),
     the boarding-pass barcode (the browser's own detector, else ZXing), then the AI reader.
   · Geo: where a city or hotel is (Open-Meteo geocoding, Photon/OpenStreetMap).
   · Weather: the forecast for the trip days (Open-Meteo).
   · News: headlines (GDELT), the UK Foreign Office travel advice (gov.uk), AI summary.
   · Flights: live status (AeroDataBox or AirLabs with your free key, else Gemini + Google Search).
   ========================================================= */

const Lib = (function(){
  const loading = {};
  function script(url, test){
    if(test && test()) return Promise.resolve();
    if(!loading[url]) loading[url] = new Promise((res, rej)=>{
      const s = document.createElement('script');
      s.src = url; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = ()=>res(); s.onerror = ()=>{ delete loading[url]; rej(new Error('Could not load ' + url.split('/').slice(-1)[0] + ' (offline?).')); };
      document.head.appendChild(s);
    });
    return loading[url];
  }
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  async function pdfjs(){
    await script(PDFJS + 'pdf.min.js', ()=>window.pdfjsLib);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    return window.pdfjsLib;
  }
  const tesseract = () => script('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', ()=>window.Tesseract).then(()=>window.Tesseract);
  const zxing = () => script('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js', ()=>window.ZXing).then(()=>window.ZXing);
  return {script, pdfjs, tesseract, zxing};
})();

/* ================================================================ Reader */
const Reader = (function(){

  /* Open a PDF; asks for the password when it has one. */
  async function openPdf(bytes, askPassword){
    const pdfjsLib = await Lib.pdfjs();
    const task = pdfjsLib.getDocument({data: bytes.slice(0), isEvalSupported: false});
    task.onPassword = async (update, reason)=>{
      const p = await askPassword(reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD);
      if(p === null){ task.destroy(); return; }
      update(p);
    };
    return task.promise;
  }
  /* A PDF's text with its line breaks (items on the same baseline make one line). */
  async function pdfText(pdf, maxPages){
    const out = [];
    for(let p = 1; p <= Math.min(pdf.numPages, maxPages || 8); p++){
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      let lastY = null, line = [];
      const lines = [];
      tc.items.forEach(it=>{
        const y = Math.round(it.transform[5]);
        if(lastY !== null && Math.abs(y - lastY) > 2){ lines.push(line.join(' ')); line = []; }
        if(it.str.trim()) line.push(it.str.trim());
        lastY = y;
        if(it.hasEOL){ lines.push(line.join(' ')); line = []; lastY = null; }
      });
      if(line.length) lines.push(line.join(' '));
      out.push(lines.filter(Boolean).join('\n'));
    }
    return out.join('\n\n');
  }
  async function renderPage(pdf, n, scale){
    const page = await pdf.getPage(n);
    const vp = page.getViewport({scale: scale || 2});
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({canvasContext: ctx, viewport: vp}).promise;
    return c;
  }
  async function imageCanvas(blob, maxSide){
    let bmp;
    try{ bmp = await createImageBitmap(blob, {imageOrientation: 'from-image'}); }
    catch(e){
      bmp = await new Promise((res, rej)=>{ const im = new Image(); im.onload = ()=>res(im); im.onerror = ()=>rej(new Error('This picture can’t be opened here (HEIC? try JPEG).')); im.src = URL.createObjectURL(blob); });
    }
    const w = bmp.width, h = bmp.height, k = maxSide ? Math.min(1, maxSide / Math.max(w, h)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);      // transparent PNGs would turn black as JPEG
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  const canvasBlob = (c, type, q) => new Promise(res=>c.toBlob(res, type || 'image/jpeg', q || 0.85));
  const canvasB64 = async (c, maxSide) => {
    let src = c;
    if(maxSide && Math.max(c.width, c.height) > maxSide){
      const k = maxSide / Math.max(c.width, c.height);
      src = document.createElement('canvas'); src.width = Math.round(c.width * k); src.height = Math.round(c.height * k);
      src.getContext('2d').drawImage(c, 0, 0, src.width, src.height);
    }
    return src.toDataURL('image/jpeg', 0.85).split(',')[1];
  };
  async function thumb(c){
    const k = 360 / Math.max(c.width, c.height);
    const t = document.createElement('canvas');
    t.width = Math.round(c.width * Math.min(1, k)); t.height = Math.round(c.height * Math.min(1, k));
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.75);
  }

  /* The boarding-pass barcode on a page or photo -> its text, or '' */
  async function barcode(canvas){
    const tries = [canvas];
    try{
      if('BarcodeDetector' in window){
        const fmts = await BarcodeDetector.getSupportedFormats();
        const want = ['pdf417', 'aztec', 'qr_code', 'data_matrix'].filter(f=>fmts.indexOf(f) >= 0);
        if(want.length){
          const det = new BarcodeDetector({formats: want});
          for(const c of tries){
            const found = await det.detect(c);
            const hit = found.find(b=>/^M[1-9]/.test(b.rawValue)) || found[0];
            if(hit) return hit.rawValue;
          }
        }
      }
    }catch(e){}
    try{
      const ZX = await Lib.zxing();
      const hints = new Map();
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.PDF_417, ZX.BarcodeFormat.AZTEC, ZX.BarcodeFormat.QR_CODE, ZX.BarcodeFormat.DATA_MATRIX]);
      hints.set(ZX.DecodeHintType.TRY_HARDER, true);
      const rd = new ZX.MultiFormatReader();
      rd.setHints(hints);
      for(const c of tries){
        try{
          const bmp = new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.HTMLCanvasElementLuminanceSource(c)));
          return rd.decode(bmp).getText();
        }catch(e){}
      }
    }catch(e){}
    return '';
  }
  async function ocr(canvas, progress){
    const T = await Lib.tesseract();
    const r = await T.recognize(canvas, 'eng', {logger: m=>{ if(progress && m.status === 'recognizing text') progress(Math.round(m.progress * 100)); }});
    return (r.data && r.data.text) || '';
  }

  /* file -> {bytes, mime, name, text, barcode, pages, thumb, pictures:[{mime,b64}], method}
     Photos are shrunk to a sensible size before they are kept (a phone photo is 4–8 MB). */
  async function readFile(file, opts){
    opts = opts || {};
    const say = opts.progress || (()=>{});
    let mime = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.(jpe?g)$/i.test(file.name) ? 'image/jpeg' : /\.png$/i.test(file.name) ? 'image/png' : 'application/octet-stream');
    let bytes = new Uint8Array(await file.arrayBuffer());
    const out = {name: file.name, mime, text: '', barcode: '', pages: 1, thumb: '', pictures: [], method: []};
    if(mime === 'application/pdf'){
      say('Opening the PDF…');
      const pdf = await openPdf(bytes, opts.askPassword || (async ()=>null));
      out.pages = pdf.numPages;
      out.text = await pdfText(pdf);
      if(out.text.trim().length > 30) out.method.push('PDF text');
      const first = await renderPage(pdf, 1, 2);
      out.thumb = await thumb(first);
      say('Looking for a barcode…');
      out.barcode = await barcode(first);
      if(out.barcode) out.method.push('barcode');
      if(out.text.trim().length < 60 && !opts.noOcr){
        let t = '';
        for(let p = 1; p <= Math.min(2, pdf.numPages); p++){
          const c = p === 1 ? first : await renderPage(pdf, p, 2);
          t += await ocr(c, n=>say('Reading the scan (page ' + p + ') ' + n + '%'));
        }
        out.text = t; out.method.push('OCR');
      }
      out.pictures = [{mime: 'image/jpeg', b64: await canvasB64(first, 1800)}];
      if(opts.password) out.password = opts.password;
    } else if(/^image\//.test(mime)){
      say('Opening the picture…');
      const full = await imageCanvas(file, 2400);
      // keep a reasonable copy, not the 8 MB original
      if(file.size > 1500000 || /heic|heif/i.test(mime)){
        const b = await canvasBlob(full, 'image/jpeg', 0.85);
        bytes = new Uint8Array(await b.arrayBuffer()); mime = 'image/jpeg'; out.mime = mime;
      }
      out.thumb = await thumb(full);
      say('Looking for a barcode…');
      out.barcode = await barcode(full);
      if(out.barcode) out.method.push('barcode');
      if(!opts.noOcr){ out.text = await ocr(full, n=>say('Reading the picture ' + n + '%')); out.method.push('OCR'); }
      out.pictures = [{mime: 'image/jpeg', b64: await canvasB64(full, 1800)}];
    } else {
      try{ out.text = new TextDecoder().decode(bytes).slice(0, 50000); out.method.push('text'); }catch(e){}
    }
    out.bytes = bytes;
    return out;
  }

  /* ---------------------------------------------------------------- the AI reader */
  const SCHEMA = `{
 "type": one of ${JSON.stringify(Object.keys(Parse.TYPE_LABEL))},
 "title": short name for the document, e.g. "IndiGo DEL→BOM 12 Oct" or "Taj Lands End, 4 nights",
 "person": the main traveller's name as printed (First Last), or "",
 "fields": {
   "pnr": booking reference / PNR, "passengers": [names],
   "segments": [{"flight":"6E2134","airline":"IndiGo","from":"DEL","to":"BOM","date":"YYYY-MM-DD","dep":"HH:MM","arr":"HH:MM","terminal":"","gate":"","seat":"","boarding":"HH:MM"}],
   "hotelName":"", "address":"", "city":"", "country":"", "checkIn":"YYYY-MM-DD", "checkOut":"YYYY-MM-DD", "checkInTime":"HH:MM", "checkOutTime":"HH:MM", "confirmation":"", "phone":"", "guests":[names],
   "trainNo":"", "trainName":"", "fromStation":"", "toStation":"", "date":"YYYY-MM-DD", "dep":"HH:MM", "arr":"HH:MM", "coach":"", "berth":"", "class":"",
   "number":"", "validUntil":"YYYY-MM-DD", "reference":"", "notes":""
 },
 "summary": one sentence, what this document is and the key facts
}`;
  const SYSTEM = `You read travel documents (tickets, boarding passes, hotel bookings, train tickets, visas, insurance) and return the facts as JSON.
Answer with the JSON object only, in this shape (leave out fields that do not apply; never invent values; airports as IATA codes; 24-hour times; dates as YYYY-MM-DD):
${SCHEMA}`;
  async function aiRead(read, built, opts){
    opts = opts || {};
    const text = String(read.text || '').slice(0, 16000);
    const usePicture = read.pictures && read.pictures.length && Cloud.canSee() && (text.trim().length < 200 || opts.picture);
    const msg = `Document file: ${read.name}\nToday: ${new Date().toISOString().slice(0, 10)}\n` +
      (read.barcode ? `Boarding-pass barcode (IATA BCBP): ${read.barcode}\n` : '') +
      `What the built-in reader found (may be incomplete or wrong): ${JSON.stringify({type: built.type, fields: built.fields})}\n\n` +
      (text.trim() ? `Text of the document:\n"""\n${text}\n"""` : 'The document text could not be read; use the picture.');
    const r = await Cloud.chat(SYSTEM, [{role: 'user', content: msg}], usePicture ? {images: read.pictures} : {});
    const j = Cloud.json(r.text);
    return {type: j.type, title: j.title, person: j.person, fields: j.fields || {}, summary: j.summary, by: r.provider + ' · ' + r.model};
  }

  /* Merge two readings: `over` wins where it has a value. Segments are matched by flight number. */
  function mergeFields(base, over){
    const out = Object.assign({}, base || {});
    Object.entries(over || {}).forEach(([k, v])=>{
      if(v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length)) return;
      if(k === 'segments' && Array.isArray(out.segments) && out.segments.length){
        out.segments = v.map(s=>Object.assign({}, out.segments.find(b=>b.flight === s.flight) || {}, Object.fromEntries(Object.entries(s).filter(([, x])=>x !== '' && x != null))));
      } else out[k] = v;
    });
    return out;
  }

  /* The whole reading, in the order chosen in Settings:
     'builtin-ai' built-in first, then AI fills gaps (default) · 'ai' AI first, built-in if AI fails · 'builtin' built-in only */
  async function understand(read, mode, opts){
    opts = opts || {};
    const built = Parse.read(read.text, read.barcode, {type: opts.type});
    const result = {type: built.type, fields: built.fields, title: '', person: '', summary: '', by: 'Built-in reader' + (read.method.length ? ' (' + read.method.join(' + ') + ')' : ''), confidence: built.confidence, aiError: ''};
    if(mode === 'builtin' || !Cloud.aiAvailable()) return result;
    if(mode === 'builtin-ai' && built.confidence >= 0.95 && !opts.forceAi) return result;    // a barcode is exact
    try{
      if(opts.progress) opts.progress('The AI reader is reading it…');
      const ai = await aiRead(read, built, opts);
      if(mode === 'ai'){
        result.fields = mergeFields(built.fields, ai.fields);
        result.type = ai.type && Parse.TYPE_LABEL[ai.type] ? ai.type : built.type;
      } else {
        result.fields = mergeFields(ai.fields, built.fields.segments && read.barcode ? {segments: built.fields.segments, pnr: built.fields.pnr} : {});
        result.fields = mergeFields(built.fields, result.fields);
        result.type = built.type !== 'other' && built.confidence >= 0.6 ? built.type : (Parse.TYPE_LABEL[ai.type] ? ai.type : built.type);
      }
      result.title = ai.title || ''; result.person = ai.person || ''; result.summary = ai.summary || '';
      result.by = (mode === 'ai' ? 'AI reader' : 'Built-in + AI reader') + ' · ' + ai.by;
      result.confidence = Math.max(built.confidence, 0.85);
    }catch(e){
      result.aiError = e.message;
    }
    return result;
  }

  return {readFile, understand, aiRead, mergeFields, openPdf, renderPage, imageCanvas, canvasB64};
})();

/* ================================================================ Geo + weather */
const Geo = (function(){
  const cache = {};
  /* A city's place; `country` picks the right one of several (there is a Goa in the Philippines too). */
  async function city(name, country){
    const k = 'c:' + name.toLowerCase() + '|' + String(country || '').toLowerCase();
    if(cache[k]) return cache[k];
    const res = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&name=' + encodeURIComponent(name.split(',')[0].trim()));
    const d = await res.json();
    const list = d.results || [];
    const cn = String(country || '').toLowerCase();
    const r = cn ? list.find(x=>String(x.country || '').toLowerCase() === cn || String(x.country_code || '').toLowerCase() === cn) : list[0];
    return cache[k] = r ? {name: r.name, lat: r.latitude, lng: r.longitude, country: r.country, countryCode: r.country_code, timezone: r.timezone} : null;
  }
  async function place(q, near){
    const k = 'p:' + q.toLowerCase();
    if(cache[k]) return cache[k];
    const url = 'https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(q) + (near ? '&lat=' + near.lat + '&lon=' + near.lng : '');
    const d = await (await fetch(url)).json();
    const f = (d.features || [])[0];
    return cache[k] = f ? {name: f.properties.name, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], city: f.properties.city, country: f.properties.country} : null;
  }
  /* -> {'YYYY-MM-DD': {rain (%), tmax, tmin, code, text}} for the days Open-Meteo forecasts (16 ahead) */
  async function weather(loc, start, end){
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lng +
      '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=16');
    const d = await res.json();
    const out = {};
    ((d.daily || {}).time || []).forEach((t, i)=>{
      if((start && t < start) || (end && t > end) || d.daily.temperature_2m_max[i] === null) return;
      const code = d.daily.weathercode[i];
      out[t] = {rain: d.daily.precipitation_probability_max[i] || 0, tmax: d.daily.temperature_2m_max[i], tmin: d.daily.temperature_2m_min[i], code, text: wmo(code)};
    });
    return out;
  }
  function wmo(c){
    if(c === 0) return 'Clear'; if(c <= 2) return 'Partly cloudy'; if(c === 3) return 'Cloudy'; if(c <= 48) return 'Fog';
    if(c <= 57) return 'Drizzle'; if(c <= 67) return 'Rain'; if(c <= 77) return 'Snow'; if(c <= 82) return 'Showers'; if(c <= 86) return 'Snow showers';
    return 'Thunderstorm';
  }
  const km = (a, b) => { const R = 6371, r = x=>x * Math.PI / 180; const dl = r(b.lat - a.lat), dg = r(b.lng - a.lng);
    return 2 * R * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dg / 2) ** 2)); };
  return {city, place, weather, km};
})();

/* ================================================================ News */
const News = (function(){
  let last = 0;
  const wait = ms => new Promise(r=>setTimeout(r, ms));
  /* GDELT asks for one query every 5 seconds. */
  async function gdelt(query, timespan, max, retried){
    const gap = Date.now() - last;
    if(gap < 6500) await wait(6500 - gap);
    last = Date.now();
    const url = 'https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&sort=datedesc&maxrecords=' + (max || 25) +
      '&timespan=' + (timespan || '7d') + '&query=' + encodeURIComponent(query + ' sourcelang:english');
    let text = null;
    try{ const res = await fetch(url); text = await res.text(); }catch(e){ text = null; }   // a rate-limit answer has no CORS header: it fails as a network error
    if(text === null || /limit requests/i.test(text)){
      if(retried) throw new Error('the news service is busy, try again in a minute');
      await wait(9000);
      return gdelt(query, timespan, max, true);
    }
    if(!/^\s*\{/.test(text)) throw new Error(text.trim().slice(0, 80));
    const seen = new Set();
    return (JSON.parse(text).articles || []).map(a=>({title: a.title, url: a.url, source: a.domain, date: gdeltDate(a.seendate), country: a.sourcecountry, image: a.socialimage}))
      .filter(a=>{ const k = a.title.toLowerCase().replace(/[^a-z]/g, '').slice(0, 60); if(seen.has(k)) return false; seen.add(k); return true; });
  }
  const gdeltDate = s => /^\d{8}T\d{6}Z$/.test(s || '') ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) + 'T' + s.slice(9, 11) + ':' + s.slice(11, 13) + ':00Z' : '';
  /* GDELT refuses quoted words under 4 letters: "Goa" becomes ("in Goa" OR "Goa airport" …) */
  const q = s => { s = String(s).replace(/"/g, '').trim(); return s.length >= 4 ? '"' + s + '"' : '("in ' + s + '" OR "' + s + ' airport" OR "' + s + ' police" OR "' + s + ' government")'; };

  /* -> {city:[], security:[], travel:[]} headlines for the last few days */
  async function headlines(city, country, airports, progress){
    const say = progress || (()=>{});
    const out = {city: [], security: [], travel: [], errors: []};
    const place = country && country !== city ? '(' + q(city) + ' OR ' + q(country) + ')' : q(city);
    const jobs = [
      ['city', q(city), '3d', 'news from ' + city],
      ['security', place + ' (conflict OR attack OR missile OR military OR airstrike OR invasion OR protest OR riot OR curfew OR terror OR strike OR unrest OR evacuation OR sanctions OR ceasefire)', '7d', 'safety and geopolitics'],
      ['travel', '(' + [q(city)].concat((airports || []).slice(0, 2).map(a=>'"' + a + ' airport"')).join(' OR ') + ') (flight OR flights OR airport OR airline OR airspace OR cancelled OR delayed OR diverted OR grounded)', '5d', 'flights and airports'],
    ];
    for(const [k, query, span, label] of jobs){
      say('Reading ' + label + '…');
      try{ out[k] = await gdelt(query, span, 25); }catch(e){ out.errors.push(label + ': ' + e.message); }
    }
    return out;
  }

  /* The UK Foreign Office's advice for a country (gov.uk, no key) -> {level, levelText, updated, change, summary, url} */
  let fcdoIndex = null;
  async function advisory(country){
    if(!country) return null;
    if(!fcdoIndex){
      const d = await (await fetch('https://www.gov.uk/api/content/foreign-travel-advice')).json();
      fcdoIndex = ((d.links || {}).children || []).map(c=>({name: (c.details && c.details.country && c.details.country.name) || c.title.replace(/ travel advice$/, ''), slug: c.details && c.details.country && c.details.country.slug, synonyms: (c.details && c.details.country && c.details.country.synonyms) || []}));
    }
    const n = String(country).toLowerCase();
    const alias = {'united states': 'usa', 'united states of america': 'usa', 'us': 'usa', 'uk': 'united kingdom', 'uae': 'united arab emirates', 'russian federation': 'russia', 'viet nam': 'vietnam', 'korea, republic of': 'south korea', 'czechia': 'czech republic', 'türkiye': 'turkey'}[n] || n;
    const hit = fcdoIndex.find(c=>c.name.toLowerCase() === alias || c.slug === alias.replace(/\s+/g, '-') || c.synonyms.some(s=>s.toLowerCase() === alias));
    if(!hit){
      if(/^india$/i.test(country)) return {level: 0, levelText: 'Home country — no foreign travel advice.', url: ''};
      return null;
    }
    const d = await (await fetch('https://www.gov.uk/api/content/foreign-travel-advice/' + hit.slug)).json();
    const det = d.details || {};
    const status = det.alert_status || [];
    const level = status.indexOf('avoid_all_travel_to_whole_country') >= 0 ? 4 : status.indexOf('avoid_all_but_essential_travel_to_whole_country') >= 0 ? 3
      : status.indexOf('avoid_all_travel_to_parts') >= 0 ? 2 : status.indexOf('avoid_all_but_essential_travel_to_parts') >= 0 ? 1 : 0;
    const levelText = ['No FCDO travel restrictions', 'FCDO advises against all but essential travel to parts', 'FCDO advises against all travel to parts',
      'FCDO advises against all but essential travel to the whole country', 'FCDO advises against ALL travel to the whole country'][level];
    const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
    const part = slug => { const p = (det.parts || []).find(x=>x.slug === slug); return p ? strip(p.body).slice(0, 3500) : ''; };
    return {country: hit.name, level, levelText, updated: d.public_updated_at, change: det.change_description || '',
      summary: part('warnings-and-insurance'), safety: part('safety-and-security').slice(0, 2500), url: 'https://www.gov.uk' + d.base_path};
  }

  /* The AI's reading of all of it for this trip -> {status:'clear'|'caution'|'serious', headline, points:[], flights, advice, by} */
  async function summarise(trip, data, opts){
    opts = opts || {};
    const list = (arr, n) => (arr || []).slice(0, n).map(a=>'- ' + a.title + ' (' + a.source + ', ' + String(a.date).slice(0, 10) + ')').join('\n') || '(none)';
    const brief = search => `You brief a traveller on what is happening at their destination. Be factual and calm, only use what you are given${search ? ' or find with Google Search (prefer the last 7 days)' : ''}, and say plainly when things look normal.
Answer with JSON only: {"status":"clear"|"caution"|"serious","headline":"one line","points":["3-6 short bullet points, most important first"],"flights":"one line on flights/airports: cancellations, closures, strikes, airspace — or that nothing unusual is reported","advice":"one line: what the traveller should do"}
"serious" = war, airspace closure, government advice against travel, major unrest or disaster affecting the trip; "caution" = protests, strikes, weather disruption, partial warnings; else "clear".`;
    const msg = `Trip: ${trip.city}${trip.country ? ', ' + trip.country : ''}, ${trip.start || '?'} to ${trip.end || '?'}. Flights: ${(trip.flights || []).map(f=>f.flight + ' ' + f.from + '→' + f.to + ' ' + f.date).join('; ') || 'none known'}. Today is ${new Date().toISOString().slice(0, 10)}.
UK Foreign Office advice: ${data.advisory ? data.advisory.levelText + (data.advisory.change ? '. Latest change: ' + data.advisory.change : '') + '\n' + String(data.advisory.summary || '').slice(0, 1800) : 'not available'}
Weather forecast: ${data.weather ? Object.entries(data.weather).map(([d, w])=>d + ' ' + w.text + ' ' + Math.round(w.tmax) + '°C rain ' + w.rain + '%').join('; ') : 'not available'}
Headlines about ${trip.city}:\n${list(data.city, 15)}
Safety / geopolitics:\n${list(data.security, 15)}
Flights / airports:\n${list(data.travel, 15)}`;
    // with the web search if an AI that can search is free; otherwise the next AI (Groq, …) writes it from the headlines
    const r = await Cloud.chat(brief(!!opts.search), [{role: 'user', content: msg}], opts.search ? {search: true, searchOptional: true} : {});
    const j = Cloud.json(r.text);
    return Object.assign({status: 'clear', headline: '', points: [], flights: '', advice: ''}, j, {by: r.provider + ' · ' + r.model + (opts.search && r.noSearch ? ' (without web search — the AI that searches is busy)' : ''), sources: r.sources || [], at: Date.now()});
  }
  return {headlines, advisory, summarise, gdelt};
})();

/* ================================================================ Flights */
const Flights = (function(){
  /* Normalised status -> {state:'scheduled'|'on-time'|'delayed'|'boarding'|'departed'|'airborne'|'landed'|'cancelled'|'diverted'|'unknown',
     delayMin, dep:{airport, scheduled, estimated, actual, terminal, gate}, arr:{…, belt}, aircraft, source, at} */
  const hhmm = s => { const m = /(\d{2}):(\d{2})/.exec(String(s || '').replace('T', ' ')); return m ? m[1] + ':' + m[2] : ''; };
  const minsBetween = (a, b) => { if(!a || !b) return 0; return Math.round((Date.parse(b.replace(' ', 'T')) - Date.parse(a.replace(' ', 'T'))) / 60000) || 0; };

  async function aerodatabox(key, flight, date){
    const res = await fetch('https://aerodatabox.p.rapidapi.com/flights/number/' + encodeURIComponent(flight) + '/' + date + '?withAircraftImage=false&withLocation=false',
      {headers: {'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com'}});
    if(res.status === 204) return {state: 'not-operating', note: 'No flight ' + flight + ' is scheduled on ' + date + '.', source: 'AeroDataBox'};
    if(res.status === 401 || res.status === 403) throw new Error('AeroDataBox refused the key.');
    if(res.status === 429) throw new Error('AeroDataBox: monthly free limit reached.');
    if(!res.ok) throw new Error('AeroDataBox error ' + res.status);
    const list = await res.json();
    const f = (Array.isArray(list) ? list : [list])[0];
    if(!f) return {state: 'not-operating', note: 'No flight ' + flight + ' is scheduled on ' + date + '.', source: 'AeroDataBox'};
    const side = s => ({airport: (s.airport || {}).iata || '', airportName: (s.airport || {}).name || '', scheduled: hhmm((s.scheduledTime || {}).local), estimated: hhmm((s.revisedTime || {}).local || (s.predictedTime || {}).local),
      actual: hhmm((s.runwayTime || {}).local), terminal: s.terminal || '', gate: s.gate || '', belt: s.baggageBelt || '', schedLocal: (s.scheduledTime || {}).local || '', revLocal: (s.revisedTime || {}).local || ''});
    const dep = side(f.departure || {}), arr = side(f.arrival || {});
    const st = String(f.status || '').toLowerCase();
    const delayMin = Math.max(minsBetween(dep.schedLocal, dep.revLocal), 0);
    const state = /cancel/.test(st) ? 'cancelled' : /divert/.test(st) ? 'diverted' : /arrived|landed/.test(st) ? 'landed' : /enroute|approaching|departed/.test(st) ? 'airborne'
      : /boarding|gateclosed/.test(st) ? 'boarding' : /delayed/.test(st) || delayMin >= 15 ? 'delayed' : /expected|checkin|scheduled/.test(st) ? (dep.estimated ? 'on-time' : 'scheduled') : 'unknown';
    return {state, delayMin, dep, arr, airline: (f.airline || {}).name || '', aircraft: (f.aircraft || {}).model || '', raw: f.status, source: 'AeroDataBox', at: Date.now()};
  }

  async function airlabs(key, flight){
    const res = await fetch('https://airlabs.co/api/v9/flight?flight_iata=' + encodeURIComponent(flight) + '&api_key=' + encodeURIComponent(key));
    const d = await res.json();
    if(d.error){
      if(/not.?found|no.?data/i.test(d.error.message || d.error.code || '')) return {state: 'unknown', note: 'AirLabs has no live data for ' + flight + ' right now (it tracks flights from about a day before).', source: 'AirLabs'};
      throw new Error('AirLabs: ' + (d.error.message || d.error.code));
    }
    const f = d.response || {};
    const st = String(f.status || '').toLowerCase();
    const delayMin = +(f.dep_delayed || f.delayed || 0);
    const dep = {airport: f.dep_iata, scheduled: hhmm(f.dep_time), estimated: hhmm(f.dep_estimated), actual: hhmm(f.dep_actual), terminal: f.dep_terminal || '', gate: f.dep_gate || ''};
    const arr = {airport: f.arr_iata, scheduled: hhmm(f.arr_time), estimated: hhmm(f.arr_estimated), actual: hhmm(f.arr_actual), terminal: f.arr_terminal || '', gate: f.arr_gate || '', belt: f.arr_baggage || ''};
    const state = /cancel/.test(st) ? 'cancelled' : /divert/.test(st) ? 'diverted' : /landed/.test(st) ? 'landed' : /en-route|active/.test(st) ? 'airborne' : delayMin >= 15 ? 'delayed' : /scheduled/.test(st) ? 'on-time' : 'unknown';
    return {state, delayMin, dep, arr, airline: f.airline_iata || '', aircraft: f.aircraft_icao || '', raw: f.status, date: String(f.dep_time || '').slice(0, 10), source: 'AirLabs', at: Date.now()};
  }

  async function ai(flight, date, seg){
    const system = `You check the current status of a flight using Google Search (airline site, FlightAware, Flightradar24, airport sites, news). Answer with JSON only:
{"state":"scheduled"|"on-time"|"delayed"|"boarding"|"departed"|"airborne"|"landed"|"cancelled"|"diverted"|"not-operating"|"unknown","delayMin":0,"dep":{"airport":"IATA","scheduled":"HH:MM","estimated":"HH:MM","terminal":"","gate":""},"arr":{"airport":"IATA","scheduled":"HH:MM","estimated":"HH:MM"},"note":"one line: what you found and how sure you are"}
Use "unknown" if you cannot find information for that exact date; "scheduled" if the flight operates that day but nothing live is reported yet.`;
    const r = await Cloud.chat(system, [{role: 'user', content: `Flight ${flight} on ${date}${seg && seg.from ? ' from ' + seg.from + ' to ' + seg.to : ''}. Today is ${new Date().toISOString()}.`}], {search: true, tier: 'fast'});
    const j = Cloud.json(r.text);
    return Object.assign({state: 'unknown', delayMin: 0, dep: {}, arr: {}}, j, {source: 'AI web search (' + r.provider + ')', sources: r.sources || [], at: Date.now(), approximate: true});
  }

  /* keys: {aerodatabox, airlabs} -> tries them in that order, then Gemini search. */
  async function status(flight, date, keys, seg){
    const errors = [];
    const today = new Date().toISOString().slice(0, 10);
    if(keys.aerodatabox){ try{ return await aerodatabox(keys.aerodatabox, flight, date); }catch(e){ errors.push(e.message); } }
    if(keys.airlabs && Math.abs(Date.parse(date) - Date.parse(today)) <= 2 * 86400000){
      try{ const r = await airlabs(keys.airlabs, flight); if(r.state !== 'unknown' && (!r.date || r.date === date)) return r; errors.push(r.note || 'AirLabs: not tracked yet'); }catch(e){ errors.push(e.message); }
    }
    if(Cloud.canSearch()){ try{ const r = await ai(flight, date, seg); r.errors = errors; return r; }catch(e){ errors.push(e.message); } }
    const e = new Error(errors.length ? errors.join(' · ') : 'Add a free flight-status key (AeroDataBox or AirLabs) or a Gemini key in Settings.');
    e.noSource = !errors.length;
    throw e;
  }
  const links = (flight, date) => ({
    flightaware: 'https://www.flightaware.com/live/flight/' + encodeURIComponent(flight),
    fr24: 'https://www.flightradar24.com/data/flights/' + encodeURIComponent(flight.toLowerCase()),
    google: 'https://www.google.com/search?q=' + encodeURIComponent(flight + ' flight status ' + (date || '')),
  });
  return {status, links, aerodatabox, airlabs};
})();

/* ================================================================ Knowledge: what the internet says about a place,
   for the itinerary planner - fetched in the browser, no key:
   · Wikivoyage: the city's travel guide - its listings (sights, things to do, where to eat) with opening
     hours and prices, and the "Get around" / "Stay safe" advice,
   · Wikipedia: notable places around the hotel, with their distance from it. */
const Knowledge = (function(){
  const cache = {};
  const clean = t => String(t || '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[https?:\S+\s([^\]]*)\]/g, '$1').replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '').replace(/\{\{[^{}]*\}\}/g, '').replace(/={2,}\s*([^=]+?)\s*={2,}/g, '$1:')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  function fields(body){
    const out = {};
    body.split(/\n?\s*\|\s*/).forEach(part=>{ const m = /^([a-z]+)\s*=\s*([\s\S]*)$/i.exec(part.trim()); if(m) out[m[1].toLowerCase()] = clean(m[2]); });
    return out;
  }
  async function wikivoyage(page){
    const res = await fetch('https://en.wikivoyage.org/w/api.php?action=parse&prop=wikitext&format=json&origin=*&redirects=1&page=' + encodeURIComponent(page));
    const d = await res.json();
    return d.parse ? {title: d.parse.title, text: d.parse.wikitext['*']} : null;
  }
  /* -> {title, listings:[{kind, name, hours, price, note}], advice:{'Get around', 'Stay safe', ...}} */
  async function guide(city){
    const k = 'g:' + city.toLowerCase();
    if(cache[k]) return cache[k];
    const page = await wikivoyage(city).catch(()=>null);
    if(!page) return cache[k] = null;
    const listings = [];
    const re = /\{\{\s*(see|do|eat|drink|buy)\s*\|([\s\S]*?)\}\}/gi;          // sights, things to do, food, drink, shopping
    let m;
    while((m = re.exec(page.text)) && listings.length < 60){
      const f = fields(m[2]);
      if(!f.name) continue;
      listings.push({kind: m[1].toLowerCase(), name: f.name, hours: f.hours || '', price: f.price || '', note: (f.content || '').slice(0, 160)});
    }
    const advice = {};
    ['See', 'Do', 'Eat', 'Get around', 'Stay safe', 'Respect', 'Cope'].forEach(h=>{
      const sm = new RegExp('\\n==\\s*' + h + '\\s*==([\\s\\S]*?)(?=\\n==[^=]|$)').exec(page.text);
      if(sm){ const t = clean(sm[1].replace(/\{\{\s*(see|do|eat|drink|buy|listing)[\s\S]*?\}\}/gi, '').replace(/\n===?[^=\n]+===?/g, ' ')); if(t.length > 40) advice[h] = t.slice(0, listings.length >= 8 ? 500 : 1200); }
    });
    return cache[k] = {title: page.title, listings, advice, url: 'https://en.wikivoyage.org/wiki/' + encodeURIComponent(page.title.replace(/ /g, '_'))};
  }
  /* Notable places within ~10 km, nearest first -> [{name, km}] (schools, offices and the like left out) */
  async function nearby(loc){
    const k = 'n:' + loc.lat.toFixed(3) + ',' + loc.lng.toFixed(3);
    if(cache[k]) return cache[k];
    const res = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gsradius=10000&gslimit=60&format=json&origin=*&gscoord=' + loc.lat + '%7C' + loc.lng);
    const d = await res.json();
    const skip = /school|college|university|institute|hospital|constituency|assembly|court|office|ministry|bank|company|station$|depot|district|taluka|ward|panchayat|stadium|ground$|cricket|election|police/i;
    return cache[k] = ((d.query || {}).geosearch || []).filter(g=>!skip.test(g.title)).map(g=>({name: g.title, km: Math.round(g.dist / 100) / 10}));
  }
  /* Everything for a stay: -> {loc, hotelLoc, guide, nearby, used:[what was found]} */
  async function gather(city, country, hotel){
    const used = [];
    let hotelLoc = null;
    if(hotel && hotel.name){ hotelLoc = await Geo.place([hotel.name, hotel.address || city].filter(Boolean).join(', ')).catch(()=>null); }
    const loc = hotelLoc || await cityLoc(city, country).catch(()=>null);
    // the guide for the hotel's own town too (a state or region page has few listings: "Goa" vs "Candolim")
    const town = hotelLoc && hotelLoc.city && hotelLoc.city.toLowerCase() !== city.toLowerCase() ? hotelLoc.city : '';
    const [g0, gTown, n] = await Promise.all([guide(city).catch(()=>null), town ? guide(town).catch(()=>null) : null, loc ? nearby(loc).catch(()=>[]) : []]);
    let g = g0;
    if(gTown && gTown.listings.length){
      const seen = new Set();
      g = {title: gTown.title + (g0 ? ' + ' + g0.title : ''), url: gTown.url, advice: Object.assign({}, g0 ? g0.advice : {}, gTown.advice),
        listings: gTown.listings.concat(g0 ? g0.listings : []).filter(l=>{ const k = l.name.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; })};
    }
    if(g && (g.listings.length || Object.keys(g.advice).length)) used.push('travel guide (' + (g.listings.length ? g.listings.length + ' places' : 'advice') + ')');
    if(n.length) used.push(n.length + ' places near ' + (hotelLoc ? 'the hotel' : 'the centre'));
    return {loc, hotelLoc, guide: g, nearby: n, used};
  }
  /* The facts, short enough for any model's prompt. */
  function forPrompt(k){
    if(!k) return '';
    const out = [];
    if(k.guide && k.guide.listings.length) out.push('Travel guide (' + k.guide.title + ') - real places with opening hours:\n' + k.guide.listings.slice(0, 45).map(l=>`- ${l.name} [${l.kind}]${l.hours ? ' hours: ' + l.hours : ''}${l.price ? ' price: ' + l.price : ''}${l.note ? ' - ' + l.note : ''}`).join('\n'));
    if(k.guide) Object.entries(k.guide.advice).forEach(([h, t])=>out.push(h + ' (guide): ' + t));
    if(k.nearby.length) out.push('Notable places near ' + (k.hotelLoc ? 'the hotel' : 'the city centre') + ' (km): ' + k.nearby.slice(0, 35).map(p=>p.name + ' ' + p.km).join(', '));
    return out.join('\n\n').slice(0, 9000);
  }
  return {guide, nearby, gather, forPrompt};
})();
