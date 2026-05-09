import type { WhatsAppProvider } from "./types.js";
import { createStubWhatsAppProvider } from "./stub-provider.js";

export type WhatsAppProviderKind = "stub" | "baileys";

export function createWhatsAppProvider(kind: WhatsAppProviderKind): WhatsAppProvider {
  if (kind === "stub") return createStubWhatsAppProvider();
  throw new Error(
    "WHATSAPP_PROVIDER=baileys ainda não implementado. Adicione @whiskeysockets/baileys e implemente BaileysWhatsAppProvider."
  );
}
