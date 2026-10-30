// src/services/soloist/soloistPlayback.ts
// Soloist playback route orchestration, track adoption, and state synchronization.

import type { SongResult } from '../../types';
import { PlayerState } from '../../types';
import {
  setPlayerState,
  setDuration,
  setPlaybackRoute,
  setCachedCoverUrl,
  setAudioSrc,
  setPlayQueue,
  setLyricsState,
  setCurrentSong,
  usePlaybackStore,
} from '../../stores/usePlaybackStore';
import { makeSongCurrent } from '../../components/app/playback/currentSong';
import { loadOnlineSongLyrics } from '../onlinePlayback';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { runsOnWindows } from '../../utils/platform';
import { soloistAdapter, setSoloistPlaybackSyncHandler } from './soloistAdapter';
import { useSoloistSettingsStore } from './useSoloistSettingsStore';
import type { SoloistPlaybackState, SoloistPlaybackStatus, SoloistTrack } from './types';

export { soloistAdapter, isSoloistRoute, getSoloistPosition } from './soloistAdapter';

// Pinned platform constants for architectural compliance
const SP_PROVIDER = 'spotify';
const SP_URI_PREFIX = 'spotify:track:';

let activeAdoptedTrackId: string | number | null = null;
let activeLyricTrackId: string | number | null = null;

/**
 * Determines whether a song is eligible to be played through the Soloist backend.
 */
export function isSoloistEligible(song: SongResult): boolean {
  if (song.sourceRef?.kind !== 'online' || song.sourceRef.providerId !== SP_PROVIDER) {
    return false;
  }
  const settings = useSoloistSettingsStore.getState();
  return runsOnWindows() && settings.soloistEnabled && settings.backend === 'soloist';
}

/**
 * Initiates Soloist playback for an eligible song.
 */
export async function playSoloistTrack(song: SongResult): Promise<void> {
  setPlaybackRoute('soloist');
  setDuration(song.durationMs ? song.durationMs / 1000 : 0);
  const uri = `${SP_URI_PREFIX}${song.id}`;
  await soloistAdapter.play(uri);
  await soloistAdapter.waitForPlayback(8000);
}

/**
 * Loads lyrics for an active Soloist track.
 */
export async function loadSoloistTrackLyrics(song: SongResult): Promise<void> {
  const trackId = song.id;
  activeLyricTrackId = trackId;

  try {
    const accounts = useOnlineProviderAccountStore.getState().accounts as Record<string, { id?: string | number } | undefined>;
    const userId = accounts[SP_PROVIDER]?.id;
    await loadOnlineSongLyrics(song, null, userId, {
      isCurrent: () => {
        const current = usePlaybackStore.getState().currentSong;
        return activeLyricTrackId === trackId && current?.id === trackId;
      },
      onLyrics: (resolvedLyrics) => {
        if (activeLyricTrackId === trackId) {
          setLyricsState(resolvedLyrics);
        }
      },
      onPureMusicChange: (isPureMusic) => {
        if (activeLyricTrackId === trackId) {
          setCurrentSong(prev => {
            if (!prev || prev.id !== trackId) return prev;
            return { ...prev, isPureMusic };
          });
        }
      },
      onStateChange: (state) => {
        if (activeLyricTrackId === trackId) {
          setCurrentSong(prev => {
            if (!prev || prev.id !== trackId) return prev;
            return { ...prev, onlineLyricsState: state ?? undefined };
          });
        }
      },
      onDone: () => {},
    });
  } catch (err) {
    console.warn('[SoloistPlayback] Failed to load lyrics for track:', err);
  }
}

/**
 * Adopts a track currently playing or paused on Soloist into Folia's current song & lyrics.
 */
