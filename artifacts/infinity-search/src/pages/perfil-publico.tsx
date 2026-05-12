import { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin, Eye, Crown, Shield, UserPlus, Check, Loader2,
  MessageCircle, ArrowLeft, Users, Calendar, UserCheck,
  Copy, CheckCheck, ExternalLink, Music, Globe,
  Instagram, Twitter, Youtube, Github, Twitch,
} from "lucide-react";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function isLoggedIn(): boolean { return !!localStorage.getItem("infinity_token"); }
function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 65%, 62%)`;
}

interface SocialLink { type: string; value: string }
interface PublicProfile {
  username: string; displayName: string; role: string;
  bio: string | null; status: string; statusMsg: string | null;
  photo: string | null; banner: string | null;
  location: string | null; musicUrl: string | null;
  socialLinks: SocialLink[]; accentColor: string | null;
  bgType: string; bgValue: string | null;
  views: number; createdAt: string; cardTheme: string;
}

const STATUS_COLOR: Record<string, string> = {
  online: "#22c55e", busy: "#ef4444", away: "#f59e0b", offline: "#6b7280",
};
const STATUS_LABEL: Record<string, string> = {
  online: "Online", busy: "Ocupado", away: "Ausente", offline: "Offline",
};

// ── Brand-colored social icons ────────────────────────────────────────────────
const SOCIAL_BRANDS: Record<string, { color: string; bg: string; label: string }> = {
  discord:   { color: "#fff",     bg: "#5865F2", label: "Discord" },
  tiktok:    { color: "#fff",     bg: "#010101", label: "TikTok" },
  roblox:    { color: "#fff",     bg: "#e2231a", label: "Roblox" },
  instagram: { color: "#fff",     bg: "linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)", label: "Instagram" },
  twitter:   { color: "#fff",     bg: "#000",    label: "Twitter" },
  x:         { color: "#fff",     bg: "#000",    label: "X" },
  youtube:   { color: "#fff",     bg: "#FF0000", label: "YouTube" },
  github:    { color: "#fff",     bg: "#24292e", label: "GitHub" },
  twitch:    { color: "#fff",     bg: "#9146FF", label: "Twitch" },
  spotify:   { color: "#fff",     bg: "#1DB954", label: "Spotify" },
  website:   { color: "#fff",     bg: "#334155", label: "Website" },
};

function SocialIconSvg({ type, size = 16 }: { type: string; size?: number }) {
  const t = type.toLowerCase();
  if (t === "discord") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  );
  if (t === "tiktok") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.16 8.16 0 0 0 4.77 1.52V6.74a4.85 4.85 0 0 1-1-.05z"/>
    </svg>
  );
  if (t === "roblox") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.69 16.4L7.6 3.69 20.31 7.6l-3.91 12.71L3.69 16.4zm10.21.76l1.96-6.36-6.36-1.96-1.96 6.36 6.36 1.96z"/>
    </svg>
  );
  if (t === "instagram") return <Instagram width={size} height={size} />;
  if (t === "twitter" || t === "x") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
  if (t === "youtube") return <Youtube width={size} height={size} />;
  if (t === "github") return <Github width={size} height={size} />;
  if (t === "twitch") return <Twitch width={size} height={size} />;
  if (t === "spotify") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  );
  return <Globe width={size} height={size} />;
}

function socialUrl(link: SocialLink): string {
  const t = link.type.toLowerCase();
  const v = link.value.replace(/^@/, "");
  if (t === "instagram") return `https://instagram.com/${v}`;
  if (t === "twitter" || t === "x") return `https://x.com/${v}`;
  if (t === "youtube") return link.value.startsWith("http") ? link.value : `https://youtube.com/@${v}`;
  if (t === "github") return `https://github.com/${v}`;
  if (t === "twitch") return `https://twitch.tv/${v}`;
  if (t === "tiktok") return `https://tiktok.com/@${v}`;
  if (t === "roblox") return `https://www.roblox.com/users/search?keyword=${v}`;
  if (t === "discord") return v.startsWith("http") ? v : `https://discord.gg/${v}`;
  if (link.value.startsWith("http")) return link.value;
  return `https://${link.value}`;
}

