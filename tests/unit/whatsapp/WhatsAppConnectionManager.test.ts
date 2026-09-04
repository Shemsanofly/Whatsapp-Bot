import { describe, expect, it, vi } from 'vitest';
import type { IncomingWhatsAppMessage } from '../../../src/whatsapp/types.js';

const handlers = new Map<string, (payload: any) => unknown>();
let socketOptions: Record<string, any> | undefined;
const qrGenerate = vi.fn();

vi.mock('@whiskeysockets/baileys', () => ({
  default: vi.fn((options: Record<string, any>) => {
    socketOptions = options;
    return {
      ev: {
        on: vi.fn((event: string, handler: (payload: any) => unknown) => {
          handlers.set(event, handler);
        })
      },
      user: { id: '255799999999:1@s.whatsapp.net' },
      sendMessage: vi.fn(),
      logout: vi.fn(),
      end: vi.fn()
    };
  }),
  DisconnectReason: { loggedOut: 401 },
  fetchLatestBaileysVersion: vi.fn(async () => ({ version: [2, 3000, 1] })),
  useMultiFileAuthState: vi.fn(async () => ({
    state: { creds: {}, keys: {} },
    saveCreds: vi.fn()
  }))
}));

vi.mock('qrcode-terminal', () => ({
  default: { generate: qrGenerate }
}));

describe('WhatsAppConnectionManager', () => {
  it('configures Baileys to ignore status broadcasts before decrypting messages', async () => {
    const { WhatsAppConnectionManager } = await import('../../../src/whatsapp/WhatsAppConnectionManager.js');

    await new WhatsAppConnectionManager('.test-auth').connect();

    expect(socketOptions?.shouldIgnoreJid?.('status@broadcast')).toBe(true);
    expect(socketOptions?.shouldIgnoreJid?.('255712345678@s.whatsapp.net')).toBe(false);
  });

  it('prints clear QR instructions when WhatsApp provides a QR code', async () => {
    const output: string[] = [];
    const originalLog = console.log;
    qrGenerate.mockImplementation((_qr: string, _options: unknown, callback: (qr: string) => void) => {
      callback('qr-as-terminal-text');
    });
    console.log = (value?: unknown) => {
      output.push(String(value ?? ''));
    };
    const { WhatsAppConnectionManager } = await import('../../../src/whatsapp/WhatsAppConnectionManager.js');

    await new WhatsAppConnectionManager('.test-auth').connect();
    await handlers.get('connection.update')?.({ qr: 'raw-qr-code' });

    console.log = originalLog;
    expect(output.join('\n')).toContain('Scan this WhatsApp QR code');
    expect(output.join('\n')).toContain('qr-as-terminal-text');
  });

  it('skips optional Baileys startup queries that can delay bot readiness', async () => {
    const { WhatsAppConnectionManager } = await import('../../../src/whatsapp/WhatsAppConnectionManager.js');

    await new WhatsAppConnectionManager('.test-auth').connect();

    expect(socketOptions).toEqual(expect.objectContaining({
      fireInitQueries: false,
      markOnlineOnConnect: false,
      defaultQueryTimeoutMs: 20_000
    }));
  });

  it('does not let one slow incoming message block the rest of the Baileys event batch', async () => {
    const { WhatsAppConnectionManager } = await import('../../../src/whatsapp/WhatsAppConnectionManager.js');
    const manager = new WhatsAppConnectionManager('.test-auth');
    const seen: string[] = [];
    let releaseFirstMessage: (() => void) | undefined;

    manager.onMessage(async (message: IncomingWhatsAppMessage) => {
      seen.push(message.text);
      if (message.text === 'first') {
        await new Promise<void>((resolve) => {
          releaseFirstMessage = resolve;
        });
      }
    });

    await manager.connect();
    handlers.get('messages.upsert')?.({
      messages: [
        {
          key: { id: 'message-1', remoteJid: '255700000000@s.whatsapp.net', fromMe: false },
          message: { conversation: 'first' },
          messageTimestamp: 1788038346
        },
        {
          key: { id: 'message-2', remoteJid: '255711111111@s.whatsapp.net', fromMe: false },
          message: { conversation: 'second' },
          messageTimestamp: 1788038347
        }
      ]
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual(['first', 'second']);
    releaseFirstMessage?.();
  });

  it('emits WhatsApp contact names when Baileys provides contact updates', async () => {
    const { WhatsAppConnectionManager } = await import('../../../src/whatsapp/WhatsAppConnectionManager.js');
    const manager = new WhatsAppConnectionManager('.test-auth');
    const seen: unknown[] = [];

    (manager as any).onContact((contact: unknown) => {
      seen.push(contact);
    });

    await manager.connect();
    handlers.get('contacts.upsert')?.([
      {
        id: '255712345678@s.whatsapp.net',
        name: 'Amina Home',
        notify: 'Amina'
      }
    ]);
    handlers.get('contacts.update')?.([
      {
        id: '16033834344469@lid',
        notify: 'Mohammed Hackthon'
      }
    ]);

    expect(seen).toEqual([
      {
        remoteJid: '255712345678@s.whatsapp.net',
        displayName: 'Amina Home'
      },
      {
        remoteJid: '16033834344469@lid',
        displayName: 'Mohammed Hackthon'
      }
    ]);
  });

  it('emits WhatsApp contact names from messaging history bundles', async () => {
    const { WhatsAppConnectionManager } = await import('../../../src/whatsapp/WhatsAppConnectionManager.js');
    const manager = new WhatsAppConnectionManager('.test-auth');
    const seen: unknown[] = [];

    (manager as any).onContact((contact: unknown) => {
      seen.push(contact);
    });

    await manager.connect();
    handlers.get('messaging-history.set')?.({
      chats: [],
      messages: [],
      contacts: [
        {
          id: '255712345678@s.whatsapp.net',
          name: 'Mohammed Hackathon',
          notify: 'Mohammed'
        }
      ]
    });

    expect(seen).toEqual([
      {
        remoteJid: '255712345678@s.whatsapp.net',
        displayName: 'Mohammed Hackathon'
      }
    ]);
  });
});
