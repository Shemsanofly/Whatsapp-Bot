# OpenClaw-Style Gateway Migration Design

Date: 2026-08-29

## Goal

Convert Hawa from a WhatsApp-only AI agent into an OpenClaw-style personal assistant platform while keeping the existing working foundation: TypeScript, Express, Prisma, Baileys WhatsApp runtime, LLM providers, tools, reminders, calendar, memory, and tests.

The project will not vendor or replace itself with upstream `openclaw/openclaw`. Instead, it will adopt the key architecture that makes OpenClaw manageable:

- a local Gateway as the runtime control plane
- channel adapters so WhatsApp is one channel, not the whole app
- a channel-agnostic agent message contract
- a capability registry with tool metadata and policy hooks
- health and control endpoints that expose gateway, channel, tool, and agent state

This approach is lower risk than replacing the application because the current system already works and has passing tests.

## Current State

The current app has:

- WhatsApp transport in `src/whatsapp`
- authorization through `WhatsAppAuthorizer`
- orchestration in `src/agent/AgentOrchestrator.ts`
- tools through `AgentTool` and `ToolRegistry`
- persistence through Prisma
- health endpoints for process and WhatsApp state
- reminder delivery via scheduler
- 25 passing tests across agent, tools, WhatsApp handling, LLM providers, and health

The main coupling is that the agent input model is WhatsApp-specific and the server bootstraps WhatsApp directly. That makes future channels, control APIs, and policy hard to add cleanly.

## Recommended Architecture

### 1. Gateway Runtime

Add a `src/gateway` module that owns runtime wiring:

- start and stop channel adapters
- expose aggregate health
- route inbound channel messages to the agent
- route outbound replies through the originating channel
- expose registered tools and channel metadata

The gateway will become the main dependency in `server.ts`; `server.ts` should only assemble dependencies, start HTTP, start the gateway, and shut everything down.

### 2. Channel Abstraction

Introduce a generic channel contract:

- `ChannelAdapter`
  - `id`
  - `name`
  - `start()`
  - `stop()`
  - `sendText(target, text)`
  - `getHealth()`
  - `onMessage(handler)`
- `ChannelMessage`
  - `channel`
  - `messageId`
  - `conversationId`
  - `senderId`
  - `senderDisplayName`
  - `fromSelf`
  - `text`
  - `timestamp`
  - `raw`

WhatsApp will be wrapped as a `WhatsAppChannelAdapter`. Existing `WhatsAppConnectionManager` can remain the low-level Baileys adapter.

### 3. Channel-Agnostic Authorization

Keep the existing WhatsApp allowlist behavior, but move decision-making into a channel policy layer:

- owner allowlist per channel
- optional self-command prefix support
- archive-only behavior for non-owner WhatsApp chats
- no reply to unauthorized senders

For the first migration, only WhatsApp is active. The abstraction should make Telegram/Slack possible later without implementing them now.

### 4. Agent Message Contract

Replace WhatsApp-specific agent input with a generic input:

- `userExternalId`
- `channel`
- `channelConversationId`
- `messageId`
- `text`
- `timezone`

The current `getOrCreateUserByWhatsApp` can stay for compatibility, but a new generic user identity method should be added when multi-channel persistence is introduced. For the first phase, WhatsApp still maps to the current user model.

### 5. Capability Registry

Extend `ToolRegistry` into an OpenClaw-style capability surface:

- list callable tool definitions for the model
- list tools for control endpoints
- support enabled/disabled status
- reserve a policy hook for future tool allow/deny rules

Do not build a full plugin marketplace yet. The first implementation should support built-in tools and a clean interface for future plugins.

### 6. Control and Health Endpoints

Expand Express routes:

- `GET /health` returns aggregate gateway health
- `GET /health/channels` returns channel states
- `GET /channels` lists configured channels
- `GET /tools` lists registered tool capabilities
- keep `GET /health/whatsapp` for backward compatibility

These endpoints are read-only. Mutating control actions such as connect, disconnect, pair, install plugin, or approve pairing are out of scope for this phase.

### 7. Tests

Use TDD for implementation:

- gateway routes inbound messages to the agent and replies through the same channel
- gateway does not start disabled channels
- WhatsApp adapter preserves current authorization and self-command behavior
- control endpoints expose channels and tools
- existing WhatsApp tests keep passing

The baseline test command is `npm test`; it currently passes.

## Out of Scope

This phase will not implement:

- full upstream OpenClaw compatibility
- plugin installation from npm or ClawHub
- Telegram, Slack, or Discord runtime
- browser automation tools
- Control UI dashboard
- sandboxed command execution
- WhatsApp Business Cloud API migration

These are good follow-up phases after the Gateway boundary is stable.

## Migration Steps

1. Add gateway/channel types and tests.
2. Implement `GatewayRuntime`.
3. Add `WhatsAppChannelAdapter` that wraps existing WhatsApp pieces.
4. Update `server.ts` to start the gateway instead of starting WhatsApp directly.
5. Update `createApp` to expose gateway health, channels, and tools.
6. Keep backward-compatible `/health/whatsapp`.
7. Update README and `.env.example` to describe OpenClaw-style gateway mode.
8. Run `npm test`, `npm run typecheck`, and `npm run build`.

## Risks

- WhatsApp Web/Baileys behavior can change, so the channel adapter should isolate WhatsApp-specific assumptions.
- A full OpenClaw clone is too large for one migration. This design intentionally adopts the architecture, not every feature.
- Current Prisma user identity is WhatsApp-specific. Multi-channel identity should be a later migration to avoid destabilizing existing data.
- This workspace is not a git repository, so the design document cannot be committed from here.

## Acceptance Criteria

- The app starts through a Gateway runtime.
- WhatsApp still works as the first channel.
- Existing tools remain callable by the agent.
- Existing tests continue to pass.
- New tests cover gateway routing and new control endpoints.
- README documents the OpenClaw-style structure and the remaining gaps.