// ── Spotify card ──────────────────────────────────────────────────────────────
function SpotifyCard({ url, accent }: { url: string; accent: string }) {
  const match = url.match(/spotify\.com\/(track|album|playlist|artist)\/([A-Za-z0-9]+)/);
  if (!match) return null;
  const [type, id] = [match[1], match[2]];
  const embedUrl = `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
  const openUrl = `https://open.spotify.com/${type}/${id}`;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] mb-4 group"
      style={{ background: "rgba(29,185,84,0.05)" }}>
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(135deg, rgba(29,185,84,0.08) 0%, transparent 60%)" }} />
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="#1DB954">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
        </svg>
        <span className="text-[9px] text-[#1DB954] font-semibold uppercase tracking-widest">Spotify</span>
        <a href={openUrl} target="_blank" rel="noopener noreferrer"
          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-white/60">
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <iframe
        src={embedUrl}
        width="100%"
        height={type === "track" ? "80" : "152"}
        frameBorder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        className="block"
        style={{ borderRadius: "0 0 16px 16px" }}
      />
    </div>
  );
}

// ── Generic music link ────────────────────────────────────────────────────────
function MusicLink({ url, accent }: { url: string; accent: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 px-3 py-2.5 rounded-2xl border mb-4 transition-all hover:scale-[1.01] group"
      style={{ borderColor: `${accent}25`, background: `${accent}08` }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${accent}20` }}>
        <Music className="w-4 h-4" style={{ color: accent }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] text-white/30 uppercase tracking-widest mb-0.5">Música</p>
        <p className="text-xs font-semibold truncate" style={{ color: accent }}>
          {url.replace(/^https?:\/\//, "").split("/")[0]}
        </p>
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
    </a>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PerfilPublico() {
  const [, params] = useRoute("/u/:username");
  const username = params?.username ?? "";
  const loggedIn = isLoggedIn();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [friendStatus, setFriendStatus] = useState<"none" | "sent" | "accepted" | "received">("none");
  const [friendId, setFriendId] = useState<number | null>(null);
  const [friendLoading, setFriendLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [myUsername, setMyUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    fetch("/api/infinity/me", { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then((d: { username?: string } | null) => { if (d?.username) setMyUsername(d.username); })
      .catch(() => {});
  }, [loggedIn]);

  const isMe = myUsername ? myUsername === username.toLowerCase() : false;

  useEffect(() => {
    if (!username) return;
    setLoading(true); setNotFound(false);
    fetch(`/api/infinity/u/${username}`)
      .then(r => { if (r.status === 404) { setNotFound(true); return null; } return r.json(); })
      .then((data: PublicProfile | null) => { if (data) setProfile(data); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [username]);

  useEffect(() => {
    if (!loggedIn || isMe || !myUsername) return;
    fetch("/api/infinity/friends", { headers: authHeaders() })
      .then(r => r.json())
      .then((list: { id: number; username: string; status: string; direction: string }[]) => {
        const f = list.find(x => x.username === username.toLowerCase());
        if (!f) { setFriendStatus("none"); return; }
        setFriendId(f.id);
        if (f.status === "accepted") setFriendStatus("accepted");
        else if (f.status === "pending" && f.direction === "sent") setFriendStatus("sent");
        else if (f.status === "pending" && f.direction === "received") setFriendStatus("received");
        else setFriendStatus("none");
      })
      .catch(() => {});
  }, [loggedIn, myUsername, username, isMe]);

  const sendFriendRequest = async () => {
    setFriendLoading(true);
    try {
      const r = await fetch("/api/infinity/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ username }),
      });
      if (r.ok) { const d = await r.json() as { id: number }; setFriendId(d.id); setFriendStatus("sent"); }
    } finally { setFriendLoading(false); }
  };

  const acceptFriendRequest = async () => {
    if (!friendId) return;
    setFriendLoading(true);
    try {
      const r = await fetch(`/api/infinity/friends/${friendId}/accept`, { method: "POST", headers: authHeaders() });
      if (r.ok) setFriendStatus("accepted");
    } finally { setFriendLoading(false); }
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/u/${profile?.username ?? username}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement("textarea");
      el.value = url; document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#07090f" }}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-10 h-10">
          <motion.div className="absolute inset-0 rounded-full border-2 border-cyan-400/30"
            animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0, 0.6] }} transition={{ duration: 1.5, repeat: Infinity }} />
          <div className="absolute inset-0 rounded-full border-t-2 border-cyan-400"
            style={{ animation: "spin 0.8s linear infinite" }} />
        </div>
        <p className="text-[10px] text-white/30 uppercase tracking-[0.4em]">Carregando...</p>
      </div>
    </div>
  );

  if (notFound || !profile) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 text-center px-4" style={{ background: "#07090f" }}>
      <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center text-4xl">👤</div>
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">Usuário não encontrado</h1>
        <p className="text-white/40 text-sm">@{username} não existe na plataforma.</p>
      </div>
      <a href="/" className="px-5 py-2.5 rounded-xl text-sm font-medium border border-white/10 hover:bg-white/5 transition-colors text-white/60">
        ← Voltar para Hydra
      </a>
    </div>
  );

  const accent = profile.accentColor ?? "#00d9ff";
  const statusColor = STATUS_COLOR[profile.status] ?? "#6b7280";
  const joinDate = new Date(profile.createdAt).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const isSpotify = profile.musicUrl?.includes("spotify.com");

  const hasBgImage = profile.bgType === "image" && !!profile.bgValue;
  const hasBgColor = profile.bgType === "color" && !!profile.bgValue;
  const bgSource = hasBgImage ? profile.bgValue! : (profile.banner ?? null);

  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{ background: hasBgColor ? profile.bgValue! : "#07090f" }}
    >
      {/* ── Ambient background ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {/* Custom image background (guns.lol style) OR banner blur fallback */}
        {bgSource && (
          <div className="absolute inset-0">
            <img
              src={bgSource}
              alt=""
              className="w-full h-full object-cover"
              style={{
                filter: hasBgImage
                  ? "blur(28px) saturate(1.15) brightness(0.38)"
                  : "blur(40px) saturate(0.7)",
                transform: "scale(1.12)",
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background: hasBgImage
                  ? "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.45) 60%, rgba(0,0,0,0.65) 100%)"
                  : "rgba(7,9,15,0.82)",
              }}
            />
          </div>
        )}
        {/* Color overlay when solid bg chosen */}
        {hasBgColor && (
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.18)" }} />
        )}
        {/* Glow blobs */}
        <motion.div
          className="absolute -top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full opacity-[0.08] blur-[100px]"
          style={{ background: accent }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.06, 0.1, 0.06] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full opacity-[0.04] blur-[80px]"
          style={{ background: accent }}
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 3 }}
        />
        {/* Subtle grid — only when no custom bg */}
        {!hasBgImage && !hasBgColor && (
          <div className="absolute inset-0 opacity-[0.025]"
            style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        )}
      </div>

      {/* ── Page content ── */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center py-10 px-4">
        {/* Nav row */}
        <div className="w-full max-w-sm flex items-center justify-between mb-5">
          <motion.button
            initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
            onClick={() => window.history.length > 1 ? window.history.back() : (window.location.href = "/")}
            className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/70 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </motion.button>
          <motion.button
            initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
            onClick={copyLink}
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium border transition-all"
            style={{
              borderColor: copied ? `${accent}60` : "rgba(255,255,255,0.1)",
              color: copied ? accent : "rgba(255,255,255,0.4)",
              background: copied ? `${accent}12` : "rgba(255,255,255,0.04)",
            }}
          >
            {copied ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copiado!" : "Copiar link"}
          </motion.button>
        </div>

        {/* ── Main card ── */}
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          className="w-full max-w-sm"
        >
          <div
            className="rounded-[28px] overflow-hidden border border-white/[0.07]"
            style={{
              background: "rgba(9,12,20,0.92)",
              backdropFilter: "blur(24px)",
              boxShadow: `0 0 0 1px rgba(255,255,255,0.04), 0 30px 80px -20px rgba(0,0,0,0.7), 0 0 80px -20px ${accent}20`,
            }}
          >
            {/* ── Banner / header ── */}
            <div className="relative h-32 overflow-hidden">
              {profile.banner ? (
                <img src={profile.banner} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full" style={{
                  background: `
                    radial-gradient(ellipse at 20% 60%, ${accent}22 0%, transparent 60%),
                    radial-gradient(ellipse at 80% 30%, ${accent}14 0%, transparent 50%),
                    linear-gradient(160deg, hsl(220 40% 9%) 0%, hsl(220 35% 6%) 100%)
                  `
                }}>
                  {/* Animated dot pattern */}
                  <div className="absolute inset-0 opacity-[0.08]"
                    style={{ backgroundImage: `radial-gradient(circle, ${accent} 1px, transparent 1px)`, backgroundSize: "22px 22px" }} />
                </div>
              )}
              {/* Gradient fade */}
              <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 40%, rgba(9,12,20,0.95) 100%)" }} />

              {/* Views counter */}
              <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <Eye className="w-3 h-3 text-white/40" />
                <span className="text-[10px] text-white/50 font-medium tabular-nums">{profile.views.toLocaleString("pt-BR")}</span>
              </div>

              {/* Role badge */}
              <div className="absolute top-3 right-3 flex gap-1.5">
                {profile.role === "admin" && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold"
                    style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)", backdropFilter: "blur(8px)" }}>
                    <Crown className="w-3 h-3" /> ADMIN
                  </span>
                )}
                {profile.role === "vip" && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold"
                    style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}35`, backdropFilter: "blur(8px)" }}>
                    <Shield className="w-3 h-3" /> VIP
                  </span>
                )}
              </div>
            </div>

            {/* ── Card body ── */}
            <div className="px-5 pb-6 -mt-10">
              {/* Avatar + name row */}
              <div className="flex items-end justify-between mb-4">
                {/* Avatar */}
                <div className="relative">
                  <div
                    className="w-[76px] h-[76px] rounded-2xl overflow-hidden flex items-center justify-center font-bold text-3xl"
                    style={{
                      border: `3px solid rgba(9,12,20,1)`,
                      boxShadow: `0 0 0 2px ${accent}50, 0 8px 24px rgba(0,0,0,0.6)`,
                      background: profile.photo ? "transparent" : hashColor(profile.username),
                    }}
                  >
                    {profile.photo
                      ? <img src={profile.photo} alt="" className="w-full h-full object-cover" />
                      : <span style={{ color: "#000" }}>{profile.displayName[0]?.toUpperCase()}</span>
                    }
                  </div>
                  {/* Status dot */}
                  <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full border-[3px] flex items-center justify-center"
                    style={{ borderColor: "rgba(9,12,20,1)", background: statusColor }}>
                    {profile.status === "online" && (
                      <motion.div className="absolute inset-0 rounded-full"
                        style={{ background: statusColor }}
                        animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity }} />
                    )}
                  </div>
                </div>

                {/* Status + metadata mini */}
                <div className="text-right pb-1">
                  <div className="flex items-center gap-1.5 justify-end mb-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
                    <span className="text-xs font-semibold" style={{ color: statusColor }}>{STATUS_LABEL[profile.status]}</span>
                  </div>
                  {profile.statusMsg && (
                    <p className="text-[10px] text-white/35 max-w-[140px] truncate">{profile.statusMsg}</p>
                  )}
                </div>
              </div>

              {/* Name + username */}
              <div className="mb-3">
                <h1 className="text-[22px] font-bold text-white leading-tight tracking-tight">{profile.displayName}</h1>
                <p className="text-xs mt-0.5" style={{ color: `${accent}90` }}>@{profile.username}</p>
              </div>

              {/* Bio */}
              {profile.bio && (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
                  className="mb-4 px-3 py-2.5 rounded-2xl text-sm text-white/70 leading-relaxed"
                  style={{ background: `${accent}08`, border: `1px solid ${accent}18`, borderLeft: `2px solid ${accent}60` }}
                >
                  {profile.bio}
                </motion.div>
              )}

              {/* Meta row */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4">
                {profile.location && (
                  <div className="flex items-center gap-1.5 text-xs text-white/35">
                    <MapPin className="w-3 h-3 shrink-0" style={{ color: `${accent}80` }} />
                    {profile.location}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-white/35">
                  <Calendar className="w-3 h-3 shrink-0" style={{ color: `${accent}80` }} />
                  Membro desde {joinDate}
                </div>
              </div>

              {/* ── Music ── */}
              {profile.musicUrl && isSpotify && <SpotifyCard url={profile.musicUrl} accent={accent} />}
              {profile.musicUrl && !isSpotify && <MusicLink url={profile.musicUrl} accent={accent} />}

              {/* ── Social links ── */}
              {profile.socialLinks.length > 0 && (
                <div className="mb-4">
                  {/* Pill-style row for < 5 links */}
                  {profile.socialLinks.length <= 4 ? (
                    <div className="flex flex-wrap gap-2">
                      {profile.socialLinks.map((link, i) => {
                        const brand = SOCIAL_BRANDS[link.type.toLowerCase()] ?? SOCIAL_BRANDS.website!;
                        return (
                          <motion.a
                            key={i}
                            href={socialUrl(link)}
                            target="_blank" rel="noopener noreferrer"
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 0.1 + i * 0.05 }}
                            whileHover={{ scale: 1.05, y: -1 }}
                            whileTap={{ scale: 0.96 }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                            style={{
                              background: typeof brand.bg === "string" && brand.bg.startsWith("linear")
                                ? brand.bg : brand.bg,
                              color: brand.color,
                              boxShadow: `0 2px 12px rgba(0,0,0,0.3)`,
                            }}
                          >
                            <SocialIconSvg type={link.type} size={13} />
                            <span className="capitalize">{brand.label}</span>
                          </motion.a>
                        );
                      })}
                    </div>
                  ) : (
                    // Icon grid for 5+ links
                    <div className="flex flex-wrap gap-2.5 justify-center">
                      {profile.socialLinks.map((link, i) => {
                        const brand = SOCIAL_BRANDS[link.type.toLowerCase()] ?? SOCIAL_BRANDS.website!;
                        return (
                          <motion.a
                            key={i}
                            href={socialUrl(link)}
                            target="_blank" rel="noopener noreferrer"
                            initial={{ opacity: 0, scale: 0.7 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 0.1 + i * 0.04, type: "spring", stiffness: 300 }}
                            whileHover={{ scale: 1.12, y: -2 }}
                            whileTap={{ scale: 0.93 }}
                            title={brand.label}
                            className="w-11 h-11 rounded-2xl flex items-center justify-center transition-all"
                            style={{
                              background: typeof brand.bg === "string" && brand.bg.startsWith("linear")
                                ? brand.bg : brand.bg,
                              color: brand.color,
                              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                            }}
                          >
                            <SocialIconSvg type={link.type} size={20} />
                          </motion.a>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Divider ── */}
              <div className="h-px mb-4" style={{ background: `linear-gradient(to right, transparent, ${accent}20, transparent)` }} />

              {/* ── Action buttons ── */}
              {isMe ? (
                <Link href="/perfil">
                  <button className="w-full py-3 rounded-2xl text-sm font-bold border transition-all hover:bg-white/5"
                    style={{ borderColor: `${accent}25`, color: accent }}>
                    Editar meu perfil
                  </button>
                </Link>
              ) : loggedIn ? (
                <div className="flex gap-2">
                  {friendStatus === "none" && (
                    <motion.button
                      onClick={sendFriendRequest} disabled={friendLoading}
                      whileTap={{ scale: 0.97 }}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold transition-all disabled:opacity-50"
                      style={{ background: accent, color: "#000", boxShadow: `0 4px 20px ${accent}35` }}>
                      {friendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                      Adicionar
                    </motion.button>
                  )}
                  {friendStatus === "sent" && (
                    <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm border border-white/10 text-white/40">
                      <Check className="w-4 h-4" /> Pedido enviado
                    </div>
                  )}
                  {friendStatus === "received" && (
                    <motion.button onClick={acceptFriendRequest} disabled={friendLoading}
                      whileTap={{ scale: 0.97 }}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold"
                      style={{ background: accent, color: "#000" }}>
                      {friendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                      Aceitar pedido
                    </motion.button>
                  )}
                  {friendStatus === "accepted" && (
                    <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm border border-green-500/25 text-green-400">
                      <Users className="w-4 h-4" /> Amigos
                    </div>
                  )}
                  <Link href="/comunidade">
                    <motion.button whileTap={{ scale: 0.95 }}
                      className="w-12 h-12 rounded-2xl flex items-center justify-center border transition-all hover:bg-white/5"
                      style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
                      <MessageCircle className="w-4 h-4" />
                    </motion.button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  <a href="/registro"
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl text-sm font-bold transition-all hover:opacity-90"
                    style={{ background: accent, color: "#000", boxShadow: `0 4px 20px ${accent}35` }}>
                    <UserPlus className="w-4 h-4" /> Criar conta na Hydra
                  </a>
                  <a href="/login"
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl text-sm font-medium border border-white/10 text-white/50 hover:text-white hover:bg-white/5 transition-all">
                    Já tenho conta — Entrar
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* ── Branding footer ── */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
            className="flex items-center justify-center gap-2 mt-5"
          >
            <div className="w-3.5 h-3.5 opacity-30">
              <svg viewBox="0 0 24 24" fill="currentColor" className="text-cyan-400">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
              </svg>
            </div>
            <a href="/" className="text-[10px] text-white/20 hover:text-white/50 transition-colors uppercase tracking-[0.35em]">
              Hydra Consultoria
            </a>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
