const test = require('node:test');
const assert = require('node:assert/strict');
const { titleProblems, cleanTitleInfo } = require('../functions/catalog-sync.js');

test('clones, accessories and parts are rejected', () => {
  const rejects = [
    ['For Milwaukee M18 Fuel 18V Battery Brushless 12 in Cordless Chainsaw (Tool Only)', 'milwaukee m18 tool only', ''],
    ['For Dyson V8 Absolute 21.6V 6400mAh Cordless Vacuum Cleaner Li-ion SV10', 'dyson v8', ''],
    ['Rockville Folding Laptop+Recording Interface Stand For Focusrite SCARLETT 2i2', 'focusrite scarlett', 'Rockville'],
    ['Generic Mechanical Keyboard 61 Keys', 'mechanical keyboard', 'Unbranded'],
    ['Mouse Pad XL for Logitech G Pro', 'wireless gaming mouse', 'Generic'],
    ['Anker 737 Charger 120W', 'belkin charger', 'Anker']
  ];
  for (const [t, kw, b] of rejects) assert.ok(titleProblems(t, kw, b).length > 0, t);
});

test('real products pass', () => {
  const accepts = [
    ['Milwaukee 2719-20 M18 FUEL Hackzall (Tool Only)', 'milwaukee m18 tool only', 'Milwaukee'],
    ['Dyson V8 Absolute Cordless Vacuum - Refurbished', 'dyson v8', 'Dyson'],
    ['Focusrite Scarlett 2i2 3rd Gen USB Audio Interface with cable', 'focusrite scarlett', 'Focusrite'],
    ['Anker 20,000 mAh 15W 2-Port Portable Charger Power Bank', 'anker power bank', 'Anker'],
    ['Keychron K2 Pro Wireless Mechanical Keyboard RGB Hot-swappable', 'mechanical keyboard', 'Keychron'],
    ['Anker PowerCore 20000 Portable Charger', '', 'Anker']
  ];
  for (const [t, kw, b] of accepts) assert.deepEqual(titleProblems(t, kw, b), [], t);
});

test('titles are cleaned into product names', () => {
  assert.equal(cleanTitleInfo('Milwaukee 2719-20 M18 FUEL Hackzall (Tool Only)').name, 'Milwaukee 2719-20 M18 FUEL Hackzall');
  assert.equal(cleanTitleInfo('Milwaukee 2719-20 M18 FUEL Hackzall (Tool Only)').toolOnly, true);
  assert.equal(cleanTitleInfo('NEW SEALED LEGO 40774 Classic Animation Scenes - RETIRED Disney').name, 'LEGO 40774 Classic Animation Scenes - Disney');
  assert.equal(cleanTitleInfo('SONY WH-1000XM4 WIRELESS NOISE CANCELLING HEADPHONES BLACK - FREE SHIPPING!!!').name, 'Sony WH-1000XM4 Wireless Noise Cancelling Headphones Black');
  assert.ok(!/\($/.test(cleanTitleInfo('A very long product title that goes on and on and on and on and on (Tool Only) more words here').name));
});
