import { z } from 'zod';
import type { AgentTool, ToolExecutionContext, ToolResult } from '../AgentTool.js';
import type { WhatsAppSender } from '../../whatsapp/types.js';
import type { ArchivedWhatsAppChat } from '../chatArchive/types.js';

export interface WhatsAppContactResolver {
  findChats(query: string): Promise<ArchivedWhatsAppChat[]>;
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
    'Use this for requests like "send a message to Mohammed saying good night"; do not use WhatsAppChatArchiveTool for sending messages.'
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
    const matches = this.contacts ? await this.contacts.findChats(name) : [];
    const directMatches = matches.filter((chat) => !chat.isGroup && !isBlockedWhatsAppTarget(chat.remoteJid));

    if (directMatches.length === 1) {
      const chat = directMatches[0];
      return {
        ok: true,
        target: {
          jid: chat.remoteJid,
          displayName: chat.displayName || chat.remoteJid
        }
      };
    }

    if (directMatches.length > 1) {
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
