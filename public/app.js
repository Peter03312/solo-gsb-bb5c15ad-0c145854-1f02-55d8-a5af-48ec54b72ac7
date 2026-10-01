/* 实验室离心转子配平 —— 前端逻辑（无框架，直接操作 DOM） */

const $ = (sel) => document.querySelector(sel);
const EPS = 1e-9;

let state = null;

/* ---------- 工具 ---------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmt(x) {
  return String(Number(Number(x).toFixed(6)));
}

function parseHoles(text) {
  const parts = String(text).split(/[,，、\s]+/).filter((s) => s !== '');
  return parts.map((s) => Number(s));
}

let msgTimer = null;
function showMsg(text, isError) {
  const el = $('#msg');
  el.textContent = text;
  el.className = isError ? 'msg error' : 'msg ok';
  el.hidden = false;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
  return data;
}

async function run(fn) {
  try {
    await fn();
    await refresh();
  } catch (e) {
    showMsg(e.message, true);
  }
}

async function refresh() {
  state = await api('GET', '/api/state');
  renderAll();
}

/* ---------- 渲染 ---------- */

function renderAll() {
  $('#version').textContent = `数据版本 v${state.dataVersion}`;
  renderRotorForm();
  renderTubes();
  renderCws();
  renderDraft();
  renderPublished();
}

function renderRotorForm() {
  const r = state.rotor;
  if (r) {
    $('#rotor-holes').value = String(r.holes);
    $('#rotor-maxmass').value = r.maxMass;
    $('#rotor-tolerance').value = r.tolerance;
  }
}

function renderTubes() {
  const tbody = $('#tubes-table tbody');
  tbody.innerHTML = state.tubes.map((t) => `
    <tr data-id="${esc(t.id)}">
      <td>${esc(t.id)}</td>
      <td><input class="mass" type="number" step="any" min="0" value="${t.mass}"></td>
      <td><input class="holes" value="${t.allowedHoles.join(',')}"></td>
      <td>
        <button class="save" type="button">保存</button>
        <button class="del danger" type="button">删除</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted">尚未录入离心管</td></tr>';

  tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector('.save').onclick = () => run(async () => {
      await api('PUT', `/api/tubes/${encodeURIComponent(id)}`, {
        mass: Number(tr.querySelector('.mass').value),
        allowedHoles: parseHoles(tr.querySelector('.holes').value),
      });
      showMsg(`离心管「${id}」已保存`, false);
    });
    tr.querySelector('.del').onclick = () => run(async () => {
      await api('DELETE', `/api/tubes/${encodeURIComponent(id)}`);
      showMsg(`离心管「${id}」已删除`, false);
    });
  });
}

function renderCws() {
  const tbody = $('#cw-table tbody');
  tbody.innerHTML = state.counterweights.map((c) => `
    <tr data-id="${esc(c.id)}">
      <td>${esc(c.id)}</td>
      <td><input class="mass" type="number" step="any" min="0" value="${c.mass}"></td>
      <td><input class="qty" type="number" step="1" min="0" value="${c.quantity}"></td>
      <td>
        <button class="save" type="button">保存</button>
        <button class="del danger" type="button">删除</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted">未配置配重块</td></tr>';

  tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector('.save').onclick = () => run(async () => {
      await api('PUT', `/api/counterweights/${encodeURIComponent(id)}`, {
        mass: Number(tr.querySelector('.mass').value),
        quantity: Number(tr.querySelector('.qty').value),
      });
      showMsg(`配重「${id}」已保存`, false);
    });
    tr.querySelector('.del').onclick = () => run(async () => {
      await api('DELETE', `/api/counterweights/${encodeURIComponent(id)}`);
      showMsg(`配重「${id}」已删除`, false);
    });
  });
}

