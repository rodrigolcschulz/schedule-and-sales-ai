import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { createWhatsAppProvider, type WhatsAppProviderKind } from "./whatsapp/factory.js";
import type { StubWhatsAppProvider } from "./whatsapp/stub-provider.js";
import { dentalDomain } from "./domains/dental/index.js";
import type { DomainContext } from "./domains/types.js";
import { runAgent } from "./services/run-agent.js";
import { aiClient, type ToolExecutionRecord } from "./services/ai-client.js";

const domain = dentalDomain;
const ctx: DomainContext = domain.createContext();

console.info(`[domain] Active domain: ${domain.displayName} (${domain.id})`);

function envProviderKind(): WhatsAppProviderKind {
  const v = (process.env.WHATSAPP_PROVIDER ?? "stub").toLowerCase();
  if (v === "baileys") return "baileys";
  return "stub";
}

const wa = createWhatsAppProvider(envProviderKind());
wa.onMessage(async (msg) => {
  const text = msg.text.trim();
  const lower = text.toLowerCase();

  try {
    if (lower === "ajuda" || lower === "help") {
      await wa.sendText(msg.from, domain.whatsAppHelp);
      return;
    }

    const directReply = await domain.handleWhatsAppCommand?.(text, lower, msg.from, ctx);
    if (directReply) {
      await wa.sendText(msg.from, directReply);
      return;
    }

    const reply = await runAgent(domain, text, [], `wa:${msg.from}`, ctx);
    await wa.sendText(msg.from, reply);
  } catch (err) {
    console.error("[whatsapp] failed to process message", err);
    await wa.sendText(msg.from, "Desculpe, não consegui processar agora. Pode tentar novamente?");
  }
});

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

app.get("/domain", async () => ({
  id: domain.id,
  displayName: domain.displayName,
  tools: domain.tools.map((t) => t.function.name),
}));

app.get("/catalog", async () => {
  const { servicesPayloadForApi } = await import("./domains/dental/catalog.js");
  return servicesPayloadForApi();
});

app.get("/menu", async (_req, reply) => {
  return reply.code(404).send({ error: "not_available_for_this_domain" });
});

app.get("/orders", async (_req, reply) => {
  return reply.code(404).send({ error: "not_available_for_this_domain" });
});

app.get("/slots", async (req) => {
  const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
  const slots = ctx.schedule.getSlotsForDay(q.date);
  const taken = ctx.schedule.getBookedSlotIds();
  return {
    date: q.date,
    slots: slots.map((s) => ({ ...s, available: !taken.has(s.id) })),
  };
});

const createBookingBody = z.object({
  slotId: z.string(),
  customerName: z.string().min(1),
  phone: z.string().min(3),
  serviceId: z.string().optional(),
  notes: z.string().optional(),
});

app.post("/bookings", async (req, reply) => {
  const body = createBookingBody.parse(req.body);
  const slots = ctx.schedule.getSlotsForDay(body.slotId.slice(0, 10));
  const slot = slots.find((s) => s.id === body.slotId);
  if (!slot) return reply.code(400).send({ error: "invalid_slot" });

  const { patients } = ctx as unknown as { patients: import("./domains/dental/patient-store.js").PatientStore };

  if (body.serviceId) {
    const res = patients.createAppointment(ctx.schedule, {
      slotId: slot.id,
      patientName: body.customerName,
      phone: body.phone.replace(/\D/g, "") || body.phone,
      serviceId: body.serviceId,
      ...(body.notes ? { notes: body.notes } : {}),
    });
    if ("error" in res) return reply.code(409).send({ error: res.error });
    return res;
  }

  const res = ctx.schedule.createBooking({
    slotId: slot.id,
    startsAt: slot.startsAt,
    customerName: body.customerName,
    phone: body.phone.replace(/\D/g, "") || body.phone,
  });
  if ("error" in res) return reply.code(409).send({ error: res.error });
  return res;
});

app.get("/bookings", async () => ctx.schedule.listBookings());

app.delete<{ Params: { id: string } }>("/bookings/:id", async (req, reply) => {
  const ok = ctx.schedule.cancelBooking(req.params.id);
  if (!ok) return reply.code(404).send({ error: "not_found" });
  return { ok: true };
});

app.get("/appointments", async (req) => {
  const { patients } = ctx as unknown as { patients: import("./domains/dental/patient-store.js").PatientStore };
  const q = z.object({ phone: z.string().optional() }).parse(req.query);
  const list = q.phone ? patients.listAppointmentsByPhone(q.phone) : patients.listAll();
  return { appointments: list };
});

const simulateBody = z.object({
  from: z.string().min(3),
  text: z.string().min(1),
});

app.post("/integrations/whatsapp/simulate-inbound", async (req, reply) => {
  if (wa.name !== "stub") return reply.code(400).send({ error: "only_stub" });
  const body = simulateBody.parse(req.body);
  (wa as StubWhatsAppProvider).simulateInbound({ from: body.from, text: body.text });
  return { ok: true };
});

