import { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin, Music, ExternalLink, Eye, Crown, Shield, UserPlus, Check, Loader2,
  Instagram, Twitter, Youtube, Github, Twitch, Globe, MessageCircle, ArrowLeft,
  Users, Calendar, UserCheck, Copy, CheckCheck, Share2,
} from "lucide-react";

// Fetch with optional auth
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isLoggedIn(): boolean {
  return !!localStorage.getItem("infinity_token");
}

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
  views: number; createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  online: "#22c55e", busy: "#ef4444", away: "#f59e0b", offline: "#6b7280",
};
const STATUS_LABEL: Record<string, string> = {
  online: "Online", busy: "Ocupado", away: "Ausente", offline: "Offline",
};

function SocialIcon({ type }: { type: string }) {
  const t = type.toLowerCase();
  if (t === "instagram") return <Instagram className="w-4 h-4" />;
  if (t === "twitter" || t === "x") return <Twitter className="w-4 h-4" />;
  if (t === "youtube") return <Youtube className="w-4 h-4" />;
  if (t === "github") return <Github className="w-4 h-4" />;
  if (t === "twitch") return <Twitch className="w-4 h-4" />;
  if (t === "discord") return <MessageCircle className="w-4 h-4" />;
  if (t === "tiktok") return <span className="text-xs font-bold">TT</span>;
  if (t === "roblox") return <span className="text-xs font-bold">RB</span>;
  return <Globe className="w-4 h-4" />;
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
  if (link.value.startsWith("http")) return link.value;
  return `https://${link.value}`;
}

function SpotifyEmbed({ url }: { url: string }) {
  // Try to extract a Spotify embed URL
  const match = url.match(/spotify\.com\/(track|album|playlist|artist)\/([A-Za-z0-9]+)/);
  if (!match) return null;
  const embedUrl = `https://open.spotify.com/embed/${match[1]}/${match[2]}?utm_source=generator&theme=0`;
  return (
    <iframe
      src={embedUrl}
      width="100%"
      height="80"
      frameBorder="0"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
      className="rounded-xl"
    />
  );
}

