/** Deve refletir `api/src/services/schedule-store.ts` (horário de Brasília). */
export const SCHEDULE_HINT =
  "Retirada/entrega: 18h–23h no horário de Brasília, slots de 1h (último início 22h).";

export function formatSlotTimeBr(isoUtc: string): string {
  return new Date(isoUtc).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatBookingWhenBr(isoUtc: string): string {
  const d = new Date(isoUtc);
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}
