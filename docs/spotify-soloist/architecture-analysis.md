# Folia & Spotify Soloist: Architecture Analysis

This document provides a comprehensive technical investigation of Folia's authentic codebase, its existing audio playback and Spotify subsystems, and the architecture designed to integrate the official Spotify Soloist playback backend.

---

## 1. Executive Summary & Problem Definition

### 1.1 Upstream Spotify Behavior
In Folia's current architecture, Spotify tracks are treated like other online providers (NetEase, QQ Music, Bodian, etc.):
1. The catalog/library/search is browsed using Spotify's internal web client APIs or PKCE authentication.
2. When a track is queued to play, `spotifyProvider.playback.getAudioSource(song, quality)` calls `electron/spotify/audio.cjs` via IPC (`spotify-api-request`, operation `audio`).
3. The Electron backend uses an embedded session / librespot-based protocol or custom protocol scheme (`spotify-audio://...`) to stream raw audio chunks directly to an HTML5 `<audio>` deck in the renderer process.
4. However, due to upstream Spotify DRM changes and server-side session token revocations, direct audio decryption via unofficial client sessions frequently fails with errors (`UNAVAILABLE`, `PREMIUM_REQUIRED`, or connection dropouts).

### 1.2 Nature of Spotify Soloist
The official **Spotify Soloist** daemon (`soloist.exe`) is Spotify's local playback engine for Windows and desktop environments:
- It runs as a standalone daemon spawned with `--device-name <name> --api-key <key> --ws 127.0.0.1:0`.
- It connects as an official Spotify Connect receiver device.
- It accepts authenticated playback commands over a loopback WebSocket API.
- **Critical Architectural Invariant:** Spotify Soloist **never** exposes decrypted audio streams or stream URLs. The audio output is rendered directly by `soloist.exe` to the operating system's audio output device (Windows CoreAudio / WASAPI).
- Attempting to synthesize a fake `getAudioSource()` URL or attaching dummy silent `<audio>` elements violates architectural integrity, leaks memory, causes clock drift, and conflicts with OS media controls.

### 1.3 Architectural Solution
Folia already possesses a clean pattern for out-of-process, high-fidelity external audio rendering: the **HiFi / mpv route** (`PlaybackRoute = 'web' | 'hifi'`).
Under the HiFi route:
- The HTML5 `<audio>` elements are kept idle.
- Audio playback and decoding are delegated to an external engine (`mpvSession.cjs`).
- Time updates, track transitions, play/pause, seek, and volume are synchronized through motion signals (`currentTime`, `duration`, `playerState`).
- The UI, lyrics visualizer, and animations read their clock from the authoritative external position.

We introduce a first-class route: `'spotify-soloist'`, extending `PlaybackRoute`:
```typescript
export type PlaybackRoute = 'web' | 'hifi' | 'spotify-soloist';
```
When playing Spotify tracks on Windows with the Soloist backend enabled, playback is routed directly to the Spotify Soloist engine. The rest of Folia (NetEase, QQ Music, Bodian, local library, Navidrome, themes, lyrics Stage, animations) remains 100% authentic and untouched.

---

## 2. Core Subsystems Analysis

### 2.1 Spotify Provider Registration & Metadata Normalization
- **Registration**: Registered in `src/services/onlineMusic/providerRegistry.ts` under ID `'spotify'` via `spotifyProvider`.
- **Metadata Normalization**: Handled in `src/services/onlineMusic/spotify/spotifyNormalize.ts`.
  - Spotify URIs have the form `spotify:track:<id>`, `spotify:album:<id>`, `spotify:playlist:<id>`.
  - Tracks are normalized into Folia's `UnifiedSong` structure:
    - `id`: 22-character alphanumeric Spotify ID (e.g., `4cOdK2wGLETKBW3PvgPWqT`).
    - `sourceRef`: `{ kind: 'online', providerId: 'spotify', mediaId: id }`.
    - `name`, `artists`, `album`, `duration` (in milliseconds).

### 2.2 Host Audio Deck Management
- Folia utilizes dual `<audio>` elements ("decks") for seamless DJ transitions and automix crossfading (`usePlaybackAudioBridge.ts`, `usePlaybackVisualizerBridge.ts`).
- When an external route (`hifi` or `spotify-soloist`) is active:
  - Both decks are kept paused and idle.
  - The Web Audio API analyser graph switches to breathing/ambient mode or receives authoritative position pulses.
  - Audio output is routed to hardware through Soloist's WASAPI sink.

