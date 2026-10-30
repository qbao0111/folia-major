// electron/spotify-soloist/vault.cjs
// Secure local credential storage for Spotify Soloist using Electron safeStorage (DPAPI on Windows).

const fs = require('node:fs/promises');
const path = require('node:path');
const { safeStorage } = require('electron');
const { assertEncryptionAvailable } = require('../../osEncryption.cjs');

class SoloistVault {
  /**
   * @param {string} storageDir
   */
  constructor(storageDir) {
    this.directory = storageDir;
  }

  /**
   * @param {string} name
   * @param {string} value
   */
  async save(name, value) {
    assertEncryptionAvailable(safeStorage, process.platform);
    await fs.mkdir(this.directory, { recursive: true });
    const encrypted = safeStorage.encryptString(value);
    const targetFile = path.join(this.directory, `${name}.bin`);
    await fs.writeFile(targetFile, encrypted, { mode: 0o600 });
  }

  /**
   * @param {string} name
   * @returns {Promise<string | undefined>}
   */
  async read(name) {
    try {
      const targetFile = path.join(this.directory, `${name}.bin`);
      const buffer = await fs.readFile(targetFile);
      return safeStorage.decryptString(buffer);
    } catch {
      return undefined;
    }
  }

  /**
   * @param {string} name
   */
  async remove(name) {
    try {
      const targetFile = path.join(this.directory, `${name}.bin`);
      await fs.rm(targetFile, { force: true });
    } catch {
      // Ignore if not present
    }
  }
}

module.exports = { SoloistVault };
