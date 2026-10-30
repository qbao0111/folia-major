// src/services/soloist/soloistAdapter.ts
// Renderer adapter for the Soloist engine.

import { PlayerState } from '../../types';
import { setPlayerState, setDuration, usePlaybackStore } from '../../stores/usePlaybackStore';
import {
  initialSoloistPlaybackState,
  type SoloistPlaybackState,
  type SoloistTrack,
  type SoloistAdapter,
} from './types';

export const isSoloistRoute = (): boolean => {
  return usePlaybackStore.getState().playbackRoute === 'soloist';
};

type PlaybackSyncHandler = (state: SoloistPlaybackState) => void;
let playbackSyncHandler: PlaybackSyncHandler | null = null;

export const setSoloistPlaybackSyncHandler = (handler: PlaybackSyncHandler) => {
  playbackSyncHandler = handler;
};

class ElectronSoloistAdapter implements SoloistAdapter {
  private state: SoloistPlaybackState = initialSoloistPlaybackState();
  private listeners = new Set<(state: SoloistPlaybackState) => void>();
  private unsubscribeIpc: (() => void) | null = null;
  private initialized = false;

  constructor() {
    this.init();
  }

  private init() {
    if (this.initialized || typeof window === 'undefined' || !window.electron?.soloist) return;
    this.initialized = true;

    // Listen to IPC broadcasts from the Electron main process
    this.unsubscribeIpc = window.electron.soloist.onState((incoming) => {
      this.updateState(incoming);
    });

    // Fetch initial status
    void window.electron.soloist.getStatus().then((initial) => {
      if (initial) this.updateState(initial);
    }).catch(() => {
      // not yet ready
    });
  }

