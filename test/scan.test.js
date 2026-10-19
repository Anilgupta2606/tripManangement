/* Take a photo: the page is straightened only when its four corners make sense (a smudge, the whole frame or a
   twisted shape keeps the photo as it was), and the flat page keeps the page's own proportions. */
const test = require('node:test');
const assert = require('node:assert');
const Scan = require('../scan.js');

const q = (tl, tr, br, bl) => ({topLeftCorner: {x: tl[0], y: tl[1]}, topRightCorner: {x: tr[0], y: tr[1]}, bottomRightCorner: {x: br[0], y: br[1]}, bottomLeftCorner: bl && {x: bl[0], y: bl[1]}});

test('a page photographed at an angle is straightened; what is not a page is left alone', ()=>{
  assert.equal(Scan.goodCorners(q([120, 90], [780, 140], [820, 1100], [80, 1050]), 900, 1200), true, 'a tilted page');
  assert.equal(Scan.goodCorners(q([0, 0], [900, 0], [900, 1200], [0, 1200]), 900, 1200), false, 'the frame itself: no edge found');
  assert.equal(Scan.goodCorners(q([400, 400], [500, 400], [500, 500], [400, 500]), 900, 1200), false, 'a small thing in the picture');
  assert.equal(Scan.goodCorners(q([100, 100], [800, 100], [100, 1100], [800, 1100]), 900, 1200), false, 'corners crossed');
  assert.equal(Scan.goodCorners(q([100, 100], [800, 100], [800, 1100], undefined), 900, 1200), false, 'a corner missing');
  assert.equal(Scan.goodCorners(q([100, 100], [850, 100], [500, 1150], [450, 1100]), 900, 1200), false, 'twisted: one side far shorter than its opposite');
  assert.equal(Scan.goodCorners(null, 900, 1200), false);
});
test('the flat page keeps its proportions and is at most 2400 px', ()=>{
  assert.deepEqual(Scan.outSize(q([0, 0], [600, 0], [620, 850], [10, 840])), {w: 610, h: 850});
  const big = Scan.outSize(q([0, 0], [3000, 0], [3000, 4000], [0, 4000]));
  assert.deepEqual(big, {w: 1800, h: 2400});
});
test('OpenCV is waited for by polling, never awaited (its module resolves to itself: awaiting it froze the page)', ()=>{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'scan.js'), 'utf8');
  assert.doesNotMatch(src, /await\s+(window\.)?cv\b/);
  assert.match(src, /cdn\.jsdelivr\.net\/npm\/jscanify@[\d.]+\/src\//, 'jscanify and its OpenCV from jsDelivr, pinned');
  assert.match(src, /catch\(e\)\{ return null; \}/, 'any failure keeps the original photo');
});
