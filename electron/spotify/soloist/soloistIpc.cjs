// electron/spotify-soloist/soloistIpc.cjs
// Registers Electron IPC channels connecting the Spotify Soloist service with the renderer.

const { ipcMain, BrowserWindow, dialog } = require('electron');

/**
 * Registers all Soloist IPC handlers.
 * @param {import('./soloistService.cjs').SoloistService} soloistService
 */
function registerSoloistIpc(soloistService) {
  const broadcast = (channel, data) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  };

  soloistService.engine.subscribe((state) => {
    broadcast('soloist:state-changed', state);
  });

  ipcMain.handle('soloist:detect', async () => {
    try {
      const pathFound = await soloistService.detect();
      return { ok: true, path: pathFound };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('soloist:pick-file', async () => {
    const focused = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(focused || undefined, {
      title: 'Select soloist.exe',
      filters: [{ name: 'Soloist Executable', extensions: ['exe'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }
    try {
      const selected = await soloistService.select(result.filePaths[0]);
      return { ok: true, path: selected };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('soloist:select', async (_event, exePath) => {
    try {
      const selected = await soloistService.select(exePath);
      return { ok: true, path: selected };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('soloist:get-saved-key', async () => {
    try {
      const key = await soloistService.getSavedKey();
      return { ok: true, hasKey: Boolean(key && key.length > 0) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('soloist:save-key', async (_event, key) => {
    try {
      await soloistService.saveKey(key);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('soloist:start', async (_event, options) => {
    try {
      const key = options && options.key;
      const remember = options && typeof options.remember === 'boolean' ? options.remember : true;
      await soloistService.start(key, remember);
      return { ok: true, status: soloistService.engine.getStatus() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('soloist:stop', async () => {
    try {
      await soloistService.stop();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('soloist:forget', async () => {
    try {
      await soloistService.forget();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('soloist:get-status', () => {
    return soloistService.engine.getStatus();
  });

  ipcMain.handle('soloist:get-progress', () => {
    return {
      progressSec: soloistService.engine.getProgressSec(),
      progressMs: soloistService.engine.getProgressMs(),
    };
  });

  ipcMain.handle('soloist:command', (_event, action, payload) => {
    try {
      const engine = soloistService.engine;
      switch (action) {
        case 'play':
          engine.play(payload && payload.uri);
          break;
        case 'pause':
          engine.pause();
          break;
        case 'resume':
          engine.resume();
          break;
        case 'next':
          engine.next();
          break;
        case 'previous':
          engine.previous();
          break;
        case 'seek':
          engine.seek(payload && typeof payload.positionMs === 'number' ? payload.positionMs : 0);
          break;
        case 'set-volume':
          engine.setVolume(payload && typeof payload.volume === 'number' ? payload.volume : 50);
          break;
        case 'set-shuffle':
          engine.setShuffle(Boolean(payload && payload.enabled));
          break;
        case 'set-repeat':
          engine.setRepeat(payload && payload.mode ? payload.mode : 'off');
          break;
        case 'add-to-queue':
          if (payload && payload.uri) engine.addToQueue(payload.uri);
          break;
        default:
          throw new Error(`Unknown Soloist command: ${action}`);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerSoloistIpc };
