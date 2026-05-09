export type SlotRow = {
  id: string;
  startsAt: string;
  endsAt: string;
  available: boolean;
};

export type Booking = {
  id: string;
  slotId: string;
  startsAt: string;
  customerName: string;
  phone: string;
  createdAt: string;
};

const base = "";

export async function fetchSlots(date: string): Promise<SlotRow[]> {
  const r = await fetch(`${base}/slots?date=${encodeURIComponent(date)}`);
  if (!r.ok) throw new Error("Falha ao carregar horários");
  const j = (await r.json()) as { slots: SlotRow[] };
  return j.slots;
}

export async function createBooking(input: {
  slotId: string;
  customerName: string;
  phone: string;
}): Promise<Booking> {
  const r = await fetch(`${base}/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Falha ao agendar");
  }
  return r.json() as Promise<Booking>;
}

export async function listBookings(): Promise<Booking[]> {
  const r = await fetch(`${base}/bookings`);
  if (!r.ok) throw new Error("Falha ao listar");
  return r.json() as Promise<Booking[]>;
}

export async function cancelBooking(id: string): Promise<void> {
  const r = await fetch(`${base}/bookings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error("Falha ao cancelar");
}

export type MenuPayload = {
  currency: string;
  pizzas: {
    sizes: { id: string; label: string; priceReais: number }[];
    flavors: { id: string; name: string }[];
  };
  drinks: { id: string; name: string; volumeLabel: string; priceReais: number }[];
};

export type OrderLine = {
  kind: "pizza";
  flavorId: string;
  flavorName: string;
  size: string;
  sizeLabel: string;
  unitPriceReais: number;
} | {
  kind: "drink";
  drinkId: string;
  name: string;
  volumeLabel: string;
  unitPriceReais: number;
};

export type Order = {
  id: string;
  customerName: string;
  phone: string;
  lines: OrderLine[];
  totalReais: number;
  createdAt: string;
};

export type CartItem =
  | { kind: "pizza"; flavorId: string; size: "medio" | "grande" }
  | { kind: "drink"; drinkId: "refri-600" | "refri-2l" };

export async function fetchMenu(): Promise<MenuPayload> {
  const r = await fetch(`${base}/menu`);
  if (!r.ok) throw new Error("Falha ao carregar cardápio");
  return r.json() as Promise<MenuPayload>;
}

export async function createOrder(input: {
  customerName: string;
  phone: string;
  items: CartItem[];
}): Promise<Order> {
  const r = await fetch(`${base}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Falha no pedido");
  }
  return r.json() as Promise<Order>;
}

export async function listOrders(): Promise<Order[]> {
  const r = await fetch(`${base}/orders`);
  if (!r.ok) throw new Error("Falha ao listar pedidos");
  return r.json() as Promise<Order[]>;
}

export type LlmStatus = {
  model: string;
  ollamaUrl: string;
  ollamaReachable: boolean;
  models: string[];
};

export async function fetchLlmStatus(): Promise<LlmStatus> {
  const r = await fetch(`${base}/llm/status`);
  if (!r.ok) throw new Error("Falha ao ler status do LLM");
  return r.json() as Promise<LlmStatus>;
}

export async function fetchLlmChat(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<{ reply: string }> {
  const r = await fetch(`${base}/llm/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    throw new Error(err.detail ?? err.error ?? "Falha no chat");
  }
  return r.json() as Promise<{ reply: string }>;
}

export type LlmAgentTrace = Array<{ tool: string; ok: boolean }>;

export async function fetchLlmChatAgent(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<{ reply: string; trace?: LlmAgentTrace }> {
  const r = await fetch(`${base}/llm/chat/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    throw new Error(err.detail ?? err.error ?? "Falha no agente");
  }
  return r.json() as Promise<{ reply: string; trace?: LlmAgentTrace }>;
}
