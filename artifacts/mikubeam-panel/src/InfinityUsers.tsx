import { useEffect, useState, useCallback } from "react";

const API = "/api/infinity/panel";
const SESSION_KEY = "lelouch_panel_token";

type InfUser = {
  username: string;
  role: "admin" | "vip" | "user";
  createdAt: string;
  lastLoginAt: string | null;
  accountExpiresAt: string | null;
  queryDailyLimit: number | null;
};

type Toast = { id: number; type: "ok" | "err"; text: string } | null;

function getToken(): string {
  return sessionStorage.getItem(SESSION_KEY) ?? "";
}

function saveToken(token: string): void {
  sessionStorage.setItem(SESSION_KEY, token);
}

function clearToken(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

const hdrs = () => ({
  "Content-Type": "application/json",
  "X-Panel-Token": getToken(),
});

const STYLES = `
.iu-wrap {
  padding: 16px;
  color: #e6d8ff;
  font-family: Inter, system-ui, sans-serif;
}
.iu-grid {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: 24px;
  align-items: start;
}
.iu-panel {
  background: rgba(20,12,35,0.7);
  border: 1px solid rgba(155,89,182,0.25);
  border-radius: 14px;
  padding: 24px;
  backdrop-filter: blur(12px);
}
.iu-input {
  width: 100%;
  padding: 14px;
  background: rgba(0,0,0,0.4);
  border: 1px solid rgba(155,89,182,0.35);
  border-radius: 10px;
  color: #fff;
  font-size: 16px;
  outline: none;
  box-sizing: border-box;
  -webkit-appearance: none;
  appearance: none;
}
.iu-label {
  font-size: 10px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: rgba(230,216,255,0.6);
  margin-bottom: 6px;
  display: block;
}
.iu-btn-primary {
  width: 100%;
  padding: 16px 18px;
  background: linear-gradient(135deg, #9b59b6 0%, #6d2db5 100%);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-weight: 700;
  letter-spacing: 1.4px;
  font-size: 13px;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 0 24px rgba(155,89,182,0.35);
  min-height: 50px;
  -webkit-tap-highlight-color: transparent;
}
.iu-role-row {
  display: flex;
  gap: 8px;
}
.iu-role-btn {
  flex: 1;
  padding: 12px 4px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 11px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  font-weight: 600;
  transition: all 0.15s;
  min-height: 44px;
  -webkit-tap-highlight-color: transparent;
}
.iu-expiry-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.iu-expiry-btn {
  padding: 12px 4px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
  font-weight: 600;
  transition: all 0.15s;
  min-height: 44px;
  -webkit-tap-highlight-color: transparent;
}
.iu-user-card {
  padding: 14px 16px;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(155,89,182,0.15);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.iu-user-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.iu-action-btn {
  padding: 10px 14px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 11px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  font-weight: 600;
  min-height: 40px;
  -webkit-tap-highlight-color: transparent;
}
.iu-toast {
  position: fixed;
  top: 80px;
  right: 16px;
  left: 16px;
  padding: 14px 18px;
  border-radius: 10px;
  font-size: 14px;
  z-index: 10000;
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  text-align: center;
}
.iu-section-header {
  font-size: 11px;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: #cba8ff;
  margin-bottom: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.iu-refresh-btn {
  padding: 8px 12px;
  background: rgba(155,89,182,0.15);
  border: 1px solid rgba(155,89,182,0.3);
  color: #cba8ff;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  min-height: 36px;
  -webkit-tap-highlight-color: transparent;
}
.iu-pin-screen {
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}
.iu-pin-box {
  width: 100%;
  max-width: 320px;
  background: rgba(20,12,35,0.8);
  border: 1px solid rgba(155,89,182,0.3);
  border-radius: 18px;
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  backdrop-filter: blur(16px);
}

@media (max-width: 700px) {
  .iu-wrap {
    padding: 12px 12px 32px 12px;
  }
  .iu-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .iu-panel {
    padding: 16px;
    border-radius: 12px;
  }
  .iu-input {
    font-size: 16px;
    padding: 14px 12px;
  }
  .iu-expiry-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .iu-expiry-btn {
    font-size: 11px;
    padding: 13px 4px;
    min-height: 48px;
  }
  .iu-role-btn {
    font-size: 10px;
    padding: 13px 2px;
    min-height: 48px;
  }
  .iu-btn-primary {
    min-height: 54px;
    font-size: 14px;
  }
  .iu-user-card {
    flex-direction: column;
    align-items: flex-start;
  }
  .iu-user-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .iu-action-btn {
    flex: 1;
    text-align: center;
    min-height: 44px;
    font-size: 12px;
  }
  .iu-toast {
    top: 16px;
    right: 12px;
    left: 12px;
  }
  .iu-section-header {
    flex-wrap: wrap;
    gap: 8px;
  }
}
`;

function PinScreen({ onAuth }: { onAuth: (token: string) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${API}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error ?? "PIN incorreto.");
        setPin("");
      } else {
        saveToken(data.token);
        onAuth(data.token);
      }
    } catch {
      setError("Sem conexão com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="iu-pin-screen">
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
        <div style={{ fontSize: 13, letterSpacing: 4, textTransform: "uppercase", color: "#cba8ff" }}>
          Lelouch Painel
        </div>
        <div style={{ fontSize: 11, color: "rgba(230,216,255,0.4)", marginTop: 4, letterSpacing: 1.5 }}>
          Acesso restrito — insira o PIN
        </div>
      </div>

      <form className="iu-pin-box" onSubmit={handleSubmit}>
        <div>
          <label className="iu-label">PIN de acesso</label>
          <input
            className="iu-input"
            type="password"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="••••••"
            autoComplete="current-password"
            autoFocus
            required
          />
        </div>

        {error && (
          <div style={{
            padding: "10px 14px",
            background: "rgba(231,76,60,0.12)",
            border: "1px solid rgba(231,76,60,0.4)",
            borderRadius: 8,
            color: "#ff8c8c",
            fontSize: 13,
            textAlign: "center",
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          className="iu-btn-primary"
          disabled={loading}
          style={{ opacity: loading ? 0.6 : 1 }}
        >
          {loading ? "Verificando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}

export function InfinityUsers() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<InfUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState<"vip" | "admin" | "user">("vip");
  const [newExpiry, setNewExpiry] = useState<number>(30);
  const [newLimit, setNewLimit] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [editingLimit, setEditingLimit] = useState<string | null>(null);
  const [limitInputs, setLimitInputs] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<Toast>(null);
  const [search, setSearch] = useState("");

  const showToast = (type: "ok" | "err", text: string) => {
    const id = Date.now();
    setToast({ id, type, text });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3500);
  };

  const handleExpired = useCallback(() => {
    clearToken();
    setAuthed(false);
    showToast("err", "Sessão expirada. Faça login novamente.");
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) { setAuthed(false); return; }
    fetch(`${API}/verify`, { headers: { "X-Panel-Token": token } })
      .then(r => {
        if (r.ok) setAuthed(true);
        else { clearToken(); setAuthed(false); }
      })
      .catch(() => { clearToken(); setAuthed(false); });
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/users`, { headers: hdrs() });
      if (r.status === 403) { handleExpired(); return; }
      const data = await r.json();
      if (!r.ok) { showToast("err", data?.error ?? "Falha ao carregar"); return; }
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      showToast("err", "Sem conexão com a API");
    } finally {
      setLoading(false);
    }
  }, [handleExpired]);

  useEffect(() => {
    if (authed) fetchUsers();
  }, [authed, fetchUsers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.trim() || !newPass.trim()) return;
    setCreating(true);
    try {
      const r = await fetch(`${API}/users`, {
        method: "POST",
        headers: hdrs(),
        body: JSON.stringify({ username: newUser.trim(), password: newPass, role: newRole, expiresInDays: newExpiry, queryDailyLimit: newLimit !== "" ? Number(newLimit) : null }),
      });
      if (r.status === 403) { handleExpired(); return; }
      const data = await r.json();
      if (!r.ok) { showToast("err", data?.error ?? "Falha ao criar"); }
      else {
        showToast("ok", `✅ "${newUser.trim()}" criado!`);
        setNewUser(""); setNewPass(""); setNewRole("vip"); setNewExpiry(30); setNewLimit("");
        fetchUsers();
      }
    } catch { showToast("err", "Erro de conexão"); }
    finally { setCreating(false); }
  };

  const handleDelete = async (username: string) => {
    if (!confirm(`Deletar "${username}"? Ação irreversível.`)) return;
    try {
      const r = await fetch(`${API}/users/${encodeURIComponent(username)}`, { method: "DELETE", headers: hdrs() });
      if (r.status === 403) { handleExpired(); return; }
      if (r.status === 204 || r.ok) { showToast("ok", `"${username}" removido`); fetchUsers(); }
      else { const d = await r.json().catch(() => ({})); showToast("err", d?.error ?? "Falha"); }
    } catch { showToast("err", "Erro de conexão"); }
  };

  const handleRevoke = async (username: string, isRevoked: boolean) => {
    try {
      const r = await fetch(`${API}/users/${encodeURIComponent(username)}`, {
        method: "PATCH", headers: hdrs(),
        body: JSON.stringify({ action: isRevoked ? "restore" : "revoke" }),
      });
      if (r.status === 403) { handleExpired(); return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { showToast("err", d?.error ?? "Falha"); return; }
      showToast("ok", isRevoked ? `"${username}" reativado` : `"${username}" revogado`);
      fetchUsers();
    } catch { showToast("err", "Erro de conexão"); }
  };

  const handleSetLimit = async (username: string, limitStr: string) => {
    const limitNum = limitStr === "" || Number(limitStr) <= 0 ? null : Number(limitStr);
    try {
      const r = await fetch(`${API}/users/${encodeURIComponent(username)}`, {
        method: "PATCH", headers: hdrs(),
        body: JSON.stringify({ queryDailyLimit: limitNum }),
      });
      if (r.status === 403) { handleExpired(); return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { showToast("err", d?.error ?? "Falha"); return; }
      showToast("ok", limitNum === null ? `"${username}" limite removido (padrão)` : `"${username}" limite: ${limitNum}/dia`);
      setEditingLimit(null);
      fetchUsers();
    } catch { showToast("err", "Erro de conexão"); }
  };

  const filtered = users.filter(u => u.username.toLowerCase().includes(search.toLowerCase()));

  const roleConfig = {
    vip:   { label: "⭐ VIP",   active: "rgba(56,189,248,0.25)",  border: "rgba(56,189,248,0.7)",  color: "#7dd3fc" },
    admin: { label: "👑 Admin", active: "rgba(212,175,55,0.25)",  border: "rgba(212,175,55,0.7)",  color: "#fde68a" },
    user:  { label: "👤 User",  active: "rgba(155,89,182,0.25)", border: "rgba(155,89,182,0.7)", color: "#d8b4fe" },
  };

  const expiryOpts = [
    { label: "7 dias",  value: 7 },
    { label: "15 dias", value: 15 },
    { label: "30 dias", value: 30 },
    { label: "60 dias", value: 60 },
    { label: "90 dias", value: 90 },
    { label: "∞ Livre", value: 0 },
  ] as const;

  const expiryBadge = (u: InfUser) => {
    if (u.role === "admin") return null;
    if (!u.accountExpiresAt) return { text: "∞ Sem expiração", bg: "rgba(56,189,248,0.1)", border: "rgba(56,189,248,0.3)", color: "#7dd3fc" };
    const diff = new Date(u.accountExpiresAt).getTime() - Date.now();
    if (diff <= 0) return { text: `⛔ Expirado ${new Date(u.accountExpiresAt).toLocaleDateString("pt-BR")}`, bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.4)", color: "#fca5a5" };
    if (diff < 3 * 86_400_000) return { text: `⚠ ${Math.floor(diff / 86_400_000)}d restantes`, bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.4)", color: "#fcd34d" };
    return { text: `⏳ ${Math.floor(diff / 86_400_000)}d — ${new Date(u.accountExpiresAt).toLocaleDateString("pt-BR")}`, bg: "rgba(52,211,153,0.1)", border: "rgba(52,211,153,0.3)", color: "#6ee7b7" };
  };

  if (authed === null) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "40vh", color: "rgba(230,216,255,0.4)", fontFamily: "Inter, sans-serif", letterSpacing: 2, fontSize: 12 }}>
        Verificando sessão...
      </div>
    );
  }

  if (!authed) {
    return (
      <>
        <style>{STYLES}</style>
        <PinScreen onAuth={() => setAuthed(true)} />
      </>
    );
  }

  return (
    <>
      <style>{STYLES}</style>

      {toast && (
        <div className="iu-toast" style={{
          background: toast.type === "ok" ? "rgba(46,204,113,0.15)" : "rgba(231,76,60,0.15)",
          border: `1px solid ${toast.type === "ok" ? "rgba(46,204,113,0.5)" : "rgba(231,76,60,0.5)"}`,
          color: toast.type === "ok" ? "#7ee2a8" : "#ff8c8c",
        }}>
          {toast.text}
        </div>
      )}

      <div className="iu-wrap">
        <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, letterSpacing: 4, textTransform: "uppercase" }}>
              Infinity Users
            </h2>
            <p style={{ margin: "4px 0 0", color: "rgba(230,216,255,0.5)", fontSize: 12, letterSpacing: 1.5 }}>
              Gerencie os acessos ao Infinity Search
            </p>
          </div>
          <button
            onClick={() => { clearToken(); setAuthed(false); setUsers([]); }}
            style={{
              padding: "8px 14px",
              background: "rgba(231,76,60,0.1)",
              border: "1px solid rgba(231,76,60,0.3)",
              color: "#ff8c8c",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 11,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              minHeight: 36,
            }}
          >
            Sair
          </button>
        </div>

        <div className="iu-grid">

          {/* ── Criar usuário ── */}
          <form onSubmit={handleCreate} className="iu-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: "#cba8ff" }}>
              Criar Novo Usuário
            </div>

            <div>
              <label className="iu-label">Usuário</label>
              <input
                className="iu-input" value={newUser}
                onChange={e => setNewUser(e.target.value)}
                placeholder="ex.: operador01" required
                autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              />
            </div>

            <div>
              <label className="iu-label">Senha</label>
              <input
                className="iu-input" type="password" value={newPass}
                onChange={e => setNewPass(e.target.value)}
                placeholder="senha forte" required autoComplete="new-password"
              />
            </div>

            <div>
              <label className="iu-label">Cargo</label>
              <div className="iu-role-row">
                {(["vip", "admin", "user"] as const).map(r => {
                  const cfg = roleConfig[r];
                  return (
                    <button key={r} type="button" className="iu-role-btn"
                      onClick={() => setNewRole(r)}
                      style={{
                        background: newRole === r ? cfg.active : "rgba(0,0,0,0.3)",
                        border: `1px solid ${newRole === r ? cfg.border : "rgba(155,89,182,0.2)"}`,
                        color: newRole === r ? cfg.color : "rgba(230,216,255,0.5)",
                      }}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="iu-label">Expiração</label>
              <div className="iu-expiry-grid">
                {expiryOpts.map(opt => (
                  <button key={opt.value} type="button" className="iu-expiry-btn"
                    onClick={() => setNewExpiry(opt.value)}
                    style={{
                      background: newExpiry === opt.value ? "rgba(155,89,182,0.25)" : "rgba(0,0,0,0.3)",
                      border: `1px solid ${newExpiry === opt.value ? "rgba(155,89,182,0.7)" : "rgba(155,89,182,0.2)"}`,
                      color: newExpiry === opt.value ? "#fff" : "rgba(230,216,255,0.55)",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="iu-label">Limite diário de consultas</label>
              <input
                className="iu-input"
                type="number"
                min={0}
                value={newLimit}
                onChange={e => setNewLimit(e.target.value)}
                placeholder="0 ou vazio = padrão (100)"
              />
            </div>

            <button type="submit" className="iu-btn-primary" disabled={creating}
              style={{ opacity: creating ? 0.5 : 1 }}
            >
              {creating ? "Criando..." : "✦ Criar Usuário"}
            </button>
          </form>

          {/* ── Lista de usuários ── */}
          <div className="iu-panel">
            <div className="iu-section-header">
              <span>Usuários Cadastrados</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ color: "rgba(230,216,255,0.4)", fontSize: 10 }}>
                  {loading ? "carregando..." : `${filtered.length}/${users.length}`}
                </span>
                <button className="iu-refresh-btn" onClick={fetchUsers}>↻ Atualizar</button>
              </div>
            </div>

            <input
              className="iu-input"
              style={{ marginBottom: 14 }}
              placeholder="Buscar usuário..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
            />

            {filtered.length === 0 && !loading && (
              <div style={{ textAlign: "center", padding: 32, color: "rgba(230,216,255,0.35)", fontSize: 13 }}>
                {search ? "Nenhum usuário encontrado." : "Nenhum usuário cadastrado."}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map(u => {
                const isRevoked = !!u.accountExpiresAt && new Date(u.accountExpiresAt).getTime() <= Date.now();
                const badge = expiryBadge(u);
                const rc = roleConfig[u.role] ?? roleConfig.user;
                return (
                  <div key={u.username} className="iu-user-card">
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                        background: u.role === "admin"
                          ? "linear-gradient(135deg, #d4af37, #6d2db5)"
                          : u.role === "vip"
                          ? "linear-gradient(135deg, #38bdf8, #6d2db5)"
                          : "linear-gradient(135deg, #9b59b6, #6d2db5)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontWeight: 800, color: "#fff", fontSize: 16,
                      }}>
                        {u.username[0]?.toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>
                          {u.username}
                        </div>
                        <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: rc.color }}>
                          {rc.label} · {new Date(u.createdAt).toLocaleDateString("pt-BR")}
                        </div>
                        {u.lastLoginAt && (
                          <div style={{ fontSize: 10, color: "rgba(230,216,255,0.4)", marginTop: 1 }}>
                            último login {new Date(u.lastLoginAt).toLocaleString("pt-BR")}
                          </div>
                        )}
                        {badge && (
                          <div style={{
                            marginTop: 6, fontSize: 10, letterSpacing: 1.5,
                            display: "inline-flex", alignItems: "center", gap: 5,
                            padding: "3px 10px", borderRadius: 20,
                            background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color,
                          }}>
                            {badge.text}
                          </div>
                        )}
                        {/* Limit badge + inline editor */}
                        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {editingLimit === u.username ? (
                            <>
                              <input
                                type="number"
                                min={0}
                                autoFocus
                                value={limitInputs[u.username] ?? ""}
                                onChange={e => setLimitInputs(prev => ({ ...prev, [u.username]: e.target.value }))}
                                onKeyDown={e => {
                                  if (e.key === "Enter") handleSetLimit(u.username, limitInputs[u.username] ?? "");
                                  if (e.key === "Escape") setEditingLimit(null);
                                }}
                                placeholder="0 = padrão"
                                style={{
                                  width: 90, padding: "3px 8px", background: "rgba(0,0,0,0.5)",
                                  border: "1px solid rgba(155,89,182,0.5)", borderRadius: 6,
                                  color: "#fff", fontSize: 12, outline: "none",
                                }}
                              />
                              <button
                                onClick={() => handleSetLimit(u.username, limitInputs[u.username] ?? "")}
                                style={{ padding: "3px 8px", background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.4)", color: "#6ee7b7", borderRadius: 6, cursor: "pointer", fontSize: 11 }}
                              >✓</button>
                              <button
                                onClick={() => setEditingLimit(null)}
                                style={{ padding: "3px 8px", background: "rgba(155,89,182,0.1)", border: "1px solid rgba(155,89,182,0.3)", color: "#cba8ff", borderRadius: 6, cursor: "pointer", fontSize: 11 }}
                              >✕</button>
                            </>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingLimit(u.username);
                                setLimitInputs(prev => ({ ...prev, [u.username]: u.queryDailyLimit != null ? String(u.queryDailyLimit) : "" }));
                              }}
                              style={{
                                padding: "3px 10px", borderRadius: 20, fontSize: 10, letterSpacing: 1.5,
                                background: u.queryDailyLimit != null ? "rgba(139,92,246,0.15)" : "rgba(100,116,139,0.1)",
                                border: `1px solid ${u.queryDailyLimit != null ? "rgba(139,92,246,0.4)" : "rgba(100,116,139,0.3)"}`,
                                color: u.queryDailyLimit != null ? "#c4b5fd" : "rgba(230,216,255,0.35)",
                                cursor: "pointer",
                              }}
                            >
                              {u.queryDailyLimit != null ? `⚡ ${u.queryDailyLimit}/dia` : "⚡ padrão (100/dia)"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="iu-user-actions">
                      {u.role !== "admin" && (
                        <button className="iu-action-btn" onClick={() => handleRevoke(u.username, isRevoked)}
                          style={{
                            background: isRevoked ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.12)",
                            border: `1px solid ${isRevoked ? "rgba(52,211,153,0.4)" : "rgba(245,158,11,0.4)"}`,
                            color: isRevoked ? "#6ee7b7" : "#fcd34d",
                          }}
                        >
                          {isRevoked ? "Reativar" : "Revogar"}
                        </button>
                      )}
                      <button className="iu-action-btn" onClick={() => handleDelete(u.username)}
                        style={{
                          background: "rgba(231,76,60,0.12)",
                          border: "1px solid rgba(231,76,60,0.4)",
                          color: "#ff8c8c",
                        }}
                      >
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
    </>
  );
}
