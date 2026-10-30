# Spotify Soloist Integration Guide

This document describes the technical implementation details of Spotify Soloist within Folia.

---

## 1. Process & Lifecycle Architecture

### Electron Main Process
The service is located at `electron/spotify-soloist/`:
- **`vault.cjs`**: Interfaces with Electron's `safeStorage` (Windows DPAPI) to store and retrieve sensitive configuration (`soloist-key`, `soloist-path`) without plaintext exposure.
- **`soloistEngine.cjs`**: Implements the WebSocket protocol client to communicate with `soloist.exe`. Handles incoming asynchronous events, validates payloads, and anchors monotonic clock synchronization for position interpolation.
- **`soloistService.cjs`**: Supervises the `soloist.exe` child process:
  - Spawns with `--device-name Folia --ws 127.0.0.1:0 --api-key <key> --data-dir <userData>/soloist-data --cache-dir <userData>/soloist-cache`.
  - Discovers the loopback WebSocket endpoint published in `ws.addr` and `ws.port`.
  - Tracks child exit codes, notably detecting code `10` (90-day developer build expiration).
  - Enforces clean process termination on application quit.
- **`soloistIpc.cjs`**: Exposes typed IPC channels (`soloist:start`, `soloist:stop`, `soloist:detect`, `soloist:select`, `soloist:command`, `soloist:get-status`, `soloist:get-progress`) and broadcasts state changes.

### Electron Preload Bridge
Exposed safely to the renderer via context isolation in `electron/preload.cjs` as `window.electron.soloist`.

---

## 2. Playback Routing & Engine Abstraction

### Extended PlaybackRoute
`src/types/hifi.ts`:
```typescript
export type PlaybackRoute = 'web' | 'hifi' | 'spotify-soloist';
```

### Route Selection
When the user picks a Spotify track, `usePlaybackQueueController.playSong()` checks:
```typescript
const isSpotify = providerId === 'spotify';
const useSoloistForSpotify = isSpotify && (
    useSpotifySettingsStore.getState().backend === 'soloist' || runsOnWindows()
);
```
If enabled:
1. `setPlaybackRoute('spotify-soloist')` is called.
2. The internal audio deck `<audio>` is paused and its `src` is cleared. No dummy audio URL is generated.
3. `soloistAdapter.play(spotifyUri)` is called.
4. Lyrics are resolved in parallel via Folia's online lyrics pipeline.
5. The UI shows the song title, album art, and artist credits from Folia's metadata.

### Transport Synchronization
1. **Play/Pause**: In `usePlaybackTransportController.ts`, when `playbackRoute === 'spotify-soloist'`, transport commands delegate directly to `soloistAdapter.resume()` and `soloistAdapter.pause()`.
2. **Seeking**: In `src/App.tsx`, `usePlaybackInteractionBridge.ts`, and `useElectronPlaybackBridge.ts`, seek actions are dispatched via `soloistAdapter.seek(positionMs)` while instantaneously updating Folia's `currentTime` motion signal.
3. **Lyrics Clock**: In `usePlaybackVisualizerBridge.ts`, the frame loop reads `getSoloistPosition()` to drive lyric line stepping and animated text highlighting with zero jitter.
4. **Context Switching**: When switching away from Spotify to another music provider or local music, `usePlaybackQueueController` automatically pauses Soloist and restores `playbackRoute` to `'web'` or `'hifi'`.
