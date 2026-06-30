# python-ai/memory/memory_store.py
from typing import Optional

class MemoryStore:
    def __init__(self):
        self._sessions: dict[str, dict] = {}  # sessionId → dados do paciente

    # --- API usada pelo planner ---

    def get(self, session_id: str) -> dict:
        return self._sessions.get(session_id, {})

    def set(self, session_id: str, data: dict):
        self._sessions[session_id] = data

    def merge(self, session_id: str, data: dict):
        """Atualiza só os campos não-nulos — não apaga o que já existe."""
        current = self.get(session_id)
        self._sessions[session_id] = {**current, **{k: v for k, v in data.items() if v}}

    def clear(self, session_id: str):
        self._sessions.pop(session_id, None)

    # --- Debug / admin ---

    def all_sessions(self) -> dict:
        return dict(self._sessions)