import type { ToolDefinition } from "../domains/types.js";

/**
 * Compat layer mantido para evitar quebra de imports antigos.
 * O fluxo atual usa `domain.tools` + `domain.executeTool`.
 */
export const LLM_TOOLS: ToolDefinition[] = [];

export async function executeLlmTool(): Promise<{ ok: false; error: string }> {
  return { ok: false, error: "deprecated_use_domain_executeTool" };
}
