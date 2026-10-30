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
  anchorWall: 0,
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
  const covers = (d.visual_identity && d.visual_identity.cover) ||
                 (item.album && item.album.images) ||
                 (d.album && d.album.images) || [];
  const chosenCover =
    covers.find(c => c.size === 'xlarge') ||
    covers.find(c => c.size === 'large') ||
    covers[0];
  const url = chosenCover ? (chosenCover.url || chosenCover) : undefined;
  const artwork = typeof url === 'string' && /^https:\/\/(i|mosaic)\.scdn\.co\//.test(url) ? url : undefined;

  let artistNames = '';
  if (Array.isArray(d.creators) && d.creators.length > 0) {
    artistNames = d.creators
      .map(c => {
        if (!c) return '';
        if (typeof c === 'string') return c;
        return (
          (c.entity && c.entity.decorations && c.entity.decorations.identity && c.entity.decorations.identity.name) ||
          (c.entity && c.entity.name) ||
          (c.decorations && c.decorations.identity && c.decorations.identity.name) ||
          (c.identity && c.identity.name) ||
          c.name ||
          ''
        );
      })
      .filter(Boolean)
      .join(', ');
  }

  if (!artistNames && Array.isArray(d.artists) && d.artists.length > 0) {
    artistNames = d.artists
      .map(a => (typeof a === 'string' ? a : a.name || ''))
      .filter(Boolean)
      .join(', ');
  }

  if (!artistNames && Array.isArray(item.artists) && item.artists.length > 0) {
    artistNames = item.artists
      .map(a => (typeof a === 'string' ? a : a.name || ''))
      .filter(Boolean)
      .join(', ');
  }

  if (!artistNames) {
    artistNames = d.artist_name || d.artist || item.artist_name || item.artist || '';
  }

  const parentAlbum =
    (d.parent && d.parent.entity && d.parent.entity.decorations && d.parent.entity.decorations.identity && d.parent.entity.decorations.identity.name) ||
    (d.parent && d.parent.entity && d.parent.entity.name) ||
    (d.album && (d.album.name || d.album)) ||
    (item.album && (item.album.name || item.album)) ||
    d.album_name ||
    item.album_name ||
    '';

  const trackName =
    (d.identity && d.identity.name) ||
    item.name ||
    d.name ||
    'Untitled';

  const durationMs =
    (d.playback && d.playback.duration_ms) ||
    item.duration_ms ||
    d.duration_ms ||
    0;

  return {
    uri: item.uri,
    name: trackName,
    artist: artistNames || '',
    album: typeof parentAlbum === 'string' ? parentAlbum : '',
    durationMs: Number(durationMs) || 0,
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
    if (nextState && typeof nextState === 'object' && !nextState.anchorWall) {
      nextState.anchorWall = Date.now();
    }
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
        // Request auth state first. Playback state & queue are only requested after auth is confirmed.
        try {
          this.send({ command: 'get_auth_state' });
        } catch (err) {
          this.reportError(err.message);
        }
      });

      ws.on('message', (raw) => {
        if (this.socket !== ws || this.stopped) return;
        let parsed;
        try {
          parsed = JSON.parse(raw.toString('utf8'));
        } catch {
          this.reportError('Invalid JSON received from Soloist');
          return;
        }
        try {
          this.handleEvent(parsed);
        } catch (err) {
          this.reportError(err.message || 'Error processing Soloist event');
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
        anchorWall: wall,
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
            anchorWall: prev.anchorWall || wall,
            error: undefined,
          });
          try {
            this.send({ command: 'get_state' });
            this.send({ command: 'get_queue', limit: 50 });
          } catch (err) {
            this.reportError(err.message);
          }
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
        const pos = e.position ? anchorPosition(e.position) : { positionMs: 0, anchorMono: mono, anchorWall: wall, speed: 0 };
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
        const isPlaying = status === 'playing';
        const currentPos = this.getProgressMs();
        this.update({
          ...prev,
          status,
          speed: isPlaying ? prev.speed || 1 : 0,
          positionMs: currentPos,
          anchorMono: mono,
          anchorWall: wall,
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
          anchorWall: wall,
          speed: 0,
          error: undefined,
        });
        if (this.state.loggedIn) {
          try {
            this.send({ command: 'get_state' });
          } catch (err) {
            this.reportError(err.message);
          }
        }
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
          const isPlaying = prev.status === 'playing';
          this.update({
            ...prev,
            volume: e.volume,
            ...(isPlaying ? {
              positionMs: this.getProgressMs(),
              anchorMono: mono,
              anchorWall: wall,
            } : {}),
          });
        }
        break;
      }

      case 'options_changed': {
        if (e.options) {
          const isPlaying = prev.status === 'playing';
          this.update({
            ...prev,
            shuffle: Boolean(e.options.shuffle),
            repeat: e.options.repeat || 'off',
            ...(isPlaying ? {
              positionMs: this.getProgressMs(),
              anchorMono: mono,
              anchorWall: wall,
            } : {}),
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
        if (e.ok === false) {
          const reason = e.message || `Command '${e.command}' was rejected by Soloist`;
          this.reportError(reason);
        } else {
          const isPlaying = prev.status === 'playing';
          this.update({
            ...prev,
            lastAccepted: e.command,
            ...(isPlaying ? {
              positionMs: this.getProgressMs(),
              anchorMono: mono,
              anchorWall: wall,
            } : {}),
          });
        }
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
    const mono = performance.now();
    const wall = Date.now();
    const target = Math.max(0, Math.round(positionMs));
    this.update({
      ...this.state,
      positionMs: target,
      anchorMono: mono,
      anchorWall: wall,
    });
    this.send({ command: 'seek', position_ms: target });
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
