import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, ExternalLink, Bell, Sparkles, Image as ImageIcon, RefreshCw, Smartphone, Apple, ChevronDown } from "lucide-react";


interface InfinityNotif {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  createdAt: string;
  authorName: string;
}

const SUPORTE_SEEN_KEY = "infinity_suporte_seen_latest";
function getSuporteSeen(): string {
  return localStorage.getItem(SUPORTE_SEEN_KEY) ?? "";
}
function markSuporteSeen(latestId: string) {
  localStorage.setItem(SUPORTE_SEEN_KEY, latestId);
}

const LINKS = [
  {
    label: "Canal de Atualizações",
    desc: "Novidades oficiais da plataforma",
    url: "https://t.me/hydraconsultoria",
    icon: "📢",
    color: "--color-chart-4",
  },
  {
    label: "Canal Free",
    desc: "Consultas gratuitas",
    url: "https://t.me/+7sBxmhOFPhJlYzcx",
    icon: "🔍",
    color: "--color-chart-3",
  },
  {
    label: "Suporte via WhatsApp",
    desc: "Fale com o suporte pelo WhatsApp",
    url: "https://wa.me/5581999377369",
    icon: "📱",
    color: "--color-chart-2",
  },
];

function UpdateCard({ notif, idx }: { notif: InfinityNotif; idx: number }) {
  const [imgExpanded, setImgExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * idx, duration: 0.35 }}
      className="group relative overflow-hidden rounded-2xl border border-white/8 bg-black/30 backdrop-blur-xl hover:border-white/15 transition-all duration-200"
      style={{
        boxShadow: "0 2px 20px rgba(0,0,0,0.2)",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.boxShadow =
          "0 4px 32px color-mix(in srgb, var(--color-primary) 15%, transparent)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 20px rgba(0,0,0,0.2)";
      }}
    >
      {/* Image area */}
      {notif.imageUrl && (
        <div
          className={`relative overflow-hidden cursor-pointer transition-all duration-300 ${imgExpanded ? "max-h-[480px]" : "max-h-56"}`}
          onClick={() => setImgExpanded(v => !v)}
        >
          <img
            src={notif.imageUrl}
            alt="Atualização"
            className="w-full object-cover"
            style={{ maxHeight: imgExpanded ? "480px" : "224px" }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60 pointer-events-none" />
          <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-lg px-2 py-1">
            <ImageIcon className="w-3 h-3 text-white/60" />
            <span className="text-[9px] text-white/60 uppercase tracking-wider">{imgExpanded ? "Recolher" : "Expandir"}</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)" }}
            >
              <Sparkles className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
            </div>
            <h3 className="font-bold text-sm text-foreground leading-snug truncate">{notif.title}</h3>
          </div>
          <span className="text-[10px] text-muted-foreground/50 shrink-0 whitespace-nowrap mt-1">
            {new Date(notif.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{notif.body}</p>

        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/40">
            por {notif.authorName}
          </span>
          <span className="text-[10px] text-muted-foreground/40">
            {new Date(notif.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

const IOS_STEPS = [
  { icon: "⬆️", title: 'Toque em "Compartilhar"', desc: 'Na barra inferior do Safari, toque no ícone de compartilhar (quadrado com seta para cima).' },
  { icon: "📋", title: '"Adicionar à Tela de Início"', desc: 'Role para baixo no menu e toque em "Adicionar à Tela de Início".' },
  { icon: "✅", title: "Confirme o nome", desc: 'O nome "Hydra" já vem preenchido. Toque em "Adicionar" no canto superior direito.' },
  { icon: "🚀", title: "Pronto!", desc: "O ícone da Hydra aparece na sua tela de início. Abra como um app nativo!" },
];

const ANDROID_STEPS = [
  { icon: "⋮", title: "Abra o menu do Chrome", desc: 'Toque nos três pontinhos (⋮) no canto superior direito do Chrome.' },
  { icon: "📲", title: '"Adicionar à tela inicial"', desc: 'Toque em "Adicionar à tela inicial" ou "Instalar app".' },
  { icon: "✅", title: "Confirme a instalação", desc: 'Toque em "Adicionar" ou "Instalar" na caixa de diálogo.' },
  { icon: "🚀", title: "Pronto!", desc: "A Hydra aparece na sua tela inicial e funciona offline como um app completo!" },
];

function PwaInstallGuide() {
  const [tab, setTab] = useState<"ios" | "android">("android");
  const [open, setOpen] = useState(false);

  const steps = tab === "ios" ? IOS_STEPS : ANDROID_STEPS;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18 }}
      className="rounded-2xl border border-white/8 bg-black/20 backdrop-blur-xl overflow-hidden"
      style={{ borderColor: "rgba(56,189,248,0.18)", background: "rgba(56,189,248,0.03)" }}
    >
      <button
        className="w-full flex items-center gap-4 p-5 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)" }}>
          <Smartphone className="w-5 h-5" style={{ color: "#38bdf8" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-foreground">Instalar o App no Celular</p>
          <p className="text-xs text-muted-foreground mt-0.5">Adicione a Hydra à tela inicial — funciona como um app nativo</p>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="w-4 h-4 text-muted-foreground/60" />
        </motion.div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">
              <div className="border-t border-white/8 mb-4" />

              {/* OS selector */}
              <div className="flex gap-2 mb-5">
                <button
                  onClick={() => setTab("android")}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all"
                  style={tab === "android"
                    ? { background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.40)", color: "#38bdf8" }
                    : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#888" }
                  }
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.523 15.341c-.31 0-.563-.252-.563-.563V9.832c0-.311.252-.563.563-.563s.563.252.563.563v4.946c0 .311-.252.563-.563.563zm-11.046 0c-.311 0-.563-.252-.563-.563V9.832c0-.311.252-.563.563-.563s.563.252.563.563v4.946c0 .311-.252.563-.563.563zM8.443 5.247l-.892-1.595a.187.187 0 0 0-.256-.068.187.187 0 0 0-.068.256l.903 1.614A5.515 5.515 0 0 0 5.887 8.58h12.226a5.515 5.515 0 0 0-2.243-3.126l.903-1.614a.187.187 0 0 0-.068-.256.187.187 0 0 0-.256.068l-.892 1.595A5.483 5.483 0 0 0 12 4.772a5.483 5.483 0 0 0-3.557 1.475zM9.75 7.313a.563.563 0 1 1 0-1.126.563.563 0 0 1 0 1.126zm4.5 0a.563.563 0 1 1 0-1.126.563.563 0 0 1 0 1.126zM5.887 9.143v7.313c0 .623.508 1.125 1.131 1.125h.844v2.532c0 .623.508 1.125 1.125 1.125s1.125-.502 1.125-1.125v-2.532h3.776v2.532c0 .623.508 1.125 1.125 1.125s1.125-.502 1.125-1.125v-2.532h.844c.623 0 1.131-.502 1.131-1.125V9.143H5.887z"/>
                  </svg>
                  Android (Chrome)
                </button>
                <button
                  onClick={() => setTab("ios")}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all"
                  style={tab === "ios"
                    ? { background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.40)", color: "#38bdf8" }
                    : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#888" }
                  }
                >
                  <Apple className="w-4 h-4" />
                  iPhone (Safari)
                </button>
              </div>

              {/* Steps */}
              <div className="space-y-3">
                {steps.map((step, i) => (
                  <motion.div
                    key={`${tab}-${i}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.06 * i, duration: 0.2 }}
                    className="flex items-start gap-3"
                  >
                    <div className="flex flex-col items-center shrink-0">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        {step.icon}
                      </div>
                      {i < steps.length - 1 && (
                        <div className="w-px h-3 mt-1" style={{ background: "rgba(255,255,255,0.08)" }} />
                      )}
                    </div>
                    <div className="pb-1">
                      <p className="text-sm font-semibold text-foreground leading-tight">{step.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-white/8">
                <p className="text-[11px] text-muted-foreground/50 text-center">
                  {tab === "ios"
                    ? "⚠️ Apenas Safari suporta instalação no iPhone. Não funciona via Chrome no iOS."
                    : "💡 Também funciona via Firefox e Samsung Internet no Android."}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function Suporte() {
  const [notifs, setNotifs] = useState<InfinityNotif[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifs = useCallback(() => {
    const token = localStorage.getItem("infinity_token");
    fetch("/api/infinity/notifications", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then((data: InfinityNotif[]) => {
        setNotifs(data);
        if (data.length > 0) markSuporteSeen(data[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchNotifs();
  }, [fetchNotifs]);

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.5em] mb-2" style={{ color: "color-mix(in srgb, var(--color-primary) 80%, transparent)" }}>
            <MessageCircle className="w-3.5 h-3.5" />
            Central de Suporte
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Suporte & Canais</h1>
          <p className="text-sm text-muted-foreground mt-1">Contato, canais gratuitos e novidades da plataforma</p>
        </div>
      </motion.div>

      {/* Telegram featured button */}
      <motion.a
        href="https://t.me/hydraconsultoria"
        target="_blank"
        rel="noopener noreferrer"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.03 }}
        className="group relative overflow-hidden rounded-2xl no-underline block"
        style={{
          background: "linear-gradient(135deg, rgba(33,150,243,0.18) 0%, rgba(0,136,204,0.10) 60%, rgba(33,150,243,0.14) 100%)",
          border: "1px solid rgba(0,136,204,0.30)",
          boxShadow: "0 0 0 0 rgba(0,136,204,0)",
          transition: "all 0.25s ease",
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = "linear-gradient(135deg, rgba(33,150,243,0.28) 0%, rgba(0,136,204,0.18) 60%, rgba(33,150,243,0.22) 100%)";
          el.style.borderColor = "rgba(0,136,204,0.60)";
          el.style.boxShadow = "0 4px 40px rgba(0,136,204,0.20), 0 0 0 1px rgba(0,136,204,0.15)";
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = "linear-gradient(135deg, rgba(33,150,243,0.18) 0%, rgba(0,136,204,0.10) 60%, rgba(33,150,243,0.14) 100%)";
          el.style.borderColor = "rgba(0,136,204,0.30)";
          el.style.boxShadow = "0 0 0 0 rgba(0,136,204,0)";
        }}
      >
        {/* Glow accent */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 20% 50%, rgba(0,136,204,0.12) 0%, transparent 70%)" }} />

        <div className="relative flex items-center gap-5 p-5 sm:p-6">
          {/* Telegram icon */}
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-full scale-110 opacity-0 group-hover:opacity-100 group-hover:scale-125 transition-all duration-300"
              style={{ background: "radial-gradient(circle, rgba(0,136,204,0.25) 0%, transparent 70%)" }} />
            <div className="relative w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #0088cc 0%, #29b6f6 100%)", boxShadow: "0 4px 20px rgba(0,136,204,0.35)" }}>
              <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.08 14.07l-2.95-.924c-.642-.2-.657-.642.136-.953l11.57-4.461c.537-.194 1.006.131.726.516z"/>
              </svg>
            </div>
          </div>

          {/* Text content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.45em]" style={{ color: "#29b6f6" }}>Contato Oficial</span>
              <span className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(0,136,204,0.15)", color: "#29b6f6", border: "1px solid rgba(0,136,204,0.30)" }}>
                Online
              </span>
            </div>
            <div className="font-bold text-base text-white leading-tight">Falar no Telegram</div>
            <div className="text-xs mt-1" style={{ color: "rgba(41,182,246,0.70)" }}>
              Suporte rápido · atendimento personalizado
            </div>
          </div>

          {/* Arrow */}
          <ExternalLink className="w-5 h-5 shrink-0 opacity-40 group-hover:opacity-80 transition-opacity" style={{ color: "#29b6f6" }} />
        </div>

        {/* Bottom accent line */}
        <div className="h-[2px] w-full opacity-30 group-hover:opacity-60 transition-opacity"
          style={{ background: "linear-gradient(90deg, transparent 0%, #29b6f6 30%, #0088cc 70%, transparent 100%)" }} />
      </motion.a>

      {/* Support links grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {LINKS.map((link, idx) => (
          <motion.a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.07 + 0.05 * idx }}
            className="group relative overflow-hidden rounded-2xl border border-white/8 bg-black/30 backdrop-blur-xl p-5 flex items-center gap-4 hover:border-white/20 transition-all duration-200 no-underline"
            style={{
              cursor: "pointer",
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = `color-mix(in srgb, var(${link.color}) 8%, rgba(0,0,0,0.4))`;
              el.style.boxShadow = `0 4px 32px color-mix(in srgb, var(${link.color}) 20%, transparent)`;
              el.style.borderColor = `color-mix(in srgb, var(${link.color}) 40%, transparent)`;
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = "";
              el.style.boxShadow = "";
              el.style.borderColor = "";
            }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 transition-transform duration-200 group-hover:scale-110"
              style={{
                background: `color-mix(in srgb, var(${link.color}) 12%, transparent)`,
                border: `1px solid color-mix(in srgb, var(${link.color}) 25%, transparent)`,
              }}
            >
              {link.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm text-foreground">{link.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{link.desc}</div>
            </div>
            <ExternalLink
              className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors"
            />
          </motion.a>
        ))}
      </div>

      {/* Info banner */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-white/8 bg-black/20 backdrop-blur-xl p-4 flex items-start gap-3"
        style={{ borderColor: "color-mix(in srgb, var(--color-primary) 20%, transparent)", background: "color-mix(in srgb, var(--color-primary) 4%, rgba(0,0,0,0.25))" }}
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)" }}>
          <Bell className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground mb-1">Como entrar em contato</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Para dúvidas, problemas de acesso ou suporte técnico, clique em <strong>Falar no Telegram</strong> acima ou use o botão <strong>Suporte via WhatsApp</strong>. Acompanhe novidades e atualizações pelo canal oficial da Hydra.
          </p>
        </div>
      </motion.div>

      {/* PWA Install Guide */}
      <PwaInstallGuide />

      {/* Updates section */}
      <div id="updates">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="flex items-center justify-between mb-4"
        >
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.5em] mb-1.5" style={{ color: "color-mix(in srgb, var(--color-primary) 80%, transparent)" }}>
              <Bell className="w-3.5 h-3.5" />
              Atualizações
            </div>
            <h2 className="text-lg font-bold tracking-tight">Novidades da Plataforma</h2>
          </div>
          <button
            onClick={() => { setLoading(true); fetchNotifs(); }}
            disabled={loading}
            className="w-8 h-8 rounded-xl flex items-center justify-center border border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all disabled:opacity-40"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </motion.div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-32 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : notifs.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl border border-white/8 bg-black/20 backdrop-blur-xl p-12 flex flex-col items-center text-center gap-3"
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)" }}>
              <Bell className="w-6 h-6 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-semibold text-foreground">Nenhuma novidade ainda</p>
            <p className="text-xs text-muted-foreground">As atualizações da plataforma aparecerão aqui.</p>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {notifs.map((n, i) => (
              <UpdateCard key={n.id} notif={n} idx={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
