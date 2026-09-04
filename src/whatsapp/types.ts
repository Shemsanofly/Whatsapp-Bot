export interface IncomingWhatsAppMessage {
  id: string;
  from: string;
  participant?: string;
  senderPn?: string;
  participantPn?: string;
  pushName?: string;
  fromMe: boolean;
  timestamp: Date;
  text: string;
}

export interface IncomingWhatsAppContact {
  remoteJid: string;
  displayName?: string;
}

export interface WhatsAppHealth {
  connected: boolean;
  authenticated: boolean;
}

export interface WhatsAppSender {
  sendText(to: string, text: string): Promise<void>;
}

export interface AgentOrchestratorPort {
  handleMessage(input: {
    whatsappNumber: string;
    messageId?: string;
    text: string;
    accessLevel?: 'owner' | 'public';
  }): Promise<string>;
}
