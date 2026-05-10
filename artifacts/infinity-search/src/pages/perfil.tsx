import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera, Image as ImageIcon, Trash2, Save, CheckCircle2,
  User as UserIcon, FileText, Circle, Lock, Eye, EyeOff, Check, Pencil, AtSign,
} from "lucide-react";
import { useInfinityMe, getInfinityMeQueryKey } from "@workspace/api-client-react";

const LS_PHOTO    = "infinity_profile_photo";
const LS_BANNER   = "infinity_profile_banner";
const LS_BIO      = "infinity_profile_bio";
const LS_STATUS   = "infinity_profile_status";
const LS_STATUS_MSG = "infinity_profile_status_msg";
const LS_HIDE_USERNAME = "infinity_hide_username";

type StatusType = "online" | "busy" | "away" | "offline";

const STATUS_OPTS: { v: StatusType; label: string; color: string; desc: string }[] = [
  { v: "online",  label: "Online",   color: "#22c55e", desc: "Disponível" },
  { v: "busy",    label: "Ocupado",  color: "#ef4444", desc: "Não perturbe" },
  { v: "away",    label: "Ausente",  color: "#f59e0b", desc: "Fora por um momento" },
  { v: "offline", label: "Offline",  color: "#6b7280", desc: "Aparência de desconectado" },
];

function getStatusColor(s: StatusType): string {
  return STATUS_OPTS.find(o => o.v === s)?.color ?? "#6b7280";
}

