import { useState, useEffect, useRef } from "react";
import { useRoute, Link } from "wouter";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "framer-motion";
import {
  MapPin, Eye, Crown, Shield, UserPlus, Check, Loader2,
  MessageCircle, ArrowLeft, Users, Calendar, UserCheck,
  Copy, CheckCheck, ExternalLink, Music, Globe, Sparkles,
  Instagram, Youtube, Github, Twitch, Camera, Volume2,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────────
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function isLoggedIn(): boolean { return !!localStorage.getItem("infinity_token"); }
function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 65%, 60%)`;
}
function isGifUrl(url: string): boolean {
  return /\.gif($|\?)/i.test(url) || /giphy\.com|tenor\.com|media\.discordapp|cdn\.discordapp/i.test(url);
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
  discord:   { color: "#fff", bg: "linear-gradient(135deg,#5865F2,#404EED)",                                label: "Discord" },
  tiktok:    { color: "#fff", bg: "linear-gradient(135deg,#25F4EE 0%,#000 50%,#FE2C55 100%)",               label: "TikTok" },
  roblox:    { color: "#fff", bg: "linear-gradient(135deg,#e2231a,#a01010)",                                label: "Roblox" },
  instagram: { color: "#fff", bg: "linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)",        label: "Instagram" },
  twitter:   { color: "#fff", bg: "linear-gradient(135deg,#0a0a0a,#1a1a1a)",                                label: "X / Twitter" },
  x:         { color: "#fff", bg: "linear-gradient(135deg,#0a0a0a,#1a1a1a)",                                label: "X" },
  youtube:   { color: "#fff", bg: "linear-gradient(135deg,#FF0000,#cc0000)",                                label: "YouTube" },
  github:    { color: "#fff", bg: "linear-gradient(135deg,#333,#0d1117)",                                   label: "GitHub" },
  twitch:    { color: "#fff", bg: "linear-gradient(135deg,#9146FF,#6441A5)",                                label: "Twitch" },
  spotify:   { color: "#fff", bg: "linear-gradient(135deg,#1DB954,#0e7e36)",                                label: "Spotify" },
  telegram:  { color: "#fff", bg: "linear-gradient(135deg,#229ED9,#1a7eb0)",                                label: "Telegram" },
  whatsapp:  { color: "#fff", bg: "linear-gradient(135deg,#25D366,#128C7E)",                                label: "WhatsApp" },
  website:   { color: "#fff", bg: "linear-gradient(135deg,rgba(255,255,255,0.18),rgba(255,255,255,0.06))",  label: "Website" },
};

function SocialIconSvg({ type, size = 22 }: { type: string; size?: number }) {
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
  if (t === "telegram") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>
    </svg>
  );
  if (t === "whatsapp") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
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
  if (t === "telegram") return v.startsWith("http") ? v : `https://t.me/${v}`;
  if (t === "whatsapp") return `https://wa.me/${v.replace(/\D/g, "")}`;
  if (link.value.startsWith("http")) return link.value;
  return `https://${link.value}`;
}

