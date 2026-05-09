import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { ScheduleStore } from "./services/schedule-store.js";
import { OrderStore } from "./services/order-store.js";
import { menuPayloadForApi } from "./services/pizzeria-catalog.js";
import { createWhatsAppProvider, type WhatsAppProviderKind } from "./whatsapp/factory.js";
import type { StubWhatsAppProvider } from "./whatsapp/stub-provider.js";
import { attachDemoWhatsAppBot } from "./services/whatsapp-bot.js";
import {
  getOllamaBaseUrl,
  getOllamaModel,
  ollamaChat,
  ollamaTags,
} from "./services/ollama-chat.js";
import { executeLlmTool, LLM_TOOLS } from "./services/llm-tools.js";
import { runLlmToolAgent } from "./services/llm-agent.js";

const store = new ScheduleStore();
const orders = new OrderStore();

function envProviderKind(): WhatsAppProviderKind {
  const v = (process.env.WHATSAPP_PROVIDER ?? "stub").toLowerCase();
  if (v === "baileys") return "baileys";
  return "stub";
}

const wa = createWhatsAppProvider(envProviderKind());
attachDemoWhatsAppBot(wa, { schedule: store, orders }, { sendWelcomeOnAny: true });

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

app.get("/health", async () => ({ ok: true }));

app.get("/menu", async () => menuPayloadForApi());

const orderItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pizza"),
    flavorId: z.string().min(1),
    size: z.enum(["medio", "grande"]),
  }),
  z.object({
    kind: z.literal("drink"),
    drinkId: z.enum(["refri-600", "refri-2l"]),
  }),
]);

const createOrderBody = z.object({
  customerName: z.string().min(1),
  phone: z.string().min(3),
  items: z.array(orderItemSchema).min(1),
});

app.post("/orders", async (req, reply) => {
  const body = createOrderBody.parse(req.body);
  const res = orders.createOrder({
    customerName: body.customerName,
    phone: body.phone,
    items: body.items,
  });
  if ("error" in res) {
    return reply.code(400).send({ error: res.error });
  }
  return res;
});

app.get("/orders", async () => orders.listOrders());

app.get("/slots", async (req) => {
  const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
  const slots = store.getSlotsForDay(q.date);
  const taken = store.getBookedSlotIds();
  return {
    date: q.date,
    slots: slots.map((s) => ({
      ...s,
      available: !taken.has(s.id),
    })),
  };
});

const createBody = z.object({
  slotId: z.string(),
  customerName: z.string().min(1),
  phone: z.string().min(3),
});

app.post("/bookings", async (req, reply) => {
  const body = createBody.parse(req.body);
  const slots = store.getSlotsForDay(body.slotId.slice(0, 10));
  const slot = slots.find((s) => s.id === body.slotId);
  if (!slot) {
    return reply.code(400).send({ error: "invalid_slot" });
  }
  const res = store.createBooking({
    slotId: slot.id,
    startsAt: slot.startsAt,
    customerName: body.customerName,
    phone: body.phone.replace(/\D/g, "") || body.phone,
  });
  if ("error" in res) {
    return reply.code(409).send({ error: res.error });
  }
  return res;
});

app.get("/bookings", async () => store.listBookings());

app.delete<{ Params: { id: string } }>("/bookings/:id", async (req, reply) => {
  const ok = store.cancelBooking(req.params.id);
  if (!ok) return reply.code(404).send({ error: "not_found" });
  return { ok: true };
});

const simulateBody = z.object({
  from: z.string().min(3),
  text: z.string().min(1),
});

app.post("/integrations/whatsapp/simulate-inbound", async (req, reply) => {
  if (wa.name !== "stub") {
    return reply.code(400).send({ error: "only_stub" });
  }
  const body = simulateBody.parse(req.body);
  (wa as StubWhatsAppProvider).simulateInbound({
    from: body.from,
    text: body.text,
  });
  return { ok: true };
});

app.post("/integrations/whatsapp/webhook", async (req) => {
  /** Placeholder para Cloud API / provedores que postam JSON. */
  req.log.info({ body: req.body }, "whatsapp webhook (não processado no MVP)");
  return { ok: true };
});

const llmSystemPrompt =
  process.env.LLM_SYSTEM_PROMPT ??
  "Você é um assistente útil para uma pizzaria em demonstração. Responda em português do Brasil, de forma objetiva e cordial.";

const llmChatBody = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      })
    )
    .min(1),
});

app.get("/llm/status", async () => {
  const tags = await ollamaTags();
  return {
    model: getOllamaModel(),
    ollamaUrl: getOllamaBaseUrl(),
    ollamaReachable: tags.ok,
    models: tags.names,
  };
});

app.post("/llm/chat", async (req, reply) => {
  const body = llmChatBody.parse(req.body);
  try {
    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [{ role: "system", content: llmSystemPrompt }, ...body.messages];
    const text = await ollamaChat(messages);
    return { reply: text };
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({
      error: "ollama_error",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/llm/tools", async () => ({
  tools: LLM_TOOLS,
  hint: "POST /llm/tools/invoke com { tool, arguments } para testar sem LLM; POST /llm/chat/agent para agente com Ollama.",
}));

const toolInvokeBody = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.any()).optional().default({}),
});

app.post("/llm/tools/invoke", async (req, reply) => {
  const body = toolInvokeBody.parse(req.body);
  const result = await executeLlmTool(body.tool, body.arguments, {
    schedule: store,
    orders,
  });
  if (!result.ok) {
    return reply.code(400).send({ error: result.error });
  }
  return { tool: body.tool, result: result.result };
});

app.post("/llm/chat/agent", async (req, reply) => {
  const body = llmChatBody.parse(req.body);
  try {
    const out = await runLlmToolAgent(body.messages, {
      schedule: store,
      orders,
    });
    return { reply: out.reply, trace: out.trace };
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({
      error: "ollama_agent_error",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

await wa.start();
await app.listen({ port, host });
console.info(`API http://${host}:${port}`);
