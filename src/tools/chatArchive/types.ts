export interface ArchivedWhatsAppMessage {
  id: string;
  externalId?: string | null;
  remoteJid: string;
  participantJid?: string | null;
  fromMe: boolean;
  text: string;
  messageAt: Date;
}

export interface ArchivedWhatsAppChat {
  id: string;
  remoteJid: string;
  displayName?: string | null;
  isGroup: boolean;
  lastMessageAt?: Date | null;
}

export interface RecordWhatsAppMessageInput {
  externalId?: string;
  remoteJid: string;
  participantJid?: string;
  displayName?: string;
  fromMe: boolean;
  text: string;
  messageAt: Date;
}

export interface RecordWhatsAppContactInput {
  remoteJid: string;
  displayName?: string;
}

export interface WhatsAppChatArchiveRepository {
  recordMessage(input: RecordWhatsAppMessageInput): Promise<void>;
  recordContact(input: RecordWhatsAppContactInput): Promise<void>;
  listRecentChats(limit: number): Promise<ArchivedWhatsAppChat[]>;
  findMessages(input: {
    query?: string;
    since?: Date;
    limit: number;
  }): Promise<ArchivedWhatsAppMessage[]>;
  findChats(query: string, limit: number): Promise<ArchivedWhatsAppChat[]>;
}
