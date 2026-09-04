import { AgentOrchestrator } from '../../../src/agent/AgentOrchestrator.js';
import { ToolRegistry } from '../../../src/agent/ToolRegistry.js';
import type { ConversationStore, LLMProvider } from '../../../src/agent/types.js';
import type { AgentTool } from '../../../src/tools/AgentTool.js';

const conversationStore: ConversationStore = {
  getOrCreateUserByWhatsApp: async () => ({ id: 'user-1', whatsappNumber: '255712345678', timezone: 'Africa/Dar_es_Salaam' }),
  getOrCreateConversation: async () => ({ id: 'conversation-1', userId: 'user-1' }),
  addMessage: async () => undefined,
  getRecentMessages: async () => [
    { role: 'assistant', content: 'What time should I schedule it?' }
  ],
  addExecution: async () => undefined
};

describe('AgentOrchestrator', () => {
  it('executes the selected tool and returns the tool message', async () => {
    const taskTool: AgentTool = {
      name: 'TaskTool',
      description: 'Manages tasks',
      inputSchema: { type: 'object' },
      execute: async (input) => ({ ok: true, message: `Created ${(input as { title: string }).title}` })
    };
    const llm: LLMProvider = {
      decide: async () => ({
        kind: 'tool',
        toolName: 'TaskTool',
        toolInput: { action: 'create', title: 'Finish backend' }
      })
    };
    const orchestrator = new AgentOrchestrator({
      llm,
      tools: new ToolRegistry([taskTool]),
      conversationStore,
      timezone: 'Africa/Dar_es_Salaam'
    });

    await expect(orchestrator.handleMessage({
      whatsappNumber: '255712345678',
      messageId: 'message-1',
      text: 'Add a task to finish the backend tomorrow'
    })).resolves.toBe('Created Finish backend');
  });

  it('uses recent conversation context for follow-up messages', async () => {
    let observedContextLength = 0;
    const llm: LLMProvider = {
      decide: async ({ recentMessages }) => {
        observedContextLength = recentMessages.length;
        return { kind: 'final', content: 'Sure. What time should I schedule it?' };
      }
    };
    const orchestrator = new AgentOrchestrator({
      llm,
      tools: new ToolRegistry([]),
      conversationStore,
      timezone: 'Africa/Dar_es_Salaam'
    });

    const response = await orchestrator.handleMessage({
      whatsappNumber: '255712345678',
      messageId: 'message-2',
      text: '3 PM'
    });

    expect(response).toBe('Sure. What time should I schedule it?');
    expect(observedContextLength).toBe(1);
  });

  it('does not expose owner-only WhatsApp tools to public users', async () => {
    const toolsSeenByLlm: string[] = [];
    const ownerTool: AgentTool = {
      name: 'WhatsAppChatArchiveTool',
      description: 'Reads owner archive',
      inputSchema: { type: 'object' },
      execute: async () => ({ ok: true, message: 'archive contents' })
    };
    const publicTool: AgentTool = {
      name: 'TaskTool',
      description: 'Manages tasks',
      inputSchema: { type: 'object' },
      execute: async () => ({ ok: true, message: 'task done' })
    };
    const llm: LLMProvider = {
      decide: async ({ tools }) => {
        toolsSeenByLlm.push(...tools.map((tool) => tool.name));
        return { kind: 'final', content: 'Nimekupata.' };
      }
    };
    const orchestrator = new AgentOrchestrator({
      llm,
      tools: new ToolRegistry([ownerTool, publicTool]),
      conversationStore,
      timezone: 'Africa/Dar_es_Salaam'
    });

    const response = await orchestrator.handleMessage({
      whatsappNumber: '255700000000',
      messageId: 'message-public',
      text: 'nisaidie',
      accessLevel: 'public'
    });

    expect(response).toBe('Nimekupata.');
    expect(toolsSeenByLlm).toEqual(['TaskTool']);
  });

  it('blocks owner-only tool execution for public users even if the LLM selects it', async () => {
    let toolExecuted = false;
    const ownerTool: AgentTool = {
      name: 'WhatsAppOutboundMessageTool',
      description: 'Sends WhatsApp messages',
      inputSchema: { type: 'object' },
      execute: async () => {
        toolExecuted = true;
        return { ok: true, message: 'sent' };
      }
    };
    const llm: LLMProvider = {
      decide: async () => ({
        kind: 'tool',
        toolName: 'WhatsAppOutboundMessageTool',
        toolInput: { action: 'send', recipient: '255711111111', message: 'hello' }
      })
    };
    const orchestrator = new AgentOrchestrator({
      llm,
      tools: new ToolRegistry([ownerTool]),
      conversationStore,
      timezone: 'Africa/Dar_es_Salaam'
    });

    const response = await orchestrator.handleMessage({
      whatsappNumber: '255700000000',
      messageId: 'message-public-tool',
      text: 'send a message',
      accessLevel: 'public'
    });

    expect(response).toBe('That WhatsApp capability is only available to the owner of this agent.');
    expect(toolExecuted).toBe(false);
  });

  it('returns a safe failure response when the LLM provider fails', async () => {
    const llm: LLMProvider = {
      decide: async () => {
        throw new Error('provider outage with secret sk-test');
      }
    };
    const orchestrator = new AgentOrchestrator({
      llm,
      tools: new ToolRegistry([]),
      conversationStore,
      timezone: 'Africa/Dar_es_Salaam'
    });

    await expect(orchestrator.handleMessage({
      whatsappNumber: '255712345678',
      messageId: 'message-3',
      text: 'What should I work on today?'
    })).resolves.toBe("I'm having trouble processing that request right now. Please try again.");
  });

  it('answers identity questions from saved memory without calling the LLM', async () => {
    let llmCalled = false;
    let observedToolInput: unknown;
    const memoryTool: AgentTool = {
      name: 'MemoryTool',
      description: 'Manages saved memory',
      inputSchema: { type: 'object' },
      execute: async (input) => {
        observedToolInput = input;
        return { ok: true, message: 'My name is Amin.' };
      }
    };
    const llm: LLMProvider = {
      decide: async () => {
        llmCalled = true;
        return { kind: 'final', content: 'wrong path' };
      }
    };
    const orchestrator = new AgentOrchestrator({
      llm,
      tools: new ToolRegistry([memoryTool]),
      conversationStore,
      timezone: 'Africa/Dar_es_Salaam'
    });

    const response = await orchestrator.handleMessage({
      whatsappNumber: '255712345678',
      messageId: 'message-identity',
      text: 'Who am I?'
    });

    expect(response).toBe('My name is Amin.');
    expect(observedToolInput).toEqual({ action: 'query', query: 'name identity profile me my' });
    expect(llmCalled).toBe(false);
  });

  it('answers agent identity questions directly without querying saved memory', async () => {
    let llmCalled = false;
    let memoryCalled = false;
    const memoryTool: AgentTool = {
      name: 'MemoryTool',
      description: 'Manages saved memory',
      inputSchema: { type: 'object' },
      execute: async () => {
        memoryCalled = true;
        return { ok: true, message: "I don't have a saved memory about that yet." };
      }
    };
    const llm: LLMProvider = {
      decide: async () => {
        llmCalled = true;
        return { kind: 'final', content: 'wrong path' };
      }
    };
    const orchestrator = new AgentOrchestrator({
      llm,
      tools: new ToolRegistry([memoryTool]),
      conversationStore,
      timezone: 'Africa/Dar_es_Salaam'
    });

    for (const text of ['Who are you?', 'whoare you']) {
      const response = await orchestrator.handleMessage({
        whatsappNumber: '255712345678',
        messageId: `message-agent-identity-${text}`,
        text
      });

      expect(response).toMatch(/Hawa/i);
    }
    expect(memoryCalled).toBe(false);
    expect(llmCalled).toBe(false);
  });

  it('stores explicit remember requests without calling the LLM', async () => {
    let observedToolInput: unknown;
    const memoryTool: AgentTool = {
      name: 'MemoryTool',
      description: 'Manages saved memory',
      inputSchema: { type: 'object' },
      execute: async (input) => {
        observedToolInput = input;
        return { ok: true, message: 'Got it. I will remember that.' };
      }
    };
    const llm: LLMProvider = {
      decide: async () => ({ kind: 'final', content: 'wrong path' })
    };
    const orchestrator = new AgentOrchestrator({
      llm,
      tools: new ToolRegistry([memoryTool]),
      conversationStore,
      timezone: 'Africa/Dar_es_Salaam'
    });

    const response = await orchestrator.handleMessage({
      whatsappNumber: '255712345678',
      messageId: 'message-remember',
      text: 'remember that my name is Amin'
    });

    expect(response).toBe('Got it. I will remember that.');
    expect(observedToolInput).toEqual({ action: 'remember', content: 'my name is Amin' });
  });

  it('sends clear outbound WhatsApp message commands by contact name without calling the LLM', async () => {
    let observedToolInput: unknown;
    const outboundTool: AgentTool = {
      name: 'WhatsAppOutboundMessageTool',
      description: 'Sends WhatsApp messages',
      inputSchema: { type: 'object' },
      execute: async (input) => {
        observedToolInput = input;
        return { ok: true, message: 'Sent WhatsApp message to Amina Client.' };
      }
    };
    const llm: LLMProvider = {
      decide: async () => ({ kind: 'final', content: 'wrong path' })
    };
    const orchestrator = new AgentOrchestrator({
      llm,
      tools: new ToolRegistry([outboundTool]),
      conversationStore,
      timezone: 'Africa/Dar_es_Salaam'
    });

    const response = await orchestrator.handleMessage({
      whatsappNumber: '255712345678',
      messageId: 'message-send',
      text: 'send a message to Amina Client saying Good night'
    });

    expect(response).toBe('Sent WhatsApp message to Amina Client.');
    expect(observedToolInput).toEqual({
      action: 'send',
      recipient: 'Amina Client',
      message: 'Good night'
    });
  });

  it('does not let public users use deterministic owner-only outbound shortcuts', async () => {
    let toolExecuted = false;
    const outboundTool: AgentTool = {
      name: 'WhatsAppOutboundMessageTool',
      description: 'Sends WhatsApp messages',
      inputSchema: { type: 'object' },
      execute: async () => {
        toolExecuted = true;
        return { ok: true, message: 'sent' };
      }
    };
    const orchestrator = new AgentOrchestrator({
      llm: { decide: async () => ({ kind: 'final', content: 'wrong path' }) },
      tools: new ToolRegistry([outboundTool]),
      conversationStore,
      timezone: 'Africa/Dar_es_Salaam'
    });

    const response = await orchestrator.handleMessage({
      whatsappNumber: '255700000000',
      messageId: 'message-public-send',
      text: 'send a message to Amina saying hi',
      accessLevel: 'public'
    });

    expect(response).toBe('That WhatsApp capability is only available to the owner of this agent.');
    expect(toolExecuted).toBe(false);
  });
});
