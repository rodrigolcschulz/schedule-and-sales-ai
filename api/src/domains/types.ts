import type { ScheduleStore } from "../services/schedule-store.js";

export type ToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type DomainContext = {
  schedule: ScheduleStore;
  [key: string]: unknown;
};

export interface BusinessDomain {
  id: string;
  displayName: string;
  systemPrompt: string;
  tools: ToolDefinition[];

  executeTool(
    name: string,
    args: Record<string, unknown>,
    ctx: DomainContext
  ): Promise<ToolResult>;

  createContext(): DomainContext;
  whatsAppHelp: string;

  handleWhatsAppCommand?(
    text: string,
    lower: string,
    from: string,
    ctx: DomainContext
  ): Promise<string | null>;
}
