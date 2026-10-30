// src/components/modal/settings/pages/integration/SpotifySoloistRows.tsx
// Settings rows for configuring and managing the Spotify Soloist backend.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FolderOpen, RefreshCw, Trash2, Key } from 'lucide-react';
import { Button, Reveal, Row, Status, TextField, Toggle } from '../../../kit';
import { useSoloistSettingsStore } from '../../../../../../services/soloist/useSoloistSettingsStore';
import { useSoloistStore } from '../../../../../../services/soloist/useSoloistStore';
import { runsOnWindows } from '../../../../../../utils/platform';

export const SoloistRows: React.FC = () => {
  const { t } = useTranslation();
  const soloistState = useSoloistStore();
  const { soloistEnabled, rememberKey, setSoloistEnabled, setRememberKey } = useSoloistSettingsStore();

  const [detectedPath, setDetectedPath] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [hasSavedKey, setHasSavedKey] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Check initial executable and stored key
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electron?.soloist) return;

    window.electron.soloist.detect().then((res) => {
      if (res.ok && res.path) setDetectedPath(res.path);
    }).catch(() => {});

    window.electron.soloist.getSavedKey().then((res) => {
      if (res.ok) setHasSavedKey(Boolean(res.hasKey));
    }).catch(() => {});
  }, []);

  const handlePickExe = async () => {
    if (!window.electron?.soloist) return;
    setActionError(null);
    try {
      const res = await window.electron.soloist.pickFile();
      if (res.ok && res.path) {
        setDetectedPath(res.path);
      } else if (res.error) {
        setActionError(res.error);
      }
    } catch (err: any) {
      setActionError(err?.message || 'Error selecting soloist.exe');
    }
  };

  const handleStartSoloist = async () => {
    if (!window.electron?.soloist) return;
    setIsStarting(true);
    setActionError(null);
    try {
      const res = await window.electron.soloist.start({
        key: apiKeyInput ? apiKeyInput.trim() : undefined,
        remember: rememberKey,
      });
      if (!res.ok && res.error) {
        setActionError(res.error);
      } else {
        setHasSavedKey(true);
        setApiKeyInput('');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to start Soloist');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopSoloist = async () => {
    if (!window.electron?.soloist) return;
    setActionError(null);
    try {
      await window.electron.soloist.stop();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to stop Soloist');
    }
  };

  const handleForgetSoloist = async () => {
    if (!window.electron?.soloist) return;
    setActionError(null);
    try {
      await window.electron.soloist.forget();
      setHasSavedKey(false);
      setApiKeyInput('');
    } catch (err: any) {
      setActionError(err?.message || 'Failed to forget credentials');
    }
  };

  // Only render on Windows desktop environments
  if (!runsOnWindows() || typeof window === 'undefined' || !window.electron?.soloist) {
    return null;
  }

  const isConnected = soloistState.connection === 'connected';
  const isConnecting = soloistState.connection === 'connecting' || soloistState.connection === 'reconnecting';
  const isExpired = soloistState.error?.includes('expired') || soloistState.error?.includes('exit 10');

  let statusTone: 'ok' | 'warn' | 'error' | undefined = undefined;
  let statusText = 'Stopped';

  if (isConnecting || isStarting) {
    statusTone = 'warn';
    statusText = 'Connecting…';
  } else if (isConnected) {
    if (soloistState.loggedIn) {
      statusTone = 'ok';
      statusText = `Connected (${soloistState.deviceName || 'Folia'})`;
    } else {
      statusTone = 'warn';
      statusText = 'Waiting for Spotify Connect pairing…';
    }
  } else if (soloistState.error) {
    statusTone = 'error';
    statusText = 'Error';
  }

  return (
    <>
      <Row
        label="Spotify Soloist"
        hint="Official local playback engine connected to your Spotify Premium account."
      >
        <Status tone={statusTone}>{statusText}</Status>
        <Toggle checked={soloistEnabled} onChange={setSoloistEnabled} />
      </Row>

      <Reveal when={soloistEnabled}>
        {/* Executable location */}
        <Row
          sub
          label="Soloist Executable"
          hint={detectedPath || 'Not found. Please select installed soloist.exe.'}
        >
          <Button icon={FolderOpen} onClick={handlePickExe}>
            Browse…
          </Button>
        </Row>

        {/* API Key entry */}
        <Row
          sub
          label="Personal API Key"
          hint={hasSavedKey ? 'Key securely stored in Windows DPAPI vault' : 'Requires Spotify Developer Soloist API key'}
        >
          <div className="flex items-center gap-2">
            <TextField
              type="password"
              value={apiKeyInput}
              onChange={setApiKeyInput}
              placeholder={hasSavedKey ? '••••••••••••••••••••••••' : 'Enter API Key…'}
            />
          </div>
        </Row>

        <Row sub label="Remember API Key Securely" hint="Encrypt and store key locally using Windows safeStorage.">
          <Toggle checked={rememberKey} onChange={setRememberKey} />
        </Row>

        {/* Daemon Controls */}
        <Row
          sub
          label="Engine Lifecycle"
          hint={
            isConnected && soloistState.loggedIn
              ? `Active device: ${soloistState.active ? 'Yes' : 'Standby'} · Volume: ${soloistState.volume}%`
              : 'Daemon must be running to play Spotify music directly.'
          }
        >
          {isConnected ? (
            <Button onClick={handleStopSoloist}>Stop Engine</Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleStartSoloist}
              disabled={isStarting || (!detectedPath && !hasSavedKey && !apiKeyInput)}
            >
              {isStarting ? 'Starting…' : 'Start Soloist'}
            </Button>
          )}

          {hasSavedKey && (
            <Button icon={Trash2} onClick={handleForgetSoloist} disabled={isStarting}>
              Forget
            </Button>
          )}
        </Row>

        {/* Pairing Instructions when waiting for Spotify Connect */}
        <Reveal when={isConnected && !soloistState.loggedIn}>
          <Row
            sub
            notice="Pairing Required: Open Spotify on your phone or desktop, open the Devices menu (Spotify Connect), and select 'Folia' to authorize local playback."
          />
        </Reveal>

        {/* Error notification */}
        <Reveal when={Boolean(actionError || soloistState.error)}>
          <Row
            sub
            label={<Status tone="error">{actionError || soloistState.error}</Status>}
          />
        </Reveal>

        {/* Build expired guidance */}
        <Reveal when={Boolean(isExpired)}>
          <Row
            sub
            notice="Spotify Soloist preview builds expire after 90 days. Please download an updated binary from the official Spotify Developer Portal."
          >
            <Button
              icon={ExternalLink}
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.open('https://developer.spotify.com/documentation/soloist', '_blank');
                }
              }}
            >
              Spotify Developer Docs
            </Button>
          </Row>
        </Reveal>
      </Reveal>
    </>
  );
};

export default SoloistRows;
