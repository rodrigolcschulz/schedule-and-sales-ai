import type { IncomingWhatsAppMessage, WhatsAppProvider } from "./types.js";

export type StubWhatsAppProvider = WhatsAppProvider & {
  simulateInbound(msg: IncomingWhatsAppMessage): void;
};

/**
 * Provedor de desenvolvimento: loga envio/recebimento.
 * Troque por Baileys ou webhook real via WHATSAPP_PROVIDER.
 */
export function createStubWhatsAppProvider(): StubWhatsAppProvider {
  const handlers: Array<(msg: IncomingWhatsAppMessage) => void> = [];

  return {
    name: "stub",
    async start() {
      console.info("[whatsapp:stub] started (use POST /integrations/whatsapp/simulate-inbound para testar)");
    },
    async stop() {
      console.info("[whatsapp:stub] stopped");
    },
    async sendText(to: string, body: string) {
      console.info(`[whatsapp:stub] → ${to}: ${body}`);
    },
    onMessage(handler) {
      handlers.push(handler);
    },
    simulateInbound(msg: IncomingWhatsAppMessage) {
      for (const h of handlers) h(msg);
    },
  };
}
