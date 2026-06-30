# python-ai/contracts/planner.py
from pydantic import BaseModel
from typing import List, Optional

# --- Tipos internos ---

class MissingField(BaseModel):
    field: str
    reason: str
    question: str

class PlanStep(BaseModel):
    id: str                        # ex: "slots.list"
    title: str
    toolName: str                  # ex: "list_available_slots"
    toolArgs: dict                 # args da tool — flexível por design

# --- Request: o que o Fastify envia ao Python ---

class PlannerRequest(BaseModel):
    version: str = "1.0"
    domainId: str                  # ex: "dental"
    message: str                   # mensagem bruta do usuário
    sessionId: Optional[str] = None
    history: Optional[List[dict]] = []  # histórico de mensagens

# --- Response: o que o Python devolve ao Fastify ---

class PlannerResponse(BaseModel):
    version: str = "1.0"
    domainId: str
    summary: str
    intent: str                    # book | cancel | query | faq | unknown
    confidence: float
    needsClarification: bool
    missingFields: List[MissingField] = []
    steps: List[PlanStep] = []
    suggestedReply: str

# --- Rules ---

class RuleCheckRequest(BaseModel):
    version: str = "1.0"
    plan: PlannerResponse

class RuleCheckResponse(BaseModel):
    version: str = "1.0"
    valid: bool
    errors: List[str] = []

# --- Execute ---

class ExecuteRequest(BaseModel):
    version: str = "1.0"
    plan: PlannerResponse
    sessionId: Optional[str] = None

class ExecuteResponse(BaseModel):
    version: str = "1.0"
    success: bool
    result: dict = {}
    error: Optional[str] = None    # mensagem de erro se success=False

# --- Reflect ---

class ReflectRequest(BaseModel):
    version: str = "1.0"
    plan: PlannerResponse
    executeResult: ExecuteResponse

class ReflectResponse(BaseModel):
    version: str = "1.0"
    approved: bool                 # a resposta está boa?
    finalReply: str                # texto final pro usuário
    insights: List[dict] = []      # logs internos, auditoria