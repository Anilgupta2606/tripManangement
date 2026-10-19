"use strict";
/* =========================================================
   SCAN — a photo of a paper document made flat: its edges found and the page straightened (jscanify on OpenCV.js),
   the way a scanner app does. Only for "Take a photo"; loaded then (OpenCV is ~9 MB, kept by the browser after the
   first time). Whatever goes wrong (offline, an old phone, no clear page in the picture) the original photo is kept.
     await Scan.straighten(canvas) -> a new canvas with the page, or null
   ========================================================= */
const Scan = (function(){
  const BASE = 'https://cdn.jsdelivr.net/npm/jscanify@1.4.3/src/';      // jscanify and the OpenCV.js build made for it
  const DETECT_SIDE = 900, OUT_SIDE = 2400;

  /* The corners found: all four, inside the picture, a convex four-sided shape that is most of a page in size
     (not a smudge, not just the whole frame) and not twisted. Points are {x, y}. */
  function goodCorners(c, w, h){
    if(!c) return false;
    const P = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner];
    if(P.some(p=>!p || !isFinite(p.x) || !isFinite(p.y) || p.x < -2 || p.y < -2 || p.x > w + 2 || p.y > h + 2)) return false;
    let area = 0, sign = 0;
    for(let i = 0; i < 4; i++){
      const a = P[i], b = P[(i + 1) % 4], d = P[(i + 2) % 4];
      area += a.x * b.y - b.x * a.y;
      const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
      if(Math.abs(cross) < 1e-6) return false;
      if(sign && Math.sign(cross) !== sign) return false;                // not convex
      sign = Math.sign(cross);
    }
    const share = Math.abs(area) / 2 / (w * h);
    if(share < 0.2) return false;                                        // a small thing in the picture: not the page
    // the frame itself (no edge found): nothing to straighten
    const near = (p, x, y) => Math.hypot(p.x - x, p.y - y) < Math.min(w, h) * 0.02;
    if(near(P[0], 0, 0) && near(P[1], w, 0) && near(P[2], w, h) && near(P[3], 0, h)) return false;
    // opposite sides of similar length (a twisted shape is a wrong detection)
    const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const r1 = len(P[0], P[1]) / len(P[3], P[2]), r2 = len(P[0], P[3]) / len(P[1], P[2]);
    return r1 > 0.5 && r1 < 2 && r2 > 0.5 && r2 < 2;
  }
  /* The flat page's size: the longer of each pair of opposite sides, at most OUT_SIDE */
  function outSize(c, k){
    const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let w = Math.max(len(c.topLeftCorner, c.topRightCorner), len(c.bottomLeftCorner, c.bottomRightCorner));
    let h = Math.max(len(c.topLeftCorner, c.bottomLeftCorner), len(c.topRightCorner, c.bottomRightCorner));
    const s = Math.min(1, (k || OUT_SIDE) / Math.max(w, h));
    return {w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s))};
  }
  const scale = (c, k) => { const o = {}; for(const n in c) o[n] = {x: c[n].x * k, y: c[n].y * k}; return o; };

  let ready = null;
  function load(){
    if(ready) return ready;
    ready = (async ()=>{
      await Lib.script(BASE + 'opencv.js', ()=>window.cv && window.cv.Mat);
      // OpenCV starts its WebAssembly after the script loads: wait until it is ready. (The module is never awaited: it
      // is a "thenable" that resolves to itself, which loops for ever and freezes the page.)
      await new Promise((res, rej)=>{ const t0 = Date.now(), tick = () => { const cv = window.cv;
        if(cv && cv.Mat && cv.imread) return res();
        if(Date.now() - t0 > 30000) return rej(new Error('OpenCV did not start'));
        setTimeout(tick, 100); }; tick(); });
      await Lib.script(BASE + 'jscanify.js', ()=>window.jscanify);
      return new window.jscanify();
    })();
    ready.catch(()=>{ ready = null; });                                         // offline now: try again next time
    return ready;
  }

  /* canvas -> the page, straightened (a new canvas), or null to keep the photo as it is */
  async function straighten(canvas, opts){
    opts = opts || {};
    try{
      const scanner = await Promise.race([load(), new Promise((_, rej)=>setTimeout(()=>rej(new Error('slow')), opts.timeoutMs || 60000))]);
      const cv = window.cv;
      // edges are found on a small copy (fast, little memory on a phone), the page cut from the full photo
      const k = Math.min(1, DETECT_SIDE / Math.max(canvas.width, canvas.height));
      const small = document.createElement('canvas'); small.width = Math.round(canvas.width * k); small.height = Math.round(canvas.height * k);
      small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
      const img = cv.imread(small);
      let corners = null, contour = null;
      try{ contour = scanner.findPaperContour(img); if(contour) corners = scanner.getCornerPoints(contour, img); }
      finally{ img.delete(); if(contour && contour.delete) try{ contour.delete(); }catch(e){} }
      if(!goodCorners(corners, small.width, small.height)) return null;
      const full = scale(corners, 1 / k), size = outSize(full);
      const out = scanner.extractPaper(canvas, size.w, size.h, full);
      return out && out.width > 50 && out.height > 50 ? out : null;
    }catch(e){ return null; }
  }
  return {straighten, goodCorners, outSize, load};
})();
if(typeof module !== 'undefined') module.exports = Scan;
