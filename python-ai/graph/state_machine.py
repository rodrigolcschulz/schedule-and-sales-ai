# python-ai/graph/state_machine.py
import logging
from typing import Optional
from contracts.planner import PlannerResponse, ExecuteResponse, ReflectResponse

logger = logging.getLogger(__name__)

# Estados possíveis do fluxo
STATES = {
    "idle",           # aguardando mensagem
    "planning",       # planner processando
    "clarifying",     # aguardando dado do usuário
    "executing",      # tools sendo executadas no Fastify
    "reflecting",     # gerando resposta final
    "done",           # fluxo concluído
    "error",          # erro irrecuperável
}

TRANSITIONS = {
    "idle":       ["planning"],
    "planning":   ["clarifying", "executing", "error"],
    "clarifying": ["planning"],           # usuário respondeu → replanejar
    "executing":  ["reflecting", "error"],
    "reflecting": ["done", "error"],
    "done":       ["idle"],               # nova mensagem reinicia
    "error":      ["idle"],
}

class StateMachine:
    def __init__(self, session_id: Optional[str] = None):
        self.session_id = session_id
        self.state = "idle"
        self.history: list[str] = []      # auditoria de transições

    def transition(self, next_state: str) -> bool:
        if next_state not in STATES:
            logger.error(f"[fsm:{self.session_id}] Estado desconhecido: '{next_state}'")
            return False
        allowed = TRANSITIONS.get(self.state, [])
        if next_state not in allowed:
            logger.warning(f"[fsm:{self.session_id}] Transição inválida: {self.state} → {next_state}")
            return False
        self.history.append(self.state)
        self.state = next_state
        logger.info(f"[fsm:{self.session_id}] {self.history[-1]} → {self.state}")
        return True

    def run(self, plan: PlannerResponse, execute_fn, reflect_fn) -> ReflectResponse:
        """
        Orquestra o fluxo completo dado um plano já montado.
        execute_fn e reflect_fn são injetados pelo router para evitar acoplamento.
        """
        self.transition("planning")

        # Precisa de clarificação?
        if plan.needsClarification:
            self.transition("clarifying")
            return ReflectResponse(
                approved=True,
                finalReply=plan.suggestedReply,
                insights=[{"state": "clarifying", "missingFields": [f.field for f in plan.missingFields]}],
            )

        # Executa tools no Fastify
        self.transition("executing")
        try:
            execute_result: ExecuteResponse = execute_fn(plan)
        except Exception as e:
            self.transition("error")
            logger.error(f"[fsm] Erro na execução: {e}")
            return self._error_reply()

        if not execute_result.success:
            self.transition("error")
            return self._error_reply(execute_result.error)

        # Gera resposta final
        self.transition("reflecting")
        try:
            reflect_result: ReflectResponse = reflect_fn(plan, execute_result)
        except Exception as e:
            self.transition("error")
            logger.error(f"[fsm] Erro no reflect: {e}")
            return self._error_reply()

        self.transition("done")
        self.transition("idle")
        return reflect_result

    def reset(self):
        self.history.append(self.state)
        self.state = "idle"

    def snapshot(self) -> dict:
        return {
            "session_id": self.session_id,
            "state": self.state,
            "history": self.history,
        }

    def _error_reply(self, reason: Optional[str] = None) -> ReflectResponse:
        self.transition("idle")
        return ReflectResponse(
            approved=False,
            finalReply="Desculpe, ocorreu um erro ao processar sua solicitação. Pode tentar novamente?",
            insights=[{"state": "error", "reason": reason or "unknown"}],
        )