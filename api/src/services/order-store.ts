// services/order-store.ts
// Guarda pedidos (orders) em memória. É agnóstico ao catálogo do domínio:
// quem resolve qual item existe e quanto custa é a camada do domínio
// (equivalente a como ScheduleStore não sabe o que é "limpeza" ou "consulta",
// só sabe slots). Aqui só entra item já resolvido: id, nome, preço, quantidade.

export interface OrderInputLine {
  /** Identificador do item no catálogo do domínio (ex: serviceId, sku) */
  itemId: string;
  /** Nome para exibição, já resolvido pelo domínio */
  name: string;
  /** Preço unitário em centavos — evita erro de ponto flutuante com dinheiro */
  unitPriceCents: number;
  quantity: number;
}

export interface OrderLine extends OrderInputLine {
  totalCents: number;
}

export interface Order {
  id: string;
  customerName: string;
  phone: string;
  lines: OrderLine[];
  totalCents: number;
  createdAt: string;
}

export interface CreateOrderInput {
  customerName: string;
  phone: string;
  lines: OrderInputLine[];
}

export type CreateOrderResult = Order | { error: "empty_order" | "invalid_line" };

export class OrderStore {
  private readonly ordersById = new Map<string, Order>();

  createOrder(input: CreateOrderInput): CreateOrderResult {
    if (!input.lines.length) {
      return { error: "empty_order" };
    }

    const lines: OrderLine[] = [];
    for (const line of input.lines) {
      if (!line.itemId || line.quantity <= 0 || line.unitPriceCents < 0) {
        return { error: "invalid_line" };
      }
      lines.push({
        ...line,
        totalCents: line.unitPriceCents * line.quantity,
      });
    }

    const totalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);

    const order: Order = {
      id: this.generateOrderId(),
      customerName: input.customerName,
      phone: input.phone,
      lines,
      totalCents,
      createdAt: new Date().toISOString(),
    };

    this.ordersById.set(order.id, order);
    return order;
  }

  getOrder(id: string): Order | undefined {
    return this.ordersById.get(id);
  }

  listOrders(): Order[] {
    return Array.from(this.ordersById.values());
  }

  listOrdersByPhone(phone: string): Order[] {
    return this.listOrders().filter((o) => o.phone === phone);
  }

  private generateOrderId(): string {
    return `ord_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Formata centavos para exibição em reais, ex: 12345 -> "R$ 123,45" */
export function formatCentsBr(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}