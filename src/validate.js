// 输入校验与装载图复核。所有校验在写库前完成，失败抛 ApiError，事务回滚，不留部分数据。

const EPS = 1e-9;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function asId(value, field = '编号') {
  if (typeof value !== 'string') throw new ApiError(400, `${field}必须为字符串`);
  const s = value.trim();
  if (!s) throw new ApiError(400, `${field}不能为空`);
  if (s.length > 64) throw new ApiError(400, `${field}长度不能超过 64 个字符`);
  return s;
}

export function asMass(value, field = '质量') {
  const n = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new ApiError(400, `${field}必须为正数`);
  if (n > 1e9) throw new ApiError(400, `${field}超出允许范围`);
  return n;
}

export function asHoles(value, H) {
  if (!Array.isArray(value)) throw new ApiError(400, '可用孔位必须为数组');
  const set = new Set();
  for (const x of value) {
    if (!Number.isInteger(x)) throw new ApiError(400, `孔位「${x}」不是整数`);
    if (x < 1 || x > H) throw new ApiError(400, `孔位越界：「${x}」不在 1–${H} 范围内`);
    set.add(x);
  }
  const arr = [...set].sort((a, b) => a - b);
  if (arr.length === 0) throw new ApiError(400, '可用孔位不能为空');
  return arr;
}

export function asQuantity(value) {
  const n = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 0) throw new ApiError(400, '配重数量必须为非负整数');
  if (n > 100000) throw new ApiError(400, '配重数量超出允许范围');
  return n;
}

export function asRotor(body) {
  const holes = Number(body?.holes);
  if (!Number.isInteger(holes) || holes < 4 || holes > 12 || holes % 2 !== 0) {
    throw new ApiError(400, '孔位数必须为 4–12 的偶数');
  }
  const maxMass = asMass(body?.maxMass, '单孔最大质量');
  const tolerance = typeof body?.tolerance === 'number' ? body.tolerance
    : typeof body?.tolerance === 'string' && body.tolerance.trim() !== '' ? Number(body.tolerance) : NaN;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new ApiError(400, '允许对径差必须为非负数');
  }
  return { holes, maxMass, tolerance };
}

// 发布时的原子复核：装载图对当前数据必须仍然合法
export function validatePlan(data, plan) {
  const fail = (msg) => { throw new ApiError(409, `装载图复核失败：${msg}`); };
  const { holes: H, maxMass, tolerance } = data;
  if (!Array.isArray(plan) || plan.length !== H) fail('孔位数量与转子不符');

  const tubeById = new Map(data.tubes.map((t) => [t.id, t]));
  const cwById = new Map(data.counterweights.map((c) => [c.id, c]));
  const seenTubes = new Set();
  const cwUsed = new Map();
  const massAt = new Array(H + 1).fill(0);

  for (let i = 0; i < H; i++) {
    const cell = plan[i];
    if (!cell || cell.hole !== i + 1) fail('孔位顺序不符');
    if (cell.type === 'tube') {
      const t = tubeById.get(cell.id);
      if (!t) fail(`离心管「${cell.id}」不存在`);
      if (seenTubes.has(cell.id)) fail(`离心管「${cell.id}」被重复放置`);
      seenTubes.add(cell.id);
      if (!t.allowedHoles.includes(cell.hole)) fail(`离心管「${cell.id}」不允许放入孔位 ${cell.hole}`);
      if (Math.abs(t.mass - cell.mass) > 1e-6) fail(`离心管「${cell.id}」的质量与当前数据不符`);
      massAt[cell.hole] = t.mass;
    } else if (cell.type === 'counterweight') {
      const c = cwById.get(cell.id);
      if (!c) fail(`配重「${cell.id}」不存在`);
      if (Math.abs(c.mass - cell.mass) > 1e-6) fail(`配重「${cell.id}」的质量与当前数据不符`);
      const used = (cwUsed.get(cell.id) || 0) + 1;
      if (used > c.quantity) fail(`配重「${cell.id}」使用数量超过可用数量`);
      cwUsed.set(cell.id, used);
      massAt[cell.hole] = c.mass;
    } else if (cell.type === 'empty') {
      if (cell.mass !== 0) fail('空孔质量必须为零');
    } else {
      fail(`未知物件类型「${cell.type}」`);
    }
    if (massAt[cell.hole] > maxMass + EPS) fail(`孔位 ${cell.hole} 超过单孔最大质量`);
  }
  if (seenTubes.size !== data.tubes.length) fail('存在未装入的离心管');
  for (let i = 1; i <= H / 2; i++) {
    if (Math.abs(massAt[i] - massAt[i + H / 2]) > tolerance + EPS) {
      fail(`对径孔 ${i} 与 ${i + H / 2} 的质量差超过容差`);
    }
  }
}
