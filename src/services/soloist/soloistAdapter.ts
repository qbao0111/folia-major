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
    this.state = incoming;

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

    for (const listener of this.listeners) {
      try {
        listener(incoming);
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
}

export const soloistAdapter: SoloistAdapter = new ElectronSoloistAdapter();

export const getSoloistPosition = (): number => {
  return soloistAdapter.getProgressSec();
};
