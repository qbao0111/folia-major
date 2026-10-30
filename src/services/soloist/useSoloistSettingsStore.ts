// src/services/soloist/useSoloistSettingsStore.ts
// Settings store for playback backend selection and Soloist integration.

import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean, setStoredString } from '../../stores/storagePrimitives';
import { runsOnWindows } from '../../utils/platform';

export type SoloistPlaybackBackend = 'soloist' | 'legacy';

export const SOLOIST_BACKEND_KEY = 'folia_spotify_playback_backend';
export const SOLOIST_ENABLED_KEY = 'folia_spotify_soloist_enabled';
export const SOLOIST_REMEMBER_KEY = 'folia_spotify_soloist_remember';

const defaultBackend = (): SoloistPlaybackBackend => {
  // On Windows, default to Soloist backend
  if (runsOnWindows()) return 'soloist';
  return 'legacy';
};

export interface SoloistSettingsState {
  backend: SoloistPlaybackBackend;
  soloistEnabled: boolean;
  rememberKey: boolean;
  setBackend: (backend: SoloistPlaybackBackend) => void;
  setSoloistEnabled: (enabled: boolean) => void;
  setRememberKey: (remember: boolean) => void;
}

export const useSoloistSettingsStore = create<SoloistSettingsState>((set) => ({
  backend: (getStoredString(SOLOIST_BACKEND_KEY, defaultBackend()) as SoloistPlaybackBackend) || 'soloist',
  soloistEnabled: getStoredBoolean(SOLOIST_ENABLED_KEY, true),
  rememberKey: getStoredBoolean(SOLOIST_REMEMBER_KEY, true),

  setBackend: (backend) => {
    setStoredString(SOLOIST_BACKEND_KEY, backend);
    set({ backend });
  },

  setSoloistEnabled: (soloistEnabled) => {
    setStoredBoolean(SOLOIST_ENABLED_KEY, soloistEnabled);
    set({ soloistEnabled });
  },

  setRememberKey: (rememberKey) => {
    setStoredBoolean(SOLOIST_REMEMBER_KEY, rememberKey);
    set({ rememberKey });
  },
}));
