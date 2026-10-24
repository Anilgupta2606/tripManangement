/* Food to try (food.js): an entry is a dish, a restaurant, or a dish at a restaurant, and reads as such. */
const test = require('node:test');
const assert = require('node:assert');
global.VIEWS = {};                 // the page's view table, which food.js adds its tab to
const F = require('../food.js');

test('food to try: food, restaurant, or a dish at a restaurant', ()=>{
  assert.deepEqual(Object.values(F.FOOD_KINDS), ['Food', 'Restaurant', 'Food at a restaurant']);
  assert.equal(F.foodTitle(Object.assign({}, F.foodEntry('food', 'Shawarma', 'ignored'))), 'Shawarma');
  assert.deepEqual(F.foodEntry('food', 'Shawarma', 'x'), {kind: 'food', dish: 'Shawarma', place: ''}, 'a dish keeps no restaurant');
  assert.equal(F.foodTitle(F.foodEntry('restaurant', 'Al Fanar')), 'Al Fanar');
  assert.equal(F.foodTitle(F.foodEntry('both', 'Al Machboos', 'Al Fanar')), 'Al Machboos at Al Fanar');
});
