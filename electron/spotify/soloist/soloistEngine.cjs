// electron/spotify-soloist/soloistEngine.cjs
// Manages the WebSocket client connection to the local Spotify Soloist daemon.

const WebSocket = require('ws');
const { performance } = require('node:perf_hooks');

const initialSoloistState = () => ({
  connection: 'disconnected',
  loggedIn: false,
  active: false,
  deviceName: 'Folia',
  status: 'idle',
  track: null,
  positionMs: 0,
  anchorMono: 0,
  speed: 0,
  volume: 50,
  shuffle: false,
  repeat: 'off',
  queue: [],
  actions: [],
  error: undefined,
  lastAccepted: undefined,
});

/**
 * Normalizes Soloist entity item into a clean Track model.
 */
function normalizeSoloistTrack(item) {
  if (!item || !item.uri) return null;
  const d = item.decorations || {};
  const covers = (d.visual_identity && d.visual_identity.cover) || [];
  const chosenCover =
    covers.find(c => c.size === 'xlarge') ||
    covers.find(c => c.size === 'large') ||
    covers[0];
  const url = chosenCover ? chosenCover.url : undefined;
  const artwork = url && /^https:\/\/(i|mosaic)\.scdn\.co\//.test(url) ? url : undefined;

  const creators = d.creators || [];
  const artistNames = creators
    .map(c => c.entity && c.entity.decorations && c.entity.decorations.identity && c.entity.decorations.identity.name)
    .filter(Boolean)
    .join(', ');

  const parentAlbum =
    d.parent &&
    d.parent.entity &&
    d.parent.entity.decorations &&
    d.parent.entity.decorations.identity &&
    d.parent.entity.decorations.identity.name;

  return {
    uri: item.uri,
    name: (d.identity && d.identity.name) || 'Untitled',
    artist: artistNames || '',
    album: parentAlbum || '',
    durationMs: (d.playback && d.playback.duration_ms) || 0,
    artwork,
  };
}

class SpotifySoloistEngine {
  /**
   * @param {() => Promise<string>} endpointResolver
   * @param {number} [retryMs=500]
   */
  constructor(endpointResolver, retryMs = 500) {
    this.endpoint = endpointResolver;
    this.retryMs = retryMs;
    this.state = initialSoloistState();
    this.socket = null;
    this.timer = null;
    this.stopped = true;
    this.attempts = 0;
    this.generation = 0;
    this.listeners = new Set();
  }

  getStatus = () => this.state;

  getCurrentTrack = () => this.state.track;

  getProgressMs = () => {
    const s = this.state;
    if (s.status === 'playing' && s.connection === 'connected') {
      const elapsed = Math.max(0, performance.now() - s.anchorMono) * (s.speed || 1);
      const total = s.positionMs + elapsed;
      return s.track?.durationMs ? Math.min(s.track.durationMs, Math.max(0, total)) : Math.max(0, total);
    }
    return Math.max(0, s.positionMs);
  };

  getProgressSec = () => this.getProgressMs() / 1000;

  getQueue = () => this.state.queue;

  subscribe(cb) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  update(nextState) {
    this.state = nextState;
    for (const listener of this.listeners) {
      try {
        listener(nextState);
      } catch (err) {
        console.error('[SoloistEngine] Listener error:', err);
      }
    }
  }

  reportError(message) {
    console.warn('[SoloistEngine] Error:', message);
    this.update({ ...this.state, error: message });
  }

  async connect() {
    if (!this.stopped && this.socket) return;
    this.stopped = false;
    this.attempts = 0;
    this.generation++;
    await this.open();
  }

  async open() {
    if (this.stopped) return;
    const currentGen = this.generation;
    this.update({
      ...this.state,
      connection: this.attempts > 0 ? 'reconnecting' : 'connecting',
    });

    try {
      const endpoint = await this.endpoint();
      if (!/^ws:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) {
        throw new Error('Soloist endpoint must be an IPv4 loopback address');
      }

      if (this.stopped || currentGen !== this.generation) return;

      const ws = new WebSocket(endpoint, {
        maxPayload: 4 * 1024 * 1024,
        handshakeTimeout: 5000,
      });
      this.socket = ws;

      ws.on('open', () => {
        if (this.socket !== ws || this.stopped) return;
        this.attempts = 0;
        this.update({
          ...this.state,
          connection: 'connected',
          error: undefined,
        });
        // Request immediate state & auth sync
        this.send({ command: 'get_auth_state' });
        this.send({ command: 'get_state' });
        this.send({ command: 'get_queue', limit: 50 });
      });

      ws.on('message', (raw) => {
        if (this.socket !== ws || this.stopped) return;
        try {
          const parsed = JSON.parse(raw.toString('utf8'));
          this.handleEvent(parsed);
        } catch {
          this.reportError('Invalid JSON received from Soloist');
        }
      });

      ws.on('error', (err) => {
        if (this.socket === ws) {
          console.warn('[SoloistEngine] WebSocket error:', err.message);
          this.reportError('Cannot reach Soloist WebSocket. Reconnecting…');
        }
      });

      ws.on('close', () => {
        if (this.socket === ws) {
          this.retry();
        }
      });
    } catch {
      if (currentGen === this.generation) {
        this.retry();
      }
    }
  }

  retry() {
    if (this.stopped) return;
    this.update({
      ...this.state,
      connection: 'reconnecting',
      error: 'Soloist disconnected. Waiting for reconnection…',
    });
    if (this.timer) clearTimeout(this.timer);
    const delayMs = Math.min(10000, this.retryMs * Math.pow(2, Math.min(this.attempts++, 5)));
    this.timer = setTimeout(() => {
      void this.open();
    }, delayMs);
  }

