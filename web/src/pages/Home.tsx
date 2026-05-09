import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelBooking,
  createBooking,
  createOrder,
  fetchMenu,
  fetchSlots,
  listBookings,
  listOrders,
  type Booking,
  type CartItem,
  type MenuPayload,
  type Order,
  type SlotRow,
} from "../api";
import { formatBookingWhenBr, formatSlotTimeBr, SCHEDULE_HINT } from "../schedule";

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cartLineLabel(menu: MenuPayload | null, item: CartItem): string {
  if (!menu) return item.kind;
  if (item.kind === "drink") {
    const dr = menu.drinks.find((x) => x.id === item.drinkId);
    return dr ? `${dr.name} ${dr.volumeLabel}` : item.drinkId;
  }
  const f = menu.pizzas.flavors.find((x) => x.id === item.flavorId);
  const s = menu.pizzas.sizes.find((x) => x.id === item.size);
  const name = f?.name ?? item.flavorId;
  const sz = s?.label ?? item.size;
  const price = s?.priceReais ?? 0;
  return `${name} (${sz}) — R$ ${price}`;
}

function cartItemPrice(menu: MenuPayload | null, item: CartItem): number {
  if (!menu) return 0;
  if (item.kind === "drink") {
    return menu.drinks.find((d) => d.id === item.drinkId)?.priceReais ?? 0;
  }
  return menu.pizzas.sizes.find((s) => s.id === item.size)?.priceReais ?? 0;
}

function menuPriceBlurb(menu: MenuPayload | null): string {
  if (!menu) return "Carregando preços do servidor…";
  const pizza = menu.pizzas.sizes
    .map((s) => `${s.label} R$ ${s.priceReais}`)
    .join(" · ");
  const drinks = menu.drinks
    .map((d) => `${d.volumeLabel} R$ ${d.priceReais}`)
    .join(" · ");
  return `Pizzas: ${pizza}. Refrigerantes: ${drinks}. Referência cidade média Sul (demo).`;
}