function renderDraft() {
  const el = $('#draft');
  const d = state.draft;
  if (!d) {
    el.innerHTML = '<p class="muted">尚未求解。录入数据后点击「求解装载图」。</p>';
    return;
  }
  let html = '';
  if (d.stale) {
    html += '<div class="banner warn">⚠ 转子 / 离心管 / 配重数据已变更，以下为旧数据的结果，需重新求解后才可发布。</div>';
  }
  if (!d.feasible) {
    html += `<div class="banner error">无解：${esc(d.reason)}</div>`;
  } else {
    html += `<div class="objectives">
      配重块使用数：<b>${d.cwCount}</b>　对径差之和：<b>${fmt(d.sumDiffs)} g</b>
      <span class="muted">（求解于 ${new Date(d.createdAt).toLocaleString()}，数据版本 v${d.dataVersion}）</span>
    </div>`;
    html += rotorSvg(d.plan, state.rotor.holes, state.rotor.tolerance);
    html += pairsTable(d.pairs);
    html += `<button id="publish-btn" type="button" ${d.stale ? 'disabled' : ''}>发布装载图</button>`;
    if (d.stale) html += '<span class="muted"> 数据已变更，请重新求解后再发布</span>';
  }
  el.innerHTML = html;
  const btn = $('#publish-btn');
  if (btn) {
    btn.onclick = () => run(async () => {
      const r = await api('POST', '/api/publish');
      showMsg(`装载图已发布（#${r.id}）并冻结`, false);
    });
  }
}

function renderPublished() {
  const el = $('#published');
  if (!state.published.length) {
    el.innerHTML = '<p class="muted">暂无已发布的装载图。</p>';
    return;
  }
  el.innerHTML = state.published.map((p) => `
    <div class="pub-card" data-id="${p.id}">
      <div class="pub-head">
        <b>#${p.id}</b>　${new Date(p.createdAt).toLocaleString()}
        数据版本 v${p.dataVersion}　配重 ${p.cwCount} 枚　对径差之和 ${fmt(p.sumDiffs)} g
        <span class="badge ${p.usable ? 'ok' : 'bad'}">${p.usable ? '可用于当前装载' : '不可用于当前装载（数据已变更）'}</span>
        <button class="toggle" type="button">展开 / 收起</button>
      </div>
      <div class="pub-body" hidden>
        ${rotorSvg(p.plan, p.basis.rotor.holes, p.basis.rotor.tolerance)}
        ${pairsTable(p.pairs)}
        <details>
          <summary>冻结依据（发布时的数据快照）</summary>
          <p>转子：${p.basis.rotor.holes} 孔，单孔最大 ${fmt(p.basis.rotor.maxMass)} g，允许对径差 ${fmt(p.basis.rotor.tolerance)} g</p>
          <p>离心管：${p.basis.tubes.map((t) => `${esc(t.id)}（${fmt(t.mass)} g，孔位 ${t.allowedHoles.join('/')}）`).join('、') || '无'}</p>
          <p>配重：${p.basis.counterweights.map((c) => `${esc(c.id)}（${fmt(c.mass)} g × ${c.quantity}）`).join('、') || '无'}</p>
        </details>
      </div>
    </div>`).join('');

  el.querySelectorAll('.pub-card').forEach((card) => {
    card.querySelector('.toggle').onclick = () => {
      const body = card.querySelector('.pub-body');
      body.hidden = !body.hidden;
    };
  });
}

function pairsTable(pairs) {
  return `<table class="pairs">
    <thead><tr><th>对径孔</th><th>质量 (g)</th><th>差值 (g)</th></tr></thead>
    <tbody>${pairs.map((p) => `
      <tr><td>${p.holes[0]} ↔ ${p.holes[1]}</td>
      <td>${fmt(p.masses[0])} / ${fmt(p.masses[1])}</td>
      <td>${fmt(p.diff)}</td></tr>`).join('')}
    </tbody>
  </table>`;
}

/* ---------- 转子 SVG ---------- */