  async disconnect() {
    this.stopped = true;
    this.generation++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      try {
        ws.terminate();
      } catch {
        // Ignore termination error
      }
    }
    this.update(initialSoloistState());
  }

  send(command) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Soloist is not connected');
    }
    if (!this.state.loggedIn && command.command !== 'get_auth_state') {
      throw new Error('Pair Spotify with Folia first');
    }
    this.socket.send(JSON.stringify({ type: 'command', ...command }));
  }

  handleEvent(e) {
    if (!e || typeof e !== 'object' || !e.type) return;
    const wall = Date.now();
    const mono = performance.now();
    const prev = this.state;

    const anchorPosition = (pos) => {
      const positionMs = Number(pos.position_ms) || 0;
      const timestampMs = Number(pos.timestamp_ms) || wall;
      const speed = Number(pos.speed) || 0;
      const elapsed = Math.max(0, wall - timestampMs) * speed;
      return {
        positionMs: Math.max(0, positionMs + elapsed),
        anchorMono: mono,
        speed,
      };
    };

    switch (e.type) {
      case 'auth_state': {
        const loggedIn = Boolean(e.logged_in);
        const isActive = Boolean(e.is_active);
        const deviceName = e.device_name || prev.deviceName;
        if (loggedIn) {
          this.update({
            ...prev,
            loggedIn: true,
            active: isActive,
            deviceName,
            error: undefined,
          });
          this.send({ command: 'get_state' });
          this.send({ command: 'get_queue', limit: 50 });
        } else {
          this.update({
            ...initialSoloistState(),
            connection: prev.connection,
            deviceName,
          });
        }
        break;
      }

      case 'playback_state': {
        const track = normalizeSoloistTrack(e.item);
        const pos = e.position ? anchorPosition(e.position) : { positionMs: 0, anchorMono: mono, speed: 0 };
        this.update({
          ...prev,
          status: e.status || 'idle',
          track: track || prev.track,
          ...pos,
          volume: typeof e.volume === 'number' ? e.volume : prev.volume,
          active: Boolean(e.is_active),
          shuffle: Boolean(e.options?.shuffle),
          repeat: e.options?.repeat || 'off',
          actions: e.available_actions ? Object.keys(e.available_actions) : [],
          error: undefined,
        });
        break;
      }

      case 'playback_changed': {
        const status = e.status || 'idle';
        this.update({
          ...prev,
          status,
          speed: status === 'playing' ? prev.speed || 1 : 0,
          anchorMono: mono,
          error: undefined,
        });
        break;
      }

      case 'track_changed': {
        const track = normalizeSoloistTrack(e.item);
        this.update({
          ...prev,
          track: track || prev.track,
          positionMs: 0,
          anchorMono: mono,
          speed: 0,
          error: undefined,
        });
        this.send({ command: 'get_state' });
        break;
      }

      case 'position_sync': {
        if (e.position) {
          this.update({
            ...prev,
            ...anchorPosition(e.position),
          });
        }
        break;
      }

      case 'queue_changed': {
        const upcoming = Array.isArray(e.upcoming) ? e.upcoming : [];
        const normalizedQueue = upcoming
          .map(entry => {
            const track = normalizeSoloistTrack(entry.item);
            return track ? { uid: entry.uid, source: entry.source, item: track } : null;
          })
          .filter(Boolean);
        this.update({
          ...prev,
          queue: normalizedQueue,
        });
        break;
      }

      case 'volume_changed': {
        if (typeof e.volume === 'number') {
          this.update({ ...prev, volume: e.volume });
        }
        break;
      }

      case 'options_changed': {
        if (e.options) {
          this.update({
            ...prev,
            shuffle: Boolean(e.options.shuffle),
            repeat: e.options.repeat || 'off',
          });
        }
        break;
      }

      case 'device_changed': {
        this.update({
          ...prev,
          active: Boolean(e.is_active),
          deviceName: e.device_name || prev.deviceName,
        });
        break;
      }

      case 'command_result': {
        this.update({
          ...prev,
          lastAccepted: e.command,
        });
        break;
      }

      case 'error': {
        this.reportError(e.message || 'Soloist backend error');
        break;
      }

      default:
        break;
    }
  }

  // Playback commands
  play(uri) {
    this.send(uri ? { command: 'play', uri } : { command: 'play' });
  }

  pause() {
    this.send({ command: 'pause' });
  }

  resume() {
    this.play();
  }

  next() {
    this.send({ command: 'skip_next' });
  }

  previous() {
    this.send({ command: 'skip_prev' });
  }

  seek(positionMs) {
    this.send({ command: 'seek', position_ms: Math.max(0, Math.round(positionMs)) });
  }

  setVolume(volume) {
    this.send({ command: 'set_volume', volume: Math.max(0, Math.min(100, Math.round(volume))) });
  }

  setShuffle(enabled) {
    this.send({ command: 'set_shuffle', enabled: Boolean(enabled) });
  }

  setRepeat(repeatMode) {
    if (repeatMode === 'track') {
      this.send({ command: 'set_repeat_track', enabled: true });
    } else if (repeatMode === 'context') {
      this.send({ command: 'set_repeat_context', enabled: true });
    } else {
      this.send({ command: 'set_repeat_track', enabled: false });
      this.send({ command: 'set_repeat_context', enabled: false });
    }
  }

  addToQueue(uri) {
    this.send({ command: 'add_to_queue', uri });
  }
}

module.exports = {
  SpotifySoloistEngine,
  initialSoloistState,
  normalizeSoloistTrack,
};
