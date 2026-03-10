(() => {
  const $ = (id) => document.getElementById(id);
  const keyFromUrl = new URLSearchParams(location.search).get('adminKey') || '';
  const authHeaders = () => {
    const h = {};
    if (keyFromUrl) h['x-admin-key'] = keyFromUrl;
    return h;
  };
  const esc = (s) => { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; };
  const fmtBytes = (n) => { const v = Number(n || 0); if (v < 1024) return v + ' B'; if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'; if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB'; return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB'; };
  const levelClass = (l) => l === 'CRITICAL' ? 'bad' : (l === 'WARN' ? 'warn' : 'ok');
  const showAdmin = (on) => { $('login-panel').className = on ? 'wrap hide' : 'wrap'; $('admin-panel').className = on ? 'wrap' : 'wrap hide'; };
  let agentModels = {};

  async function api(path, opt = {}) {
    const res = await fetch(path, { ...opt, headers: { ...authHeaders(), ...(opt.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function renderAgentModels(models, allowedModels) {
    agentModels = { ...(models || {}) };
    const roles = Object.keys(agentModels);
    const opts = (allowedModels || ['claude', 'codex']).map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    $('agent-models-body').innerHTML = roles.map((role) => {
      return `<tr><td>${esc(role)}</td><td><select class="input" data-agent="${esc(role)}">${opts}</select></td></tr>`;
    }).join('');
    document.querySelectorAll('[data-agent]').forEach((sel) => {
      const role = sel.dataset.agent;
      sel.value = agentModels[role] || 'claude';
      sel.onchange = () => { agentModels[role] = sel.value; };
    });
  }

  function renderBootstrap(data) {
    $('stamp').textContent = '更新时间: ' + new Date().toLocaleString();
    const r = data.runtime || {};
    $('runtime').innerHTML = [
      ['Redis', r.redisReady ? 'READY' : 'DOWN'],
      ['Redis URL', r.redisUrl || ''],
      ['Redis Ver', r.redisVersion || ''],
      ['Clients', r.connectedClients || 0],
      ['Memory', r.usedMemoryHuman || fmtBytes(r.usedMemory)],
      ['AOF', String(r.aofEnabled)],
      ['Rooms', data.rooms?.total || 0],
      ['PID', r.pid || ''],
    ].map(x => `<div class="kv"><div class="k">${esc(x[0])}</div><div class="v">${esc(x[1])}</div></div>`).join('');

    const integ = data.integrity;
    $('integrity').innerHTML = !integ
      ? '<span class="warn">尚未运行完整性校验</span>'
      : `<div class="${integ.ok ? 'ok' : 'bad'}">状态: ${integ.ok ? 'PASS' : 'FAIL'} | rooms=${integ.roomCount} messages=${integ.totalMessages} issues=${(integ.issues || []).length}</div><div>最近检查: ${esc(integ.checkedAt || '')}</div>`;

    renderAgentModels(data.agentModels || {}, data.allowedModels || ['claude', 'codex']);
    $('roles-json').value = JSON.stringify(data.roles || [], null, 2);

    $('alerts').innerHTML = (data.alerts || []).map(a => `<tr><td>${esc(a.ts)}</td><td class="${levelClass(a.level)}">${esc(a.level)}</td><td>${esc(a.event)}</td><td>${esc(JSON.stringify(a.detail || {}))}</td><td>${a.acked ? '已确认' : `<button class="btn" data-ack="${esc(a.id)}">确认</button>`}</td></tr>`).join('');
    document.querySelectorAll('[data-ack]').forEach((b) => b.onclick = async () => {
      const r = await api('/api/admin/alerts/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.ack }) });
      if (!r.res.ok) { alert('确认失败'); return; }
      load().catch(() => {});
    });

    $('backups').innerHTML = (data.backups || []).map(b => `<tr><td>${esc(b.name)}</td><td>${esc(fmtBytes(b.size))}</td><td>${esc(b.mtime)}</td></tr>`).join('');
  }

  async function load() {
    const { res, data } = await api('/api/admin/bootstrap');
    if (!res.ok) { showAdmin(false); $('login-msg').textContent = '请先登录'; return; }
    showAdmin(true);
    renderBootstrap(data);
  }

  $('login').onclick = async () => {
    const username = $('username').value.trim();
    const password = $('password').value;
    const { res, data } = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(async (r) => ({ res: r, data: await r.json().catch(() => ({})) }));
    if (!res.ok) { $('login-msg').textContent = '登录失败: ' + (data.error || res.status); return; }
    $('login-msg').textContent = '';
    load().catch(() => {});
  };

  $('logout').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }); showAdmin(false); };
  $('refresh').onclick = () => load().catch((e) => alert(e.message));
  $('check').onclick = async () => {
    const { res, data } = await api('/api/admin/check', { method: 'POST' });
    if (!res.ok) { alert('校验失败: ' + (data.error || res.status)); return; }
    load().catch(() => {});
  };

  $('save-agent-models').onclick = async () => {
    const { res, data } = await api('/api/admin/agent-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: agentModels }),
    });
    if (!res.ok) { alert('保存失败: ' + (data.error || res.status)); return; }
    load().catch(() => {});
    alert('已保存，runner 会在几秒内自动刷新配置');
  };

  $('save-roles').onclick = async () => {
    let parsed = [];
    try { parsed = JSON.parse($('roles-json').value || '[]'); }
    catch (e) { alert('JSON 格式错误: ' + e.message); return; }
    const { res, data } = await api('/api/admin/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles: parsed }),
    });
    if (!res.ok) { alert('保存角色失败: ' + (data.error || res.status)); return; }
    load().catch(() => {});
    alert('角色已保存，runner 将自动热加载');
  };

  load().catch(() => showAdmin(false));
})();
