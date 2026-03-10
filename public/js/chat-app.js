(() => {
  const qs = new URLSearchParams(location.search);
  const roomId = (qs.get('roomId') || 'default').trim();
  const ui = {
    env: document.getElementById('env'),
    room: document.getElementById('room'),
    status: document.getElementById('status'),
    messages: document.getElementById('messages'),
    username: document.getElementById('username'),
    msg: document.getElementById('msg'),
    send: document.getElementById('send'),
    rooms: document.getElementById('rooms'),
    newRoom: document.getElementById('new-room'),
    delRoom: document.getElementById('del-room'),
    roomQ: document.getElementById('room-q'),
    sendMode: document.getElementById('send-mode'),
    toDashboard: document.getElementById('to-dashboard'),
    toAdmin: document.getElementById('to-admin'),
  };

  let ws;
  let isComposing = false;
  let refreshTimer = null;
  let roleMeta = {};

  const saved = localStorage.getItem('arena_name');
  if (saved) ui.username.value = saved;
  ui.username.onchange = () => localStorage.setItem('arena_name', ui.username.value || '镇元子');
  ui.room.textContent = `room: ${roomId}`;

  const fmt = (t) => (t ? new Date(t).toLocaleTimeString() : '--');
  const esc = (s) => {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  };
  const roomApi = () => '/api/rooms' + (ui.roomQ.value.trim() ? `?q=${encodeURIComponent(ui.roomQ.value.trim())}` : '');

  function getRole(name) {
    const m = roleMeta[name] || {};
    return {
      color: m.color || '#64748b',
      avatar: m.avatar || ((name || '?')[0] || '?'),
      model: m.model || '',
    };
  }

  function bubble(m) {
    const from = m.from || '';
    if (from === (ui.username.value || '镇元子')) return 'mine';
    return 'other';
  }

  function uline(m) {
    const usage = m.usage || null;
    const role = getRole(m.from);
    const model = role.model || '';
    if (!model && !usage) return '';
    const modelPart = model ? `model ${model}` : '';
    const tokenPart = usage
      ? `tokens in ${usage.inputTokens || 0} / out ${usage.outputTokens || 0}${usage.cachedInputTokens ? ` / cached ${usage.cachedInputTokens}` : ''}`
      : '';
    return `<div class="u">${[modelPart, tokenPart].filter(Boolean).join(' · ')}</div>`;
  }

  function isNearBottom() {
    const gap = ui.messages.scrollHeight - ui.messages.scrollTop - ui.messages.clientHeight;
    return gap < 72;
  }

  function scrollToBottom() {
    ui.messages.scrollTop = ui.messages.scrollHeight;
  }

  function renderRooms(rooms) {
    ui.rooms.innerHTML = (rooms || [])
      .map((r) => `<button class="rbtn ${r.roomId === roomId ? 'active' : ''}" data-room="${esc(r.roomId)}">${esc(r.title || r.roomId)}</button>`)
      .join('');
    ui.rooms.querySelectorAll('.rbtn').forEach((b) => {
      b.onclick = () => { location.href = '/?roomId=' + encodeURIComponent(b.dataset.room); };
    });
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

    roleMeta = {};
    for (const role of dash.agents || []) {
      roleMeta[role.name] = {
        color: role.color || '#64748b',
        avatar: role.avatar || ((role.name || '?')[0] || '?'),
        model: role.model || '',
      };
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

  function renderMsg(m, options = {}) {
    const shouldStickBottom = options.forceScroll || isNearBottom();

    if (m.type === 'system') {
      const div = document.createElement('div');
      div.className = 'msg system';
      div.textContent = m.text || m.content || '';
      ui.messages.appendChild(div);
      if (shouldStickBottom) scrollToBottom();
      return;
    }

    const cls = bubble(m);
    const role = getRole(m.from || '');
    const row = document.createElement('div');
    row.className = 'msg-row ' + (cls === 'mine' ? 'mine' : '');

    const a = document.createElement('div');
    a.className = 'msg-avatar';
    a.style.background = role.color;
    a.textContent = role.avatar;

    const b = document.createElement('div');
    b.className = 'msg ' + cls;
    b.innerHTML = `<div class="m">${esc(m.from || 'unknown')} · ${fmt(m.timestamp)}</div><div style="white-space:pre-wrap">${esc(m.text || m.content || '')}</div>${uline(m)}`;

    if (cls === 'mine') {
      row.appendChild(b);
      row.appendChild(a);
    } else {
      row.appendChild(a);
      row.appendChild(b);
    }
    ui.messages.appendChild(row);

    if (shouldStickBottom) scrollToBottom();
  }

  function adjustComposerHeight() {
    ui.msg.style.height = 'auto';
    ui.msg.style.height = `${Math.min(ui.msg.scrollHeight, 140)}px`;
  }

  async function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const t = await fetch('/api/ws-token?roomId=' + encodeURIComponent(roomId)).then((r) => r.json());
    ws = new WebSocket(`${proto}//${location.host}/?token=${encodeURIComponent(t.token || '')}&roomId=${encodeURIComponent(roomId)}`);

    ws.onopen = () => { ui.status.textContent = 'online'; scheduleRefresh(0); };
    ws.onclose = () => { ui.status.textContent = 'reconnecting...'; setTimeout(connect, 2000); };
    ws.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.type === 'history') {
        ui.messages.innerHTML = '';
        (d.messages || []).forEach((m) => renderMsg(m));
        scrollToBottom();
      } else {
        renderMsg(d);
      }
      scheduleRefresh();
    };
  }

  async function createRoom() {
    const raw = prompt('输入新聊天窗口 ID（英文/数字/.-_）');
    if (!raw) return;
    const id = raw.trim();
    if (!id) return;
    const r = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: id, title: id, createdBy: ui.username.value || '镇元子' }),
    });
    const d = await r.json();
    if (!r.ok) return alert('创建失败: ' + (d.error || r.status));
    location.href = '/?roomId=' + encodeURIComponent(d.roomId);
  }

  async function deleteRoom() {
    if (roomId === 'default') return alert('default 房间不能删除');
    if (!confirm(`确认删除房间 ${roomId} 及其 Redis 数据？`)) return;
    const r = await fetch('/api/rooms?roomId=' + encodeURIComponent(roomId), { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok) return alert('删除失败: ' + (d.error || r.status));
    location.href = '/?roomId=default';
  }

  function send() {
    const text = ui.msg.value.trim();
    if (!text || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ from: ui.username.value || '镇元子', text, type: 'chat', timestamp: Date.now(), roomId }));
    ui.msg.value = '';
    adjustComposerHeight();
    scrollToBottom();
    ui.msg.focus();
  }

  ui.send.onclick = send;
  ui.roomQ.oninput = () => refresh().catch(() => {});
  ui.newRoom.onclick = () => createRoom().catch(() => {});
  ui.delRoom.onclick = () => deleteRoom().catch(() => {});
  ui.toDashboard.onclick = () => { location.href = '/dashboard?roomId=' + encodeURIComponent(roomId); };
  ui.toAdmin.onclick = () => { location.href = '/admin'; };

  ui.msg.oninput = adjustComposerHeight;
  ui.msg.onfocus = () => { setTimeout(() => { ui.msg.scrollIntoView({ block: 'nearest', inline: 'nearest' }); scrollToBottom(); }, 120); };
  ui.msg.oncompositionstart = () => { isComposing = true; };
  ui.msg.oncompositionend = () => { isComposing = false; };
  ui.msg.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    if (isComposing || e.isComposing || e.keyCode === 229) return;
    const mode = ui.sendMode.value;
    if (mode === 'enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
    if (mode === 'shift_enter' && e.shiftKey) { e.preventDefault(); send(); }
  };

  adjustComposerHeight();
  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), 15000);
  connect().catch(() => { ui.status.textContent = 'connect failed'; });
})();
