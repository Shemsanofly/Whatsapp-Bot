import type { ChannelAdapter, ChannelMessageHandler } from './types.js';
import { normalizeWhatsAppNumber, WhatsAppAuthorizer } from '../security/WhatsAppAuthorizer.js';
import type { IncomingWhatsAppContact, IncomingWhatsAppMessage, WhatsAppHealth } from '../whatsapp/types.js';
import { logger } from '../utils/logger.js';

export interface WhatsAppConnectionPort {
  onMessage(callback: (message: IncomingWhatsAppMessage) => Promise<void>): void;
  onContact?(callback: (contact: IncomingWhatsAppContact) => Promise<void>): void;
  connect(): Promise<void>;
  shutdown(): Promise<void>;
  sendText(to: string, text: string): Promise<void>;
  getHealth(): WhatsAppHealth;
}

export interface WhatsAppMessageArchive {
  recordMessage(input: {
    externalId?: string;
    remoteJid: string;
    participantJid?: string;
    displayName?: string;
    fromMe: boolean;
    text: string;
    messageAt: Date;
  }): Promise<void>;
  recordContact?(input: {
    remoteJid: string;
    displayName?: string;
  }): Promise<void>;
}

export interface WhatsAppChannelOptions {
  enabled?: boolean;
  replyToAll?: boolean;
  processFromMeCommands?: boolean;
  fromMeCommandPrefix?: string;
  ownerWhatsAppNumber?: string;
}

export class WhatsAppChannelAdapter implements ChannelAdapter {
  readonly id = 'whatsapp';
  readonly name = 'WhatsApp';
  readonly enabled: boolean;
  private messageHandler?: ChannelMessageHandler;

  constructor(private readonly deps: {
    connection: WhatsAppConnectionPort;
    authorizer: WhatsAppAuthorizer;
    archive?: WhatsAppMessageArchive;
    options?: WhatsAppChannelOptions;
  }) {
    this.enabled = deps.options?.enabled ?? true;
    this.deps.connection.onMessage((message) => this.handleIncomingMessage(message));
    this.deps.connection.onContact?.((contact) => this.handleIncomingContact(contact));
  }

  onMessage(handler: ChannelMessageHandler): void {
    this.messageHandler = handler;
  }

  start(): Promise<void> {
    return this.deps.connection.connect();
  }

  stop(): Promise<void> {
    return this.deps.connection.shutdown();
  }

  sendText(target: string, text: string): Promise<void> {
    return this.deps.connection.sendText(target, text);
  }

  getHealth(): WhatsAppHealth {
    return this.deps.connection.getHealth();
  }

  private async handleIncomingMessage(message: IncomingWhatsAppMessage): Promise<void> {
    if (!message.text.trim()) {
      return;
    }

    await this.archiveMessage(message);

    const isFromMeCommand = this.isFromMeCommand(message);
    const isOwnerChat = this.deps.authorizer.isAuthorized([
      message.from,
      message.senderPn,
      message.participantPn,
      message.participant
    ]) || isFromMeCommand;
    const isPublicReply = this.isPublicReply(message, isOwnerChat);
    const prefix = this.deps.options?.fromMeCommandPrefix ?? '/agent';

    logger.info({
      from: message.from,
      normalizedFrom: normalizeWhatsAppNumber(message.from),
      normalizedSenderPn: message.senderPn ? normalizeWhatsAppNumber(message.senderPn) : undefined,
      fromMe: message.fromMe,
      isAuthorizedControlChat: isOwnerChat,
      isPublicReply,
      hasFromMeCommandPrefix: message.text.toLowerCase().startsWith(prefix.toLowerCase())
    }, 'Received WhatsApp channel message');

    if (!isOwnerChat && !isPublicReply) {
      logger.info({ from: message.from }, 'Ignoring WhatsApp channel message from non-owner chat');
      return;
    }

    if (isPublicReply && isLidJid(message.from) && !hasPhoneNumberMetadata(message)) {
      logger.info({ from: message.from }, 'Ignoring WhatsApp public lid message without phone metadata');
      return;
    }

    const text = this.getAgentText(message);
    if (!text) {
      logger.info({ from: message.from, fromMe: message.fromMe }, 'Ignoring WhatsApp channel message that is not an agent command');
      return;
    }

    await this.messageHandler?.({
      channel: this.id,
      messageId: message.id,
      conversationId: this.getResponseJid(message, isFromMeCommand),
      senderId: this.getOwnerNumber(message, isFromMeCommand),
      senderDisplayName: message.pushName,
      accessLevel: isOwnerChat ? 'owner' : 'public',
      fromSelf: message.fromMe,
      text,
      timestamp: message.timestamp,
      raw: message
    });
  }

