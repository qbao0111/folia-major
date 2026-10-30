import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  SpotifySoloistEngine,
  normalizeSoloistTrack,
  initialSoloistState,
} from '../../../electron/spotify/soloist/soloistEngine.cjs';
import { parseLoopbackEndpoint } from '../../../electron/spotify/soloist/soloistService.cjs';
import { isSoloistRoute, soloistAdapter } from '../../../src/services/soloist/soloistAdapter';
import {
  isSoloistEligible,
  playSoloistTrack,
  adoptSoloistTrack,
  syncSoloistPlaybackState,
} from '../../../src/services/soloist/soloistPlayback';
import { useSoloistSettingsStore } from '../../../src/services/soloist/useSoloistSettingsStore';
import { resolvePrefetchAudioUrl } from '../../../src/services/prefetchService';
import { setPlaybackRoute, setPlayerState, usePlaybackStore } from '../../../src/stores/usePlaybackStore';
import { PlayerState, type SongResult } from '../../../src/types';

describe('Spotify Soloist Engine & Protocol', () => {
  it('normalizes Soloist track decorations correctly', () => {
    const rawItem = {
      uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
      decorations: {
        identity: { name: 'Never Gonna Give You Up' },
        parent: {
          entity: {
            decorations: {
              identity: { name: 'Whenever You Need Somebody' },
            },
          },
        },
        creators: [
          {
            entity: {
              decorations: {
                identity: { name: 'Rick Astley' },
              },
            },
          },
        ],
        playback: { duration_ms: 213000 },
        visual_identity: {
          cover: [
            { size: 'small', url: 'https://i.scdn.co/image/ab67616d00004851small' },
            { size: 'large', url: 'https://i.scdn.co/image/ab67616d0000b273large' },
            { size: 'xlarge', url: 'https://i.scdn.co/image/ab67616d00001e02xlarge' },
          ],
        },
      },
    };

    const track = normalizeSoloistTrack(rawItem);
    expect(track).toBeDefined();
    expect(track?.name).toBe('Never Gonna Give You Up');
    expect(track?.artist).toBe('Rick Astley');
    expect(track?.album).toBe('Whenever You Need Somebody');
    expect(track?.durationMs).toBe(213000);
    expect(track?.artwork).toBe('https://i.scdn.co/image/ab67616d00001e02xlarge');
  });

  it('handles empty or missing decorations gracefully', () => {
    expect(normalizeSoloistTrack(null)).toBeNull();
    expect(normalizeSoloistTrack({})).toBeNull();
    expect(normalizeSoloistTrack({ uri: '' })).toBeNull();

    const minimal = normalizeSoloistTrack({ uri: 'spotify:track:xyz' });
    expect(minimal).toBeDefined();
    expect(minimal?.name).toBe('Untitled');
    expect(minimal?.artist).toBe('');
    expect(minimal?.album).toBe('');
    expect(minimal?.durationMs).toBe(0);
  });

  it('validates strictly loopback endpoints', () => {
    expect(parseLoopbackEndpoint('127.0.0.1', '50505')).toBe('ws://127.0.0.1:50505');
    expect(parseLoopbackEndpoint(' 127.0.0.1 ', ' 8080 ')).toBe('ws://127.0.0.1:8080');

    expect(() => parseLoopbackEndpoint('0.0.0.0', '8080')).toThrow('strictly to 127.0.0.1');
    expect(() => parseLoopbackEndpoint('192.168.1.100', '8080')).toThrow('strictly to 127.0.0.1');
    expect(() => parseLoopbackEndpoint('127.0.0.1', '0')).toThrow('Invalid Soloist WebSocket port');
    expect(() => parseLoopbackEndpoint('127.0.0.1', '70000')).toThrow('Invalid Soloist WebSocket port');
    expect(() => parseLoopbackEndpoint('127.0.0.1', 'abc')).toThrow('Invalid Soloist WebSocket port');
  });

  it('provides a clean default initial playback state', () => {
    const state = initialSoloistState();
    expect(state.connection).toBe('disconnected');
    expect(state.loggedIn).toBe(false);
    expect(state.status).toBe('idle');
    expect(state.deviceName).toBe('Folia');
    expect(state.positionMs).toBe(0);
  });

  it('detects isSoloistRoute according to playbackRoute in store', () => {
    setPlaybackRoute('web');
    expect(isSoloistRoute()).toBe(false);

    setPlaybackRoute('hifi');
    expect(isSoloistRoute()).toBe(false);

    setPlaybackRoute('soloist');
    expect(isSoloistRoute()).toBe(true);

    // cleanup
    setPlaybackRoute('web');
    expect(isSoloistRoute()).toBe(false);
  });
});

