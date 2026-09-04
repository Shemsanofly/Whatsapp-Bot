import { normalizeWhatsAppNumber, WhatsAppAuthorizer } from '../security/WhatsAppAuthorizer.js';
import type { AgentOrchestratorPort, IncomingWhatsAppMessage, WhatsAppSender } from './types.js';
import { logger } from '../utils/logger.js';

interface WhatsAppMessageArchive {
  recordMessage(input: {
    externalId?: string;
    remoteJid: string;
    participantJid?: string;
    displayName?: string;
    fromMe: boolean;
    text: string;
    messageAt: Date;
  }): Promise<void>;
}

interface WhatsAppMessageHandlerOptions {
  replyToAll?: boolean;
  processFromMeCommands?: boolean;
  fromMeCommandPrefix?: string;
  ownerWhatsAppNumber?: string;
}

export class WhatsAppMessageHandler {
  constructor(
    private readonly authorizer: WhatsAppAuthorizer,
    private readonly agent: AgentOrchestratorPort,
    private readonly sender: WhatsAppSender,
    private readonly archive?: WhatsAppMessageArchive,
    private readonly options: WhatsAppMessageHandlerOptions = {}
  ) {}

  async handleIncomingMessage(message: IncomingWhatsAppMessage): Promise<void> {
    if (!message.text.trim()) {
      return;
    }

    await this.archiveMessage(message);

    const isFromMeCommand = this.isFromMeCommand(message);
    const isOwnerChat = this.authorizer.isAuthorized([
      message.from,
      message.senderPn,
      message.participantPn,
      message.participant
    ]) || isFromMeCommand;
    const isPublicReply = this.isPublicReply(message, isOwnerChat);
    const fromMePrefix = this.options.fromMeCommandPrefix ?? '/agent';
    logger.info({
      from: message.from,
      normalizedFrom: normalizeWhatsAppNumber(message.from),
      normalizedSenderPn: message.senderPn ? normalizeWhatsAppNumber(message.senderPn) : undefined,
      fromMe: message.fromMe,
      isAuthorizedControlChat: isOwnerChat,
      isPublicReply,
      hasFromMeCommandPrefix: message.text.toLowerCase().startsWith(fromMePrefix.toLowerCase())
    }, 'Received WhatsApp text message');

    if (!isOwnerChat && !isPublicReply) {
      logger.info({ from: message.from }, 'Ignoring WhatsApp message from non-owner chat');
      return;
    }

    const agentText = this.getAgentText(message);
    if (!agentText) {
      logger.info({ from: message.from, fromMe: message.fromMe }, 'Ignoring WhatsApp message that is not an agent command');
      return;
    }

    try {
      const response = await this.agent.handleMessage({
        whatsappNumber: this.getOwnerNumber(message, isFromMeCommand),
        messageId: message.id,
        text: agentText,
        accessLevel: isOwnerChat ? 'owner' : 'public'
      });
      const responseJid = this.getResponseJid(message, isFromMeCommand);
      await this.sender.sendText(responseJid, response);
      logger.info({ to: responseJid }, 'Sent WhatsApp agent response');
    } catch (error) {
      logger.error({ error }, 'WhatsApp message handling failed');
      await this.sender.sendText(message.from, "I'm having trouble processing that request right now. Please try again.");
    }
  }

  private async archiveMessage(message: IncomingWhatsAppMessage): Promise<void> {
    if (!this.archive) {
      return;
    }
    try {
      await this.archive.recordMessage({
        externalId: message.id,
        remoteJid: message.from,
        participantJid: message.participant,
        displayName: message.pushName,
        fromMe: message.fromMe,
        text: message.text,
        messageAt: message.timestamp
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to archive WhatsApp message');
    }
  }

  private getAgentText(message: IncomingWhatsAppMessage): string | undefined {
    if (!message.fromMe) {
      return message.text;
    }

    if (!this.isFromMeCommand(message)) {
      return undefined;
    }

    const prefix = this.options.fromMeCommandPrefix ?? '/agent';
    const text = message.text.slice(prefix.length).trim();
    return text.length > 0 ? text : undefined;
  }

  private isFromMeCommand(message: IncomingWhatsAppMessage): boolean {
    if (!message.fromMe || !this.options.processFromMeCommands) {
      return false;
    }

    const prefix = this.options.fromMeCommandPrefix ?? '/agent';
    if (!message.text.toLowerCase().startsWith(prefix.toLowerCase())) {
      return false;
    }

    return message.text.slice(prefix.length).trim().length > 0;
  }

  private isPublicReply(message: IncomingWhatsAppMessage, isOwnerChat: boolean): boolean {
    return Boolean(this.options.replyToAll)
      && !isOwnerChat
      && !message.fromMe
      && !isGroupJid(message.from);
  }

  private getOwnerNumber(message: IncomingWhatsAppMessage, isFromMeCommand: boolean): string {
    const configuredOwner = isFromMeCommand ? this.options.ownerWhatsAppNumber : undefined;
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
