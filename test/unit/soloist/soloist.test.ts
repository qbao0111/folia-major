import { describe, expect, it } from 'vitest';
import { normalizeSoloistTrack, initialSoloistState } from '../../../electron/spotify/soloist/soloistEngine.cjs';
import { parseLoopbackEndpoint } from '../../../electron/spotify/soloist/soloistService.cjs';
import { isSoloistRoute, soloistAdapter } from '../../../src/services/soloist/soloistAdapter';
import { setPlaybackRoute } from '../../../src/stores/usePlaybackStore';

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
