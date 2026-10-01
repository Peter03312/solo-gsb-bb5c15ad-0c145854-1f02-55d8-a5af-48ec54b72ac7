// SQLite 数据层（better-sqlite3，同步 API）。
// 数据库文件在首次启动时自动创建并完成建表，无需额外初始化步骤。
//
// data_version：转子 / 离心管 / 配重的任何变更都会在同一事务内使其 +1。
// 草稿与已发布装载图记录其计算依据的 data_version：
//   - 草稿版本落后于当前版本 => 数据已变更，需重算；
//   - 已发布装载图版本落后于当前版本 => 冻结不改，但标记为不可用于当前装载。

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rotor (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  holes     INTEGER NOT NULL,
  max_mass  REAL NOT NULL,
  tolerance REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS tubes (
  id            TEXT PRIMARY KEY,
  mass          REAL NOT NULL,
  allowed_holes TEXT NOT NULL  -- JSON 数组，孔位从 1 开始
);
CREATE TABLE IF NOT EXISTS counterweights (
  id       TEXT PRIMARY KEY,
  mass     REAL NOT NULL,
  quantity INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id           INTEGER PRIMARY KEY CHECK (id = 1),  -- 只保留最新一份草稿
  data_version INTEGER NOT NULL,
  feasible     INTEGER NOT NULL,
  reason       TEXT,
  plan         TEXT,
  pairs        TEXT,
  cw_count     INTEGER,
  sum_diffs    REAL,
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS published (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  data_version INTEGER NOT NULL,
  plan         TEXT NOT NULL,
  pairs        TEXT NOT NULL,
  basis        TEXT NOT NULL,  -- 冻结依据：转子参数 + 离心管 + 配重 + 数据版本
  cw_count     INTEGER NOT NULL,
  sum_diffs    REAL NOT NULL,
  created_at   TEXT NOT NULL
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('data_version', '0');
`);

// 事务包装：任一语句或校验失败即整体回滚，不留下部分数据
export function tx(fn) {
  return db.transaction(fn)();
}

export function getVersion() {
  return Number(db.prepare(`SELECT value FROM meta WHERE key = 'data_version'`).get().value);
}

export function bumpVersion() {
  db.prepare(`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'data_version'`).run();
}

export function getRotor() {
  return db.prepare('SELECT holes, max_mass AS maxMass, tolerance FROM rotor WHERE id = 1').get() || null;
}

export function listTubes() {
  return db.prepare('SELECT id, mass, allowed_holes AS allowedHoles FROM tubes ORDER BY id').all()
    .map((t) => ({ ...t, allowedHoles: JSON.parse(t.allowedHoles) }));
}

export function listCounterweights() {
  return db.prepare('SELECT id, mass, quantity FROM counterweights ORDER BY id').all();
}

export function getDraft() {
  const d = db.prepare('SELECT * FROM drafts WHERE id = 1').get();
  if (!d) return null;
  return {
    dataVersion: d.data_version,
    feasible: !!d.feasible,
    reason: d.reason,
    plan: d.plan ? JSON.parse(d.plan) : null,
    pairs: d.pairs ? JSON.parse(d.pairs) : null,
    cwCount: d.cw_count,
    sumDiffs: d.sum_diffs,
    createdAt: d.created_at,
  };
}

export function saveDraft(version, result) {
  db.prepare(`
    INSERT INTO drafts (id, data_version, feasible, reason, plan, pairs, cw_count, sum_diffs, created_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data_version = excluded.data_version,
      feasible     = excluded.feasible,
      reason       = excluded.reason,
      plan         = excluded.plan,
      pairs        = excluded.pairs,
      cw_count     = excluded.cw_count,
      sum_diffs    = excluded.sum_diffs,
      created_at   = excluded.created_at
  `).run(
    version,
    result.feasible ? 1 : 0,
    result.reason ?? null,
    result.feasible ? JSON.stringify(result.plan) : null,
    result.feasible ? JSON.stringify(result.pairs) : null,
    result.feasible ? result.cwCount : null,
    result.feasible ? result.sumDiffs : null,
    new Date().toISOString(),
  );
}

export function listPublished() {
  return db.prepare('SELECT * FROM published ORDER BY id DESC').all().map((p) => ({
    id: p.id,
    dataVersion: p.data_version,
    plan: JSON.parse(p.plan),
    pairs: JSON.parse(p.pairs),
    basis: JSON.parse(p.basis),
    cwCount: p.cw_count,
    sumDiffs: p.sum_diffs,
    createdAt: p.created_at,
  }));
}

export function insertPublished(version, draft, basis) {
  const info = db.prepare(`
    INSERT INTO published (data_version, plan, pairs, basis, cw_count, sum_diffs, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    version,
    JSON.stringify(draft.plan),
    JSON.stringify(draft.pairs),
    JSON.stringify(basis),
    draft.cwCount,
    draft.sumDiffs,
    new Date().toISOString(),
  );
  return Number(info.lastInsertRowid);
}
