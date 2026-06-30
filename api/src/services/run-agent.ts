// services/run-agent.ts
// Orquestra o ciclo plan -> execute (local, no Node) -> reflect.
// Chamado quando handleWhatsAppCommand(...) do domínio retorna null
// (ou seja, quando o texto não bate com nenhum comando direto e
// "passa para o agente LLM").

import type { BusinessDomain, DomainContext } from "../domains/types.js";
import { aiClient, type ChatMessage, type ToolExecutionRecord } from "./ai-client.js";

export async function runAgent(
  domain: BusinessDomain,
  message: string,
  history: ChatMessage[],
  sessionId: string,
  ctx: DomainContext,
): Promise<string> {
  // 1. Python decide intenção + quais tools chamar (não executa nada).
  const plan = await aiClient.plan({
    message,
    history,
    domainId: domain.id,
    sessionId,
  });

  // 2. Faltam dados? Devolve a pergunta objetiva sem executar tools.
  if (plan.needsClarification || plan.missingFields.length > 0) {
    return plan.suggestedReply || "Pode me dar mais detalhes pra eu continuar?";
  }

  // 3. Executa as tools localmente, reaproveitando o que já existe em TS
  //    (ScheduleStore, PatientStore etc. continuam vivendo aqui).
  //    domain.executeTool retorna ToolResult ({ok:true,result} | {ok:false,error});
  //    desempacota aqui pra mandar pro reflect um formato simples e uniforme.
  const toolResults: ToolExecutionRecord[] = [];
  for (const step of plan.steps) {
    try {
      const outcome = await domain.executeTool(step.toolName, step.toolArgs, ctx);
      toolResults.push({
        tool: step.toolName,
        args: step.toolArgs,
        result: outcome.ok ? outcome.result : { error: outcome.error },
      });
    } catch (err) {
      toolResults.push({
        tool: step.toolName,
        args: step.toolArgs,
        result: { error: err instanceof Error ? err.message : "execute_failed" },
      });
    }
  }

  const hasToolError = toolResults.some(
    (entry) =>
      typeof entry.result === "object" &&
      entry.result !== null &&
      "error" in (entry.result as Record<string, unknown>)
  );

  // 4. Python valida a resposta final (guardrails) antes de devolver
  const reflected = await aiClient.reflect({
    plan,
    executeResult: {
      success: !hasToolError,
      result: { toolResults },
      ...(hasToolError ? { error: "tool_execution_failed" } : {}),
    },
  });

  if (!reflected.approved) {
    return "Desculpe, não consegui processar sua solicitação agora. Pode tentar de outro jeito?";
  }

  return reflected.finalReply;
}