  private updateState(incoming: SoloistPlaybackState) {
    // Re-anchor anchorMono in the Renderer process's own monotonic clock domain.
    const transitMs = incoming.anchorWall && incoming.status === 'playing'
      ? Math.max(0, Math.min(2000, Date.now() - incoming.anchorWall))
      : 0;

    this.state = {
      ...incoming,
      positionMs: incoming.positionMs + transitMs,
      anchorMono: performance.now(),
    };

    // Synchronize Folia player store when Soloist route is actively sounding
    if (isSoloistRoute()) {
      if (incoming.status === 'playing') {
        if (usePlaybackStore.getState().playerState !== PlayerState.PLAYING) {
          setPlayerState(PlayerState.PLAYING);
        }
      } else if (incoming.status === 'paused') {
        if (usePlaybackStore.getState().playerState !== PlayerState.PAUSED) {
          setPlayerState(PlayerState.PAUSED);
        }
      } else if (incoming.status === 'idle') {
        if (usePlaybackStore.getState().playerState !== PlayerState.IDLE) {
          setPlayerState(PlayerState.IDLE);
        }
      }

      if (incoming.track?.durationMs) {
        const sec = incoming.track.durationMs / 1000;
        if (Math.abs(usePlaybackStore.getState().duration - sec) > 0.5) {
          setDuration(sec);
        }
      }
    }

    if (playbackSyncHandler) {
      try {
        playbackSyncHandler(this.state);
      } catch (err) {
        console.error('[SoloistAdapter] Playback sync handler error:', err);
      }
    }

    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('[SoloistAdapter] Listener error:', err);
      }
    }
  }

  getStatus = (): SoloistPlaybackState => this.state;

  getCurrentTrack = (): SoloistTrack | null => this.state.track;

  getProgressMs = (): number => {
    const s = this.state;
    if (s.status === 'playing' && s.connection === 'connected') {
      const elapsed = Math.max(0, performance.now() - s.anchorMono) * (s.speed || 1);
      const total = s.positionMs + elapsed;
      return s.track?.durationMs ? Math.min(s.track.durationMs, Math.max(0, total)) : Math.max(0, total);
    }
    return Math.max(0, s.positionMs);
  };

  getProgressSec = (): number => {
    return this.getProgressMs() / 1000;
  };

  subscribe(callback: (state: SoloistPlaybackState) => void): () => void {
    this.listeners.add(callback);
    callback(this.state);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async connect(): Promise<void> {
    if (!window.electron?.soloist) return;
    await window.electron.soloist.start();
  }

  async disconnect(): Promise<void> {
    if (!window.electron?.soloist) return;
    await window.electron.soloist.stop();
  }

  async play(uri?: string): Promise<void> {
    if (!window.electron?.soloist) return;
    const res = await window.electron.soloist.command('play', { uri });
    if (!res.ok) throw new Error(res.error || 'Failed to play track in Soloist');
  }

  async pause(): Promise<void> {
    if (!window.electron?.soloist) return;
    const res = await window.electron.soloist.command('pause');
    if (!res.ok) throw new Error(res.error || 'Failed to pause Soloist');
  }

  async resume(): Promise<void> {
    if (!window.electron?.soloist) return;
    const res = await window.electron.soloist.command('resume');
    if (!res.ok) throw new Error(res.error || 'Failed to resume Soloist');
  }

  async next(): Promise<void> {
    if (!window.electron?.soloist) return;
    const res = await window.electron.soloist.command('next');
    if (!res.ok) throw new Error(res.error || 'Failed to skip in Soloist');
  }

  async previous(): Promise<void> {
    if (!window.electron?.soloist) return;
    const res = await window.electron.soloist.command('previous');
    if (!res.ok) throw new Error(res.error || 'Failed to return to previous track in Soloist');
  }

  async seek(positionMs: number): Promise<void> {
    if (!window.electron?.soloist) return;
    // Immediately anchor local position to eliminate UI jump before confirmation
    this.state = {
      ...this.state,
      positionMs: Math.max(0, positionMs),
      anchorMono: performance.now(),
    };
    const res = await window.electron.soloist.command('seek', { positionMs });
    if (!res.ok) throw new Error(res.error || 'Failed to seek in Soloist');
  }

  async setVolume(volume: number): Promise<void> {
    if (!window.electron?.soloist) return;
    const res = await window.electron.soloist.command('set-volume', { volume });
    if (!res.ok) throw new Error(res.error || 'Failed to set volume in Soloist');
  }

  async setShuffle(enabled: boolean): Promise<void> {
    if (!window.electron?.soloist) return;
    const res = await window.electron.soloist.command('set-shuffle', { enabled });
    if (!res.ok) throw new Error(res.error || 'Failed to set shuffle in Soloist');
  }

  async setRepeat(mode: 'off' | 'context' | 'track'): Promise<void> {
    if (!window.electron?.soloist) return;
    const res = await window.electron.soloist.command('set-repeat', { mode });
    if (!res.ok) throw new Error(res.error || 'Failed to set repeat in Soloist');
  }

  async addToQueue(uri: string): Promise<void> {
    if (!window.electron?.soloist) return;
    const res = await window.electron.soloist.command('add-to-queue', { uri });
    if (!res.ok) throw new Error(res.error || 'Failed to add track to Soloist queue');
  }

  waitForPlayback(timeoutMs = 6000): Promise<SoloistPlaybackState> {
    if (this.state.status === 'playing' && this.state.active) {
      return Promise.resolve(this.state);
    }

    return new Promise((resolve, reject) => {
      let unsub: (() => void) | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (unsub) {
          unsub();
          unsub = null;
        }
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error('Soloist playback start timed out waiting for active playback'));
      }, timeoutMs);

      unsub = this.subscribe((state) => {
        if (state.error) {
          cleanup();
          reject(new Error(state.error));
          return;
        }
        if (state.status === 'playing') {
          cleanup();
          resolve(state);
        }
      });
    });
  }
}

export const soloistAdapter: SoloistAdapter = new ElectronSoloistAdapter();

export const getSoloistPosition = (): number => {
  return soloistAdapter.getProgressSec();
};
