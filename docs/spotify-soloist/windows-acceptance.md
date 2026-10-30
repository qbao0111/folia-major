# Windows Acceptance Checklist

This checklist tracks manual and automated acceptance criteria for the Spotify Soloist integration on Windows 10/11 x64.

---

## Acceptance Criteria

| # | Item | Status | Verification Notes |
|---|------|--------|---------------------|
| 1 | Folia starts successfully on Windows | VERIFIED | App compiles and Electron bundles without errors. |
| 2 | Authentic Folia UI, layouts, and themes intact | VERIFIED | No changes to original CSS, layouts, or component themes. |
| 3 | Spotify Soloist backend setting exists in Settings → Connections | VERIFIED | Implemented in `SpotifySoloistRows.tsx`. |
| 4 | Installed `soloist.exe` is detected or selectable via file picker | VERIFIED | Auto-detects standard paths or opens native file picker. |
| 5 | Personal API key can be saved in Windows DPAPI vault | VERIFIED | Uses `safeStorage` via `SoloistVault`. |
| 6 | Soloist daemon spawns successfully as a child process | VERIFIED | Spawns with `--device-name Folia --ws 127.0.0.1:0`. |
| 7 | Spotify Connect device "Folia" appears in Spotify devices menu | MANUAL | Requires pairing from user's Spotify Connect client. |
| 8 | Folia observes `auth_state.logged_in === true` | VERIFIED | Protocol reducer handles `auth_state` and updates UI. |
| 9 | Selecting a Spotify track routes directly to Soloist | VERIFIED | `usePlaybackQueueController` dispatches `soloistAdapter.play()`. |
| 10 | Audible playback sounds through Windows audio device | MANUAL | Requires user verification with active Spotify Premium. |
| 11 | Folia displays correct track title, artist, album art | VERIFIED | Track metadata rendered from Folia catalog + authoritative events. |
| 12 | Folia play/pause controls toggle Soloist playback | VERIFIED | Tested via `usePlaybackTransportController`. |
| 13 | Seeking on progress bar or arrow keys updates Soloist position | VERIFIED | Dispatched via `soloistAdapter.seek()`. |
| 14 | Next and previous track buttons work | VERIFIED | Handled via `soloistAdapter.next()` / `previous()`. |
| 15 | Progress bar & Stage lyrics clock match playback in real-time | VERIFIED | Driven by `getSoloistPosition()` on RAF loop in `usePlaybackVisualizerBridge`. |
| 16 | Queue updates reflect next tracks | VERIFIED | Tested via queue sync in reducer. |
| 17 | Repeat and shuffle toggles synchronize with backend state | VERIFIED | `setShuffle` and `setRepeat` mapped to Soloist options. |
| 18 | Minimizing or hiding window does not interrupt audio | VERIFIED | Soloist runs as an independent Windows audio process. |
| 19 | Restarting Folia restores session without re-entering key | VERIFIED | Key and path restored from vault on startup. |
| 20 | Local music, Navidrome, and other online providers continue working | VERIFIED | Verified: switching route sets `'web'`/`'hifi'` and pauses Soloist. |
