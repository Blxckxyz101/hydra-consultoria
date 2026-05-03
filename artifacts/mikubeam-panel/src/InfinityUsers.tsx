import { useEffect, useState, useCallback } from "react";

const TOKEN_KEY = "lelouch_infinity_token";
const USER_KEY = "lelouch_infinity_user";

type InfUser = {
  username: string;
  role: "admin" | "vip" | "user";
  createdAt: string;
  lastLoginAt: string | null;
  accountExpiresAt: string | null;
};

type Toast = { id: number; type: "ok" | "err"; text: string } | null;

export function InfinityUsers() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [me, setMe] = useState<InfUser | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  });
  const [users, setUsers] = useState<InfUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState<"user" | "vip" | "admin">("vip");
  const [newExpiry, setNewExpiry] = useState<number>(30);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const showToast = (type: "ok" | "err", text: string) => {
    const id = Date.now();
    setToast({ id, type, text });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3000);
  };

  const fetchUsers = useCallback(async (tk: string) => {
    setLoading(true);
    try {
      const r = await fetch("/api/infinity/users", { headers: { Authorization: `Bearer ${tk}` } });
      if (r.status === 401 || r.status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setMe(null);
        setLoginErr("Sessão expirada. Faça login novamente.");
        return;
      }
      const data = await r.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      showToast("err", "Falha ao carregar usuários");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) fetchUsers(token);
  }, [token, fetchUsers]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr("");
    try {
      const r = await fetch("/api/infinity/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      });
      const data = await r.json();
      if (!r.ok) {
        setLoginErr(data?.error || "Credenciais inválidas");
        return;
      }
      if (data.user.role !== "admin") {
        setLoginErr("Apenas administradores podem gerenciar usuários.");
        return;
      }
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setToken(data.token);
      setMe(data.user);
      setLoginUser("");
      setLoginPass("");
    } catch {
      setLoginErr("Erro de conexão");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setMe(null);
    setUsers([]);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newUser || !newPass) return;
    setCreating(true);
    try {
      const r = await fetch("/api/infinity/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: newUser, password: newPass, role: newRole, expiresInDays: newExpiry }),
      });
      const data = await r.json();
      if (!r.ok) {
        showToast("err", data?.error || "Falha ao criar usuário");
      } else {
        showToast("ok", `Usuário "${newUser}" criado`);
        setNewUser("");
        setNewPass("");
        setNewRole("user");
        setNewExpiry(30);
        fetchUsers(token);
      }
    } catch {
      showToast("err", "Erro de conexão");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (username: string) => {
    if (!token) return;
    if (!confirm(`Deletar o usuário "${username}"? Esta ação é irreversível.`)) return;
    try {
      const r = await fetch(`/api/infinity/users/${encodeURIComponent(username)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok && r.status !== 204) {
        const data = await r.json().catch(() => ({}));
        showToast("err", data?.error || "Falha ao deletar");
        return;
      }
      showToast("ok", `Usuário "${username}" removido`);
      fetchUsers(token);
    } catch {
      showToast("err", "Erro de conexão");
    }
  };

  const handleRevoke = async (username: string, currentlyRevoked: boolean) => {
    if (!token) return;
    const action = currentlyRevoked ? "restore" : "revoke";
    const label = currentlyRevoked ? "Reativar" : "Revogar";
    if (!confirm(`${label} acesso do usuário "${username}"?`)) return;
    try {
      const r = await fetch(`/api/infinity/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        showToast("err", data?.error || `Falha ao ${label.toLowerCase()}`);
        return;
      }
      showToast("ok", currentlyRevoked ? `Acesso de "${username}" restaurado` : `Acesso de "${username}" revogado`);
      fetchUsers(token);
    } catch {
      showToast("err", "Erro de conexão");
    }
  };

  const wrap: React.CSSProperties = { padding: 24, color: "#e6d8ff", fontFamily: "Inter, system-ui, sans-serif" };
  const panel: React.CSSProperties = {
    background: "rgba(20, 12, 35, 0.7)",
    border: "1px solid rgba(155, 89, 182, 0.25)",
    borderRadius: 14,
    padding: 24,
    backdropFilter: "blur(12px)",
  };
  const input: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    background: "rgba(0,0,0,0.4)",
    border: "1px solid rgba(155, 89, 182, 0.35)",
    borderRadius: 10,
    color: "#fff",
    fontSize: 14,
    outline: "none",
  };
  const btn: React.CSSProperties = {
    padding: "12px 18px",
    background: "linear-gradient(135deg, #9b59b6 0%, #6d2db5 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontWeight: 700,
    letterSpacing: 1.4,
    fontSize: 12,
    textTransform: "uppercase",
    cursor: "pointer",
    boxShadow: "0 0 24px rgba(155,89,182,0.35)",
  };
  const label: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: 3,
    textTransform: "uppercase",
    color: "rgba(230,216,255,0.6)",
    marginBottom: 6,
    display: "block",
  };

  if (!token || !me) {
    return (
      <div style={wrap}>
        <h2 style={{ margin: 0, fontSize: 22, letterSpacing: 4, textTransform: "uppercase", marginBottom: 6 }}>
          Infinity Users
        </h2>
        <p style={{ marginTop: 0, color: "rgba(230,216,255,0.6)", fontSize: 13 }}>
          Faça login com uma conta admin do Infinity Search para gerenciar usuários.
        </p>

        <form
          onSubmit={handleLogin}
          style={{ ...panel, maxWidth: 420, marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}
        >
          {loginErr && (
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(231,76,60,0.12)",
                border: "1px solid rgba(231,76,60,0.4)",
                borderRadius: 8,
                color: "#ff8c8c",
                fontSize: 13,
              }}
            >
              {loginErr}
            </div>
          )}
          <div>
            <label style={label}>Usuário Admin</label>
            <input style={input} value={loginUser} onChange={(e) => setLoginUser(e.target.value)} placeholder="admin" required />
          </div>
          <div>
            <label style={label}>Senha</label>
            <input
              style={input}
              type="password"
              value={loginPass}
              onChange={(e) => setLoginPass(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button type="submit" style={btn}>
            Conectar ao Infinity
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={wrap}>
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 80,
            right: 24,
            padding: "12px 18px",
            background: toast.type === "ok" ? "rgba(46,204,113,0.15)" : "rgba(231,76,60,0.15)",
            border: `1px solid ${toast.type === "ok" ? "rgba(46,204,113,0.5)" : "rgba(231,76,60,0.5)"}`,
            borderRadius: 10,
            color: toast.type === "ok" ? "#7ee2a8" : "#ff8c8c",
            fontSize: 13,
            zIndex: 10000,
            backdropFilter: "blur(10px)",
          }}
        >
          {toast.text}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, letterSpacing: 4, textTransform: "uppercase" }}>
            Infinity Users
          </h2>
          <p style={{ margin: "4px 0 0", color: "rgba(230,216,255,0.55)", fontSize: 12, letterSpacing: 1.5 }}>
            Logado como <strong style={{ color: "#cba8ff" }}>{me.username}</strong> · admin
          </p>
        </div>
        <button
          onClick={handleLogout}
          style={{
            padding: "10px 16px",
            background: "transparent",
            color: "rgba(230,216,255,0.7)",
            border: "1px solid rgba(155,89,182,0.3)",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 11,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          Desconectar Infinity
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: 24, alignItems: "start" }}>
        <form onSubmit={handleCreate} style={{ ...panel, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: "#cba8ff" }}>
            Criar Novo Usuário
          </div>
          <div>
            <label style={label}>Usuário</label>
            <input style={input} value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="ex.: operador01" required />
          </div>
          <div>
            <label style={label}>Senha</label>
            <input
              style={input}
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="senha forte"
              required
            />
          </div>
          <div>
            <label style={label}>Cargo</label>
            <div style={{ display: "flex", gap: 8 }}>
              {([
                { value: "vip",   label: "⭐ VIP",   active: "rgba(56,189,248,0.25)",  border: "rgba(56,189,248,0.7)",  color: "#7dd3fc" },
                { value: "admin", label: "👑 Admin",  active: "rgba(212,175,55,0.25)",  border: "rgba(212,175,55,0.7)",  color: "#fde68a" },
                { value: "user",  label: "👤 User",   active: "rgba(155,89,182,0.25)", border: "rgba(155,89,182,0.7)", color: "#d8b4fe" },
              ] as const).map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setNewRole(r.value)}
                  style={{
                    flex: 1,
                    padding: "10px 6px",
                    background: newRole === r.value ? r.active : "rgba(0,0,0,0.3)",
                    border: `1px solid ${newRole === r.value ? r.border : "rgba(155,89,182,0.2)"}`,
                    color: newRole === r.value ? r.color : "rgba(230,216,255,0.5)",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 11,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    fontWeight: 600,
                    transition: "all 0.15s",
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={label}>Expiração do acesso</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {([
                { label: "7 dias", value: 7 },
                { label: "15 dias", value: 15 },
                { label: "30 dias", value: 30 },
                { label: "60 dias", value: 60 },
                { label: "90 dias", value: 90 },
                { label: "Sem limite", value: 0 },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setNewExpiry(opt.value)}
                  style={{
                    padding: "9px 6px",
                    background: newExpiry === opt.value ? "rgba(155,89,182,0.25)" : "rgba(0,0,0,0.3)",
                    border: `1px solid ${newExpiry === opt.value ? "rgba(155,89,182,0.7)" : "rgba(155,89,182,0.2)"}`,
                    color: newExpiry === opt.value ? "#fff" : "rgba(230,216,255,0.6)",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 10,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    fontWeight: 600,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {newExpiry === 0 && (
              <p style={{ marginTop: 6, fontSize: 10, color: "rgba(230,216,255,0.45)", letterSpacing: 1 }}>
                Sem data de expiração — acesso permanente.
              </p>
            )}
          </div>
          <button type="submit" disabled={creating} style={{ ...btn, opacity: creating ? 0.5 : 1 }}>
            {creating ? "Criando..." : "Criar Usuário"}
          </button>
        </form>

        <div style={panel}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#cba8ff",
              marginBottom: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Usuários Cadastrados</span>
            <span style={{ color: "rgba(230,216,255,0.45)" }}>
              {loading ? "carregando..." : `${users.length} total`}
            </span>
          </div>

          {users.length === 0 && !loading && (
            <div style={{ textAlign: "center", padding: 32, color: "rgba(230,216,255,0.4)", fontSize: 13 }}>
              Nenhum usuário cadastrado.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {users.map((u) => {
              const isMe = u.username === me.username;
              return (
                <div
                  key={u.username}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(155,89,182,0.15)",
                    borderRadius: 10,
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: u.role === "admin"
                          ? "linear-gradient(135deg, #d4af37, #6d2db5)"
                          : u.role === "vip"
                          ? "linear-gradient(135deg, #38bdf8, #6d2db5)"
                          : "linear-gradient(135deg, #9b59b6, #6d2db5)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 800,
                        color: "#fff",
                        flexShrink: 0,
                      }}
                    >
                      {u.username[0]?.toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {u.username} {isMe && <span style={{ color: "rgba(230,216,255,0.5)", fontSize: 11 }}>(você)</span>}
                      </div>
                      <div style={{
                        fontSize: 10, letterSpacing: 2, textTransform: "uppercase",
                        color: u.role === "admin" ? "#d4af37" : u.role === "vip" ? "#7dd3fc" : "rgba(230,216,255,0.55)"
                      }}>
                        {u.role === "admin" ? "👑 Admin" : u.role === "vip" ? "⭐ VIP" : "👤 User"}
                        {" · criado em "}{new Date(u.createdAt).toLocaleDateString("pt-BR")}
                        {u.lastLoginAt && ` · último login ${new Date(u.lastLoginAt).toLocaleString("pt-BR")}`}
                      </div>
                      {u.role !== "admin" && (
                        <div style={{
                          marginTop: 4,
                          fontSize: 10,
                          letterSpacing: 1.5,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "2px 8px",
                          borderRadius: 20,
                          ...(() => {
                            if (!u.accountExpiresAt) return { background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)", color: "#7dd3fc" };
                            const diff = new Date(u.accountExpiresAt).getTime() - Date.now();
                            if (diff <= 0) return { background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", color: "#fca5a5" };
                            if (diff < 3 * 86_400_000) return { background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", color: "#fcd34d" };
                            return { background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", color: "#6ee7b7" };
                          })(),
                        }}>
                          {!u.accountExpiresAt
                            ? "∞ Sem expiração"
                            : (() => {
                                const diff = new Date(u.accountExpiresAt).getTime() - Date.now();
                                if (diff <= 0) return `⛔ Expirado em ${new Date(u.accountExpiresAt).toLocaleDateString("pt-BR")}`;
                                const days = Math.floor(diff / 86_400_000);
                                return `⏳ Expira em ${days}d — ${new Date(u.accountExpiresAt).toLocaleDateString("pt-BR")}`;
                              })()
                          }
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    {!isMe && (() => {
                      const isRevoked = !!u.accountExpiresAt && new Date(u.accountExpiresAt).getTime() <= Date.now();
                      return (
                        <button
                          onClick={() => handleRevoke(u.username, isRevoked)}
                          style={{
                            padding: "8px 14px",
                            background: isRevoked ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.12)",
                            border: `1px solid ${isRevoked ? "rgba(52,211,153,0.4)" : "rgba(245,158,11,0.4)"}`,
                            color: isRevoked ? "#6ee7b7" : "#fcd34d",
                            borderRadius: 8,
                            cursor: "pointer",
                            fontSize: 11,
                            letterSpacing: 2,
                            textTransform: "uppercase",
                            fontWeight: 600,
                          }}
                        >
                          {isRevoked ? "Reativar" : "Revogar"}
                        </button>
                      );
                    })()}
                    <button
                      onClick={() => handleDelete(u.username)}
                      disabled={isMe}
                      style={{
                        padding: "8px 14px",
                        background: isMe ? "rgba(0,0,0,0.2)" : "rgba(231,76,60,0.12)",
                        border: `1px solid ${isMe ? "rgba(255,255,255,0.06)" : "rgba(231,76,60,0.4)"}`,
                        color: isMe ? "rgba(230,216,255,0.3)" : "#ff8c8c",
                        borderRadius: 8,
                        cursor: isMe ? "not-allowed" : "pointer",
                        fontSize: 11,
                        letterSpacing: 2,
                        textTransform: "uppercase",
                        fontWeight: 600,
                      }}
                    >
                      {isMe ? "—" : "Deletar"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              marginTop: 20,
              paddingTop: 14,
              borderTop: "1px solid rgba(155,89,182,0.15)",
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "rgba(230,216,255,0.4)",
            }}
          >
            <span>Lelouch · Infinity bridge</span>
            <span>by blxckxyz</span>
          </div>
        </div>
      </div>
    </div>
  );
}
