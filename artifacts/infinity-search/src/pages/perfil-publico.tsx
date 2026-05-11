import { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin, Music, ExternalLink, Eye, Crown, Shield, UserPlus, Check, Loader2,
  Instagram, Twitter, Youtube, Github, Twitch, Globe, MessageCircle, ArrowLeft,
  Users, Calendar, UserCheck,
} from "lucide-react";
import { useInfinityMe } from "@workspace/api-client-react";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("infinity_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  if (t === "tiktok") return <span className="text-sm font-bold">TT</span>;
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

export default function PerfilPublico() {
  const [, params] = useRoute("/u/:username");
  const username = params?.username ?? "";
  const { data: me } = useInfinityMe({});

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [friendStatus, setFriendStatus] = useState<"none" | "sent" | "accepted" | "received">("none");
  const [friendId, setFriendId] = useState<number | null>(null);
  const [friendLoading, setFriendLoading] = useState(false);

  const isMe = me?.username === username.toLowerCase();

  useEffect(() => {
    if (!username) return;
    setLoading(true); setNotFound(false);
    fetch(`/api/infinity/u/${username}`, { headers: authHeaders() })
      .then(r => { if (r.status === 404) { setNotFound(true); return null; } return r.json(); })
      .then((data: PublicProfile | null) => { if (data) setProfile(data); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [username]);

  // Load friendship status
  useEffect(() => {
    if (!me || isMe) return;
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
  }, [me, username, isMe]);

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

  if (loading) return (
    <div className="flex items-center justify-center h-[calc(100vh-3.5rem)] lg:h-screen">
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--color-primary)" }} />
    </div>
  );

  if (notFound || !profile) return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-3.5rem)] lg:h-screen gap-4 text-center px-4">
      <div className="text-5xl">👤</div>
      <h1 className="text-2xl font-bold">Usuário não encontrado</h1>
      <p className="text-muted-foreground text-sm">@{username} não existe na plataforma.</p>
      <Link href="/"><button className="px-4 py-2 rounded-xl text-sm font-medium border border-white/10 hover:bg-white/5 transition-colors">← Voltar</button></Link>
    </div>
  );

  const accent = profile.accentColor ?? "var(--color-primary)";
  const statusColor = STATUS_COLOR[profile.status] ?? "#6b7280";
  const joinDate = new Date(profile.createdAt).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="min-h-[calc(100vh-3.5rem)] lg:min-h-screen flex flex-col items-center justify-center py-8 px-4">
      <div className="w-full max-w-md">
        {/* Back button */}
        <button onClick={() => window.history.back()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar
        </button>

        {/* Profile card — guns.lol style */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative rounded-3xl overflow-hidden border border-white/10"
          style={{ boxShadow: `0 0 80px -20px ${accent}40` }}
        >
          {/* Banner / background */}
          <div className="relative h-32 overflow-hidden">
            {profile.banner ? (
              <img src={profile.banner} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full" style={{
                background: `radial-gradient(ellipse at 30% 50%, ${accent}30 0%, transparent 70%), radial-gradient(ellipse at 80% 20%, ${accent}15 0%, transparent 60%), hsl(220 35% 6%)`,
              }} />
            )}
            <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.7) 100%)" }} />

            {/* Views counter */}
            <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/40 backdrop-blur-sm px-2 py-1 rounded-full">
              <Eye className="w-3 h-3 text-white/60" />
              <span className="text-[10px] text-white/60">{profile.views.toLocaleString("pt-BR")}</span>
            </div>
          </div>

          {/* Card body */}
          <div className="relative px-5 pb-5" style={{ background: "hsl(220 35% 6% / 0.97)", backdropFilter: "blur(20px)" }}>
            {/* Avatar */}
            <div className="relative -mt-10 mb-3">
              <div className="relative inline-block">
                <div className="w-20 h-20 rounded-2xl overflow-hidden border-4"
                  style={{ borderColor: accent + "60", background: profile.photo ? "transparent" : hashColor(profile.username) }}>
                  {profile.photo
                    ? <img src={profile.photo} alt="" className="w-full h-full object-cover" />
                    : <span className="w-full h-full flex items-center justify-center text-3xl font-bold text-black">{profile.displayName[0]?.toUpperCase()}</span>
                  }
                </div>
                {/* Status dot */}
                <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-background flex items-center justify-center"
                  style={{ background: statusColor }}>
                </span>
              </div>
            </div>

            {/* Name + role */}
            <div className="flex items-start justify-between gap-2 mb-1">
              <div>
                <h1 className="text-xl font-bold leading-none">{profile.displayName}</h1>
                <p className="text-xs text-muted-foreground mt-0.5">@{profile.username}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 pt-1">
                {profile.role === "admin" && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b40" }}>
                    <Crown className="w-3 h-3" /> ADMIN
                  </span>
                )}
                {profile.role === "vip" && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: `${accent}20`, color: accent, border: `1px solid ${accent}40` }}>
                    <Shield className="w-3 h-3" /> VIP
                  </span>
                )}
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center gap-1.5 mb-3">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: statusColor }} />
              <span className="text-xs" style={{ color: statusColor }}>{STATUS_LABEL[profile.status]}</span>
              {profile.statusMsg && <span className="text-xs text-muted-foreground/60">— {profile.statusMsg}</span>}
            </div>

            {/* Bio */}
            {profile.bio && (
              <p className="text-sm text-foreground/80 leading-relaxed mb-4 border-l-2 pl-3" style={{ borderColor: accent + "60" }}>
                {profile.bio}
              </p>
            )}

            {/* Meta info */}
            <div className="flex flex-wrap gap-3 mb-4">
              {profile.location && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                  <MapPin className="w-3.5 h-3.5" />
                  {profile.location}
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                <Calendar className="w-3.5 h-3.5" />
                Membro desde {joinDate}
              </div>
            </div>

            {/* Social links */}
            {profile.socialLinks.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {profile.socialLinks.map((link, i) => (
                  <a key={i} href={socialUrl(link)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all hover:scale-105"
                    style={{ borderColor: `${accent}40`, color: accent, background: `${accent}10` }}>
                    <SocialIcon type={link.type} />
                    {link.type}
                  </a>
                ))}
              </div>
            )}

            {/* Music player */}
            {profile.musicUrl && (
              <div className="mb-4 p-3 rounded-xl border border-white/5 bg-white/[0.03] flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${accent}20` }}>
                  <Music className="w-4 h-4" style={{ color: accent }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Músicas</p>
                  <a href={profile.musicUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-medium hover:underline truncate block" style={{ color: accent }}>
                    {profile.musicUrl.replace(/^https?:\/\//, "").split("/")[0]}
                  </a>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
              </div>
            )}

            {/* Action buttons */}
            {!isMe && me && (
              <div className="flex gap-2">
                {friendStatus === "none" && (
                  <button onClick={sendFriendRequest} disabled={friendLoading}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 disabled:opacity-50"
                    style={{ background: accent, color: "#000" }}>
                    {friendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    Adicionar
                  </button>
                )}
                {friendStatus === "sent" && (
                  <div className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border border-white/10 text-muted-foreground">
                    <Check className="w-4 h-4" /> Pedido enviado
                  </div>
                )}
                {friendStatus === "received" && (
                  <button onClick={acceptFriendRequest} disabled={friendLoading}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all"
                    style={{ background: accent, color: "#000" }}>
                    {friendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                    Aceitar pedido
                  </button>
                )}
                {friendStatus === "accepted" && (
                  <div className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border border-green-500/30 text-green-400">
                    <Users className="w-4 h-4" /> Amigos
                  </div>
                )}
                <Link href="/comunidade">
                  <button className="px-4 py-2.5 rounded-xl text-sm font-medium border border-white/10 hover:bg-white/5 transition-colors">
                    <MessageCircle className="w-4 h-4" />
                  </button>
                </Link>
              </div>
            )}

            {isMe && (
              <Link href="/perfil">
                <button className="w-full py-2.5 rounded-xl text-sm font-bold border border-white/10 hover:bg-white/5 transition-colors">
                  Editar perfil
                </button>
              </Link>
            )}
          </div>
        </motion.div>

        {/* Hydra branding */}
        <p className="text-center text-[10px] text-muted-foreground/30 mt-4 uppercase tracking-widest">Hydra Consultoria</p>
      </div>
    </div>
  );
}
