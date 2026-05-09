import type { BusinessDomain, DomainContext } from "../types.js";
import { DENTAL_TOOLS, executeDentalTool } from "./tools.js";
import { DENTAL_SYSTEM_PROMPT } from "./prompt.js";
import { ScheduleStore, formatSlotTimeBr } from "../../services/schedule-store.js";
import { PatientStore } from "./patient-store.js";
import { formatServicesText, resolveServiceIdFromText, serviceById } from "./catalog.js";

/** Clínica funciona seg–sex 8h–17h (último slot inicia às 17h, termina 18h) */
const DENTAL_SCHEDULE = {
  firstHour: 8,
  lastStartHour: 17,
  allowedWeekdays: [1, 2, 3, 4, 5],
};

const DENTAL_WA_HELP = [
  "Clínica Odonto Demo — Comandos:",
  "",
  "servicos — lista de procedimentos e preços",
  "horarios YYYY-MM-DD — horários disponíveis",
  "agendar YYYY-MM-DD HH Nome SERVIÇO — ex: agendar 2026-05-10 09 Maria limpeza",
  "meus — suas consultas agendadas",
  "cancelar BOOKING_ID — cancela consulta",
  "",
  "Ou simplesmente descreva o que precisa e a IA responde!",
].join("\n");

export const dentalDomain: BusinessDomain = {
  id: "dental",
  displayName: "Clínica Odonto Demo",
  systemPrompt: DENTAL_SYSTEM_PROMPT,
  tools: DENTAL_TOOLS,

  executeTool(name, args, ctx) {
    return executeDentalTool(name, args, ctx as DomainContext & { patients: PatientStore });
  },

  createContext(): DomainContext {
    const schedule = new ScheduleStore(DENTAL_SCHEDULE);
    const patients = new PatientStore();
    return { schedule, patients };
  },

  whatsAppHelp: DENTAL_WA_HELP,

  async handleWhatsAppCommand(text, lower, from, ctx) {
    const { schedule, patients } = ctx as { schedule: ScheduleStore; patients: PatientStore };

    if (lower === "servicos" || lower === "serviços" || lower === "procedimentos") {
      return `Serviços da Clínica Odonto Demo:\n\n${formatServicesText()}`;
    }

    // "agendar YYYY-MM-DD HH Nome SERVICO"
    if (lower.startsWith("agendar ")) {
      const rest = text.slice("agendar ".length).trim();
      const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2})\s+(.+)$/.exec(rest);
      if (!m) {
        return "Formato: agendar YYYY-MM-DD HH Nome Serviço\nEx: agendar 2026-05-10 09 Maria limpeza";
      }
      const date = m[1];
      const hour = m[2].padStart(2, "0");
      const remainder = m[3].trim();

      const serviceId = resolveServiceIdFromText(remainder);
      const patientName = serviceId
        ? remainder.replace(new RegExp(serviceById(serviceId)!.keywords.join("|"), "i"), "").trim() || remainder
        : remainder;

      if (!serviceId) {
        return `Serviço não reconhecido em: "${remainder}".\nEnvie "servicos" para ver a lista.`;
      }

      const slotId = `${date}_${hour}00`;
      const slots = schedule.getSlotsForDay(date);
      const slot = slots.find((s) => s.id === slotId);

      if (!slot) {
        return `Horário ${hour}h inválido para ${date}. Envie "horarios ${date}" para ver disponíveis.`;
      }

      const res = patients.createAppointment(schedule, {
        slotId: slot.id,
        patientName: patientName || `Paciente ${from}`,
        phone: from,
        serviceId,
      });

      if ("error" in res) {
        if (res.error === "slot_occupied") {
          return `Esse horário já está ocupado. Envie "horarios ${date}" para ver horários livres.`;
        }
        return `Erro ao agendar: ${res.error}`;
      }

      const timeLabel = formatSlotTimeBr(res.startsAt);
      return (
        `Consulta agendada!\n` +
        `Paciente: ${res.patientName}\n` +
        `Serviço: ${res.serviceName}\n` +
        `Horário: ${timeLabel} (${date})\n` +
        `ID de cancelamento: ${res.bookingId}`
      );
    }

    return null; // passa para o agente LLM
  },
};
