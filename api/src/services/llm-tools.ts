import type { ScheduleStore } from "./schedule-store.js";
import type { OrderStore, OrderInputLine } from "./order-store.js";
import { menuPayloadForApi, type PizzaSizeId } from "./pizzeria-catalog.js";

/** Contrato único para o executor + documentação do GET /llm/tools */
export type ToolContext = {
  schedule: ScheduleStore;
  orders: OrderStore;
};

/** Formato aceito pelo Ollama em `tools` no /api/chat */
export type OllamaToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export const LLM_TOOLS: OllamaToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_menu",
      description:
        "Retorna o cardápio da pizzaria: sabores, tamanhos (medio/grande), preços e refrigerantes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_available_slots",
      description:
        "Lista horários livres para retirada/entrega numa data (YYYY-MM-DD). Horários à noite no fuso America/Sao_Paulo.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Data no formato YYYY-MM-DD",
          },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description:
        "Cria um agendamento de retirada/entrega. Use slot_id retornado por list_available_slots.",
      parameters: {
        type: "object",
        properties: {
          slot_id: { type: "string" },
          customer_name: { type: "string" },
          phone: { type: "string", description: "Telefone com DDI se possível, só dígitos ok" },
        },
        required: ["slot_id", "customer_name", "phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_bookings_for_phone",
      description: "Lista agendamentos associados ao telefone informado.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string" },
        },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_booking",
      description: "Cancela um agendamento pelo id; exige o mesmo telefone do cliente.",
      parameters: {
        type: "object",
        properties: {
          booking_id: { type: "string" },
          phone: { type: "string" },
        },
        required: ["booking_id", "phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_order",
      description:
        "Registra um pedido de pizza/bebida. flavor_id: calabresa, tres-queijos, margherita, portuguesa, frango-catupiry. size: medio ou grande. drink_id: refri-600 ou refri-2l.",
      parameters: {
        type: "object",
        properties: {
          customer_name: { type: "string" },
          phone: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["pizza", "drink"] },
                flavor_id: { type: "string" },
                size: { type: "string", enum: ["medio", "grande"] },
                drink_id: { type: "string" },
              },
              required: ["kind"],
            },
          },
        },
        required: ["customer_name", "phone", "items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_orders_for_phone",
      description: "Lista pedidos recentes do telefone informado.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string" },
        },
        required: ["phone"],
      },
    },
  },
];

function normPhone(p: string): string {
  return p.replace(/\D/g, "") || p.trim();
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function executeLlmTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const args =
    typeof rawArgs === "string"
      ? (() => {
          try {
            return JSON.parse(rawArgs) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : rawArgs && typeof rawArgs === "object"
        ? (rawArgs as Record<string, unknown>)
        : {};

  try {
    switch (name) {
      case "get_menu":
        return { ok: true, result: menuPayloadForApi() };

      case "list_available_slots": {
        const date = asStr(args.date);
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return { ok: false, error: "invalid_date" };
        }
        const slots = ctx.schedule.getSlotsForDay(date);
        const taken = ctx.schedule.getBookedSlotIds();
        return {
          ok: true,
          result: {
            date,
            slots: slots.map((s) => ({
              id: s.id,
              starts_at: s.startsAt,
              ends_at: s.endsAt,
              available: !taken.has(s.id),
            })),
          },
        };
      }

      case "create_booking": {
        const slotId = asStr(args.slot_id);
        const customerName = asStr(args.customer_name);
        const phone = args.phone != null ? normPhone(String(args.phone)) : "";
        if (!slotId || !customerName || !phone) {
          return { ok: false, error: "missing_fields" };
        }
        const slots = ctx.schedule.getSlotsForDay(slotId.slice(0, 10));
        const slot = slots.find((s) => s.id === slotId);
        if (!slot) return { ok: false, error: "invalid_slot" };
        const res = ctx.schedule.createBooking({
          slotId: slot.id,
          startsAt: slot.startsAt,
          customerName,
          phone,
        });
        if ("error" in res) return { ok: false, error: res.error };
        return {
          ok: true,
          result: {
            booking_id: res.id,
            slot_id: res.slotId,
            starts_at: res.startsAt,
            customer_name: res.customerName,
          },
        };
      }

      case "list_bookings_for_phone": {
        const phone = args.phone != null ? normPhone(String(args.phone)) : "";
        if (!phone) return { ok: false, error: "missing_phone" };
        const list = ctx.schedule
          .listBookings()
          .filter((b) => b.phone === phone)
          .map((b) => ({
            booking_id: b.id,
            slot_id: b.slotId,
            starts_at: b.startsAt,
            customer_name: b.customerName,
          }));
        return { ok: true, result: { bookings: list } };
      }

      case "cancel_booking": {
        const bookingId = asStr(args.booking_id);
        const phone = args.phone != null ? normPhone(String(args.phone)) : "";
        if (!bookingId || !phone) return { ok: false, error: "missing_fields" };
        const b = ctx.schedule.listBookings().find((x) => x.id === bookingId);
        if (!b || b.phone !== phone) return { ok: false, error: "not_found_or_phone" };
        ctx.schedule.cancelBooking(bookingId);
        return { ok: true, result: { cancelled: bookingId } };
      }

      case "create_order": {
        const customerName = asStr(args.customer_name);
        const phone = args.phone != null ? normPhone(String(args.phone)) : "";
        const itemsRaw = args.items;
        if (!customerName || !phone || !Array.isArray(itemsRaw)) {
          return { ok: false, error: "missing_fields" };
        }
        const items: OrderInputLine[] = [];
        for (const it of itemsRaw) {
          if (!it || typeof it !== "object") continue;
          const o = it as Record<string, unknown>;
          const kind = o.kind;
          if (kind === "pizza") {
            const flavorId = asStr(o.flavor_id);
            const size = asStr(o.size) as PizzaSizeId | undefined;
            if (!flavorId || (size !== "medio" && size !== "grande")) {
              return { ok: false, error: "invalid_pizza_line" };
            }
            items.push({ kind: "pizza", flavorId, size });
          } else if (kind === "drink") {
            const drinkId = asStr(o.drink_id);
            if (drinkId !== "refri-600" && drinkId !== "refri-2l") {
              return { ok: false, error: "invalid_drink_line" };
            }
            items.push({ kind: "drink", drinkId });
          }
        }
        const res = ctx.orders.createOrder({ customerName, phone, items });
        if ("error" in res) return { ok: false, error: res.error };
        return {
          ok: true,
          result: {
            order_id: res.id,
            total_reais: res.totalReais,
            lines: res.lines,
          },
        };
      }

      case "list_orders_for_phone": {
        const phone = args.phone != null ? normPhone(String(args.phone)) : "";
        if (!phone) return { ok: false, error: "missing_phone" };
        const list = ctx.orders.listOrdersByPhone(phone).map((o) => ({
          order_id: o.id,
          total_reais: o.totalReais,
          created_at: o.createdAt,
          lines: o.lines,
        }));
        return { ok: true, result: { orders: list } };
      }

      default:
        return { ok: false, error: `unknown_tool:${name}` };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "execute_failed",
    };
  }
}
