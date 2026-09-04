import type { ConversationStore, LLMProvider, OrchestratorMessage } from './types.js';
import { ToolRegistry } from './ToolRegistry.js';

const SAFE_LLM_FAILURE = "I'm having trouble processing that request right now. Please try again.";
const SAFE_TOOL_FAILURE = "I couldn't complete that request right now. Please try again.";
const OWNER_ONLY_TOOL_NAMES = new Set([
  'WhatsAppChatArchiveTool',
  'WhatsAppOutboundMessageTool'
]);
const OWNER_ONLY_TOOL_RESPONSE = 'That WhatsApp capability is only available to the owner of this agent.';

export class AgentOrchestrator {
  constructor(private readonly deps: {
    llm: LLMProvider;
    tools: ToolRegistry;
    conversationStore: ConversationStore;
    timezone: string;
  }) {}

  async handleMessage(message: OrchestratorMessage): Promise<string> {
    const startedAt = Date.now();
    const accessLevel = message.accessLevel ?? 'owner';
    const user = await this.deps.conversationStore.getOrCreateUserByWhatsApp(message.whatsappNumber, this.deps.timezone);
    const conversation = await this.deps.conversationStore.getOrCreateConversation(user.id);
    const recentMessages = await this.deps.conversationStore.getRecentMessages(conversation.id, 12);

    await this.deps.conversationStore.addMessage({
      externalId: message.messageId,
      userId: user.id,
      conversationId: conversation.id,
      role: 'user',
      content: message.text
    });

    let selectedTool: string | undefined;
    let toolInput: unknown;

    try {
      let response: string;
      const directIntent = parseDirectIntent(message.text);
      if (directIntent?.kind === 'final') {
        response = directIntent.content;
      } else if (directIntent?.kind === 'tool') {
        selectedTool = directIntent.toolName;
        toolInput = directIntent.toolInput;
        response = await this.executeToolIntent(directIntent.toolName, directIntent.toolInput, accessLevel, user.id, user.timezone);
      } else {
        const decision = await this.deps.llm.decide({
          text: message.text,
          user,
          timezone: user.timezone,
          recentMessages,
          tools: this.getToolsForAccessLevel(accessLevel)
        });

        if (decision.kind === 'final') {
          response = decision.content;
        } else {
          selectedTool = decision.toolName;
          toolInput = decision.toolInput;
          response = await this.executeToolIntent(decision.toolName, decision.toolInput, accessLevel, user.id, user.timezone);
        }
      }

      await this.deps.conversationStore.addMessage({
        userId: user.id,
        conversationId: conversation.id,
        role: 'assistant',
        content: response
      });
      await this.deps.conversationStore.addExecution({
        messageId: message.messageId,
        userId: user.id,
        input: message.text,
        selectedTool,
        toolInput,
        executionStatus: 'success',
        durationMs: Date.now() - startedAt
      });
      return response;
    } catch (error) {
      const response = selectedTool ? SAFE_TOOL_FAILURE : SAFE_LLM_FAILURE;
      await this.deps.conversationStore.addExecution({
        messageId: message.messageId,
        userId: user.id,
        input: message.text,
        selectedTool,
        toolInput,
        executionStatus: 'failed',
        error: sanitizeError(error),
        durationMs: Date.now() - startedAt
      });
      await this.deps.conversationStore.addMessage({
        userId: user.id,
        conversationId: conversation.id,
        role: 'assistant',
        content: response
      });
      return response;
    }
  }

  private getToolsForAccessLevel(accessLevel: 'owner' | 'public'): ReturnType<ToolRegistry['listForLLM']> {
    const tools = this.deps.tools.listForLLM();
    if (accessLevel === 'owner') {
      return tools;
    }

    return tools.filter((tool) => !OWNER_ONLY_TOOL_NAMES.has(tool.name));
  }

  private canUseTool(toolName: string, accessLevel: 'owner' | 'public'): boolean {
    return accessLevel === 'owner' || !OWNER_ONLY_TOOL_NAMES.has(toolName);
  }

  private async executeToolIntent(
    toolName: string,
    input: unknown,
    accessLevel: 'owner' | 'public',
    userId: string,
    timezone: string
  ): Promise<string> {
    const tool = this.canUseTool(toolName, accessLevel)
      ? this.deps.tools.get(toolName)
      : undefined;
    if (!this.canUseTool(toolName, accessLevel)) {
      return OWNER_ONLY_TOOL_RESPONSE;
    }
    if (!tool) {
      return `I don't have access to ${toolName} yet.`;
    }
    const result = await tool.execute(input, { userId, timezone });
    return result.message;
  }
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500);
}