  private async archiveMessage(message: IncomingWhatsAppMessage): Promise<void> {
    if (!this.deps.archive) {
      return;
    }
    try {
      await this.deps.archive.recordMessage({
        externalId: message.id,
        remoteJid: message.from,
        participantJid: message.participant,
        displayName: message.pushName,
        fromMe: message.fromMe,
        text: message.text,
        messageAt: message.timestamp
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to archive WhatsApp channel message');
    }
  }

  private async handleIncomingContact(contact: IncomingWhatsAppContact): Promise<void> {
    if (!this.deps.archive?.recordContact || isBlockedContactJid(contact.remoteJid)) {
      return;
    }
    try {
      await this.deps.archive.recordContact({
        remoteJid: contact.remoteJid,
        displayName: contact.displayName
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to archive WhatsApp contact');
    }
  }

  private getAgentText(message: IncomingWhatsAppMessage): string | undefined {
    if (!message.fromMe) {
      return message.text;
    }

    if (!this.isFromMeCommand(message)) {
      return undefined;
    }

    const prefix = this.deps.options?.fromMeCommandPrefix ?? '/agent';
    const text = message.text.slice(prefix.length).trim();
    return text.length > 0 ? text : undefined;
  }

  private isFromMeCommand(message: IncomingWhatsAppMessage): boolean {
    if (!message.fromMe || !this.deps.options?.processFromMeCommands) {
      return false;
    }

    const prefix = this.deps.options.fromMeCommandPrefix ?? '/agent';
    if (!message.text.toLowerCase().startsWith(prefix.toLowerCase())) {
      return false;
    }

    return message.text.slice(prefix.length).trim().length > 0;
  }

  private isPublicReply(message: IncomingWhatsAppMessage, isOwnerChat: boolean): boolean {
    return Boolean(this.deps.options?.replyToAll)
      && !isOwnerChat
      && !message.fromMe
      && !isGroupJid(message.from);
  }

  private getOwnerNumber(message: IncomingWhatsAppMessage, isFromMeCommand: boolean): string {
    const configuredOwner = isFromMeCommand ? this.deps.options?.ownerWhatsAppNumber : undefined;
    return normalizePreferredWhatsAppNumber([
      message.senderPn,
      message.participantPn,
      configuredOwner,
      message.from,
      message.participant
    ]);
  }

  private getResponseJid(message: IncomingWhatsAppMessage, isFromMeCommand: boolean): string {
    const ownerNumber = this.getOwnerNumber(message, isFromMeCommand);
    if (isFromMeCommand && ownerNumber) {
      return `${ownerNumber}@s.whatsapp.net`;
    }
    if (/@lid$/i.test(message.from) && message.senderPn) {
      const senderNumber = normalizeWhatsAppNumber(message.senderPn);
      if (senderNumber) {
        return `${senderNumber}@s.whatsapp.net`;
      }
    }
    return message.from;
  }
}

function isGroupJid(value: string): boolean {
  return /@g\.us$/i.test(value);
}

function isLidJid(value: string): boolean {
  return /@lid$/i.test(value);
}

function hasPhoneNumberMetadata(message: IncomingWhatsAppMessage): boolean {
  return Boolean(message.senderPn || message.participantPn);
}

function isBlockedContactJid(value: string): boolean {
  const jid = value.toLowerCase();
  return jid === 'status@broadcast' || jid.endsWith('@g.us');
}

function normalizePreferredWhatsAppNumber(candidates: Array<string | undefined>): string {
  const phoneCandidate = candidates.find((candidate) => candidate && !/@lid$/i.test(candidate));
  const preferred = phoneCandidate ? normalizeWhatsAppNumber(phoneCandidate) : '';
  if (preferred) {
    return preferred;
  }

  for (const candidate of candidates) {
    const normalized = normalizeWhatsAppNumber(candidate ?? '');
    if (normalized) {
      return normalized;
    }
  }
  return '';
}
