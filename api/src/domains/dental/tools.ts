import type { ToolDefinition, ToolResult, DomainContext } from "../types.js";
import {
  DENTAL_SERVICES,
  servicesPayloadForApi,
  serviceById,
  resolveServiceIdFromText,
} from "./catalog.js";
import type { PatientStore } from "./patient-store.js";

function normPhone(p: string): string {
  return p.replace(/\D/g, "") || p.trim();
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function normalizeDateInput(raw: string): string | undefined {
  const s = raw.trim();

  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // BR: DD/MM or DD/MM/YY or DD/MM/YYYY
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(s);
  if (!m) return undefined;

  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return undefined;

  const now = new Date();
  const yearPart = m[3];
  const year = !yearPart
    ? now.getFullYear()
    : yearPart.length === 2
      ? 2000 + Number(yearPart)
      : Number(yearPart);

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return undefined;
  }

  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function normalizeSlotId(raw: string): string {
  // Already correct: 2026-05-12_1300
  if (/^\d{4}-\d{2}-\d{2}_\d{4}$/.test(raw)) return raw;
  // Missing minutes: 2026-05-12_13 → 2026-05-12_1300
  if (/^\d{4}-\d{2}-\d{2}_\d{2}$/.test(raw)) return raw + "00";
  return raw;
}

function resolveServiceId(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return undefined;
  return serviceById(trimmed) ? trimmed : resolveServiceIdFromText(trimmed);
}

function buildInvalidServiceError(serviceRaw: string): string {
  const term = serviceRaw.trim().toLowerCase();
  const suggested = DENTAL_SERVICES.filter((s) =>
    s.keywords.some((kw) => kw.includes(term) || term.includes(kw))
  ).slice(0, 3);

  const suggestionText = suggested.length
    ? suggested.map((s) => `${s.id} (${s.name})`).join(", ")
    : DENTAL_SERVICES.map((s) => s.id).join(", ");

  return `invalid_service_id: use um destes service_id -> ${suggestionText}`;
}

export const DENTAL_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_services",
      description:
        "Retorna o catálogo de serviços da clínica odontológica: nome, descrição, duração e preço.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_available_slots",
      description:
        "Lista horários disponíveis para agendamento em uma data (YYYY-MM-DD). Atendimento de segunda a sexta, 8h–17h (Brasília).",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data no formato YYYY-MM-DD" },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_appointment",
      description:
        "Agenda uma consulta. Use slot_id retornado por list_available_slots. service_id: limpeza, avaliacao, retorno, restauracao, extracao, emergencia, clareamento, ortodontia.",
      parameters: {
        type: "object",
        properties: {
          slot_id: { type: "string" },
          patient_name: { type: "string" },
          phone: { type: "string", description: "Telefone só com dígitos" },
          service_id: { type: "string" },
          notes: { type: "string", description: "Observações opcionais (ex.: dor no dente 36)" },
        },
        required: ["slot_id", "patient_name", "phone", "service_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_appointments_for_phone",
      description: "Lista consultas agendadas para o telefone informado.",
      parameters: {
        type: "object",
        properties: { phone: { type: "string" } },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_appointment",
      description: "Cancela uma consulta pelo booking_id, verificando o telefone do paciente.",
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
      name: "get_patient_history",
      description: "Retorna o histórico de consultas do paciente pelo telefone.",
      parameters: {
        type: "object",
        properties: { phone: { type: "string" } },
        required: ["phone"],
      },
    },
  },
];

type DentalCtx = DomainContext & { patients: PatientStore };

export async function executeDentalTool(
  name: string,
  args: Record<string, unknown>,
  ctx: DentalCtx
): Promise<ToolResult> {
  try {
    switch (name) {
      case "get_services":
        return { ok: true, result: servicesPayloadForApi() };

      case "list_available_slots": {
        const rawDate = asStr(args.date);
        const date = rawDate ? normalizeDateInput(rawDate) : undefined;
        if (!date) {
          return { ok: false, error: "invalid_date" };
        }
        const slots = ctx.schedule.getSlotsForDay(date);
        const taken = ctx.schedule.getBookedSlotIds();
        const availableSlots = slots.filter((s) => !taken.has(s.id));

        const timeLabel = (slotId: string) => `${slotId.slice(11, 13)}:${slotId.slice(13, 15)}`;
        const morningSlots = availableSlots.filter((s) => Number(s.id.slice(11, 13)) < 12);
        const afternoonSlots = availableSlots.filter((s) => Number(s.id.slice(11, 13)) >= 12);

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
            available_slots: availableSlots.map((s) => s.id),
            available_morning_slots: morningSlots.map((s) => s.id),
            available_afternoon_slots: afternoonSlots.map((s) => s.id),
            available_morning_times: morningSlots.map((s) => timeLabel(s.id)),
            available_afternoon_times: afternoonSlots.map((s) => timeLabel(s.id)),
          },
        };
      }

      case "create_appointment":
      case "create_booking": {
        const slotId = asStr(args.slot_id) ? normalizeSlotId(asStr(args.slot_id)!) : undefined;
        const patientName = asStr(args.patient_name);
        const phone = args.phone != null ? normPhone(String(args.phone)) : "";
        const serviceRaw = asStr(args.service_id);
        const serviceId = serviceRaw ? resolveServiceId(serviceRaw) : undefined;
        const notes = asStr(args.notes);

        if (!slotId || !patientName || !phone || !serviceRaw) {
          return { ok: false, error: "missing_fields" };
        }
        if (!serviceId || !serviceById(serviceId)) {
          return { ok: false, error: buildInvalidServiceError(serviceRaw) };
        }

        const res = ctx.patients.createAppointment(ctx.schedule, {
          slotId,
          patientName,
          phone,
          serviceId,
          ...(notes ? { notes } : {}),
        });

        if ("error" in res) return { ok: false, error: res.error };
        return {
          ok: true,
          result: {
            appointment_id: res.id,
            booking_id: res.bookingId,
            patient_name: res.patientName,
            service: res.serviceName,
            starts_at: res.startsAt,
          },
        };
      }

      case "list_appointments_for_phone":
      case "list_appointments":
      case "find_booking": {
        const phone = args.phone != null ? normPhone(String(args.phone)) : "";
        if (!phone) return { ok: false, error: "missing_phone" };
        const list = ctx.patients.listAppointmentsByPhone(phone).map((a) => ({
          booking_id: a.bookingId,
          service: a.serviceName,
          starts_at: a.startsAt,
          patient_name: a.patientName,
        }));
        return { ok: true, result: { appointments: list } };
      }

      case "cancel_appointment":
      case "delete_booking": {
        const bookingId = asStr(args.booking_id);
        const phone = args.phone != null ? normPhone(String(args.phone)) : "";
        if (!bookingId || !phone) return { ok: false, error: "missing_fields" };

        const appts = ctx.patients.listAppointmentsByPhone(phone);
        const target = appts.find((a) => a.bookingId === bookingId);
        if (!target) return { ok: false, error: "not_found_or_phone" };

        ctx.patients.cancelByBookingId(bookingId, ctx.schedule);
        return { ok: true, result: { cancelled: bookingId } };
      }

      case "get_patient_history": {
        const phone = args.phone != null ? normPhone(String(args.phone)) : "";
        if (!phone) return { ok: false, error: "missing_phone" };
        const history = ctx.patients.listAppointmentsByPhone(phone).map((a) => ({
          booking_id: a.bookingId,
          service: a.serviceName,
          starts_at: a.startsAt,
          notes: a.notes ?? null,
        }));
        return { ok: true, result: { phone, history } };
      }

      default:
        return { ok: false, error: `unknown_tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