function StatusDot({ status, size = 14 }: { status: StatusType; size?: number }) {
  const color = getStatusColor(status);
  const isOnline = status === "online";
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      {isOnline && (
        <motion.span
          className="absolute inset-0 rounded-full opacity-60"
          style={{ background: color }}
          animate={{ scale: [1, 1.6, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span
        className="relative rounded-full border-2 border-background"
        style={{ width: size, height: size, background: color }}
      />
    </span>
  );
}

function dispatchUpdate() {
  window.dispatchEvent(new CustomEvent("infinity-profile-updated"));
}

export { StatusDot, getStatusColor };
export type { StatusType };

export default function Perfil() {
  const { data: user } = useInfinityMe({ query: { queryKey: getInfinityMeQueryKey() } });

  const [photo,     setPhoto]     = useState<string | null>(() => localStorage.getItem(LS_PHOTO));
  const [banner,    setBanner]    = useState<string | null>(() => localStorage.getItem(LS_BANNER));
  const [bio,       setBio]       = useState<string>(() => localStorage.getItem(LS_BIO) ?? "");
  const [status,    setStatus]    = useState<StatusType>(() => (localStorage.getItem(LS_STATUS) as StatusType) ?? "online");
  const [statusMsg, setStatusMsg] = useState<string>(() => localStorage.getItem(LS_STATUS_MSG) ?? "");
  const [saved,     setSaved]     = useState(false);

  const photoRef  = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  // ── Display Name ──────────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState("");
  const [dnSaving, setDnSaving] = useState(false);
  const [dnSaved, setDnSaved] = useState(false);
  const [dnErr, setDnErr] = useState("");

  // ── PIN ───────────────────────────────────────────────────────────────────
  const [hasPinSet, setHasPinSet] = useState(false);
  const [curPin, setCurPin] = useState("");
  const [newPin1, setNewPin1] = useState("");
  const [newPin2, setNewPin2] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinSaved, setPinSaved] = useState(false);
  const [pinErr, setPinErr] = useState("");

  // ── Hide username ─────────────────────────────────────────────────────────
  const [hideUsername, setHideUsername] = useState<boolean>(
    () => localStorage.getItem(LS_HIDE_USERNAME) === "true"
  );
  const toggleHideUsername = () => {
    const next = !hideUsername;
    setHideUsername(next);
    next ? localStorage.setItem(LS_HIDE_USERNAME, "true") : localStorage.removeItem(LS_HIDE_USERNAME);
    dispatchUpdate();
  };
  const [showPins, setShowPins] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("infinity_token");
    fetch("/api/infinity/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((d: { displayName?: string | null; pinSet?: boolean }) => {
        setDisplayName(d.displayName ?? "");
        setHasPinSet(d.pinSet ?? false);
      })
      .catch(() => {});
  }, []);

  const saveDisplayName = async () => {
    setDnSaving(true); setDnErr(""); setDnSaved(false);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/me/display-name", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName: displayName.trim() || null }),
      });
      if (!r.ok) { const d = await r.json() as { error?: string }; throw new Error(d.error ?? "Erro"); }
      setDnSaved(true);
      setTimeout(() => setDnSaved(false), 2000);
    } catch (e) { setDnErr(e instanceof Error ? e.message : "Erro"); }
    finally { setDnSaving(false); }
  };

  const savePin = async () => {
    setPinErr(""); setPinSaved(false);
    if (!/^\d{4}$/.test(newPin1)) { setPinErr("PIN deve ter 4 dígitos numéricos."); return; }
    if (newPin1 !== newPin2) { setPinErr("PINs não coincidem."); return; }
    if (hasPinSet && !curPin) { setPinErr("Informe o PIN atual."); return; }
    setPinSaving(true);
    try {
      const token = localStorage.getItem("infinity_token");
      const body: Record<string, string> = { newPin: newPin1 };
      if (hasPinSet) body["currentPin"] = curPin;
      const r = await fetch("/api/infinity/me/pin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json() as { error?: string }; throw new Error(d.error ?? "Erro"); }
      setPinSaved(true); setHasPinSet(true);
      setCurPin(""); setNewPin1(""); setNewPin2("");
      setTimeout(() => setPinSaved(false), 2500);
    } catch (e) { setPinErr(e instanceof Error ? e.message : "Erro"); }
    finally { setPinSaving(false); }
  };

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target?.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const handlePhotoChange  = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setPhoto(await readFile(f));
  };
  const handleBannerChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setBanner(await readFile(f));
  };

  const handleSave = () => {
    photo  ? localStorage.setItem(LS_PHOTO, photo)   : localStorage.removeItem(LS_PHOTO);
    banner ? localStorage.setItem(LS_BANNER, banner)  : localStorage.removeItem(LS_BANNER);
    localStorage.setItem(LS_BIO, bio.slice(0, 160));
    localStorage.setItem(LS_STATUS, status);
    localStorage.setItem(LS_STATUS_MSG, statusMsg.slice(0, 80));
    dispatchUpdate();
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const currentStatus = STATUS_OPTS.find(o => o.v === status)!;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-widest neon-text uppercase">Perfil</h1>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mt-2">
          Personalize sua identidade na plataforma
        </p>
      </div>

      {/* ── Banner + Avatar card ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl overflow-hidden border border-white/10"
        style={{ backdropFilter: "blur(20px)", boxShadow: "0 8px 40px rgba(0,0,0,0.4)" }}
      >
        {/* Banner */}
        <div
          className="relative h-40 flex items-center justify-center cursor-pointer group"
          style={banner
            ? { backgroundImage: `url(${banner})`, backgroundSize: "cover", backgroundPosition: "center" }
            : { background: "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 30%, black) 0%, color-mix(in srgb, var(--color-primary) 10%, black) 100%)" }
          }
          onClick={() => bannerRef.current?.click()}
        >
          {/* Pattern overlay */}
          {!banner && (
            <div className="absolute inset-0 opacity-[0.04]"
              style={{ backgroundImage: "repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)", backgroundSize: "16px 16px" }} />
          )}
          <div className="relative z-10 flex flex-col items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center border border-white/20 backdrop-blur-md">
              <ImageIcon className="w-5 h-5 text-white" />
            </div>
            <span className="text-[10px] uppercase tracking-widest text-white/80 bg-black/40 px-3 py-1 rounded-full">
              {banner ? "Trocar banner" : "Adicionar banner"}
            </span>
          </div>
          {banner && (
            <button
              onClick={e => { e.stopPropagation(); setBanner(null); }}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center border border-white/20 hover:bg-destructive/70 transition-colors z-20"
            >
              <Trash2 className="w-3.5 h-3.5 text-white" />
            </button>
          )}
        </div>

        {/* Avatar row */}
        <div className="bg-black/50 px-6 pb-6 pt-0 relative">
          <div className="flex items-end gap-4">
            {/* Avatar with status dot */}
            <div className="relative -mt-12 shrink-0">
              <div
                className="w-24 h-24 rounded-full overflow-hidden border-4 flex items-center justify-center font-bold text-3xl cursor-pointer group relative"
                style={{
                  borderColor: "var(--color-background)",
                  background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, white))",
                  color: "var(--color-background)",
                  boxShadow: "0 0 0 2px color-mix(in srgb, var(--color-primary) 40%, transparent)",
                }}
                onClick={() => photoRef.current?.click()}
              >
                {photo ? (
                  <img src={photo} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span>{user?.username?.[0]?.toUpperCase() ?? "?"}</span>
                )}
                <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="w-6 h-6 text-white" />
                </div>
              </div>
              {/* Discord-style status dot */}
              <div className="absolute bottom-0.5 right-0.5">
                <StatusDot status={status} size={18} />
              </div>
              {/* Remove photo button */}
              {photo && (
                <button
                  onClick={() => setPhoto(null)}
                  className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-destructive/90 flex items-center justify-center border-2 border-background hover:bg-destructive transition-colors z-10"
                >
                  <Trash2 className="w-2.5 h-2.5 text-white" />
                </button>
              )}
            </div>

            {/* Name + status */}
            <div className="pb-2 min-w-0 flex-1">
              <div className="font-bold text-lg tracking-wide text-white">
                {displayName || user?.username}
              </div>
              {displayName && (
                <div className="text-[10px] text-white/30 font-mono">@{user?.username}</div>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[9px] uppercase tracking-[0.4em]" style={{ color: "var(--color-primary)" }}>
                  {user?.role}
                </span>
                <span className="text-white/15">·</span>
                <span className="text-[10px]" style={{ color: currentStatus.color }}>
                  {currentStatus.label}
                </span>
              </div>
              {statusMsg && (
                <p className="text-[11px] text-white/40 mt-1 italic truncate">"{statusMsg}"</p>
              )}
              {bio && (
                <p className="text-[11px] text-white/50 mt-1 leading-relaxed line-clamp-2">{bio}</p>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Status Picker ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="rounded-2xl border border-white/8 p-5 space-y-4"
        style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(20px)" }}
      >
        <div className="flex items-center gap-2">
          <Circle className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Status</h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STATUS_OPTS.map(opt => (
            <button
              key={opt.v}
              onClick={() => setStatus(opt.v)}
              className="flex flex-col items-center gap-2 p-3 rounded-xl border transition-all"
              style={status === opt.v ? {
                background: `${opt.color}18`,
                borderColor: `${opt.color}50`,
                boxShadow: `0 0 16px ${opt.color}22`,
              } : {
                background: "rgba(255,255,255,0.03)",
                borderColor: "rgba(255,255,255,0.07)",
              }}
            >
              <span className="relative inline-flex">
                {opt.v === "online" && status === opt.v && (
                  <motion.span
                    className="absolute inset-0 rounded-full"
                    style={{ background: opt.color }}
                    animate={{ scale: [1, 1.8], opacity: [0.5, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                )}
                <span className="w-3.5 h-3.5 rounded-full block border-2 border-background" style={{ background: opt.color }} />
              </span>
              <span className="text-[11px] font-semibold" style={{ color: status === opt.v ? opt.color : "rgba(255,255,255,0.5)" }}>
                {opt.label}
              </span>
            </button>
          ))}
        </div>

        {/* Status message */}
        <div>
          <label className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/60 mb-2 block">
            Mensagem de status
          </label>
          <input
            type="text"
            value={statusMsg}
            onChange={e => setStatusMsg(e.target.value.slice(0, 80))}
            placeholder="O que você está fazendo? (máx. 80 chars)"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
          />
          <p className="text-[9px] text-muted-foreground/30 mt-1 text-right">{statusMsg.length}/80</p>
        </div>
      </motion.div>

      {/* ── Nome de exibição ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.11 }}
        className="rounded-2xl border border-white/8 p-5 space-y-3"
        style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(20px)" }}
      >
        <div className="flex items-center gap-2">
          <Pencil className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Nome de exibição</h2>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            maxLength={50}
            placeholder="Como você quer ser chamado..."
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
            onKeyDown={e => { if (e.key === "Enter") void saveDisplayName(); }}
          />
          <button
            onClick={() => void saveDisplayName()}
            disabled={dnSaving}
            className="px-4 py-2.5 rounded-xl border font-bold text-xs uppercase tracking-widest transition-all disabled:opacity-50 shrink-0"
            style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
          >
            {dnSaved ? <Check className="w-3.5 h-3.5" /> : dnSaving ? "..." : "Salvar"}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-widest">Exibido na visão geral em vez do nome de usuário</p>
        {dnErr && <p className="text-xs text-destructive">{dnErr}</p>}
      </motion.div>

      {/* ── Privacidade do @ ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="rounded-2xl border border-white/8 p-5"
        style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(20px)" }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)" }}
            >
              <AtSign className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Ocultar seu @usuário</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {hideUsername
                  ? <>Aparece como <span style={{ color: "var(--color-primary)" }}>@infinitysearch</span> para você</>
                  : <>Mostra seu @ real — <span className="text-white/40">somente você vê isso</span></>}
              </div>
            </div>
          </div>
          {/* Toggle switch */}
          <button
            onClick={toggleHideUsername}
            className="relative shrink-0 w-12 h-6 rounded-full transition-all duration-300 focus:outline-none"
            style={{
              background: hideUsername
                ? "color-mix(in srgb, var(--color-primary) 85%, transparent)"
                : "rgba(255,255,255,0.12)",
              boxShadow: hideUsername
                ? "0 0 12px color-mix(in srgb, var(--color-primary) 50%, transparent)"
                : "none",
            }}
            aria-pressed={hideUsername}
            title={hideUsername ? "Mostrar @ real" : "Ocultar @"}
          >
            <motion.span
              className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md"
              animate={{ left: hideUsername ? "calc(100% - 1.375rem)" : "0.125rem" }}
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
          </button>
        </div>
      </motion.div>

      {/* ── PIN de acesso ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.13 }}
        className="rounded-2xl border border-white/8 p-5 space-y-4"
        style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(20px)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              {hasPinSet ? "PIN de acesso" : "Criar PIN de acesso"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {!hasPinSet && (
              <span className="text-[9px] uppercase tracking-widest text-amber-400 bg-amber-400/10 border border-amber-400/30 px-1.5 py-0.5 rounded-full">
                Não configurado
              </span>
            )}
            <button onClick={() => setShowPins(p => !p)} className="text-[10px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
              {showPins ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showPins ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </div>

        {!hasPinSet && (
          <p className="text-[11px] text-amber-300/80 bg-amber-400/5 border border-amber-400/15 rounded-xl px-3 py-2">
            Configure um PIN de 4 dígitos — será exigido em todos os seus próximos logins.
          </p>
        )}

        <div className={`grid gap-2 ${hasPinSet ? "grid-cols-3" : "grid-cols-2"}`}>
          {hasPinSet && (
            <input
              type={showPins ? "text" : "password"}
              inputMode="numeric"
              maxLength={4}
              value={curPin}
              onChange={e => setCurPin(e.target.value.replace(/\D/g, ""))}
              placeholder="PIN atual"
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-center focus:outline-none focus:border-primary/50 transition-colors tracking-[0.4em]"
            />
          )}
          <input
            type={showPins ? "text" : "password"}
            inputMode="numeric"
            maxLength={4}
            value={newPin1}
            onChange={e => setNewPin1(e.target.value.replace(/\D/g, ""))}
            placeholder={hasPinSet ? "Novo PIN" : "PIN (4 dígitos)"}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-center focus:outline-none focus:border-primary/50 transition-colors tracking-[0.4em]"
          />
          <input
            type={showPins ? "text" : "password"}
            inputMode="numeric"
            maxLength={4}
            value={newPin2}
            onChange={e => setNewPin2(e.target.value.replace(/\D/g, ""))}
            placeholder="Confirmar"
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-center focus:outline-none focus:border-primary/50 transition-colors tracking-[0.4em]"
          />
        </div>
        <button
          onClick={() => void savePin()}
          disabled={pinSaving || !newPin1 || !newPin2 || (hasPinSet && !curPin)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold uppercase tracking-widest text-sm transition-all disabled:opacity-40"
          style={{
            background: pinSaved ? "#22c55e" : "color-mix(in srgb, var(--color-primary) 20%, transparent)",
            border: `1px solid ${pinSaved ? "#22c55e60" : "color-mix(in srgb, var(--color-primary) 40%, transparent)"}`,
            color: pinSaved ? "#fff" : "var(--color-primary)",
          }}
        >
          <Lock className="w-3.5 h-3.5" />
          {pinSaved ? (hasPinSet ? "PIN alterado com sucesso!" : "PIN configurado!") : pinSaving ? "Salvando..." : hasPinSet ? "Alterar PIN" : "Criar PIN"}
        </button>
        {pinErr && <p className="text-xs text-destructive">{pinErr}</p>}
      </motion.div>

      {/* ── Bio ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14 }}
        className="rounded-2xl border border-white/8 p-5 space-y-3"
        style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(20px)" }}
      >
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Bio</h2>
        </div>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value.slice(0, 160))}
          placeholder="Conte um pouco sobre você... (máx. 160 chars)"
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors resize-none"
        />
        <p className="text-[9px] text-muted-foreground/30 text-right">{bio.length}/160</p>
      </motion.div>

      {/* ── Photo controls ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-white/8 p-5 space-y-4"
        style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(20px)" }}
      >
        <div className="flex items-center gap-2">
          <UserIcon className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Fotos</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => photoRef.current?.click()}
            className="flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-colors text-sm font-medium"
            style={{ background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", borderColor: "color-mix(in srgb, var(--color-primary) 30%, transparent)" }}
          >
            <Camera className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
            <span>{photo ? "Trocar foto" : "Adicionar foto"}</span>
          </button>
          <button
            onClick={() => bannerRef.current?.click()}
            className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-sm font-medium"
          >
            <ImageIcon className="w-4 h-4 text-muted-foreground" />
            <span>{banner ? "Trocar banner" : "Adicionar banner"}</span>
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-widest">
          Imagens e preferências salvas localmente no navegador
        </p>

        <AnimatePresence mode="wait">
          <motion.button
            key={saved ? "saved" : "save"}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            onClick={handleSave}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold uppercase tracking-widest text-sm transition-all"
            style={saved ? {
              background: "#22c55e",
              color: "#fff",
              boxShadow: "0 0 30px rgba(34,197,94,0.4)",
            } : {
              background: "var(--color-primary)",
              color: "#000",
              boxShadow: "0 0 30px color-mix(in srgb, var(--color-primary) 35%, transparent)",
            }}
          >
            {saved ? (
              <><CheckCircle2 className="w-4 h-4" /> Salvo!</>
            ) : (
              <><Save className="w-4 h-4" /> Salvar alterações</>
            )}
          </motion.button>
        </AnimatePresence>
      </motion.div>

      <input ref={photoRef}  type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
      <input ref={bannerRef} type="file" accept="image/*" className="hidden" onChange={handleBannerChange} />
    </div>
  );
}