### 2.3 Player State Management & Transport
- **Store**: `src/stores/usePlaybackStore.ts`.
  - Holds `playerState` (`PlayerState.IDLE`, `PlayerState.PLAYING`, `PlayerState.PAUSED`), `currentTime` (nanostore motion signal), `duration`, `currentSong`, `playQueue`, and `playbackRoute`.
- **Transport Controller**: `src/components/app/playback/bridges/usePlaybackTransportController.ts`.
  - `resumePlayback()`: checks `isHifiRoute()`; for `spotify-soloist`, invokes `soloistAdapter.resume()`.
  - `pausePlayback()`: checks `isHifiRoute()`; for `spotify-soloist`, invokes `soloistAdapter.pause()`.
- **Interaction Bridge (Seek)**: `src/components/app/playback/bridges/usePlaybackInteractionBridge.ts`.
  - Invokes `soloistAdapter.seek(positionMs)` when seeking via progress bar or arrow shortcuts.

### 2.4 Lyrics Stage & Visualizer Clock Synchronization
- Folia's lyrics engine (`usePlaybackVisualizerBridge.ts`) runs on a high-frequency `requestAnimationFrame` loop.
- It syncs the lyric read-head using:
  ```typescript
  if (isSoloistActive) {
      const time = soloistAdapter.getProgress(); // interpolated seconds
      currentTime.set(time);
      const effectiveLyricTime = time - displayOffsetMsRef.current / 1000;
      showLyricTime(effectiveLyricTime);
      if (lyrics) {
          showLine(findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime));
      }
  }
  ```
- Spotify tracks retain lyric lookups via Spotify's internal timed lyrics, or fall back transparently to LRCLIB, NetEase, and QQ lyrics matching.

---

## 3. Playback Call Chain

### User Action to Playback Execution
```
[User clicks Track in Playlist / Album / Search / Home]
       │
       ▼
usePlaybackQueueController.playSong(song, queue, ...)
       │
       ├─► Identify provider: getOnlineProviderIdForSong(song) === 'spotify'
       │   And check setting: useSpotifySettingsStore.getState().backend === 'soloist'
       │
       ▼
Route to Soloist Playback
       │
       ├─► Set Playback Route: setPlaybackRoute('spotify-soloist')
       ├─► Set Active Song in store: showSong(song), update queue & metadata
       ├─► DO NOT call loadOnlineSongAudioSource / getAudioSource() (No fake URL!)
       ├─► Send URI to Soloist: soloistAdapter.play(`spotify:track:${song.id}`)
       ├─► Fetch Lyrics: loadOnlineSongLyrics(song, ...) (LRCLIB / Netease / Spotify)
       │
       ▼
Soloist Service (Electron Main Process)
       │
       ├─► WebSocket command: { "type": "command", "command": "play", "uri": "spotify:track:..." }
       │
       ▼
Soloist Daemon (soloist.exe)
       │
       ├─► Streams encrypted audio from Spotify servers via Spotify Connect
       ├─► Decodes & outputs directly to Windows default audio device
       ├─► Emits position_sync & playback_state events to WebSocket
       │
       ▼
Soloist Engine in Electron Main -> IPC -> Renderer Adapter
       │
       ├─► Update authoritative playback status (Playing, Paused, Buffering)
       ├─► Position interpolation anchored on position_sync
       └─► Stage lyrics & progress bar smoothly synchronized
```

---

## 4. Key Design Decisions

1. **Soloist Lifetime & Security**:
   - `soloist.exe` is managed exclusively by the Electron main process (`electron/spotify-soloist/`).
   - Private data directory: `path.join(app.getPath('userData'), 'soloist-data')`.
   - Private cache directory: `path.join(app.getPath('userData'), 'soloist-cache')`.
   - API Key stored in DPAPI encrypted vault via `safeStorage`.
   - WebSocket binds exclusively to `127.0.0.1:0` (dynamic loopback port); endpoint is read from `ws.addr` and `ws.port`.
   - On application exit, child process is cleanly terminated.
   - Exit code 10 (expired 90-day Soloist developer preview build) is detected with a clear download recommendation.

2. **No Librespot Fallback**:
   - As per requirements, when Soloist is selected, playback failure does not silently drop back to librespot; instead, explicit diagnostics and recovery prompts are shown.

3. **Complete Preservation of Folia**:
   - The UI, themes, navigation, stage animations, local file playback, and other online music providers remain 100% intact.
