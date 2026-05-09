import { randomUUID } from "node:crypto";
import type { OrderLine } from "./pizzeria-catalog.js";
import {
  drinkById,
  flavorById,
  lineFromDrink,
  lineFromPizza,
  totalReais,
  type PizzaSizeId,
} from "./pizzeria-catalog.js";

export type Order = {
  id: string;
  customerName: string;
  phone: string;
  lines: OrderLine[];
  totalReais: number;
  createdAt: string;
};

export type OrderInputLine =
  | { kind: "pizza"; flavorId: string; size: PizzaSizeId }
  | { kind: "drink"; drinkId: string };

export class OrderStore {
  private orders = new Map<string, Order>();

  createOrder(input: {
    customerName: string;
    phone: string;
    items: OrderInputLine[];
  }): Order | { error: string } {
    if (input.items.length === 0) return { error: "empty_order" };

    const lines: OrderLine[] = [];
    for (const it of input.items) {
      if (it.kind === "pizza") {
        if (!flavorById(it.flavorId)) return { error: "invalid_flavor" };
        const pl = lineFromPizza(it.flavorId, it.size);
        if (!pl) return { error: "invalid_pizza" };
        lines.push(pl);
      } else {
        if (!drinkById(it.drinkId)) return { error: "invalid_drink" };
        lines.push(lineFromDrink(it.drinkId)!);
      }
    }

    const order: Order = {
      id: randomUUID(),
      customerName: input.customerName.trim(),
      phone: input.phone.replace(/\D/g, "") || input.phone.trim(),
      lines,
      totalReais: totalReais(lines),
      createdAt: new Date().toISOString(),
    };
    this.orders.set(order.id, order);
    return order;
  }

  listOrders(): Order[] {
    return [...this.orders.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  listOrdersByPhone(phone: string): Order[] {
    const p = phone.replace(/\D/g, "") || phone;
    return this.listOrders().filter((o) => o.phone === p);
  }
}
