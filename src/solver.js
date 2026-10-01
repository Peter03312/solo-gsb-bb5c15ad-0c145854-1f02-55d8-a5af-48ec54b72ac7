// 装载求解器：在转子孔位上安排全部离心管与可选配重块。
//
// 约束：
//   - 每孔最多一件物件；所有离心管必须装入；每枚配重最多用一次；
//   - 每对对径孔（i 与 i+H/2）的质量差不得超过容差，空孔按零计。
// 目标（按优先级）：
//   1. 配重块使用数量最少；
//   2. 各对径差之和最小；
//   3. 同分时按孔位 1..H 的物件编号序列取字典序最小；
//      空孔视为“最大”（同分时物件优先占据小编号孔位）。
//
// 实现：按对径孔对 (p, p+H/2) 逐对深度优先搜索 + 剪枝。
//   - 外层按配重预算 k = 0,1,2,... 递增，首个可行 k 即配重数最少；
//   - 每对孔位枚举有序放置（前半孔 × 后半孔），对径差立即校验；
//   - 已知最佳 (和, 序列) 后：部分和严格更劣即剪枝；
//     部分和只能持平且孔位 1..p 前缀字典序已劣亦剪枝
//     （孔对按 p 递增分配，孔 1..p 构成序列前缀，可安全比较）；
//   - 配重按质量分组，同质量的不同编号按升序、占用时优先小编号，
//     与并列规则的贪心选择一致。

const EPS = 1e-9;
const NODE_CAP = 5_000_000; // 搜索节点上限，防止极端输入下长时间占用

function cmpId(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}

const EMPTY_CELL = Object.freeze({ kind: 'empty', id: null, mass: 0 });

// 序列元素比较：空孔视为最大，其余按编号字典序
function cmpCell(a, b) {
  const ae = a.kind === 'empty';
  const be = b.kind === 'empty';
  if (ae && be) return 0;
  if (ae) return 1;
  if (be) return -1;
  return cmpId(a.id, b.id);
}

