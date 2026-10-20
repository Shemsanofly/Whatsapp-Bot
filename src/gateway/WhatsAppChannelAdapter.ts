import type { ChannelAdapter, ChannelMessage, ChannelMessageHandler } from './types.js';
import { normalizeWhatsAppNumber, WhatsAppAuthorizer } from '../security/WhatsAppAuthorizer.js';
import { SenderRateLimiter } from '../security/SenderRateLimiter.js';
import type { IncomingWhatsAppContact, IncomingWhatsAppMessage, WhatsAppHealth, WhatsAppSendOptions } from '../whatsapp/types.js';
import type { AudioTranscriber } from '../agent/types.js';
import { logger } from '../utils/logger.js';

export interface WhatsAppConnectionPort {
  onMessage(callback: (message: IncomingWhatsAppMessage) => Promise<void>): void;
  onContact?(callback: (contact: IncomingWhatsAppContact) => Promise<void>): void;
  connect(): Promise<void>;
  shutdown(): Promise<void>;
  sendText(to: string, text: string, options?: WhatsAppSendOptions): Promise<void>;
  getHealth(): WhatsAppHealth;
  getSelfIds?(): string[];
  markRead?(message: IncomingWhatsAppMessage): Promise<void>;
  sendTyping?(to: string, typing: boolean): Promise<void>;
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
  /** off: ignore groups; mention: reply when mentioned, replied to, or prefixed; all: reply to every group message. */
  groupReplyMode?: 'off' | 'mention' | 'all';
  groupCommandPrefix?: string;
  /** Max agent replies per public sender per minute. 0 or undefined disables limiting. */
  publicRateLimitPerMinute?: number;
  /** Transcribe voice notes and answer them like text. Requires a transcriber. Defaults to true. */
  voiceNotes?: boolean;
  /** Longer voice notes are refused before downloading. 0 or undefined disables the limit. */
  voiceNoteMaxSeconds?: number;
}

const VOICE_NOTE_ARCHIVE_LABEL = '[Voice note]';
const VOICE_NOTES_UNAVAILABLE = "I can't listen to voice notes right now. Please type your message instead.";
const VOICE_NOTE_NOT_UNDERSTOOD = "Sorry, I couldn't understand that voice note. Please try again or type your message.";

const RATE_LIMIT_NOTICE = "You're sending messages faster than I can answer. Please wait a minute and try again.";

export class WhatsAppChannelAdapter implements ChannelAdapter {
  readonly id = 'whatsapp';
  readonly name = 'WhatsApp';
  readonly enabled: boolean;
  private messageHandler?: ChannelMessageHandler;
  private readonly rateLimiter: SenderRateLimiter;