export function Home() {
  const [date, setDate] = useState(todayYmd);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [menu, setMenu] = useState<MenuPayload | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pizzaFlavor, setPizzaFlavor] = useState("");
  const [pizzaSize, setPizzaSize] = useState<"medio" | "grande">("medio");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadSlots = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      setSlots(await fetchSlots(date));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }, [date]);

  const loadBookings = useCallback(async () => {
    try {
      setBookings(await listBookings());
    } catch {
      /* silencioso no MVP */
    }
  }, []);

  const loadMenu = useCallback(async () => {
    try {
      const m = await fetchMenu();
      setMenu(m);
    } catch {
      /* silencioso */
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      setOrders(await listOrders());
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    void loadMenu();
  }, [loadMenu]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (menu?.pizzas.flavors.length && !pizzaFlavor) {
      setPizzaFlavor(menu.pizzas.flavors[0].id);
    }
  }, [menu, pizzaFlavor]);

  const freeSlots = useMemo(() => slots.filter((s) => s.available), [slots]);

  const cartTotal = useMemo(
    () => cart.reduce((s, it) => s + cartItemPrice(menu, it), 0),
    [cart, menu]
  );

  async function onBook(slot: SlotRow) {
    setMsg(null);
    if (!name.trim() || !phone.trim()) {
      setMsg("Preencha nome e telefone.");
      return;
    }
    setLoading(true);
    try {
      await createBooking({
        slotId: slot.id,
        customerName: name.trim(),
        phone: phone.trim(),
      });
      await loadSlots();
      await loadBookings();
      setMsg("Agendamento criado.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erro ao agendar");
    } finally {
      setLoading(false);
    }
  }

  async function onCancel(id: string) {
    setLoading(true);
    setMsg(null);
    try {
      await cancelBooking(id);
      await loadSlots();
      await loadBookings();
      setMsg("Cancelado.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  function addPizzaToCart() {
    if (!pizzaFlavor) return;
    setCart((c) => [...c, { kind: "pizza", flavorId: pizzaFlavor, size: pizzaSize }]);
  }

  function addDrinkToCart(id: "refri-600" | "refri-2l") {
    setCart((c) => [...c, { kind: "drink", drinkId: id }]);
  }

  function removeCart(i: number) {
    setCart((c) => c.filter((_, idx) => idx !== i));
  }

  async function submitOrder() {
    setMsg(null);
    if (!name.trim() || !phone.trim()) {
      setMsg("Preencha nome e telefone para o pedido.");
      return;
    }
    if (cart.length === 0) {
      setMsg("Adicione itens ao pedido.");
      return;
    }
    setLoading(true);
    try {
      await createOrder({
        customerName: name.trim(),
        phone: phone.trim(),
        items: cart,
      });
      setCart([]);
      await loadOrders();
      setMsg("Pedido enviado! (demo — sem pagamento)");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erro no pedido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="header">
        <h1>Agendamento e vendas (pizzaria)</h1>
        <p className="muted">
          Demo: reservar horário de retirada/entrega à noite e montar pedidos com o mesmo backend
          usado no WhatsApp (stub) e no chat com LLM local.
        </p>
      </header>

      <section className="card muted-card">
        <h2>Seus dados</h2>
        <div className="row">
          <label className="field grow">
            <span>Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
            />
          </label>
          <label className="field grow">
            <span>Telefone</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="5511999999999"
            />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Pizzaria — cardápio demo</h2>
        <p className="muted small">{menuPriceBlurb(menu)}</p>
        {menu ? (
          <>
            <div className="row align-end">
              <label className="field grow">
                <span>Sabor</span>
                <select
                  value={pizzaFlavor}
                  onChange={(e) => setPizzaFlavor(e.target.value)}
                >
                  {menu.pizzas.flavors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field shrink">
                <span>Tamanho</span>
                <select
                  value={pizzaSize}
                  onChange={(e) =>
                    setPizzaSize(e.target.value as "medio" | "grande")
                  }
                >
                  {menu.pizzas.sizes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} (R$ {s.priceReais})
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={addPizzaToCart}>
                + Pizza
              </button>
            </div>
            <div className="row gap-sm marg-top">
              {menu.drinks.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="secondary"
                  onClick={() => addDrinkToCart(d.id as "refri-600" | "refri-2l")}
                >
                  + {d.volumeLabel} (R$ {d.priceReais})
                </button>
              ))}
            </div>
            <h3 className="subh">Carrinho</h3>
            {cart.length === 0 ? (
              <p className="muted small">Nenhum item ainda.</p>
            ) : (
              <ul className="booking-list">
                {cart.map((it, i) => (
                  <li key={`${i}-${JSON.stringify(it)}`} className="booking-item">
                    <span>{cartLineLabel(menu, it)}</span>
                    <button type="button" className="ghost" onClick={() => removeCart(i)}>
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="total-line">
              <strong>Total: R$ {cartTotal}</strong>
            </p>
            <button
              type="button"
              onClick={() => void submitOrder()}
              disabled={loading}
            >
              Enviar pedido
            </button>
          </>
        ) : (
          <p className="muted">Carregando cardápio…</p>
        )}
      </section>

      <section className="card">
        <h2>Pedidos recentes</h2>
        <button type="button" className="ghost" onClick={() => void loadOrders()}>
          Atualizar
        </button>
        <ul className="booking-list">
          {orders.length === 0 ? (
            <li className="muted">Nenhum pedido ainda.</li>
          ) : (
            orders.slice(0, 8).map((o) => (
              <li key={o.id} className="booking-item block-start">
                <div>
                  <strong>R$ {o.totalReais}</strong>
                  <span className="muted small block">
                    {o.customerName} · {o.phone}
                  </span>
                  <span className="small block">
                    {o.lines
                      .map((l) =>
                        l.kind === "pizza"
                          ? `${l.flavorName} (${l.sizeLabel})`
                          : `${l.name} ${l.volumeLabel}`
                      )
                      .join(" · ")}
                  </span>
                  <code className="small">{o.id.slice(0, 8)}…</code>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="card">
        <h2>Novo agendamento</h2>
        <label className="field">
          <span>Data</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {msg && <p className="banner">{msg}</p>}
        <p className="muted small">{SCHEDULE_HINT}</p>
        {loading ? (
          <p className="muted">Carregando…</p>
        ) : (
          <ul className="slot-list">
            {freeSlots.length === 0 ? (
              <li className="muted">Nenhum horário livre neste dia.</li>
            ) : (
              freeSlots.map((s) => (
                <li key={s.id} className="slot-item">
                  <span>
                    {formatSlotTimeBr(s.startsAt)} <span className="muted">(Brasília)</span>
                  </span>
                  <button type="button" onClick={() => void onBook(s)}>
                    Reservar
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Agendamentos</h2>
        <button type="button" className="ghost" onClick={() => void loadBookings()}>
          Atualizar lista
        </button>
        <ul className="booking-list">
          {bookings.length === 0 ? (
            <li className="muted">Nenhum agendamento ainda.</li>
          ) : (
            bookings.map((b) => (
              <li key={b.id} className="booking-item">
                <div>
                  <strong>{b.customerName}</strong>
                  <span className="muted small block">
                    {formatBookingWhenBr(b.startsAt)} · {b.phone}
                  </span>
                  <code className="small">{b.id}</code>
                </div>
                <button type="button" onClick={() => void onCancel(b.id)}>
                  Cancelar
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
