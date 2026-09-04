import type { PrismaClient } from '@prisma/client';
import type { AgentConversation, AgentUser, ChatRole, ConversationStore, RecentMessage } from '../agent/types.js';

export class PrismaConversationStore implements ConversationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrCreateUserByWhatsApp(whatsappNumber: string, timezone: string): Promise<AgentUser> {
    const user = await this.prisma.user.upsert({
      where: { whatsappNumber },
      update: { timezone },
      create: { whatsappNumber, timezone }
    });
    return { id: user.id, whatsappNumber: user.whatsappNumber, timezone: user.timezone };
  }

  async getOrCreateConversation(userId: string): Promise<AgentConversation> {
    const existing = await this.prisma.conversation.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' }
    });
    if (existing) {
      return { id: existing.id, userId: existing.userId };
    }
    const conversation = await this.prisma.conversation.create({ data: { userId } });
    return { id: conversation.id, userId: conversation.userId };
  }

  async addMessage(input: {
    externalId?: string;
    userId: string;
    conversationId: string;
    role: ChatRole;
    content: string;
  }): Promise<void> {
    await this.prisma.message.create({
      data: {
        externalId: input.externalId,
        userId: input.userId,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content
      }
    });
  }

  async getRecentMessages(conversationId: string, limit: number): Promise<RecentMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    return messages.reverse().map((message) => ({
      role: message.role as ChatRole,
      content: message.content
    }));
  }

  async addExecution(input: {
    messageId?: string;
    userId: string;
    input: string;
    selectedTool?: string;
    toolInput?: unknown;
    executionStatus: 'success' | 'failed';
    error?: string;
    durationMs: number;
  }): Promise<void> {
    await this.prisma.agentExecution.create({
      data: {
        messageId: input.messageId,
        userId: input.userId,
        input: input.input,
        selectedTool: input.selectedTool,
        toolInputJson: input.toolInput === undefined ? undefined : JSON.stringify(input.toolInput),
        executionStatus: input.executionStatus,
        error: input.error,
        durationMs: input.durationMs
      }
    });
  }
}
