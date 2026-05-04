import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useInfinityMe,
  useInfinityListUsers,
  useInfinityCreateUser,
  useInfinityDeleteUser,
  useInfinityLogout,
  getInfinityListUsersQueryKey,
  getInfinityMeQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ShieldAlert, UserPlus, Trash2, LogOut, User as UserIcon, Crown, Calendar, Shield, Clock, X, Check, Bell, Send, KeyRound, Eye, EyeOff } from "lucide-react";

const ROLE_CONFIG = {
  admin: { label: "Admin",  color: "text-sky-300",      bg: "bg-sky-400/10 border-sky-400/30",      icon: Shield   },
  vip:   { label: "VIP",   color: "text-amber-300",    bg: "bg-amber-400/10 border-amber-400/30",  icon: Crown    },
  user:  { label: "Membro", color: "text-emerald-300", bg: "bg-emerald-400/10 border-emerald-400/30", icon: UserIcon },
};

function getRoleConf(role: string) {
  return ROLE_CONFIG[role as keyof typeof ROLE_CONFIG] ?? ROLE_CONFIG.vip;
}

function ExpiryEditor({ username, currentExpiry, onSaved }: { username: string; currentExpiry: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [dateVal, setDateVal] = useState(() => {
    if (!currentExpiry) return "";
    return new Date(currentExpiry).toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveExpiry = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("infinity_token");
      await fetch(`/api/infinity/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ expiresAt: dateVal || null }),
      });
      setSaved(true);
      setTimeout(() => { setSaved(false); setEditing(false); onSaved(); }, 1000);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const removeExpiry = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("infinity_token");
      await fetch(`/api/infinity/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ expiresAt: null }),
      });
      setDateVal("");
      setSaved(true);
      setTimeout(() => { setSaved(false); setEditing(false); onSaved(); }, 1000);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-amber-300 transition-colors"
      >
        <Calendar className="w-3 h-3" />
        {currentExpiry
          ? new Date(currentExpiry).toLocaleDateString("pt-BR")
          : "Sem expiração"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="datetime-local"
        value={dateVal}
        onChange={(e) => setDateVal(e.target.value)}
        className="bg-black/60 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-amber-400/50 transition-colors"
      />
      <button
        onClick={saveExpiry}
        disabled={saving}
        className="p-1.5 rounded-lg bg-emerald-400/10 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/20 transition-colors disabled:opacity-50"
      >
        {saving ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" /> : saved ? <Check className="w-3 h-3" /> : <Check className="w-3 h-3 opacity-0 w-0" />}
      </button>
      {currentExpiry && (
        <button
          onClick={removeExpiry}
          disabled={saving}
          className="p-1.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
          title="Remover expiração"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      <button
        onClick={() => setEditing(false)}
        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        cancelar
      </button>
    </div>
  );
}

function PasswordEditor({ username }: { username: string }) {
  const [editing, setEditing] = useState(false);
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setEditing(false);
    setNewPass("");
    setConfirm("");
    setError("");
    setShowPass(false);
  };

  const handleSave = async () => {
    setError("");
    if (newPass.length < 6) { setError("Mínimo 6 caracteres"); return; }
    if (newPass !== confirm) { setError("Senhas não coincidem"); return; }
    setSaving(true);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch(`/api/infinity/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: newPass }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? "Falha ao salvar");
      }
      setSaved(true);
      setTimeout(() => { setSaved(false); reset(); }, 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-sky-300 transition-colors"
      >
        <KeyRound className="w-3 h-3" />
        Trocar Senha
      </button>
    );
  }

  return (
    <div className="mt-3 p-3 rounded-xl border border-sky-400/20 bg-sky-400/5 space-y-2">
      <p className="text-[10px] uppercase tracking-[0.3em] text-sky-300 flex items-center gap-1.5">
        <KeyRound className="w-3 h-3" /> Nova senha para <strong>{username}</strong>
      </p>
      <div className="relative">
        <input
          type={showPass ? "text" : "password"}
          value={newPass}
          onChange={(e) => setNewPass(e.target.value)}
          placeholder="Nova senha (mín. 6 caracteres)"
          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm pr-9 focus:outline-none focus:border-sky-400/50 transition-all"
        />
        <button
          type="button"
          onClick={() => setShowPass((v) => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
      <input
        type={showPass ? "text" : "password"}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirmar senha"
        onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400/50 transition-all"
      />
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <X className="w-3 h-3" /> {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving || !newPass || !confirm}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-400/15 border border-sky-400/40 text-sky-300 text-xs font-bold uppercase tracking-widest hover:bg-sky-400/25 transition-colors disabled:opacity-50"
        >
          {saved ? <Check className="w-3 h-3" /> : <KeyRound className="w-3 h-3" />}
          {saved ? "Salvo!" : saving ? "Salvando..." : "Confirmar"}
        </button>
        <button
          onClick={reset}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors uppercase tracking-widest"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

interface InfinityNotif {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  authorName: string;
}

export default function Configuracoes() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: me } = useInfinityMe({ query: { queryKey: getInfinityMeQueryKey() } });

  const isAdmin = me?.role === "admin";

  const { data: users, refetch: refetchUsers } = useInfinityListUsers({
    query: {
      queryKey: getInfinityListUsersQueryKey(),
      enabled: isAdmin,
    },
  });

  const createUser = useInfinityCreateUser();
  const deleteUser = useInfinityDeleteUser();
  const logout = useInfinityLogout();

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "vip">("vip");
  const [expiresAt, setExpiresAt] = useState("");
  const [formError, setFormError] = useState("");

  // ── Notifications state ────────────────────────────────────────────────────
  const [notifs, setNotifs] = useState<InfinityNotif[]>([]);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifBody, setNotifBody] = useState("");
  const [notifSending, setNotifSending] = useState(false);
  const [notifSuccess, setNotifSuccess] = useState(false);
  const [notifError, setNotifError] = useState("");

  const loadNotifs = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/notifications", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (r.ok) setNotifs(await r.json());
    } catch {}
  }, [isAdmin]);

  useEffect(() => { void loadNotifs(); }, [loadNotifs]);

  const handleSendNotif = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotifError("");
    if (!notifTitle.trim() || !notifBody.trim()) return;
    setNotifSending(true);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ title: notifTitle.trim(), body: notifBody.trim() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? "Falha ao enviar");
      }
      setNotifTitle("");
      setNotifBody("");
      setNotifSuccess(true);
      setTimeout(() => setNotifSuccess(false), 2500);
      await loadNotifs();
    } catch (err: any) {
      setNotifError(err?.message ?? "Falha ao enviar novidade");
    } finally {
      setNotifSending(false);
    }
  };

  const handleDeleteNotif = async (id: string) => {
    try {
      const token = localStorage.getItem("infinity_token");
      await fetch(`/api/infinity/notifications/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      await loadNotifs();
    } catch {}
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!newUsername.trim() || !newPassword.trim()) return;
    try {
      await createUser.mutateAsync({
        data: {
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
          ...(expiresAt ? { expiresAt } : {}),
        } as any,
      });
      setNewUsername("");
      setNewPassword("");
      setNewRole("vip");
      setExpiresAt("");
      queryClient.invalidateQueries({ queryKey: getInfinityListUsersQueryKey() });
    } catch (err: any) {
      setFormError(err?.data?.message || err?.message || "Falha ao criar operador");
    }
  };

  const handleDelete = async (username: string) => {
    if (username === me?.username) return;
    if (!confirm(`Remover operador "${username}"? Esta ação é irreversível.`)) return;
    try {
      await deleteUser.mutateAsync({ username });
      queryClient.invalidateQueries({ queryKey: getInfinityListUsersQueryKey() });
    } catch {
      // silent
    }
  };

  const handleLogout = async () => {
    try { await logout.mutateAsync(); } catch {}
    localStorage.removeItem("infinity_token");
    setLocation("/login");
  };

  const meRoleConf = getRoleConf(me?.role ?? "vip");
  const MeRoleIcon = meRoleConf.icon;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div>
        <motion.h1
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl sm:text-3xl font-bold tracking-[0.25em] uppercase bg-gradient-to-r from-sky-300 to-cyan-200 bg-clip-text text-transparent"
        >
          Configurações
        </motion.h1>
        <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-2">
          Gerência de operadores e sessão
        </p>
      </div>

      {/* Current session */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6"
      >
        <div className="flex items-center gap-2 mb-4">
          <UserIcon className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Sessão Atual</h2>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500/20 to-cyan-400/10 border border-white/10 flex items-center justify-center">
              <span className="text-xl font-bold text-sky-300">{me?.username?.[0]?.toUpperCase() ?? "?"}</span>
            </div>
            <div>
              <div className="text-lg font-bold">{me?.username}</div>
              <div className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold mt-1 px-2.5 py-1 rounded-full border ${meRoleConf.bg} ${meRoleConf.color}`}>
                <MeRoleIcon className="w-3 h-3" />
                {meRoleConf.label}
              </div>
              {(me as any)?.lastLoginAt && (
                <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Último acesso: {new Date((me as any).lastLoginAt).toLocaleString("pt-BR")}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors uppercase tracking-widest text-xs font-bold"
          >
            <LogOut className="w-4 h-4" /> Encerrar Sessão
          </button>
        </div>
      </motion.div>

      {!isAdmin ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-12 flex flex-col items-center text-center"
        >
          <ShieldAlert className="w-12 h-12 text-destructive/70 mb-4" />
          <h3 className="text-lg font-bold uppercase tracking-widest">Acesso Restrito</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-md">
            A gerência de operadores está disponível apenas para administradores.
          </p>
        </motion.div>
      ) : (
        <>
          {/* ── Novidades / Notifications ──────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6"
          >
            <div className="flex items-center gap-2 mb-5">
              <Bell className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Novidades & Atualizações</h2>
            </div>

            {/* Send form */}
            <form onSubmit={handleSendNotif} className="space-y-3 mb-6">
              <input
                value={notifTitle}
                onChange={e => setNotifTitle(e.target.value)}
                placeholder="Título da novidade..."
                maxLength={120}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-all"
              />
              <textarea
                value={notifBody}
                onChange={e => setNotifBody(e.target.value)}
                placeholder="Descreva a atualização ou novidade para os operadores..."
                rows={3}
                maxLength={1000}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-all resize-none"
              />
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={notifSending || !notifTitle.trim() || !notifBody.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-[0.25em] text-black transition-all disabled:opacity-50"
                  style={{ background: "var(--color-primary)" }}
                >
                  <Send className="w-3.5 h-3.5" />
                  {notifSending ? "Enviando..." : "Publicar Novidade"}
                </button>
                {notifSuccess && (
                  <motion.span
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1 text-xs text-emerald-400"
                  >
                    <Check className="w-3.5 h-3.5" /> Publicado!
                  </motion.span>
                )}
              </div>
              {notifError && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3">{notifError}</div>
              )}
            </form>

            {/* Existing notifications */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground mb-3">
                Publicadas ({notifs.length})
              </p>
              {notifs.length === 0 ? (
                <div className="rounded-xl border border-white/5 bg-black/20 px-4 py-6 text-center text-xs text-muted-foreground">
                  Nenhuma novidade publicada ainda.
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence>
                    {notifs.map((n, i) => (
                      <motion.div
                        key={n.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 8 }}
                        transition={{ delay: i * 0.03 }}
                        className="rounded-xl border border-white/5 bg-black/20 p-4 flex items-start gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold text-foreground truncate">{n.title}</span>
                            <span className="text-[9px] text-muted-foreground/50 shrink-0">
                              {new Date(n.createdAt).toLocaleString("pt-BR")}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap">{n.body}</p>
                          <p className="text-[9px] text-muted-foreground/40 mt-1.5 uppercase tracking-wider">por {n.authorName}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteNotif(n.id)}
                          className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors border border-transparent hover:border-destructive/30"
                          title="Remover"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>

          {/* Create user */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6"
          >
            <div className="flex items-center gap-2 mb-5">
              <UserPlus className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Novo Operador</h2>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Usuário"
                  className="bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-all"
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Senha"
                  className="bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-all"
                />
              </div>

              {/* Role selector */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setNewRole("vip")}
                  className={`flex-1 flex items-center gap-2 justify-center px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
                    newRole === "vip"
                      ? "bg-amber-400/15 border-amber-400/50 text-amber-300 shadow-[0_0_20px_-4px_rgba(251,191,36,0.4)]"
                      : "bg-white/5 border-white/10 text-muted-foreground hover:border-white/20"
                  }`}
                >
                  <Crown className="w-4 h-4" /> VIP
                </button>
                <button
                  type="button"
                  onClick={() => setNewRole("admin")}
                  className={`flex-1 flex items-center gap-2 justify-center px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
                    newRole === "admin"
                      ? "bg-sky-400/15 border-sky-400/50 text-sky-300 shadow-[0_0_20px_-4px_rgba(56,189,248,0.4)]"
                      : "bg-white/5 border-white/10 text-muted-foreground hover:border-white/20"
                  }`}
                >
                  <Shield className="w-4 h-4" /> Admin
                </button>
              </div>

              {/* Expiry date */}
              <div>
                <label className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground block mb-2 flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" /> Data de expiração (opcional)
                </label>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-all"
                />
                {expiresAt && (
                  <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Conta expira em {new Date(expiresAt).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={createUser.isPending || !newUsername.trim() || !newPassword.trim()}
                className="w-full bg-gradient-to-r from-sky-500 to-cyan-400 text-black font-bold uppercase tracking-[0.3em] text-xs py-3.5 rounded-xl hover:shadow-[0_0_30px_rgba(56,189,248,0.4)] transition-all disabled:opacity-50"
              >
                {createUser.isPending ? "Criando..." : "Criar Operador"}
              </button>

              {formError && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3">{formError}</div>
              )}
            </form>
          </motion.div>

          {/* Operator list */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6"
          >
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-5">
              Operadores Ativos ({users?.length ?? 0})
            </h2>
            <div className="space-y-2">
              <AnimatePresence>
                {users?.map((u, i) => {
                  const rConf = getRoleConf(u.role);
                  const RIcon = rConf.icon;
                  const isExpired = (u as any).accountExpiresAt && new Date((u as any).accountExpiresAt) < new Date();
                  return (
                    <motion.div
                      key={u.username}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ delay: i * 0.03 }}
                      className={`rounded-xl border p-4 transition-colors ${isExpired ? "bg-destructive/5 border-destructive/20" : "bg-black/30 border-white/5 hover:border-white/15"}`}
                    >
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-500/20 to-cyan-400/10 border border-white/10 flex items-center justify-center shrink-0">
                            <span className="text-sm font-bold">{u.username[0]?.toUpperCase()}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold truncate flex items-center gap-2">
                              {u.username}
                              {u.username === me?.username && (
                                <span className="text-[9px] text-muted-foreground">(você)</span>
                              )}
                              {isExpired && (
                                <span className="text-[9px] text-destructive bg-destructive/10 border border-destructive/20 px-1.5 py-0.5 rounded-md uppercase tracking-wider">expirado</span>
                              )}
                            </div>
                            <div className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-semibold mt-1 px-2 py-0.5 rounded-full border ${rConf.bg} ${rConf.color}`}>
                              <RIcon className="w-2.5 h-2.5" />
                              {rConf.label}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0 flex-wrap">
                          <div className="text-xs text-muted-foreground text-right space-y-1">
                            <div>Criado: {new Date(u.createdAt).toLocaleDateString("pt-BR")}</div>
                            {u.lastLoginAt && (
                              <div>Último acesso: {new Date(u.lastLoginAt).toLocaleDateString("pt-BR")}</div>
                            )}
                            <ExpiryEditor
                              username={u.username}
                              currentExpiry={(u as any).accountExpiresAt ?? null}
                              onSaved={() => {
                                queryClient.invalidateQueries({ queryKey: getInfinityListUsersQueryKey() });
                                refetchUsers();
                              }}
                            />
                            <PasswordEditor username={u.username} />
                          </div>
                          <button
                            disabled={u.username === me?.username || deleteUser.isPending}
                            onClick={() => handleDelete(u.username)}
                            className="p-2.5 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed border border-transparent hover:border-destructive/30"
                            title={u.username === me?.username ? "Não é possível remover a si mesmo" : "Remover"}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}
