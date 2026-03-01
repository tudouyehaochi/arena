const WebSocket = require('ws');
const EventEmitter = require('events');

class AgentClient extends EventEmitter {
  constructor(name, url, roomId = 'default') {
    super();
    this.name = name;
    this.url = url || 'ws://localhost:3000';
    this.roomId = roomId;
    this._ws = null;
    this._reconnectTimer = null;
    this._connect();
  }

  _connect() {
    const u = new URL(this.url);
    u.searchParams.set('roomId', this.roomId);
    this._ws = new WebSocket(u.toString());

    this._ws.on('open', () => {
      this.emit('connected');
      // Announce presence
      this._send({
        from: this.name,
        text: `${this.name} joined`,
        type: 'system',
        timestamp: Date.now(),
        roomId: this.roomId,
      });
    });

    this._ws.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw); } catch { return; }

      if (data.type === 'history') {
        for (const msg of data.messages) {
          this.emit('message', msg);
        }
        return;
      }

      this.emit('message', data);

      if (data.type === 'approved') this.emit('approved', data);
      if (data.type === 'rejected') this.emit('rejected', data);
    });

    this._ws.on('close', () => {
      this.emit('disconnected');
      this._reconnectTimer = setTimeout(() => this._connect(), 2000);
    });

    this._ws.on('error', () => {
      // close event will fire after this, triggering reconnect
    });
  }

  _send(msg) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  }

  send(text) {
    this._send({
      from: this.name,
      text,
      type: 'chat',
      timestamp: Date.now(),
      roomId: this.roomId,
    });
  }

  requestApproval(description) {
    this._send({
      from: this.name,
      text: description,
      type: 'approval-request',
      timestamp: Date.now(),
      roomId: this.roomId,
    });
  }

  close() {
    clearTimeout(this._reconnectTimer);
    if (this._ws) this._ws.close();
  }
}

module.exports = { AgentClient };
