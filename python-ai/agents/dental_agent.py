# python-ai/agents/dental_agent.py
from providers.adapter import LLMAdapter
from contracts.planner import PlannerRequest, PlannerResponse
import json

class DentalAgent:
    def __init__(self):
        self.llm = LLMAdapter()  # aponta pro Ollama

    def extract_patient_info(self, message: str) -> dict:
        """Extrai nome, telefone e serviço de uma mensagem livre."""
        prompt = f"""
Extraia as informações do paciente da mensagem abaixo.
Responda APENAS com JSON válido, sem explicação.

Mensagem: "{message}"

Formato esperado:
{{
  "name": "nome ou null",
  "phone": "telefone ou null",
  "service": "id do serviço ou null",
  "date": "data mencionada ou null"
}}

Serviços disponíveis: limpeza, avaliacao, retorno, restauracao, extracao, emergencia, clareamento, ortodontia
"""
        response = self.llm.complete(prompt)
        return json.loads(response)

    def confirm_intent(self, message: str) -> str:
        """Retorna: book | cancel | query | faq | unknown"""
        prompt = f"""
Classifique a intenção da mensagem abaixo com uma única palavra.
Opções: book, cancel, query, faq, unknown

Mensagem: "{message}"
Responda apenas com a palavra, sem pontuação.
"""
        return self.llm.complete(prompt).strip().lower()

    def generate_reply(self, context: dict) -> str:
        """Gera resposta em linguagem natural dado o contexto do agendamento."""
        prompt = f"""
Você é a assistente virtual de uma clínica odontológica.
Responda de forma breve, cordial e em português.

Contexto: {json.dumps(context, ensure_ascii=False)}

Se faltar informação, pergunte apenas o campo mais importante agora.
"""
        return self.llm.complete(prompt)