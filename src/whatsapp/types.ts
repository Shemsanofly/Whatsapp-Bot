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
  mentionedJids?: string[];
  quotedParticipant?: string;
  /** Old message delivered on (re)connect: archive it, but do not reply. */
  isBacklog?: boolean;
  /** Present for voice notes and audio files; text is empty until transcribed. */
  audio?: IncomingWhatsAppAudio;
  isVoiceNote?: boolean;
}

export interface IncomingWhatsAppAudio {
  mimeType: string;
  seconds?: number;
  /** Downloads and decrypts the audio. Only call it when the message will be answered. */
  download(): Promise<Buffer>;
}

export interface WhatsAppSendOptions {
  quoted?: IncomingWhatsAppMessage;
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
  sendText(to: string, text: string, options?: WhatsAppSendOptions): Promise<void>;
}

export interface AgentOrchestratorPort {
  handleMessage(input: {
    whatsappNumber: string;
    messageId?: string;
    text: string;
    accessLevel?: 'owner' | 'public';
    senderName?: string;
    isGroup?: boolean;
    isVoiceNote?: boolean;
  }): Promise<string>;
}
