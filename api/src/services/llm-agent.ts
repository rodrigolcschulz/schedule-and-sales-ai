import { getOllamaBaseUrl, getOllamaModel } from "./ollama-chat.js";
import type { OllamaToolDefinition } from "./llm-tools.js";
import {
  executeLlmTool,
  LLM_TOOLS,
  type ToolContext,
} from "./llm-tools.js";

export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * Opções para o agente domain-agnostic.
 * Quando omitidas, recaem no comportamento legado (pizzeria).
 */
export type AgentOptions = {
  systemPrompt?: string;
  tools?: OllamaToolDefinition[];
  executeTool?: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
};

type OllamaMsg = Record<string, unknown>;

function maybeParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function sanitizeAssistantReply(text: string): string {
  const cleaned = text
    .replace(/^\s*_\[[^\]]+\]_\s*$/gim, "")
    .replace(/^\s*_\([^\)]+\)_\s*$/gim, "")
    .replace(/^\s*\[[^\]]+\]\s*$/gim, "")
    .replace(/^\s*\([^\)]*service\s*:\s*\[[^\]]+\][^\)]*\)\s*$/gim, "")
    // Remove "Resposta do sistema: {...}" artifacts
    .replace(/[Rr]esposta\s+do\s+sistema\s*:\s*(\{[^}]*\}|"[^"]*")/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

function getObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function extractAvailableTimesFromSlotsPayload(payload: unknown): string[] {
  const obj = getObject(payload);
  if (!obj) return [];

  const morning = asStringArray(obj.available_morning_times);
  const afternoon = asStringArray(obj.available_afternoon_times);
  if (morning.length || afternoon.length) {
    return [...morning, ...afternoon];
  }

  const slotsRaw = obj.slots;
  if (!Array.isArray(slotsRaw)) return [];

  const times: string[] = [];
  for (const item of slotsRaw) {
    const slot = getObject(item);
    if (!slot) continue;
    if (slot.available !== true) continue;
    const id = typeof slot.id === "string" ? slot.id : "";
    const m = /_(\d{2})(\d{2})$/.exec(id);
    if (m) times.push(`${m[1]}:${m[2]}`);
  }
  return times;
}

function reconcileReplyWithToolResult(
  text: string,
  lastTool: { name: string; ok: boolean; payload: unknown } | null
): string {
  if (!lastTool || !lastTool.ok) return text;
  if (lastTool.name !== "list_available_slots") return text;

  const availableTimes = extractAvailableTimesFromSlotsPayload(lastTool.payload);
  if (!availableTimes.length) return text;

  const saidNoAvailability =
    /não\s+h[aá]|não\s+tem|nenhum\s+hor[aá]rio|sem\s+hor[aá]rios|sem\s+vagas/i.test(
      text
    );

  if (!saidNoAvailability) return text;

  return `Temos horários disponíveis nesse dia. Opções: ${availableTimes.join(", ")}. Qual você prefere?`;
}

function humanizePotentialJsonReply(text: string): string {
  const obj = maybeParseJsonObject(text);
  if (!obj) return text;

  if (typeof obj.error === "string") {
    return `Não consegui concluir agora: ${obj.error}`;
  }

  if (typeof obj.service === "string" && typeof obj.starts_at === "string") {
    return `Consulta agendada com sucesso para ${obj.starts_at}. Serviço: ${obj.service}.`;
  }

  const morning = asStringArray(obj.available_morning_times);
  const afternoon = asStringArray(obj.available_afternoon_times);
  if (morning.length || afternoon.length) {
    const m = morning.length ? `Manhã: ${morning.join(", ")}.` : "Manhã: sem horários disponíveis.";
    const a = afternoon.length ? `Tarde: ${afternoon.join(", ")}.` : "Tarde: sem horários disponíveis.";
    return `${m} ${a}`;
  }

  if (Array.isArray(obj.slots)) {
    return "Consultei os horários disponíveis. Posso te mostrar por manhã e tarde se você quiser.";
  }

  return "Consultei os dados com sucesso. Se quiser, te apresento de forma resumida.";
}

