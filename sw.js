/* Offline: the app itself is kept, so tickets already on this device open at the airport without a signal.
   Pages and code: network first (always the latest when online), cache when offline.
   Libraries from CDNs (pdf.js, OCR): cached once used. Nothing personal passes through here. */
const CACHE = 'trip-vault-v5';
const SHELL = ['./', 'index.html', 'style.css', 'parse.js', 'rules.js', 'cloud.js', 'services.js', 'core.js', 'docs.js', 'plan.js', 'checklist.js', 'live.js', 'shopping.js',
  'data/airports.json', 'data/airlines.json', 'icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k !== CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e=>{
  const u = new URL(e.request.url);
  if(e.request.method !== 'GET') return;
  const same = u.origin === location.origin;
  const lib = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(u.host);
  if(!same && !lib) return;                       // APIs, GitHub, AI: never cached
  if(lib){
    e.respondWith(caches.match(e.request).then(hit=>hit || fetch(e.request).then(res=>{ if(res.ok || res.type === 'opaque'){ const cp = res.clone(); caches.open(CACHE).then(c=>c.put(e.request, cp)); } return res; })));
    return;
  }
  // always ask the server first (no-cache: a quick "has it changed?"), so a new version shows on the next open
  e.respondWith(fetch(e.request, {cache: 'no-cache'}).then(res=>{ if(res.ok){ const cp = res.clone(); caches.open(CACHE).then(c=>c.put(e.request, cp)); } return res; })
    .catch(()=>caches.match(e.request).then(hit=>hit || caches.match('index.html'))));
});
