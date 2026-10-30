// src/services/soloist/useSoloistStore.ts
// React-friendly Zustand store providing reactive access to Soloist playback state.

import { create } from 'zustand';
import { initialSoloistPlaybackState, type SoloistPlaybackState } from './types';
import { soloistAdapter } from './soloistAdapter';

interface SoloistStoreState extends SoloistPlaybackState {
  setSoloistState: (next: SoloistPlaybackState) => void;
}

export const useSoloistStore = create<SoloistStoreState>((set) => {
  // Subscribe to adapter updates
  soloistAdapter.subscribe((incoming) => {
    set(incoming);
  });

  return {
    ...initialSoloistPlaybackState(),
    setSoloistState: (next) => set(next),
  };
});
