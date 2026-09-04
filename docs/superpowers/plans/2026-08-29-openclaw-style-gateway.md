# OpenClaw-Style Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OpenClaw-style Gateway runtime around the existing WhatsApp personal agent.

**Architecture:** Keep the existing WhatsApp, Prisma, LLM, and tool implementation. Add a focused `src/gateway` layer that owns channel adapters, routes channel messages to the agent, and exposes runtime health/metadata to Express.

**Tech Stack:** TypeScript, Express, Vitest, Prisma, Baileys, existing `AgentTool` and `ToolRegistry`.

**Spec:** `docs/superpowers/specs/2026-08-29-openclaw-style-gateway-design.md`

## Global Constraints

- Preserve existing WhatsApp runtime behavior.
- Preserve existing tool names and schemas.
- Keep `/health/whatsapp` backward compatible.
- Do not add Telegram, Slack, Discord, plugin installation, browser automation, or a Control UI in this phase.
- Use TDD: write failing tests before production code.
- This workspace is not a git repository, so skip commit steps and report that limitation.

---

## File Structure

- Create `src/gateway/types.ts`: shared Gateway, channel, health, and agent port types.
- Create `src/gateway/GatewayRuntime.ts`: starts/stops channels, routes inbound messages to the agent, exposes health and metadata.
- Create `src/gateway/WhatsAppChannelAdapter.ts`: wraps existing `WhatsAppConnectionManager`, `WhatsAppMessageHandler`, authorization, and archive behavior behind the channel contract.
- Modify `src/whatsapp/types.ts`: add compatibility shape only if needed by the adapter.
- Modify `src/agent/ToolRegistry.ts`: add `listCapabilities()` for control endpoints.
- Modify `src/app.ts`: expose Gateway health, channel list, and tool list.
- Modify `src/server.ts`: wire `GatewayRuntime` and `WhatsAppChannelAdapter`.
- Modify `README.md` and `.env.example`: document Gateway mode and channel/tool endpoints.
- Create `tests/unit/gateway/GatewayRuntime.test.ts`: TDD coverage for routing, health, and disabled channels.
- Create `tests/unit/gateway/WhatsAppChannelAdapter.test.ts`: TDD coverage that adapter delegates lifecycle and sender behavior.
- Modify `tests/unit/health/health.test.ts`: TDD coverage for new control endpoints.
- Modify `tests/unit/agent/ToolRegistry.test.ts`: TDD coverage for `listCapabilities()`.

## Task 1: Gateway Runtime

**Files:**
- Create: `src/gateway/types.ts`
- Create: `src/gateway/GatewayRuntime.ts`
- Test: `tests/unit/gateway/GatewayRuntime.test.ts`

**Interfaces:**
- Produces: `ChannelAdapter`, `ChannelMessage`, `GatewayRuntime`, `GatewayAgentPort`, `GatewayHealth`.
- Consumes: agent port with `handleMessage(message): Promise<string>`.

- [ ] **Step 1: Write failing tests**

```ts
import { GatewayRuntime } from '../../../src/gateway/GatewayRuntime.js';
import type { ChannelAdapter, ChannelMessage, GatewayAgentPort } from '../../../src/gateway/types.js';

class FakeChannel implements ChannelAdapter {
  public handler?: (message: ChannelMessage) => Promise<void>;
  public starts = 0;
  public stops = 0;
  public sent: Array<{ target: string; text: string }> = [];

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly enabled = true
  ) {}

  onMessage(handler: (message: ChannelMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    this.starts += 1;
  }

  async stop(): Promise<void> {
    this.stops += 1;
  }

  async sendText(target: string, text: string): Promise<void> {
    this.sent.push({ target, text });
  }

  getHealth() {
    return { connected: this.starts > 0, authenticated: this.starts > 0 };
  }
}

describe('GatewayRuntime', () => {
  it('routes inbound channel messages to the agent and replies through the same channel', async () => {
    const channel = new FakeChannel('whatsapp', 'WhatsApp');
    const agent: GatewayAgentPort = {
      handleMessage: async (message) => `processed ${message.text} on ${message.channel}`
    };
    const gateway = new GatewayRuntime({ channels: [channel], agent });

    await gateway.start();
    await channel.handler?.({
      channel: 'whatsapp',
      messageId: 'message-1',
      conversationId: '255712345678@s.whatsapp.net',
      senderId: '255712345678',
      text: 'show my tasks',
      fromSelf: false,
      timestamp: new Date('2026-08-29T12:00:00.000Z')
    });

    expect(channel.sent).toEqual([
      { target: '255712345678@s.whatsapp.net', text: 'processed show my tasks on whatsapp' }
    ]);
  });

  it('does not start disabled channels', async () => {
    const channel = new FakeChannel('telegram', 'Telegram', false);
    const gateway = new GatewayRuntime({
      channels: [channel],
      agent: { handleMessage: async () => 'ok' }
    });

    await gateway.start();

    expect(channel.starts).toBe(0);
    expect(gateway.listChannels()).toEqual([
      { id: 'telegram', name: 'Telegram', enabled: false, health: { connected: false, authenticated: false } }
    ]);
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npx vitest run tests/unit/gateway/GatewayRuntime.test.ts`

