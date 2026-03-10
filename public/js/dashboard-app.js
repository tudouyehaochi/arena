(() => {
  const qs = new URLSearchParams(location.search);
  const roomId = (qs.get('roomId') || 'default').trim();
  const ui = {
    env: document.getElementById('env'),
    refresh: document.getElementById('refresh'),
    toChat: document.getElementById('to-chat'),
    toAdmin: document.getElementById('to-admin'),
    roomQ: document.getElementById('room-q'),
    rooms: document.getElementById('rooms'),
    stats: document.getElementById('stats'),
    route: document.getElementById('route'),
    agents: document.getElementById('agents'),
  };
  let refreshTimer = null;

  const esc = (s) => {
    const d = document.createElement('div');
    d.textContent = String(s || '');
    return d.innerHTML;
  };
  const fmt = (t) => (t ? new Date(t).toLocaleTimeString() : '--');
  const roomApi = () => '/api/rooms' + (ui.roomQ.value.trim() ? `?q=${encodeURIComponent(ui.roomQ.value.trim())}` : '');

  function renderRooms(rooms) {
    ui.rooms.innerHTML = (rooms || [])
      .map((r) => `<button class="rbtn ${r.roomId === roomId ? 'active' : ''}" data-room="${esc(r.roomId)}">${esc(r.title || r.roomId)}</button>`)
      .join('');
    ui.rooms.querySelectorAll('.rbtn').forEach((b) => {
      b.onclick = () => { location.href = '/dashboard?roomId=' + encodeURIComponent(b.dataset.room); };
    });
  }

  function renderAgent(a) {
    const usage = a.usage || {};
    return `<div class="agent"><div class="row"><div class="agent-avatar" style="background:${a.color || '#64748b'}">${esc(a.avatar || a.name[0])}</div><div><div class="name">${esc(a.name)}</div><div class="sub">${esc(a.model || 'unknown')}</div></div><span class="pill">${esc(a.status || 'idle')}</span></div><div class="line">调用: ${usage.invokeCount || 0} 次 · 平均输入: ${usage.avgInputTokens || 0} tokens</div><div class="line">消息: ${a.messageCount || 0} · 最近活跃: ${fmt(a.lastSeenAt || usage.lastInvokeAt)}</div></div>`;
  }

  async function refresh() {
    const [envInfo, dashRes, roomsRes] = await Promise.all([
      fetch('/api/env').then((r) => r.json()),
      fetch('/api/dashboard?roomId=' + encodeURIComponent(roomId)),
      fetch(roomApi()).then((r) => r.json()),
    ]);
    const dash = await dashRes.json().catch(() => ({}));
    const external = envInfo.publicBaseUrl && envInfo.publicBaseUrl !== `http://localhost:${envInfo.port}`;
    ui.env.textContent = `${envInfo.environment} / ${envInfo.branch} / ${envInfo.port}${external ? ` / ${envInfo.publicBaseUrl}` : ''}`;

    if (dashRes.ok) {
      const route = dash.route || {};
      const active = route.activeTask ? `${route.activeTask.target || ''} d${route.activeTask.depth || ''}` : '-';
      const dropped = (route.lastDropped || [])[0];
      const reason = route.reasonByRole ? Object.entries(route.reasonByRole).map(([k, v]) => `${k}:${v}`).join(',') : '-';
      const order = Array.isArray(route.executionOrder) ? route.executionOrder.join('>') : '-';
      const activeRoles = Array.isArray(route.activeRoles) ? route.activeRoles.join(',') : '-';
      const retrieval = `${route.retrievalType || 'all'}:${route.retrievalCount || 0}`;
      ui.stats.innerHTML = [
        ['总消息', String(dash.totalMessages || 0)],
        ['Agent 连续轮次', String(dash.agentTurns || 0)],
        ['路由队列', String(route.queued || 0)],
        ['最大深度', String(route.maxDepth || 10)],
      ].map(x => `<div class="kv"><div class="k">${esc(x[0])}</div><div class="v">${esc(x[1])}</div></div>`).join('');
      ui.route.textContent = `active=${active} | activeRoles=${activeRoles} | reason=${reason} | order=${order} | retrieval=${retrieval}${dropped ? ` | dropped=${dropped.reason}/${dropped.target}/d${dropped.depth}` : ''}`;
      ui.agents.innerHTML = (dash.agents || []).map(renderAgent).join('');
    } else {
      ui.stats.innerHTML = '<div class="k">dashboard error</div>';
      ui.route.textContent = String(dash.error || dashRes.status);
      ui.agents.innerHTML = '';
    }

    renderRooms(roomsRes.rooms || []);
  }

  function scheduleRefresh(delay = 300) {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refresh().catch(() => {});
    }, delay);
  }

  async function connectEvents() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const t = await fetch('/api/ws-token?roomId=' + encodeURIComponent(roomId)).then((r) => r.json());
    const ws = new WebSocket(`${proto}//${location.host}/?token=${encodeURIComponent(t.token || '')}&roomId=${encodeURIComponent(roomId)}`);
    ws.onmessage = () => scheduleRefresh();
    ws.onclose = () => setTimeout(() => connectEvents().catch(() => {}), 2000);
  }

  ui.toChat.onclick = () => { location.href = '/?roomId=' + encodeURIComponent(roomId); };
  ui.toAdmin.onclick = () => { location.href = '/admin'; };
  ui.refresh.onclick = () => refresh().catch(() => {});
  ui.roomQ.oninput = () => refresh().catch(() => {});

  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), 15000);
  connectEvents().catch(() => {});
})();
