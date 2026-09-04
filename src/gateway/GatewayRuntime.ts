import type { ChannelAdapter, ChannelMessage, GatewayAgentPort, GatewayChannelStatus, GatewayHealth } from './types.js';
import { logger } from '../utils/logger.js';

export class GatewayRuntime {
  private static readonly processedMessageTtlMs = 5 * 60 * 1000;
  private readonly channels = new Map<string, ChannelAdapter>();
  private readonly startedChannels = new Set<string>();
  private readonly messageQueues = new Map<string, Promise<void>>();
  private readonly processedMessageIds = new Map<string, number>();

  constructor(private readonly deps: {
    channels: ChannelAdapter[];
    agent: GatewayAgentPort;
  }) {
    for (const channel of deps.channels) {
      this.channels.set(channel.id, channel);
      channel.onMessage((message) => this.handleChannelMessage(channel, message));
    }
  }

  async start(): Promise<void> {
    for (const channel of this.channels.values()) {
      if (!channel.enabled) {
        continue;
      }
      await channel.start();
      this.startedChannels.add(channel.id);
    }
  }

  async stop(): Promise<void> {
    for (const channel of this.channels.values()) {
      if (!this.startedChannels.has(channel.id)) {
        continue;
      }
      await channel.stop();
      this.startedChannels.delete(channel.id);
    }
  }

  listChannels(): GatewayChannelStatus[] {
    return [...this.channels.values()].map((channel) => ({
      id: channel.id,
      name: channel.name,
      enabled: channel.enabled,
      health: channel.getHealth()
    }));
  }

  getHealth(): GatewayHealth {
    const channels = this.listChannels();
    const enabledChannels = channels.filter((channel) => channel.enabled);
    const status = enabledChannels.every((channel) => channel.health.connected && channel.health.authenticated)
      ? 'healthy'
      : 'degraded';

    return { status, channels };
  }

  private handleChannelMessage(channel: ChannelAdapter, message: ChannelMessage): Promise<void> {
    if (this.hasAlreadyProcessedMessage(channel, message)) {
      logger.info({ channel: channel.id, messageId: message.messageId }, 'Ignoring duplicate channel message');
      return Promise.resolve();
    }

    const queueKey = `${channel.id}:${message.conversationId}`;
    const previous = this.messageQueues.get(queueKey) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(() => this.processChannelMessage(channel, message));

    this.messageQueues.set(queueKey, queued);
    void queued.finally(() => {
      if (this.messageQueues.get(queueKey) === queued) {
        this.messageQueues.delete(queueKey);
      }
    });
    return queued;
  }

  private hasAlreadyProcessedMessage(channel: ChannelAdapter, message: ChannelMessage): boolean {
    if (!message.messageId) {
      return false;
    }

    this.deleteExpiredProcessedMessageIds();
    const key = `${channel.id}:${message.messageId}`;
    if (this.processedMessageIds.has(key)) {
      return true;
    }

    this.processedMessageIds.set(key, Date.now());
    return false;
  }

  private deleteExpiredProcessedMessageIds(): void {
    const expiresBefore = Date.now() - GatewayRuntime.processedMessageTtlMs;
    for (const [key, processedAt] of this.processedMessageIds) {
      if (processedAt < expiresBefore) {
        this.processedMessageIds.delete(key);
      }
    }
  }

  private async processChannelMessage(channel: ChannelAdapter, message: ChannelMessage): Promise<void> {
    try {
      const response = await this.deps.agent.handleMessage(message);
      await channel.sendText(message.conversationId, response);
    } catch (error) {
      logger.error({ error, channel: channel.id }, 'Gateway channel message handling failed');
      await channel.sendText(message.conversationId, "I'm having trouble processing that request right now. Please try again.");
    }
  }
}
