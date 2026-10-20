# Hawa WhatsApp Bot

Hawa is a TypeScript WhatsApp AI agent that can reply to direct messages from public users and provide owner-only personal assistant tools for the configured owner account. The runtime follows an OpenClaw-style Gateway architecture: channels connect to a local Gateway, the Gateway routes messages to the agent, and tools are exposed as capabilities.

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

To use [OpenRouter](https://openrouter.ai) instead (one API key for models from OpenAI, Anthropic, Google, Meta, DeepSeek, and others):

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openai/gpt-4o-mini
```

- Pick any model id from [openrouter.ai/models](https://openrouter.ai/models). It must support tool calling, otherwise Hawa cannot use tasks, reminders, calendar, or memory. A stronger model gives better answers but costs more per message.
- `OPENROUTER_FALLBACK_MODELS` (optional, comma-separated) lists models OpenRouter tries in order if the main model is down or rate limited.
- Voice notes are transcribed through OpenRouter with `OPENROUTER_TRANSCRIPTION_MODEL` (default `openai/whisper-1`).
- `AI_API_KEY` is used if `OPENROUTER_API_KEY` is empty.

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

Hawa only reports Google Calendar success after the Google API returns an event id. If Google Calendar fails, the request fails gracefully.

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
/agent send a message to Amina saying "Good night."
```

Outbound sending is limited to direct contacts by phone number, direct WhatsApp JID, `@lid` JID, or exact archived contact/display name. If a contact name matches multiple chats, Hawa refuses to send and asks for the exact number/JID. Group and broadcast sends are blocked in this phase.

## WhatsApp Inbox Mode

The runtime archives incoming WhatsApp text messages so the owner can ask questions like:

- "Summarize my recent WhatsApp chats."
- "What deadlines or meetings did people mention today?"
- "List my recent chats."

By default, `WHATSAPP_REPLY_TO_ALL=true`, so anyone who sends or texts a direct WhatsApp message to the connected agent number receives an AI reply from Hawa. The agent prompt supports both Swahili and English, including mixed Swahili-English messages, and tries to answer in the same language the user used.

Numbers in `ALLOWED_WHATSAPP_NUMBERS` are treated as owners. Owner chats can use owner-only capabilities such as reading the archived WhatsApp inbox and sending outbound WhatsApp messages. Public users can chat with the AI and use normal safe tools, but owner-only WhatsApp tools are not exposed to them.

### Group members

Hawa can also answer members of WhatsApp groups that the agent number belongs to. Group behaviour is controlled by `WHATSAPP_GROUP_REPLY_MODE`:

- `mention` (default): Hawa replies only when a member @mentions the agent number, replies to one of Hawa's messages, or starts the message with `WHATSAPP_GROUP_COMMAND_PREFIX` (default `/hawa`, e.g. `/hawa what is the capital of Kenya?`). Other group chatter is archived but ignored.
- `all`: Hawa replies to every group message.
- `off`: Hawa never replies in groups.

Group replies quote the member's message so everyone can see who the answer is for, and owner-only tools are never available inside a group, even to the owner, because the whole group would see the reply.

### Voice notes

Hawa listens to voice notes (and forwarded audio files) and replies in text, the same way it answers typed messages. Swahili, English, and mixed speech are supported.

- With `AI_PROVIDER=openai`, audio is transcribed with `AI_TRANSCRIPTION_MODEL` (default `whisper-1`). With `AI_PROVIDER=openrouter`, it uses `OPENROUTER_TRANSCRIPTION_MODEL` (default `openai/whisper-1`). With `AI_PROVIDER=gemini`, Gemini transcribes the audio directly.
- Audio is only downloaded and transcribed when Hawa would answer the sender: direct chats it replies to, or group voice notes that reply to one of Hawa's messages (or any group voice note in `all` mode). Rate limits apply before transcription.
- Voice notes longer than `WHATSAPP_VOICE_NOTE_MAX_SECONDS` (default 120; `0` disables) are refused with a short message instead of being transcribed.
- If transcription fails or hears no speech, Hawa asks the sender to try again or type the message.
- Archived voice notes are stored as `[Voice note] <transcript>`, so they show up in inbox summaries. Voice notes Hawa did not answer are stored as `[Voice note]`.
- Set `WHATSAPP_VOICE_NOTES=false` to turn transcription off; Hawa will then ask voice-note senders to type instead.

### Reliability and abuse protection

- Hawa marks incoming messages as read and shows "typing…" while it works on an answer.
- Messages from the same chat are answered in order, and duplicates are ignored.
- Messages older than `WHATSAPP_MAX_MESSAGE_AGE_SECONDS` (default 300) are archived but not answered, so reconnecting after downtime does not flood people with late replies. Set `0` to disable.
- Public senders are limited to `WHATSAPP_PUBLIC_RATE_LIMIT_PER_MINUTE` replies per minute (default 10; `0` disables). Hawa warns a sender once when they hit the limit. Owners are not limited.
- Text captions on images, videos, and documents, and messages in disappearing-message chats, are treated as normal text questions.

To make the bot private again, set:

```env
WHATSAPP_REPLY_TO_ALL=false
```

Messages from other chats are still stored for the owner's summaries/action-item extraction.

If you scan your own WhatsApp account and want to command Hawa from your "message yourself" chat, set:

```env
WHATSAPP_PROCESS_FROM_ME_COMMANDS=true
WHATSAPP_FROM_ME_COMMAND_PREFIX=/agent
```

Then send messages like `/agent summarize my recent WhatsApp chats`. The prefix prevents Hawa from treating every message you send as a command.

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
