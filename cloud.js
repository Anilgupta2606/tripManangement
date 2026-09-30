"use strict";
/* =========================================================
   CLOUD — everything Trip Vault reaches outside this browser tab:
   · the Expense Tracker's (or the Ledger's) sign-in and AI keys, same site, same browser,
   · the free AI services that read documents, plan the itinerary and summarise news,
   · encrypted sync through private GitHub Gists, so the phone and the laptop
     see the same trips and the same documents.
   Nothing personal is in the site's code. Documents leave this browser only
   encrypted with your sync passphrase.
   ========================================================= */
const Cloud = (function(){

  const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } };
  const lsSet = (k, v) => { try{ if(v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };

  /* ---------------------------------------------------------------- Expense Tracker (same site, read only) */
  let etPromise = null;
  function expenseTracker(){
    if(etPromise) return etPromise;
    etPromise = (async ()=>{
      try{
        if(!window.indexedDB) return null;
        if(indexedDB.databases){
          const list = await indexedDB.databases();
          if(!list.some(d=>d.name === 'expense-tracker')) return null;
        }
        const db = await new Promise((res, rej)=>{
          const req = indexedDB.open('expense-tracker');
          req.onupgradeneeded = ()=>{ try{ req.transaction.abort(); }catch(e){} };
          req.onsuccess = ()=>res(req.result);
          req.onerror = ()=>rej(req.error);
          req.onblocked = ()=>rej(new Error('blocked'));
        });
        try{
          if(!db.objectStoreNames.contains('kv')) return null;
          const s = await new Promise((res, rej)=>{
            const r = db.transaction('kv').objectStore('kv').get('state');
            r.onsuccess = ()=>res(r.result); r.onerror = ()=>rej(r.error);
          });
          if(!s) return null;
          const st = s.settings || {};
          return {auth: s.auth || null,
                  ai: {keys: Object.assign({}, st.aiKeys || {}, st.geminiKey ? {gemini: st.geminiKey} : {}),
                       order: st.aiOrder || [], off: st.aiOff || [], model: st.aiModel || {}}};
        } finally { db.close(); }
      }catch(e){ return null; }
    })();
    return etPromise;
  }

  async function sha256(text){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.prototype.map.call(new Uint8Array(buf), b=>b.toString(16).padStart(2,'0')).join('');
  }
  /* One password for all the apps: the Expense Tracker's, else the Ledger's, else Trip Vault's own, else admin / admin. */
  async function checkLogin(user, pass, own){
    const u = String(user || '').trim();
    const et = await expenseTracker();
    if(et && et.auth && et.auth.passwordHash){
      if(u.toLowerCase() !== String(et.auth.username || '').toLowerCase()) return false;
      return await sha256('expense-tracker|' + u.toLowerCase() + '|' + pass) === et.auth.passwordHash;
    }
    const plan = lsGet('ledger-draft-v2', null) || lsGet('ledger-state-v2', null);
    if(plan && plan.auth && plan.auth.hash) return u.toLowerCase() === String(plan.auth.user).toLowerCase() && await sha256(u.toLowerCase() + ':' + pass) === plan.auth.hash;
    if(own && own.hash) return u.toLowerCase() === String(own.user).toLowerCase() && await sha256(u.toLowerCase() + ':' + pass) === own.hash;
    return u.toLowerCase() === 'admin' && pass === 'admin';
  }
  async function loginSource(){
    const et = await expenseTracker();
    if(et && et.auth && et.auth.passwordHash) return 'expense-tracker';
    const plan = lsGet('ledger-draft-v2', null) || lsGet('ledger-state-v2', null);
    if(plan && plan.auth && plan.auth.hash) return 'ledger';
    return 'own';
  }

  /* ---------------------------------------------------------------- encryption (the same scheme as the other apps) */
  const ITER = 200000;
  const b64 = bytes => { let s = ''; for(let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
  const keyCache = new Map();
  async function keyFor(pass, salt){
    const id = pass + '|' + b64(salt);
    if(keyCache.has(id)) return keyCache.get(id);
    const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    const k = await crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:ITER, hash:'SHA-256'}, raw, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
    keyCache.set(id, k);
    return k;
  }
  async function pipe(bytes, stream){ return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  async function sealBytes(bytes, pass, gzip){
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const gz = gzip && typeof CompressionStream !== 'undefined';
    if(gz) bytes = await pipe(bytes, new CompressionStream('gzip'));
    const data = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, await keyFor(pass, salt), bytes));
    return {salt:b64(salt), iv:b64(iv), gz, data:b64(data)};
  }
  async function unsealBytes(env, pass){
    let bytes;
    try{ bytes = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(env.iv)}, await keyFor(pass, unb64(env.salt)), unb64(env.data))); }
    catch(e){ throw new Error('The sync passphrase doesn’t match the one used on your other device.'); }
    if(env.gz) bytes = await pipe(bytes, new DecompressionStream('gzip'));
    return bytes;
  }
  async function seal(obj, pass, rev){
    return Object.assign({app:'trip-vault-sync', v:1, rev, savedAt:Date.now()}, await sealBytes(new TextEncoder().encode(JSON.stringify(obj)), pass, true));
  }
  async function unseal(env, pass){ return JSON.parse(new TextDecoder().decode(await unsealBytes(env, pass))); }

  /* ---------------------------------------------------------------- GitHub Gists */
  const SYNC_FILE = 'trip-vault.sync.json';
  const SYNC_CFG = 'tripvault-sync-config', SYNC_CHANGED = 'tripvault-sync-changed-at';
  const syncConfig = () => lsGet(SYNC_CFG, null);
  const saveSyncConfig = c => lsSet(SYNC_CFG, c || undefined);
  /* The Expense Tracker's or the Ledger's sync settings in this browser, to offer reusing them. */
  const otherAppSync = () => { const c = lsGet('sync-config', null) || lsGet('ledger-sync-config', null); return c && c.token && c.pass ? {token:c.token, pass:c.pass} : null; };

  async function gh(cfg, path, init){
    init = init || {};
    let res;
    try{
      res = await fetch('https://api.github.com' + path, Object.assign({}, init, {
        headers: Object.assign({Accept:'application/vnd.github+json', Authorization:'Bearer ' + cfg.token, 'X-GitHub-Api-Version':'2022-11-28'},
          init.body ? {'Content-Type':'application/json'} : {}),
        cache:'no-store'}));
    }catch(e){ throw new Error('Could not reach GitHub (offline?).'); }
    if(res.status === 401) throw new Error('GitHub refused the token. Check it has the Gists permission and hasn’t expired.');
    if(res.status === 403 || res.status === 404) throw new Error('GitHub said ' + res.status + '. The token needs “Gists: read and write”.');
    if(res.status === 422) throw new Error('GitHub would not store this (file too large?).');
    if(!res.ok) throw new Error('GitHub error ' + res.status + '.');
    return res;
  }
  async function readRemote(cfg){
    if(!cfg.gistId){
      for(let page = 1; page <= 5 && !cfg.gistId; page++){
        const list = await (await gh(cfg, '/gists?per_page=100&page=' + page)).json();
        const hit = list.find(g=>g.files && SYNC_FILE in g.files);
        if(hit) cfg.gistId = hit.id;
        if(list.length < 100) break;
      }
      if(!cfg.gistId) return null;
    }
    const gist = await (await gh(cfg, '/gists/' + cfg.gistId)).json();
    const f = gist.files && gist.files[SYNC_FILE];
    if(!f) return null;
    const text = f.truncated && f.raw_url ? await (await fetch(f.raw_url, {cache:'no-store'})).text() : (f.content || '');
    const env = JSON.parse(text);
    if(env.app !== 'trip-vault-sync') throw new Error('The sync gist holds something else.');
    return env;
  }
  async function writeRemote(cfg, env){
    const files = {}; files[SYNC_FILE] = {content: JSON.stringify(env)};
    if(cfg.gistId) await gh(cfg, '/gists/' + cfg.gistId, {method:'PATCH', body:JSON.stringify({files})});
    else cfg.gistId = (await (await gh(cfg, '/gists', {method:'POST', body:JSON.stringify({description:'Trip Vault sync (encrypted)', public:false, files})})).json()).id;
  }

  /* Each document file is its own secret gist, encrypted; the trips data remembers where. */
  const MAX_FILE = 18 * 1024 * 1024;       // encrypted, base64 - GitHub takes this comfortably
  async function uploadFile(id, bytes, mime){
    const cfg = syncConfig();
    if(!cfg) throw new Error('Sync is off.');
    const env = Object.assign({app:'trip-vault-file', v:1, id, mime}, await sealBytes(bytes, cfg.pass, !/^image\/|pdf$/.test(mime)));
    const body = JSON.stringify(env);
    if(body.length > MAX_FILE) throw new Error('Too large to sync (' + Math.round(bytes.length / 1048576) + ' MB). It stays on this device.');
    const files = {}; files[id + '.tvf'] = {content: body};
    const g = await (await gh(cfg, '/gists', {method:'POST', body:JSON.stringify({description:'Trip Vault file (encrypted)', public:false, files})})).json();
    return {gistId: g.id, rawUrl: g.files[id + '.tvf'].raw_url};
  }
  async function downloadFile(remote){
    const cfg = syncConfig();
    if(!cfg) throw new Error('Turn on sync (Settings) to fetch documents added on your other device.');
    let res;
    try{ res = await fetch(remote.rawUrl, {cache:'no-store'}); }catch(e){ res = null; }
    if(!res || !res.ok){
      const g = await (await gh(cfg, '/gists/' + remote.gistId)).json();
      const f = Object.values(g.files || {})[0];
      if(!f) throw new Error('The file is gone from GitHub.');
      res = await fetch(f.raw_url, {cache:'no-store'});
    }
    const env = JSON.parse(await res.text());
    if(env.app !== 'trip-vault-file') throw new Error('Not a Trip Vault file.');
    return {bytes: await unsealBytes(env, cfg.pass), mime: env.mime};
  }
  async function deleteFile(remote){
    const cfg = syncConfig();
    if(!cfg || !remote || !remote.gistId) return;
    try{ await gh(cfg, '/gists/' + remote.gistId, {method:'DELETE'}); }catch(e){}
  }

  const markSaved = () => lsSet(SYNC_CHANGED, Date.now());
  let running = null;
  /* getSaved() -> this device's data; apply(data) takes the other device's.
     Both changed since they last met: merge(mine, theirs) decides. -> 'pushed' | 'pulled' | 'merged' | 'unchanged' */
  function syncNow(getSaved, apply, merge){
    if(!running) running = runSync(getSaved, apply, merge).finally(()=>{ running = null; });
    return running;
  }
  async function runSync(getSaved, apply, merge){
    const cfg = syncConfig();
    if(!cfg) throw new Error('Sync is off.');
    const finish = (rev, result) => { saveSyncConfig(Object.assign(cfg, {rev, syncedAt:Date.now(), lastError:undefined})); return result; };
    const newRev = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    try{
      const remote = await readRemote(cfg);
      const changed = (lsGet(SYNC_CHANGED, 0) || 0) > (cfg.syncedAt || 0);
      const push = async data => { const rev = newRev(); await writeRemote(cfg, await seal(data, cfg.pass, rev)); return rev; };
      if(!remote) return finish(await push(getSaved()), 'pushed');
      if(remote.rev === cfg.rev){
        if(!changed) return finish(remote.rev, 'unchanged');
        return finish(await push(getSaved()), 'pushed');
      }
      const theirs = await unseal(remote, cfg.pass);
      if(!changed){ await apply(theirs); return finish(remote.rev, 'pulled'); }
      const both = merge(getSaved(), theirs);
      await apply(both);
      return finish(await push(both), 'merged');
    }catch(e){
      saveSyncConfig(Object.assign(cfg, {lastError: e.message}));
      throw e;
    }
  }
  function forgetSync(){ lsSet(SYNC_CFG, undefined); lsSet(SYNC_CHANGED, undefined); }

  /* ---------------------------------------------------------------- free AI services
     The same services, keys and order as the Expense Tracker and the Ledger: keys
     entered here win, otherwise theirs in this browser are used. */
  const PROVIDERS = [
    {id:'gemini', name:'Google Gemini', signupUrl:'https://aistudio.google.com/apikey', placeholder:'AIza…', models:['gemini-flash-latest','gemini-flash-lite-latest'], vision:true, search:true},
    {id:'groq', name:'Groq', signupUrl:'https://console.groq.com/keys', placeholder:'gsk_…', models:['openai/gpt-oss-120b','llama-3.3-70b-versatile','openai/gpt-oss-20b']},
    {id:'cerebras', name:'Cerebras', signupUrl:'https://cloud.cerebras.ai', placeholder:'csk-…', models:['gpt-oss-120b','llama-3.3-70b','llama3.1-8b']},
    {id:'mistral', name:'Mistral', signupUrl:'https://console.mistral.ai/api-keys', placeholder:'key', models:['mistral-small-latest','mistral-medium-latest']},
    {id:'openrouter', name:'OpenRouter', signupUrl:'https://openrouter.ai/keys', placeholder:'sk-or-…', models:['openrouter/free','meta-llama/llama-3.3-70b-instruct:free']},
    {id:'ollama', name:'Local (Ollama)', signupUrl:'https://ollama.com', placeholder:'http://localhost:11434', models:['gemma3:4b'], keyless:true},
    {id:'anthropic', name:'Anthropic Claude (paid)', signupUrl:'https://console.anthropic.com/settings/keys', placeholder:'sk-ant-…', models:['claude-haiku-4-5-20251001'], vision:true},
  ];
  const OPENAI_BASE = {groq:'https://api.groq.com/openai/v1', cerebras:'https://api.cerebras.ai/v1', mistral:'https://api.mistral.ai/v1', openrouter:'https://openrouter.ai/api/v1'};
  const SYNCED_AI = 'tripvault-ai-synced';
  /* The keys this device uses, to carry to your other devices inside the encrypted sync (not Ollama: it is this computer's). */
  function shareableAi(){
    const s = aiSettings(), keys = {};
    Object.entries(s.keys).forEach(([id, k])=>{ if(id !== 'ollama' && s.from[id] !== 'synced') keys[id] = k; });
    return {keys, order: s.order, model: s.model};
  }
  const takeSyncedAi = a => lsSet(SYNCED_AI, a && a.keys ? a : undefined);
  const AI_KEY = 'tripvault-ai', REST_KEY = 'tripvault-ai-rest', MODELS_KEY = 'tripvault-ai-models';
  const aiLocal = () => lsGet(AI_KEY, {keys:{}, order:[], off:[]});
  const saveAiLocal = s => lsSet(AI_KEY, s);
  let etAi = null;
  async function loadAi(){ const et = await expenseTracker(); etAi = et ? et.ai : null; return aiSettings(); }
  function aiSettings(){
    const own = aiLocal(), et = etAi || {keys:{}, order:[], off:[], model:{}}, led = lsGet('ledger-ai', {keys:{}, order:[], off:[]});
    const synced = lsGet(SYNCED_AI, {keys:{}});            // keys from your other device, through the encrypted sync
    const keys = {}, from = {};
    PROVIDERS.forEach(p=>{
      const mine = String((own.keys || {})[p.id] || '').trim(), theirs = String((et.keys || {})[p.id] || '').trim(), ledger = String((led.keys || {})[p.id] || '').trim();
      if(mine){ keys[p.id] = mine; from[p.id] = 'trip-vault'; }
      else if(theirs){ keys[p.id] = theirs; from[p.id] = 'expense-tracker'; }
      else if(ledger){ keys[p.id] = ledger; from[p.id] = 'ledger'; }
      else if((synced.keys || {})[p.id]){ keys[p.id] = String(synced.keys[p.id]); from[p.id] = 'synced'; }
    });
    // the order: free services first, then this computer's, then the paid one (as ATS does) - or the Expense Tracker's own order
    let order = (own.order && own.order.length ? own.order : et.order || []).filter(id=>PROVIDERS.some(p=>p.id === id));
    PROVIDERS.forEach(p=>{ if(order.indexOf(p.id) < 0) order.push(p.id); });
    const off = own.order && own.order.length ? (own.off || []) : (et.off || []);
    // "which goes first": auto, or one picked by hand; the others follow only if fallback is on
    const first = own.first && own.first !== 'auto' && PROVIDERS.some(p=>p.id === own.first) ? own.first : 'auto';
    const fallback = own.fallback !== false;
    if(first !== 'auto') order = [first].concat(order.filter(id=>id !== first));
    return {keys, from, order, off, first, fallback, model: Object.assign({}, et.model || {}, own.model || {})};
  }
  const usable = s => { const u = s.order.filter(id=>s.off.indexOf(id) < 0 && s.keys[id]); return s.first !== 'auto' && !s.fallback ? u.filter(id=>id === s.first) : u; };
  const aiAvailable = () => usable(aiSettings()).length > 0;
  const aiNames = () => usable(aiSettings()).map(id=>PROVIDERS.find(p=>p.id === id).name);
  const canSee = () => usable(aiSettings()).some(id=>PROVIDERS.find(p=>p.id === id).vision);
  const canSearch = () => usable(aiSettings()).indexOf('gemini') >= 0;

  const restMap = () => lsGet(REST_KEY, {});
  function resting(id){ const r = restMap()[id]; return r && r.until > Date.now() ? r : null; }
  function rest(id, why){ const m = restMap(); m[id] = {until: Date.now() + 15 * 60000, why}; lsSet(REST_KEY, m); }
  function wake(id){ const m = restMap(); delete m[id]; lsSet(REST_KEY, m); }

  function Unavailable(message, status, limit){ const e = new Error(message); e.unavailable = true; e.status = status; e.limit = !!limit; return e; }
  async function post(url, headers, body, signal, wait){
    const ctl = new AbortController(), timer = setTimeout(()=>ctl.abort(), wait || 120000);
    if(signal) signal.addEventListener('abort', ()=>ctl.abort());
    try{ return await fetch(url, {method:'POST', headers:Object.assign({'Content-Type':'application/json'}, headers), body:JSON.stringify(body), signal:ctl.signal}); }
    catch(e){
      if(signal && signal.aborted){ const c = new Error('Stopped.'); c.code = 'cancelled'; throw c; }
      if(e.name === 'AbortError') throw Unavailable('No answer in time.', 504);
      throw Unavailable('Could not reach the service (offline, or it blocked the request).', 503);
    } finally { clearTimeout(timer); }
  }
  async function failure(name, res){
    const body = await res.text().catch(()=>'');
    if(res.status === 401 || res.status === 403 || (res.status === 400 && /api[ _-]?key|unauthori[sz]ed|invalid.*key/i.test(body))) throw new Error(name + ' rejected the API key.');
    if(res.status === 429 || /quota|rate.?limit|exhausted|too many/i.test(body)) throw Unavailable(name + ': free limit reached for now.', 429, true);
    if(res.status === 402) throw Unavailable(name + ': no credit left on this account.', 402, true);
    if(res.status === 404) throw Unavailable(name + ': model not available to this key.', 404);
    if(res.status === 400 && /image|vision|multimodal|content type/i.test(body)) throw Unavailable(name + ' cannot read images with this model.', 400);
    if(res.status >= 500) throw Unavailable(name + ' is busy right now.', res.status);
    throw Unavailable(name + ' returned an error (' + res.status + ').', res.status);
  }
  /* opts.images: [{mime, b64}] (only services that can see get them); opts.search: Gemini looks on the web.
     -> {text, sources:[{title, url}]} */
  async function callOne(id, key, model, system, turns, opts, signal){
    const name = PROVIDERS.find(p=>p.id === id).name;
    const images = opts.images || [];
    if(id === 'gemini'){
      const contents = turns.map((t, i)=>({role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{text: t.content}].concat(i === turns.length - 1 ? images.map(im=>({inline_data:{mime_type: im.mime, data: im.b64}})) : [])}));
      const body = {systemInstruction:{parts:[{text:system}]}, contents, generationConfig:{temperature:0.2, maxOutputTokens:8192}};
      if(opts.search) body.tools = [{google_search:{}}];
      const res = await post('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), {}, body, signal);
      if(!res.ok) await failure(name, res);
      const d = await res.json();
      const cand = (d.candidates || [])[0] || {};
      const text = ((cand.content || {}).parts || []).map(p=>p.text || '').join('');
      if(!text) throw Unavailable('Gemini returned an empty answer.', 502);
      const sources = (((cand.groundingMetadata || {}).groundingChunks) || []).map(c=>c.web).filter(Boolean).map(w=>({title: w.title, url: w.uri}));
      return {text, sources};
    }
    if(id === 'anthropic'){
      const messages = turns.map((t, i)=>({role: t.role, content: i === turns.length - 1 && images.length
        ? images.map(im=>im.mime === 'application/pdf' ? {type:'document', source:{type:'base64', media_type:im.mime, data:im.b64}} : {type:'image', source:{type:'base64', media_type:im.mime, data:im.b64}}).concat([{type:'text', text:t.content}])
        : t.content}));
      const res = await post('https://api.anthropic.com/v1/messages', {'x-api-key':key, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true'},
        {model, max_tokens:8192, temperature:0.2, system, messages}, signal);
      if(!res.ok) await failure(name, res);
      const d = await res.json();
      return {text: (d.content || []).map(c=>c.text || '').join(''), sources: []};
    }
    if(id === 'ollama'){
      // Ollama's own API, with "thinking" off: reasoning models otherwise think for minutes on a laptop
      const res = await post(key.replace(/\/+$/, '') + '/api/chat', {},
        {model, stream:false, think:false, options:{temperature:0.2, num_ctx:8192}, messages:[{role:'system', content:system}].concat(turns)}, signal, 600000);
      if(!res.ok) await failure(name, res);
      const d = await res.json();
      const text = ((d.message || {}).content || '').replace(/<think>[\s\S]*?<\/think>/g, '');
      if(!text) throw Unavailable(name + ' returned an empty answer.', 502);
      return {text, sources: []};
    }
    const base = OPENAI_BASE[id];
    const headers = {Authorization:'Bearer ' + key};
    if(id === 'openrouter'){ headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'Trip Vault'; }
    const res = await post(base + '/chat/completions', headers,
      {model, temperature:0.2, max_tokens:8192, messages:[{role:'system', content:system}].concat(turns)}, signal);
    if(!res.ok) await failure(name, res);
    const d = await res.json();
    const text = ((((d.choices || [])[0] || {}).message) || {}).content || '';
    if(!text) throw Unavailable(name + ' returned an empty answer.', 502);
    return {text: text.replace(/<think>[\s\S]*?<\/think>/g, ''), sources: []};     // reasoning models think out loud first
  }

  const NOT_CHAT = /embed|tts|whisper|audio|speech|transcribe|image-gen|imagen|veo|lyria|dall|guard|moderation|rerank|live|realtime|robotics|computer-use|omni|customtools|aqa|learnlm|compound|playai|safeguard/i;
  const PREFER = ['gpt-oss-120b','kimi-k2','qwen3-235b','qwen-3-235b','llama-4-maverick','deepseek-v3','llama-3.3-70b','mistral-large','mistral-medium','qwen3-32b','qwen-3-32b','llama-4-scout','mistral-small','gpt-oss-20b','gemma-3-27b','ministral-8b','llama-3.1-8b','llama3.1-8b'];
  const sizeB = m => Number((m.match(/(\d+(?:\.\d+)?)b\b/i) || [])[1] || 0);
  const verOf = m => Number((m.match(/(\d+(?:\.\d+)?)/) || [])[1] || 0);
  // for quick tasks: the mid-size models ATS found answer fastest and still well
  const FAST_PREFER = ['gpt-oss-20b','ministral-3b','ministral-8b','qwen3-32b','qwen-3-32b','llama-3.1-8b','llama3.1-8b','gemma-3-27b','mistral-small','llama-4-scout','llama-3.3-70b','gpt-oss-120b'];
  const prefIdx = (m, list) => { list = list || PREFER; const i = list.findIndex(p=>m.toLowerCase().indexOf(p) >= 0); return i < 0 ? list.length : i; };
  /* The best models first, for a kind of task: "smart" (reading documents, planning, news) wants the strongest,
     "fast" (a flight check) a quick one - the same split ATS makes. */
  function rankModels(id, names, tier){
    const fast = tier === 'fast';
    const uniq = Array.from(new Set(names)).filter(m=>!NOT_CHAT.test(m));
    if(id === 'gemini'){
      const g = uniq.filter(m=>/^gemini/.test(m) && !/gemma|nano|tuning|image|tts|embedding|live|audio|robotics|computer|deep-research|antigravity/.test(m));
      const kind = m => /lite/.test(m) ? 'lite' : /flash/.test(m) ? 'flash' : /pro/.test(m) ? 'pro' : 'other';
      const RANK = fast ? {lite: 0, flash: 1, pro: 3, other: 4} : {flash: 0, pro: 1, lite: 2, other: 4};
      const alias = m => /-latest$/.test(m), preview = m => /preview|exp/.test(m) ? 1 : 0;
      const newest = k => Math.max.apply(null, [0].concat(g.filter(m=>!alias(m) && kind(m) === k).map(verOf)));
      const ver = m => alias(m) ? newest(kind(m)) : verOf(m);
      // newest version first; at the same version a named model before the -latest alias, and a stable one before a preview
      const score = m => [RANK[kind(m)], -ver(m), alias(m) ? 1 : 0, preview(m)];
      return g.sort((a, b)=>{ const x = score(a), y = score(b); for(let i = 0; i < x.length; i++) if(x[i] !== y[i]) return x[i] - y[i]; return a.localeCompare(b); });
    }
    if(id === 'anthropic'){ const t = m => /haiku/.test(m) ? (fast ? 0 : 1) : /sonnet/.test(m) ? (fast ? 1 : 0) : 2; return uniq.filter(m=>/^claude/.test(m) && !/opus/.test(m)).sort((a, b)=>t(a) - t(b) || b.localeCompare(a)); }
    if(id === 'ollama') return uniq.sort((a, b)=>fast ? (sizeB(a) || 99) - (sizeB(b) || 99) : (sizeB(b) || 0) - (sizeB(a) || 0));
    let list = uniq;
    if(id === 'openrouter') list = uniq.filter(m=>/:free$/.test(m) || m === 'openrouter/free');
    const ranked = list.filter(m=>m !== 'openrouter/free').sort(fast
      ? (a, b)=>prefIdx(a, FAST_PREFER) - prefIdx(b, FAST_PREFER) || (sizeB(a) || 50) - (sizeB(b) || 50)
      : (a, b)=>prefIdx(a) - prefIdx(b) || sizeB(b) - sizeB(a) || a.localeCompare(b));
    return id === 'openrouter' && list.indexOf('openrouter/free') >= 0 ? ranked.slice(0, 3).concat(['openrouter/free'], ranked.slice(3)) : ranked;
  }
  async function listModels(id, key){
    let res;
    if(id === 'gemini') res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(key));
    else if(id === 'anthropic') res = await fetch('https://api.anthropic.com/v1/models', {headers:{'x-api-key':key, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true'}});
    else if(id === 'ollama') res = await fetch(key.replace(/\/+$/, '') + '/api/tags');
    else res = await fetch(OPENAI_BASE[id] + '/models', {headers:{Authorization:'Bearer ' + key}});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    if(id === 'gemini') return (d.models || []).filter(m=>(m.supportedGenerationMethods || []).indexOf('generateContent') >= 0).map(m=>m.name.replace(/^models\//, ''));
    if(id === 'ollama') return (d.models || []).map(m=>m.name);
    return (d.data || []).map(m=>m.id);
  }
  /* What a key can use (asked once a day), ranked for the task. */
  async function bestModels(id, key, tier){
    const cache = lsGet(MODELS_KEY, {}), c = cache[id], tag = key.slice(-6);
    let names = c && c.key === tag && Date.now() - c.at < 86400000 && c.names && c.names.length ? c.names : null;
    if(!names){
      try{ names = await listModels(id, key); if(names.length){ cache[id] = {at: Date.now(), key: tag, names}; lsSet(MODELS_KEY, cache); } }catch(e){ names = null; }
    }
    const ranked = names ? rankModels(id, names, tier) : [];
    return ranked.length ? ranked : PROVIDERS.find(p=>p.id === id).models;
  }
  /* Which model answered last, per service and kind of task (tried first next time), and models a key cannot use (skipped for a day). */
  const WORKING_KEY = 'tripvault-ai-working', BAD_KEY = 'tripvault-ai-bad';
  function remember(id, tier, model){ const w = lsGet(WORKING_KEY, {}); w[id] = Object.assign({}, w[id], {[tier]: model, at: Date.now()}); lsSet(WORKING_KEY, w); }
  function markBad(id, model){ const b = lsGet(BAD_KEY, {}); b[id + '|' + model] = Date.now() + 86400000; lsSet(BAD_KEY, b); }
  const isBad = (id, model) => (lsGet(BAD_KEY, {})[id + '|' + model] || 0) > Date.now();
  /* What answers now, for the settings: [{id, name, model, resting}] in the order they are tried. */
  function aiStatus(){
    const s = aiSettings(), w = lsGet(WORKING_KEY, {});
    return usable(s).map(id=>({id, name: PROVIDERS.find(p=>p.id === id).name, model: (w[id] || {}).smart || '', resting: resting(id)}));
  }
  /* -> {text, sources, provider, model}. The best service first and its best model first (the one that answered
     last time, else the strongest the key can use), then the next model, then the next service - the way ATS picks.
     A service out of free quota rests 15 minutes. opts.tier: 'smart' (default) or 'fast'.
     opts.images: only services that can see are tried. opts.search: only Gemini (Google Search) is tried. */
  async function chat(system, turns, opts, signal){
    opts = opts || {};
    const tier = opts.tier === 'fast' ? 'fast' : 'smart';
    const s = aiSettings();
    let order = usable(s);
    if(opts.images && opts.images.length) order = order.filter(id=>PROVIDERS.find(p=>p.id === id).vision);
    if(opts.search) order = order.filter(id=>PROVIDERS.find(p=>p.id === id).search);
    if(!order.length) throw new Error(opts.search ? 'Web search needs a Google Gemini key (free) — add one in Settings → AI.'
      : opts.images ? 'Reading a picture needs a Gemini or Claude key.' : 'Add a free AI key in Settings → AI (or in the Expense Tracker).');
    const skipped = []; let lastError = null;
    const working = lsGet(WORKING_KEY, {});
    for(const id of order){
      const r = resting(id);
      if(r){ skipped.push(PROVIDERS.find(p=>p.id === id).name + ' is resting (' + r.why + ')'); continue; }
      const key = s.keys[id];
      const pinned = s.model[id] && s.model[id] !== 'auto' ? [s.model[id]] : [];
      const last = (working[id] || {})[tier];
      const models = Array.from(new Set(pinned.concat(last ? [last] : [], await bestModels(id, key, tier), PROVIDERS.find(p=>p.id === id).models)))
        .filter(m=>pinned.indexOf(m) >= 0 || !isBad(id, m)).slice(0, 5);
      for(const model of models){
        try{
          const out = await callOne(id, key, model, system, turns, opts, signal);
          remember(id, tier, model); wake(id);
          return Object.assign(out, {provider: PROVIDERS.find(p=>p.id === id).name, model});
        }catch(e){
          if(e.code === 'cancelled') throw e;
          lastError = e;
          if(!e.unavailable){ skipped.push(e.message); break; }        // the key itself was refused
          if(e.status === 404) markBad(id, model);                      // this key cannot use that model
          if(e.limit){ rest(id, e.message); break; }                    // out of free quota: next service
        }
      }
    }
    const why = skipped.concat(lastError && lastError.unavailable ? [lastError.message] : []);
    throw new Error('No AI service could answer' + (why.length ? ': ' + why.join('; ') : '') + '. Try again later or add another free key.');
  }
  /* The JSON inside an AI answer (it may wrap it in prose or ``` fences). */
  function json(text){
    const t = String(text || '').replace(/```(?:json)?/gi, '');
    const s = t.search(/[\[{]/);
    if(s < 0) throw new Error('The AI did not answer in the expected form.');
    const open = t[s], close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false;
    for(let i = s; i < t.length; i++){
      const c = t[i];
      if(inStr){ if(esc) esc = false; else if(c === '\\') esc = true; else if(c === '"') inStr = false; continue; }
      if(c === '"') inStr = true;
      else if(c === open) depth++;
      else if(c === close && --depth === 0) return JSON.parse(t.slice(s, i + 1));
    }
    throw new Error('The AI answer was cut off. Try again.');
  }

  const api = {expenseTracker, checkLogin, loginSource, sha256,
          syncConfig, saveSyncConfig, otherAppSync, syncNow, markSaved, forgetSync, uploadFile, downloadFile, deleteFile,
          PROVIDERS, loadAi, aiSettings, aiStatus, rankModels, shareableAi, takeSyncedAi, aiLocal, saveAiLocal, aiAvailable, aiNames, canSee, canSearch, resting, wake, chat, json, b64, unb64};
  /* The site's central AI (the AI hub on Money Home, /ai/ai.js) when it is loaded: one set of keys and the same
     choice of service and model for every app. This file's own copy is used only when it is missing (a local copy). */
  if(typeof MoneyAI !== 'undefined'){
    ['PROVIDERS', 'loadAi', 'aiSettings', 'aiLocal', 'saveAiLocal', 'aiStatus', 'rankModels', 'shareableAi', 'takeSyncedAi',
     'aiAvailable', 'aiNames', 'canSee', 'canSearch', 'resting', 'wake', 'chat', 'json'].forEach(k=>{ api[k] = MoneyAI[k]; });
    api.central = true;
  }
  return api;
})();
