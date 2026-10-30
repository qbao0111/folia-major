# Security & Privacy Architecture

This document outlines the security controls, credential protection, and network safety boundaries governing Spotify Soloist in Folia.

---

## 1. Zero Secret Ingress to Git & Renderer

- **No Secrets in Source**: No API keys, tokens, or credentials are hardcoded or tracked in Git.
- **Process Boundaries**: The personal Soloist API key is entered by the user in Folia's settings and passed directly to the Electron main process via secure IPC. It is never exposed to public renderer scopes or saved in plaintext in `localStorage`.
- **Operating System Encryption**: In `electron/spotify-soloist/vault.cjs`, the key is encrypted using Electron's `safeStorage` API, which leverages Windows Data Protection API (DPAPI). Only the active user account on that specific Windows machine can decrypt the stored payload.

---

## 2. Network & Loopback Safety

- **Loopback Enforcement**: When launching `soloist.exe`, Folia passes `--ws 127.0.0.1:0`.
- **Endpoint Validation**: During discovery, Folia reads `ws.addr` and `ws.port`. It strictly verifies that `ws.addr === '127.0.0.1'` and that the port is an integer in the range `[1, 65535]`.
- **No External Binding**: Folia refuses to establish any connection to external IPs, remote addresses, or `0.0.0.0`.
- **No Proxying Outside Host**: The WebSocket channel is strictly private to the local machine.

---

## 3. Sandboxing & Process Ownership

- **Isolated Directories**: Soloist is spawned with dedicated, private data and cache directories located in:
  - `%APPDATA%\Folia\soloist-data`
  - `%APPDATA%\Folia\soloist-cache`
- **Ownership Tracking**: Folia tracks the PID of the spawned child process. On application exit (`before-quit` and `process.exit`), Folia cleanly terminates the child process (`SIGTERM` / `SIGKILL`). Folia never kills unrelated system processes.
- **Forget Credentials**: The user can click "Forget" in Settings to cleanly shut down the daemon and permanently erase `soloist-data`, `soloist-cache`, and the encrypted vault keys.