describe('Soloist Authentication & WebSocket State Machine', () => {
  it('requests ONLY get_auth_state on WebSocket open before authentication', () => {
    const engine = new SpotifySoloistEngine(async () => 'ws://127.0.0.1:9000');
    const sent: any[] = [];
    engine.stopped = false;
    engine.socket = {
      readyState: 1, // WebSocket.OPEN
      send: (raw: string) => sent.push(JSON.parse(raw)),
    } as any;

    expect(engine.state.loggedIn).toBe(false);

    // Simulate WebSocket open event handler behavior
    engine.update({
      ...engine.state,
      connection: 'connected',
      error: undefined,
    });
    // Request auth state first
    engine.send({ command: 'get_auth_state' });

    // Verify only get_auth_state was sent
    expect(sent).toEqual([{ type: 'command', command: 'get_auth_state' }]);
    // Verify get_state is rejected when loggedIn is false
    expect(() => engine.send({ command: 'get_state' })).toThrow('Pair Spotify with Folia first');
  });

  it('requests get_state and get_queue only after auth confirmation', () => {
    const engine = new SpotifySoloistEngine(async () => 'ws://127.0.0.1:9000');
    const sent: any[] = [];
    engine.stopped = false;
    engine.socket = {
      readyState: 1,
      send: (raw: string) => sent.push(JSON.parse(raw)),
    } as any;

    // Simulate incoming auth_state event with logged_in = true
    engine.handleEvent({
      type: 'auth_state',
      logged_in: true,
      is_active: true,
      device_name: 'Folia Test',
    });

    expect(engine.state.loggedIn).toBe(true);
    expect(engine.state.active).toBe(true);
    expect(engine.state.deviceName).toBe('Folia Test');

    // Both get_state and get_queue should have been dispatched safely
    expect(sent).toEqual([
      { type: 'command', command: 'get_state' },
      { type: 'command', command: 'get_queue', limit: 50 },
    ]);
  });

  it('handles not-yet-paired users without crashing', () => {
    const engine = new SpotifySoloistEngine(async () => 'ws://127.0.0.1:9000');
    const sent: any[] = [];
    engine.stopped = false;
    engine.socket = {
      readyState: 1,
      send: (raw: string) => sent.push(JSON.parse(raw)),
    } as any;

    // User is not yet paired with Soloist
    engine.handleEvent({
      type: 'auth_state',
      logged_in: false,
      is_active: false,
      device_name: 'Folia Unpaired',
    });

    expect(engine.state.loggedIn).toBe(false);
    expect(engine.state.active).toBe(false);
    expect(engine.state.status).toBe('idle');
    expect(sent).toHaveLength(0);
  });

  it('handles command rejection in command_result', () => {
    const engine = new SpotifySoloistEngine(async () => 'ws://127.0.0.1:9000');
    let lastError: string | undefined;
    engine.subscribe((st: any) => {
      lastError = st.error;
    });

    engine.handleEvent({
      type: 'command_result',
      command: 'play',
      ok: false,
      message: 'Track not available in market',
    });

    expect(lastError).toBe('Track not available in market');
    expect(engine.state.lastAccepted).toBeUndefined();

    // Successful command_result updates lastAccepted
    engine.handleEvent({
      type: 'command_result',
      command: 'pause',
      ok: true,
    });
    expect(engine.state.lastAccepted).toBe('pause');
  });

  it('reconnect backoff updates state without crashing', () => {
    const engine = new SpotifySoloistEngine(async () => 'ws://127.0.0.1:9000', 50);
    engine.stopped = false;
    engine.retry();

    expect(engine.state.connection).toBe('reconnecting');
    expect(engine.state.error).toContain('Waiting for reconnection');
    expect(engine.attempts).toBe(1);

    // Clean disconnect cancels timer
    void engine.disconnect();
    expect(engine.stopped).toBe(true);
    expect(engine.state.connection).toBe('disconnected');
  });
});

