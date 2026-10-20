export interface ChannelHealth {
  connected: boolean;
  authenticated: boolean;
}

export interface ChannelMessage {
  channel: string;
  messageId?: string;
  conversationId: string;
  senderId: string;
  senderDisplayName?: string;
  accessLevel?: 'owner' | 'public';
  fromSelf: boolean;
  isGroup?: boolean;
  /** The text is an automatic transcript of a voice note or audio message. */
  isVoiceNote?: boolean;
  text: string;
  timestamp: Date;
  raw?: unknown;
}

export type ChannelMessageHandler = (message: ChannelMessage) => Promise<void>;

export interface ChannelAdapter {
  id: string;
  name: string;
  enabled: boolean;
  onMessage(handler: ChannelMessageHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendText(target: string, text: string): Promise<void>;
  /** Reply to a specific inbound message (e.g. quoting it in a group). Falls back to sendText. */
  sendReply?(message: ChannelMessage, text: string): Promise<void>;
  /** Signal that the agent is working on a reply (read receipt, typing indicator). */
  setTyping?(message: ChannelMessage, typing: boolean): Promise<void>;
  getHealth(): ChannelHealth;
}

export interface GatewayAgentPort {
  handleMessage(message: ChannelMessage): Promise<string>;
}

export interface GatewayChannelStatus {
  id: string;
  name: string;
  enabled: boolean;
  health: ChannelHealth;
}

export interface GatewayHealth {
  status: 'healthy' | 'degraded';
  channels: GatewayChannelStatus[];
}
