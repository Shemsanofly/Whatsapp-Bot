export interface ToolExecutionContext {
  userId: string;
  timezone: string;
}

export interface ToolResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: object;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult>;
}