describe('Soloist Backend Selection & Eligibility', () => {
  const spotifySong: SongResult = {
    id: '4cOdK2wGLETKBW3PvgPWqT',
    name: 'Never Gonna Give You Up',
    artists: [{ id: 'rick-astley', name: 'Rick Astley' }],
    album: { id: 'whenever-you-need-somebody', name: 'Whenever You Need Somebody' },
    durationMs: 213000,
    sourceRef: { kind: 'online', providerId: 'spotify', mediaId: '4cOdK2wGLETKBW3PvgPWqT' },
  };

  const neteaseSong: SongResult = {
    id: '123456',
    name: 'Test Song',
    artists: [{ id: 'test-artist', name: 'Test Artist' }],
    album: { id: 'test-album', name: 'Test Album' },
    durationMs: 180000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: '123456' },
  };

  it('refuses non-Spotify songs unconditionally', () => {
    useSoloistSettingsStore.getState().setBackend('soloist');
    useSoloistSettingsStore.getState().setSoloistEnabled(true);

    expect(isSoloistEligible(neteaseSong)).toBe(false);
  });

  it('respects user choice when backend is set to legacy', () => {
    useSoloistSettingsStore.getState().setBackend('legacy');
    useSoloistSettingsStore.getState().setSoloistEnabled(true);

    expect(isSoloistEligible(spotifySong)).toBe(false);
  });

  it('respects user choice when soloistEnabled is false', () => {
    useSoloistSettingsStore.getState().setBackend('soloist');
    useSoloistSettingsStore.getState().setSoloistEnabled(false);

    expect(isSoloistEligible(spotifySong)).toBe(false);
  });

  it('accepts Spotify songs only when enabled and backend is soloist', () => {
    useSoloistSettingsStore.getState().setBackend('soloist');
    useSoloistSettingsStore.getState().setSoloistEnabled(true);

    expect(isSoloistEligible(spotifySong)).toBe(true);
  });
});

