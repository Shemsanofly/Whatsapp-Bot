import express from 'express';
import type { WhatsAppHealth } from './whatsapp/types.js';
import type { GatewayChannelStatus, GatewayHealth } from './gateway/types.js';
import type { ToolDefinition } from './agent/types.js';

export function createApp(deps: {
  whatsappHealth: () => WhatsAppHealth;
  gatewayHealth?: () => GatewayHealth;
  listChannels?: () => GatewayChannelStatus[];
  listTools?: () => Array<ToolDefinition & { enabled: boolean }>;
}) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_request, response) => {
    response.json({
      status: 'healthy',
      ...(deps.gatewayHealth ? { gateway: deps.gatewayHealth() } : {}),
      whatsapp: deps.whatsappHealth()
    });
  });

  app.get('/health/whatsapp', (_request, response) => {
    response.json(deps.whatsappHealth());
  });

  app.get('/health/channels', (_request, response) => {
    response.json(deps.listChannels?.() ?? []);
  });

  app.get('/channels', (_request, response) => {
    response.json(deps.listChannels?.() ?? []);
  });

  app.get('/tools', (_request, response) => {
    response.json(deps.listTools?.() ?? []);
  });

  return app;
}
