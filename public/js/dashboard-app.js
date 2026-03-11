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
    opsStrip: document.getElementById('ops-strip'),
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

  function pillClass(status) {
    if (status === 'active') return 'pill active';
    if (status === 'muted') return 'pill muted';
    return 'pill idle';
  }

  function renderAgent(a) {
    const usage = a.usage || {};
    return `<div class="agent">
      <div class="row">
        <div class="agent-avatar" style="background:${a.color || '#64748b'}">${esc(a.avatar || a.name[0])}</div>
        <div><div class="name">${esc(a.name)}</div><div class="sub">${esc(a.model || 'unknown')}</div></div>
        <span class="${pillClass(a.status)}">${esc(a.status || 'idle')}</span>
      </div>
      <div class="line">调用 ${usage.invokeCount || 0} 次 · 平均输入 ${usage.avgInputTokens || 0} tokens</div>
      <div class="line">消息 ${a.messageCount || 0} · 最近活跃 ${fmt(a.lastSeenAt || usage.lastInvokeAt)}</div>
    </div>`;
  }

  function renderMetric(label, value, desc) {
    return `<div class="metric"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${desc ? `<div class="desc">${esc(desc)}</div>` : ''}</div>`;
  }

  function riskLevel(route) {
    if (!route) return 'ok';
    if ((route.lastDropped || []).length > 0) return 'bad';
    if ((route.queued || 0) > 0) return 'warn';
    return 'ok';
  }

  function renderRoute(route) {
    if (!route) { ui.opsStrip.innerHTML = '<span class="badge neutral">无路由数据</span>'; return; }

    const badges = [];
    const active = route.activeTask ? `${route.activeTask.target || ''} d${route.activeTask.depth || ''}` : null;
    const risk = riskLevel(route);

    // Risk badge
    if (risk === 'bad') badges.push('<span class="badge bad">有掉队任务</span>');
    else if (risk === 'warn') badges.push('<span class="badge warn">队列排队中</span>');
    else badges.push('<span class="badge ok">运行正常</span>');

    // Active task
    if (active) badges.push(`<span class="badge neutral">当前: ${esc(active)}</span>`);

    // Active roles
    const activeRoles = Array.isArray(route.activeRoles) ? route.activeRoles : [];
    if (activeRoles.length > 0) badges.push(`<span class="badge neutral">活跃角色: ${esc(activeRoles.join(', '))}</span>`);

    // Execution order
    const order = Array.isArray(route.executionOrder) ? route.executionOrder : [];
    if (order.length > 0) badges.push(`<span class="badge neutral">执行序: ${esc(order.join(' → '))}</span>`);

    // Retrieval
    if (route.retrievalType || route.retrievalCount) {
      badges.push(`<span class="badge neutral">检索: ${esc(route.retrievalType || 'all')}:${route.retrievalCount || 0}</span>`);
    }

    // Reason by role
    if (route.reasonByRole) {
      const reasons = Object.entries(route.reasonByRole).map(([k, v]) => `${k}:${v}`);
      if (reasons.length > 0) badges.push(`<span class="badge neutral">原因: ${esc(reasons.join(', '))}</span>`);
    }

    // Dropped info
    const dropped = (route.lastDropped || [])[0];
    if (dropped) {
      badges.push(`<span class="badge bad">掉队: ${esc(dropped.reason)}/${esc(dropped.target)}/d${dropped.depth}</span>`);
    }

    ui.opsStrip.innerHTML = badges.join('');
  }

  function sortAgents(agents) {
    const order = { active: 0, idle: 1, muted: 2 };
    return [...(agents || [])].sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1));
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

      // Summary metrics
      ui.stats.innerHTML = [
        renderMetric('总消息', dash.totalMessages || 0, '当前房间消息总数'),
        renderMetric('Agent 连续轮次', dash.agentTurns || 0, '距上次人类消息'),
        renderMetric('路由队列', route.queued || 0, (route.queued || 0) > 0 ? '有任务等待执行' : '队列空闲'),
        renderMetric('最大深度', route.maxDepth || 10, '路由递归上限'),
      ].join('');

      // Ops strip
      renderRoute(route);

      // Agents sorted by status
      ui.agents.innerHTML = sortAgents(dash.agents).map(renderAgent).join('');
    } else {
      ui.stats.innerHTML = renderMetric('错误', dash.error || dashRes.status, '获取 dashboard 数据失败');
      ui.opsStrip.innerHTML = '<span class="badge bad">数据加载失败</span>';
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
