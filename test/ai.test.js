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
