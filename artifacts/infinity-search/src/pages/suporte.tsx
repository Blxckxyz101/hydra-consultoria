import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageCircle, ExternalLink, Bell, Sparkles, Image as ImageIcon,
  RefreshCw, Smartphone, Apple, ChevronDown, Plus, X, Ticket, Clock,
  CheckCircle2, AlertCircle, Loader2, Trash2, Send, ShieldAlert,
} from "lucide-react";

interface InfinityNotif {
  id: string; title: string; body: string; imageUrl?: string;
  createdAt: string; authorName: string;
}

interface SupportTicket {
  id: number; username: string; title: string; body: string;
  status: string; adminNote: string | null; createdAt: string; resolvedAt: string | null;
}

const SUPORTE_SEEN_KEY = "infinity_suporte_seen_latest";
function getSuporteSeen() { return localStorage.getItem(SUPORTE_SEEN_KEY) ?? ""; }
function markSuporteSeen(id: string) { localStorage.setItem(SUPORTE_SEEN_KEY, id); }

const LINKS = [
  { label: "Canal de Atualizações", desc: "Novidades oficiais da plataforma", url: "https://t.me/hydraconsultoria", icon: "📢", color: "--color-chart-4" },
  { label: "Canal Free", desc: "Consultas gratuitas", url: "https://t.me/+7sBxmhOFPhJlYzcx", icon: "🔍", color: "--color-chart-3" },
  { label: "Suporte via WhatsApp", desc: "Fale com o suporte pelo WhatsApp", url: "https://wa.me/5581999377369", icon: "📱", color: "--color-chart-2" },
];

const STATUS_CONF: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  aberto:       { label: "Aberto",       color: "text-amber-400",  bg: "bg-amber-400/10 border-amber-400/25",   icon: Clock },
  em_andamento: { label: "Em Andamento", color: "text-sky-400",    bg: "bg-sky-400/10 border-sky-400/25",       icon: AlertCircle },
  resolvido:    { label: "Resolvido",    color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/25", icon: CheckCircle2 },
};

