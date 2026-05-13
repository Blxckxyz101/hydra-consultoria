import { useState, useEffect, useCallback, useRef } from "react";
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
import { ShieldAlert, UserPlus, Trash2, LogOut, User as UserIcon, Crown, Calendar, Shield, Clock, X, Check, Bell, Send, KeyRound, Eye, EyeOff, Hash, RefreshCw, Lock, Pencil, RotateCcw, ImagePlus, Loader2, Radio, ShoppingBag, Zap, CreditCard, ChevronRight, Smartphone, ScanLine, QrCode, Tag, ToggleLeft, ToggleRight } from "lucide-react";
import QRCode from "qrcode";


function TotpSection() {
  const [status, setStatus] = useState<"idle" | "loading" | "enabled" | "disabled">("idle");
  const [phase, setPhase] = useState<"none" | "setup" | "confirm-enable" | "confirm-disable">("none");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [secretB32, setSecretB32] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const token = localStorage.getItem("infinity_token") ?? "";
  const headers = { Authorization: `Bearer ${token}` };

  const fetchStatus = useCallback(async () => {
    setStatus("loading");
    try {
      const r = await fetch("/api/infinity/totp/status", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" });
      if (r.ok) { const d = await r.json() as { enabled: boolean }; setStatus(d.enabled ? "enabled" : "disabled"); }
    } catch { setStatus("disabled"); }
  }, []);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  const startSetup = async () => {
    setMsg(null); setSaving(true);
    try {
      const r = await fetch("/api/infinity/totp/setup", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok) { setMsg({ text: "Erro ao configurar 2FA", ok: false }); return; }
      const d = await r.json() as { uri: string; secret: string };
      setSecretB32(d.secret);
      const dataUrl = await QRCode.toDataURL(d.uri, { width: 200, margin: 1, color: { dark: "#fff", light: "#00000000" } });
      setQrDataUrl(dataUrl);
      setPhase("setup");
      setCode("");
    } catch { setMsg({ text: "Erro de conexão", ok: false }); }
    finally { setSaving(false); }
  };

  const handleEnable = async () => {
    if (!/^\d{6}$/.test(code)) { setMsg({ text: "Código deve ter 6 dígitos", ok: false }); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/infinity/totp/enable", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (r.ok && d.ok) {
        setMsg({ text: "2FA ativado com sucesso!", ok: true });
        setPhase("none"); setStatus("enabled"); setCode(""); setQrDataUrl("");
      } else {
        setMsg({ text: d.error ?? "Código incorreto", ok: false });
      }
    } catch { setMsg({ text: "Erro de conexão", ok: false }); }
    finally { setSaving(false); }
  };

  const handleDisable = async () => {
    if (!/^\d{6}$/.test(code)) { setMsg({ text: "Código deve ter 6 dígitos", ok: false }); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/infinity/totp/disable", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (r.ok && d.ok) {
        setMsg({ text: "2FA desativado.", ok: true });
        setPhase("none"); setStatus("disabled"); setCode("");
      } else {
        setMsg({ text: d.error ?? "Código incorreto", ok: false });
      }
    } catch { setMsg({ text: "Erro de conexão", ok: false }); }
    finally { setSaving(false); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: status === "enabled" ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)", border: status === "enabled" ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(255,255,255,0.08)" }}>
            <Smartphone className="w-5 h-5" style={{ color: status === "enabled" ? "#4ade80" : "var(--color-muted-foreground)" }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Autenticação de 2 Fatores</h2>
              {status === "enabled" && (
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-400 uppercase tracking-widest font-semibold">Ativo</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground/50 mt-0.5">
              {status === "enabled"
                ? "Proteção extra: código TOTP necessário ao fazer login."
                : "Proteja sua conta com um aplicativo autenticador (Google Authenticator, Authy, etc.)."
              }
            </p>
          </div>
        </div>
        {status === "loading" && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />}
        {status === "disabled" && phase === "none" && (
          <button onClick={startSetup} disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50"
            style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)", color: "var(--color-primary)" }}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
            Ativar 2FA
          </button>
        )}
        {status === "enabled" && phase === "none" && (
          <button onClick={() => { setPhase("confirm-disable"); setCode(""); setMsg(null); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border border-destructive/30 text-destructive hover:bg-destructive/10">
            <X className="w-3.5 h-3.5" /> Desativar
          </button>
        )}
      </div>

      <AnimatePresence>
        {phase === "setup" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="mt-5 pt-5 border-t border-white/5 space-y-4">
            <div className="flex items-start gap-5 flex-wrap">
              {qrDataUrl && (
                <div className="flex flex-col items-center gap-2">
                  <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                    <img src={qrDataUrl} alt="QR Code" className="w-36 h-36 rounded-xl" />
                  </div>
                  <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/50">
                    <QrCode className="w-3 h-3" /> Escaneie com seu app
                  </div>
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground/60 mb-1.5">Chave manual</p>
                  <div className="font-mono text-xs bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 break-all text-muted-foreground/70 select-all">{secretB32}</div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground/60 mb-1.5">Código do app (6 dígitos)</p>
                  <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric" maxLength={6} autoFocus
                    placeholder="······"
                    className="w-full font-mono text-center text-xl tracking-[0.5em] bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/20 placeholder:tracking-[0.5em]"
                    onKeyDown={e => { if (e.key === "Enter") void handleEnable(); }}
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleEnable} disabled={saving || code.length !== 6}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-40"
                    style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", color: "#4ade80" }}>
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Confirmar e ativar
                  </button>
                  <button onClick={() => { setPhase("none"); setCode(""); setMsg(null); }}
                    className="px-4 py-2.5 rounded-xl text-xs border border-white/10 text-muted-foreground hover:bg-white/5 transition-colors">
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {phase === "confirm-disable" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="mt-5 pt-5 border-t border-white/5 space-y-3">
            <p className="text-xs text-muted-foreground/70">Insira o código atual do seu app autenticador para desativar o 2FA:</p>
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" maxLength={6} autoFocus placeholder="······"
              className="w-full font-mono text-center text-xl tracking-[0.5em] bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/20 placeholder:tracking-[0.5em]"
              onKeyDown={e => { if (e.key === "Enter") void handleDisable(); }}
            />
            <div className="flex gap-2">
              <button onClick={handleDisable} disabled={saving || code.length !== 6}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest border border-destructive/30 text-destructive hover:bg-destructive/10 transition-all disabled:opacity-40">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                Desativar 2FA
              </button>
              <button onClick={() => { setPhase("none"); setCode(""); setMsg(null); }}
                className="px-4 py-2.5 rounded-xl text-xs border border-white/10 text-muted-foreground hover:bg-white/5 transition-colors">
                Cancelar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {msg && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className={`mt-4 px-4 py-2.5 rounded-xl text-xs border font-medium flex items-center gap-2 ${msg.ok ? "bg-green-500/10 border-green-500/30 text-green-300" : "bg-destructive/10 border-destructive/30 text-destructive"}`}>
          {msg.ok ? <Check className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
          {msg.text}
        </motion.div>
      )}
    </motion.div>
  );
}

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

// ─── DisplayNameEditor ────────────────────────────────────────────────────────
function DisplayNameEditor({ username, currentName, onSaved }: { username: string; currentName: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(currentName ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch(`/api/infinity/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName: val.trim() || null }),
      });
      if (!r.ok) { const d = await r.json() as { error?: string }; throw new Error(d.error ?? "Erro"); }
      setSaved(true);
      setTimeout(() => { setSaved(false); setEditing(false); onSaved(); }, 900);
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro"); }
    finally { setSaving(false); }
  };

  if (!editing) {
    return (
      <button onClick={() => { setVal(currentName ?? ""); setEditing(true); }} className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">
        <Pencil className="w-2.5 h-2.5" />
        {currentName ? currentName : "Sem nome"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 mt-1">
      <div className="flex items-center gap-1.5">
        <input
          value={val}
          onChange={e => setVal(e.target.value)}
          maxLength={50}
          className="bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary/50 transition-colors w-32"
          placeholder="Nome de perfil"
          onKeyDown={e => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}
          autoFocus
        />
        <button onClick={() => void save()} disabled={saving} className={`p-1.5 rounded-lg border transition-colors ${saved ? "border-emerald-400/40 text-emerald-400" : "border-white/10 text-muted-foreground hover:text-primary hover:border-primary/30"} disabled:opacity-50`}>
          <Check className="w-2.5 h-2.5" />
        </button>
        <button onClick={() => setEditing(false)} className="p-1.5 rounded-lg border border-white/10 text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-2.5 h-2.5" />
        </button>
      </div>
      {err && <span className="text-[9px] text-destructive">{err}</span>}
    </div>
  );
}

// ─── PinResetEditor ───────────────────────────────────────────────────────────
function PinResetEditor({ username, onReset }: { username: string; onReset: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const reset = async () => {
    setResetting(true); setErr("");
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch(`/api/infinity/users/${encodeURIComponent(username)}/reset-pin`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error();
      setDone(true);
      setTimeout(() => { setDone(false); setConfirming(false); onReset(); }, 1200);
    } catch { setErr("Erro ao resetar PIN"); }
    finally { setResetting(false); }
  };

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-amber-300 transition-colors">
        <RotateCcw className="w-2.5 h-2.5" /> Resetar PIN
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-amber-300 uppercase tracking-widest">Confirmar?</span>
        <button onClick={() => void reset()} disabled={resetting} className={`p-1.5 rounded-lg border transition-colors text-[9px] px-2 ${done ? "border-emerald-400/40 text-emerald-400" : "border-amber-400/30 text-amber-300 hover:bg-amber-400/10"} disabled:opacity-50`}>
          {done ? <Check className="w-2.5 h-2.5" /> : "OK"}
        </button>
        <button onClick={() => setConfirming(false)} className="p-1.5 rounded-lg border border-white/10 text-muted-foreground hover:text-foreground transition-colors text-[9px] px-2">
          Não
        </button>
      </div>
      {err && <span className="text-[9px] text-destructive">{err}</span>}
    </div>
  );
}

interface InfinityNotif {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
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

  // ── Sales Channel state ────────────────────────────────────────────────────
  interface SalesPayment { id: string; username: string; planId: string; amountBrl: string; status: string; createdAt: string; paidAt: string | null; }
  const [salesLog, setSalesLog] = useState<SalesPayment[]>([]);
  const [salesLogLoading, setSalesLogLoading] = useState(false);
  const [fakeSaleLoading, setFakeSaleLoading] = useState(false);
  const [fakeRechargeLoading, setFakeRechargeLoading] = useState(false);
  const [fakeSaleMsg, setFakeSaleMsg] = useState("");

  const loadSalesLog = useCallback(async () => {
    if (!isAdmin) return;
    setSalesLogLoading(true);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/payments", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (r.ok) setSalesLog(await r.json());
    } catch {} finally { setSalesLogLoading(false); }
  }, [isAdmin]);

  useEffect(() => { void loadSalesLog(); }, [loadSalesLog]);

  const handleFakeSale = async (type: "sale" | "recharge") => {
    const setter = type === "sale" ? setFakeSaleLoading : setFakeRechargeLoading;
    setter(true);
    setFakeSaleMsg("");
    try {
      const token = localStorage.getItem("infinity_token");
      const endpoint = type === "sale"
        ? "/api/infinity/admin/sales-channel/fake-sale"
        : "/api/infinity/admin/sales-channel/fake-recharge";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error();
      setFakeSaleMsg(type === "sale" ? "✅ Venda enviada ao canal!" : "✅ Recarga enviada ao canal!");
      setTimeout(() => setFakeSaleMsg(""), 3000);
    } catch {
      setFakeSaleMsg("❌ Falha ao enviar. Verifique o bot.");
      setTimeout(() => setFakeSaleMsg(""), 3000);
    } finally { setter(false); }
  };

  // ── Notifications state ────────────────────────────────────────────────────
  const [notifs, setNotifs] = useState<InfinityNotif[]>([]);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifBody, setNotifBody] = useState("");
  const [notifImageUrl, setNotifImageUrl] = useState("");
  const [notifImgUploading, setNotifImgUploading] = useState(false);
  const [notifImgError, setNotifImgError] = useState("");
  const [notifSending, setNotifSending] = useState(false);
  const [notifSuccess, setNotifSuccess] = useState(false);
  const [notifError, setNotifError] = useState("");
  const imgInputRef = useRef<HTMLInputElement>(null);

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNotifImgError("");
    setNotifImgUploading(true);
    try {
      const reader = new FileReader();
      const dataUri = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const match = dataUri.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
      if (!match) throw new Error("Formato inválido");
      const [, mimeType, data] = match;
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/notifications/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ data, mimeType }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? "Falha ao fazer upload");
      }
      const { url } = await r.json() as { url: string };
      setNotifImageUrl(url);
    } catch (err) {
      setNotifImgError(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setNotifImgUploading(false);
      if (imgInputRef.current) imgInputRef.current.value = "";
    }
  };

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
        body: JSON.stringify({ title: notifTitle.trim(), body: notifBody.trim(), imageUrl: notifImageUrl.trim() || undefined }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? "Falha ao enviar");
      }
      setNotifTitle("");
      setNotifBody("");
      setNotifImageUrl("");
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

  // ── Coupons state ──────────────────────────────────────────────────────────
  interface CouponRow {
    code: string; discountPercent: number; maxUses: number | null; usedCount: number;
    expiresAt: string | null; active: boolean; description: string | null;
    createdBy: string; createdAt: string;
  }
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [couponsLoading, setCouponsLoading] = useState(false);
  const [couponForm, setCouponForm] = useState({ code: "", discountPercent: "", maxUses: "", expiresAt: "", description: "" });
  const [couponFormErr, setCouponFormErr] = useState("");
  const [couponFormOk, setCouponFormOk] = useState(false);
  const [couponFormLoading, setCouponFormLoading] = useState(false);

  const loadCoupons = useCallback(async () => {
    if (!isAdmin) return;
    setCouponsLoading(true);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/admin/coupons", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (r.ok) setCoupons(await r.json());
    } catch {} finally { setCouponsLoading(false); }
  }, [isAdmin]);

  useEffect(() => { void loadCoupons(); }, [loadCoupons]);

  const generateCouponCode = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const code = "HYDRA" + Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    setCouponForm(f => ({ ...f, code }));
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setCouponFormErr("");
    setCouponFormOk(false);
    const pct = Number(couponForm.discountPercent);
    if (!couponForm.code.trim()) { setCouponFormErr("Código obrigatório."); return; }
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) { setCouponFormErr("Desconto deve ser entre 1 e 100%."); return; }
    setCouponFormLoading(true);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          code: couponForm.code.trim().toUpperCase(),
          discountPercent: pct,
          maxUses: couponForm.maxUses.trim() ? Number(couponForm.maxUses) : null,
          expiresAt: couponForm.expiresAt || null,
          description: couponForm.description.trim() || null,
        }),
      });
      const j = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok) { setCouponFormErr(j.error ?? "Erro ao criar cupom."); return; }
      setCouponFormOk(true);
      setCouponForm({ code: "", discountPercent: "", maxUses: "", expiresAt: "", description: "" });
      setTimeout(() => setCouponFormOk(false), 2500);
      await loadCoupons();
    } catch { setCouponFormErr("Erro de conexão."); }
    finally { setCouponFormLoading(false); }
  };

  const handleToggleCoupon = async (code: string, active: boolean) => {
    const token = localStorage.getItem("infinity_token");
    await fetch(`/api/infinity/admin/coupons/${encodeURIComponent(code)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ active }),
    });
    await loadCoupons();
  };

  const handleDeleteCoupon = async (code: string) => {
    if (!confirm(`Excluir cupom "${code}"? Esta ação é irreversível.`)) return;
    const token = localStorage.getItem("infinity_token");
    await fetch(`/api/infinity/admin/coupons/${encodeURIComponent(code)}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    await loadCoupons();
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

      <TotpSection />

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
          {/* ── Canal de Vendas ────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.02 }}
            className="rounded-2xl border border-emerald-500/20 bg-black/30 backdrop-blur-2xl p-6"
          >
            <div className="flex items-center justify-between gap-2 mb-5 flex-wrap">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Canal de Vendas</h2>
                <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full uppercase tracking-widest">Telegram</span>
              </div>
              <button
                onClick={() => void loadSalesLog()}
                disabled={salesLogLoading}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors border border-transparent hover:border-white/10"
                title="Atualizar log"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${salesLogLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* Simulate buttons */}
            <div className="flex flex-col sm:flex-row gap-3 mb-5">
              <button
                onClick={() => handleFakeSale("sale")}
                disabled={fakeSaleLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm font-semibold tracking-wider hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {fakeSaleLoading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ShoppingBag className="w-4 h-4" />}
                Simular Nova Venda
              </button>
              <button
                onClick={() => handleFakeSale("recharge")}
                disabled={fakeRechargeLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-300 text-sm font-semibold tracking-wider hover:bg-sky-500/20 hover:border-sky-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {fakeRechargeLoading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Zap className="w-4 h-4" />}
                Simular Recarga
              </button>
            </div>

            {fakeSaleMsg && (
              <div className={`text-xs rounded-xl px-4 py-2.5 mb-4 border font-mono ${
                fakeSaleMsg.startsWith("✅")
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-destructive/10 border-destructive/30 text-destructive"
              }`}>
                {fakeSaleMsg}
              </div>
            )}

            {/* Sales log */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground mb-3 flex items-center gap-1.5">
                <CreditCard className="w-3 h-3" /> Log de Compras ({salesLog.filter(s => s.status === "paid").length})
              </p>
              {salesLog.filter(s => s.status === "paid").length === 0 ? (
                <div className="rounded-xl border border-white/5 bg-black/20 px-4 py-6 text-center text-xs text-muted-foreground">
                  {salesLogLoading ? "Carregando..." : "Nenhuma compra registrada ainda."}
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {salesLog.filter(s => s.status === "paid").slice(0, 20).map((p, i) => {
                    const maskedUser = p.username.length <= 6
                      ? p.username.slice(0, 2) + "****" + p.username.slice(-2)
                      : p.username.length <= 9
                        ? p.username.slice(0, 3) + "****" + p.username.slice(-3)
                        : p.username.slice(0, 5) + "****" + p.username.slice(-4);
                    const paidDate = p.paidAt ? new Date(p.paidAt).toLocaleString("pt-BR") : new Date(p.createdAt).toLocaleString("pt-BR");
                    const PLAN_LABELS: Record<string, string> = {
                      "1d": "1 Dia", "7d": "7 Dias", "14d": "14 Dias", "30d": "30 Dias",
                      "rc_micro": "Micro 20cx", "rc_basico": "Básico 60cx",
                      "rc_padrao": "Padrão 120cx", "rc_avancado": "Avançado 300cx", "rc_pro": "Pro 600cx",
                    };
                    const isRecharge = p.planId.startsWith("rc_");
                    const planLabel = PLAN_LABELS[p.planId] ?? p.planId;
                    return (
                      <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-4 py-3 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[10px] text-muted-foreground/50 shrink-0">#{i + 1}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white font-mono">{maskedUser}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider border ${isRecharge ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300" : "bg-amber-500/10 border-amber-500/30 text-amber-300"}`}>
                                {planLabel}
                              </span>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{paidDate}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-emerald-400 font-bold font-mono">R$ {p.amountBrl}</span>
                          <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>

          {/* ── Cupons de Desconto ──────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 }}
            className="rounded-2xl border border-amber-500/20 bg-black/30 backdrop-blur-2xl p-6"
          >
            <div className="flex items-center justify-between gap-2 mb-5 flex-wrap">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Cupons de Desconto</h2>
              </div>
              <button
                onClick={() => void loadCoupons()}
                disabled={couponsLoading}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors border border-transparent hover:border-white/10"
                title="Atualizar"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${couponsLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* Create form */}
            <form onSubmit={(e) => { void handleCreateCoupon(e); }} className="space-y-3 mb-6">
              <div className="flex gap-2">
                <input
                  value={couponForm.code}
                  onChange={e => setCouponForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_\-]/g, "") }))}
                  placeholder="Código (ex: HYDRA20)"
                  maxLength={30}
                  className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono uppercase tracking-widest focus:outline-none focus:border-amber-400/50 transition-all"
                />
                <button
                  type="button"
                  onClick={generateCouponCode}
                  className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-xs text-muted-foreground hover:text-foreground hover:border-white/25 transition-all"
                  title="Gerar código aleatório"
                >
                  <Hash className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Desconto %</label>
                  <input
                    type="number" min={1} max={100}
                    value={couponForm.discountPercent}
                    onChange={e => setCouponForm(f => ({ ...f, discountPercent: e.target.value }))}
                    placeholder="Ex: 20"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-400/50 transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Max usos</label>
                  <input
                    type="number" min={1}
                    value={couponForm.maxUses}
                    onChange={e => setCouponForm(f => ({ ...f, maxUses: e.target.value }))}
                    placeholder="Ilimitado"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-400/50 transition-all"
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Válido até</label>
                  <input
                    type="datetime-local"
                    value={couponForm.expiresAt}
                    onChange={e => setCouponForm(f => ({ ...f, expiresAt: e.target.value }))}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-400/50 transition-all"
                  />
                </div>
              </div>
              <input
                value={couponForm.description}
                onChange={e => setCouponForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Descrição do cupom (opcional)"
                maxLength={200}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-400/50 transition-all"
              />
              {couponFormErr && (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-2.5">{couponFormErr}</div>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={couponFormLoading || !couponForm.code.trim() || !couponForm.discountPercent}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-[0.25em] text-black transition-all disabled:opacity-50 bg-amber-400 hover:bg-amber-300"
                >
                  {couponFormLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Tag className="w-3.5 h-3.5" />}
                  Criar Cupom
                </button>
                {couponFormOk && (
                  <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-1 text-xs text-emerald-400">
                    <Check className="w-3.5 h-3.5" /> Cupom criado!
                  </motion.span>
                )}
              </div>
            </form>

            {/* Coupon list */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground mb-3">
                Cupons ({coupons.length})
              </p>
              {coupons.length === 0 ? (
                <div className="rounded-xl border border-white/5 bg-black/20 px-4 py-6 text-center text-xs text-muted-foreground">
                  {couponsLoading ? "Carregando..." : "Nenhum cupom criado ainda."}
                </div>
              ) : (
                <div className="space-y-2">
                  {coupons.map(c => {
                    const expired = c.expiresAt ? new Date(c.expiresAt) < new Date() : false;
                    const exhausted = c.maxUses !== null && c.usedCount >= c.maxUses;
                    const statusBadge = !c.active ? "Inativo" : expired ? "Expirado" : exhausted ? "Esgotado" : "Ativo";
                    const statusColor = !c.active || expired || exhausted
                      ? "bg-destructive/10 border-destructive/30 text-destructive"
                      : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400";
                    return (
                      <div key={c.code} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-sm text-amber-300">{c.code}</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full border font-semibold uppercase tracking-wider bg-amber-500/10 border-amber-500/30 text-amber-300">
                              −{c.discountPercent}%
                            </span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold uppercase tracking-wider ${statusColor}`}>
                              {statusBadge}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                            <span>Usos: {c.usedCount}{c.maxUses !== null ? `/${c.maxUses}` : ""}</span>
                            {c.expiresAt && <span>Válido até: {new Date(c.expiresAt).toLocaleDateString("pt-BR")}</span>}
                            {c.description && <span className="text-muted-foreground/70">{c.description}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => void handleToggleCoupon(c.code, !c.active)}
                            className={`p-1.5 rounded-lg transition-colors border ${c.active ? "text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" : "text-muted-foreground border-white/10 hover:bg-white/5"}`}
                            title={c.active ? "Desativar" : "Ativar"}
                          >
                            {c.active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => void handleDeleteCoupon(c.code)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors border border-transparent hover:border-destructive/30"
                            title="Excluir cupom"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>

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
              {/* Image picker */}
              <input
                ref={imgInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={handleImagePick}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => imgInputRef.current?.click()}
                  disabled={notifImgUploading}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-white/25 transition-all disabled:opacity-50"
                >
                  {notifImgUploading
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando...</>
                    : <><ImagePlus className="w-3.5 h-3.5" /> Anexar Foto</>}
                </button>
                {notifImageUrl && (
                  <div className="flex items-center gap-2">
                    <img
                      src={notifImageUrl}
                      alt="Preview"
                      className="w-8 h-8 rounded-lg object-cover border border-white/20"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                    <button
                      type="button"
                      onClick={() => setNotifImageUrl("")}
                      className="p-1 rounded-md text-muted-foreground hover:text-destructive transition-colors"
                      title="Remover foto"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {notifImgError && (
                  <span className="text-xs text-destructive">{notifImgError}</span>
                )}
              </div>
              {notifImageUrl && (
                <div className="rounded-xl overflow-hidden border border-white/10 max-h-48">
                  <img
                    src={notifImageUrl}
                    alt="Preview"
                    className="w-full object-cover max-h-48"
                    onError={e => { (e.currentTarget as HTMLImageElement).parentElement!.style.display = "none"; }}
                  />
                </div>
              )}
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
                        className="rounded-xl border border-white/5 bg-black/20 overflow-hidden"
                      >
                        {n.imageUrl && (
                          <div className="relative overflow-hidden" style={{ maxHeight: "120px" }}>
                            <img
                              src={n.imageUrl}
                              alt=""
                              className="w-full object-cover"
                              style={{ maxHeight: "120px" }}
                              onError={e => { (e.currentTarget as HTMLImageElement).parentElement!.style.display = "none"; }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/50 pointer-events-none" />
                            <span className="absolute bottom-1.5 right-2 text-[9px] uppercase tracking-wider text-white/60 bg-black/40 backdrop-blur-sm rounded px-1.5 py-0.5">foto</span>
                          </div>
                        )}
                        <div className="p-4 flex items-start gap-3">
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
                        </div>
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
                            <DisplayNameEditor
                              username={u.username}
                              currentName={(u as any).displayName ?? null}
                              onSaved={() => { queryClient.invalidateQueries({ queryKey: getInfinityListUsersQueryKey() }); refetchUsers(); }}
                            />
                            <PinResetEditor
                              username={u.username}
                              onReset={() => { queryClient.invalidateQueries({ queryKey: getInfinityListUsersQueryKey() }); }}
                            />
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
