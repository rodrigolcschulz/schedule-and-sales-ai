import type { ScheduleStore } from "./schedule-store.js";
import type { OrderStore } from "./order-store.js";
import type { IncomingWhatsAppMessage, WhatsAppProvider } from "../whatsapp/types.js";
import {
  formatMenuWhatsApp,
  resolveDrinkIdFromText,
  resolveFlavorIdFromText,
  resolvePizzaSize,
} from "./pizzeria-catalog.js";
import { formatSlotTimeBr } from "./schedule-store.js";

const HELP = [
  "Comandos:",
  "ajuda — esta mensagem",
  "",
  "Agenda:",
  "horarios YYYY-MM-DD — slots livres (noite, horário de Brasília)",
  "agendar YYYY-MM-DD HH nome — HH entre 18 e 22 (ex: agendar 2026-05-10 20 Maria)",
  "meus — seus agendamentos",
  "cancelar ID — cancela agendamento",
  "",
  "Pizzaria (demo):",
  "cardapio — preços e sabores",
  "pedir SABOR TAMANHO — ex: pedir calabresa grande",
  "pedir refri 600 | pedir refri 2l",
  "vários: pedir calabresa medio + refri 2l",
  "meus pedidos — seus pedidos deste número",
].join("\n");

function parseYmdHour(line: string): { date: string; hour: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2})\b/.exec(line);
  if (!m) return null;
  const hour = m[2].padStart(2, "0");
  return { date: m[1], hour };
}

function slotIdFor(date: string, hour: string): string {
  return `${date}_${hour}00`;
}

function parseOrderSegmentsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const prefix = lower.startsWith("pedir ") ? "pedir " : lower.startsWith("pedido ") ? "pedido " : null;
  if (!prefix) return [];
  const payload = text.slice(prefix.length).trim();
  return payload
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
}

function tryParseOrderLine(segment: string):
  | { kind: "pizza"; flavorId: string; size: "medio" | "grande" }
  | { kind: "drink"; drinkId: string }
  | undefined {
  const drinkId = resolveDrinkIdFromText(segment);
  const flavorId = resolveFlavorIdFromText(segment);
  const size = resolvePizzaSize(segment);
  const mentionsDrink = /\brefri|refrigerante|600\b|\b2\s*l\b|\b2l\b|\blata\b|\bgarrafa\b/i.test(
    segment
  );

  if (drinkId && (mentionsDrink || !flavorId)) {
    return { kind: "drink", drinkId };
  }
  if (flavorId && size) {
    return { kind: "pizza", flavorId, size };
  }
  return undefined;
}

export type DemoBotStores = {
  schedule: ScheduleStore;
  orders: OrderStore;
};

/**
 * Agenda + pizzaria demo num único handler (um onMessage no provider).
 */
