// HTTP API 与静态文件服务。
// 所有写操作都在事务内完成：先校验、后落库，失败整体回滚，不留下部分数据。

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db, tx, getVersion, bumpVersion,
  getRotor, listTubes, listCounterweights,
  getDraft, saveDraft, listPublished, insertPublished,
} from './db.js';
import { ApiError, asId, asMass, asHoles, asQuantity, asRotor, validatePlan } from './validate.js';
import { solveRotor } from './solver.js';

const EPS = 1e-9;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '256kb' }));

function mustRotor() {
  const rotor = getRotor();
  if (!rotor) throw new ApiError(400, '请先配置转子参数');
  return rotor;
}

function currentSolveInput() {
  const rotor = mustRotor();
  return {
    holes: rotor.holes,
    maxMass: rotor.maxMass,
    tolerance: rotor.tolerance,
    tubes: listTubes(),
    counterweights: listCounterweights(),
  };
}

// ---------- 状态查询 ----------

app.get('/api/state', (req, res) => {
  const version = getVersion();
  const draft = getDraft();
  res.json({
    rotor: getRotor(),
    tubes: listTubes(),
    counterweights: listCounterweights(),
    dataVersion: version,
    draft: draft ? { ...draft, stale: draft.dataVersion !== version } : null,
    published: listPublished().map((p) => ({ ...p, usable: p.dataVersion === version })),
  });
});

// ---------- 转子参数 ----------

app.put('/api/rotor', (req, res) => {
  const cfg = asRotor(req.body);
  tx(() => {
    // 新参数不得使既有数据变为非法（质量超上限 / 孔位越界），否则整体拒绝
    const conflicts = [];
    for (const t of listTubes()) {
      if (t.mass > cfg.maxMass + EPS || t.allowedHoles.some((h) => h > cfg.holes)) {
        conflicts.push(`离心管「${t.id}」`);
      }
    }
    for (const c of listCounterweights()) {
      if (c.mass > cfg.maxMass + EPS) conflicts.push(`配重「${c.id}」`);
    }
    if (conflicts.length) {
      throw new ApiError(400, `新转子参数与现有数据冲突：${conflicts.join('、')}，请先调整或删除`);
    }
    db.prepare(`
      INSERT INTO rotor (id, holes, max_mass, tolerance) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET holes = excluded.holes, max_mass = excluded.max_mass, tolerance = excluded.tolerance
    `).run(cfg.holes, cfg.maxMass, cfg.tolerance);
    bumpVersion();
  });
  res.json({ ok: true });
});

// ---------- 离心管 ----------

app.post('/api/tubes', (req, res) => {
  tx(() => {
    const rotor = mustRotor();
    const id = asId(req.body?.id, '离心管编号');
    const mass = asMass(req.body?.mass, '称重质量');
    if (mass > rotor.maxMass + EPS) {
      throw new ApiError(400, `称重质量（${mass}）超过单孔最大质量（${rotor.maxMass}）`);
    }
    const allowedHoles = asHoles(req.body?.allowedHoles, rotor.holes);
    if (db.prepare('SELECT 1 FROM tubes WHERE id = ?').get(id)) {
      throw new ApiError(409, `离心管编号「${id}」已存在（重复编号）`);
    }
    db.prepare('INSERT INTO tubes (id, mass, allowed_holes) VALUES (?, ?, ?)')
      .run(id, mass, JSON.stringify(allowedHoles));
    bumpVersion();
  });
  res.json({ ok: true });
});

app.put('/api/tubes/:id', (req, res) => {
  tx(() => {
    const rotor = mustRotor();
    const id = req.params.id;
    if (!db.prepare('SELECT 1 FROM tubes WHERE id = ?').get(id)) {
      throw new ApiError(404, `离心管「${id}」不存在`);
    }
    const mass = asMass(req.body?.mass, '称重质量');
    if (mass > rotor.maxMass + EPS) {
      throw new ApiError(400, `称重质量（${mass}）超过单孔最大质量（${rotor.maxMass}）`);
    }
    const allowedHoles = asHoles(req.body?.allowedHoles, rotor.holes);
    db.prepare('UPDATE tubes SET mass = ?, allowed_holes = ? WHERE id = ?')
      .run(mass, JSON.stringify(allowedHoles), id);
    bumpVersion();
  });
  res.json({ ok: true });
});

