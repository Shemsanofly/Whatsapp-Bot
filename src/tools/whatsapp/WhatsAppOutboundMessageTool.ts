import { z } from 'zod';
import type { AgentTool, ToolExecutionContext, ToolResult } from '../AgentTool.js';
import type { WhatsAppSender } from '../../whatsapp/types.js';
import type { ArchivedWhatsAppChat } from '../chatArchive/types.js';

export interface WhatsAppContactResolver {
  findChats(query: string, limit?: number): Promise<ArchivedWhatsAppChat[]>;
}

const outboundMessageInputSchema = z.object({
  action: z.literal('send'),
  recipient: z.string().min(1),
  message: z.string().min(1)
});

export class WhatsAppOutboundMessageTool implements AgentTool {
  name = 'WhatsAppOutboundMessageTool';
  description = [
    'Send an outbound WhatsApp text message to a direct contact when the user explicitly asks to message, text, tell, or send something to someone.',
    'Use this for requests like "send a message to Amina saying good night"; do not use WhatsAppChatArchiveTool for sending messages.'
  ].join(' ');
  inputSchema = {
    type: 'object',
    required: ['action', 'recipient', 'message'],
    properties: {
      action: { enum: ['send'] },
      recipient: {
        type: 'string',
        description: 'Phone number with country code, direct WhatsApp JID, @lid JID, or archived WhatsApp contact/display name.'
      },
      message: {
        type: 'string',
        description: 'The exact text message to send.'
      }
    }
  };

  constructor(
    private readonly sender: WhatsAppSender,
    private readonly contacts?: WhatsAppContactResolver
  ) {}

  async execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    void context;
    const parsed = outboundMessageInputSchema.parse(input);
    const recipient = await this.resolveRecipient(parsed.recipient);
    if (!recipient.ok) {
      return recipient.result;
    }

    await this.sender.sendText(recipient.target.jid, parsed.message.trim());
    return {
      ok: true,
      message: `Sent WhatsApp message to ${recipient.target.displayName}.`,
      data: {
        recipient: recipient.target.jid
      }
    };
  }

  private async resolveRecipient(recipient: string): Promise<
    | { ok: true; target: { jid: string; displayName: string } }
    | { ok: false; result: ToolResult }
  > {
    const direct = toDirectWhatsAppJid(recipient);
    if (direct) {
      return { ok: true, target: direct };
    }

    if (isBlockedWhatsAppTarget(recipient)) {
      return {
        ok: false,
        result: {
          ok: false,
          message: 'I can only send outbound WhatsApp messages to direct contacts right now.'
        }
      };
    }

    const name = recipient.trim();
    const matches = await this.findRecipientCandidates(name);
    const directMatches = matches.filter((chat) => !chat.isGroup && !isBlockedWhatsAppTarget(chat.remoteJid));
    const bestMatch = findBestContactMatch(name, directMatches);

    if (bestMatch.kind === 'matched') {
      const chat = bestMatch.chat;
      return {
        ok: true,
        target: {
          jid: chat.remoteJid,
          displayName: chat.displayName || chat.remoteJid
        }
      };
    }

    if (directMatches.length > 1 || bestMatch.kind === 'ambiguous') {
      return {
        ok: false,
        result: {
          ok: false,
          message: [
            `I found multiple WhatsApp chats matching "${name}".`,
            ...directMatches.map((chat) => `- ${chat.displayName || chat.remoteJid} (${chat.remoteJid})`),
            'Send the exact phone number or full WhatsApp JID.'
          ].join('\n')
        }
      };
    }

    return {
      ok: false,
      result: {
        ok: false,
        message: `I could not find a WhatsApp contact named "${name}". Send the phone number or exact WhatsApp chat name.`
      }
    };
  }

  private async findRecipientCandidates(name: string): Promise<ArchivedWhatsAppChat[]> {
    if (!this.contacts) {
      return [];
    }

    const candidates = new Map<string, ArchivedWhatsAppChat>();
    const queries = [
      name,
      ...tokenizeContactName(name).filter((term) => term.length >= 3)
    ];

    for (const query of queries) {
      const matches = await this.contacts.findChats(query, 25);
      for (const match of matches) {
        candidates.set(match.remoteJid, match);
      }
    }

    return [...candidates.values()];
  }
}