function parseToolArguments(
  raw: string | Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Uma rodada de chat com tools (sem stream). Retorna o JSON completo do Ollama.
 */
async function ollamaChatOnce(params: {
  messages: OllamaMsg[];
  tools: OllamaToolDefinition[];
}): Promise<{
  message?: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: string | Record<string, unknown> };
    }>;
  };
}> {
  const base = getOllamaBaseUrl();
  const model = getOllamaModel();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: params.messages,
      tools: params.tools,
      stream: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama HTTP ${res.status}: ${t.slice(0, 600)}`);
  }
  return res.json() as Promise<{
    message?: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string | Record<string, unknown> };
      }>;
    };
  }>;
}

const AGENT_SYSTEM_DEFAULT =
  process.env.LLM_AGENT_SYSTEM_PROMPT ??
  [
    "Você é o assistente de uma pizzaria (demo). Use as ferramentas para consultar cardápio, horários à noite (Brasília), criar pedidos e agendamentos.",
    "Quando o usuário quiser pedir pizza ou marcar horário, chame as ferramentas em vez de inventar preços ou vagas.",
    "Telefone: pode normalizar só com dígitos.",
  ].join(" ");

const MAX_AGENT_STEPS = 8;

/**
 * Roda o agente LLM com tools.
 *
 * Assinatura legada (pizzeria):
 *   runLlmToolAgent(turns, ctx, systemPrompt?)
 *
 * Assinatura modular (qualquer domínio):
 *   runLlmToolAgent(turns, opts)
 *   onde opts = { systemPrompt, tools, executeTool }
 */
export async function runLlmToolAgent(
  turns: ChatTurn[],
  ctxOrOpts: ToolContext | AgentOptions,
  legacySystemPrompt?: string
): Promise<{ reply: string; trace?: Array<{ tool: string; ok: boolean }> }> {
  let systemPrompt: string;
  let activeTools: OllamaToolDefinition[];
  let execTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ ok: boolean; result?: unknown; error?: string }>;

  const isAgentOptions =
    ctxOrOpts &&
    ("tools" in ctxOrOpts || "executeTool" in ctxOrOpts || "systemPrompt" in ctxOrOpts) &&
    !("schedule" in ctxOrOpts);

  if (isAgentOptions) {
    const opts = ctxOrOpts as AgentOptions;
    systemPrompt = opts.systemPrompt ?? AGENT_SYSTEM_DEFAULT;
    activeTools = opts.tools ?? LLM_TOOLS;
    execTool = opts.executeTool ?? ((n, a) => executeLlmTool(n, a, { schedule: undefined as never, orders: undefined as never }));
  } else {
    const ctx = ctxOrOpts as ToolContext;
    systemPrompt = legacySystemPrompt ?? AGENT_SYSTEM_DEFAULT;
    activeTools = LLM_TOOLS;
    execTool = (n, a) => executeLlmTool(n, a, ctx);
  }

  const messages: OllamaMsg[] = [
    { role: "system", content: systemPrompt },
    ...turns.map((t) => ({ role: t.role, content: t.content })),
  ];
  const trace: Array<{ tool: string; ok: boolean }> = [];
  let lastTool: { name: string; ok: boolean; payload: unknown } | null = null;

  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    const data = await ollamaChatOnce({ messages, tools: activeTools });
    const msg = data.message;
    if (!msg) throw new Error("Resposta sem message do Ollama.");

    const toolCalls = msg.tool_calls?.filter(
      (tc) => tc.function?.name
    );
    if (!toolCalls?.length) {
      const text = msg.content?.trim() ?? "";
      if (!text) {
        return {
          reply:
            "Concluí a consulta das informações. Me diga se você quer que eu siga com o agendamento agora.",
          trace,
        };
      }
      const normalized = sanitizeAssistantReply(humanizePotentialJsonReply(text));
      return { reply: reconcileReplyWithToolResult(normalized, lastTool), trace };
    }

    messages.push(msg as OllamaMsg);

    for (const tc of toolCalls) {
      const fn = tc.function!;
      const name = fn.name!;
      const args = parseToolArguments(fn.arguments);
      const exec = await execTool(name, args);
      trace.push({ tool: name, ok: exec.ok });
      const payload = exec.ok ? exec.result : { error: exec.error };
      lastTool = { name, ok: exec.ok, payload };
      messages.push({
        role: "tool",
        content: JSON.stringify(payload),
      });
    }
  }

  return {
    reply:
      "Limite de passos do agente atingido. Tente simplificar o pedido ou atualize o Ollama.",
    trace,
  };
}