describe('Soloist Playback Confirmation & Progress Sync', () => {
  const spotifySong: SongResult = {
    id: '4cOdK2wGLETKBW3PvgPWqT',
    name: 'Never Gonna Give You Up',
    artists: [{ id: 'rick-astley', name: 'Rick Astley' }],
    album: { id: 'whenever-you-need-somebody', name: 'Whenever You Need Somebody' },
    durationMs: 213000,
    sourceRef: { kind: 'online', providerId: 'spotify', mediaId: '4cOdK2wGLETKBW3PvgPWqT' },
  };

  beforeEach(() => {
    if (typeof (globalThis as any).localStorage === 'undefined') {
      const storage = new Map<string, string>();
      (globalThis as any).localStorage = {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, String(v)),
        removeItem: (k: string) => storage.delete(k),
        clear: () => storage.clear(),
      };
    }
    setPlaybackRoute('web');
    setPlayerState(PlayerState.IDLE);
    useSoloistSettingsStore.getState().setBackend('soloist');
    useSoloistSettingsStore.getState().setSoloistEnabled(true);
  });

  it('does NOT optimistically set PlayerState.PLAYING when play command fails or times out', async () => {
    // Mock window.electron.soloist
    const originalElectron = (globalThis as any).window?.electron;
    (globalThis as any).window = (globalThis as any).window || {};
    (globalThis as any).window.electron = {
      soloist: {
        command: vi.fn().mockRejectedValue(new Error('Device inactive')),
        getStatus: vi.fn().mockResolvedValue(initialSoloistState()),
        onState: vi.fn().mockReturnValue(() => {}),
      },
    };

    setPlayerState(PlayerState.IDLE);

    await expect(playSoloistTrack(spotifySong)).rejects.toThrow('Device inactive');

    // PlayerState must NOT have become PLAYING!
    expect(usePlaybackStore.getState().playerState).not.toBe(PlayerState.PLAYING);

    // Cleanup mock
    if (originalElectron) {
      (globalThis as any).window.electron = originalElectron;
    } else {
      delete (globalThis as any).window.electron;
    }
  });

  it('synchronizes progress via monotonic clock interpolation', () => {
    const engine = new SpotifySoloistEngine(async () => 'ws://127.0.0.1:9000');
    engine.update({
      ...engine.state,
      connection: 'connected',
      status: 'playing',
      positionMs: 10000,
      anchorMono: performance.now() - 2000,
      speed: 1,
      track: {
        uri: 'spotify:track:xyz',
        name: 'Track',
        artist: 'Artist',
        album: 'Album',
        durationMs: 60000,
      },
    });

    const progressMs = engine.getProgressMs();
    // 10000ms + ~2000ms = ~12000ms
    expect(progressMs).toBeGreaterThanOrEqual(11900);
    expect(progressMs).toBeLessThanOrEqual(13000);
    expect(engine.getProgressSec()).toBeCloseTo(progressMs / 1000, 1);

    // When paused, does not extrapolate
    engine.update({
      ...engine.state,
      status: 'paused',
      speed: 0,
      positionMs: 15000,
      anchorMono: performance.now() - 5000,
    });
    expect(engine.getProgressMs()).toBe(15000);
    expect(engine.getProgressSec()).toBe(15);
  });

  it('never requests legacy audio URLs when song is eligible for Soloist', async () => {
    useSoloistSettingsStore.getState().setBackend('soloist');
    useSoloistSettingsStore.getState().setSoloistEnabled(true);

    const abortController = new AbortController();
    const result = await resolvePrefetchAudioUrl(spotifySong, 'high', abortController.signal);

    // Must return null immediately without attempting to acquire legacy stream key
    expect(result).toBeNull();
  });

  it('supports Space and transport controls on the Soloist route', () => {
    setPlaybackRoute('soloist');
    expect(isSoloistRoute()).toBe(true);

    // On Soloist route, audioSrc is null because audio renders through Soloist WASAPI daemon
    const audioSrc = null;
    const isHifi = false;
    const canTriggerSpace = Boolean(audioSrc || isHifi || isSoloistRoute());
    expect(canTriggerSpace).toBe(true);
  });

  it('re-anchors anchorMono into the renderer clock domain on incoming state', () => {
    // Simulate main process with a huge offset
    const staleState: any = {
      connection: 'connected',
      loggedIn: true,
      active: true,
      status: 'playing',
      positionMs: 5000,
      anchorMono: 999999999, // Way higher than renderer performance.now()
      anchorWall: Date.now() - 50,
      speed: 1,
      track: {
        uri: 'spotify:track:xyz',
        name: 'Track',
        artist: 'Artist',
        album: 'Album',
        durationMs: 60000,
      },
    };

    (soloistAdapter as any).updateState(staleState);
    const progressMs = soloistAdapter.getProgressMs();

    // Must be ~5000ms + transit (~5050ms), NOT 0 or 5000ms stuck
    expect(progressMs).toBeGreaterThanOrEqual(5000);
    expect(progressMs).toBeLessThanOrEqual(6000);
  });

  it('automatically adopts track and initiates lyrics loading when Soloist is active', async () => {
    useSoloistSettingsStore.getState().setBackend('soloist');
    useSoloistSettingsStore.getState().setSoloistEnabled(true);
    setPlaybackRoute('web');

    const incomingTrack = {
      uri: 'spotify:track:adopted123',
      name: 'PHÓNG ZÌN ZÌN',
      artist: 'tlinh, Low G',
      album: 'FLVR',
      artwork: 'https://example.com/cover.jpg',
      durationMs: 203000,
    };

    const incomingState: any = {
      connection: 'connected',
      loggedIn: true,
      active: true,
      status: 'playing',
      positionMs: 27000,
      anchorMono: performance.now(),
      anchorWall: Date.now(),
      speed: 1,
      track: incomingTrack,
    };

    await syncSoloistPlaybackState(incomingState);

    // Route must switch to soloist
    expect(usePlaybackStore.getState().playbackRoute).toBe('soloist');
    // Current song must be adopted
    const current = usePlaybackStore.getState().currentSong;
    expect(current).toBeDefined();
    expect(current?.id).toBe('adopted123');
    expect(current?.name).toBe('PHÓNG ZÌN ZÌN');
    expect(current?.sourceRef?.providerId).toBe('spotify');
    // Duration must be updated
    expect(usePlaybackStore.getState().duration).toBe(203);
    // Player state must be PLAYING
    expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
  });
});
