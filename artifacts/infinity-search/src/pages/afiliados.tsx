import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Gift, TrendingUp, Users, Tag, Copy, Check, Loader2, QrCode,
  Clock, ChevronRight, Wallet, BadgeCheck, AlertCircle, Link2,
  Package, BarChart3, ArrowRight, Sparkles, ShieldCheck, X,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const authFetch = (path: string, opts?: RequestInit) => {
  const token = localStorage.getItem("infinity_token");
  return fetch(`${BASE}/api/infinity${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
};

type TabKey = "programa" | "codigos" | "indicacoes";
type CodeFilter = "todos" | "active" | "used" | "expired";

interface GiftPack {
  id: string; label: string; description: string;
  codesCount: number; days: number;
  amountCents: number; amountBrl: string;
  retailValueCents: number; retailValueBrl: string;
  perCodeBrl: string; perRetailBrl: string;
  savings: number; highlight: boolean;
}

interface GiftCode {
  code: string; packId: string; days: number;
  redeemedBy: string | null; redeemedAt: string | null;
  expiresAt: string; createdAt: string;
  status: "active" | "used" | "expired";
}

interface Stats {
  total: number; active: number; used: number; expired: number;
  revenueEstCents: number; revenueEstBrl: string;
}

interface ReferralData {
  referralCode: string; referralLink: string;
  bonusDaysPerReferral: number; totalReferrals: number;
  confirmedReferrals: number; totalBonusDaysEarned: number;
  referrals: Array<{ id: number; referredUsername: string; bonusDays: number; appliedAt: string | null; createdAt: string }>;
}

interface WalletData { balanceCents: number; balanceBrl: string }

interface PixPayData {
  purchaseId: number; paymentId: string; txid: string;
  pixCopiaECola: string; qrcode_base64: string; amountBrl: string;
  pack: { id: string; label: string; codesCount: number; days: number };
  expiresAt: string;
}

function CopyBtn({ text, className }: { text: string; className?: string }) {
  const [cp, setCp] = useState(false);
  return (
    <button onClick={async () => { await navigator.clipboard.writeText(text); setCp(true); setTimeout(() => setCp(false), 2000); }}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-muted-foreground hover:text-foreground transition-all ${className ?? ""}`}>
      {cp ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado!</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
    </button>
  );
}

