import { useState, useEffect, useRef } from "react";
import { useRoute, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin, Eye, Crown, Shield, UserPlus, Check, Loader2,
  MessageCircle, ArrowLeft, Users, Calendar, UserCheck,
  Copy, CheckCheck, ExternalLink, Music, Globe,
  Instagram, Twitter, Youtube, Github, Twitch, Camera,
} from "lucide-react";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function isLoggedIn(): boolean { return !!localStorage.getItem("infinity_token"); }
function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 60%, 55%)`;
}
function isGifUrl(url: string): boolean {
  return /\.gif($|\?)/i.test(url) || url.includes("giphy.com") || url.includes("tenor.com") || url.includes("media.discordapp") || url.includes("cdn.discordapp");
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

const SOCIAL_BRANDS: Record<string, { color: string; bg: string; label: string }> = {
  discord:   { color: "#fff", bg: "#5865F2",     label: "Discord" },
  tiktok:    { color: "#fff", bg: "#010101",     label: "TikTok" },
  roblox:    { color: "#fff", bg: "#e2231a",     label: "Roblox" },
  instagram: { color: "#fff", bg: "linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)", label: "Instagram" },
  twitter:   { color: "#fff", bg: "#000",        label: "X / Twitter" },
  x:         { color: "#fff", bg: "#000",        label: "X" },
  youtube:   { color: "#fff", bg: "#FF0000",     label: "YouTube" },
  github:    { color: "#fff", bg: "#24292e",     label: "GitHub" },
  twitch:    { color: "#fff", bg: "#9146FF",     label: "Twitch" },
  spotify:   { color: "#fff", bg: "#1DB954",     label: "Spotify" },
  website:   { color: "#fff", bg: "rgba(255,255,255,0.12)", label: "Website" },
};

function SocialIconSvg({ type, size = 18 }: { type: string; size?: number }) {
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

function SpotifyCard({ url }: { url: string }) {
  const match = url.match(/spotify\.com\/(track|album|playlist|artist)\/([A-Za-z0-9]+)/);
  if (!match) return null;
  const [type, id] = [match[1], match[2]];
  const embedUrl = `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
  return (
    <div className="w-full overflow-hidden rounded-2xl" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.5)" }}>
      <iframe
        src={embedUrl}
        width="100%"
        height={type === "track" ? "80" : "152"}
        frameBorder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        className="block rounded-2xl"
      />
    </div>
  );
}

