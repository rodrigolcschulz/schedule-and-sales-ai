/**
 * Única fonte de preços do demo (pizza, bebida).
 * GET /menu, WhatsApp `cardapio`, README e o front usam estes valores (via API ou cópia no README).
 * Referência: faixa típica de delivery em cidade média do Sul (ex.: Blumenau/SC); não é cotação de mercado.
 */

export type PizzaSizeId = "medio" | "grande";

export type PizzaFlavor = {
  id: string;
  name: string;
  /** Texto sem acento, minúsculo, para match no WhatsApp */
  keywords: string[];
};

export type Drink = {
  id: string;
  name: string;
  volumeLabel: string;
  priceReais: number;
  keywords: string[];
};

export const PIZZA_SIZES: Record<
  PizzaSizeId,
  { label: string; priceReais: number }
> = {
  medio: { label: "Médio", priceReais: 60 },
  grande: { label: "Grande", priceReais: 80 },
};

export const PIZZA_FLAVORS: PizzaFlavor[] = [
  { id: "calabresa", name: "Calabresa", keywords: ["calabresa"] },
  {
    id: "tres-queijos",
    name: "3 Queijos",
    keywords: ["3 queijos", "tres queijos", "três queijos", "3queijos"],
  },
  { id: "margherita", name: "Margherita", keywords: ["margherita", "marguerita"] },
  {
    id: "portuguesa",
    name: "Portuguesa",
    keywords: ["portuguesa"],
  },
  {
    id: "frango-catupiry",
    name: "Frango com catupiry",
    keywords: ["frango", "frango catupiry"],
  },
];

export const DRINKS: Drink[] = [
  {
    id: "refri-600",
    name: "Refrigerante",
    volumeLabel: "600 ml",
    priceReais: 10,
    keywords: ["600", "600ml", "600 ml", "lata"],
  },
  {
    id: "refri-2l",
    name: "Refrigerante",
    volumeLabel: "2 L",
    priceReais: 16,
    keywords: ["2l", "2 l", "2lt", "garrafa", "2 litros"],
  },
];

export type OrderLinePizza = {
  kind: "pizza";
  flavorId: string;
  flavorName: string;
  size: PizzaSizeId;
  sizeLabel: string;
  unitPriceReais: number;
};

export type OrderLineDrink = {
  kind: "drink";
  drinkId: string;
  name: string;
  volumeLabel: string;
  unitPriceReais: number;
};

export type OrderLine = OrderLinePizza | OrderLineDrink;

export function flavorById(id: string): PizzaFlavor | undefined {
  return PIZZA_FLAVORS.find((f) => f.id === id);
}

export function drinkById(id: string): Drink | undefined {
  return DRINKS.find((d) => d.id === id);
}

export function normalizeToken(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function resolveFlavorIdFromText(text: string): string | undefined {
  const n = normalizeToken(text);
  for (const f of PIZZA_FLAVORS) {
    if (n.includes(f.id.replace(/-/g, " ")) || n.includes(f.id.replace(/-/g, ""))) {
      return f.id;
    }
    for (const k of f.keywords) {
      const kn = normalizeToken(k);
      if (n.includes(kn)) return f.id;
    }
  }
  return undefined;
}

export function resolvePizzaSize(text: string): PizzaSizeId | undefined {
  const n = normalizeToken(text);
  if (/\bmedio\b|\bmédio\b/.test(n)) return "medio";
  if (/\bgrande\b/.test(n)) return "grande";
  return undefined;
}

export function resolveDrinkIdFromText(text: string): string | undefined {
  const n = normalizeToken(text);
  if (/\brefri|refrigerante|bebida|guarana|cola|coca\b/.test(n)) {
    if (/\b2\s*l\b|\b2l\b|\b2\s*litros\b|\bgarrafa\b/.test(n)) return "refri-2l";
    if (/\b600\b|\blata\b/.test(n)) return "refri-600";
    /** Se disse só “refri”, assume 600 ml no WhatsApp; no front o usuário escolhe explícito */
    return "refri-600";
  }
  return undefined;
}

export function lineFromPizza(flavorId: string, size: PizzaSizeId): OrderLinePizza | undefined {
  const flavor = flavorById(flavorId);
  if (!flavor) return undefined;
  const sz = PIZZA_SIZES[size];
  return {
    kind: "pizza",
    flavorId: flavor.id,
    flavorName: flavor.name,
    size,
    sizeLabel: sz.label,
    unitPriceReais: sz.priceReais,
  };
}

export function lineFromDrink(drinkId: string): OrderLineDrink | undefined {
  const d = drinkById(drinkId);
  if (!d) return undefined;
  return {
    kind: "drink",
    drinkId: d.id,
    name: d.name,
    volumeLabel: d.volumeLabel,
    unitPriceReais: d.priceReais,
  };
}

export function totalReais(lines: OrderLine[]): number {
  return lines.reduce((s, l) => s + l.unitPriceReais, 0);
}

export function menuPayloadForApi() {
  return {
    currency: "BRL",
    pizzas: {
      sizes: Object.entries(PIZZA_SIZES).map(([id, v]) => ({
        id,
        label: v.label,
        priceReais: v.priceReais,
      })),
      flavors: PIZZA_FLAVORS.map((f) => ({ id: f.id, name: f.name })),
    },
    drinks: DRINKS.map((d) => ({
      id: d.id,
      name: d.name,
      volumeLabel: d.volumeLabel,
      priceReais: d.priceReais,
    })),
  };
}

export function formatMenuWhatsApp(): string {
  const lines: string[] = ["🍕 Cardápio demo", ""];
  lines.push("Pizzas (tamanho + preço):");
  for (const sz of ["medio", "grande"] as PizzaSizeId[]) {
    const s = PIZZA_SIZES[sz];
    lines.push(`• ${s.label}: R$ ${s.priceReais}`);
  }
  lines.push("Sabores: " + PIZZA_FLAVORS.map((f) => f.name).join(", "));
  lines.push("");
  lines.push("Bebidas:");
  for (const d of DRINKS) {
    lines.push(`• ${d.name} ${d.volumeLabel}: R$ ${d.priceReais}`);
  }
  lines.push("");
  lines.push('Pedir por aqui: "pedir calabresa grande" ou "pedir refri 2l"');
  lines.push('Vários itens: "pedir calabresa medio + refri 600"');
  return lines.join("\n");
}
