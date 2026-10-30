// src/services/soloist/types.ts
// Typed contracts for the Soloist playback engine adapter.

export interface SoloistTrack {
  uri: string;
  name: string;
  artist: string;
  album: string;
  artwork?: string;
  durationMs: number;
}

export interface SoloistQueueEntry {
  uid: string;
  source: string;
  item: SoloistTrack;
}

export type SoloistConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export type SoloistPlaybackStatus = 'idle' | 'playing' | 'paused' | 'buffering';

export interface SoloistPlaybackState {
  connection: SoloistConnectionStatus;
  loggedIn: boolean;
  active: boolean;
  deviceName: string;
  status: SoloistPlaybackStatus;
  track: SoloistTrack | null;
  positionMs: number;
  anchorMono: number;
  speed: number;
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'context' | 'track';
  queue: SoloistQueueEntry[];
  actions: string[];
  error?: string;
  lastAccepted?: string;
}

export const initialSoloistPlaybackState = (): SoloistPlaybackState => ({
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
});

export interface SoloistAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): SoloistPlaybackState;
  getCurrentTrack(): SoloistTrack | null;
  getProgressSec(): number;
  getProgressMs(): number;
  play(uri?: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setShuffle(enabled: boolean): Promise<void>;
  setRepeat(mode: 'off' | 'context' | 'track'): Promise<void>;
  addToQueue(uri: string): Promise<void>;
  waitForPlayback(timeoutMs?: number): Promise<SoloistPlaybackState>;
  subscribe(callback: (state: SoloistPlaybackState) => void): () => void;
}
