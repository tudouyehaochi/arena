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
  const PRIORITIES = ['high', 'medium', 'low'];
  let agentModels = {};
  let allowedModels = ['claude', 'codex'];
  let roles = [];
  let skills = [];
  let activeRoleIndex = 0;

  async function api(path, opt = {}) {
    const res = await fetch(path, { ...opt, headers: { ...authHeaders(), ...(opt.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function normalizeRole(role = {}) {
    const skillBindings = Array.isArray(role.skillBindings) && role.skillBindings.length > 0
      ? role.skillBindings
      : (Array.isArray(role.skills) ? role.skills.map((id) => ({ id, priority: 'medium' })) : []);
    return {
      name: role.name || '',
      alias: Array.isArray(role.alias) ? role.alias : [],
      model: role.model || 'claude',
      avatar: role.avatar || ((role.name || '?')[0] || '?'),
      color: role.color || '#64748b',
      enabled: role.enabled !== false,
      status: role.status || 'idle',
      priority: Number(role.priority || 50),
      activationMode: role.activationMode || 'mention',
      skillBindings: skillBindings.map((s) => ({
        id: String(s.id || '').trim(),
        priority: PRIORITIES.includes(String(s.priority || '').toLowerCase()) ? String(s.priority).toLowerCase() : 'medium',
      })).filter((s) => s.id),
      persona: String(role.persona || '').trim(),
    };
  }

  function parsePersona(persona) {
    const p = String(persona || '');
    const out = { position: '', style: '', strength: '', boundary: '' };
    if (!p) return out;
    const lines = p.split(/[。;\n]/).map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('定位:')) out.position = line.slice(3).trim();
      else if (line.startsWith('风格:')) out.style = line.slice(3).trim();
      else if (line.startsWith('擅长:')) out.strength = line.slice(3).trim();
      else if (line.startsWith('边界:')) out.boundary = line.slice(3).trim();
    }
    if (!out.position && !out.style && !out.strength && !out.boundary) out.position = p;
    return out;
  }

  function buildPersona() {
    const position = $('persona-position').value.trim();
    const style = $('persona-style').value.trim();
    const strength = $('persona-strength').value.trim();
    const boundary = $('persona-boundary').value.trim();
    const parts = [];
    if (position) parts.push(`定位:${position}`);
    if (style) parts.push(`风格:${style}`);
    if (strength) parts.push(`擅长:${strength}`);
    if (boundary) parts.push(`边界:${boundary}`);
    return parts.join('；');
  }

  function renderAgentModels(models, nextAllowedModels) {
    agentModels = { ...(models || {}) };
    allowedModels = Array.isArray(nextAllowedModels) && nextAllowedModels.length > 0 ? nextAllowedModels : allowedModels;
    const roleNames = Object.keys(agentModels).sort((a, b) => a.localeCompare(b));
    const opts = allowedModels.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    $('agent-models-body').innerHTML = roleNames.map((role) => (
      `<tr><td>${esc(role)}</td><td><select class="input" data-agent="${esc(role)}">${opts}</select></td></tr>`
    )).join('');
    document.querySelectorAll('[data-agent]').forEach((sel) => {
      const role = sel.dataset.agent;
      sel.value = agentModels[role] || allowedModels[0] || 'claude';
      sel.onchange = () => { agentModels[role] = sel.value; };
    });
  }

  function renderRoleList() {
    $('role-list').innerHTML = roles.map((role, idx) => (
      `<div class="role-item ${idx === activeRoleIndex ? 'active' : ''}" data-role-idx="${idx}">
        <div><strong>${esc(role.name || '未命名')}</strong> <span class="pill">${esc(role.activationMode)}</span></div>
        <div class="hint">${esc(role.model)} · p${esc(role.priority)} · ${role.enabled ? 'enabled' : 'disabled'}</div>
      </div>`
    )).join('');
    document.querySelectorAll('[data-role-idx]').forEach((el) => {
      el.onclick = () => { activeRoleIndex = Number(el.dataset.roleIdx || 0); renderRoleList(); renderRoleEditor(); };
    });
  }

  function selectedRole() {
    if (roles.length === 0) roles.push(normalizeRole({ name: '新角色' }));
    if (activeRoleIndex >= roles.length) activeRoleIndex = roles.length - 1;
    return roles[activeRoleIndex];
  }

  function applyFormToRole() {
    const role = selectedRole();
    role.name = $('role-name').value.trim();
    role.avatar = $('role-avatar').value.trim().slice(0, 2) || ((role.name || '?')[0] || '?');
    role.color = $('role-color').value.trim() || '#64748b';
    role.alias = $('role-alias').value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8);
    role.model = $('role-model').value;
    role.status = $('role-status').value;
    role.priority = Math.max(1, Math.min(100, Number($('role-priority').value || 50)));
    role.activationMode = $('role-activation-mode').value;
    role.enabled = role.status !== 'muted';
    role.persona = buildPersona();
    const bindings = [];
    document.querySelectorAll('[data-skill-check]').forEach((cb) => {
      if (!cb.checked) return;
      const id = cb.dataset.skillCheck;
      const prioritySel = document.querySelector(`[data-skill-priority="${CSS.escape(id)}"]`);
      bindings.push({
        id,
        priority: PRIORITIES.includes(prioritySel?.value || '') ? prioritySel.value : 'medium',
      });
    });
    role.skillBindings = bindings;
  }

  function renderSkillList(filterText = '') {
    const role = selectedRole();
    const active = new Map((role.skillBindings || []).map((s) => [s.id, s.priority]));
    const q = String(filterText || '').trim().toLowerCase();
    const list = skills.filter((skill) => {
      if (!q) return true;
      return `${skill.id} ${skill.name} ${skill.description}`.toLowerCase().includes(q);
    });
    $('skill-list').innerHTML = list.map((skill) => {
      const checked = active.has(skill.id);
      const priority = active.get(skill.id) || skill.recommendedPriority || 'medium';
      const options = PRIORITIES.map((p) => `<option value="${p}" ${p === priority ? 'selected' : ''}>${p}</option>`).join('');
      return `<label class="skill-item">
        <input type="checkbox" data-skill-check="${esc(skill.id)}" ${checked ? 'checked' : ''}>
        <div><div><strong>${esc(skill.id)}</strong> <span class="pill">建议 ${esc(skill.recommendedPriority || 'medium')}</span></div><div class="hint">${esc(skill.description || '')}</div></div>
        <select class="input" data-skill-priority="${esc(skill.id)}">${options}</select>
        <span class="hint">${esc(skill.source || '')}</span>
      </label>`;
    }).join('');
  }

  function renderRoleEditor() {
    const role = selectedRole();
    const persona = parsePersona(role.persona);
    $('role-name').value = role.name || '';
    $('role-avatar').value = role.avatar || '';
    $('role-color').value = role.color || '';
    $('role-alias').value = (role.alias || []).join(', ');
    $('role-model').value = role.model || 'claude';
    $('role-status').value = role.status || 'idle';
    $('role-priority').value = role.priority || 50;
    $('role-activation-mode').value = role.activationMode || 'mention';
    $('persona-position').value = persona.position;
    $('persona-style').value = persona.style;
    $('persona-strength').value = persona.strength;
    $('persona-boundary').value = persona.boundary;
    renderSkillList($('skill-filter').value);
  }

  function renderAlerts(items) {
    $('alerts').innerHTML = (items || []).map((a) => (
      `<tr>
        <td>${esc(a.ts)}</td>
        <td class="${levelClass(a.level)}">${esc(a.level)}</td>
        <td>${esc(a.event)}</td>
        <td>${esc(JSON.stringify(a.detail || {}))}</td>
        <td>${esc(a.ackedBy || '')}</td>
        <td>${esc(a.ackedAt || '')}</td>
        <td>${a.acked ? '已确认' : `<button class="btn" data-ack="${esc(a.id)}">确认</button>`}</td>
      </tr>`
    )).join('');
    document.querySelectorAll('[data-ack]').forEach((b) => b.onclick = async () => {
      const r = await api('/api/admin/alerts/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: b.dataset.ack, actor: $('username').value || 'admin' }),
      });
      if (!r.res.ok) { alert('确认失败'); return; }
      queryAlerts().catch(() => {});
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
    ].map((x) => `<div class="kv"><div class="k">${esc(x[0])}</div><div class="v">${esc(x[1])}</div></div>`).join('');

    const integ = data.integrity;
    $('integrity').innerHTML = !integ
      ? '<span class="warn">尚未运行完整性校验</span>'
      : `<div class="${integ.ok ? 'ok' : 'bad'}">状态: ${integ.ok ? 'PASS' : 'FAIL'} | rooms=${integ.roomCount} messages=${integ.totalMessages} issues=${(integ.issues || []).length}</div><div>最近检查: ${esc(integ.checkedAt || '')}</div>`;

    renderAgentModels(data.agentModels || {}, data.allowedModels || ['claude', 'codex']);
    skills = Array.isArray(data.skills) ? data.skills : [];
    roles = (data.roles || []).map(normalizeRole).sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
    activeRoleIndex = 0;
    renderRoleList();
    renderRoleEditor();
    renderAlerts(data.alerts || []);
    $('backups').innerHTML = (data.backups || []).map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(fmtBytes(b.size))}</td><td>${esc(b.mtime)}</td></tr>`).join('');
    const backupTask = data.backupTask || null;
    const restoreDrill = data.restoreDrill || null;
    const statusParts = [];
    if (backupTask) statusParts.push(`backup: ${backupTask.status} ${backupTask.finishedAt || ''}`);
    if (restoreDrill) statusParts.push(`restore: ${restoreDrill.status} ${restoreDrill.finishedAt || ''}`);
    $('backup-status').textContent = statusParts.join(' | ');
  }

  async function load() {
    const { res, data } = await api('/api/admin/bootstrap');
    if (!res.ok) { showAdmin(false); $('login-msg').textContent = '请先登录'; return; }
    showAdmin(true);
    renderBootstrap(data);
  }

  async function queryAlerts() {
    const { res, data } = await api('/api/admin/alerts/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: 200,
        filters: {
          acked: $('alert-acked').value,
          q: $('alert-q').value.trim(),
        },
      }),
    });
    if (!res.ok) { alert('查询告警失败: ' + (data.error || res.status)); return; }
    renderAlerts(data.alerts || []);
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
  $('alert-search').onclick = () => queryAlerts().catch(() => {});

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

  $('add-role').onclick = () => {
    applyFormToRole();
    roles.push(normalizeRole({
      name: `新角色${roles.length + 1}`,
      model: 'claude',
      status: 'idle',
      priority: 50,
      activationMode: 'mention',
    }));
    activeRoleIndex = roles.length - 1;
    renderRoleList();
    renderRoleEditor();
  };

  $('save-roles').onclick = async () => {
    applyFormToRole();
    const payload = roles.map((role) => ({
      ...role,
      enabled: role.status !== 'muted',
      skills: (role.skillBindings || []).map((s) => s.id),
      activationRules: [],
    }));
    const { res, data } = await api('/api/admin/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles: payload }),
    });
    if (!res.ok) { alert('保存角色失败: ' + (data.error || res.status)); return; }
    load().catch(() => {});
    alert('角色已保存，runner 将自动热加载');
  };

  $('role-name').oninput = () => { applyFormToRole(); renderRoleList(); };
  $('role-avatar').oninput = () => { applyFormToRole(); renderRoleList(); };
  $('role-model').onchange = () => { applyFormToRole(); renderRoleList(); };
  $('role-status').onchange = () => { applyFormToRole(); renderRoleList(); };
  $('role-priority').oninput = () => { applyFormToRole(); renderRoleList(); };
  $('role-activation-mode').onchange = () => { applyFormToRole(); renderRoleList(); };
  $('skill-filter').oninput = () => renderSkillList($('skill-filter').value);
  document.addEventListener('change', (e) => {
    const target = e.target;
    if (!target || typeof target.getAttribute !== 'function') return;
    if (target.getAttribute('data-skill-check') !== null || target.getAttribute('data-skill-priority') !== null) {
      applyFormToRole();
      renderRoleList();
    }
  });

  $('run-backup').onclick = async () => {
    const { res, data } = await api('/api/admin/backup/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: $('backup-kind').value }),
    });
    if (!res.ok) { alert('备份失败: ' + (data.error || data.status || res.status)); return; }
    load().catch(() => {});
  };

  $('run-restore-drill').onclick = async () => {
    if (!confirm('恢复演练会覆盖当前 dev Redis 快照，确认继续？')) return;
    const { res, data } = await api('/api/admin/restore/drill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) { alert('恢复演练失败: ' + (data.error || data.status || res.status)); return; }
    load().catch(() => {});
  };

  load().catch(() => showAdmin(false));
})();
