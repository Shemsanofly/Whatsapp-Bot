# OpenClaw-Style Personal AI Agent over WhatsApp

This is a TypeScript backend for a personal AI operating layer controlled through WhatsApp. The runtime now follows an OpenClaw-style Gateway architecture: channels connect to a local Gateway, the Gateway routes messages to the agent, and tools are exposed as capabilities.

This is not a full fork of upstream `openclaw/openclaw`. It keeps this project's smaller, easier-to-manage codebase while adopting the same practical shape: gateway, channels, tools, memory, and always-on messaging.

## Architecture

- Gateway runtime lives in `src/gateway`.
- WhatsApp is a channel adapter, not the whole application.
- WhatsApp low-level Baileys communication remains isolated in `src/whatsapp`.
- AI orchestration lives in `src/agent`.
- Tools implement the generic `AgentTool` interface in `src/tools`.
- Persistence uses Prisma models for users, conversations, messages, tasks, reminders, calendar events, memories, and agent executions.
- Reminder delivery runs through `ReminderScheduler`, independent of active WhatsApp chats.

The Gateway does not contain business logic. It starts channels, receives channel messages, forwards text to the agent, and sends responses back through the originating channel.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `AGENT_WHATSAPP_NUMBER` to the WhatsApp number that will act as the agent.
3. Set `ALLOWED_WHATSAPP_NUMBERS` to comma-separated owner phone numbers with country codes.
4. Set `AI_API_KEY`.
5. Run:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Scan the QR code printed in the terminal to authenticate WhatsApp. The QR code must be scanned by the WhatsApp account that should act as the public agent number.

## AI Provider

OpenAI is the default provider:

```env
AI_PROVIDER=openai
AI_API_KEY=...
AI_MODEL=gpt-4o-mini
```

To use Gemini instead:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.7-flash
```

## Calendar Provider

By default, the MVP stores calendar events locally in the database. To use Google Calendar, set:

```env
GOOGLE_CALENDAR_CREDENTIALS={"type":"service_account",...}
GOOGLE_CALENDAR_ID=primary
```

The assistant only reports Google Calendar success after the Google API returns an event id. If Google Calendar fails, the request fails gracefully.

## Health

```http
GET /health
GET /health/channels
GET /health/whatsapp
GET /channels
GET /tools
```

Example:

```json
{
  "status": "healthy",
  "gateway": {
    "status": "healthy",
    "channels": [
      {
        "id": "whatsapp",
        "name": "WhatsApp",
        "enabled": true,
        "health": {
          "connected": true,
          "authenticated": true
        }
      }
    ]
  },
  "whatsapp": {
    "connected": true,
    "authenticated": true
  }
}
```

`/tools` returns registered callable capabilities with their names, descriptions, schemas, and enabled status. `/health/whatsapp` remains for backward compatibility.

## MVP Tools

- `TaskTool`
- `ReminderTool`
- `CalendarTool`
- `SummarizationTool`
- `MemoryTool`
- `WhatsAppChatArchiveTool`
- `WhatsAppOutboundMessageTool`

Outbound WhatsApp message example:

```text
/agent send WhatsApp message to 255712345678 saying "Hello, I will call you later."
/agent send a message to Mohammed saying "Good night."
```

Outbound sending is limited to direct contacts by phone number, direct WhatsApp JID, `@lid` JID, or exact archived contact/display name. If a contact name matches multiple chats, the assistant refuses to send and asks for the exact number/JID. Group and broadcast sends are blocked in this phase.

## WhatsApp Inbox Mode

The runtime archives incoming WhatsApp text messages so the owner can ask questions like:

- "Summarize my recent WhatsApp chats."
- "What deadlines or meetings did people mention today?"
- "List my recent chats."

By default, `WHATSAPP_REPLY_TO_ALL=true`, so anyone who sends a direct WhatsApp message to the connected agent number receives an AI reply. The agent prompt supports both Swahili and English, including mixed Swahili-English messages, and tries to answer in the same language the user used.

Numbers in `ALLOWED_WHATSAPP_NUMBERS` are treated as owners. Owner chats can use owner-only capabilities such as reading the archived WhatsApp inbox and sending outbound WhatsApp messages. Public users can chat with the AI and use normal safe tools, but owner-only WhatsApp tools are not exposed to them.

To make the bot private again, set:

```env
WHATSAPP_REPLY_TO_ALL=false
```

Messages from other chats are still stored for the owner's summaries/action-item extraction.

If you scan your own WhatsApp account and want to command the assistant from your "message yourself" chat, set:

```env
WHATSAPP_PROCESS_FROM_ME_COMMANDS=true
WHATSAPP_FROM_ME_COMMAND_PREFIX=/agent
```

Then send messages like `/agent summarize my recent WhatsApp chats`. The prefix prevents the assistant from treating every message you send as a command.

Note: the archive starts from messages received while this service is running and authenticated. It does not backfill old WhatsApp history.

Future integrations such as Gmail, GitHub, web search, files, weather, Notion, Telegram, and Slack should be added as independent tools or channel adapters without changing the WhatsApp layer.

## Current OpenClaw-Style Scope

Implemented:

- Local Gateway runtime
- WhatsApp channel adapter
- Tool capability listing
- Gateway/channel health endpoints
- Existing tasks, reminders, calendar, summarization, memory, and WhatsApp chat archive tools

Not implemented in this phase:

- Upstream OpenClaw plugin marketplace compatibility
- Telegram, Slack, or Discord runtime channels
- Browser automation tools
- Control UI dashboard
- Sandboxed command execution