type DirectIntent =
  | { kind: 'final'; content: string }
  | { kind: 'tool'; toolName: string; toolInput: unknown };

function parseDirectIntent(text: string): DirectIntent | undefined {
  const trimmed = text.trim();
  const normalized = trimmed.toLowerCase().replace(/[?!.,]+$/g, '').replace(/\s+/g, ' ');

  const remember = trimmed.match(/^(?:please\s+)?remember\s+(?:that\s+)?(.+)$/i);
  if (remember?.[1]?.trim()) {
    return {
      kind: 'tool',
      toolName: 'MemoryTool',
      toolInput: {
        action: 'remember',
        content: remember[1].trim()
      }
    };
  }

  if (isSelfIdentityQuestion(normalized)) {
    return {
      kind: 'tool',
      toolName: 'MemoryTool',
      toolInput: {
        action: 'query',
        query: 'name identity profile me my'
      }
    };
  }

  if (isAgentIdentityQuestion(normalized)) {
    return {
      kind: 'final',
      content: "I'm Hawa, your WhatsApp AI agent. I can answer questions, help with planning, and assist with tasks over WhatsApp."
    };
  }

  const personQuery = parsePersonIdentityQuery(trimmed);
  if (personQuery) {
    return {
      kind: 'tool',
      toolName: 'MemoryTool',
      toolInput: {
        action: 'query',
        query: personQuery
      }
    };
  }

  const outbound = parseOutboundMessage(trimmed);
  if (outbound) {
    return {
      kind: 'tool',
      toolName: 'WhatsAppOutboundMessageTool',
      toolInput: {
        action: 'send',
        recipient: outbound.recipient,
        message: outbound.message
      }
    };
  }

  const call = trimmed.match(/^(?:please\s+)?(?:call|phone|voice call)\s+(.+)$/i);
  if (call?.[1]?.trim()) {
    return {
      kind: 'final',
      content: `I can't start WhatsApp voice calls yet. I can send ${call[1].trim()} a WhatsApp message asking them to call you.`
    };
  }

  return undefined;
}

function isSelfIdentityQuestion(normalized: string): boolean {
  return [
    'who am i',
    'what is my name',
    'do you know me',
    'do you know who i am',
    'mimi ni nani',
    'naitwa nani',
    'jina langu ni nani'
  ].includes(normalized);
}

function isAgentIdentityQuestion(normalized: string): boolean {
  return [
    'who are you',
    'whoare you',
    'who r u',
    'what are you',
    'what is your name',
    'whats your name',
    "what's your name",
    'unaitwa nani',
    'wewe ni nani'
  ].includes(normalized);
}

function parsePersonIdentityQuery(text: string): string | undefined {
  const patterns = [
    /^(?:who is|who's|who are|tell me about)\s+(.+?)[?!.]*$/i,
    /^(?:unamjua|unamfahamu|unajua)\s+(.+?)[?!.]*$/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const query = match?.[1]?.trim();
    if (query) {
      return query;
    }
  }
  return undefined;
}

function parseOutboundMessage(text: string): { recipient: string; message: string } | undefined {
  const patterns = [
    /^(?:please\s+)?(?:send|text|message)\s+(?:a\s+)?(?:whatsapp\s+)?(?:message\s+)?to\s+(.+?)\s*(?:and\s+)?(?:tell|give)\s+(?:him|her|them)\s+(?:that\s+)?(.+)$/i,
    /^(?:please\s+)?(?:send|text|message)\s+(?:a\s+)?(?:whatsapp\s+)?(?:message\s+)?to\s+(.+?)\s+(?:saying|that says|with message)\s+(.+)$/i,
    /^(?:please\s+)?(?:message|text)\s+(.+?)\s+(?:saying|that says|:)\s*(.+)$/i,
    /^(?:please\s+)?tell\s+(.+?)\s+(?:that\s+)?(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const recipient = match?.[1]?.trim();
    const message = match?.[2]?.trim();
    if (recipient && message) {
      return {
        recipient,
        message: stripWrappingQuotes(message)
      };
    }
  }
  return undefined;
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^["'\u201C\u201D\u2018\u2019]|["'\u201C\u201D\u2018\u2019]$/g, '').trim();
}
