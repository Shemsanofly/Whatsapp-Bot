import { WhatsAppMessageHandler } from '../../../src/whatsapp/WhatsAppMessageHandler.js';
import type { AgentOrchestratorPort, WhatsAppSender } from '../../../src/whatsapp/types.js';
import { WhatsAppAuthorizer } from '../../../src/security/WhatsAppAuthorizer.js';

describe('WhatsAppMessageHandler', () => {
  it('ignores unauthorized messages before reaching the agent by default', async () => {
    let agentCalled = false;
    const agent: AgentOrchestratorPort = {
      handleMessage: async () => {
        agentCalled = true;
        return 'agent response';
      }
    };
    const sent: string[] = [];
    const sender: WhatsAppSender = {
      sendText: async (_to, text) => {
        sent.push(text);
      }
    };
    const handler = new WhatsAppMessageHandler(new WhatsAppAuthorizer(['255712345678']), agent, sender);

    await handler.handleIncomingMessage({
      id: 'message-1',
      from: '255700000000@s.whatsapp.net',
      fromMe: false,
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: 'hello'
    });

    expect(agentCalled).toBe(false);
    expect(sent).toEqual([]);
  });

  it('passes public messages to the agent when reply-to-all mode is enabled', async () => {
    let observedNumber = '';
    const agent: AgentOrchestratorPort = {
      handleMessage: async ({ text, whatsappNumber }) => {
        observedNumber = whatsappNumber;
        return `processed ${text}`;
      }
    };
    const sent: Array<{ to: string; text: string }> = [];
    const sender: WhatsAppSender = {
      sendText: async (to, text) => {
        sent.push({ to, text });
      }
    };
    const handler = new WhatsAppMessageHandler(
      new WhatsAppAuthorizer(['255712345678']),
      agent,
      sender,
      undefined,
      { replyToAll: true }
    );

    await handler.handleIncomingMessage({
      id: 'message-public',
      from: '255700000000@s.whatsapp.net',
      fromMe: false,
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: 'hello'
    });

    expect(observedNumber).toBe('255700000000');
    expect(sent).toEqual([{ to: '255700000000@s.whatsapp.net', text: 'processed hello' }]);
  });

  it('passes authorized messages to the agent and sends the response', async () => {
    const agent: AgentOrchestratorPort = {
      handleMessage: async ({ text }) => `processed ${text}`
    };
    const sent: string[] = [];
    const sender: WhatsAppSender = {
      sendText: async (_to, text) => {
        sent.push(text);
      }
    };
    const handler = new WhatsAppMessageHandler(new WhatsAppAuthorizer(['255712345678']), agent, sender);

    await handler.handleIncomingMessage({
      id: 'message-2',
      from: '255712345678@s.whatsapp.net',
      fromMe: false,
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: 'show my tasks'
    });

    expect(sent).toEqual(['processed show my tasks']);
  });

  it('authorizes messages through WhatsApp alternate phone fields', async () => {
    let observedNumber = '';
    const agent: AgentOrchestratorPort = {
      handleMessage: async ({ text, whatsappNumber }) => {
        observedNumber = whatsappNumber;
        return `processed ${text}`;
      }
    };
    const sent: Array<{ to: string; text: string }> = [];
    const sender: WhatsAppSender = {
      sendText: async (to, text) => {
        sent.push({ to, text });
      }
    };
    const handler = new WhatsAppMessageHandler(new WhatsAppAuthorizer(['255712345678']), agent, sender);

    await handler.handleIncomingMessage({
      id: 'message-lid',
      from: '240539744137431@lid',
      senderPn: '255712345678@s.whatsapp.net',
      fromMe: false,
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: 'show my tasks'
    });

    expect(observedNumber).toBe('255712345678');
    expect(sent).toEqual([
      { to: '240539744137431@lid', text: 'processed show my tasks' }
    ]);
  });

  it('archives messages without replying to non-owner chats', async () => {
    const agent: AgentOrchestratorPort = {
      handleMessage: async () => 'agent response'
    };
    const sent: string[] = [];
    const sender: WhatsAppSender = {
      sendText: async (_to, text) => {
        sent.push(text);
      }
    };
    const archived: unknown[] = [];
    const archive = {
      recordMessage: async (input: unknown) => {
        archived.push(input);
      }
    };
    const handler = new WhatsAppMessageHandler(
      new WhatsAppAuthorizer(['255712345678']),
      agent,
      sender,
      archive
    );

    await handler.handleIncomingMessage({
      id: 'message-3',
      from: '255700000000@s.whatsapp.net',
      pushName: 'Client',
      fromMe: false,
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: 'deadline is Friday'
    });

    expect(sent).toEqual([]);
    expect(archived).toHaveLength(1);
  });

  it('can process prefixed from-me commands for self-chat mode', async () => {
    let observedNumber = '';
    const agent: AgentOrchestratorPort = {
      handleMessage: async ({ text, whatsappNumber }) => {
        observedNumber = whatsappNumber;
        return `processed ${text}`;
      }
    };
    const sent: Array<{ to: string; text: string }> = [];
    const sender: WhatsAppSender = {
      sendText: async (to, text) => {
        sent.push({ to, text });
      }
    };
    const handler = new WhatsAppMessageHandler(
      new WhatsAppAuthorizer(['255712345678']),
      agent,
      sender,
      undefined,
      {
        processFromMeCommands: true,
        fromMeCommandPrefix: '/agent',
        ownerWhatsAppNumber: '255621214785'
      }
    );

    await handler.handleIncomingMessage({
      id: 'message-4',
      from: '123456789@lid',
      senderPn: '255712345678:8@s.whatsapp.net',
      fromMe: true,
      timestamp: new Date('2026-08-29T12:00:00.000Z'),
      text: '/agent summarize my recent chats'
    });

    expect(observedNumber).toBe('255712345678');
    expect(sent).toEqual([{ to: '255712345678@s.whatsapp.net', text: 'processed summarize my recent chats' }]);
  });
});