// ── Spotify embed ──────────────────────────────────────────────────────────────
function SpotifyCard({ url }: { url: string }) {
  const match = url.match(/spotify\.com\/(track|album|playlist|artist)\/([A-Za-z0-9]+)/);
  if (!match) return null;
  const [type, id] = [match[1], match[2]];
  const embedUrl = `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
  return (
    <div className="w-full overflow-hidden rounded-2xl relative group" style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
      <div className="absolute inset-0 pointer-events-none rounded-2xl"
           style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }} />
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
  const host = url.replace(/^https?:\/\//, "").split("/")[0];
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98] group"
      style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 relative overflow-hidden"
           style={{ background: `linear-gradient(135deg, ${accent}40, ${accent}15)` }}>
        <Music className="w-5 h-5 relative z-10" style={{ color: accent }} />
        <motion.div
          className="absolute inset-0"
          animate={{ background: [`radial-gradient(circle at 0% 50%, ${accent}30, transparent 60%)`,
                                  `radial-gradient(circle at 100% 50%, ${accent}30, transparent 60%)`,
                                  `radial-gradient(circle at 0% 50%, ${accent}30, transparent 60%)`] }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-white/40 uppercase tracking-[0.25em] font-semibold flex items-center gap-1.5">
          <Volume2 className="w-2.5 h-2.5" /> Música
        </p>
        <p className="text-sm font-semibold truncate text-white/90">{host}</p>
      </div>
      <ExternalLink className="w-4 h-4 text-white/30 shrink-0 group-hover:text-white/60 transition-colors" />
    </a>
  );
}

// ── Animated rotating ring around avatar ───────────────────────────────────────
function AvatarHaloRing({ accent }: { accent: string }) {
  return (
    <motion.div
      className="absolute -inset-3 rounded-full pointer-events-none"
      style={{
        background: `conic-gradient(from 0deg, transparent 0deg, ${accent} 60deg, transparent 120deg, ${accent}80 200deg, transparent 280deg, ${accent} 340deg, transparent 360deg)`,
        filter: "blur(8px)",
        opacity: 0.55,
      }}
      animate={{ rotate: 360 }}
      transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
    />
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
  const [entered, setEntered] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  // ── Mouse-follow glow ──
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const sx = useSpring(mx, { stiffness: 60, damping: 14 });
  const sy = useSpring(my, { stiffness: 60, damping: 14 });
  const glowX = useTransform(sx, v => `${v * 100}%`);
  const glowY = useTransform(sy, v => `${v * 100}%`);

  // ── 3D tilt for the card ──
  const cardRef = useRef<HTMLDivElement>(null);
  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const stiltX = useSpring(tiltX, { stiffness: 220, damping: 22 });
  const stiltY = useSpring(tiltY, { stiffness: 220, damping: 22 });

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
    setLoading(true); setNotFound(false); setEntered(false);
    fetch(`/api/infinity/u/${username}`)
      .then(r => { if (r.status === 404) { setNotFound(true); return null; } return r.json(); })
      .then((data: PublicProfile | null) => { if (data) setProfile(data); })
      .catch(() => setNotFound(true))
      .finally(() => { setLoading(false); setTimeout(() => setEntered(true), 80); });
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

  const handleQuickPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { alert("Imagem muito grande (máx 5MB)"); return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      localStorage.setItem("infinity_profile_photo", dataUrl);
      window.dispatchEvent(new Event("infinity-profile-updated"));
      await fetch("/api/infinity/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ profilePhoto: dataUrl }),
      }).catch(() => {});
      if (profile) setProfile({ ...profile, photo: dataUrl });
    };
    reader.readAsDataURL(f);
  };

  // Cursor tracking on the whole page
  const handleMouseMove = (e: React.MouseEvent) => {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    mx.set(e.clientX / w);
    my.set(e.clientY / h);
  };

  // 3D tilt on card
  const handleCardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    tiltY.set(px * 8);
    tiltX.set(-py * 8);
  };
  const handleCardLeave = () => { tiltX.set(0); tiltY.set(0); };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#06070d]">
      <div className="flex flex-col items-center gap-5">
        <div className="relative w-14 h-14">
          <motion.div className="absolute inset-0 rounded-full border border-cyan-400/20"
            animate={{ scale: [1, 1.9, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 1.8, repeat: Infinity }} />
          <motion.div className="absolute inset-0 rounded-full border-t-2 border-cyan-400"
            animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />
        </div>
        <p className="text-[10px] text-white/30 uppercase tracking-[0.55em]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Carregando perfil</p>
      </div>
    </div>
  );

  if (notFound || !profile) return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 text-center px-6 bg-[#06070d]">
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
  const initial = (profile.displayName || profile.username || "?").charAt(0).toUpperCase();

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ fontFamily: "'Space Grotesk', 'Plus Jakarta Sans', sans-serif" }}
      onMouseMove={handleMouseMove}
    >
      {/* ═══ FULL-SCREEN BACKGROUND ═══ */}
      <div className="absolute inset-0 z-0">
        {/* Base layer: deep night */}
        <div
          className="absolute inset-0"
          style={{
            background: hasBgColor
              ? profile.bgValue!
              : `radial-gradient(ellipse 120% 80% at 20% 0%, ${accent}1a 0%, transparent 55%), radial-gradient(ellipse 100% 70% at 85% 100%, ${accent}14 0%, transparent 50%), linear-gradient(160deg, #050710 0%, #0a0f1f 50%, #060912 100%)`,
          }}
        />

        {bgSource && (
          <>
            <img
              src={bgSource}
              alt=""
              className="absolute inset-0 w-full h-full"
              style={{
                objectFit: "cover",
                filter: bgIsGif
                  ? "blur(24px) saturate(1.35) brightness(0.36)"
                  : "blur(30px) saturate(1.25) brightness(0.32)",
                transform: "scale(1.12)",
              }}
            />
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.50) 0%, rgba(0,0,0,0.28) 35%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.78) 100%)" }}
            />
          </>
        )}

        {/* Animated floating orbs — ALWAYS rendered so the glass card has something to blur over */}
        <>
            <motion.div
              className="absolute pointer-events-none rounded-full"
              style={{
                width: 700, height: 700, top: "-18%", left: "-12%",
                background: `radial-gradient(circle, ${accent} 0%, ${accent}55 30%, ${accent}15 55%, transparent 75%)`,
                filter: "blur(40px)",
                opacity: 0.9,
              }}
              animate={{ x: [0, 80, -40, 0], y: [0, 60, 100, 0], scale: [1, 1.15, 0.92, 1] }}
              transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute pointer-events-none rounded-full"
              style={{
                width: 620, height: 620, bottom: "-14%", right: "-10%",
                background: `radial-gradient(circle, #7c3aed 0%, #6366f199 30%, #6366f130 55%, transparent 75%)`,
                filter: "blur(45px)",
                opacity: 0.85,
              }}
              animate={{ x: [0, -70, 50, 0], y: [0, -50, -30, 0], scale: [1, 0.9, 1.12, 1] }}
              transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute pointer-events-none rounded-full"
              style={{
                width: 500, height: 500, top: "25%", right: "5%",
                background: `radial-gradient(circle, ${accent}cc 0%, ${accent}40 40%, transparent 75%)`,
                filter: "blur(50px)",
              }}
              animate={{ x: [0, 40, -50, 0], y: [0, -40, 50, 0], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute pointer-events-none rounded-full"
              style={{
                width: 440, height: 440, bottom: "15%", left: "5%",
                background: `radial-gradient(circle, #ec4899bb 0%, #ec489930 45%, transparent 75%)`,
                filter: "blur(50px)",
              }}
              animate={{ x: [0, 50, -30, 0], y: [0, 40, -40, 0], opacity: [0.6, 0.95, 0.6] }}
              transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute pointer-events-none rounded-full"
              style={{
                width: 360, height: 360, top: "10%", left: "40%",
                background: `radial-gradient(circle, #22d3eebb 0%, #22d3ee30 45%, transparent 75%)`,
                filter: "blur(45px)",
              }}
              animate={{ x: [0, -30, 40, 0], y: [0, 50, 20, 0], opacity: [0.5, 0.85, 0.5] }}
              transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Animated mesh grid lines */}
            <div
              className="absolute inset-0 pointer-events-none opacity-[0.10]"
              style={{
                backgroundImage: `linear-gradient(${accent}dd 1px, transparent 1px), linear-gradient(90deg, ${accent}dd 1px, transparent 1px)`,
                backgroundSize: "64px 64px",
                maskImage: "radial-gradient(ellipse 90% 80% at 50% 50%, black 30%, transparent 80%)",
                WebkitMaskImage: "radial-gradient(ellipse 90% 80% at 50% 50%, black 30%, transparent 80%)",
              }}
            />
          </>

        {/* Cursor-follow ambient glow */}
        <motion.div
          className="absolute pointer-events-none"
          style={{
            left: glowX, top: glowY,
            translateX: "-50%", translateY: "-50%",
            width: 720, height: 720,
            background: `radial-gradient(circle at center, ${accent}26 0%, ${accent}0c 30%, transparent 60%)`,
            filter: "blur(20px)",
          }}
        />

        {/* Top accent halo */}
        <motion.div
          className="absolute inset-x-0 top-0 h-[55vh] pointer-events-none"
          style={{ background: `radial-gradient(ellipse 70% 100% at 50% 0%, ${accent}1f 0%, transparent 70%)` }}
          animate={{ opacity: [0.55, 1, 0.55] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Bottom subtle accent */}
        <div
          className="absolute inset-x-0 bottom-0 h-[35vh] pointer-events-none"
          style={{ background: `radial-gradient(ellipse 60% 100% at 50% 100%, ${accent}10 0%, transparent 70%)` }}
        />

        {/* Subtle grain */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04] mix-blend-overlay"
          style={{
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
            backgroundRepeat: "repeat",
            backgroundSize: "128px",
          }}
        />

        {/* Vignette */}
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: "radial-gradient(ellipse 100% 80% at 50% 50%, transparent 60%, rgba(0,0,0,0.55) 100%)" }} />
      </div>

      {/* ═══ FLOATING NAV (top corners) ═══ */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-4 pt-4 pointer-events-none">
        <motion.button
          initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
          onClick={() => window.history.length > 1 ? window.history.back() : (window.location.href = "/")}
          className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-white/55 hover:text-white transition-colors"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.08)" }}
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
            background: copied ? `${accent}22` : "rgba(0,0,0,0.45)",
            backdropFilter: "blur(14px)",
            border: `1px solid ${copied ? `${accent}55` : "rgba(255,255,255,0.08)"}`,
            color: copied ? accent : "rgba(255,255,255,0.55)",
          }}
        >
          {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="tracking-wide">{copied ? "Copiado!" : "Compartilhar"}</span>
        </motion.button>
      </div>

      {/* ═══ VIEWS / BRAND (bottom floating) ═══ */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        className="absolute bottom-4 left-4 z-50 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl pointer-events-none"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <Eye className="w-3 h-3 text-white/35" />
        <span className="text-[11px] text-white/45 tabular-nums font-medium">{profile.views.toLocaleString("pt-BR")}</span>
      </motion.div>

      <motion.a
        href="/"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
        className="absolute bottom-4 right-4 z-50 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <Sparkles className="w-3 h-3" style={{ color: accent }} />
        <span className="text-[10px] text-white/40 tracking-[0.4em] uppercase font-bold">Hydra</span>
      </motion.a>

      {/* ═══ MAIN SCROLLABLE CONTENT ═══ */}
      <div
        className="absolute inset-0 z-10 overflow-y-auto overflow-x-hidden flex items-center justify-center"
        style={{ paddingTop: "72px", paddingBottom: "60px" }}
      >
        <motion.div
          ref={cardRef}
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={entered ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 30, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 220, damping: 24 }}
          className="w-full max-w-[400px] px-4 flex flex-col items-center"
          onMouseMove={handleCardMouseMove}
          onMouseLeave={handleCardLeave}
          style={{
            perspective: 1200,
          }}
        >
          {/* ═══ THE CARD ═══ */}
          <motion.div
            className="w-full rounded-[28px] overflow-hidden relative"
            style={{
              background: "linear-gradient(135deg, rgba(14,18,32,0.55) 0%, rgba(8,10,18,0.45) 100%)",
              backdropFilter: "blur(40px) saturate(1.7)",
              WebkitBackdropFilter: "blur(40px) saturate(1.7)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: `0 0 0 1px rgba(255,255,255,0.06) inset, 0 1px 0 rgba(255,255,255,0.08) inset, 0 36px 90px rgba(0,0,0,0.65), 0 0 80px -10px ${accent}3a`,
              rotateX: stiltX,
              rotateY: stiltY,
              transformStyle: "preserve-3d",
            }}
          >
            {/* Inner shimmer line on top */}
            <div className="absolute top-0 inset-x-8 h-px"
                 style={{ background: `linear-gradient(to right, transparent, ${accent}80, transparent)`, opacity: 0.6 }} />

            {/* ── Avatar section ── */}
            <div className="flex flex-col items-center pt-9 pb-5 px-6 relative">
              {/* Role badges (top-right) */}
              <div className="absolute top-4 right-4 flex gap-1.5 z-10">
                {profile.role === "admin" && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.6, x: 6 }} animate={{ opacity: 1, scale: 1, x: 0 }}
                    transition={{ delay: 0.3, type: "spring", stiffness: 320, damping: 18 }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wider relative overflow-hidden"
                    style={{
                      background: "linear-gradient(135deg, rgba(245,158,11,0.22), rgba(245,158,11,0.12))",
                      color: "#f59e0b",
                      border: "1px solid rgba(245,158,11,0.4)",
                      boxShadow: "0 0 18px rgba(245,158,11,0.25)",
                    }}
                  >
                    <Crown className="w-3 h-3" /> ADMIN
                    <motion.div
                      className="absolute inset-0 pointer-events-none"
                      animate={{ x: ["-100%", "200%"] }}
                      transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 3, ease: "easeInOut" }}
                      style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)" }}
                    />
                  </motion.span>
                )}
                {profile.role === "vip" && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.3, type: "spring" }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wider relative overflow-hidden"
                    style={{
                      background: `linear-gradient(135deg, ${accent}25, ${accent}10)`,
                      color: accent,
                      border: `1px solid ${accent}55`,
                      boxShadow: `0 0 18px ${accent}30`,
                    }}
                  >
                    <Shield className="w-3 h-3" /> VIP
                  </motion.span>
                )}
              </div>

              {/* Avatar */}
              <div className="relative mb-4 group">
                <AvatarHaloRing accent={accent} />
                <motion.div
                  className="w-[112px] h-[112px] rounded-full overflow-hidden flex items-center justify-center text-[44px] font-extrabold relative z-10"
                  style={{
                    background: profile.photo ? "transparent" : hashColor(profile.username),
                    boxShadow: `0 0 0 4px rgba(8,10,18,0.9), 0 0 0 5px ${accent}, 0 0 0 8px ${accent}22, 0 18px 50px rgba(0,0,0,0.7)`,
                  }}
                  whileHover={{ scale: 1.05 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                  {profile.photo
                    ? <img src={profile.photo} alt={profile.displayName} className="w-full h-full object-cover" />
                    : <span style={{ color: "rgba(0,0,0,0.78)", fontFamily: "'Outfit', sans-serif" }}>{initial}</span>
                  }
                  {/* Owner camera overlay */}
                  {isMe && (
                    <div
                      className="absolute inset-0 bg-black/65 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      onClick={() => photoRef.current?.click()}
                    >
                      <Camera className="w-7 h-7 text-white mb-1" />
                      <span className="text-[9px] text-white/85 font-bold tracking-[0.25em]">TROCAR</span>
                    </div>
                  )}
                </motion.div>

                {/* Status dot with breathing pulse */}
                <div
                  className="absolute bottom-1 right-1 w-[22px] h-[22px] rounded-full border-[3.5px] z-20 flex items-center justify-center"
                  style={{ borderColor: "rgba(8,10,18,0.95)", background: statusColor }}
                >
                  {profile.status === "online" && (
                    <motion.div
                      className="absolute inset-0 rounded-full"
                      style={{ background: statusColor }}
                      animate={{ scale: [1, 2, 1], opacity: [0.55, 0, 0.55] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  )}
                </div>
              </div>

              <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handleQuickPhotoUpload} />

              {/* Display name (gradient) */}
              <motion.h1
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
                className="text-[30px] font-extrabold text-center leading-tight tracking-tight"
                style={{
                  fontFamily: "'Outfit', 'Space Grotesk', sans-serif",
                  letterSpacing: "-0.015em",
                  background: `linear-gradient(180deg, #fff 0%, #fff 55%, ${accent}cc 130%)`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  textShadow: `0 0 28px ${accent}30`,
                }}
              >
                {profile.displayName}
              </motion.h1>

              {/* Username */}
              <motion.p
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }}
                className="text-sm mt-1 font-semibold tabular-nums"
                style={{ color: `${accent}b0`, fontFamily: "'Space Grotesk', sans-serif" }}
              >
                @{profile.username}
              </motion.p>

              {/* Status pill */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.22 }}
                className="flex items-center gap-1.5 mt-2.5 px-3 py-1.5 rounded-full"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <span className="relative w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColor }}>
                  {profile.status === "online" && (
                    <motion.span className="absolute inset-0 rounded-full" style={{ background: statusColor }}
                                 animate={{ scale: [1, 2.4, 1], opacity: [0.6, 0, 0.6] }}
                                 transition={{ duration: 2, repeat: Infinity }} />
                  )}
                </span>
                <span className="text-[11px] font-semibold tracking-wider" style={{ color: statusColor }}>{STATUS_LABEL[profile.status]}</span>
                {profile.statusMsg && (
                  <>
                    <span className="text-white/20 text-xs">·</span>
                    <span className="text-[11px] text-white/45 max-w-[170px] truncate">{profile.statusMsg}</span>
                  </>
                )}
              </motion.div>
            </div>

            {/* ── Divider ── */}
            <div className="mx-6 h-px mb-5" style={{ background: `linear-gradient(to right, transparent, ${accent}30, transparent)` }} />

            {/* ── Bio ── */}
            {profile.bio && (
              <motion.div
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}
                className="mx-6 mb-5"
              >
                <p className="text-[13.5px] text-white/72 text-center leading-relaxed whitespace-pre-wrap">
                  {profile.bio}
                </p>
              </motion.div>
            )}

            {/* ── Meta row (location + join date) ── */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.28 }}
              className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mx-6 mb-5"
            >
              {profile.location && (
                <div className="flex items-center gap-1.5 text-[12px] text-white/45">
                  <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: `${accent}90` }} />
                  <span>{profile.location}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[12px] text-white/35">
                <Calendar className="w-3.5 h-3.5 shrink-0" style={{ color: `${accent}65` }} />
                <span>Desde {joinDate}</span>
              </div>
            </motion.div>

            {/* ── Social icons ── */}
            {profile.socialLinks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32 }}
                className="flex flex-wrap gap-2.5 justify-center mx-6 mb-5"
              >
                {profile.socialLinks.map((link, i) => {
                  const brand = SOCIAL_BRANDS[link.type.toLowerCase()] ?? SOCIAL_BRANDS.website!;
                  return (
                    <motion.a
                      key={`${link.type}-${i}`}
                      href={socialUrl(link)}
                      target="_blank" rel="noopener noreferrer"
                      initial={{ opacity: 0, scale: 0.5, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ delay: 0.36 + i * 0.06, type: "spring", stiffness: 360, damping: 22 }}
                      whileHover={{ scale: 1.18, y: -4 }}
                      whileTap={{ scale: 0.9 }}
                      title={brand.label}
                      className="w-[46px] h-[46px] rounded-2xl flex items-center justify-center transition-shadow relative overflow-hidden group"
                      style={{
                        background: brand.bg,
                        color: brand.color,
                        boxShadow: "0 6px 18px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.18)",
                      }}
                    >
                      <SocialIconSvg type={link.type} size={20} />
                      <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.18), transparent)" }} />
                    </motion.a>
                  );
                })}
              </motion.div>
            )}

            {/* ── Music ── */}
            {profile.musicUrl && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
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
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.44 }}
              className="mx-4 mb-6"
            >
              {isMe ? (
                <div className="flex gap-2">
                  <Link href="/perfil" className="flex-1">
                    <button
                      className="w-full py-3.5 rounded-2xl text-sm font-extrabold transition-all hover:brightness-110 active:scale-[0.98] relative overflow-hidden"
                      style={{
                        background: `linear-gradient(135deg, ${accent}, ${accent}dd)`,
                        color: "#000",
                        boxShadow: `0 6px 24px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.35)`,
                        fontFamily: "'Space Grotesk', sans-serif",
                        letterSpacing: "0.02em",
                      }}
                    >
                      Editar perfil
                    </button>
                  </Link>
                  <button
                    onClick={() => photoRef.current?.click()}
                    className="w-[52px] h-[52px] rounded-2xl flex items-center justify-center transition-all hover:bg-white/10 active:scale-[0.95] shrink-0"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    title="Trocar foto"
                  >
                    <Camera className="w-5 h-5 text-white/65" />
                  </button>
                </div>
              ) : loggedIn ? (
                <div className="flex gap-2">
                  {friendStatus === "none" && (
                    <motion.button
                      onClick={sendFriendRequest} disabled={friendLoading}
                      whileTap={{ scale: 0.97 }}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-extrabold transition-all disabled:opacity-50"
                      style={{
                        background: `linear-gradient(135deg, ${accent}, ${accent}dd)`,
                        color: "#000",
                        boxShadow: `0 6px 24px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.35)`,
                        fontFamily: "'Space Grotesk', sans-serif",
                      }}
                    >
                      {friendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                      Adicionar
                    </motion.button>
                  )}
                  {friendStatus === "sent" && (
                    <div className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm border border-white/10 text-white/40"
                      style={{ background: "rgba(255,255,255,0.04)" }}>
                      <Check className="w-4 h-4" /> Pedido enviado
                    </div>
                  )}
                  {friendStatus === "received" && (
                    <motion.button
                      onClick={acceptFriendRequest} disabled={friendLoading}
                      whileTap={{ scale: 0.97 }}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-extrabold"
                      style={{ background: `linear-gradient(135deg, ${accent}, ${accent}dd)`, color: "#000",
                               boxShadow: `0 6px 24px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.35)` }}
                    >
                      {friendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                      Aceitar pedido
                    </motion.button>
                  )}
                  {friendStatus === "accepted" && (
                    <Link href={`/dm/${profile.username}`} className="flex-1">
                      <div className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold cursor-pointer hover:brightness-110 transition-all"
                        style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e" }}>
                        <Users className="w-4 h-4" /> Amigos · Conversar
                      </div>
                    </Link>
                  )}
                  {friendStatus !== "accepted" && (
                    <Link href="/comunidade">
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        className="w-[52px] h-[52px] rounded-2xl flex items-center justify-center transition-all hover:bg-white/10 shrink-0"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.55)" }}
                      >
                        <MessageCircle className="w-5 h-5" />
                      </motion.button>
                    </Link>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <a href="/registro"
                    className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl text-sm font-extrabold transition-all hover:brightness-110"
                    style={{
                      background: `linear-gradient(135deg, ${accent}, ${accent}dd)`,
                      color: "#000",
                      boxShadow: `0 6px 24px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.35)`,
                      fontFamily: "'Space Grotesk', sans-serif",
                    }}
                  >
                    <UserPlus className="w-4 h-4" /> Entrar na Hydra
                  </a>
                  <a href="/login"
                    className="flex items-center justify-center w-full py-3 rounded-2xl text-sm font-medium border text-white/45 hover:text-white hover:bg-white/5 transition-all"
                    style={{ borderColor: "rgba(255,255,255,0.09)" }}
                  >
                    Já tenho conta
                  </a>
                </div>
              )}
            </motion.div>

            {/* Bottom shimmer */}
            <div className="absolute bottom-0 inset-x-8 h-px"
                 style={{ background: `linear-gradient(to right, transparent, ${accent}50, transparent)`, opacity: 0.4 }} />
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
