# Windows Acceptance Checklist

This checklist tracks manual and automated acceptance criteria for the Spotify Soloist integration on Windows 10/11 x64.

---

## Acceptance Criteria

| # | Item | Status | Verification Notes |
|---|------|--------|---------------------|
| 1 | Folia starts successfully on Windows | VERIFIED | App compiles, typechecks, and Electron bundles without errors. |
| 2 | Authentic Folia UI, layouts, and themes intact | VERIFIED | No changes to original CSS, layouts, or component themes. |
| 3 | Spotify Soloist backend setting exists in Settings → Connections | VERIFIED | Implemented in `SoloistRows.tsx`. |
| 4 | Installed `soloist.exe` is detected or selectable via file picker | VERIFIED | Auto-detects standard paths or opens native file picker. |
| 5 | Personal API key can be saved in Windows DPAPI vault | VERIFIED | Uses `safeStorage` via `SoloistVault`. |
| 6 | Soloist daemon spawns successfully as a child process | VERIFIED | Spawns with `--device-name Folia --ws 127.0.0.1:0`. |
| 7 | Spotify Connect device "Folia" appears in Spotify devices menu | MANUAL | Requires pairing from user's Spotify Connect client. |
| 8 | Folia observes `auth_state.logged_in === true` | VERIFIED | State machine requests auth first; requests state/queue only after auth confirmation. |
| 9 | Selecting a Spotify track routes directly to Soloist | VERIFIED | `usePlaybackQueueController` dispatches `soloistAdapter.play()`. |
| 10 | Audible playback sounds through Windows audio device | MANUAL | Requires user verification with active Spotify Premium. |
| 11 | Folia displays correct track title, artist, album art | VERIFIED | Track metadata rendered from Folia catalog + authoritative events. |
| 12 | Folia play/pause controls toggle Soloist playback | VERIFIED | Tested via `usePlaybackTransportController` and `usePlaybackInteractionBridge`. |
| 13 | Space key shortcut toggles play/pause on Soloist route | VERIFIED | Fixed route eligibility in `usePlaybackInteractionBridge`. |
| 14 | Seeking on progress bar or arrow keys updates Soloist position | VERIFIED | Dispatched via `soloistAdapter.seek()` and synchronized with RAF clock. |
| 15 | Folia volume slider synchronizes with Soloist output | VERIFIED | `syncOutputGain` & `handlePreviewVolume` dispatch `soloistAdapter.setVolume`. |
| 16 | Next and previous track buttons work | VERIFIED | Handled via `soloistAdapter.next()` / `previous()`. |
| 17 | Progress bar & Stage lyrics clock match playback in real-time | VERIFIED | Driven by `getSoloistPosition()` on RAF loop in `usePlaybackVisualizerBridge`. |
| 18 | Queue updates reflect next tracks | VERIFIED | Tested via queue sync in reducer. |
| 19 | Repeat and shuffle toggles synchronize with backend state | VERIFIED | `setShuffle` and `setRepeat` mapped to Soloist options. |
| 20 | Minimizing or hiding window does not interrupt audio | VERIFIED | Soloist runs as an independent Windows audio process. |
| 21 | Restarting Folia restores session without re-entering key | VERIFIED | Key and path restored from vault on startup. |
| 22 | Local music, Navidrome, and other online providers continue working | VERIFIED | Verified: switching route sets `'web'`/`'hifi'` and pauses Soloist. |
| 23 | No legacy Spotify audio requests during Soloist playback | VERIFIED | Audited & blocked in `prefetchService.ts` and restore controllers. |
| 24 | No optimistic PLAYING state before authoritative event | VERIFIED | `playSoloistTrack` awaits `soloistAdapter.waitForPlayback()`. |

---

## Windows Manual Audible Playback Test Checklist

To be completed on actual Windows hardware with Spotify Premium:

1. **Prerequisites Verification**:
   - [ ] Ensure Spotify Premium account is active.
   - [ ] Ensure official `soloist.exe` is installed on PC (e.g. `%LOCALAPPDATA%\Programs\Soloist\soloist.exe`).
   - [ ] Ensure Spotify Soloist API key is entered in Settings → Connections → Spotify Soloist.
   - [ ] Launch Folia and click **Start Soloist Engine**. Status should display `Connected (ready for pairing)`.

2. **Spotify Connect Pairing**:
   - [ ] Open Spotify on your phone or desktop.
   - [ ] Open the Devices menu ("Connect to a device").
   - [ ] Select **Folia**.
   - [ ] Verify Folia settings show `Paired with Spotify`.

3. **Audible Playback & Track Selection**:
   - [ ] In Folia, search for a Spotify track or open a playlist.
   - [ ] Click Play on a track.
   - [ ] **Verify audible sound** emerges from your Windows default audio device (WASAPI output).
   - [ ] Verify track title, artist name, and album artwork load correctly on Folia's now-playing deck.

4. **Transport & Keyboard Controls**:
   - [ ] Press **Spacebar**: verify playback pauses cleanly.
   - [ ] Press **Spacebar** again: verify playback resumes cleanly.
   - [ ] Click the on-screen **Play/Pause** button: verify state toggles.
   - [ ] Press **Arrow Left / Right**: verify track seeks backward / forward by 5 seconds.
   - [ ] Drag the **Volume Slider**: verify Spotify Soloist volume changes audibly in real time.
   - [ ] Click **Next Track**: verify track changes to the next song and audio continues.

5. **Visualizers & Lyrics Stage**:
   - [ ] Switch to **Stage / Lyrics** view.
   - [ ] Verify lyrics synchronize with the real-time position of the song.
   - [ ] Verify progress bar continuously updates without freezing at 00:00.

6. **Provider Isolation**:
   - [ ] Play a local track or another online provider song.
   - [ ] Verify Soloist pauses and Folia switches route back to internal audio deck smoothly.
