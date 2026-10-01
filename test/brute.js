// 暴力参考求解器：枚举所有装载方案，按 (配重数, 对径差和, 编号序列) 取最优。
// 仅用于测试交叉验证（小规模）。
export function bruteForce({ holes: H, maxMass, tolerance, tubes, counterweights }) {
  const half = H / 2;
  const EPS = 1e-9;
  // 展开配重为单枚
  const cwUnits = [];
  for (const c of counterweights) {
    if (c.mass > maxMass + EPS) continue;
    for (let i = 0; i < c.quantity; i++) cwUnits.push({ id: c.id, mass: c.mass });
  }
  const n = tubes.length;
  if (n > H) return { feasible: false };
  for (const t of tubes) {
    if (t.allowedHoles.length === 0 || t.mass > maxMass + EPS) return { feasible: false };
  }

  let best = null; // { cwCount, sum, seq }
  const assign = new Array(H).fill(null); // {kind:'tube'|'cw'|'empty', id, mass}
  const usedTube = new Array(n).fill(false);
  const usedCw = new Array(cwUnits.length).fill(false);

  function cmpSeq(a, b) {
    for (let i = 0; i < H; i++) {
      const ae = a[i].kind === 'empty';
      const be = b[i].kind === 'empty';
      if (ae && be) continue;
      if (ae) return 1; // 空孔视为最大
      if (be) return -1;
      if (a[i].id !== b[i].id) return a[i].id < b[i].id ? -1 : 1;
    }
    return 0;
  }

  function consider() {
    let cwCount = 0;
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const d = Math.abs(assign[i].mass - assign[i + half].mass);
      if (d > tolerance + EPS) return;
      sum += d;
    }
    for (const c of assign) if (c.kind === 'cw') cwCount++;
    const cand = { cwCount, sum, seq: assign.map((c) => ({ ...c })) };
    if (!best
      || cand.cwCount < best.cwCount
      || (cand.cwCount === best.cwCount && cand.sum < best.sum - EPS)
      || (cand.cwCount === best.cwCount && Math.abs(cand.sum - best.sum) <= EPS && cmpSeq(cand.seq, best.seq) < 0)) {
      best = cand;
    }
  }

  function dfs(h, tubesLeft) {
    if (h === H) {
      if (tubesLeft === 0) consider();
      return;
    }
    // 对径约束剪枝：后半孔位放置时立即校验（参考实现同样正确优先）
    const tryPlace = (cell, undo) => {
      assign[h] = cell;
      const ok = h < half || Math.abs(assign[h].mass - assign[h - half].mass) <= tolerance + EPS;
      if (ok) dfs(h + 1, tubesLeft - (cell.kind === 'tube' ? 1 : 0));
      undo();
    };
    // 空孔
    tryPlace({ kind: 'empty', id: null, mass: 0 }, () => {});
    // 离心管
    for (let i = 0; i < n; i++) {
      if (usedTube[i] || !tubes[i].allowedHoles.includes(h + 1)) continue;
      usedTube[i] = true;
      tryPlace({ kind: 'tube', id: tubes[i].id, mass: tubes[i].mass }, () => { usedTube[i] = false; });
    }
    // 配重（逐枚，保证“每枚最多一次”）
    for (let j = 0; j < cwUnits.length; j++) {
      if (usedCw[j]) continue;
      usedCw[j] = true;
      tryPlace({ kind: 'cw', id: cwUnits[j].id, mass: cwUnits[j].mass }, () => { usedCw[j] = false; });
    }
    assign[h] = null;
  }
  dfs(0, n);

  if (!best) return { feasible: false };
  return { feasible: true, cwCount: best.cwCount, sumDiffs: best.sum, seq: best.seq };
}
