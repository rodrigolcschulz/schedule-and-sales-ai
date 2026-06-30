// services/schedule-store.ts
// Gera os horários (slots) de atendimento de um domínio e guarda os
// agendamentos (bookings) feitos sobre eles. Por enquanto tudo em memória
// (RAM) — reinicia o processo, reinicia a agenda. Migrar pra um banco
// depois é só trocar a implementação interna, a interface pública não muda.

export interface ScheduleConfig {
  /** Hora de início do primeiro slot do dia (0-23) */
  firstHour: number;
  /** Hora de início do último slot do dia (0-23); cada slot dura 1h */
  lastStartHour: number;
  /** Dias da semana permitidos: 0=domingo ... 6=sábado */
  allowedWeekdays: number[];
  /** Timezone usado pra gerar os horários (default: America/Sao_Paulo) */
  timezone?: string;
}

export interface Slot {
  /** Formato: `${date}_${HH}00`, ex: "2026-05-10_0900" */
  id: string;
  /** ISO 8601 com offset, ex: "2026-05-10T09:00:00-03:00" */
  startsAt: string;
  endsAt: string;
}

export interface Booking {
  id: string;
  slotId: string;
  startsAt: string;
  customerName: string;
  phone: string;
}

export interface CreateBookingInput {
  slotId: string;
  startsAt: string;
  customerName: string;
  phone: string;
}

export type CreateBookingResult = Booking | { error: "slot_occupied" };

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
/** Offset fixo de America/Sao_Paulo (UTC-3, sem horário de verão desde 2019) */
const SAO_PAULO_UTC_OFFSET = "-03:00";

export class ScheduleStore {
  private readonly config: Required<ScheduleConfig>;
  private readonly bookingsById = new Map<string, Booking>();
  private readonly bookingIdBySlot = new Map<string, string>();

  constructor(config: ScheduleConfig) {
    this.config = {
      timezone: DEFAULT_TIMEZONE,
      ...config,
    };
  }

  /**
   * Gera os slots possíveis para um dia (não diz se estão ocupados —
   * para isso, cruze com getBookedSlotIds()). Retorna lista vazia se a
   * data cair fora dos dias permitidos ou tiver formato inválido.
   */
  getSlotsForDay(date: string): Slot[] {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];

    const weekday = this.weekdayFor(date);
    if (!this.config.allowedWeekdays.includes(weekday)) return [];

    const slots: Slot[] = [];
    for (let hour = this.config.firstHour; hour <= this.config.lastStartHour; hour++) {
      const hh = String(hour).padStart(2, "0");
      slots.push({
        id: `${date}_${hh}00`,
        startsAt: this.toIso(date, hour),
        endsAt: this.toIso(date, hour + 1),
      });
    }
    return slots;
  }

  /** IDs de todos os slots que já têm booking ativo (em qualquer data) */
  getBookedSlotIds(): Set<string> {
    return new Set(this.bookingIdBySlot.keys());
  }

  createBooking(input: CreateBookingInput): CreateBookingResult {
    if (this.bookingIdBySlot.has(input.slotId)) {
      return { error: "slot_occupied" };
    }

    const booking: Booking = {
      id: this.generateBookingId(),
      slotId: input.slotId,
      startsAt: input.startsAt,
      customerName: input.customerName,
      phone: input.phone,
    };

    this.bookingsById.set(booking.id, booking);
    this.bookingIdBySlot.set(input.slotId, booking.id);
    return booking;
  }

  getBooking(id: string): Booking | undefined {
    return this.bookingsById.get(id);
  }

  listBookings(): Booking[] {
    return Array.from(this.bookingsById.values());
  }

  /** Retorna true se cancelou; false se o id não existia */
  cancelBooking(id: string): boolean {
    const booking = this.bookingsById.get(id);
    if (!booking) return false;
    this.bookingsById.delete(id);
    this.bookingIdBySlot.delete(booking.slotId);
    return true;
  }

  private weekdayFor(date: string): number {
    // Calcula o dia da semana de forma estável (UTC), sem depender do
    // timezone do processo que está rodando o Node.
    const [y, m, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  private toIso(date: string, hour: number): string {
    const hh = String(hour).padStart(2, "0");
    return `${date}T${hh}:00:00${SAO_PAULO_UTC_OFFSET}`;
  }

  private generateBookingId(): string {
    return `bk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Formata um ISO string (com offset) para exibição em pt-BR, ex: "10/05 09:00" */
export function formatSlotTimeBr(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: DEFAULT_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}