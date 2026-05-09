import { NavLink, Route, Routes } from "react-router-dom";
import { Chat } from "./pages/Chat";
import { Home } from "./pages/Home";

export function App() {
  return (
    <>
      <nav className="top-nav">
        <NavLink
          to="/"
          end
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
        >
          Agendamento e vendas
        </NavLink>
        <NavLink
          to="/chat"
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
        >
          LLM local
        </NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/chat" element={<Chat />} />
      </Routes>
    </>
  );
}
