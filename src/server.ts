import { createServer } from 'node:http';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { PrismaConversationStore } from './db/PrismaConversationStore.js';
import { createApp } from './app.js';
import { ToolRegistry } from './agent/ToolRegistry.js';
import { AgentOrchestrator } from './agent/AgentOrchestrator.js';
import { OpenAIProvider } from './llm/OpenAIProvider.js';
import { GeminiProvider } from './llm/GeminiProvider.js';
import { WhatsAppAuthorizer } from './security/WhatsAppAuthorizer.js';
import { TaskService } from './tools/tasks/TaskService.js';
import { TaskTool } from './tools/tasks/TaskTool.js';
import { PrismaTaskRepository } from './tools/tasks/PrismaTaskRepository.js';
import { ReminderService } from './tools/reminders/ReminderService.js';
import { ReminderTool } from './tools/reminders/ReminderTool.js';
import { PrismaReminderRepository } from './tools/reminders/PrismaReminderRepository.js';
import { CalendarService } from './tools/calendar/CalendarService.js';
import { CalendarTool } from './tools/calendar/CalendarTool.js';
import { PrismaLocalCalendarProvider } from './tools/calendar/PrismaLocalCalendarProvider.js';
import { GoogleCalendarProvider } from './tools/calendar/GoogleCalendarProvider.js';
import { SummarizationTool } from './tools/summarization/SummarizationTool.js';
import { MemoryService } from './tools/memory/MemoryService.js';
import { MemoryTool } from './tools/memory/MemoryTool.js';
import { PrismaMemoryRepository } from './tools/memory/PrismaMemoryRepository.js';
import { PrismaReminderRecipientResolver } from './services/scheduler/PrismaReminderRecipientResolver.js';
import { WhatsAppChatArchiveService } from './tools/chatArchive/WhatsAppChatArchiveService.js';
import { PrismaWhatsAppChatArchiveRepository } from './tools/chatArchive/PrismaWhatsAppChatArchiveRepository.js';
import { WhatsAppChatArchiveTool } from './tools/chatArchive/WhatsAppChatArchiveTool.js';
import { WhatsAppOutboundMessageTool } from './tools/whatsapp/WhatsAppOutboundMessageTool.js';
import { GatewayRuntime } from './gateway/GatewayRuntime.js';
import { WhatsAppChannelAdapter } from './gateway/WhatsAppChannelAdapter.js';
import type { ChannelMessage, GatewayHealth } from './gateway/types.js';
import { logger } from './utils/logger.js';
import type { WhatsAppHealth } from './whatsapp/types.js';

const llm = env.AI_PROVIDER.toLowerCase() === 'gemini'
  ? new GeminiProvider({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    fallbackModels: env.geminiFallbackModels
  })
  : new OpenAIProvider({
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL
  });

const taskService = new TaskService(new PrismaTaskRepository(prisma));
const reminderService = new ReminderService(new PrismaReminderRepository(prisma));
const calendarProvider = env.GOOGLE_CALENDAR_CREDENTIALS
  ? new GoogleCalendarProvider({
    credentialsJson: env.GOOGLE_CALENDAR_CREDENTIALS,
    calendarId: env.GOOGLE_CALENDAR_ID
  })
  : new PrismaLocalCalendarProvider(prisma);
const calendarService = new CalendarService(calendarProvider);
const memoryService = new MemoryService(new PrismaMemoryRepository(prisma));
const chatArchiveService = new WhatsAppChatArchiveService(new PrismaWhatsAppChatArchiveRepository(prisma));

const tools = new ToolRegistry([
  new TaskTool(taskService),
  new ReminderTool(reminderService),
  new CalendarTool(calendarService),
  new SummarizationTool(llm),
  new MemoryTool(memoryService),
  new WhatsAppChatArchiveTool(chatArchiveService, llm)
]);

const orchestrator = new AgentOrchestrator({
  llm,
  tools,
  conversationStore: new PrismaConversationStore(prisma),
  timezone: env.TIMEZONE
});

let whatsappHealth: WhatsAppHealth = { connected: false, authenticated: false };
let gateway: GatewayRuntime | undefined;
let shutdownGateway: (() => Promise<void>) | undefined;
let stopScheduler: (() => void) | undefined;

const app = createApp({
  whatsappHealth: () => whatsappHealth,
  gatewayHealth: () => gateway?.getHealth() ?? emptyGatewayHealth(),
  listChannels: () => gateway?.listChannels() ?? [],
  listTools: () => tools.listCapabilities()
});
const server = createServer(app);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Hawa WhatsApp bot API listening');
});

startGatewayRuntime().catch((error) => {
  logger.error({ error }, 'Failed to start gateway runtime');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shutdown(signal).catch((error) => {
      logger.error({ error }, 'Graceful shutdown failed');
      process.exit(1);
    });
  });
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  stopScheduler?.();
  await shutdownGateway?.();
  await prisma.$disconnect();
  server.close(() => process.exit(0));
}

async function startGatewayRuntime(): Promise<void> {
  const [
    { WhatsAppConnectionManager },
    { ReminderScheduler }
  ] = await Promise.all([
    import('./whatsapp/WhatsAppConnectionManager.js'),
    import('./services/scheduler/ReminderScheduler.js')
  ]);

  const connectionManager = new WhatsAppConnectionManager(env.WHATSAPP_AUTH_DIR);
  tools.register(new WhatsAppOutboundMessageTool(connectionManager, chatArchiveService));
  const whatsappChannel = new WhatsAppChannelAdapter({
    connection: connectionManager,
    authorizer: new WhatsAppAuthorizer(env.allowedWhatsAppNumbers),
    archive: chatArchiveService,
    options: {
      replyToAll: env.WHATSAPP_REPLY_TO_ALL,
      processFromMeCommands: env.WHATSAPP_PROCESS_FROM_ME_COMMANDS,
      fromMeCommandPrefix: env.WHATSAPP_FROM_ME_COMMAND_PREFIX,
      ownerWhatsAppNumber: env.allowedWhatsAppNumbers[0] ?? env.AGENT_WHATSAPP_NUMBER
    }
  });
  const scheduler = new ReminderScheduler({
    reminders: reminderService,
    sender: connectionManager,
    recipients: new PrismaReminderRecipientResolver(prisma)
  });
  gateway = new GatewayRuntime({
    channels: [whatsappChannel],
    agent: {
      handleMessage: (message: ChannelMessage) => orchestrator.handleMessage({
        whatsappNumber: message.senderId,
        messageId: message.messageId,
        text: message.text,
        accessLevel: message.accessLevel
      })
    }
  });

  whatsappHealth = whatsappChannel.getHealth();
  const healthInterval = setInterval(() => {
    whatsappHealth = whatsappChannel.getHealth();
  }, 5000);
  shutdownGateway = async () => {
    clearInterval(healthInterval);
    await gateway?.stop();
  };
  stopScheduler = () => scheduler.stop();

  await gateway.start();
  scheduler.start();
}

function emptyGatewayHealth(): GatewayHealth {
  return {
    status: 'degraded',
    channels: []
  };
}