  constructor(private readonly deps: {
    connection: WhatsAppConnectionPort;
    authorizer: WhatsAppAuthorizer;
    archive?: WhatsAppMessageArchive;
    transcriber?: AudioTranscriber;
    options?: WhatsAppChannelOptions;
  }) {
    this.enabled = deps.options?.enabled ?? true;
    this.rateLimiter = new SenderRateLimiter(deps.options?.publicRateLimitPerMinute ?? 0);
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

  sendReply(message: ChannelMessage, text: string): Promise<void> {
    const raw = message.raw as IncomingWhatsAppMessage | undefined;
    // Quote the question in groups so members can see who the answer is for.
    const options = message.isGroup && raw ? { quoted: raw } : undefined;
    return this.deps.connection.sendText(message.conversationId, text, options);
  }

  async setTyping(message: ChannelMessage, typing: boolean): Promise<void> {
    const raw = message.raw as IncomingWhatsAppMessage | undefined;
    if (typing && raw && !raw.fromMe) {
      await this.deps.connection.markRead?.(raw);
    }
    await this.deps.connection.sendTyping?.(message.conversationId, typing);
  }

  getHealth(): WhatsAppHealth {
    return this.deps.connection.getHealth();
  }

  private async handleIncomingMessage(message: IncomingWhatsAppMessage): Promise<void> {
    const isVoiceOnly = Boolean(message.audio) && !message.text.trim();
    if (!message.text.trim() && !isVoiceOnly) {
      return;
    }

    await this.archiveMessage(isVoiceOnly ? { ...message, text: VOICE_NOTE_ARCHIVE_LABEL } : message);

    if (message.isBacklog) {
      logger.info({ from: message.from, messageId: message.id }, 'Not replying to backlog WhatsApp message');
      return;
    }

    const isGroup = isGroupJid(message.from);
    const isFromMeCommand = this.isFromMeCommand(message);
    const isOwnerChat = this.deps.authorizer.isAuthorized(isGroup
      ? [message.participantPn, message.participant]
      : [message.from, message.senderPn, message.participantPn, message.participant]) || isFromMeCommand;
    const isPublicReply = this.isPublicReply(message, isOwnerChat);
    const prefix = this.deps.options?.fromMeCommandPrefix ?? '/agent';

    logger.info({
      from: message.from,
      normalizedFrom: normalizeWhatsAppNumber(message.from),
      normalizedSenderPn: message.senderPn ? normalizeWhatsAppNumber(message.senderPn) : undefined,
      fromMe: message.fromMe,
      isAuthorizedControlChat: isOwnerChat,
      isPublicReply,
      isGroup,
      hasFromMeCommandPrefix: message.text.toLowerCase().startsWith(prefix.toLowerCase())
    }, 'Received WhatsApp channel message');

    if (!isOwnerChat && !isPublicReply) {
      logger.info({ from: message.from }, 'Ignoring WhatsApp channel message from non-owner chat');
      return;
    }

    const typedText = isVoiceOnly
      ? undefined
      : isGroup && !isFromMeCommand ? this.getGroupAgentText(message) : this.getAgentText(message);
    const isAddressed = isVoiceOnly ? this.isVoiceNoteAddressed(message, isGroup) : Boolean(typedText);
    if (!isAddressed) {
      logger.info({ from: message.from, fromMe: message.fromMe }, 'Ignoring WhatsApp channel message that is not an agent command');
      return;
    }

    const senderId = this.getOwnerNumber(message, isFromMeCommand);
    const conversationId = this.getResponseJid(message, isFromMeCommand);
    if (!isOwnerChat) {
      const limit = this.rateLimiter.check(senderId);
      if (limit !== 'allowed') {
        logger.warn({ from: message.from, senderId }, 'Rate limiting WhatsApp sender');
        if (limit === 'limited') {
          await this.sendNotice(conversationId, RATE_LIMIT_NOTICE, isGroup ? message : undefined);
        }
        return;
      }
    }

    let text = typedText ?? '';
    let agentMessage = message;
    if (isVoiceOnly) {
      const transcript = await this.transcribeVoiceNote(message, conversationId, isGroup);
      if (!transcript) {
        return;
      }
      text = transcript;
      agentMessage = { ...message, text: transcript };
      await this.archiveMessage({ ...message, text: `${VOICE_NOTE_ARCHIVE_LABEL} ${transcript}` });
    }

    await this.messageHandler?.({
      channel: this.id,
      messageId: message.id,
      conversationId,
      senderId,
      senderDisplayName: message.pushName,
      // Owner-only tools expose private data, so never enable them where a whole group would see the reply.
      accessLevel: isOwnerChat && !isGroup ? 'owner' : 'public',
      fromSelf: message.fromMe,
      isGroup,
      isVoiceNote: isVoiceOnly || undefined,
      text,
      timestamp: message.timestamp,
      raw: agentMessage
    });
  }

  private isVoiceNoteAddressed(message: IncomingWhatsAppMessage, isGroup: boolean): boolean {
    if (message.fromMe) {
      // From-me commands need a typed prefix, which a voice note cannot carry.
      return false;
    }
    if (!isGroup) {
      return true;
    }
    const mode = this.deps.options?.groupReplyMode ?? 'off';
    return mode === 'all' || (mode === 'mention' && (this.isMentioned(message) || this.isReplyToAgent(message)));
  }

  /** Returns the transcript, or undefined after telling the sender why the voice note could not be answered. */
  private async transcribeVoiceNote(
    message: IncomingWhatsAppMessage,
    conversationId: string,
    isGroup: boolean
  ): Promise<string | undefined> {
    const audio = message.audio;
    const transcriber = this.deps.options?.voiceNotes === false ? undefined : this.deps.transcriber;
    const notify = (text: string) => this.sendNotice(conversationId, text, isGroup ? message : undefined);
    if (!audio || !transcriber) {
      await notify(VOICE_NOTES_UNAVAILABLE);
      return undefined;
    }

    const maxSeconds = this.deps.options?.voiceNoteMaxSeconds ?? 0;
    if (maxSeconds > 0 && (audio.seconds ?? 0) > maxSeconds) {
      await notify(`That voice note is too long for me. Please keep it under ${formatDuration(maxSeconds)} or type your message.`);
      return undefined;
    }

    try {
      await this.deps.connection.sendTyping?.(conversationId, true).catch(() => undefined);
      const transcript = (await transcriber.transcribe(await audio.download(), audio.mimeType)).trim();
      if (transcript) {
        logger.info({ from: message.from, seconds: audio.seconds, length: transcript.length }, 'Transcribed WhatsApp voice note');
        return transcript;
      }
      logger.info({ from: message.from }, 'WhatsApp voice note transcript was empty');
    } catch (error) {
      logger.warn({ error, from: message.from }, 'Failed to transcribe WhatsApp voice note');
    }
    await notify(VOICE_NOTE_NOT_UNDERSTOOD);
    await this.deps.connection.sendTyping?.(conversationId, false).catch(() => undefined);
    return undefined;
  }

  private async sendNotice(conversationId: string, text: string, quoted?: IncomingWhatsAppMessage): Promise<void> {
    try {
      await this.deps.connection.sendText(conversationId, text, quoted ? { quoted } : undefined);
    } catch (error) {
      logger.warn({ error }, 'Failed to send WhatsApp notice');
    }
  }

  /**
   * In groups the agent only answers when addressed (unless mode is 'all'):
   * an @mention of the agent, a reply to one of its messages, or the group command prefix.
   */
  private getGroupAgentText(message: IncomingWhatsAppMessage): string | undefined {
    if (message.fromMe) {
      return undefined;
    }

    const mode = this.deps.options?.groupReplyMode ?? 'off';
    if (mode === 'off') {
      return undefined;
    }
    const prefix = this.deps.options?.groupCommandPrefix ?? '/hawa';
    const hasPrefix = prefix.length > 0 && message.text.toLowerCase().startsWith(prefix.toLowerCase());

    if (mode !== 'all' && !hasPrefix && !this.isMentioned(message) && !this.isReplyToAgent(message)) {
      return undefined;
    }

    let text = hasPrefix ? message.text.slice(prefix.length) : message.text;
    for (const selfId of this.getSelfIds()) {
      text = text.replace(new RegExp(`@${selfId}\\b`, 'g'), '');
    }
    text = text.replace(/\s+/g, ' ').trim();
    return text.length > 0 ? text : undefined;
  }

  private getSelfIds(): Set<string> {
    return new Set(this.deps.connection.getSelfIds?.() ?? []);
  }

  private isSelf(jid: string | undefined): boolean {
    return Boolean(jid) && this.getSelfIds().has(normalizeWhatsAppNumber(jid ?? ''));
  }

  private isMentioned(message: IncomingWhatsAppMessage): boolean {
    return (message.mentionedJids ?? []).some((jid) => this.isSelf(jid));
  }

  private isReplyToAgent(message: IncomingWhatsAppMessage): boolean {
    return this.isSelf(message.quotedParticipant);
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
    if (message.fromMe) {
      return false;
    }
    if (isGroupJid(message.from)) {
      return (this.deps.options?.groupReplyMode ?? 'off') !== 'off';
    }
    return Boolean(this.deps.options?.replyToAll) && !isOwnerChat;
  }

  private getOwnerNumber(message: IncomingWhatsAppMessage, isFromMeCommand: boolean): string {
    const configuredOwner = isFromMeCommand ? this.deps.options?.ownerWhatsAppNumber : undefined;
    if (isGroupJid(message.from) && !isFromMeCommand) {
      // In groups the remote JID is the group; identify the member who wrote.
      return normalizePreferredWhatsAppNumber([message.participantPn, message.senderPn, message.participant]);
    }
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
    return message.from;
  }
}

function formatDuration(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${seconds} seconds`;
}

function isGroupJid(value: string): boolean {
  return /@g\.us$/i.test(value);
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