Expected: FAIL because `src/gateway/GatewayRuntime.ts` does not exist.

- [ ] **Step 3: Implement minimal Gateway**

Create `src/gateway/types.ts` with the exact contracts used by the test. Create `src/gateway/GatewayRuntime.ts` to register handlers, start enabled channels, stop started channels, route replies to `message.conversationId`, and list channel metadata.

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run tests/unit/gateway/GatewayRuntime.test.ts`

Expected: PASS.

## Task 2: Tool Capability Metadata

**Files:**
- Modify: `src/agent/ToolRegistry.ts`
- Test: `tests/unit/agent/ToolRegistry.test.ts`

**Interfaces:**
- Produces: `ToolRegistry.listCapabilities(): Array<{ name: string; description: string; inputSchema: object; enabled: boolean }>`
- Consumes: existing `AgentTool`.

- [ ] **Step 1: Write failing test**

Add an assertion that `registry.listCapabilities()` returns the tool metadata plus `enabled: true`.

- [ ] **Step 2: Verify test fails**

Run: `npx vitest run tests/unit/agent/ToolRegistry.test.ts`

Expected: FAIL because `listCapabilities` does not exist.

- [ ] **Step 3: Implement minimal method**

Add `listCapabilities()` to `ToolRegistry` using the existing tools map.

- [ ] **Step 4: Verify test passes**

Run: `npx vitest run tests/unit/agent/ToolRegistry.test.ts`

Expected: PASS.

## Task 3: Gateway Control Endpoints

**Files:**
- Modify: `src/app.ts`
- Modify: `tests/unit/health/health.test.ts`

**Interfaces:**
- Consumes: `gatewayHealth()`, `listChannels()`, `listTools()`, and `whatsappHealth()` dependencies.
- Produces: `GET /health`, `GET /health/channels`, `GET /channels`, `GET /tools`, `GET /health/whatsapp`.

- [ ] **Step 1: Write failing endpoint tests**

Add tests proving:

```ts
GET /health returns { status: 'healthy', gateway: ..., whatsapp: ... }
GET /health/channels returns the channel health array
GET /channels returns channel metadata
GET /tools returns tool metadata
```

- [ ] **Step 2: Verify tests fail**

Run: `npx vitest run tests/unit/health/health.test.ts`

Expected: FAIL because `createApp` does not accept the new dependencies and routes do not exist.

- [ ] **Step 3: Implement routes**

Update `createApp` so new dependencies are optional enough for existing call sites during migration, but server passes the full Gateway dependencies.

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run tests/unit/health/health.test.ts`

Expected: PASS.

## Task 4: WhatsApp Channel Adapter

**Files:**
- Create: `src/gateway/WhatsAppChannelAdapter.ts`
- Test: `tests/unit/gateway/WhatsAppChannelAdapter.test.ts`

**Interfaces:**
- Consumes: `WhatsAppConnectionManager`, `WhatsAppMessageHandler`, `WhatsAppAuthorizer`, archive service, and options already used by `server.ts`.
- Produces: a `ChannelAdapter` with `id: 'whatsapp'`, `name: 'WhatsApp'`.

- [ ] **Step 1: Write failing tests**

Test that:

```ts
adapter.onMessage(handler) registers a WhatsAppMessageHandler-backed callback
adapter.start() delegates to WhatsAppService.start()
adapter.stop() delegates to WhatsAppService.shutdown()
adapter.sendText(to, text) delegates to connection manager
adapter.getHealth() returns WhatsApp health
```

- [ ] **Step 2: Verify tests fail**

Run: `npx vitest run tests/unit/gateway/WhatsAppChannelAdapter.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement adapter**

Build adapter by composing `WhatsAppMessageHandler` with a small bridge agent that converts WhatsApp handler calls into generic `ChannelMessage` and sends responses through the Gateway callback.

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run tests/unit/gateway/WhatsAppChannelAdapter.test.ts`

Expected: PASS.

## Task 5: Server Wiring

**Files:**
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `GatewayRuntime`, `WhatsAppChannelAdapter`, existing services.
- Produces: runtime boot through Gateway instead of direct WhatsApp startup.

- [ ] **Step 1: Build/typecheck before server change**

Run: `npm run typecheck`

Expected: PASS before modifying server wiring.

- [ ] **Step 2: Refactor startup**

Move direct WhatsApp startup into `WhatsAppChannelAdapter` and create `GatewayRuntime({ channels: [whatsappChannel], agent: orchestrator })`.

- [ ] **Step 3: Verify server compiles**

Run: `npm run typecheck`

Expected: PASS.

## Task 6: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Produces: user-facing docs for Gateway mode and endpoints.

- [ ] **Step 1: Update docs**

Document:

```md
GET /health
GET /health/channels
GET /channels
GET /tools
GET /health/whatsapp
```

Explain that this is OpenClaw-style architecture, not a full upstream OpenClaw clone.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all pass.
