import test from 'node:test';
import assert from 'node:assert/strict';
import { solveRotor } from '../src/solver.js';

const base = { holes: 4, maxMass: 100, tolerance: 0, tubes: [], counterweights: [] };
const tube = (id, mass, allowedHoles = [1, 2, 3, 4]) => ({ id, mass, allowedHoles });
const cw = (id, mass, quantity) => ({ id, mass, quantity });

test('对径放置使对径差之和最小，空孔按零计', () => {
  const r = solveRotor({ ...base, tolerance: 1, tubes: [tube('A', 10), tube('B', 10.5)] });
  assert.equal(r.feasible, true);
  assert.equal(r.cwCount, 0);
  assert.ok(Math.abs(r.sumDiffs - 0.5) < 1e-9);
  // 并列规则：编号序列最小 => A@1、B@3
  assert.equal(r.plan[0].id, 'A');
  assert.equal(r.plan[2].id, 'B');
  assert.equal(r.plan[1].type, 'empty');
  assert.equal(r.plan[3].type, 'empty');
});

test('等质量离心管对径放置，对径差为 0', () => {
  const r = solveRotor({ ...base, tolerance: 10, tubes: [tube('A', 5), tube('B', 5)] });
  assert.equal(r.feasible, true);
  assert.equal(r.sumDiffs, 0);
  assert.equal(r.plan[0].id, 'A');
  assert.equal(r.plan[2].id, 'B');
});

test('必须使用配重时取最小数量，同分时物件优先小编号孔位', () => {
  const r = solveRotor({
    ...base, tolerance: 0.5,
    tubes: [tube('A', 10)],
    counterweights: [cw('C', 10, 1)],
  });
  assert.equal(r.feasible, true);
  assert.equal(r.cwCount, 1);
  assert.equal(r.sumDiffs, 0);
  // 序列字典序最小（空孔视为最大）：[A, '', C, ''] => A@1、C@3
  assert.equal(r.plan[0].id, 'A');
  assert.equal(r.plan[2].id, 'C');
  assert.equal(r.plan[1].type, 'empty');
  assert.equal(r.plan[3].type, 'empty');
});

test('配重数量最少优先于对径差之和最小', () => {
  // k=1 时 C(6) 可得和 4，D(10) 可得和 0；两者同为 1 枚，应选和更小者（D）
  const r = solveRotor({
    ...base, tolerance: 5,
    tubes: [tube('A', 10)],
    counterweights: [cw('C', 6, 1), cw('D', 10, 1)],
  });
  assert.equal(r.feasible, true);
  assert.equal(r.cwCount, 1);
  assert.equal(r.sumDiffs, 0);
  assert.equal(r.plan[2].id, 'D');
});

test('每枚配重最多用一次：数量不足则无解，补足后可解', () => {
  const input = {
    ...base, tolerance: 0.5,
    tubes: [tube('A', 10, [1]), tube('B', 20, [2])],
    counterweights: [cw('C', 10, 1)],
  };
  assert.equal(solveRotor(input).feasible, false);
  const r2 = solveRotor({ ...input, counterweights: [cw('C', 10, 1), cw('D', 20, 1)] });
  assert.equal(r2.feasible, true);
  assert.equal(r2.cwCount, 2);
  assert.equal(r2.sumDiffs, 0);
});

test('同质量配重有多个编号时优先使用小编号', () => {
  const r = solveRotor({
    ...base, tolerance: 0.5,
    tubes: [tube('A', 10)],
    counterweights: [cw('Y', 10, 1), cw('X', 10, 1)],
  });
  assert.equal(r.feasible, true);
  assert.equal(r.plan[2].id, 'X');
});

test('离心管数量超过孔位数 => 无解', () => {
  const r = solveRotor({
    ...base,
    tubes: [tube('A', 1), tube('B', 1), tube('C', 1), tube('D', 1), tube('E', 1)],
  });
  assert.equal(r.feasible, false);
  assert.match(r.reason, /超过/);
});

test('对径差超容差且无配重可用 => 无解（空孔按零计）', () => {
  const r = solveRotor({ holes: 6, maxMass: 100, tolerance: 0.1, tubes: [tube('A', 5, [1])], counterweights: [] });
  assert.equal(r.feasible, false);
});

test('可用孔位受限时遵守限制', () => {
  const r = solveRotor({ ...base, tolerance: 100, tubes: [tube('A', 5, [2])] });
  assert.equal(r.feasible, true);
  assert.equal(r.plan[1].id, 'A');
  assert.equal(r.sumDiffs, 5); // 对径孔 4 为空，按零计
});

test('无离心管时全空即为最优', () => {
  const r = solveRotor({ ...base, tubes: [], counterweights: [cw('C', 1, 3)] });
  assert.equal(r.feasible, true);
  assert.equal(r.cwCount, 0);
  assert.equal(r.sumDiffs, 0);
});

test('12 孔多管场景可求解', () => {
  const tubes = Array.from({ length: 6 }, (_, i) => ({
    id: `T${i + 1}`,
    mass: 10 + i * 0.1,
    allowedHoles: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  }));
  const r = solveRotor({
    holes: 12, maxMass: 50, tolerance: 0.15,
    tubes,
    counterweights: [{ id: 'W', mass: 10.2, quantity: 6 }],
  });
  assert.equal(r.feasible, true);
  assert.equal(r.plan.length, 12);
  for (const p of r.pairs) assert.ok(p.diff <= 0.15 + 1e-9);
});
