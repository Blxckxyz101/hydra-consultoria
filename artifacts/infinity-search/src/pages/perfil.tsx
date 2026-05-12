import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera, Image as ImageIcon, Trash2, Save, CheckCircle2,
  User as UserIcon, FileText, Circle, Lock, Eye, EyeOff, Check, Pencil, AtSign,
  Bookmark, BookmarkPlus, Play, Plus, X as XIcon,
  MapPin, Music, Globe, Instagram, Twitter, Youtube, Github, Twitch, UserPlus, Users as UsersIcon,
  CheckCircle, XCircle, Loader2, CreditCard, Sparkles, Crown,
} from "lucide-react";
import { Link } from "wouter";
import { useInfinityMe, getInfinityMeQueryKey } from "@workspace/api-client-react";
import { THEMES, applyTheme } from "@/pages/personalizar";

const LS_PHOTO    = "infinity_profile_photo";
const LS_BANNER   = "infinity_profile_banner";
const LS_BIO      = "infinity_profile_bio";
const LS_STATUS   = "infinity_profile_status";
const LS_STATUS_MSG = "infinity_profile_status_msg";
const LS_HIDE_USERNAME = "infinity_hide_username";
const LS_THEME    = "infinity_theme";

interface PresetSummary {
  id: number;
  name: string;
  theme: string | null;
  hasPhoto: boolean;
  hasBanner: boolean;
  createdAt: string;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  return token ? { Authorization: `Bearer ${token}` } : {} as Record<string, string>;
}

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
    // Persist to server
    fetch("/api/infinity/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ hideUsername: next }),
    }).catch(() => {});
  };
  const [showPins, setShowPins] = useState(false);

  // ── Social fields ─────────────────────────────────────────────────────────
  const [socialLocation, setSocialLocation] = useState("");
  const [socialMusicUrl, setSocialMusicUrl] = useState("");
  const [socialLinks, setSocialLinks] = useState<{ type: string; value: string }[]>([]);
  const [socialBgType, setSocialBgType] = useState<"default" | "image" | "color">("default");
  const [socialBgValue, setSocialBgValue] = useState("");
  const [socialSaving, setSocialSaving] = useState(false);
  const [socialSaved, setSocialSaved] = useState(false);
  const [newLinkType, setNewLinkType] = useState("instagram");
  const [newLinkValue, setNewLinkValue] = useState("");

  // ── Friends ───────────────────────────────────────────────────────────────
  const [friends, setFriends] = useState<{ id: number; username: string; displayName: string; photo: string | null; status: string; direction: string; friendStatus: string }[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [addFriendInput, setAddFriendInput] = useState("");
  const [addFriendLoading, setAddFriendLoading] = useState(false);
  const [addFriendMsg, setAddFriendMsg] = useState("");

  // ── Card Theme & Plan ─────────────────────────────────────────────────────
  const [cardTheme, setCardTheme] = useState<string>("default");
  const [planType, setPlanType] = useState<string>("free");
  const [planBuying, setPlanBuying] = useState(false);
  const [planMsg, setPlanMsg] = useState("");
  const [themeSaving, setThemeSaving] = useState(false);

  const PRO_THEMES = ["aurora","matrix","neon","holographic","particles","glitch","cyberpunk"];
  const ALL_THEMES = [
    { id: "default", label: "Padrão", colors: ["#00d9ff","#0a1628"], pro: false },
    { id: "midnight", label: "Midnight", colors: ["#6366f1","#0f0c1d"], pro: false },
    { id: "rose", label: "Rose", colors: ["#f43f5e","#1a0a0e"], pro: false },
    { id: "aurora", label: "Aurora", colors: ["#22d3ee","#a78bfa","#0d1117"], pro: true },
    { id: "matrix", label: "Matrix", colors: ["#22c55e","#00ff41","#0a0a0a"], pro: true },
    { id: "neon", label: "Neon", colors: ["#f0abfc","#e879f9","#12001a"], pro: true },
    { id: "holographic", label: "Holográfico", colors: ["#67e8f9","#a5f3fc","#f0abfc"], pro: true },
    { id: "glitch", label: "Glitch", colors: ["#ff0080","#00ffff","#0a0a0a"], pro: true },
    { id: "cyberpunk", label: "Cyberpunk", colors: ["#fbbf24","#f97316","#0f0700"], pro: true },
  ];

  const buyPlan = async () => {
    setPlanBuying(true); setPlanMsg("");
    try {
      const r = await fetch("/api/infinity/me/plan/buy", { method: "POST", headers: authHeaders() });
      const d = await r.json() as { error?: string; planType?: string };
      if (!r.ok) { setPlanMsg(d.error ?? "Erro ao comprar"); }
      else { setPlanType("pro"); setPlanMsg("PRO ativado por 30 dias! 🎉"); }
    } catch { setPlanMsg("Erro de conexão"); }
    finally { setPlanBuying(false); setTimeout(() => setPlanMsg(""), 4000); }
  };

  const saveCardTheme = async (theme: string) => {
    setCardTheme(theme); setThemeSaving(true);
    try {
      await fetch("/api/infinity/me/social", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ cardTheme: theme }),
      });
    } catch {}
    finally { setThemeSaving(false); }
  };

  // ── Presets ───────────────────────────────────────────────────────────────
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetApplying, setPresetApplying] = useState<number | null>(null);
  const [showPresetInput, setShowPresetInput] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");

  const loadPresets = useCallback(async () => {
    try {
      const r = await fetch("/api/infinity/me/presets", { headers: authHeaders() });
      if (r.ok) setPresets(await r.json() as PresetSummary[]);
    } catch { /* silent */ }
  }, []);

  const savePreset = async () => {
    if (!newPresetName.trim()) return;
    setPresetSaving(true);
    try {
      const r = await fetch("/api/infinity/me/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: newPresetName.trim(),
          theme: localStorage.getItem(LS_THEME) ?? "sky",
          photo: photo ?? null,
          banner: banner ?? null,
        }),
      });
      if (r.ok) {
        const p = await r.json() as PresetSummary;
        setPresets(prev => [p, ...prev]);
        setNewPresetName("");
        setShowPresetInput(false);
      }
    } catch { /* silent */ }
    finally { setPresetSaving(false); }
  };

  const applyPreset = async (preset: PresetSummary) => {
    setPresetApplying(preset.id);
    try {
      const r = await fetch(`/api/infinity/me/presets/${preset.id}/apply`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!r.ok) return;
      const data = await r.json() as { theme: string | null; photo: string | null; banner: string | null };
      // Apply photo + banner
      if (data.photo !== undefined) {
        setPhoto(data.photo);
        data.photo ? localStorage.setItem(LS_PHOTO, data.photo) : localStorage.removeItem(LS_PHOTO);
      }
      if (data.banner !== undefined) {
        setBanner(data.banner);
        data.banner ? localStorage.setItem(LS_BANNER, data.banner) : localStorage.removeItem(LS_BANNER);
      }
      // Apply theme
      if (data.theme) {
        localStorage.setItem(LS_THEME, data.theme);
        const t = THEMES.find(x => x.key === data.theme);
        if (t) applyTheme(t);
      }
      dispatchUpdate();
    } catch { /* silent */ }
    finally { setPresetApplying(null); }
  };

  const deletePreset = async (id: number) => {
    try {
      await fetch(`/api/infinity/me/presets/${id}`, { method: "DELETE", headers: authHeaders() });
      setPresets(prev => prev.filter(p => p.id !== id));
    } catch { /* silent */ }
  };

  const loadFriends = useCallback(async () => {
    setFriendsLoading(true);
    try {
      const r = await fetch("/api/infinity/friends", { headers: authHeaders() });
      if (r.ok) {
        const list = await r.json() as { id: number; username: string; displayName: string; photo: string | null; status: string; direction: string; friendStatus: string }[];
        setFriends(list.map(f => ({ ...f, friendStatus: f.status })));
      }
    } catch {}
    finally { setFriendsLoading(false); }
  }, []);

  useEffect(() => {
    fetch("/api/infinity/me", { headers: authHeaders() })
      .then(r => r.json())
      .then((d: {
        displayName?: string | null; pinSet?: boolean;
        profilePhoto?: string | null; profileBanner?: string | null;
        profileBio?: string | null; profileStatus?: string | null;
        profileStatusMsg?: string | null; hideUsername?: boolean;
      }) => {
        setDisplayName(d.displayName ?? "");
        setHasPinSet(d.pinSet ?? false);
        if (d.profilePhoto !== undefined) { setPhoto(d.profilePhoto); if (d.profilePhoto) localStorage.setItem(LS_PHOTO, d.profilePhoto); else localStorage.removeItem(LS_PHOTO); }
        if (d.profileBanner !== undefined) { setBanner(d.profileBanner); if (d.profileBanner) localStorage.setItem(LS_BANNER, d.profileBanner); else localStorage.removeItem(LS_BANNER); }
        if (d.profileBio !== undefined) { setBio(d.profileBio ?? ""); localStorage.setItem(LS_BIO, d.profileBio ?? ""); }
        if (d.profileStatus) { setStatus(d.profileStatus as StatusType); localStorage.setItem(LS_STATUS, d.profileStatus); }
        if (d.profileStatusMsg !== undefined) { setStatusMsg(d.profileStatusMsg ?? ""); localStorage.setItem(LS_STATUS_MSG, d.profileStatusMsg ?? ""); }
        if (d.hideUsername !== undefined) { setHideUsername(d.hideUsername); d.hideUsername ? localStorage.setItem(LS_HIDE_USERNAME, "true") : localStorage.removeItem(LS_HIDE_USERNAME); }
      })
      .catch(() => {});

    // Load social profile
    fetch("/api/infinity/me/social", { headers: authHeaders() })
      .then(r => r.json())
      .then((d: { location?: string | null; musicUrl?: string | null; socialLinks?: { type: string; value: string }[]; cardTheme?: string; planType?: string; bgType?: string; bgValue?: string | null }) => {
        setSocialLocation(d.location ?? "");
        setSocialMusicUrl(d.musicUrl ?? "");
        setSocialLinks(Array.isArray(d.socialLinks) ? d.socialLinks : []);
        if (d.cardTheme) setCardTheme(d.cardTheme);
        if (d.planType) setPlanType(d.planType);
        if (d.bgType && (d.bgType === "image" || d.bgType === "color" || d.bgType === "default")) setSocialBgType(d.bgType);
        setSocialBgValue(d.bgValue ?? "");
      })
      .catch(() => {});

    loadPresets();
    loadFriends();
  }, [loadPresets, loadFriends]);

  const saveSocial = async () => {
    setSocialSaving(true);
    try {
      await fetch("/api/infinity/me/social", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          location: socialLocation.trim() || null,
          musicUrl: socialMusicUrl.trim() || null,
          socialLinks,
          bgType: socialBgType,
          bgValue: socialBgValue.trim() || null,
        }),
      });
      setSocialSaved(true);
      setTimeout(() => setSocialSaved(false), 2200);
    } catch {}
    finally { setSocialSaving(false); }
  };

  const addSocialLink = () => {
    if (!newLinkValue.trim() || socialLinks.length >= 8) return;
    setSocialLinks(prev => [...prev, { type: newLinkType, value: newLinkValue.trim() }]);
    setNewLinkValue("");
  };

  const removeSocialLink = (i: number) => setSocialLinks(prev => prev.filter((_, idx) => idx !== i));

  const sendFriendRequest = async () => {
    if (!addFriendInput.trim()) return;
    setAddFriendLoading(true); setAddFriendMsg("");
    try {
      const r = await fetch("/api/infinity/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ username: addFriendInput.trim() }),
      });
      const d = await r.json() as { error?: string; message?: string };
      if (!r.ok) { setAddFriendMsg(d.error ?? "Erro"); }
      else { setAddFriendMsg(d.message ?? "Pedido enviado!"); setAddFriendInput(""); loadFriends(); }
    } catch { setAddFriendMsg("Erro de conexão"); }
    finally { setAddFriendLoading(false); }
  };

  const respondFriend = async (id: number, action: "accept" | "decline" | "delete") => {
    const url = action === "delete"
      ? `/api/infinity/friends/${id}`
      : `/api/infinity/friends/${id}/${action}`;
    const method = action === "delete" ? "DELETE" : "POST";
    await fetch(url, { method, headers: authHeaders() });
    loadFriends();
  };

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

  const handleSave = async () => {
    // Save to localStorage (instant feedback)
    photo  ? localStorage.setItem(LS_PHOTO, photo)   : localStorage.removeItem(LS_PHOTO);
    banner ? localStorage.setItem(LS_BANNER, banner)  : localStorage.removeItem(LS_BANNER);
    localStorage.setItem(LS_BIO, bio.slice(0, 160));
    localStorage.setItem(LS_STATUS, status);
    localStorage.setItem(LS_STATUS_MSG, statusMsg.slice(0, 80));
    dispatchUpdate();
    // Persist to server (best-effort)
    fetch("/api/infinity/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        profilePhoto: photo ?? null,
        profileBanner: banner ?? null,
        profileBio: bio.slice(0, 160) || null,
        profileStatus: status,
        profileStatusMsg: statusMsg.slice(0, 80) || null,
      }),
    }).catch(() => {});
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
                  ? <>Aparece como <span style={{ color: "var(--color-primary)" }}>@hydraconsultoria</span> para você</>
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

      {/* ── Perfil Social ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
        className="rounded-2xl border border-white/8 p-5 space-y-4"
        style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(20px)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Perfil Público</h2>
          </div>
          <Link href={`/u/${user?.username ?? ""}`}>
            <span className="text-[10px] text-muted-foreground hover:text-primary transition-colors cursor-pointer">Ver →</span>
          </Link>
        </div>

        {/* Location */}
        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 flex items-center gap-1.5"><MapPin className="w-3 h-3" /> Localização</label>
          <input value={socialLocation} onChange={e => setSocialLocation(e.target.value.slice(0, 60))}
            placeholder="ex: São Paulo, Brasil"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 transition-colors placeholder:text-muted-foreground/40" />
        </div>

        {/* Music URL */}
        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1.5 flex items-center gap-1.5"><Music className="w-3 h-3" /> Link de Músicas (Spotify, SoundCloud...)</label>
          <input value={socialMusicUrl} onChange={e => setSocialMusicUrl(e.target.value.slice(0, 200))}
            placeholder="https://open.spotify.com/..."
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 transition-colors placeholder:text-muted-foreground/40" />
        </div>

        {/* Background personalizado */}
        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-1.5">
            <Globe className="w-3 h-3" /> Fundo do Perfil Público
          </label>

          {/* Type tabs */}
          <div className="flex gap-2 mb-3">
            {(["default", "image", "color"] as const).map(t => (
              <button
                key={t}
                onClick={() => setSocialBgType(t)}
                className="flex-1 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all"
                style={socialBgType === t
                  ? { background: "color-mix(in srgb, var(--color-primary) 20%, transparent)", color: "var(--color-primary)", border: "1px solid color-mix(in srgb, var(--color-primary) 40%, transparent)" }
                  : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.08)" }
                }
              >
                {t === "default" ? "Padrão" : t === "image" ? "Imagem / GIF" : "Cor"}
              </button>
            ))}
          </div>

          {/* Image / GIF input */}
          {socialBgType === "image" && (
            <div className="space-y-2">
              {/* URL input */}
              <div className="relative">
                <input
                  value={socialBgValue}
                  onChange={e => setSocialBgValue(e.target.value.slice(0, 2000))}
                  placeholder="https://i.imgur.com/... ou URL de GIF"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 transition-colors placeholder:text-muted-foreground/30 pr-12"
                />
                {socialBgValue && (
                  <button
                    onClick={() => setSocialBgValue("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/60 transition-colors"
                  >
                    <XIcon className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* OR file upload */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-white/8" />
                <span className="text-[9px] text-white/25 uppercase tracking-widest">ou</span>
                <div className="flex-1 h-px bg-white/8" />
              </div>

              <label
                className="flex flex-col items-center justify-center gap-2 w-full py-4 rounded-xl cursor-pointer transition-all hover:bg-white/5 border border-dashed border-white/15 hover:border-white/30"
                style={{ background: "rgba(255,255,255,0.02)" }}
              >
                <input
                  type="file"
                  accept="image/*,.gif"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 9.5 * 1024 * 1024) { alert("Arquivo muito grande. Máximo ~9MB."); return; }
                    const reader = new FileReader();
                    reader.onload = async (ev) => {
                      const dataUrl = ev.target?.result as string;
                      setSocialBgValue(dataUrl);
                      setSocialBgType("image");
                      // AUTO-SAVE imediato — sem precisar clicar em "Salvar"
                      setSocialSaving(true);
                      try {
                        const r = await fetch("/api/infinity/me/social", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json", ...authHeaders() },
                          body: JSON.stringify({ bgType: "image", bgValue: dataUrl }),
                        });
                        if (r.ok) { setSocialSaved(true); setTimeout(() => setSocialSaved(false), 2200); }
                        else { const j = await r.json().catch(() => ({})); alert(j.error || "Erro ao salvar fundo"); }
                      } catch { alert("Erro de conexão"); }
                      finally { setSocialSaving(false); }
                    };
                    reader.readAsDataURL(f);
                  }}
                />
                <ImageIcon className="w-6 h-6 text-white/25" />
                <div className="text-center">
                  <p className="text-[11px] font-semibold text-white/50">Clique para enviar arquivo</p>
                  <p className="text-[9px] text-white/25 mt-0.5">JPG, PNG, WebP, GIF animado</p>
                </div>
              </label>

              {/* Preview */}
              {socialBgValue && (
                <div className="relative rounded-xl overflow-hidden h-24 border border-white/10">
                  <img
                    src={socialBgValue}
                    alt="preview"
                    className="w-full h-full object-cover"
                    style={{ filter: "blur(6px) brightness(0.5)", transform: "scale(1.05)" }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[9px] text-white/60 uppercase tracking-widest bg-black/40 px-2 py-1 rounded">
                      {socialBgValue.includes(".gif") || socialBgValue.startsWith("data:image/gif") ? "🎞 GIF detectado" : "Pré-visualização"}
                    </span>
                  </div>
                </div>
              )}

              <p className="text-[9px] text-muted-foreground/30">
                Aparece desfocada e escurecida como fundo da sua página pública. Suporta GIFs animados.
              </p>
            </div>
          )}

          {/* Color picker */}
          {socialBgType === "color" && (
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={socialBgValue || "#07090f"}
                onChange={e => setSocialBgValue(e.target.value)}
                className="w-12 h-10 rounded-lg cursor-pointer border border-white/10 bg-transparent"
              />
              <span className="text-sm font-mono text-muted-foreground/50">{socialBgValue || "#07090f"}</span>
              <div className="w-6 h-6 rounded-full border border-white/10 shrink-0" style={{ background: socialBgValue || "#07090f" }} />
            </div>
          )}
        </div>

        {/* Social Links */}
        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-2 block">Links Sociais ({socialLinks.length}/8)</label>
          <div className="space-y-2 mb-2">
            {socialLinks.map((link, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/4 border border-white/8">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 w-16 shrink-0">{link.type}</span>
                <span className="text-sm flex-1 truncate">{link.value}</span>
                <button onClick={() => removeSocialLink(i)} className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"><XIcon className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
          {socialLinks.length < 8 && (
            <div className="flex gap-2">
              <select value={newLinkType} onChange={e => setNewLinkType(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-primary/50 transition-colors shrink-0">
                {["instagram","twitter","youtube","github","twitch","tiktok","discord","website"].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input value={newLinkValue} onChange={e => setNewLinkValue(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addSocialLink(); }}
                placeholder="@user ou URL"
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary/50 transition-colors placeholder:text-muted-foreground/40" />
              <button onClick={addSocialLink} disabled={!newLinkValue.trim()}
                className="px-3 py-2 rounded-xl text-sm font-bold disabled:opacity-40 transition-all"
                style={{ background: "color-mix(in srgb, var(--color-primary) 20%, transparent)", color: "var(--color-primary)", border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)" }}>
                <Plus className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <button onClick={saveSocial} disabled={socialSaving}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold uppercase tracking-widest text-sm transition-all disabled:opacity-50"
          style={socialSaved ? { background: "#22c55e", color: "#fff" } : { background: "var(--color-primary)", color: "#000", boxShadow: "0 0 20px color-mix(in srgb, var(--color-primary) 25%, transparent)" }}>
          {socialSaved ? <><CheckCircle className="w-4 h-4" /> Salvo!</> : socialSaving ? "Salvando..." : <><Save className="w-4 h-4" /> Salvar perfil social</>}
        </button>
      </motion.div>

      {/* ── Amigos ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18 }}
        className="rounded-2xl border border-white/8 p-5 space-y-4"
        style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(20px)" }}
      >
        <div className="flex items-center gap-2">
          <UsersIcon className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Amigos</h2>
          <span className="ml-auto text-[9px] text-muted-foreground/40">{friends.filter(f => f.friendStatus === "accepted").length} amigos</span>
        </div>

        {/* Add friend input */}
        <div className="flex gap-2">
          <input value={addFriendInput} onChange={e => setAddFriendInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") sendFriendRequest(); }}
            placeholder="@usuário para adicionar..."
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 transition-colors placeholder:text-muted-foreground/40" />
          <button onClick={sendFriendRequest} disabled={addFriendLoading || !addFriendInput.trim()}
            className="px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 transition-all shrink-0"
            style={{ background: "var(--color-primary)", color: "#000" }}>
            {addFriendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
          </button>
        </div>
        {addFriendMsg && <p className="text-xs text-muted-foreground">{addFriendMsg}</p>}

        {/* Friends list */}
        {friendsLoading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : friends.length === 0 ? (
          <p className="text-xs text-muted-foreground/40 text-center py-4">Nenhum amigo ainda — adicione pelo @usuário acima</p>
        ) : (
          <div className="space-y-2">
            {friends.map(f => {
              const statusColor: Record<string, string> = { online: "#22c55e", busy: "#ef4444", away: "#f59e0b", offline: "#6b7280" };
              return (
                <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/4 border border-white/8">
                  <div className="relative w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-xs font-bold"
                    style={{ background: f.photo ? "transparent" : "#3b82f6", color: "#fff" }}>
                    {f.photo ? <img src={f.photo} className="w-full h-full object-cover" /> : f.displayName?.[0]?.toUpperCase()}
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-background"
                      style={{ background: statusColor[f.status] ?? "#6b7280" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/u/${f.username}`}>
                      <span className="text-sm font-semibold hover:underline cursor-pointer">{f.displayName}</span>
                    </Link>
                    <p className="text-[10px] text-muted-foreground/50">@{f.username}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {f.friendStatus === "pending" && f.direction === "received" && (
                      <>
                        <button onClick={() => respondFriend(f.id, "accept")} title="Aceitar"
                          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-green-500/20 transition-colors">
                          <CheckCircle className="w-4 h-4 text-green-400" />
                        </button>
                        <button onClick={() => respondFriend(f.id, "decline")} title="Recusar"
                          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/20 transition-colors">
                          <XCircle className="w-4 h-4 text-red-400" />
                        </button>
                      </>
                    )}
                    {f.friendStatus === "pending" && f.direction === "sent" && (
                      <span className="text-[10px] text-muted-foreground/40 italic">Pendente</span>
                    )}
                    {f.friendStatus === "accepted" && (
                      <button onClick={() => respondFriend(f.id, "delete")} title="Remover amigo"
                        className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/20 transition-colors text-muted-foreground/30 hover:text-red-400 transition-colors">
                        <XIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* ── Card Tema PRO ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.185 }}
        className="rounded-2xl border border-white/8 p-5 space-y-4"
        style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(20px)" }}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Tema do Card</h2>
            {planType === "pro" || user?.role === "admin" ? (
              <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full font-bold text-black flex items-center gap-0.5" style={{ background: "var(--color-primary)" }}>
                <Crown className="w-2.5 h-2.5" /> PRO
              </span>
            ) : (
              <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full font-bold border border-white/20 text-muted-foreground">FREE</span>
            )}
          </div>
          {planType === "free" && user?.role !== "admin" && (
            <button onClick={buyPlan} disabled={planBuying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50 animate-pulse"
              style={{ background: "var(--color-primary)", color: "#000" }}>
              <Sparkles className="w-3 h-3" />
              {planBuying ? "Processando..." : "Ativar PRO — R$2,99"}
            </button>
          )}
        </div>

        {planMsg && (
          <p className={`text-xs px-3 py-2 rounded-xl ${planMsg.includes("🎉") ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
            {planMsg}
          </p>
        )}

        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-widest -mt-1">
          Escolha o tema visual do seu cartão de perfil público
        </p>

        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {ALL_THEMES.map(t => {
            const isLocked = t.pro && planType !== "pro" && user?.role !== "admin";
            const isSelected = cardTheme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => !isLocked && saveCardTheme(t.id)}
                disabled={isLocked}
                title={isLocked ? "Requer PRO" : t.label}
                className={`relative flex flex-col items-center gap-2 p-3 rounded-2xl border transition-all ${isSelected ? "scale-105" : "hover:scale-102 opacity-70 hover:opacity-100"} ${isLocked ? "cursor-not-allowed" : "cursor-pointer"}`}
                style={{
                  borderColor: isSelected ? "var(--color-primary)" : "rgba(255,255,255,0.07)",
                  background: isSelected ? "color-mix(in srgb, var(--color-primary) 10%, transparent)" : "rgba(255,255,255,0.03)",
                }}
              >
                {/* Mini color preview */}
                <div className="w-full h-8 rounded-xl overflow-hidden flex">
                  {t.colors.map((c, i) => (
                    <div key={i} className="flex-1 h-full" style={{ background: c }} />
                  ))}
                </div>
                <span className="text-[10px] text-center truncate w-full" style={{ color: isSelected ? "var(--color-primary)" : "rgba(255,255,255,0.5)" }}>{t.label}</span>
                {isLocked && (
                  <span className="absolute top-1 right-1 text-[8px] text-yellow-400">🔒</span>
                )}
                {isSelected && (
                  <span className="absolute top-1 left-1 w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ background: "var(--color-primary)" }}>
                    <Check className="w-2 h-2 text-black" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {themeSaving && <p className="text-[10px] text-muted-foreground/50 text-center animate-pulse">Salvando tema...</p>}
      </motion.div>

      {/* ── Presets ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.19 }}
        className="rounded-2xl border border-white/8 p-5 space-y-4"
        style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(20px)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Presets</h2>
            <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full font-bold text-black" style={{ background: "var(--color-primary)" }}>
              {presets.length}/10
            </span>
          </div>
          <button
            onClick={() => setShowPresetInput(v => !v)}
            disabled={presets.length >= 10}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold uppercase tracking-wider border transition-all disabled:opacity-40"
            style={{ borderColor: "color-mix(in srgb, var(--color-primary) 40%, transparent)", color: "var(--color-primary)", background: "color-mix(in srgb, var(--color-primary) 8%, transparent)" }}
          >
            <Plus className="w-3 h-3" /> Salvar atual
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-widest -mt-1">
          Salve seu tema + foto + banner atual como um preset reutilizável
        </p>

        {/* Name input */}
        <AnimatePresence>
          {showPresetInput && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex gap-2 pt-1">
                <input
                  autoFocus
                  value={newPresetName}
                  onChange={e => setNewPresetName(e.target.value)}
                  maxLength={40}
                  placeholder="Nome do preset (ex: Dark VIP)"
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
                  onKeyDown={e => { if (e.key === "Enter") void savePreset(); if (e.key === "Escape") setShowPresetInput(false); }}
                />
                <button
                  onClick={() => void savePreset()}
                  disabled={presetSaving || !newPresetName.trim()}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                  style={{ background: "var(--color-primary)", color: "#000" }}
                >
                  {presetSaving ? "..." : <Check className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { setShowPresetInput(false); setNewPresetName(""); }}
                  className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <XIcon className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Preset list */}
        {presets.length > 0 ? (
          <div className="space-y-2">
            {presets.map(p => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/4 border border-white/8"
              >
                {/* Theme color dot */}
                <div
                  className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)" }}
                >
                  <Bookmark className="w-3.5 h-3.5" style={{ color: "var(--color-primary)" }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground truncate">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground/60 flex items-center gap-2 mt-0.5">
                    {p.theme && <span className="capitalize">{p.theme}</span>}
                    {p.hasPhoto && <span>· foto</span>}
                    {p.hasBanner && <span>· banner</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => void applyPreset(p)}
                    disabled={presetApplying === p.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                    style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", color: "var(--color-primary)", border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)" }}
                  >
                    {presetApplying === p.id ? "..." : <><Play className="w-3 h-3" /> Aplicar</>}
                  </button>
                  <button
                    onClick={() => void deletePreset(p.id)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 hover:bg-destructive/20 hover:border-destructive/40 transition-colors"
                  >
                    <Trash2 className="w-3 h-3 text-muted-foreground/60" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground/40 text-sm">
            <BookmarkPlus className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">Nenhum preset salvo. Configure seu tema e fotos, depois salve como preset!</p>
          </div>
        )}
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
          Salvo automaticamente na nuvem — disponível em qualquer dispositivo
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