app.delete('/api/tubes/:id', (req, res) => {
  tx(() => {
    const info = db.prepare('DELETE FROM tubes WHERE id = ?').run(req.params.id);
    if (info.changes === 0) throw new ApiError(404, `离心管「${req.params.id}」不存在`);
    bumpVersion();
  });
  res.json({ ok: true });
});

// ---------- 配重块 ----------

app.post('/api/counterweights', (req, res) => {
  tx(() => {
    const rotor = mustRotor();
    const id = asId(req.body?.id, '配重编号');
    const mass = asMass(req.body?.mass, '配重质量');
    if (mass > rotor.maxMass + EPS) {
      throw new ApiError(400, `配重质量（${mass}）超过单孔最大质量（${rotor.maxMass}）`);
    }
    const quantity = asQuantity(req.body?.quantity);
    if (db.prepare('SELECT 1 FROM counterweights WHERE id = ?').get(id)) {
      throw new ApiError(409, `配重编号「${id}」已存在（重复编号）`);
    }
    db.prepare('INSERT INTO counterweights (id, mass, quantity) VALUES (?, ?, ?)').run(id, mass, quantity);
    bumpVersion();
  });
  res.json({ ok: true });
});

app.put('/api/counterweights/:id', (req, res) => {
  tx(() => {
    const rotor = mustRotor();
    const id = req.params.id;
    if (!db.prepare('SELECT 1 FROM counterweights WHERE id = ?').get(id)) {
      throw new ApiError(404, `配重「${id}」不存在`);
    }
    const mass = asMass(req.body?.mass, '配重质量');
    if (mass > rotor.maxMass + EPS) {
      throw new ApiError(400, `配重质量（${mass}）超过单孔最大质量（${rotor.maxMass}）`);
    }
    const quantity = asQuantity(req.body?.quantity);
    db.prepare('UPDATE counterweights SET mass = ?, quantity = ? WHERE id = ?').run(mass, quantity, id);
    bumpVersion();
  });
  res.json({ ok: true });
});

app.delete('/api/counterweights/:id', (req, res) => {
  tx(() => {
    const info = db.prepare('DELETE FROM counterweights WHERE id = ?').run(req.params.id);
    if (info.changes === 0) throw new ApiError(404, `配重「${req.params.id}」不存在`);
    bumpVersion();
  });
  res.json({ ok: true });
});

// ---------- 求解草稿 ----------

app.post('/api/draft', (req, res) => {
  const out = tx(() => {
    const result = solveRotor(currentSolveInput());
    const version = getVersion();
    saveDraft(version, result);
    return { ...result, dataVersion: version, stale: false };
  });
  res.json(out);
});

// ---------- 发布（原子复核 + 冻结） ----------

app.post('/api/publish', (req, res) => {
  const out = tx(() => {
    const draft = getDraft();
    if (!draft) throw new ApiError(409, '尚无草稿，请先求解');
    if (!draft.feasible) throw new ApiError(409, '当前草稿为无解结果，不能发布');
    const version = getVersion();
    if (draft.dataVersion !== version) {
      throw new ApiError(409, '数据已变更，草稿失效，请重新求解后再发布');
    }
    const input = currentSolveInput();
    // 复核一：装载图对当前数据仍然合法（约束逐条重验）
    validatePlan(input, draft.plan);
    // 复核二：以当前数据重新求解，草稿仍为最优
    const fresh = solveRotor(input);
    if (!fresh.feasible || fresh.cwCount !== draft.cwCount || Math.abs(fresh.sumDiffs - draft.sumDiffs) > EPS) {
      throw new ApiError(409, '原子复核未通过：草稿已非当前最优，请重新求解');
    }
    // 冻结装载图及依据（转子参数 + 离心管 + 配重 + 数据版本）
    const basis = {
      rotor: getRotor(),
      tubes: input.tubes,
      counterweights: input.counterweights,
      dataVersion: version,
    };
    const id = insertPublished(version, draft, basis);
    return id;
  });
  res.json({ ok: true, id: out });
});

// ---------- 静态文件与错误处理 ----------

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: '请求体不是合法 JSON' });
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`rotor-balance 已启动：http://0.0.0.0:${PORT}`);
});
