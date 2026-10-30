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
import { omni } from '../onlineMusic/omni';
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

let inFlightSoloistPlayController: AbortController | null = null;

/**
 * Initiates Soloist playback for an eligible song.
 */
export async function playSoloistTrack(song: SongResult, signal?: AbortSignal): Promise<void> {
  // Cancel previous in-flight play wait on rapid track switching
  if (inFlightSoloistPlayController) {
    inFlightSoloistPlayController.abort('New track requested');
    inFlightSoloistPlayController = null;
  }

  const controller = new AbortController();
  inFlightSoloistPlayController = controller;

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  setPlaybackRoute('soloist');
  setDuration(song.durationMs ? song.durationMs / 1000 : 0);
  const uri = `${SP_URI_PREFIX}${song.id}`;
  await soloistAdapter.play(uri);
  await soloistAdapter.waitForPlayback(uri, { timeoutMs: 8000, signal: controller.signal });
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

  // Check if song exists in playQueue or currentSong for richer metadata
  const queue = usePlaybackStore.getState().playQueue;
  const matchedQueuedSong = queue.find(s => s.id === trackId);
  const currentSong = usePlaybackStore.getState().currentSong;
  const existingSong = (currentSong?.id === trackId ? currentSong : null) || matchedQueuedSong;

  const resolvedArtist = track.artist ||
    (existingSong?.artists && existingSong.artists.map(a => a.name).filter(Boolean).join(', ')) ||
    '';
  const resolvedAlbum = track.album || existingSong?.album?.name || '';
  const resolvedCover = track.artwork || existingSong?.album?.coverUrl || '';
  const resolvedName = (track.name && track.name !== 'Untitled') ? track.name : (existingSong?.name || 'Untitled');

  const adoptedSong: SongResult = {
    id: trackId,
    name: resolvedName,
    artists: resolvedArtist
      ? [{ id: '', name: resolvedArtist }]
      : (existingSong?.artists?.length ? existingSong.artists : [{ id: '', name: 'Unknown Artist' }]),
    album: {
      id: '',
      name: resolvedAlbum,
      coverUrl: resolvedCover,
    },
    durationMs: track.durationMs || existingSong?.durationMs || 0,
    sourceRef: { kind: 'online', providerId: SP_PROVIDER, mediaId: trackId },
  };

  makeSongCurrent(adoptedSong);

  if (queue.length === 0) {
    setPlayQueue([adoptedSong]);
  }

  // Background metadata enrichment if artist is still missing
  if (!resolvedArtist) {
    void omni.getSongDetail(SP_PROVIDER, trackId).then(detail => {
      if (detail && detail.artists && detail.artists.length > 0) {
        setCurrentSong(prev => {
          if (!prev || prev.id !== trackId) return prev;
          return {
            ...prev,
            name: (detail.name && detail.name !== 'Untitled') ? detail.name : prev.name,
            artists: detail.artists,
            album: detail.album?.name ? detail.album : prev.album,
          };
        });
      }
    }).catch(() => {
      // ignore
    });
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
