# Limitations & Technical Boundaries

This document details known limitations, platform constraints, and non-goals of the Spotify Soloist integration.

---

## 1. Official Build Expiration (Exit Code 10)
- **Spotify Developer Preview Constraint**: Official builds of `soloist.exe` provided by Spotify currently expire every 90 days.
- **Handling**: When `soloist.exe` exits with code `10`, Folia detects this exit status explicitly, updates the UI with an informative warning, and provides a direct link to the Spotify Developer documentation to download an updated build.
- **User Action**: The user must replace `soloist.exe` with a renewed binary when Spotify releases an update.

---

## 2. No Decrypted Audio URL Access
- **Design Invariant**: Spotify Soloist outputs decoded audio directly to Windows WASAPI / CoreAudio. It does not provide decrypted PCM streams or HTTP audio stream URLs to the host process.
- **Spectrum Visualizer**: Because audio output does not pass through the Web Audio API graph of Chromium, frequency spectrum FFT bars run in ambient breathing mode rather than reacting to raw audio amplitudes.

---

## 3. Account Requirement
- **Spotify Premium**: In accordance with Spotify Developer terms and Spotify Connect specifications, audio playback through Soloist requires an active Spotify Premium subscription.

---

## 4. Platform Availability
- Spotify Soloist is currently supported on Windows (x64) and macOS desktop environments. On platforms without Soloist support (e.g. Linux or browser-only deployments), Folia gracefully defaults to standard online provider routes.
