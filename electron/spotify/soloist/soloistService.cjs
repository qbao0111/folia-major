// electron/spotify-soloist/soloistService.cjs
// Manages the official Spotify Soloist daemon process, configuration, and endpoint discovery.

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { SpotifySoloistEngine } = require('./soloistEngine.cjs');
const { SoloistVault } = require('./vault.cjs');

function parseLoopbackEndpoint(addr, port) {
  const cleanAddr = (addr || '').trim();
  const cleanPort = (port || '').trim();
  if (cleanAddr !== '127.0.0.1') {
    throw new Error('Soloist endpoint must bind strictly to 127.0.0.1');
  }
  const portNum = Number.parseInt(cleanPort, 10);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error(`Invalid Soloist WebSocket port: ${cleanPort}`);
  }
  return `ws://127.0.0.1:${portNum}`;
}

class SoloistService {
  /**
   * @param {string} rootDir Base directory in userData for soloist data and vault
   */
  constructor(rootDir) {
    this.root = rootDir;
    this.dataDir = path.join(rootDir, 'soloist-data');
    this.cacheDir = path.join(rootDir, 'soloist-cache');
    this.vault = new SoloistVault(path.join(rootDir, 'soloist-vault'));
    this.child = null;
    this.busy = false;
    this.generation = 0;

    this.engine = new SpotifySoloistEngine(async () => {
      const addr = await fs.readFile(path.join(this.dataDir, 'ws.addr'), 'utf8');
      const port = await fs.readFile(path.join(this.dataDir, 'ws.port'), 'utf8');
      return parseLoopbackEndpoint(addr, port);
    });
  }

  async detect() {
    const saved = await this.vault.read('soloist-path');
    const localAppData = process.env.LOCALAPPDATA || '';
    const pathDirs = (process.env.PATH || '').split(path.delimiter);

    const candidates = [
      saved,
      path.join(localAppData, 'Programs', 'Soloist', 'soloist.exe'),
      path.join(localAppData, 'Spotify', 'Soloist', 'soloist.exe'),
      ...pathDirs.map(p => path.join(p, 'soloist.exe')),
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        await fs.access(candidate, constants.R_OK);
        return candidate;
      } catch {
        // try next candidate
      }
    }
    return undefined;
  }

  async select(exePath) {
    if (!exePath) throw new Error('No executable path specified');
    const resolved = await fs.realpath(exePath);
    if (path.basename(resolved).toLowerCase() !== 'soloist.exe') {
      throw new Error('Please select the official soloist.exe file');
    }
    await fs.access(resolved, constants.R_OK);
    await this.vault.save('soloist-path', resolved);
    return resolved;
  }

  async getSavedKey() {
    return this.vault.read('soloist-key');
  }

  async saveKey(key) {
    if (key) {
      await this.vault.save('soloist-key', key);
    } else {
      await this.vault.remove('soloist-key');
    }
  }

  async start(key, remember = true) {
    if (this.busy) throw new Error('Soloist is already starting');
    if (this.child && this.child.exitCode === null) {
      // Already running
      if (this.engine.getStatus().connection !== 'connected') {
        await this.engine.connect();
      }
      return;
    }

    this.busy = true;
    try {
      const exe = await this.detect();
      if (!exe) {
        throw new Error('Could not locate soloist.exe. Please specify its path in Settings.');
      }

      const apiKey = key || (await this.vault.read('soloist-key'));
      if (!apiKey || !apiKey.trim()) {
        throw new Error('A personal Spotify Soloist API key is required to start playback.');
      }

      if (remember) {
        await this.vault.save('soloist-key', apiKey.trim());
      } else if (key) {
        await this.vault.remove('soloist-key');
      }

      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.rm(path.join(this.dataDir, 'ws.addr'), { force: true });
      await fs.rm(path.join(this.dataDir, 'ws.port'), { force: true });

      const currentGen = ++this.generation;
      const child = spawn(
        exe,
        [
          '--device-name',
          'Folia',
          '--api-key',
          apiKey.trim(),
          '--data-dir',
          this.dataDir,
          '--cache-dir',
          this.cacheDir,
          '--ws',
          '127.0.0.1:0',
        ],
        { windowsHide: true, shell: false, stdio: 'ignore' }
      );
      this.child = child;

      const onFail = (message) => {
        if (currentGen !== this.generation) return;
        this.child = null;
        void this.engine.disconnect().then(() => {
          this.engine.reportError(message);
        });
      };

      child.on('error', (err) => {
        console.error('[SoloistService] Spawn error:', err);
        onFail('Could not launch soloist.exe. Please verify file permissions and Windows antivirus settings.');
      });

      child.on('exit', (code) => {
        console.warn(`[SoloistService] Process exited with code ${code}`);
        if (code === 10) {
          onFail(
            'Spotify Soloist build expired (exit code 10). Soloist developer builds require 90-day renewal. Please download a new build from https://developer.spotify.com/documentation/soloist.'
          );
        } else {
          onFail(`Soloist stopped (exit code ${code !== null ? code : 'terminated'}). Please verify API key and system permissions.`);
        }
      });

      // Poll for ws.addr and ws.port publication
      let discovered = false;
      for (let i = 0; i < 100 && this.child === child; i++) {
        try {
          const addr = await fs.readFile(path.join(this.dataDir, 'ws.addr'), 'utf8');
          const port = await fs.readFile(path.join(this.dataDir, 'ws.port'), 'utf8');
          parseLoopbackEndpoint(addr, port);
          discovered = true;
          break;
        } catch {
          await delay(100);
        }
      }

      if (!discovered) {
        if (this.child === child) {
          await this.stop();
        }
        const lastErr = this.engine.getStatus().error;
        throw new Error(lastErr || 'Soloist did not publish its loopback address in time. Check API key validity.');
      }

      await this.engine.connect();
    } finally {
      this.busy = false;
    }
  }

  async stop() {
    this.generation++;
    await this.engine.disconnect();
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          resolve();
        }, 3000);

        child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });

        try {
          child.kill('SIGTERM');
        } catch {
          child.kill();
        }
      });
    }
  }

  async forget() {
    await this.stop();
    try {
      await fs.rm(this.dataDir, { recursive: true, force: true });
      await fs.rm(this.cacheDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    await this.vault.remove('soloist-key');
    await this.vault.remove('soloist-path');
  }
}

module.exports = { SoloistService, parseLoopbackEndpoint };
