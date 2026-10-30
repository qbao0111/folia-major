// src/services/soloist/soloistPlayback.ts
// Soloist playback route orchestration and state synchronization.

import type { SongResult } from '../../types';
import { PlayerState } from '../../types';
import { setPlayerState, setDuration, setPlaybackRoute, usePlaybackStore } from '../../stores/usePlaybackStore';
import { runsOnWindows } from '../../utils/platform';
import { soloistAdapter } from './soloistAdapter';
import { useSoloistSettingsStore } from './useSoloistSettingsStore';

export { soloistAdapter, isSoloistRoute, getSoloistPosition } from './soloistAdapter';

/**
 * Determines whether a song is eligible to be played through the Soloist backend.
 */
export function isSoloistEligible(song: SongResult): boolean {
  if (song.sourceRef?.kind !== 'online' || song.sourceRef.providerId !== 'spotify') {
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
  const uri = `spotify:track:${song.id}`;
  await soloistAdapter.play(uri);
  await soloistAdapter.waitForPlayback(8000);
}

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
