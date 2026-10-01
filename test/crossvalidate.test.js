// 随机交叉验证：主求解器 vs 暴力参考，目标三元组（配重数、对径差和、编号序列）必须一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { solveRotor } from '../src/solver.js';
import { bruteForce } from './brute.js';

// 可复现的伪随机数
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function seqOf(result) {
  // 主求解器 plan -> 与暴力 seq 可比较的形式
  return result.plan.map((c) => (c.type === 'empty' ? '' : c.id)).join('|');
}

function bruteSeqOf(result) {
  return result.seq.map((c) => (c.kind === 'empty' ? '' : c.id)).join('|');
}

test('随机小规模交叉验证（250 例）', () => {
  const rand = rng(20261001);
  const masses = [2, 3.5, 5, 7.25, 10, 12.5];
  for (let caseNo = 0; caseNo < 250; caseNo++) {
    const H = [4, 6][Math.floor(rand() * 2)];
    const maxMass = 20;
    const tolerance = Math.floor(rand() * 4) * 0.5; // 0 / 0.5 / 1 / 1.5
    const nT = Math.floor(rand() * (H + 1)); // 0..H
    const tubes = [];
    const usedIds = new Set();
    for (let i = 0; i < nT; i++) {
      let id;
      do { id = `T${Math.floor(rand() * 6)}`; } while (usedIds.has(id));
      usedIds.add(id);
      const mass = masses[Math.floor(rand() * masses.length)];
      // 随机可用孔位子集（至少 1 个）
      const allowed = [];
      for (let h = 1; h <= H; h++) if (rand() < 0.7) allowed.push(h);
      if (allowed.length === 0) allowed.push(1 + Math.floor(rand() * H));
      tubes.push({ id, mass, allowedHoles: allowed });
    }
    const cws = [];
    const nC = Math.floor(rand() * 3); // 0..2 种配重
    for (let i = 0; i < nC; i++) {
      cws.push({
        id: `W${i}`,
        mass: masses[Math.floor(rand() * masses.length)],
        quantity: Math.floor(rand() * 3), // 0..2 枚
      });
    }
    const input = { holes: H, maxMass, tolerance, tubes, counterweights: cws };
    const got = solveRotor(input);
    const want = bruteForce(input);
    assert.equal(got.feasible, want.feasible,
      `案例 ${caseNo} 可行性不一致: ${JSON.stringify(input)}`);
    if (want.feasible) {
      assert.equal(got.cwCount, want.cwCount, `案例 ${caseNo} 配重数不一致`);
      assert.ok(Math.abs(got.sumDiffs - want.sumDiffs) < 1e-9,
        `案例 ${caseNo} 对径差和不一致: ${got.sumDiffs} vs ${want.sumDiffs}`);
      assert.equal(seqOf(got), bruteSeqOf(want), `案例 ${caseNo} 编号序列不一致`);
    }
  }
});
