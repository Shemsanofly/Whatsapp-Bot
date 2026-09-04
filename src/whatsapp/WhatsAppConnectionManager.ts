import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type proto,
  type WASocket
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import type { IncomingWhatsAppContact, IncomingWhatsAppMessage, WhatsAppHealth, WhatsAppSender } from './types.js';
import { logger } from '../utils/logger.js';
import { normalizeWhatsAppNumber } from '../security/WhatsAppAuthorizer.js';

type IncomingMessageCallback = (message: IncomingWhatsAppMessage) => Promise<void>;
type IncomingContactCallback = (contact: IncomingWhatsAppContact) => Promise<void> | void;
type WhatsAppMessageKeyWithPhoneMetadata = proto.IMessageKey & {
  senderPn?: string;
  participantPn?: string;
};

export class WhatsAppConnectionManager implements WhatsAppSender {
  private socket?: WASocket;
  private connected = false;
  private authenticated = false;
  private reconnecting = false;
  private incomingMessageCallback?: IncomingMessageCallback;
  private incomingContactCallback?: IncomingContactCallback;
  private currentUserPhone?: string;

  constructor(private readonly authDir: string) {}

  onMessage(callback: IncomingMessageCallback): void {
    this.incomingMessageCallback = callback;
  }

  onContact(callback: IncomingContactCallback): void {
    this.incomingContactCallback = callback;
  }

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();
    const socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      fireInitQueries: false,
      markOnlineOnConnect: false,
      defaultQueryTimeoutMs: 20_000,
      shouldIgnoreJid
    });
    this.socket = socket;

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', async (update) => {
      if (update.qr) {
        printQrCode(update.qr);
      }
      if (update.connection === 'open') {
        this.connected = true;
        this.authenticated = true;
        this.reconnecting = false;
        this.currentUserPhone = normalizeWhatsAppNumber(socket.user?.id ?? '');
      }
      if (update.connection === 'close') {
        this.connected = false;
        const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          this.authenticated = false;
          logger.warn('WhatsApp logged out. Scan the QR code again to authenticate.');
          return;
        }
        await this.reconnect();
      }
    });

    socket.ev.on('messages.upsert', async ({ messages }) => {
      for (const message of messages) {
        const incomingMessage = this.toIncomingMessage(message);
        if (!incomingMessage) {
          continue;
        }
        void this.dispatchIncomingMessage(incomingMessage);
      }
    });

    socket.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) {
        this.dispatchIncomingContact(contact);
      }
    });
    socket.ev.on('contacts.update', (contacts) => {
      for (const contact of contacts) {
        this.dispatchIncomingContact(contact);
      }
    });
    socket.ev.on('messaging-history.set', ({ contacts }) => {
      for (const contact of contacts) {
        this.dispatchIncomingContact(contact);
      }
    });
  }

  async sendText(to: string, text: string): Promise<void> {
    if (!this.socket) {
      throw new Error('WhatsApp is not connected');
    }
    await this.socket.sendMessage(to, { text });
  }

  getHealth(): WhatsAppHealth {
    return {
      connected: this.connected,
      authenticated: this.authenticated
    };
  }

  async logout(): Promise<void> {
    await this.socket?.logout();
    this.connected = false;
    this.authenticated = false;
  }

  async shutdown(): Promise<void> {
    this.socket?.end(undefined);
    this.connected = false;
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting) {
      return;
    }
    this.reconnecting = true;
    setTimeout(() => {
      this.connect().catch((error) => {
        this.reconnecting = false;
        logger.error({ error }, 'WhatsApp reconnect failed');
      });
    }, 3000);
  }

  private getCurrentUserJid(fromMe: boolean): string | undefined {
    if (!fromMe || !this.currentUserPhone) {
      return undefined;
    }
    return `${this.currentUserPhone}@s.whatsapp.net`;
  }

  private toIncomingMessage(message: proto.IWebMessageInfo): IncomingWhatsAppMessage | undefined {
    const key = message.key as WhatsAppMessageKeyWithPhoneMetadata;
    if (!key.remoteJid || !message.message) {
      return undefined;
    }
    const text = message.message.conversation ?? message.message.extendedTextMessage?.text;
    if (!text) {
      return undefined;
    }

    return {
      id: key.id ?? crypto.randomUUID(),
      from: key.remoteJid,
      participant: key.participant ?? undefined,
      senderPn: key.senderPn ?? this.getCurrentUserJid(key.fromMe ?? false),
      participantPn: key.participantPn ?? undefined,
      pushName: message.pushName ?? undefined,
      fromMe: key.fromMe ?? false,
      timestamp: toDate(message.messageTimestamp),
      text
    };
  }

  private async dispatchIncomingMessage(message: IncomingWhatsAppMessage): Promise<void> {
    try {
      await this.incomingMessageCallback?.(message);
    } catch (error) {
      logger.error({ error, from: message.from, messageId: message.id }, 'WhatsApp incoming message callback failed');
    }
  }

  private dispatchIncomingContact(contact: {
    id?: string;
    jid?: string;
    lid?: string;
    name?: string;
    notify?: string;
    verifiedName?: string;
  }): void {
    const remoteJid = contact.jid ?? contact.id ?? contact.lid;
    if (!remoteJid) {
      return;
    }
    const displayName = contact.name ?? contact.notify ?? contact.verifiedName;
    void this.incomingContactCallback?.({
      remoteJid,
      displayName
    });
  }
}

function shouldIgnoreJid(jid: string): boolean {
  return jid === 'status@broadcast';
}

function printQrCode(qr: string): void {
  qrcode.generate(qr, { small: true }, (terminalQr) => {
    console.log('\nScan this WhatsApp QR code:');
    console.log('WhatsApp > Linked devices > Link a device');
    console.log(terminalQr);
    console.log('Keep this terminal open until WhatsApp says the device is linked.\n');
  });
}

function toDate(timestamp: unknown): Date {
  if (typeof timestamp === 'number') {
    return new Date(timestamp * 1000);
  }
  if (timestamp && typeof timestamp === 'object' && 'toNumber' in timestamp && typeof timestamp.toNumber === 'function') {
    return new Date((timestamp.toNumber as () => number)() * 1000);
  }
  return new Date();
}