function rotorSvg(plan, holes, tolerance) {
  const size = 360;
  const cx = size / 2;
  const cy = size / 2;
  const R = 122;
  const r = 21;
  const half = holes / 2;
  const pos = (i) => {
    const a = ((-90 + ((i - 1) * 360) / holes) * Math.PI) / 180;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a), a];
  };
  const cellOf = (h) => (plan ? plan[h - 1] : null);

  let s = `<svg viewBox="0 0 ${size} ${size}" class="rotor" role="img">`;
  s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#cbd5e1" stroke-width="2"/>`;

  for (let i = 1; i <= half; i++) {
    const [x1, y1] = pos(i);
    const [x2, y2] = pos(i + half);
    const a = cellOf(i);
    const b = cellOf(i + half);
    const diff = a && b ? Math.abs(a.mass - b.mass) : null;
    const ok = diff !== null && diff <= tolerance + EPS;
    const color = diff === null ? '#e2e8f0' : ok ? '#16a34a' : '#dc2626';
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    if (diff !== null) {
      const mx = x1 * 0.68 + x2 * 0.32;
      const my = y1 * 0.68 + y2 * 0.32;
      s += `<text x="${mx}" y="${my}" class="diff" text-anchor="middle">Δ${fmt(diff)}</text>`;
    }
  }

  for (let i = 1; i <= holes; i++) {
    const [x, y, a] = pos(i);
    const c = cellOf(i);
    const type = c ? c.type : 'empty';
    const fill = type === 'tube' ? '#2563eb' : type === 'counterweight' ? '#d97706' : '#e2e8f0';
    const nx = cx + (R + r + 11) * Math.cos(a);
    const ny = cy + (R + r + 11) * Math.sin(a);
    s += `<text x="${nx}" y="${ny + 3}" class="hole-no" text-anchor="middle">${i}</text>`;
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="#334155" stroke-width="1"/>`;
    if (c && c.type !== 'empty') {
      const label = c.id.length > 6 ? `${c.id.slice(0, 5)}…` : c.id;
      s += `<text x="${x}" y="${y - 1}" class="item-id" text-anchor="middle">${esc(label)}<title>${esc(c.id)}</title></text>`;
      s += `<text x="${x}" y="${y + 11}" class="item-mass" text-anchor="middle">${fmt(c.mass)}</text>`;
    } else {
      s += `<text x="${x}" y="${y + 4}" class="item-mass empty" text-anchor="middle">空</text>`;
    }
  }
  return `${s}</svg>`;
}

/* ---------- 事件 ---------- */

$('#rotor-form').addEventListener('submit', (e) => {
  e.preventDefault();
  run(async () => {
    await api('PUT', '/api/rotor', {
      holes: Number($('#rotor-holes').value),
      maxMass: Number($('#rotor-maxmass').value),
      tolerance: Number($('#rotor-tolerance').value),
    });
    showMsg('转子参数已保存', false);
  });
});

$('#tube-add').addEventListener('click', () => run(async () => {
  await api('POST', '/api/tubes', {
    id: $('#tube-id').value,
    mass: Number($('#tube-mass').value),
    allowedHoles: parseHoles($('#tube-holes').value),
  });
  $('#tube-id').value = '';
  $('#tube-mass').value = '';
  $('#tube-holes').value = '';
  showMsg('离心管已添加', false);
}));

$('#cw-add').addEventListener('click', () => run(async () => {
  await api('POST', '/api/counterweights', {
    id: $('#cw-id').value,
    mass: Number($('#cw-mass').value),
    quantity: Number($('#cw-qty').value),
  });
  $('#cw-id').value = '';
  $('#cw-mass').value = '';
  $('#cw-qty').value = '';
  showMsg('配重已添加', false);
}));

$('#solve-btn').addEventListener('click', () => run(async () => {
  const r = await api('POST', '/api/draft');
  showMsg(r.feasible ? '求解完成' : `无解：${r.reason}`, !r.feasible);
}));

refresh().catch((e) => showMsg(e.message, true));
