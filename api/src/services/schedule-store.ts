import { randomUUID } from "node:crypto";

export type Booking = {
  id: string;
  slotId: string;
  startsAt: string;
  customerName: string;
  phone: string;
  /** Dados extras específicos do domínio (ex.: { serviceId, serviceName } para odonto) */
  meta?: Record<string, unknown>;
  createdAt: string;
};

export type Slot = {
  id: string;
  startsAt: string;
  endsAt: string;
};

const SLOT_STEP_MS = 60 * 60 * 1000;

/** Brasil continental (America/Sao_Paulo, UTC−3; sem horário de verão). */
export const SCHEDULE_TZ_IANA = "America/Sao_Paulo";
const TZ_OFFSET_BR = "-03:00";

/** Padrão para pizzaria (à noite). Pode ser sobrescrito pelo construtor. */
const SLOT_FIRST_HOUR_LOCAL = 18;
const SLOT_LAST_START_HOUR_LOCAL = 22;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function toIso(d: Date): string {
  return d.toISOString();
}

/** Ex.: horário local da retirada para UI / WhatsApp */
export function formatSlotTimeBr(isoUtc: string): string {
  return new Date(isoUtc).toLocaleTimeString("pt-BR", {
    timeZone: SCHEDULE_TZ_IANA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Texto fixo para telas e README alinhado ao código acima */
export function scheduleRangeDescription(): string {
  return `Horários ${pad2(SLOT_FIRST_HOUR_LOCAL)}h–23h (${SCHEDULE_TZ_IANA}), slots de 1h — pensado para retirada/entrega à noite.`;
}

export class ScheduleStore {
  private bookings = new Map<string, Booking>();
  private readonly firstHour: number;
  private readonly lastStartHour: number;
  private readonly allowedWeekdays?: Set<number>;

  constructor(config?: {
    firstHour?: number;
    lastStartHour?: number;
    /** 0=domingo ... 6=sábado; omitido = todos os dias */
    allowedWeekdays?: number[];
  }) {
    this.firstHour = config?.firstHour ?? SLOT_FIRST_HOUR_LOCAL;
    this.lastStartHour = config?.lastStartHour ?? SLOT_LAST_START_HOUR_LOCAL;
    this.allowedWeekdays = config?.allowedWeekdays?.length
      ? new Set(config.allowedWeekdays)
      : undefined;
  }

  /**
   * Slots de 1h entre 18:00 e 22:00 no horário de Brasília (último slot termina 23:00).
   * IDs: `YYYY-MM-DD_HHmm` com HH em horário local (ex.: `2026-05-08_1800`).
   */
  getSlotsForDay(dateYmd: string): Slot[] {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
    if (!m) return [];

    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (this.allowedWeekdays && !this.allowedWeekdays.has(weekday)) return [];

    const slots: Slot[] = [];
    for (let h = this.firstHour; h <= this.lastStartHour; h++) {
      const s = new Date(`${dateYmd}T${pad2(h)}:00:00${TZ_OFFSET_BR}`);
      const e = new Date(s.getTime() + SLOT_STEP_MS);
      slots.push({
        id: `${dateYmd}_${pad2(h)}00`,
        startsAt: toIso(s),
        endsAt: toIso(e),
      });
    }
    return slots;
  }

  getBookedSlotIds(): Set<string> {
    return new Set([...this.bookings.values()].map((b) => b.slotId));
  }

  listBookings(): Booking[] {
    return [...this.bookings.values()].sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt)
    );
  }

  createBooking(input: {
    slotId: string;
    startsAt: string;
    customerName: string;
    phone: string;
    meta?: Record<string, unknown>;
  }): Booking | { error: string } {
    if ([...this.bookings.values()].some((b) => b.slotId === input.slotId)) {
      return { error: "slot_occupied" };
    }
    const b: Booking = {
      id: randomUUID(),
      slotId: input.slotId,
      startsAt: input.startsAt,
      customerName: input.customerName,
      phone: input.phone.replace(/\D/g, "") || input.phone,
      ...(input.meta ? { meta: input.meta } : {}),
      createdAt: new Date().toISOString(),
    };
    this.bookings.set(b.id, b);
    return b;
  }

  cancelBooking(id: string): boolean {
    return this.bookings.delete(id);
  }
}

export { SLOT_FIRST_HOUR_LOCAL, SLOT_LAST_START_HOUR_LOCAL };