export function solveRotor({ holes, maxMass, tolerance, tubes, counterweights }) {
  const H = holes;
  const half = H / 2;
  const n = tubes.length;

  if (n > H) {
    return { feasible: false, reason: `离心管数量（${n}）超过转子孔位数（${H}）` };
  }
  for (const t of tubes) {
    if (!t.allowedHoles || t.allowedHoles.length === 0) {
      return { feasible: false, reason: `离心管「${t.id}」没有可用孔位` };
    }
    if (!(t.mass <= maxMass + EPS)) {
      return { feasible: false, reason: `离心管「${t.id}」的质量（${t.mass}）超过单孔最大质量（${maxMass}）` };
    }
  }

  // 配重按质量分组；同质量的条目按编号升序，使用时优先小编号
  const groupMap = new Map();
  for (const cw of counterweights) {
    if (cw.quantity <= 0) continue;
    if (cw.mass > maxMass + EPS) continue; // 超过单孔上限的配重无法使用
    let g = groupMap.get(cw.mass);
    if (!g) {
      g = { mass: cw.mass, entries: [] };
      groupMap.set(cw.mass, g);
    }
    g.entries.push({ id: cw.id, remaining: cw.quantity });
  }
  const groups = [...groupMap.values()];
  for (const g of groups) g.entries.sort((a, b) => cmpId(a.id, b.id));
  const totalCw = groups.reduce((s, g) => s + g.entries.reduce((a, e) => a + e.remaining, 0), 0);

  const allowedSets = tubes.map((t) => new Set(t.allowedHoles));

  // seqAt[h]：孔位 h（1..H）当前放置的物件
  const seqAt = new Array(H + 1).fill(null);
  const placed = new Array(n).fill(false);
  let usedCw = 0;
  let partial = 0;
  let best = null; // { sum, seq }，seq 为孔 1..H 的物件数组（0 起始）
  let nodes = 0;
  let aborted = false;

  const maxK = Math.min(totalCw, H - n);
  for (let k = 0; k <= maxK; k++) {
    best = null;
    partial = 0;
    usedCw = 0;
    aborted = false;
    dfs(1, k);
    if (aborted) {
      return { feasible: false, aborted: true, reason: '搜索规模超出计算预算，请减少离心管或配重数量' };
    }
    if (best) return buildResult(best);
  }
  return { feasible: false, reason: '在当前离心管、配重与容差条件下不存在可行装载方案' };

  function firstRemaining(group) {
    return group.entries.find((e) => e.remaining > 0) || null;
  }

  // 孔位 h 当前的候选物件（按编号升序，空孔最后）
  function holeOptions(h, budget) {
    const opts = [];
    for (let i = 0; i < n; i++) {
      if (!placed[i] && allowedSets[i].has(h)) {
        opts.push({ kind: 'tube', id: tubes[i].id, mass: tubes[i].mass, ti: i, gi: -1, entry: null });
      }
    }
    if (usedCw < budget) {
      for (let gi = 0; gi < groups.length; gi++) {
        const e = firstRemaining(groups[gi]);
        if (e) opts.push({ kind: 'cw', id: e.id, mass: groups[gi].mass, ti: -1, gi, entry: null });
      }
    }
    opts.sort((a, b) => cmpId(a.id, b.id));
    opts.push({ kind: 'empty', id: null, mass: 0, ti: -1, gi: -1, entry: null });
    return opts;
  }

  function place(opt, h) {
    if (opt.kind === 'tube') placed[opt.ti] = true;
    else if (opt.kind === 'cw') {
      opt.entry = firstRemaining(groups[opt.gi]);
      opt.entry.remaining--;
      usedCw++;
    }
    seqAt[h] = opt.kind === 'empty' ? EMPTY_CELL : { kind: opt.kind, id: opt.id, mass: opt.mass };
  }

  function unplace(opt, h) {
    if (opt.kind === 'tube') placed[opt.ti] = false;
    else if (opt.kind === 'cw') {
      opt.entry.remaining++;
      opt.entry = null;
      usedCw--;
    }
    seqAt[h] = null;
  }

  // 完成第 p 对后，未放置的离心管是否仍可能全部放入剩余孔位
  function placeable(p) {
    let unplaced = 0;
    for (let i = 0; i < n; i++) if (!placed[i]) unplaced++;
    if (unplaced > 2 * (half - p)) return false;
    for (let i = 0; i < n; i++) {
      if (placed[i]) continue;
      let ok = false;
      for (const h of tubes[i].allowedHoles) {
        if ((h <= half && h > p) || (h > half && h > half + p)) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  }

  // 孔 1..p 前缀是否已字典序劣于已知最佳（best 非空时调用）
  function prefixGreater(p) {
    for (let i = 1; i <= p; i++) {
      const c = cmpCell(seqAt[i], best.seq[i - 1]);
      if (c > 0) return true;
      if (c < 0) return false;
    }
    return false;
  }

  function leaf() {
    const sum = partial;
    if (best === null || sum < best.sum - EPS) {
      best = { sum, seq: seqAt.slice(1) };
      return;
    }
    if (sum <= best.sum + EPS) {
      // 与已知最佳同和（EPS 内）：完整序列字典序更小才替换
      for (let i = 1; i <= H; i++) {
        const c = cmpCell(seqAt[i], best.seq[i - 1]);
        if (c < 0) { best = { sum, seq: seqAt.slice(1) }; return; }
        if (c > 0) return;
      }
    }
  }

  function dfs(p, budget) {
    if (aborted) return;
    if (++nodes > NODE_CAP) { aborted = true; return; }
    if (best !== null && partial > best.sum + EPS) return; // 部分和只会递增
    if (p > half) { leaf(); return; }

    const ph = p + half;
    const xs = holeOptions(p, budget);
    for (const x of xs) {
      place(x, p);
      // 孔 1..p 前缀是否已字典序劣于已知最佳（best 改善后偏保守，安全）
      const prefixWorse = best !== null && prefixGreater(p);
      // 前缀已劣且部分和（未含本对）已不可能更优 => 整支无望
      if (!(prefixWorse && partial > best.sum - EPS)) {
        const ys = holeOptions(ph, budget); // 在 x 放置之后生成，天然排除已占用物件
        for (const y of ys) {
          const diff = Math.abs(x.mass - y.mass);
          if (diff > tolerance + EPS) continue;
          place(y, ph);
          partial += diff;
          // 和严格更劣，或前缀已劣且和只能持平 => 剪枝
          const hopeless = best !== null
            && (partial > best.sum + EPS || (prefixWorse && partial > best.sum - EPS));
          if (!hopeless && placeable(p)) dfs(p + 1, budget);
          partial -= diff;
          unplace(y, ph);
          if (aborted) return;
        }
      }
      unplace(x, p);
      if (aborted) return;
    }
  }

  function buildResult(solution) {
    const plan = solution.seq.map((a, i) => ({
      hole: i + 1,
      type: a.kind === 'cw' ? 'counterweight' : a.kind,
      id: a.kind === 'empty' ? null : a.id,
      mass: a.mass,
    }));
    const pairs = [];
    for (let i = 1; i <= half; i++) {
      const a = solution.seq[i - 1];
      const b = solution.seq[i - 1 + half];
      pairs.push({ holes: [i, i + half], masses: [a.mass, b.mass], diff: Math.abs(a.mass - b.mass) });
    }
    const cwCount = solution.seq.filter((a) => a.kind === 'cw').length;
    return { feasible: true, plan, pairs, cwCount, sumDiffs: solution.sum };
  }
}