export default function PerfilPublico() {
  const [, params] = useRoute("/u/:username");
  const username = params?.username ?? "";
  const loggedIn = isLoggedIn();
  const meUsername = loggedIn ? (() => {
    try {
      const payload = localStorage.getItem("infinity_token")?.split(".")?.[1];
      return payload ? JSON.parse(atob(payload))?.username : null;
    } catch { return null; }
  })() : null;

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [friendStatus, setFriendStatus] = useState<"none" | "sent" | "accepted" | "received">("none");
  const [friendId, setFriendId] = useState<number | null>(null);
  const [friendLoading, setFriendLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Get own username from /me if logged in
  const [myUsername, setMyUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    fetch("/api/infinity/me", { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then((d: { username?: string } | null) => { if (d?.username) setMyUsername(d.username); })
      .catch(() => {});
  }, [loggedIn]);

  const isMe = myUsername ? myUsername === username.toLowerCase() : false;

  // Load profile (no auth needed)
  useEffect(() => {
    if (!username) return;
    setLoading(true); setNotFound(false);
    fetch(`/api/infinity/u/${username}`)
      .then(r => { if (r.status === 404) { setNotFound(true); return null; } return r.json(); })
      .then((data: PublicProfile | null) => { if (data) setProfile(data); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [username]);

  // Load friendship status (only if logged in)
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
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback
      const el = document.createElement("textarea");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  // ── States ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(220 35% 4%)" }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        <p className="text-xs text-white/40 uppercase tracking-widest">Carregando perfil...</p>
      </div>
    </div>
  );

  if (notFound || !profile) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 text-center px-4" style={{ background: "hsl(220 35% 4%)" }}>
      <div className="text-6xl">👤</div>
      <h1 className="text-2xl font-bold text-white">Usuário não encontrado</h1>
      <p className="text-white/40 text-sm">@{username} não existe na plataforma.</p>
      <a href="/" className="px-5 py-2.5 rounded-xl text-sm font-medium border border-white/10 hover:bg-white/5 transition-colors text-white/70">
        ← Ir para Hydra Consultoria
      </a>
    </div>
  );

  const accent = profile.accentColor ?? "#00d9ff";
  const statusColor = STATUS_COLOR[profile.status] ?? "#6b7280";
  const joinDate = new Date(profile.createdAt).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const isSpotify = profile.musicUrl?.includes("spotify.com");

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center py-10 px-4 relative overflow-hidden"
      style={{ background: "hsl(220 35% 4%)" }}
    >
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full opacity-[0.06] blur-[120px]"
          style={{ background: accent }} />
      </div>

      <div className="w-full max-w-sm relative z-10">
        {/* Back / nav links */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => window.history.length > 1 ? window.history.back() : (window.location.href = "/")}
            className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/70 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
          <div className="flex items-center gap-2">
            {/* Copy link button */}
            <motion.button
              onClick={copyLink}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium border transition-all"
              style={{
                borderColor: copied ? `${accent}60` : "rgba(255,255,255,0.1)",
                color: copied ? accent : "rgba(255,255,255,0.4)",
                background: copied ? `${accent}10` : "transparent",
              }}
            >
              {copied ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copiado!" : "Copiar link"}
            </motion.button>
          </div>
        </div>

        {/* Profile card */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="relative rounded-3xl overflow-hidden border border-white/[0.07]"
          style={{ boxShadow: `0 0 100px -30px ${accent}35, 0 0 0 1px rgba(255,255,255,0.04)` }}
        >
          {/* Banner */}
          <div className="relative h-36 overflow-hidden">
            {profile.banner ? (
              <img src={profile.banner} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full" style={{
                background: `radial-gradient(ellipse at 25% 60%, ${accent}25 0%, transparent 65%),
                             radial-gradient(ellipse at 80% 20%, ${accent}12 0%, transparent 55%),
                             linear-gradient(135deg, hsl(220 40% 8%) 0%, hsl(220 35% 5%) 100%)`,
              }} />
            )}
            {/* gradient fade at bottom */}
            <div className="absolute inset-0" style={{
              background: "linear-gradient(to bottom, transparent 30%, hsl(220 35% 4%) 100%)"
            }} />

            {/* Views counter - top right */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/10">
              <Eye className="w-3 h-3 text-white/50" />
              <span className="text-[10px] text-white/50 font-medium">{profile.views.toLocaleString("pt-BR")}</span>
            </div>
          </div>

          {/* Card body */}
          <div
            className="relative px-5 pb-6"
            style={{ background: "hsl(220 35% 5% / 0.98)", backdropFilter: "blur(20px)" }}
          >
            {/* Avatar — overlaps banner */}
            <div className="relative -mt-12 mb-4 flex items-end justify-between">
              <div className="relative">
                <div
                  className="w-20 h-20 rounded-2xl overflow-hidden border-[3px] flex items-center justify-center font-bold text-3xl"
                  style={{
                    borderColor: `${accent}50`,
                    background: profile.photo ? "transparent" : hashColor(profile.username),
                    boxShadow: `0 0 0 1px ${accent}20, 0 8px 32px rgba(0,0,0,0.5)`,
                  }}
                >
                  {profile.photo
                    ? <img src={profile.photo} alt="" className="w-full h-full object-cover" />
                    : <span style={{ color: "#000" }}>{profile.displayName[0]?.toUpperCase()}</span>
                  }
                </div>
                {/* Status indicator */}
                <div
                  className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 flex items-center justify-center"
                  style={{ borderColor: "hsl(220 35% 5%)", background: statusColor }}
                  title={STATUS_LABEL[profile.status]}
                />
              </div>

              {/* Role badges */}
              <div className="flex gap-1.5 pb-1">
                {profile.role === "admin" && (
                  <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                    style={{ background: "#f59e0b18", color: "#f59e0b", border: "1px solid #f59e0b35" }}>
                    <Crown className="w-3 h-3" /> ADMIN
                  </span>
                )}
                {profile.role === "vip" && (
                  <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                    style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}35` }}>
                    <Shield className="w-3 h-3" /> VIP
                  </span>
                )}
              </div>
            </div>

            {/* Name */}
            <div className="mb-1">
              <h1 className="text-xl font-bold text-white leading-tight">{profile.displayName}</h1>
              <p className="text-xs text-white/35 mt-0.5 font-mono">@{profile.username}</p>
            </div>

            {/* Status */}
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: statusColor }} />
              <span className="text-xs font-medium" style={{ color: statusColor }}>
                {STATUS_LABEL[profile.status]}
              </span>
              {profile.statusMsg && (
                <span className="text-xs text-white/35">— {profile.statusMsg}</span>
              )}
            </div>

            {/* Bio */}
            {profile.bio && (
              <div className="mb-4 px-3 py-2.5 rounded-xl text-sm text-white/75 leading-relaxed border-l-[2px]"
                style={{ borderColor: `${accent}60`, background: `${accent}06` }}>
                {profile.bio}
              </div>
            )}

            {/* Meta row */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4 text-xs text-white/35">
              {profile.location && (
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3 h-3" />
                  {profile.location}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3 h-3" />
                Membro desde {joinDate}
              </div>
            </div>

            {/* Spotify embed (if spotify URL) */}
            {profile.musicUrl && isSpotify && (
              <div className="mb-4">
                <SpotifyEmbed url={profile.musicUrl} />
              </div>
            )}

            {/* Music link (non-Spotify) */}
            {profile.musicUrl && !isSpotify && (
              <a href={profile.musicUrl} target="_blank" rel="noopener noreferrer"
                className="mb-4 flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all hover:scale-[1.02] group"
                style={{ borderColor: `${accent}25`, background: `${accent}08` }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `${accent}20` }}>
                  <Music className="w-4 h-4" style={{ color: accent }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-white/30 uppercase tracking-widest mb-0.5">Músicas</p>
                  <p className="text-xs font-medium truncate" style={{ color: accent }}>
                    {profile.musicUrl.replace(/^https?:\/\//, "").split("/")[0]}
                  </p>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
              </a>
            )}

            {/* Social links grid */}
            {profile.socialLinks.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {profile.socialLinks.map((link, i) => (
                  <a key={i} href={socialUrl(link)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all hover:scale-105"
                    style={{ borderColor: `${accent}30`, color: accent, background: `${accent}10` }}>
                    <SocialIcon type={link.type} />
                    <span className="capitalize">{link.type}</span>
                  </a>
                ))}
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-white/[0.05] mb-4" />

            {/* Action buttons */}
            {!isMe && loggedIn && (
              <div className="flex gap-2">
                {friendStatus === "none" && (
                  <button onClick={sendFriendRequest} disabled={friendLoading}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 disabled:opacity-50 active:scale-95"
                    style={{ background: accent, color: "#000" }}>
                    {friendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    Adicionar
                  </button>
                )}
                {friendStatus === "sent" && (
                  <div className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm border border-white/10 text-white/40">
                    <Check className="w-4 h-4" /> Pedido enviado
                  </div>
                )}
                {friendStatus === "received" && (
                  <button onClick={acceptFriendRequest} disabled={friendLoading}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
                    style={{ background: accent, color: "#000" }}>
                    {friendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                    Aceitar pedido
                  </button>
                )}
                {friendStatus === "accepted" && (
                  <div className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm border border-green-500/25 text-green-400">
                    <Users className="w-4 h-4" /> Amigos
                  </div>
                )}
                <Link href="/comunidade">
                  <button className="px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 transition-colors text-white/60 hover:text-white">
                    <MessageCircle className="w-4 h-4" />
                  </button>
                </Link>
              </div>
            )}

            {/* Not logged in — CTA */}
            {!loggedIn && (
              <div className="space-y-2">
                <a href="/registro"
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 active:scale-95"
                  style={{ background: accent, color: "#000" }}>
                  <UserPlus className="w-4 h-4" />
                  Criar conta na Hydra
                </a>
                <a href="/login"
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium border border-white/10 text-white/50 hover:text-white hover:bg-white/5 transition-all">
                  Já tenho conta — Entrar
                </a>
              </div>
            )}

            {/* Edit own profile */}
            {isMe && (
              <Link href="/perfil">
                <button className="w-full py-2.5 rounded-xl text-sm font-bold border border-white/10 hover:bg-white/5 text-white/60 hover:text-white transition-all">
                  Editar meu perfil
                </button>
              </Link>
            )}
          </div>
        </motion.div>

        {/* Hydra branding */}
        <div className="flex items-center justify-center gap-2 mt-6">
          <div className="w-4 h-4 opacity-40">
            <svg viewBox="0 0 24 24" fill="currentColor" className="text-cyan-400">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
            </svg>
          </div>
          <a href="/" className="text-[10px] text-white/20 hover:text-white/50 transition-colors uppercase tracking-[0.35em]">
            Hydra Consultoria
          </a>
        </div>
      </div>
    </div>
  );
}