function toDirectWhatsAppJid(value: string): { jid: string; displayName: string } | undefined {
  const trimmed = value.trim();
  if (isBlockedWhatsAppTarget(trimmed)) {
    return undefined;
  }

  if (/@s\.whatsapp\.net$/i.test(trimmed)) {
    const number = trimmed.replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '');
    return number ? { jid: `${number}@s.whatsapp.net`, displayName: number } : undefined;
  }

  if (/@c\.us$/i.test(trimmed)) {
    const number = trimmed.replace(/@c\.us$/i, '').replace(/\D/g, '');
    return number ? { jid: `${number}@s.whatsapp.net`, displayName: number } : undefined;
  }

  if (/@lid$/i.test(trimmed)) {
    const id = trimmed.replace(/@lid$/i, '').replace(/\D/g, '');
    return id ? { jid: `${id}@lid`, displayName: trimmed } : undefined;
  }

  if (trimmed.includes('@')) {
    return undefined;
  }

  const number = trimmed.replace(/\D/g, '');
  return number ? { jid: `${number}@s.whatsapp.net`, displayName: number } : undefined;
}

function isBlockedWhatsAppTarget(value: string): boolean {
  const target = value.trim().toLowerCase();
  return target === 'status@broadcast' || target.endsWith('@g.us');
}

function findBestContactMatch(
  query: string,
  chats: ArchivedWhatsAppChat[]
): { kind: 'matched'; chat: ArchivedWhatsAppChat } | { kind: 'ambiguous' } | { kind: 'none' } {
  if (chats.length === 0) {
    return { kind: 'none' };
  }

  const ranked = chats
    .map((chat) => ({ chat, score: scoreContactMatch(query, chat) }))
    .sort((left, right) => right.score - left.score);
  const [best, second] = ranked;
  if (!best) {
    return { kind: 'none' };
  }

  if (chats.length === 1) {
    return best.score >= 0.68 ? { kind: 'matched', chat: best.chat } : { kind: 'none' };
  }

  if (best.score >= 0.78 && (!second || best.score - second.score >= 0.15)) {
    return { kind: 'matched', chat: best.chat };
  }

  return { kind: 'ambiguous' };
}

function scoreContactMatch(query: string, chat: ArchivedWhatsAppChat): number {
  const queryTerms = tokenizeContactName(query);
  const candidateTerms = tokenizeContactName(`${chat.displayName ?? ''} ${chat.remoteJid}`);
  if (queryTerms.length === 0 || candidateTerms.length === 0) {
    return 0;
  }

  const termScores = queryTerms.map((queryTerm) =>
    Math.max(...candidateTerms.map((candidateTerm) => scoreTermMatch(queryTerm, candidateTerm)))
  );
  return termScores.reduce((sum, score) => sum + score, 0) / termScores.length;
}

function scoreTermMatch(queryTerm: string, candidateTerm: string): number {
  if (queryTerm === candidateTerm) {
    return 1;
  }
  if (candidateTerm.includes(queryTerm) || queryTerm.includes(candidateTerm)) {
    return Math.min(queryTerm.length, candidateTerm.length) / Math.max(queryTerm.length, candidateTerm.length);
  }

  const maxLength = Math.max(queryTerm.length, candidateTerm.length);
  if (maxLength < 4) {
    return 0;
  }
  return 1 - levenshteinDistance(queryTerm, candidateTerm) / maxLength;
}

function tokenizeContactName(value: string): string[] {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 1);
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      current[rightIndex + 1] = Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? 0;
}