function MusicCard({ url, accent }: { url: string; accent: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98]"
      style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.1)" }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${accent}25` }}>
        <Music className="w-5 h-5" style={{ color: accent }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-white/40 uppercase tracking-widest font-medium">Música</p>
        <p className="text-sm font-semibold truncate text-white/90">
          {url.replace(/^https?:\/\//, "").split("/")[0]}
        </p>
      </div>
      <ExternalLink className="w-4 h-4 text-white/30 shrink-0" />
    </a>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
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
  const [bgLoaded, setBgLoaded] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

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
    setLoading(true); setNotFound(false); setBgLoaded(false);
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
    try { await navigator.clipboard.writeText(url); }
    catch {
      const el = document.createElement("textarea");
      el.value = url; document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  // Photo upload for "isMe" shortcut
  const handleQuickPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      localStorage.setItem("infinity_profile_photo", dataUrl);
      await fetch("/api/infinity/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ profilePhoto: dataUrl }),
      }).catch(() => {});
      if (profile) setProfile({ ...profile, photo: dataUrl });
    };
    reader.readAsDataURL(f);
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#07090f]">
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-12 h-12">
          <motion.div className="absolute inset-0 rounded-full border border-cyan-400/20"
            animate={{ scale: [1, 1.8, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 1.8, repeat: Infinity }} />
          <div className="absolute inset-0 rounded-full border-t-2 border-cyan-400"
            style={{ animation: "spin 0.9s linear infinite" }} />
        </div>
        <p className="text-[10px] text-white/25 uppercase tracking-[0.5em]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Carregando</p>
      </div>
    </div>
  );

  if (notFound || !profile) return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 text-center px-6 bg-[#07090f]">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
        className="w-24 h-24 rounded-3xl bg-white/5 flex items-center justify-center text-5xl border border-white/10"
      >👤</motion.div>
      <div>
        <h1 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Usuário não encontrado
        </h1>
        <p className="text-white/40">@{username} não existe nesta plataforma.</p>
      </div>
      <a href="/" className="px-6 py-3 rounded-2xl text-sm font-semibold border border-white/10 hover:bg-white/5 transition-colors text-white/50">
        ← Hydra Consultoria
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
  const bgIsGif = bgSource ? isGifUrl(bgSource) : false;

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ fontFamily: "'Space Grotesk', 'Plus Jakarta Sans', sans-serif" }}>
      {/* ── FULL-SCREEN BACKGROUND ── */}
      <div className="absolute inset-0 z-0">
        {/* Solid color base */}
        <div
          className="absolute inset-0"
          style={{ background: hasBgColor ? profile.bgValue! : "#07090f" }}
        />

        {/* Image / GIF background */}
        {bgSource && (
          <>
            {bgIsGif ? (
              /* Animated GIF: use <img> to preserve animation */
              <img
                src={bgSource}
                alt=""
                onLoad={() => setBgLoaded(true)}
                className="absolute inset-0 w-full h-full"
                style={{
                  objectFit: "cover",
                  filter: "blur(22px) saturate(1.3) brightness(0.35)",
                  transform: "scale(1.1)",
                }}
              />
            ) : (
              <img
                src={bgSource}
                alt=""
                onLoad={() => setBgLoaded(true)}
                className="absolute inset-0 w-full h-full"
                style={{
                  objectFit: "cover",
                  filter: "blur(28px) saturate(1.2) brightness(0.32)",
                  transform: "scale(1.1)",
                }}
              />
            )}
            {/* Dark overlay gradient */}
            <div
              className="absolute inset-0"
              style={{
                background: "linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.65) 100%)",
              }}
            />
          </>
        )}

        {/* Ambient accent glow (top center) */}
        <motion.div
          className="absolute inset-x-0 top-0 h-[50vh] pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 70% 100% at 50% 0%, ${accent}18 0%, transparent 70%)`,
          }}
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Bottom glow */}
        <div
          className="absolute inset-x-0 bottom-0 h-[30vh] pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 60% 100% at 50% 100%, ${accent}10 0%, transparent 70%)`,
          }}
        />

        {/* Noise texture overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.035]"
          style={{
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
            backgroundRepeat: "repeat",
            backgroundSize: "128px",
          }}
        />
      </div>

      {/* ── FLOATING NAV (top corners) ── */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-4 pt-4 pointer-events-none">
        <motion.button
          initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
          onClick={() => window.history.length > 1 ? window.history.back() : (window.location.href = "/")}
          className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-white/50 hover:text-white transition-colors"
          style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span className="tracking-wide">Voltar</span>
        </motion.button>

        <motion.button
          initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
          onClick={copyLink}
          whileTap={{ scale: 0.95 }}
          className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition-all"
          style={{
            background: copied ? `${accent}22` : "rgba(0,0,0,0.4)",
            backdropFilter: "blur(12px)",
            border: `1px solid ${copied ? `${accent}40` : "rgba(255,255,255,0.08)"}`,
            color: copied ? accent : "rgba(255,255,255,0.5)",
          }}
        >
          {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="tracking-wide">{copied ? "Copiado!" : "Compartilhar"}</span>
        </motion.button>
      </div>

      {/* ── VIEWS COUNTER (bottom-left floating) ── */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        className="absolute bottom-4 left-4 z-50 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl pointer-events-none"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <Eye className="w-3 h-3 text-white/30" />
        <span className="text-[11px] text-white/40 tabular-nums font-medium">{profile.views.toLocaleString("pt-BR")}</span>
      </motion.div>

      {/* ── HYDRA BRANDING (bottom-right floating) ── */}
      <motion.a
        href="/"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
        className="absolute bottom-4 right-4 z-50 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <span className="text-[10px] text-white/25 tracking-[0.35em] uppercase">Hydra</span>
      </motion.a>

      {/* ── MAIN SCROLLABLE CONTENT ── */}
      <div
        className="absolute inset-0 z-10 overflow-y-auto overflow-x-hidden flex items-center justify-center"
        style={{ paddingTop: "64px", paddingBottom: "56px" }}
      >
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 240, damping: 26, delay: 0.05 }}
          className="w-full max-w-[360px] px-4 flex flex-col items-center gap-0"
        >
          {/* ── PROFILE CARD ── */}
          <div
            className="w-full rounded-[28px] overflow-hidden"
            style={{
              background: "rgba(8,10,18,0.72)",
              backdropFilter: "blur(32px) saturate(1.4)",
              border: "1px solid rgba(255,255,255,0.09)",
              boxShadow: `0 0 0 1px rgba(255,255,255,0.04), 0 32px 80px rgba(0,0,0,0.55), 0 0 60px -10px ${accent}22`,
            }}
          >
            {/* ── Avatar section ── */}
            <div className="flex flex-col items-center pt-8 pb-5 px-6 relative">
              {/* Role badges (top-right) */}
              <div className="absolute top-4 right-4 flex gap-1.5">
                {profile.role === "admin" && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold"
                    style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)", backdropFilter: "blur(8px)" }}
                  >
                    <Crown className="w-3 h-3" /> ADMIN
                  </motion.span>
                )}
                {profile.role === "vip" && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold"
                    style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}35`, backdropFilter: "blur(8px)" }}
                  >
                    <Shield className="w-3 h-3" /> VIP
                  </motion.span>
                )}
              </div>

              {/* Avatar */}
              <div className="relative mb-4 group">
                <motion.div
                  className="w-[100px] h-[100px] rounded-full overflow-hidden flex items-center justify-center text-4xl font-bold relative"
                  style={{
                    background: profile.photo ? "transparent" : hashColor(profile.username),
                    boxShadow: `0 0 0 3px ${accent}55, 0 0 0 6px ${accent}18, 0 16px 40px rgba(0,0,0,0.6)`,
                  }}
                  whileHover={{ scale: 1.04 }}
                >
                  {profile.photo
                    ? <img src={profile.photo} alt="" className="w-full h-full object-cover" />
                    : <span style={{ color: "rgba(0,0,0,0.7)" }}>{profile.displayName[0]?.toUpperCase()}</span>
                  }
                  {/* Quick upload overlay for owner */}
                  {isMe && (
                    <div
                      className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      onClick={() => photoRef.current?.click()}
                    >
                      <Camera className="w-6 h-6 text-white mb-1" />
                      <span className="text-[9px] text-white/80 font-semibold tracking-wider">TROCAR</span>
                    </div>
                  )}
                </motion.div>

                {/* Status dot */}
                <div
                  className="absolute bottom-0.5 right-0.5 w-5 h-5 rounded-full border-[3px] flex items-center justify-center"
                  style={{ borderColor: "rgba(8,10,18,0.9)", background: statusColor }}
                >
                  {profile.status === "online" && (
                    <motion.div
                      className="absolute inset-0 rounded-full"
                      style={{ background: statusColor }}
                      animate={{ scale: [1, 1.9, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  )}
                </div>
              </div>

              {/* Hidden file input for quick photo upload */}
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleQuickPhotoUpload}
              />

              {/* Display name */}
              <motion.h1
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                className="text-[28px] font-bold text-white text-center leading-tight tracking-tight"
                style={{ fontFamily: "'Outfit', 'Space Grotesk', sans-serif", letterSpacing: "-0.01em" }}
              >
                {profile.displayName}
              </motion.h1>

              {/* Username */}
              <motion.p
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
                className="text-sm mt-0.5 font-medium"
                style={{ color: `${accent}90`, fontFamily: "'Space Grotesk', sans-serif" }}
              >
                @{profile.username}
              </motion.p>

              {/* Status pill */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.18 }}
                className="flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-full"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.09)" }}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColor }} />
                <span className="text-xs font-semibold" style={{ color: statusColor }}>{STATUS_LABEL[profile.status]}</span>
                {profile.statusMsg && (
                  <>
                    <span className="text-white/20 text-xs">·</span>
                    <span className="text-xs text-white/40 max-w-[160px] truncate">{profile.statusMsg}</span>
                  </>
                )}
              </motion.div>
            </div>

            {/* ── Divider with accent ── */}
            <div className="mx-6 h-px mb-5" style={{ background: `linear-gradient(to right, transparent, ${accent}25, transparent)` }} />

            {/* ── Bio ── */}
            {profile.bio && (
              <motion.div
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                className="mx-6 mb-5"
              >
                <p className="text-sm text-white/65 text-center leading-relaxed">
                  {profile.bio}
                </p>
              </motion.div>
            )}

            {/* ── Meta row (location + join date) ── */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.22 }}
              className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mx-6 mb-5"
            >
              {profile.location && (
                <div className="flex items-center gap-1.5 text-xs text-white/35">
                  <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: `${accent}70` }} />
                  <span>{profile.location}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs text-white/30">
                <Calendar className="w-3.5 h-3.5 shrink-0" style={{ color: `${accent}55` }} />
                <span>Desde {joinDate}</span>
              </div>
            </motion.div>

            {/* ── Social icons ── */}
            {profile.socialLinks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
                className="flex flex-wrap gap-2.5 justify-center mx-6 mb-5"
              >
                {profile.socialLinks.map((link, i) => {
                  const brand = SOCIAL_BRANDS[link.type.toLowerCase()] ?? SOCIAL_BRANDS.website!;
                  return (
                    <motion.a
                      key={i}
                      href={socialUrl(link)}
                      target="_blank" rel="noopener noreferrer"
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.28 + i * 0.05, type: "spring", stiffness: 350, damping: 22 }}
                      whileHover={{ scale: 1.15, y: -3 }}
                      whileTap={{ scale: 0.9 }}
                      title={brand.label}
                      className="w-12 h-12 rounded-2xl flex items-center justify-center transition-shadow"
                      style={{
                        background: brand.bg,
                        color: brand.color,
                        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                      }}
                    >
                      <SocialIconSvg type={link.type} size={22} />
                    </motion.a>
                  );
                })}
              </motion.div>
            )}

            {/* ── Music / Spotify ── */}
            {profile.musicUrl && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                className="mx-4 mb-5"
              >
                {isSpotify
                  ? <SpotifyCard url={profile.musicUrl} />
                  : <MusicCard url={profile.musicUrl} accent={accent} />}
              </motion.div>
            )}

            {/* ── Divider ── */}
            <div className="mx-6 h-px mb-4" style={{ background: "rgba(255,255,255,0.06)" }} />

            {/* ── Action buttons ── */}
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
              className="mx-4 mb-5"
            >
              {isMe ? (
                <div className="flex gap-2">
                  <Link href="/perfil" className="flex-1">
                    <button
                      className="w-full py-3 rounded-2xl text-sm font-bold transition-all hover:brightness-110 active:scale-[0.98]"
                      style={{
                        background: `linear-gradient(135deg, ${accent}cc, ${accent})`,
                        color: "#000",
                        boxShadow: `0 4px 20px ${accent}40`,
                        fontFamily: "'Space Grotesk', sans-serif",
                        letterSpacing: "0.02em",
                      }}
                    >
                      Editar perfil
                    </button>
                  </Link>
                  <button
                    onClick={() => photoRef.current?.click()}
                    className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all hover:bg-white/10 active:scale-[0.95]"
                    style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
                    title="Trocar foto"
                  >
                    <Camera className="w-5 h-5 text-white/60" />
                  </button>
                </div>
              ) : loggedIn ? (
                <div className="flex gap-2">
                  {friendStatus === "none" && (
                    <motion.button
                      onClick={sendFriendRequest} disabled={friendLoading}
                      whileTap={{ scale: 0.97 }}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold transition-all disabled:opacity-50"
                      style={{
                        background: `linear-gradient(135deg, ${accent}cc, ${accent})`,
                        color: "#000",
                        boxShadow: `0 4px 20px ${accent}40`,
                        fontFamily: "'Space Grotesk', sans-serif",
                      }}
                    >
                      {friendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                      Adicionar
                    </motion.button>
                  )}
                  {friendStatus === "sent" && (
                    <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm border border-white/10 text-white/35"
                      style={{ background: "rgba(255,255,255,0.04)" }}>
                      <Check className="w-4 h-4" /> Pedido enviado
                    </div>
                  )}
                  {friendStatus === "received" && (
                    <motion.button
                      onClick={acceptFriendRequest} disabled={friendLoading}
                      whileTap={{ scale: 0.97 }}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold"
                      style={{ background: `linear-gradient(135deg, ${accent}cc, ${accent})`, color: "#000" }}
                    >
                      {friendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                      Aceitar pedido
                    </motion.button>
                  )}
                  {friendStatus === "accepted" && (
                    <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm"
                      style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", color: "#22c55e" }}>
                      <Users className="w-4 h-4" /> Amigos
                    </div>
                  )}
                  <Link href="/comunidade">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all hover:bg-white/10"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}
                    >
                      <MessageCircle className="w-5 h-5" />
                    </motion.button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  <a href="/registro"
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl text-sm font-bold transition-all hover:brightness-110"
                    style={{
                      background: `linear-gradient(135deg, ${accent}cc, ${accent})`,
                      color: "#000",
                      boxShadow: `0 4px 20px ${accent}40`,
                      fontFamily: "'Space Grotesk', sans-serif",
                    }}
                  >
                    <UserPlus className="w-4 h-4" /> Entrar na Hydra
                  </a>
                  <a href="/login"
                    className="flex items-center justify-center w-full py-3 rounded-2xl text-sm font-medium border text-white/40 hover:text-white hover:bg-white/5 transition-all"
                    style={{ borderColor: "rgba(255,255,255,0.09)" }}
                  >
                    Já tenho conta
                  </a>
                </div>
              )}
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
