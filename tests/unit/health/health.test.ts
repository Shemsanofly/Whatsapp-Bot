import request from 'supertest';
import { createApp } from '../../../src/app.js';

describe('health routes', () => {
  const channels = [
    {
      id: 'whatsapp',
      name: 'WhatsApp',
      enabled: true,
      health: { connected: true, authenticated: true }
    }
  ];
  const tools = [
    {
      name: 'TaskTool',
      description: 'Manages tasks',
      inputSchema: { type: 'object' },
      enabled: true
    }
  ];

  it('reports application, gateway, and WhatsApp health', async () => {
    const app = createApp({
      whatsappHealth: () => ({ connected: true, authenticated: true }),
      gatewayHealth: () => ({ status: 'healthy', channels }),
      listChannels: () => channels,
      listTools: () => tools
    });

    await request(app)
      .get('/health')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          status: 'healthy',
          gateway: {
            status: 'healthy',
            channels
          },
          whatsapp: {
            connected: true,
            authenticated: true
          }
        });
      });

    await request(app)
      .get('/health/whatsapp')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          connected: true,
          authenticated: true
        });
      });
  });

  it('lists channel health and runtime metadata', async () => {
    const app = createApp({
      whatsappHealth: () => ({ connected: true, authenticated: true }),
      gatewayHealth: () => ({ status: 'healthy', channels }),
      listChannels: () => channels,
      listTools: () => tools
    });

    await request(app)
      .get('/health/channels')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(channels);
      });

    await request(app)
      .get('/channels')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(channels);
      });

    await request(app)
      .get('/tools')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(tools);
      });
  });
});