function StatusBadge({ status }: { status: GiftCode["status"] }) {
  const map = {
    active: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
    used:   "text-blue-400 bg-blue-400/10 border-blue-400/30",
    expired:"text-rose-400 bg-rose-400/10 border-rose-400/30",
  };
  const labels = { active: "Ativo", used: "Usado", expired: "Expirado" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${map[status]}`}>
      {labels[status]}
    </span>
  );
}

function BuyModal({ pack, wallet, onClose, onSuccess }: {
  pack: GiftPack; wallet: WalletData | null; onClose: () => void;
  onSuccess: (codes: { code: string; expiresAt: string }[]) => void;
}) {
  const [method, setMethod] = useState<"pix" | "wallet">("pix");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pixData, setPixData] = useState<PixPayData | null>(null);
  const [polling, setPolling] = useState(false);
  const [countdown, setCountdown] = useState(180);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const hasBalance = (wallet?.balanceCents ?? 0) >= pack.amountCents;

  const startPollPurchase = (purchaseId: number) => {
    setPolling(true);
    setCountdown(180);
    const cdInt = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    let ticks = 0;
    pollRef.current = setInterval(async () => {
      ticks++;
      if (ticks > 60) { clearInterval(pollRef.current!); clearInterval(cdInt); setPolling(false); return; }
      try {
        const r = await authFetch(`/affiliate/packs/buy/${purchaseId}/pix-status`);
        const d = await r.json() as { status: string; codes?: { code: string; expiresAt: string }[] };
        if (d.status === "completed" && d.codes) {
          clearInterval(pollRef.current!); clearInterval(cdInt); setPolling(false);
          onSuccess(d.codes);
        }
      } catch {}
    }, 3000);
  };

  const handleBuy = async () => {
    setError(""); setLoading(true);
    try {
      const r = await authFetch("/affiliate/packs/buy", {
        method: "POST", body: JSON.stringify({ packId: pack.id, method }),
      });
      const d = await r.json() as PixPayData & { error?: string; codes?: { code: string; expiresAt: string }[] };
      if (!r.ok) { setError(d.error ?? "Erro ao processar compra"); setLoading(false); return; }
      if (method === "wallet") {
        onSuccess(d.codes ?? []);
      } else {
        setPixData(d); setLoading(false);
        startPollPurchase(d.purchaseId);
      }
    } catch { setError("Falha na conexão"); setLoading(false); }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#05080f] shadow-2xl p-6"
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-bold text-lg">Comprar Pacote {pack.label}</h3>
            <p className="text-xs text-muted-foreground">{pack.description}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-white/10 text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!pixData ? (
          <>
            {/* Method selector */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              {(["pix", "wallet"] as const).map(m => (
                <button key={m} onClick={() => setMethod(m)}
                  className={`p-4 rounded-2xl border text-sm font-medium transition-all ${method === m ? "border-primary/60 bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-muted-foreground hover:border-white/20"}`}>
                  {m === "pix" ? <><QrCode className="w-5 h-5 mx-auto mb-1.5" />PIX</> : <><Wallet className="w-5 h-5 mx-auto mb-1.5" />Carteira</>}
                  {m === "wallet" && wallet && (
                    <div className={`text-[10px] mt-1 ${hasBalance ? "text-emerald-400" : "text-rose-400"}`}>
                      {hasBalance ? `Saldo: R$ ${wallet.balanceBrl}` : `Saldo insuficiente`}
                    </div>
                  )}
                </button>
              ))}
            </div>

            <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-5">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Pacote</span>
                <span className="font-semibold">{pack.codesCount} × {pack.days} dias</span>
              </div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Valor de varejo</span>
                <span className="line-through text-muted-foreground/60">R$ {pack.retailValueBrl}</span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-white/5 pt-2 mt-2">
                <span>Total</span>
                <span style={{ color: "var(--color-primary)" }}>R$ {pack.amountBrl}</span>
              </div>
              <div className="text-right text-[10px] text-emerald-400 mt-1">Economize {pack.savings}%</div>
            </div>

            {error && <p className="text-xs text-rose-400 bg-rose-400/8 border border-rose-400/20 rounded-lg px-3 py-2 mb-4">{error}</p>}

            <button onClick={handleBuy} disabled={loading || (method === "wallet" && !hasBalance)}
              className="w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest text-black disabled:opacity-40 flex items-center justify-center gap-2 transition-all"
              style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 75%, white))" }}>
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Processando...</> : <>Pagar R$ {pack.amountBrl}</>}
            </button>
          </>
        ) : (
          <>
            <h4 className="font-bold mb-4 text-center">Pague via PIX</h4>
            <div className="flex flex-col items-center gap-4 mb-5">
              {pixData.qrcode_base64 && (
                <div className="p-3 rounded-2xl bg-white shadow-xl">
                  <img
                    src={
                      pixData.qrcode_base64.startsWith("http") ? pixData.qrcode_base64 :
                      pixData.qrcode_base64.startsWith("data:") ? pixData.qrcode_base64 :
                      `data:image/png;base64,${pixData.qrcode_base64}`
                    }
                    alt="QR PIX" className="w-40 h-40"
                  />
                </div>
              )}
              <div className="text-2xl font-bold" style={{ color: "var(--color-primary)" }}>R$ {pixData.amountBrl}</div>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 mb-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60">Copia e Cola</span>
                <CopyBtn text={pixData.pixCopiaECola} />
              </div>
              <p className="font-mono text-xs text-muted-foreground break-all line-clamp-2">{pixData.pixCopiaECola}</p>
            </div>
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 flex items-center gap-3">
              {polling ? <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" /> : <Clock className="w-4 h-4 text-amber-400 shrink-0" />}
              <div className="text-xs">
                <span className="text-amber-300 font-semibold">Aguardando pagamento</span>
                {polling && <span className="text-muted-foreground ml-2">· {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}</span>}
              </div>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function CodesSuccessModal({ codes, onClose }: { codes: { code: string; expiresAt: string }[]; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#05080f] shadow-2xl p-6"
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-bold text-lg text-emerald-400">Códigos gerados!</h3>
            <p className="text-xs text-muted-foreground">{codes.length} código{codes.length !== 1 ? "s" : ""} prontos para distribuir</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-white/10 text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {codes.map(c => (
            <div key={c.code} className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
              <span className="font-mono text-sm text-emerald-300 tracking-widest">{c.code}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">expira {new Date(c.expiresAt).toLocaleDateString("pt-BR")}</span>
                <CopyBtn text={c.code} />
              </div>
            </div>
          ))}
        </div>
        <CopyBtn text={codes.map(c => c.code).join("\n")} className="w-full mt-4 justify-center" />
        <button onClick={onClose}
          className="w-full mt-3 py-3 rounded-xl font-bold text-sm uppercase tracking-widest text-black transition-all"
          style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 75%, white))" }}>
          Fechar
        </button>
      </motion.div>
    </motion.div>
  );
}

export default function Afiliados() {
  const [tab, setTab] = useState<TabKey>("programa");
  const [packs, setPacks] = useState<GiftPack[]>([]);
  const [codes, setCodes] = useState<GiftCode[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [referral, setReferral] = useState<ReferralData | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [codeFilter, setCodeFilter] = useState<CodeFilter>("todos");
  const [buyingPack, setBuyingPack] = useState<GiftPack | null>(null);
  const [newCodes, setNewCodes] = useState<{ code: string; expiresAt: string }[] | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [packsR, codesR, statsR, refR, walletR] = await Promise.all([
        authFetch("/affiliate/packs").then(r => r.json()),
        authFetch("/affiliate/codes").then(r => r.json()),
        authFetch("/affiliate/stats").then(r => r.json()),
        authFetch("/referral").then(r => r.json()),
        authFetch("/wallet").then(r => r.json()),
      ]);
      setPacks(Array.isArray(packsR) ? packsR : []);
      setCodes(Array.isArray(codesR) ? codesR : []);
      setStats(statsR);
      setReferral(refR);
      setWallet(walletR);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredCodes = codes.filter(c => codeFilter === "todos" || c.status === codeFilter);

  const copyLink = async () => {
    if (!referral) return;
    await navigator.clipboard.writeText(referral.referralLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "programa", label: "Programa", icon: Package },
    { key: "codigos",  label: "Meus Códigos", icon: Tag },
    { key: "indicacoes", label: "Indicações", icon: Users },
  ];

  const FILTER_LABELS: Record<CodeFilter, string> = {
    todos: "Todos", active: "Ativos", used: "Usados", expired: "Expirados",
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start gap-4 mb-2">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 40%, transparent)" }}>
            <Gift className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Programa de Afiliados</h1>
            <p className="text-sm text-muted-foreground">Compre pacotes de Gift Cards, distribua e ganhe.</p>
          </div>
        </div>
      </motion.div>

      {/* Stats row */}
      {stats && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total de Códigos", value: stats.total, color: "text-foreground" },
            { label: "Ativos", value: stats.active, color: "text-emerald-400" },
            { label: "Usados", value: stats.used, color: "text-blue-400" },
            { label: "Receita Est.", value: `R$ ${stats.revenueEstBrl}`, color: "text-primary" },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border border-white/8 bg-black/30 p-4">
              <div className={`text-xl font-bold mb-0.5 ${s.color}`}>{s.value}</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">{s.label}</div>
            </div>
          ))}
        </motion.div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 rounded-2xl bg-white/5 border border-white/8">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${active ? "text-black" : "text-muted-foreground hover:text-foreground"}`}
              style={active ? { background: "var(--color-primary)" } : {}}>
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {/* ── PROGRAMA TAB ─────────────────────────────────────────────────────── */}
        {tab === "programa" && (
          <motion.div key="programa" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
            {/* How it works */}
            <div className="rounded-2xl border border-white/8 bg-black/30 p-6">
              <h3 className="font-bold text-sm uppercase tracking-[0.2em] text-muted-foreground/60 mb-4">Como funciona</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { icon: Package, title: "1. Compre um Pacote", desc: "Escolha um dos 3 pacotes abaixo. Pague via PIX ou usando seu saldo da Carteira." },
                  { icon: Gift, title: "2. Distribua os Códigos", desc: "Cada código tem formato INFY-XXXX-XXXX-XXXX. Validade de 60 dias para ser usado." },
                  { icon: TrendingUp, title: "3. Lucre na Margem", desc: "Você vende os códigos pelo preço que quiser — o custo por código é sempre menor." },
                ].map(s => {
                  const Icon = s.icon;
                  return (
                    <div key={s.title} className="flex flex-col gap-3 p-4 rounded-xl bg-white/3 border border-white/5">
                      <Icon className="w-5 h-5 text-primary" />
                      <div className="font-semibold text-sm">{s.title}</div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Packs */}
            <h3 className="font-semibold text-base">Escolha seu pacote</h3>
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {packs.map(pack => (
                  <motion.div key={pack.id} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    className={`relative rounded-2xl border p-5 flex flex-col gap-4 transition-all cursor-pointer ${
                      pack.highlight
                        ? "border-primary/50 bg-primary/5 shadow-[0_0_40px_-10px_var(--color-primary)]"
                        : "border-white/10 bg-black/30 hover:border-white/20"
                    }`}
                    onClick={() => setBuyingPack(pack)}>
                    {pack.highlight && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[9px] uppercase tracking-[0.3em] font-bold text-black"
                        style={{ background: "var(--color-primary)" }}>Mais vendido</div>
                    )}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-base">{pack.label}</span>
                        <span className="text-[10px] uppercase tracking-[0.2em] text-primary/70 bg-primary/10 px-2 py-0.5 rounded-full">-{pack.savings}%</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{pack.description}</p>
                    </div>
                    <div className="flex-1">
                      <div className="text-2xl font-bold mb-0.5" style={{ color: pack.highlight ? "var(--color-primary)" : undefined }}>
                        R$ {pack.amountBrl}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="line-through">R$ {pack.retailValueBrl}</span> varejo
                      </div>
                    </div>
                    <div className="space-y-1.5 pt-3 border-t border-white/5">
                      {[
                        { icon: Tag, text: `${pack.codesCount} códigos · ${pack.days} dias cada` },
                        { icon: BarChart3, text: `Custo: R$ ${pack.perCodeBrl}/código` },
                        { icon: TrendingUp, text: `Margem vs varejo: +${pack.savings}%` },
                        { icon: Clock, text: "Códigos expiram em 60 dias" },
                      ].map(f => {
                        const FIcon = f.icon;
                        return (
                          <div key={f.text} className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                            <FIcon className="w-3 h-3 text-primary/60 shrink-0" /> {f.text}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      className="w-full py-2.5 rounded-xl font-bold text-sm text-black flex items-center justify-center gap-2 transition-all"
                      style={{ background: pack.highlight ? "var(--color-primary)" : "rgba(255,255,255,0.1)", color: pack.highlight ? "#000" : undefined }}>
                      Comprar <ArrowRight className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Wallet hint */}
            {wallet && (
              <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3">
                <Wallet className="w-4 h-4 text-primary/70 shrink-0" />
                <p className="text-xs text-muted-foreground flex-1">
                  Seu saldo atual: <span className="font-semibold text-foreground">R$ {wallet.balanceBrl}</span>.
                  {" "}Adicione saldo na <a href="/carteira" className="text-primary hover:underline">Carteira</a> para compras instantâneas.
                </p>
              </div>
            )}
          </motion.div>
        )}

        {/* ── CÓDIGOS TAB ──────────────────────────────────────────────────────── */}
        {tab === "codigos" && (
          <motion.div key="codigos" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            {/* Filter */}
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(FILTER_LABELS) as CodeFilter[]).map(f => (
                <button key={f} onClick={() => setCodeFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    codeFilter === f ? "border-primary/50 text-black" : "border-white/10 text-muted-foreground hover:border-white/20"
                  }`}
                  style={codeFilter === f ? { background: "var(--color-primary)" } : {}}>
                  {FILTER_LABELS[f]}
                  {f !== "todos" && stats && (
                    <span className={`ml-1.5 text-[9px] ${codeFilter === f ? "text-black/70" : "text-muted-foreground/60"}`}>
                      ({stats[f] ?? 0})
                    </span>
                  )}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : filteredCodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Tag className="w-10 h-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">
                  {codeFilter === "todos" ? "Nenhum código ainda. Compre um pacote!" : `Nenhum código ${FILTER_LABELS[codeFilter].toLowerCase()}.`}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredCodes.map((c, i) => (
                  <motion.div key={c.code} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="flex items-center gap-3 p-4 rounded-xl border border-white/8 bg-black/20 hover:bg-black/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-mono text-sm text-foreground tracking-widest">{c.code}</span>
                        <StatusBadge status={c.status} />
                      </div>
                      <div className="flex gap-3 mt-1.5 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">{c.days} dias</span>
                        {c.redeemedBy && <span className="text-[10px] text-blue-400/80">@{c.redeemedBy}</span>}
                        <span className="text-[10px] text-muted-foreground">
                          {c.status === "expired" ? "Expirou" : c.status === "used" ? "Usado em" : "Expira em"}{" "}
                          {new Date(c.status === "used" ? c.redeemedAt! : c.expiresAt).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                    </div>
                    {c.status === "active" && <CopyBtn text={c.code} />}
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ── INDICAÇÕES TAB ───────────────────────────────────────────────────── */}
        {tab === "indicacoes" && (
          <motion.div key="indicacoes" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : referral ? (
              <>
                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Indicados", value: referral.totalReferrals, color: "text-foreground" },
                    { label: "Confirmados", value: referral.confirmedReferrals, color: "text-emerald-400" },
                    { label: "Bônus Ganhos", value: `+${referral.totalBonusDaysEarned}d`, color: "text-primary" },
                  ].map(s => (
                    <div key={s.label} className="rounded-2xl border border-white/8 bg-black/30 p-4 text-center">
                      <div className={`text-xl font-bold mb-0.5 ${s.color}`}>{s.value}</div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* How referral works */}
                <div className="rounded-2xl border border-white/8 bg-black/30 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <h3 className="font-semibold text-sm">Como funciona</h3>
                  </div>
                  <div className="space-y-3">
                    {[
                      { icon: Link2, text: "Compartilhe seu link de indicação com amigos" },
                      { icon: Users, text: "Amigo se cadastra e realiza o primeiro pagamento" },
                      { icon: BadgeCheck, text: `Você recebe automaticamente ${referral.bonusDaysPerReferral} dias de bônus no seu plano` },
                    ].map(s => {
                      const Icon = s.icon;
                      return (
                        <div key={s.text} className="flex items-center gap-3 text-sm text-muted-foreground">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)" }}>
                            <Icon className="w-3.5 h-3.5 text-primary" />
                          </div>
                          {s.text}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Referral link */}
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Link2 className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-sm">Seu link de indicação</span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <code className="flex-1 font-mono text-xs text-primary/80 bg-black/30 px-3 py-2 rounded-lg border border-white/10 break-all">
                      {referral.referralLink}
                    </code>
                    <button onClick={copyLink}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm text-black transition-all shrink-0"
                      style={{ background: "var(--color-primary)" }}>
                      {linkCopied ? <><Check className="w-4 h-4" /> Copiado!</> : <><Copy className="w-4 h-4" /> Copiar</>}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 mt-3">
                    Seu código de indicação: <span className="font-mono font-bold text-foreground/80">{referral.referralCode}</span>
                  </p>
                </div>

                {/* Referral history */}
                {referral.referrals.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs uppercase tracking-[0.2em] text-muted-foreground/60 font-semibold">Histórico de Indicações</h4>
                    {referral.referrals.map(r => (
                      <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl border border-white/8 bg-black/20">
                        <div className="flex-1">
                          <div className="font-mono text-sm">@{r.referredUsername}</div>
                          <div className="text-[10px] text-muted-foreground">Indicado em {new Date(r.createdAt).toLocaleDateString("pt-BR")}</div>
                        </div>
                        <div className="text-right">
                          {r.appliedAt ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2 py-0.5 rounded-full">
                              <Check className="w-2.5 h-2.5" /> +{r.bonusDays}d
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
                              <Clock className="w-2.5 h-2.5" /> Pendente
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center py-10">
                <AlertCircle className="w-5 h-5 text-muted-foreground/40 mr-2" />
                <span className="text-sm text-muted-foreground">Erro ao carregar dados de indicação.</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Buy Modal */}
      <AnimatePresence>
        {buyingPack && (
          <BuyModal
            pack={buyingPack}
            wallet={wallet}
            onClose={() => setBuyingPack(null)}
            onSuccess={codes => {
              setBuyingPack(null);
              setNewCodes(codes);
              loadData();
            }}
          />
        )}
        {newCodes && (
          <CodesSuccessModal
            codes={newCodes}
            onClose={() => { setNewCodes(null); setTab("codigos"); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