export async function adoptSoloistTrack(track: SoloistTrack, status: SoloistPlaybackStatus): Promise<void> {
  const trackUri = track.uri || '';
  if (!trackUri.startsWith(SP_URI_PREFIX)) return;
  const trackId = trackUri.slice(SP_URI_PREFIX.length);
  if (!trackId) return;

  const durationSec = track.durationMs ? track.durationMs / 1000 : 0;
  setDuration(durationSec);
  setCachedCoverUrl(track.artwork || null);
  setAudioSrc(null);

  if (status === 'playing') {
    setPlayerState(PlayerState.PLAYING);
  } else if (status === 'paused') {
    setPlayerState(PlayerState.PAUSED);
  }

  const adoptedSong: SongResult = {
    id: trackId,
    name: track.name || 'Unknown Track',
    artists: [{ id: '', name: track.artist || 'Unknown Artist' }],
    album: {
      id: '',
      name: track.album || '',
      coverUrl: track.artwork || '',
    },
    durationMs: track.durationMs || 0,
    sourceRef: { kind: 'online', providerId: SP_PROVIDER, mediaId: trackId },
  };

  makeSongCurrent(adoptedSong);

  const queue = usePlaybackStore.getState().playQueue;
  if (queue.length === 0) {
    setPlayQueue([adoptedSong]);
  }

  await loadSoloistTrackLyrics(adoptedSong);
}

/**
 * Handles incoming state changes from Soloist: adopts track and syncs lyrics whenever Soloist is active.
 */
export async function syncSoloistPlaybackState(incoming: SoloistPlaybackState): Promise<void> {
  const settings = useSoloistSettingsStore.getState();
  if (!runsOnWindows() || !settings.soloistEnabled || settings.backend !== 'soloist') {
    return;
  }

  const isSoloistSounding = (
    incoming.connection === 'connected' &&
    incoming.loggedIn &&
    incoming.active &&
    incoming.track !== null &&
    Boolean(incoming.track.uri) &&
    (incoming.status === 'playing' || incoming.status === 'paused')
  );

  if (!isSoloistSounding) {
    return;
  }

  if (usePlaybackStore.getState().playbackRoute !== 'soloist') {
    setPlaybackRoute('soloist');
    setAudioSrc(null);
  }

  if (incoming.status === 'playing') {
    if (usePlaybackStore.getState().playerState !== PlayerState.PLAYING) {
      setPlayerState(PlayerState.PLAYING);
    }
  } else if (incoming.status === 'paused') {
    if (usePlaybackStore.getState().playerState !== PlayerState.PAUSED) {
      setPlayerState(PlayerState.PAUSED);
    }
  }

  if (incoming.track?.durationMs) {
    const sec = incoming.track.durationMs / 1000;
    if (Math.abs(usePlaybackStore.getState().duration - sec) > 0.5) {
      setDuration(sec);
    }
  }

  const track = incoming.track;
  if (!track || !track.uri) return;

  const trackId = track.uri.startsWith(SP_URI_PREFIX) ? track.uri.slice(SP_URI_PREFIX.length) : '';
  if (!trackId) return;

  const currentSong = usePlaybackStore.getState().currentSong;
  const isSameTrack = (
    currentSong !== null &&
    currentSong.id === trackId &&
    currentSong.sourceRef?.kind === 'online' &&
    currentSong.sourceRef?.providerId === SP_PROVIDER
  );

  if (!isSameTrack) {
    activeAdoptedTrackId = trackId;
    await adoptSoloistTrack(track, incoming.status);
  } else if (!usePlaybackStore.getState().lyrics && activeLyricTrackId !== trackId) {
    await loadSoloistTrackLyrics(currentSong);
  }
}

// Register playback sync handler
setSoloistPlaybackSyncHandler((incoming) => {
  void syncSoloistPlaybackState(incoming);
});

/**
 * Transport controls for the Soloist route.
 */
export const soloistTransport = {
  play: (uri?: string) => soloistAdapter.play(uri),
  pause: () => soloistAdapter.pause(),
  resume: () => soloistAdapter.resume(),
  seek: (seconds: number) => soloistAdapter.seek(seconds * 1000),
  next: () => soloistAdapter.next(),
  previous: () => soloistAdapter.previous(),
  setVolume: (volume: number) => soloistAdapter.setVolume(volume),
};
