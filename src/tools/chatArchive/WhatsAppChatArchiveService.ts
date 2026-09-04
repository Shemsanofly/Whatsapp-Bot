import type {
  ArchivedWhatsAppChat,
  ArchivedWhatsAppMessage,
  RecordWhatsAppContactInput,
  RecordWhatsAppMessageInput,
  WhatsAppChatArchiveRepository
} from './types.js';

export class WhatsAppChatArchiveService {
  constructor(private readonly repository: WhatsAppChatArchiveRepository) {}

  recordMessage(input: RecordWhatsAppMessageInput): Promise<void> {
    return this.repository.recordMessage(input);
  }

  recordContact(input: RecordWhatsAppContactInput): Promise<void> {
    return this.repository.recordContact(input);
  }

  listRecentChats(limit: number): Promise<ArchivedWhatsAppChat[]> {
    return this.repository.listRecentChats(Math.min(Math.max(limit, 1), 25));
  }

  findChats(query: string, limit = 10): Promise<ArchivedWhatsAppChat[]> {
    return this.repository.findChats(query, Math.min(Math.max(limit, 1), 25));
  }

  findMessages(input: {
    query?: string;
    since?: Date;
    limit?: number;
  }): Promise<ArchivedWhatsAppMessage[]> {
    return this.repository.findMessages({
      query: input.query,
      since: input.since,
      limit: Math.min(Math.max(input.limit ?? 80, 1), 200)
    });
  }
}
