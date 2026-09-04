import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

dotenv.config();

const workspace = process.cwd();
const authDir = process.env.WHATSAPP_AUTH_DIR || '.whatsapp-auth';
const resolvedAuthDir = path.resolve(workspace, authDir);

if (!resolvedAuthDir.startsWith(workspace + path.sep)) {
  throw new Error(`Refusing to reset auth outside the project: ${resolvedAuthDir}`);
}

if (!existsSync(resolvedAuthDir)) {
  console.log(`No existing WhatsApp auth folder at ${authDir}. A fresh QR login will be created.`);
  process.exit(0);
}

const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..+$/, '')
  .replace('T', '-');
const backupDir = path.resolve(workspace, `${path.basename(authDir)}-backup-${timestamp}`);

await mkdir(path.dirname(backupDir), { recursive: true });
await rename(resolvedAuthDir, backupDir);
console.log(`Backed up WhatsApp auth folder to ${path.relative(workspace, backupDir)}.`);
console.log('Start the agent now and scan the QR printed in the terminal.');