function TicketCard({ ticket, onRefresh }: { ticket: SupportTicket; onRefresh: () => void }) {
  const sc = STATUS_CONF[ticket.status] ?? STATUS_CONF.aberto;
  const ScIcon = sc.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/8 bg-black/30 backdrop-blur-xl p-5 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Ticket className="w-4 h-4 text-primary shrink-0" />
          <h3 className="font-bold text-sm truncate">{ticket.title}</h3>
        </div>
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0 ${sc.bg} ${sc.color}`}>
          <ScIcon className="w-2.5 h-2.5" />
          {sc.label}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{ticket.body}</p>
      {ticket.adminNote && (
        <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-sky-400 mb-1 font-semibold">Resposta da Equipe</p>
          <p className="text-xs text-sky-300 leading-relaxed">{ticket.adminNote}</p>
        </div>
      )}
      <div className="flex items-center justify-between pt-1 border-t border-white/5">
        <span className="text-[10px] text-muted-foreground/40">
          {new Date(ticket.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>
        {ticket.resolvedAt && (
          <span className="text-[10px] text-emerald-400/60">
            Resolvido em {new Date(ticket.resolvedAt).toLocaleDateString("pt-BR")}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function CreateTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) { setError("Preencha todos os campos."); return; }
    setLoading(true); setError("");
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; setError(j.error ?? "Erro ao criar ticket."); return; }
      onCreated();
    } catch { setError("Erro de conexão."); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="w-full max-w-lg rounded-3xl border border-white/10 bg-black/70 backdrop-blur-2xl p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.4em] mb-1" style={{ color: "var(--color-primary)" }}>
              <Ticket className="w-3 h-3" /> Novo Ticket
            </div>
            <h2 className="text-lg font-bold">Abrir Chamado de Suporte</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl border border-white/10 text-muted-foreground hover:text-foreground hover:border-white/25 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={e => { void handleSubmit(e); }} className="space-y-4">
          {error && (
            <div className="px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Título do Problema</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Descreva brevemente o problema..."
              maxLength={200}
              required
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Descrição Detalhada</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Explique o problema com o máximo de detalhes possível: o que aconteceu, quando, o que você tentou fazer..."
              rows={5}
              maxLength={2000}
              required
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-all resize-none"
            />
            <p className="text-[10px] text-muted-foreground/40 text-right">{body.length}/2000</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl border border-white/10 text-sm text-muted-foreground hover:text-foreground hover:border-white/25 transition-all">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim() || !body.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-black transition-all disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {loading ? "Enviando..." : "Abrir Ticket"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function UpdateCard({ notif, idx }: { notif: InfinityNotif; idx: number }) {
  const [imgExpanded, setImgExpanded] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * idx, duration: 0.35 }}
      className="group relative overflow-hidden rounded-2xl border border-white/8 bg-black/30 backdrop-blur-xl hover:border-white/15 transition-all duration-200"
      style={{ boxShadow: "0 2px 20px rgba(0,0,0,0.2)" }}
    >
      {notif.imageUrl && (
        <div className={`relative overflow-hidden cursor-pointer transition-all duration-300 ${imgExpanded ? "max-h-[480px]" : "max-h-56"}`} onClick={() => setImgExpanded(v => !v)}>
          <img src={notif.imageUrl} alt="Atualização" className="w-full object-cover" style={{ maxHeight: imgExpanded ? "480px" : "224px" }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60 pointer-events-none" />
          <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-lg px-2 py-1">
            <ImageIcon className="w-3 h-3 text-white/60" />
            <span className="text-[9px] text-white/60 uppercase tracking-wider">{imgExpanded ? "Recolher" : "Expandir"}</span>
          </div>
        </div>
      )}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)" }}>
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
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/40">por {notif.authorName}</span>
          <span className="text-[10px] text-muted-foreground/40">{new Date(notif.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>
    </motion.div>
  );
}

const IOS_STEPS = [
  { icon: "⬆️", title: 'Toque em "Compartilhar"', desc: 'Na barra inferior do Safari, toque no ícone de compartilhar.' },
  { icon: "📋", title: '"Adicionar à Tela de Início"', desc: 'Role para baixo no menu e toque em "Adicionar à Tela de Início".' },
  { icon: "✅", title: "Confirme o nome", desc: 'Toque em "Adicionar" no canto superior direito.' },
  { icon: "🚀", title: "Pronto!", desc: "O ícone da Hydra aparece na sua tela de início!" },
];
const ANDROID_STEPS = [
  { icon: "⋮", title: "Abra o menu do Chrome", desc: 'Toque nos três pontinhos (⋮) no canto superior direito.' },
  { icon: "📲", title: '"Adicionar à tela inicial"', desc: 'Toque em "Adicionar à tela inicial" ou "Instalar app".' },
  { icon: "✅", title: "Confirme a instalação", desc: 'Toque em "Adicionar" ou "Instalar" na caixa de diálogo.' },
  { icon: "🚀", title: "Pronto!", desc: "A Hydra aparece na sua tela inicial e funciona offline!" },
];

function PwaInstallGuide() {
  const [tab, setTab] = useState<"ios" | "android">("android");
  const [open, setOpen] = useState(false);
  const steps = tab === "ios" ? IOS_STEPS : ANDROID_STEPS;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
      className="rounded-2xl border border-white/8 bg-black/20 backdrop-blur-xl overflow-hidden"
      style={{ borderColor: "rgba(56,189,248,0.18)", background: "rgba(56,189,248,0.03)" }}
    >
      <button className="w-full flex items-center gap-4 p-5 text-left" onClick={() => setOpen(v => !v)}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)" }}>
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
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="px-5 pb-5">
              <div className="border-t border-white/8 mb-4" />
              <div className="flex gap-2 mb-5">
                {(["android", "ios"] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all"
                    style={tab === t ? { background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.40)", color: "#38bdf8" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#888" }}>
                    {t === "ios" ? <Apple className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                    {t === "ios" ? "iPhone (Safari)" : "Android (Chrome)"}
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                {steps.map((step, i) => (
                  <motion.div key={`${tab}-${i}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.06 * i }} className="flex items-start gap-3">
                    <div className="flex flex-col items-center shrink-0">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>{step.icon}</div>
                      {i < steps.length - 1 && <div className="w-px h-3 mt-1" style={{ background: "rgba(255,255,255,0.08)" }} />}
                    </div>
                    <div className="pb-1">
                      <p className="text-sm font-semibold text-foreground leading-tight">{step.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function Suporte() {
  const [activeTab, setActiveTab] = useState<"tickets" | "canais" | "novidades">("tickets");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [notifs, setNotifs] = useState<InfinityNotif[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(true);

  const fetchTickets = useCallback(async () => {
    setTicketsLoading(true);
    const token = localStorage.getItem("infinity_token");
    try {
      const r = await fetch("/api/infinity/support/tickets", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (r.ok) setTickets(await r.json());
    } catch {} finally { setTicketsLoading(false); }
  }, []);

  const fetchNotifs = useCallback(async () => {
    setNotifsLoading(true);
    const token = localStorage.getItem("infinity_token");
    try {
      const r = await fetch("/api/infinity/notifications", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data: InfinityNotif[] = await r.json();
      setNotifs(data);
      if (data.length > 0) markSuporteSeen(data[0].id);
    } catch {} finally { setNotifsLoading(false); }
  }, []);

  useEffect(() => { void fetchTickets(); void fetchNotifs(); }, [fetchTickets, fetchNotifs]);

  const TABS = [
    { id: "tickets" as const, label: "Meus Tickets", icon: Ticket },
    { id: "canais" as const, label: "Canais", icon: MessageCircle },
    { id: "novidades" as const, label: "Novidades", icon: Bell },
  ];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.5em] mb-2" style={{ color: "color-mix(in srgb, var(--color-primary) 80%, transparent)" }}>
            <MessageCircle className="w-3.5 h-3.5" />
            Central de Suporte
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Suporte & Canais</h1>
          <p className="text-sm text-muted-foreground mt-1">Tickets, contato e novidades da plataforma</p>
        </div>
        {activeTab === "tickets" && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm text-black transition-all hover:shadow-[0_0_30px_rgba(56,189,248,0.5)]"
            style={{ background: "linear-gradient(135deg, var(--color-primary), #22d3ee)" }}
          >
            <Plus className="w-4 h-4" />
            Abrir Ticket
          </motion.button>
        )}
      </motion.div>

      {/* Tab bar */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="flex gap-1 p-1 rounded-2xl border border-white/8 bg-black/20 backdrop-blur-xl">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
              style={active
                ? { background: "color-mix(in srgb, var(--color-primary) 15%, rgba(0,0,0,0.4))", color: "var(--color-primary)", border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)" }
                : { color: "rgba(255,255,255,0.4)", border: "1px solid transparent" }
              }
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </motion.div>

      {/* ── Tickets Tab ──────────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {activeTab === "tickets" && (
          <motion.div key="tickets" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
            {ticketsLoading ? (
              <div className="space-y-3">
                {[...Array(2)].map((_, i) => <div key={i} className="h-32 rounded-2xl bg-white/5 animate-pulse" />)}
              </div>
            ) : tickets.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="rounded-2xl border border-white/8 bg-black/20 backdrop-blur-xl p-12 flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)" }}>
                  <Ticket className="w-7 h-7 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Nenhum ticket aberto</p>
                  <p className="text-xs text-muted-foreground mt-1">Clique em "Abrir Ticket" para relatar um problema ao suporte.</p>
                </div>
                <button onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-black transition-all"
                  style={{ background: "var(--color-primary)" }}>
                  <Plus className="w-4 h-4" /> Abrir Ticket
                </button>
              </motion.div>
            ) : (
              <div className="space-y-3">
                {tickets.map(t => <TicketCard key={t.id} ticket={t} onRefresh={fetchTickets} />)}
              </div>
            )}

            {/* Info banner */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
              className="rounded-2xl border border-white/8 bg-black/20 backdrop-blur-xl p-4 flex items-start gap-3"
              style={{ borderColor: "color-mix(in srgb, var(--color-primary) 20%, transparent)", background: "color-mix(in srgb, var(--color-primary) 4%, rgba(0,0,0,0.25))" }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)" }}>
                <Bell className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
              </div>
              <div>
                <p className="text-sm font-semibold mb-1">Como funciona o suporte</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Abra um ticket descrevendo seu problema. Apenas você e os administradores poderão ver seu ticket. A equipe responderá e atualizará o status assim que possível.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* ── Canais Tab ─────────────────────────────────────────────────────── */}
        {activeTab === "canais" && (
          <motion.div key="canais" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
            {/* Telegram featured */}
            <motion.a href="https://t.me/hydraconsultoria" target="_blank" rel="noopener noreferrer"
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              className="group relative overflow-hidden rounded-2xl no-underline block"
              style={{ background: "linear-gradient(135deg, rgba(33,150,243,0.18) 0%, rgba(0,136,204,0.10) 60%, rgba(33,150,243,0.14) 100%)", border: "1px solid rgba(0,136,204,0.30)" }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "linear-gradient(135deg, rgba(33,150,243,0.28) 0%, rgba(0,136,204,0.18) 60%, rgba(33,150,243,0.22) 100%)"; el.style.borderColor = "rgba(0,136,204,0.60)"; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "linear-gradient(135deg, rgba(33,150,243,0.18) 0%, rgba(0,136,204,0.10) 60%, rgba(33,150,243,0.14) 100%)"; el.style.borderColor = "rgba(0,136,204,0.30)"; }}
            >
              <div className="relative flex items-center gap-5 p-5 sm:p-6">
                <div className="relative w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #0088cc 0%, #29b6f6 100%)", boxShadow: "0 4px 20px rgba(0,136,204,0.35)" }}>
                  <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.08 14.07l-2.95-.924c-.642-.2-.657-.642.136-.953l11.57-4.461c.537-.194 1.006.131.726.516z"/>
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.45em]" style={{ color: "#29b6f6" }}>Contato Oficial</span>
                  </div>
                  <div className="font-bold text-base text-white">Falar no Telegram</div>
                  <div className="text-xs mt-1" style={{ color: "rgba(41,182,246,0.70)" }}>Suporte rápido · atendimento personalizado</div>
                </div>
                <ExternalLink className="w-5 h-5 shrink-0 opacity-40 group-hover:opacity-80 transition-opacity" style={{ color: "#29b6f6" }} />
              </div>
              <div className="h-[2px] w-full opacity-30 group-hover:opacity-60 transition-opacity" style={{ background: "linear-gradient(90deg, transparent 0%, #29b6f6 30%, #0088cc 70%, transparent 100%)" }} />
            </motion.a>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {LINKS.map((link, idx) => (
                <motion.a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.07 + 0.05 * idx }}
                  className="group relative overflow-hidden rounded-2xl border border-white/8 bg-black/30 backdrop-blur-xl p-5 flex items-center gap-4 hover:border-white/20 transition-all duration-200 no-underline"
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = `color-mix(in srgb, var(${link.color}) 8%, rgba(0,0,0,0.4))`; el.style.borderColor = `color-mix(in srgb, var(${link.color}) 40%, transparent)`; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = ""; el.style.borderColor = ""; }}
                >
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 transition-transform duration-200 group-hover:scale-110"
                    style={{ background: `color-mix(in srgb, var(${link.color}) 12%, transparent)`, border: `1px solid color-mix(in srgb, var(${link.color}) 25%, transparent)` }}>
                    {link.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm text-foreground">{link.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{link.desc}</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors" />
                </motion.a>
              ))}
            </div>
            <PwaInstallGuide />
          </motion.div>
        )}

        {/* ── Novidades Tab ───────────────────────────────────────────────────── */}
        {activeTab === "novidades" && (
          <motion.div key="novidades" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.5em] mb-1.5" style={{ color: "color-mix(in srgb, var(--color-primary) 80%, transparent)" }}>
                  <Bell className="w-3.5 h-3.5" /> Atualizações
                </div>
                <h2 className="text-lg font-bold tracking-tight">Novidades da Plataforma</h2>
              </div>
              <button onClick={() => { setNotifsLoading(true); void fetchNotifs(); }} disabled={notifsLoading}
                className="w-8 h-8 rounded-xl flex items-center justify-center border border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all disabled:opacity-40">
                <RefreshCw className={`w-3.5 h-3.5 ${notifsLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
            {notifsLoading ? (
              <div className="space-y-4">{[...Array(2)].map((_, i) => <div key={i} className="h-32 rounded-2xl bg-white/5 animate-pulse" />)}</div>
            ) : notifs.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="rounded-2xl border border-white/8 bg-black/20 backdrop-blur-xl p-12 flex flex-col items-center text-center gap-3">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)" }}>
                  <Bell className="w-6 h-6 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-semibold">Nenhuma novidade ainda</p>
                <p className="text-xs text-muted-foreground">As atualizações da plataforma aparecerão aqui.</p>
              </motion.div>
            ) : (
              <div className="space-y-4">{notifs.map((n, i) => <UpdateCard key={n.id} notif={n} idx={i} />)}</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create ticket modal */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateTicketModal
            onClose={() => setShowCreateModal(false)}
            onCreated={() => { setShowCreateModal(false); void fetchTickets(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
