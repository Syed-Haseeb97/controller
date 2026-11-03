// Run: node tools/protocol_tests.mjs   (Node >= 22.18 strips TypeScript types natively)
import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeStick, DEFAULT_STICK_CONFIG } from '../web simulator/src/protocol/stickMath.ts';
import { validateProfileJson } from '../web simulator/src/protocol/profileSchema.ts';

test('stick deadzone swallows small input', () => {
  assert.deepEqual(shapeStick(0.05, 0.02, DEFAULT_STICK_CONFIG), [0, 0]);
});
test('stick full deflection reaches 1 on the rim', () => {
  const [x, y] = shapeStick(1, 0, DEFAULT_STICK_CONFIG);
  assert.ok(Math.abs(x - 1) < 1e-9 && y === 0);
});
test('outer zone makes partial travel reach 100%', () => {
  const [x] = shapeStick(0.8, 0, { ...DEFAULT_STICK_CONFIG, outerZone: 0.8 });
  assert.ok(Math.abs(x - 1) < 1e-9);
});
test('quadratic curve is gentler mid-travel than linear', () => {
  const lin = shapeStick(0.5, 0, DEFAULT_STICK_CONFIG)[0];
  const quad = shapeStick(0.5, 0, { ...DEFAULT_STICK_CONFIG, curve: 'QUADRATIC' })[0];
  assert.ok(quad < lin);
});
test('invertY flips vertical axis only', () => {
  const [x, y] = shapeStick(0, 1, { ...DEFAULT_STICK_CONFIG, invertY: true });
  assert.ok(x === 0 && y < -0.99);
});
const good = { schema: 1, elements: [{ id: 'a', normX: 0.5, normY: 0.5, target: 'BTN_CROSS' }] };
test('valid profile passes', () => assert.equal(validateProfileJson(JSON.stringify(good)).ok, true));
test('bad JSON rejected with message', () => assert.equal(validateProfileJson('{').ok, false));
test('unknown target rejected', () => {
  const r = validateProfileJson(JSON.stringify({ elements: [{ id: 'a', normX: 0, normY: 0, target: 'NOPE' }] }));
  assert.equal(r.ok, false);
});
test('duplicate ids rejected', () => {
  const el = { id: 'a', normX: 0, normY: 0, target: 'BTN_L1' };
  assert.equal(validateProfileJson(JSON.stringify({ elements: [el, el] })).ok, false);
});
test('newer schema rejected', () => assert.equal(validateProfileJson(JSON.stringify({ ...good, schema: 99 })).ok, false));
test('out-of-range position yields warning, not error', () => {
  const r = validateProfileJson(JSON.stringify({ elements: [{ id: 'a', normX: 2, normY: 0, target: 'BTN_L1' }] }));
  assert.ok(r.ok && r.warnings.length === 1);
});
