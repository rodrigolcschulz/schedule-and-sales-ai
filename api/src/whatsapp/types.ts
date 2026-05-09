/**
 * Contrato para qualquer integração WhatsApp (Baileys, Cloud API, Twilio, etc.).
 * Implemente e registre em createWhatsAppProvider().
 */
export type IncomingWhatsAppMessage = {
  from: string;
  text: string;
  messageId?: string;
  raw?: unknown;
};

export type WhatsAppProvider = {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendText(to: string, body: string): Promise<void>;
  onMessage(handler: (msg: IncomingWhatsAppMessage) => void): void;
};