app.post("/integrations/whatsapp/webhook", async (req) => {
  req.log.info({ body: req.body }, "whatsapp webhook (não processado no MVP)");
  return { ok: true };
});

const llmChatBody = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) })).min(1),
  sessionId: z.string().min(1).optional(),
});

app.get("/llm/status", async () => {
  try {
    const health = await aiClient.health();
    const provider = health.provider;
    const providerInfo =
      typeof provider === "object" && provider !== null
        ? (provider as Record<string, unknown>)
        : {};
    const model =
      typeof providerInfo.model === "string"
        ? providerInfo.model
        : "unknown";
    const models = Array.isArray(providerInfo.models)
      ? (providerInfo.models as string[])
      : [];
    const ollamaReachable =
      typeof providerInfo.available === "boolean"
        ? providerInfo.available
        : true;
    const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";

    return {
      model,
      ollamaUrl,
      ollamaReachable,
      models,
      aiBackend: "python",
      aiBaseUrl: process.env.AI_BASE_URL ?? "http://localhost:8001",
      pythonAiReachable: true,
      provider,
      status: health.status,
    };
  } catch (e) {
    return {
      model: "unknown",
      ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
      ollamaReachable: false,
      models: [],
      aiBackend: "python",
      aiBaseUrl: process.env.AI_BASE_URL ?? "http://localhost:8001",
      pythonAiReachable: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
});

app.get("/llm/tools", async () => ({
  domain: domain.id,
  tools: domain.tools,
  hint: "POST /llm/tools/invoke com { tool, arguments } para testar tools; POST /llm/chat/agent para fluxo completo.",
}));

const toolInvokeBody = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.any()).optional().default({}),
});

app.post("/llm/tools/invoke", async (req, reply) => {
  const body = toolInvokeBody.parse(req.body);
  const result = await domain.executeTool(body.tool, body.arguments, ctx);
  if (!result.ok) return reply.code(400).send({ error: result.error });
  return { tool: body.tool, result: result.result };
});

const plannerBody = z.object({
  message: z.string().min(1),
  phone: z.string().optional(),
});

app.post("/llm/planner", async (req, reply) => {
  const body = plannerBody.parse(req.body);
  try {
    const plan = await aiClient.plan({
      message: body.message,
      history: [],
      domainId: domain.id,
      sessionId: body.phone ?? "planner-session",
    });
    return { plan };
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({ error: "python_ai_error", detail: e instanceof Error ? e.message : String(e) });
  }
});

async function executePlanSteps(
  steps: Array<{ toolName: string; toolArgs: Record<string, unknown> }>
): Promise<ToolExecutionRecord[]> {
  const toolResults: ToolExecutionRecord[] = [];

  for (const step of steps) {
    try {
      const outcome = await domain.executeTool(step.toolName, step.toolArgs, ctx);
      toolResults.push({
        tool: step.toolName,
        args: step.toolArgs,
        result: outcome.ok ? outcome.result : { error: outcome.error },
      });
    } catch (err) {
      toolResults.push({
        tool: step.toolName,
        args: step.toolArgs,
        result: { error: err instanceof Error ? err.message : "execute_failed" },
      });
    }
  }

  return toolResults;
}

app.post("/llm/chat", async (req, reply) => {
  const body = llmChatBody.parse(req.body);
  try {
    const lastUserMessage = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const sessionId = body.sessionId ?? "web-session";
    const out = await runAgent(domain, lastUserMessage, body.messages, sessionId, ctx);
    return { reply: out };
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({ error: "python_ai_error", detail: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/llm/chat/agent", async (req, reply) => {
  const body = llmChatBody.parse(req.body);
  try {
    const lastUserMessage = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const sessionId = body.sessionId ?? "web-session";

    const plan = await aiClient.plan({
      message: lastUserMessage,
      history: body.messages,
      domainId: domain.id,
      sessionId,
    });

    if (plan.needsClarification || plan.missingFields.length > 0) {
      return { reply: plan.suggestedReply, trace: [], plan };
    }

    const toolResults = await executePlanSteps(
      plan.steps.map((s) => ({ toolName: s.toolName, toolArgs: s.toolArgs }))
    );

    const hasToolError = toolResults.some(
      (entry) =>
        typeof entry.result === "object" &&
        entry.result !== null &&
        "error" in (entry.result as Record<string, unknown>)
    );

    const reflected = await aiClient.reflect({
      plan,
      executeResult: {
        success: !hasToolError,
        result: { toolResults },
        ...(hasToolError ? { error: "tool_execution_failed" } : {}),
      },
    });

    if (!reflected.approved) {
      return {
        reply: "Desculpe, não consegui processar sua solicitação agora. Pode tentar de outro jeito?",
        trace: toolResults,
        plan,
      };
    }

    return { reply: reflected.finalReply, trace: toolResults, plan };
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({ error: "python_ai_error", detail: e instanceof Error ? e.message : String(e) });
  }
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

await wa.start();
await app.listen({ port, host });
console.info(`API http://${host}:${port} — domain: ${domain.id}`);
