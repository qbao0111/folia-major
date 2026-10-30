# Spotify Soloist Integration for Folia

This directory contains complete architecture specifications, integration guides, security documentation, limitations, and manual acceptance checklists for the official Spotify Soloist playback backend in Folia.

---

## Overview

Folia integrates official **Spotify Soloist** as an alternative, native playback route for Spotify tracks on Windows desktop platforms.

- **Soloist Backend**: Communicates with the official, user-installed `soloist.exe` over a strictly loopback WebSocket connection (`127.0.0.1:<port>`).
- **Authentic Folia Experience**: Folia's signature design, dynamic themes, animations, lyrics Stage, queue, fullscreen mode, local music, and other music providers (NetEase, QQ, Bodian, Navidrome) remain completely untouched and fully functional.
- **Official Spotify Connect Pairing**: Spotify Soloist registers as a local Connect speaker (`Folia`) under your Spotify Premium account.
- **Zero URL Fabrication**: Spotify Soloist renders audio directly to hardware; Folia never fabricates dummy URLs or attaches idle audio tags that drift.

---

## Documentation Index

1. [Architecture Analysis](./architecture-analysis.md)
   In-depth investigation of Folia's original playback engine, deck management, HiFi pattern, and how the `spotify-soloist` route cleanly integrates.
2. [Integration Guide](./integration.md)
   Step-by-step technical guide explaining how Electron main, preload IPC, and the renderer `soloistAdapter` coordinate playback.
3. [Security Architecture](./security.md)
   Encrypted storage using Windows DPAPI (`safeStorage`), loopback binding invariants, process ownership, and secret isolation.
4. [Windows Acceptance Checklist](./windows-acceptance.md)
   20-point verification checklist covering end-to-end Windows setup, playback, controls, lyrics, and recovery.
5. [Limitations & Non-Goals](./limitations.md)
   Honest documentation of technical boundaries, 90-day preview expiration handling, and Spotify Connect policies.

---

## Quick Start (User Setup)

1. Open Folia **Settings** (gear icon in title bar).
2. Navigate to **Connections** (连接与集成).
3. Find **Spotify Soloist**.
4. Enable the toggle. Folia will automatically search for installed `soloist.exe` (or you can click **Browse…** to locate it).
5. Enter your personal **Spotify Soloist API Key** and leave **Remember API Key Securely** enabled.
6. Click **Start Soloist**.
7. Once started, open Spotify on your phone, tablet, or PC, open the **Devices** (Spotify Connect) menu, and tap **Folia** to pair.
8. Folia will show **Connected & Paired**. Now you can play any Spotify track with authentic Folia animations and synced lyrics!
