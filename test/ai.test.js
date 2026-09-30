const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), vm = require('vm');
const store = {};
const ctx = {window: {}, localStorage: {getItem: k=>store[k] || null, setItem: (k, v)=>{ store[k] = v; }, removeItem: k=>{ delete store[k]; }}, location: {origin: 'x'}, console};
vm.runInNewContext(fs.readFileSync(__dirname + '/../cloud.js', 'utf8') + '\nthis.Cloud = Cloud;', ctx);
const C = ctx.Cloud;
const GEMINI = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite',
  'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3-pro-preview', 'gemini-embedding-001', 'gemini-2.5-flash-preview-tts', 'deep-research-preview-04-2026'];

test('gemini: the newest flash first for smart tasks, the newest lite first for fast ones (as ATS found)', ()=>{
  const smart = C.rankModels('gemini', GEMINI, 'smart'), fast = C.rankModels('gemini', GEMINI, 'fast');
  assert.equal(smart[0], 'gemini-3-flash-preview');
  assert.equal(fast[0], 'gemini-3.5-flash-lite');
  assert.ok(!smart.some(m=>/embedding|tts|research/.test(m)));
  assert.ok(smart.indexOf('gemini-2.5-flash') < smart.indexOf('gemini-2.5-flash-lite'));
});

test('other services: strongest for smart, smallest for fast; paid Claude last in the order', ()=>{
  const g = ['llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'whisper-large-v3'];
  assert.equal(C.rankModels('groq', g, 'smart')[0], 'openai/gpt-oss-120b');
  assert.equal(C.rankModels('groq', g, 'fast')[0], 'openai/gpt-oss-20b');       // what ATS found for Groq
  const ids = Array.from(C.PROVIDERS, p=>p.id);
  assert.deepEqual(ids, ['gemini', 'groq', 'cerebras', 'mistral', 'openrouter', 'ollama', 'anthropic']);
});

test('first choice and fallback', ()=>{
  store['tripvault-ai'] = JSON.stringify({keys: {gemini: 'g', groq: 'q', mistral: 'm'}, order: [], off: []});
  assert.deepEqual(Array.from(C.aiStatus(), x=>x.id), ['gemini', 'groq', 'mistral']);
  store['tripvault-ai'] = JSON.stringify({keys: {gemini: 'g', groq: 'q', mistral: 'm'}, order: [], off: [], first: 'mistral'});
  assert.deepEqual(Array.from(C.aiStatus(), x=>x.id), ['mistral', 'gemini', 'groq']);
  store['tripvault-ai'] = JSON.stringify({keys: {gemini: 'g', groq: 'q', mistral: 'm'}, order: [], off: [], first: 'mistral', fallback: false});
  assert.deepEqual(Array.from(C.aiStatus(), x=>x.id), ['mistral']);
});

test('a web search that is optional: Gemini at its free limit, so Groq answers', async ()=>{
  store['tripvault-ai'] = JSON.stringify({keys: {gemini: 'g', groq: 'q'}, order: [], off: []});
  store['tripvault-ai-rest'] = JSON.stringify({});
  const calls = [];
  ctx.fetch = async (url, init) => {
    calls.push(url);
    if(/\/models/.test(url) && !init) return {ok: false, status: 500, json: async ()=>({}), text: async ()=>''};    // model lists: use the built-in ones
    if(/generativelanguage/.test(url)) return {ok: false, status: 429, text: async ()=>'quota exhausted', json: async ()=>({})};
    return {ok: true, status: 200, json: async ()=>({choices: [{message: {content: '{"status":"clear"}'}}]}), text: async ()=>''};
  };
  Object.assign(ctx, {AbortController, setTimeout, clearTimeout, JSON});
  const r = await C.chat('brief', [{role: 'user', content: 'Dubai'}], {search: true, searchOptional: true});
  assert.equal(r.provider, 'Groq');
  assert.equal(r.noSearch, true);
  assert.ok(calls.some(u=>/generativelanguage/.test(u)), 'Gemini was tried first');
  // Gemini is now resting: the next request goes straight to Groq
  const r2 = await C.chat('brief', [{role: 'user', content: 'Dubai'}], {search: true, searchOptional: true});
  assert.equal(r2.provider, 'Groq');
  // a search that is required still says what is missing
  await assert.rejects(C.chat('flight', [{role: 'user', content: '6E1461'}], {search: true}), /resting|Gemini/);
});

test('a model on this computer: the light one first, for every kind of task', ()=>{
  const names = ['qwen3:8b', 'gemma3:4b', 'qwen3:4b', 'llama3.1:8b'];
  assert.equal(C.rankModels('ollama', names, 'smart')[0], 'gemma3:4b');
  assert.equal(C.rankModels('ollama', names, 'fast')[0], 'gemma3:4b');
  assert.equal(C.rankModels('ollama', ['qwen3:8b', 'llama3.1:8b', 'phi3:3.8b'], 'smart')[0], 'phi3:3.8b');
});
