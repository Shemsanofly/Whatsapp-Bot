import type { ToolExecutionContext } from '../tools/AgentTool.js';

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface RecentMessage {
  role: ChatRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface AgentUser {
  id: string;
  whatsappNumber: string;
  timezone: string;
}

export interface AgentConversation {
  id: string;
  userId: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
}

export type LLMDecision =
  | { kind: 'final'; content: string }
  | { kind: 'tool'; toolName: string; toolInput: unknown };

export interface LLMProvider {
  decide(input: {
    text: string;
    user: AgentUser;
    timezone: string;
    recentMessages: RecentMessage[];
    tools: ToolDefinition[];
  }): Promise<LLMDecision>;
  summarize?(text: string, mode?: string): Promise<string>;
}

export interface ConversationStore {
  getOrCreateUserByWhatsApp(whatsappNumber: string, timezone: string): Promise<AgentUser>;
  getOrCreateConversation(userId: string): Promise<AgentConversation>;
  addMessage(input: {
    externalId?: string;
    userId: string;
    conversationId: string;
    role: ChatRole;
    content: string;
  }): Promise<void>;
  getRecentMessages(conversationId: string, limit: number): Promise<RecentMessage[]>;
  addExecution(input: {
    messageId?: string;
    userId: string;
    input: string;
    selectedTool?: string;
    toolInput?: unknown;
    executionStatus: 'success' | 'failed';
    error?: string;
    durationMs: number;
  }): Promise<void>;
}

export interface OrchestratorMessage {
  whatsappNumber: string;
  messageId?: string;
  text: string;
  accessLevel?: 'owner' | 'public';
}

export type AgentContext = ToolExecutionContext;
