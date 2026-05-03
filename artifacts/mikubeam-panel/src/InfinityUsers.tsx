import { useEffect, useState, useCallback } from "react";

const PANEL_SECRET = import.meta.env.VITE_PANEL_SECRET ?? "";
const API = "/api/infinity/panel";

type InfUser = {
  username: string;
  role: "admin" | "vip" | "user";
  createdAt: string;
  lastLoginAt: string | null;
  accountExpiresAt: string | null;
};

type Toast = { id: number; type: "ok" | "err"; text: string } | null;

const headers = () => ({
  "Content-Type": "application/json",
  "X-Panel-Secret": PANEL_SECRET,
});

export function InfinityUsers() {
  const [users, setUsers] = useState<InfUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState<"vip" | "admin" | "user">("vip");
  const [newExpiry, setNewExpiry] = useState<number>(30);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [search, setSearch] = useState("");

  const showToast = (type: "ok" | "err", text: string) => {
    const id = Date.now();
    setToast({ id, type, text });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3500);
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/users`, { headers: headers() });
      const data = await r.json();
      if (!r.ok) { showToast("err", data?.error ?? "Falha ao carregar"); return; }
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      showToast("err", "Sem conexão com a API");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.trim() || !newPass.trim()) return;
    setCreating(true);
    try {
      const r = await fetch(`${API}/users`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ username: newUser.trim(), password: newPass, role: newRole, expiresInDays: newExpiry }),
      });
      const data = await r.json();
      if (!r.ok) { showToast("err", data?.error ?? "Falha ao criar"); }
      else {
        showToast("ok", `Usuário "${newUser.trim()}" criado com sucesso!`);
        setNewUser("");
        setNewPass("");
        setNewRole("vip");
        setNewExpiry(30);
        fetchUsers();
      }
    } catch { showToast("err", "Erro de conexão"); }
    finally { setCreating(false); }
  };

  const handleDelete = async (username: string) => {
    if (!confirm(`Deletar o usuário "${username}"? Ação irreversível.`)) return;
    try {
      const r = await fetch(`${API}/users/${encodeURIComponent(username)}`, {
        method: "DELETE", headers: headers(),
      });
      if (r.status === 204 || r.ok) { showToast("ok", `"${username}" removido`); fetchUsers(); }
      else { const d = await r.json().catch(() => ({})); showToast("err", d?.error ?? "Falha ao deletar"); }
    } catch { showToast("err", "Erro de conexão"); }
  };

  const handleRevoke = async (username: string, isRevoked: boolean) => {
    const action = isRevoked ? "restore" : "revoke";
    try {
      const r = await fetch(`${API}/users/${encodeURIComponent(username)}`, {
        method: "PATCH", headers: headers(), body: JSON.stringify({ action }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { showToast("err", d?.error ?? "Falha"); return; }
      showToast("ok", isRevoked ? `"${username}" reativado` : `"${username}" revogado`);
      fetchUsers();
    } catch { showToast("err", "Erro de conexão"); }
  };

  const filtered = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  const panel: React.CSSProperties = {
    background: "rgba(20, 12, 35, 0.7)",
    border: "1px solid rgba(155, 89, 182, 0.25)",
    borderRadius: 14,
    padding: 24,
    backdropFilter: "blur(12px)",
  };
  const inp: React.CSSProperties = {
    width: "100%", padding: "12px 14px",
    background: "rgba(0,0,0,0.4)",
    border: "1px solid rgba(155,89,182,0.35)",
    borderRadius: 10, color: "#fff", fontSize: 14, outline: "none",
    boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = {
    fontSize: 10, letterSpacing: 3, textTransform: "uppercase",
    color: "rgba(230,216,255,0.6)", marginBottom: 6, display: "block",
  };
  const primaryBtn: React.CSSProperties = {
    width: "100%", padding: "13px 18px",
    background: "linear-gradient(135deg, #9b59b6 0%, #6d2db5 100%)",
    color: "#fff", border: "none", borderRadius: 10,
    fontWeight: 700, letterSpacing: 1.4, fontSize: 12,
    textTransform: "uppercase", cursor: "pointer",
    boxShadow: "0 0 24px rgba(155,89,182,0.35)",
    transition: "opacity 0.15s",
  };

  const roleConfig = {
    vip:   { label: "⭐ VIP",   active: "rgba(56,189,248,0.25)",  border: "rgba(56,189,248,0.7)",  color: "#7dd3fc" },
    admin: { label: "👑 Admin", active: "rgba(212,175,55,0.25)",  border: "rgba(212,175,55,0.7)",  color: "#fde68a" },
    user:  { label: "👤 User",  active: "rgba(155,89,182,0.25)", border: "rgba(155,89,182,0.7)", color: "#d8b4fe" },
  };

  const expiryOpts = [
    { label: "7 dias",    value: 7 },
    { label: "15 dias",   value: 15 },
    { label: "30 dias",   value: 30 },
    { label: "60 dias",   value: 60 },
    { label: "90 dias",   value: 90 },
    { label: "∞ Sem limite", value: 0 },
  ] as const;

  const expiryBadge = (u: InfUser) => {
    if (u.role === "admin") return null;
    if (!u.accountExpiresAt) return { text: "∞ Sem expiração", bg: "rgba(56,189,248,0.1)", border: "rgba(56,189,248,0.3)", color: "#7dd3fc" };
    const diff = new Date(u.accountExpiresAt).getTime() - Date.now();
    if (diff <= 0) return { text: `⛔ Expirado em ${new Date(u.accountExpiresAt).toLocaleDateString("pt-BR")}`, bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.4)", color: "#fca5a5" };
    if (diff < 3 * 86_400_000) return { text: `⚠ ${Math.floor(diff / 86_400_000)}d restantes`, bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.4)", color: "#fcd34d" };
    return { text: `⏳ ${Math.floor(diff / 86_400_000)}d — ${new Date(u.accountExpiresAt).toLocaleDateString("pt-BR")}`, bg: "rgba(52,211,153,0.1)", border: "rgba(52,211,153,0.3)", color: "#6ee7b7" };
  };

  return (
    <div style={{ padding: 24, color: "#e6d8ff", fontFamily: "Inter, system-ui, sans-serif" }}>

      {toast && (
        <div style={{
          position: "fixed", top: 80, right: 24,
          padding: "12px 18px",
          background: toast.type === "ok" ? "rgba(46,204,113,0.15)" : "rgba(231,76,60,0.15)",
          border: `1px solid ${toast.type === "ok" ? "rgba(46,204,113,0.5)" : "rgba(231,76,60,0.5)"}`,
          borderRadius: 10,
          color: toast.type === "ok" ? "#7ee2a8" : "#ff8c8c",
          fontSize: 13, zIndex: 10000, backdropFilter: "blur(10px)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        }}>
          {toast.text}
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22, letterSpacing: 4, textTransform: "uppercase" }}>
          Infinity Users
        </h2>
        <p style={{ margin: "4px 0 0", color: "rgba(230,216,255,0.5)", fontSize: 12, letterSpacing: 1.5 }}>
          Gerencie os acessos ao Infinity Search
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 24, alignItems: "start" }}>

        {/* ── Criar usuário ── */}
        <form onSubmit={handleCreate} style={{ ...panel, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: "#cba8ff" }}>
            Criar Novo Usuário
          </div>

          <div>
            <label style={lbl}>Usuário</label>
            <input
              style={inp} value={newUser}
              onChange={e => setNewUser(e.target.value)}
              placeholder="ex.: operador01" required autoComplete="off"
            />
          </div>

          <div>
            <label style={lbl}>Senha</label>
            <input
              style={inp} type="password" value={newPass}
              onChange={e => setNewPass(e.target.value)}
              placeholder="senha forte" required autoComplete="new-password"
            />
          </div>

          <div>
            <label style={lbl}>Cargo</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["vip", "admin", "user"] as const).map(r => {
                const cfg = roleConfig[r];
                return (
                  <button key={r} type="button" onClick={() => setNewRole(r)} style={{
                    flex: 1, padding: "10px 4px",
                    background: newRole === r ? cfg.active : "rgba(0,0,0,0.3)",
                    border: `1px solid ${newRole === r ? cfg.border : "rgba(155,89,182,0.2)"}`,
                    color: newRole === r ? cfg.color : "rgba(230,216,255,0.5)",
                    borderRadius: 8, cursor: "pointer",
                    fontSize: 11, letterSpacing: 1.5,
                    textTransform: "uppercase", fontWeight: 600, transition: "all 0.15s",
                  }}>
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label style={lbl}>Expiração</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {expiryOpts.map(opt => (
                <button key={opt.value} type="button" onClick={() => setNewExpiry(opt.value)} style={{
                  padding: "9px 4px",
                  background: newExpiry === opt.value ? "rgba(155,89,182,0.25)" : "rgba(0,0,0,0.3)",
                  border: `1px solid ${newExpiry === opt.value ? "rgba(155,89,182,0.7)" : "rgba(155,89,182,0.2)"}`,
                  color: newExpiry === opt.value ? "#fff" : "rgba(230,216,255,0.55)",
                  borderRadius: 8, cursor: "pointer",
                  fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600,
                  transition: "all 0.15s",
                }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button type="submit" disabled={creating} style={{ ...primaryBtn, opacity: creating ? 0.5 : 1 }}>
            {creating ? "Criando..." : "✦ Criar Usuário"}
          </button>
        </form>

        {/* ── Lista de usuários ── */}
        <div style={panel}>
          <div style={{
            fontSize: 11, letterSpacing: 4, textTransform: "uppercase",
            color: "#cba8ff", marginBottom: 14,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>Usuários Cadastrados</span>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ color: "rgba(230,216,255,0.4)" }}>
                {loading ? "carregando..." : `${filtered.length}/${users.length}`}
              </span>
              <button onClick={fetchUsers} style={{
                padding: "5px 10px",
                background: "rgba(155,89,182,0.15)",
                border: "1px solid rgba(155,89,182,0.3)",
                color: "#cba8ff", borderRadius: 6, cursor: "pointer",
                fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
              }}>
                ↻ Atualizar
              </button>
            </div>
          </div>

          <input
            style={{ ...inp, marginBottom: 14 }}
            placeholder="Buscar usuário..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {filtered.length === 0 && !loading && (
            <div style={{ textAlign: "center", padding: 32, color: "rgba(230,216,255,0.35)", fontSize: 13 }}>
              {search ? "Nenhum usuário encontrado." : "Nenhum usuário cadastrado."}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(u => {
              const isRevoked = !!u.accountExpiresAt && new Date(u.accountExpiresAt).getTime() <= Date.now();
              const badge = expiryBadge(u);
              const rc = roleConfig[u.role] ?? roleConfig.user;
              return (
                <div key={u.username} style={{
                  padding: "12px 16px",
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(155,89,182,0.15)",
                  borderRadius: 10, display: "flex",
                  alignItems: "center", justifyContent: "space-between",
                  gap: 12, flexWrap: "wrap",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                      background: u.role === "admin"
                        ? "linear-gradient(135deg, #d4af37, #6d2db5)"
                        : u.role === "vip"
                        ? "linear-gradient(135deg, #38bdf8, #6d2db5)"
                        : "linear-gradient(135deg, #9b59b6, #6d2db5)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontWeight: 800, color: "#fff", fontSize: 15,
                    }}>
                      {u.username[0]?.toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                        {u.username}
                      </div>
                      <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: rc.color }}>
                        {rc.label} · {new Date(u.createdAt).toLocaleDateString("pt-BR")}
                        {u.lastLoginAt && ` · login ${new Date(u.lastLoginAt).toLocaleString("pt-BR")}`}
                      </div>
                      {badge && (
                        <div style={{
                          marginTop: 5, fontSize: 10, letterSpacing: 1.5,
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "2px 8px", borderRadius: 20,
                          background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color,
                        }}>
                          {badge.text}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {u.role !== "admin" && (
                      <button onClick={() => handleRevoke(u.username, isRevoked)} style={{
                        padding: "7px 12px",
                        background: isRevoked ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.12)",
                        border: `1px solid ${isRevoked ? "rgba(52,211,153,0.4)" : "rgba(245,158,11,0.4)"}`,
                        color: isRevoked ? "#6ee7b7" : "#fcd34d",
                        borderRadius: 7, cursor: "pointer",
                        fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600,
                      }}>
                        {isRevoked ? "Reativar" : "Revogar"}
                      </button>
                    )}
                    <button onClick={() => handleDelete(u.username)} style={{
                      padding: "7px 12px",
                      background: "rgba(231,76,60,0.12)",
                      border: "1px solid rgba(231,76,60,0.4)",
                      color: "#ff8c8c",
                      borderRadius: 7, cursor: "pointer",
                      fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600,
                    }}>
                      Deletar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{
            marginTop: 18, paddingTop: 14,
            borderTop: "1px solid rgba(155,89,182,0.15)",
            display: "flex", justifyContent: "space-between",
            fontSize: 10, letterSpacing: 3, textTransform: "uppercase",
            color: "rgba(230,216,255,0.35)",
          }}>
            <span>Lelouch · Infinity bridge</span>
            <span>by blxckxyz</span>
          </div>
        </div>
      </div>
    </div>
  );
}
