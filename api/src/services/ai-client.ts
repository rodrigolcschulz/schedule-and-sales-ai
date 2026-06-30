// services/ai-client.ts
// Cliente HTTP para o serviço python-ai (FastAPI), rodando ao lado do Fastify.
// Espelha os contratos definidos em contracts/planner.py.

import type { ToolDefinition } from "../domains/types.js";

export type { ToolDefinition };

const AI_BASE_URL = process.env.AI_BASE_URL ?? "http://localhost:8001";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PlanStep {
  id: string;
  title: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
}

export interface PlannerRequest {
  message: string;
  history: ChatMessage[];
  domainId: string;
  sessionId: string;
}

export interface PlannerResponse {
  version: string;
  domainId: string;
  summary: string;
  intent: string;
  confidence: number;
  needsClarification: boolean;
  missingFields: Array<{
    field: string;
    reason: string;
    question: string;
  }>;
  steps: PlanStep[];
  suggestedReply: string;
}

export interface ToolExecutionRecord {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface ExecuteResult {
  success: boolean;
  result: Record<string, unknown>;
  error?: string;
}

export interface ReflectRequest {
  plan: PlannerResponse;
  executeResult: ExecuteResult;
}

export interface ReflectResponse {
  version: string;
  approved: boolean;
  finalReply: string;
  insights: Array<Record<string, unknown>>;
}

export interface HealthResponse {
  status: string;
  provider: string;
}

export class AiClientError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "AiClientError";
  }
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${AI_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AiClientError(`python-ai ${path} -> ${res.status}: ${text}`, res.status);
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof AiClientError) throw err;
    throw new AiClientError(`Falha ao chamar python-ai ${path}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export const aiClient = {
  plan(req: PlannerRequest): Promise<PlannerResponse> {
    return postJson<PlannerResponse>("/ai/plan", {
      version: "1.0",
      domainId: req.domainId,
      message: req.message,
      sessionId: req.sessionId,
      history: req.history,
    });
  },

  reflect(req: ReflectRequest): Promise<ReflectResponse> {
    return postJson<ReflectResponse>("/ai/reflect", req);
  },

  async health(): Promise<HealthResponse> {
    const res = await fetch(`${AI_BASE_URL}/ai/health`);
    if (!res.ok) {
      throw new AiClientError(`python-ai /ai/health -> ${res.status}`, res.status);
    }
    return res.json() as Promise<HealthResponse>;
  },
};