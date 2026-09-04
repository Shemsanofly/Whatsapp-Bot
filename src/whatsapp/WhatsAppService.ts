import { WhatsAppConnectionManager } from './WhatsAppConnectionManager.js';
import { WhatsAppMessageHandler } from './WhatsAppMessageHandler.js';
import type { WhatsAppHealth, WhatsAppSender } from './types.js';

export class WhatsAppService implements WhatsAppSender {
  constructor(
    private readonly connectionManager: WhatsAppConnectionManager,
    private readonly messageHandler: WhatsAppMessageHandler
  ) {
    this.connectionManager.onMessage((message) => this.messageHandler.handleIncomingMessage(message));
  }

  start(): Promise<void> {
    return this.connectionManager.connect();
  }

  sendText(to: string, text: string): Promise<void> {
    return this.connectionManager.sendText(to, text);
  }

  getHealth(): WhatsAppHealth {
    return this.connectionManager.getHealth();
  }

  shutdown(): Promise<void> {
    return this.connectionManager.shutdown();
  }
}