export function attachDemoWhatsAppBot(
  wa: WhatsAppProvider,
  stores: DemoBotStores,
  opts: { sendWelcomeOnAny?: boolean } = {}
): void {
  wa.onMessage(async (msg: IncomingWhatsAppMessage) => {
    const from = msg.from.replace(/\D/g, "") || msg.from;
    const text = msg.text.trim();
    const lower = text.toLowerCase();

    if (!text) return;

    if (lower === "ajuda" || lower === "help") {
      await wa.sendText(from, HELP);
      return;
    }

    if (lower === "cardapio" || lower === "cardápio" || lower === "menu") {
      await wa.sendText(from, formatMenuWhatsApp());
      return;
    }

    if (lower.startsWith("pedir ") || lower.startsWith("pedido ")) {
      const segments = parseOrderSegmentsFromText(text);
      if (segments.length === 0) {
        await wa.sendText(
          from,
          'Exemplo: pedir calabresa grande\nOu: pedir 3 queijos medio + refri 2l'
        );
        return;
      }
      const items: Array<
        | { kind: "pizza"; flavorId: string; size: "medio" | "grande" }
        | { kind: "drink"; drinkId: string }
      > = [];
      for (const seg of segments) {
        const line = tryParseOrderLine(seg);
        if (!line) {
          await wa.sendText(
            from,
            `Não entendi o item: "${seg}". Envie cardapio e use SABOR + medio ou grande, ou refri 600 / refri 2l.`
          );
          return;
        }
        items.push(line);
      }
      const res = stores.orders.createOrder({
        customerName: `Cliente ${from}`,
        phone: from,
        items,
      });
      if ("error" in res) {
        await wa.sendText(from, "Não foi possível montar o pedido. Verifique sabores e tamanhos.");
        return;
      }
      const desc = res.lines
        .map((l) =>
          l.kind === "pizza"
            ? `${l.flavorName} (${l.sizeLabel})`
            : `${l.name} ${l.volumeLabel}`
        )
        .join(", ");
      await wa.sendText(
        from,
        `Pedido ${res.id.slice(0, 8)}… — R$ ${res.totalReais}\n${desc}\n(Obrigado! Demo sem pagamento.)`
      );
      return;
    }

    if (lower === "meus pedidos" || lower === "meuspedidos") {
      const mine = stores.orders.listOrdersByPhone(from);
      if (mine.length === 0) {
        await wa.sendText(from, "Nenhum pedido deste número ainda.");
        return;
      }
      const lines = mine.slice(0, 5).map((o) => `• ${o.id.slice(0, 8)}… R$ ${o.totalReais}`);
      await wa.sendText(from, lines.join("\n"));
      return;
    }

    if (lower.startsWith("horarios ")) {
      const date = text.slice("horarios ".length).trim();
      const slots = stores.schedule.getSlotsForDay(date);
      const taken = stores.schedule.getBookedSlotIds();
      const free = slots.filter((s) => !taken.has(s.id));
      if (free.length === 0) {
        await wa.sendText(from, `Sem horários livres em ${date} (ou data inválida).`);
        return;
      }
      const lines = free.map((s) => {
        const t = formatSlotTimeBr(s.startsAt);
        return `• ${t} (${s.id})`;
      });
      await wa.sendText(
        from,
        `Horários livres ${date} (Brasília):\n${lines.join("\n")}`
      );
      return;
    }

    if (lower.startsWith("agendar ")) {
      const rest = text.slice("agendar ".length).trim();
      const parsed = parseYmdHour(rest);
      if (!parsed) {
        await wa.sendText(from, "Formato: agendar YYYY-MM-DD HH Nome");
        return;
      }
      const nameMatch = rest.replace(/^\d{4}-\d{2}-\d{2}\s+\d{1,2}\s+/, "").trim();
      if (!nameMatch) {
        await wa.sendText(from, "Informe o nome após hora: agendar 2026-05-10 20 João");
        return;
      }
      const slotId = slotIdFor(parsed.date, parsed.hour);
      const slots = stores.schedule.getSlotsForDay(parsed.date);
      const slot = slots.find((s) => s.id === slotId);
      if (!slot) {
        await wa.sendText(from, "Horário inválido para este dia.");
        return;
      }
      const res = stores.schedule.createBooking({
        slotId: slot.id,
        startsAt: slot.startsAt,
        customerName: nameMatch,
        phone: from,
      });
      if ("error" in res) {
        await wa.sendText(from, "Esse horário já está ocupado.");
        return;
      }
      await wa.sendText(
        from,
        `Agendado: ${res.startsAt} — ${res.customerName}. ID: ${res.id}`
      );
      return;
    }

    if (lower === "meus" || lower === "meus agendamentos") {
      const mine = stores.schedule.listBookings().filter((b) => b.phone === from);
      if (mine.length === 0) {
        await wa.sendText(from, "Nenhum agendamento para este número.");
        return;
      }
      const lines = mine.map(
        (b) => `• ${b.id} | ${b.startsAt} | ${b.customerName}`
      );
      await wa.sendText(from, lines.join("\n"));
      return;
    }

    if (lower.startsWith("cancelar ")) {
      const id = text.slice("cancelar ".length).trim();
      const booking = stores.schedule.listBookings().find((b) => b.id === id);
      if (!booking || booking.phone !== from) {
        await wa.sendText(from, "Agendamento não encontrado para este número.");
        return;
      }
      stores.schedule.cancelBooking(id);
      await wa.sendText(from, `Cancelado: ${id}`);
      return;
    }

    if (opts.sendWelcomeOnAny) {
      await wa.sendText(from, `Olá! Envie "ajuda" para ver comandos.\n\n${HELP}`);
    }
  });
}
