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
import { ShieldAlert, UserPlus, Trash2, LogOut, User as UserIcon, Crown, Calendar, Shield, Clock, X, Check, Bell, Send, KeyRound, Eye, EyeOff, Hash, RefreshCw, Lock } from "lucide-react";

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
  const [saveErr, setSaveErr] = useState(false);

  const saveExpiry = async () => {
    setSaving(true);
    setSaveErr(false);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch(`/api/infinity/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ expiresAt: dateVal || null }),
      });
      if (!r.ok) throw new Error();
      setSaved(true);
      setTimeout(() => { setSaved(false); setEditing(false); onSaved(); }, 1000);
    } catch {
      setSaveErr(true);
      setTimeout(() => setSaveErr(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const removeExpiry = async () => {
    setSaving(true);
    setSaveErr(false);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch(`/api/infinity/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ expiresAt: null }),
      });
      if (!r.ok) throw new Error();
      setDateVal("");
      setSaved(true);
      setTimeout(() => { setSaved(false); setEditing(false); onSaved(); }, 1000);
    } catch {
      setSaveErr(true);
      setTimeout(() => setSaveErr(false), 2500);
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
        className={`p-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
          saveErr
            ? "bg-destructive/10 border-destructive/30 text-destructive"
            : "bg-emerald-400/10 border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/20"
        }`}
        title={saveErr ? "Erro ao salvar" : "Salvar"}
      >
        {saving
          ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" />
          : saveErr
          ? <X className="w-3 h-3" />
          : <Check className="w-3 h-3" />}
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

function RoleEditor({ username, currentRole, isMe, onSaved }: { username: string; currentRole: string; isMe: boolean; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (isMe) return null;

  const changeRole = async (newRole: string) => {
    if (newRole === currentRole || saving) return;
    setSaving(true);
    try {
      const token = localStorage.getItem("infinity_token");
      await fetch(`/api/infinity/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: newRole }),
      });
      setSaved(true);
      setTimeout(() => { setSaved(false); onSaved(); }, 1200);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const roles: Array<{ key: string; label: string; color: string; activeBg: string }> = [
    { key: "user",  label: "Membro", color: "text-emerald-300", activeBg: "bg-emerald-400/15 border-emerald-400/45" },
    { key: "vip",   label: "VIP",    color: "text-amber-300",   activeBg: "bg-amber-400/15 border-amber-400/45"   },
    { key: "admin", label: "Admin",  color: "text-sky-300",     activeBg: "bg-sky-400/15 border-sky-400/45"       },
  ];

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {saved && (
        <span className="flex items-center gap-0.5 text-[9px] text-emerald-400 font-semibold">
          <Check className="w-2.5 h-2.5" /> Salvo
        </span>
      )}
      {!saved && roles.map((r) => {
        const isActive = currentRole === r.key;
        return (
          <button
            key={r.key}
            onClick={() => changeRole(r.key)}
            disabled={saving || isActive}
            title={`Mudar cargo para ${r.label}`}
            className={`flex items-center gap-1 text-[9px] px-2 py-0.5 rounded border uppercase tracking-wider font-bold transition-all ${
              isActive
                ? `${r.activeBg} ${r.color} cursor-default`
                : "bg-white/5 border-white/10 text-muted-foreground hover:border-white/25 hover:text-foreground disabled:opacity-50"
            }`}
          >
            {r.label}
          </button>
        );
      })}
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
  const [newPin, setNewPin] = useState("");
  const [formError, setFormError] = useState("");

  // ── PINs state ─────────────────────────────────────────────────────────────
  interface PinRow { pin: string; createdAt: string; createdBy: string; usedAt: string | null; usedBy: string | null; }
  const [pins, setPins] = useState<PinRow[]>([]);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [pinCustom, setPinCustom] = useState("");
  const [pinGenErr, setPinGenErr] = useState("");
  const [pinGenOk, setPinGenOk] = useState(false);

  const loadPins = useCallback(async () => {
    if (!isAdmin) return;
    setPinsLoading(true);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/pins", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (r.ok) setPins(await r.json());
    } catch {} finally { setPinsLoading(false); }
  }, [isAdmin]);

  useEffect(() => { void loadPins(); }, [loadPins]);

  const handleGenPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinGenErr("");
    setPinGenOk(false);
    const body = pinCustom.trim() ? { pin: pinCustom.trim() } : {};
    const token = localStorage.getItem("infinity_token");
    const r = await fetch("/api/infinity/pins", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({})) as { error?: string };
      setPinGenErr(j.error ?? "Falha ao criar PIN");
      return;
    }
    setPinCustom("");
    setPinGenOk(true);
    setTimeout(() => setPinGenOk(false), 2000);
    await loadPins();
  };

  const handleDeletePin = async (pin: string) => {
    const token = localStorage.getItem("infinity_token");
    await fetch(`/api/infinity/pins/${encodeURIComponent(pin)}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    await loadPins();
  };

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
    if (!/^\d{4}$/.test(newPin)) {
      setFormError("PIN de 4 dígitos obrigatório");
      return;
    }
    try {
      await createUser.mutateAsync({
        data: {
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
          pin: newPin,
          ...(expiresAt ? { expiresAt } : {}),
        } as any,
      });
      setNewUsername("");
      setNewPassword("");
      setNewRole("vip");
      setExpiresAt("");
      setNewPin("");
      queryClient.invalidateQueries({ queryKey: getInfinityListUsersQueryKey() });
      await loadPins();
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

              {/* PIN obrigatório */}
              <div>
                <label className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground block mb-2 flex items-center gap-1.5">
                  <Lock className="w-3 h-3" /> PIN de autorização <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="4 dígitos"
                  className={`w-full bg-black/40 border rounded-xl px-4 py-3 text-sm font-mono tracking-widest focus:outline-none transition-all ${
                    newPin.length === 4 ? "border-emerald-400/40 focus:border-emerald-400/60" : "border-white/10 focus:border-primary/50"
                  }`}
                />
                <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                  <Hash className="w-3 h-3" /> Gere um PIN na seção abaixo e use aqui. Cada PIN só funciona uma vez.
                </p>
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
                disabled={createUser.isPending || !newUsername.trim() || !newPassword.trim() || newPin.length !== 4}
                className="w-full bg-gradient-to-r from-sky-500 to-cyan-400 text-black font-bold uppercase tracking-[0.3em] text-xs py-3.5 rounded-xl hover:shadow-[0_0_30px_rgba(56,189,248,0.4)] transition-all disabled:opacity-50"
              >
                {createUser.isPending ? "Criando..." : "Criar Operador"}
              </button>

              {formError && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3">{formError}</div>
              )}
            </form>
          </motion.div>

          {/* ── PIN Management ─────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">PINs de Autorização</h2>
              </div>
              <button
                onClick={() => void loadPins()}
                disabled={pinsLoading}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-40"
                title="Atualizar lista"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${pinsLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* Generate form */}
            <form onSubmit={handleGenPin} className="flex items-center gap-3 mb-5">
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={pinCustom}
                onChange={(e) => setPinCustom(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="PIN personalizado (opcional)"
                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:border-primary/50 transition-all"
              />
              <button
                type="submit"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-[0.2em] text-black transition-all whitespace-nowrap"
                style={{ background: "var(--color-primary)" }}
              >
                {pinGenOk ? <Check className="w-3.5 h-3.5" /> : <Hash className="w-3.5 h-3.5" />}
                {pinGenOk ? "Criado!" : pinCustom.length === 4 ? "Criar PIN" : "Gerar Aleatório"}
              </button>
            </form>
            {pinGenErr && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 mb-4">{pinGenErr}</div>
            )}

            {/* PIN list */}
            <div className="space-y-2">
              {pins.length === 0 ? (
                <div className="rounded-xl border border-white/5 bg-black/20 px-4 py-6 text-center text-xs text-muted-foreground">
                  Nenhum PIN criado ainda. Gere um acima para liberar a criação de contas.
                </div>
              ) : (
                <AnimatePresence>
                  {pins.map((p, i) => {
                    const used = p.usedAt !== null;
                    return (
                      <motion.div
                        key={p.pin}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 8 }}
                        transition={{ delay: i * 0.03 }}
                        className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${
                          used
                            ? "bg-white/3 border-white/5 opacity-60"
                            : "bg-emerald-400/5 border-emerald-400/20"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`font-mono font-bold text-lg tracking-[0.4em] ${used ? "text-muted-foreground" : "text-emerald-300"}`}>
                            {p.pin}
                          </span>
                          <div className="min-w-0">
                            {used ? (
                              <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-muted-foreground">
                                <Check className="w-2.5 h-2.5" /> Usado por {p.usedBy}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-emerald-400/10 border border-emerald-400/25 text-emerald-400">
                                Disponível
                              </span>
                            )}
                            <div className="text-[9px] text-muted-foreground/50 mt-0.5">
                              Criado por {p.createdBy} • {new Date(p.createdAt).toLocaleString("pt-BR")}
                            </div>
                          </div>
                        </div>
                        {!used && (
                          <button
                            onClick={() => void handleDeletePin(p.pin)}
                            className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors border border-transparent hover:border-destructive/30"
                            title="Remover PIN"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
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
                            <div className="mt-1.5 pt-1.5 border-t border-white/5">
                              <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground mb-1">Cargo</p>
                              <RoleEditor
                                username={u.username}
                                currentRole={u.role}
                                isMe={u.username === me?.username}
                                onSaved={() => {
                                  queryClient.invalidateQueries({ queryKey: getInfinityListUsersQueryKey() });
                                  refetchUsers();
                                }}
                              />
                            </div>
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
