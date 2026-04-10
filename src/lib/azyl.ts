import { Client } from 'ssh2';
import type { ConnectConfig } from 'ssh2';

// ── Konfiguracja Azylu ────────────────────────────────────────────────────────
export const AZYL_HOST = 'azyl.ag3nts.org';
export const AZYL_USER = 'agent13348';
export const AZYL_PORT = 5022;

function getPassword(): string {
  return (import.meta.env.AZYL_PASSWORD as string | undefined) ?? '';
}

function getRemotePort(): number {
  return parseInt((import.meta.env.AZYL_REMOTE_PORT as string | undefined) ?? '0', 10);
}

export function getAzylInfo() {
  const remotePort = getRemotePort();
  return {
    user: AZYL_USER,
    host: AZYL_HOST,
    port: AZYL_PORT,
    remotePort,
    publicUrl: remotePort ? `https://azyl-${remotePort}.ag3nts.org` : null,
    hasPassword: !!getPassword(),
  };
}

// ── Wykonaj polecenie na Azylu przez SSH ─────────────────────────────────────
// Zwraca Promise<string> ze złączonym stdout+stderr
export function execOnAzyl(command: string, timeoutMs = 30_000): Promise<string> {
  const password = getPassword();
  if (!password) {
    return Promise.reject(new Error('Brak hasła do Azylu — dodaj AZYL_PASSWORD do .env'));
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';

    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`Timeout po ${timeoutMs}ms`));
    }, timeoutMs);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          conn.end();
          reject(err);
          return;
        }
        stream.on('close', () => {
          clearTimeout(timer);
          conn.end();
          resolve(output.trim());
        });
        stream.on('data', (data: Buffer) => { output += data.toString(); });
        stream.stderr.on('data', (data: Buffer) => { output += data.toString(); });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    const config: ConnectConfig = {
      host: AZYL_HOST,
      port: AZYL_PORT,
      username: AZYL_USER,
      password,
      readyTimeout: Math.min(timeoutMs, 10_000),
      algorithms: {
        serverHostKey: [
          'ssh-rsa', 'rsa-sha2-256', 'rsa-sha2-512',
          'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521',
          'ssh-ed25519',
        ],
      },
    };
    conn.connect(config);
  });
}

// ── Streamuj komendę na Azylu (np. tail -f) ──────────────────────────────────
// onData(chunk) wywoływany dla każdego kawałka danych, onClose() po zakończeniu
export function streamFromAzyl(
  command: string,
  onData: (chunk: string) => void,
  onClose: () => void,
  onError: (err: Error) => void,
  timeoutMs = 600_000,
): () => void {
  const password = getPassword();
  if (!password) {
    onError(new Error('Brak hasła do Azylu — dodaj AZYL_PASSWORD do .env'));
    return () => {};
  }

  const conn = new Client();
  let ended = false;

  const timer = setTimeout(() => {
    if (!ended) { ended = true; conn.end(); onClose(); }
  }, timeoutMs);

  conn.on('ready', () => {
    conn.exec(command, (err, stream) => {
      if (err) { clearTimeout(timer); conn.end(); onError(err); return; }
      stream.on('data', (data: Buffer) => { onData(data.toString()); });
      stream.stderr.on('data', (data: Buffer) => { onData(data.toString()); });
      stream.on('close', () => {
        clearTimeout(timer);
        if (!ended) { ended = true; conn.end(); onClose(); }
      });
    });
  });

  conn.on('error', (err) => {
    clearTimeout(timer);
    if (!ended) { ended = true; onError(err); }
  });

  conn.connect({
    host: AZYL_HOST,
    port: AZYL_PORT,
    username: AZYL_USER,
    password,
    readyTimeout: 10_000,
    algorithms: {
      serverHostKey: [
        'ssh-rsa', 'rsa-sha2-256', 'rsa-sha2-512',
        'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521',
        'ssh-ed25519',
      ],
    },
  });

  // Zwraca funkcję do anulowania streamu
  return () => { if (!ended) { ended = true; clearTimeout(timer); conn.end(); } };
}

// ── Wgraj plik na Azyl przez SFTP ────────────────────────────────────────────
export function uploadToAzyl(
  localContent: string,
  remotePath: string,
  timeoutMs = 30_000,
): Promise<void> {
  const password = getPassword();
  if (!password) {
    return Promise.reject(new Error('Brak hasła do Azylu — dodaj AZYL_PASSWORD do .env'));
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();

    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`Timeout po ${timeoutMs}ms`));
    }, timeoutMs);

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timer);
          conn.end();
          reject(err);
          return;
        }

        const writeStream = sftp.createWriteStream(remotePath);
        writeStream.on('close', () => {
          clearTimeout(timer);
          conn.end();
          resolve();
        });
        writeStream.on('error', (e: Error) => {
          clearTimeout(timer);
          conn.end();
          reject(e);
        });

        writeStream.write(Buffer.from(localContent, 'utf-8'));
        writeStream.end();
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    conn.connect({
      host: AZYL_HOST,
      port: AZYL_PORT,
      username: AZYL_USER,
      password,
      readyTimeout: Math.min(timeoutMs, 10_000),
    });
  });
}
