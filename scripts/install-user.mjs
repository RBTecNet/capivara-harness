import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const staging = await mkdtemp(join(tmpdir(), 'capivara-install-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  const packed = spawnSync(npm, ['pack', '--workspace', '@capivara/core', '--pack-destination', staging, '--json'], { cwd: root, encoding: 'utf8' });
  if (packed.status !== 0) throw new Error(packed.stderr || 'Não foi possível empacotar o aplicativo.');
  const [{ filename }] = JSON.parse(packed.stdout);
  const installed = spawnSync(npm, ['install', '--global', '--prefix', join(homedir(), '.local'), join(staging, filename), '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' });
  if (installed.status !== 0) throw new Error('A instalação do pacote não foi concluída.');
} finally { await rm(staging, { recursive: true, force: true }); }
