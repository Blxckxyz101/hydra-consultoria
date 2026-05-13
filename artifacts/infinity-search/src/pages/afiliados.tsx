import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, Copy, Check, Gift, Users, Star, Clock,
  Loader2, QrCode, X, ArrowRight, Ticket, TrendingUp, Wallet,
  ChevronRight, CheckCircle2, BatteryFull, BatteryMedium, Battery, BatteryLow,
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

interface ReferralStats {
  referralCode: string;
  referralLink: string;
  bonusDaysPerReferral: number;
  totalReferrals: number;
  confirmedReferrals: number;
  totalBonusDaysEarned: number;
  referrals: { id: number; referredUsername: string; bonusDays: number; appliedAt: string | null; createdAt: string }[];
}

interface GiftPack {
  id: string;
  label: string;
  description: string;
  codesCount: number;
  days: number;
  amountBrl: string;
  retailValueBrl: string;
  perCodeBrl: string;
  savings: number;
  highlight: boolean;
}

interface GiftCode {
  code: string;
  packId: string;
  days: number;
  redeemedBy: string | null;
  redeemedAt: string | null;
  expiresAt: string;
  createdAt: string;
  status: "active" | "used" | "expired";
}

function CopyBtn({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [cp, setCp] = useState(false);
  return (
    <button
      onClick={async () => { await navigator.clipboard.writeText(text); setCp(true); setTimeout(() => setCp(false), 2500); }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium transition-all shrink-0"
    >
      {cp ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado!</> : <><Copy className="w-3.5 h-3.5" /> {label}</>}
    </button>
  );
}

const PACK_ICONS = [BatteryLow, Battery, BatteryMedium];

function BuyPackModal({ pack, onClose, onSuccess }: { pack: GiftPack; onClose: () => void; onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pixData, setPixData] = useState<{ paymentId: string; pixCopiaECola: string; qrcode_base64: string; amountBrl: string; purchaseId: number } | null>(null);
  const [polling, setPolling] = useState(false);
  const [countdown, setCountdown] = useState(300);
  const [done, setDone] = useState<GiftCode[]>([]);
  const [method, setMethod] = useState<"pix" | "wallet">("pix");

  const handleBuy = async () => {
    setError(""); setLoading(true);
    try {
      const r = await authFetch("/affiliate/packs/buy", {
        method: "POST",
        body: JSON.stringify({ packId: pack.id, method }),
      });
      const d = await r.json() as { purchaseId?: number; paymentId?: string; pixCopiaECola?: string; qrcode_base64?: string; amountBrl?: string; codes?: GiftCode[]; error?: string };
      if (!r.ok) { setError(d.error ?? "Erro ao processar"); setLoading(false); return; }

      if (method === "wallet" && d.codes) {
        setDone(d.codes as GiftCode[]); setLoading(false); return;
      }

      setPixData({ paymentId: d.paymentId!, pixCopiaECola: d.pixCopiaECola!, qrcode_base64: d.qrcode_base64!, amountBrl: d.amountBrl!, purchaseId: d.purchaseId! });
      setLoading(false);

      setPolling(true);
      setCountdown(300);
      const cdInt = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
      const poll = async () => {
        for (let i = 0; i < 60; i++) {
          await new Promise(res => setTimeout(res, 5000));
          try {
            const pr = await authFetch(`/affiliate/packs/buy/${d.purchaseId}/pix-status`);
            const pd = await pr.json() as { status: string; codes?: GiftCode[] };
            if (pd.status === "completed" && pd.codes) {
              clearInterval(cdInt); setPolling(false); setDone(pd.codes); return;
            }
          } catch {}
        }
        clearInterval(cdInt); setPolling(false);
      };
      poll();
    } catch { setError("Falha na conexão"); setLoading(false); }
  };

  if (done.length > 0) {
    return (
      <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <motion.div className="relative w-full max-w-md rounded-3xl border border-emerald-500/30 bg-[#05080f] shadow-2xl p-6" initial={{ scale: 0.95 }} animate={{ scale: 1 }}>
          <div className="text-center mb-5">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "color-mix(in srgb, #34d399 15%, transparent)", border: "2px solid #34d399" }}>
              <Check className="w-7 h-7 text-emerald-400" />
            </div>
            <h3 className="font-bold text-lg">Códigos gerados!</h3>
            <p className="text-xs text-muted-foreground mt-1">{done.length} código{done.length > 1 ? "s" : ""} de {pack.days} dias cada</p>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
            {done.map(c => (
              <div key={c.code} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10">
                <span className="font-mono text-sm text-emerald-300 font-bold tracking-wider">{c.code}</span>
                <CopyBtn text={c.code} />
              </div>
            ))}
          </div>
          <button onClick={() => { onSuccess(); onClose(); }} className="w-full py-3 rounded-xl font-bold text-sm text-black" style={{ background: "linear-gradient(135deg, #34d399, #22c55e)" }}>
            Fechar e atualizar
          </button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={!loading && !polling ? onClose : undefined} />
      <motion.div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#05080f] shadow-2xl p-6" initial={{ scale: 0.95 }} animate={{ scale: 1 }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-bold text-lg">Comprar Pacote {pack.label}</h3>
            <p className="text-xs text-muted-foreground">{pack.description} · R$ {pack.perCodeBrl}/código</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-white/10 text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <AnimatePresence mode="wait">
          {!pixData ? (
            <motion.div key="select" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="grid grid-cols-2 gap-2 mb-5">
                {(["pix", "wallet"] as const).map(m => (
                  <button key={m} onClick={() => setMethod(m)}
                    className={`py-3 rounded-xl text-sm font-semibold transition-all border ${method === m ? "text-black border-primary/50" : "text-muted-foreground border-white/10 hover:border-white/20"}`}
                    style={method === m ? { background: "var(--color-primary)" } : {}}>
                    {m === "pix" ? "PIX" : "Carteira"}
                  </button>
                ))}
              </div>
              <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-5">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-bold text-foreground">R$ {pack.amountBrl}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Valor de revenda estimado</span>
                  <span className="text-emerald-400">R$ {pack.retailValueBrl} (+{pack.savings}%)</span>
                </div>
              </div>
              {error && <p className="text-xs text-rose-400 bg-rose-400/8 border border-rose-400/20 rounded-lg px-3 py-2 mb-4">{error}</p>}
              <button onClick={handleBuy} disabled={loading}
                className="w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest text-black disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 75%, white))" }}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Processando...</> : <><QrCode className="w-4 h-4" /> {method === "pix" ? "Gerar PIX" : "Pagar com Carteira"}</>}
              </button>
            </motion.div>
          ) : (
            <motion.div key="pix" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="flex flex-col items-center gap-4 mb-5">
                {pixData.qrcode_base64 && (
                  <div className="p-3 rounded-2xl bg-white shadow-xl">
                    <img src={pixData.qrcode_base64.startsWith("data:") ? pixData.qrcode_base64 : `data:image/png;base64,${pixData.qrcode_base64}`} alt="QR PIX" className="w-44 h-44" />
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
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

export default function Afiliados() {
  const [tab, setTab] = useState<"indicacoes" | "codigos">("indicacoes");
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [packs, setPacks] = useState<GiftPack[]>([]);
  const [codes, setCodes] = useState<GiftCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [codesLoading, setCodesLoading] = useState(false);
  const [buyPack, setBuyPack] = useState<GiftPack | null>(null);

  const loadReferral = async () => {
    try {
      const r = await authFetch("/referral");
      if (r.ok) setReferralStats(await r.json());
    } catch {}
  };

  const loadPacks = async () => {
    try {
      const r = await authFetch("/affiliate/packs");
      if (r.ok) setPacks(await r.json());
    } catch {}
  };

  const loadCodes = async () => {
    setCodesLoading(true);
    try {
      const r = await authFetch("/affiliate/codes");
      if (r.ok) setCodes(await r.json());
    } catch {} finally { setCodesLoading(false); }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadReferral(), loadPacks()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab === "codigos") loadCodes();
  }, [tab]);

  const activeCodes = codes.filter(c => c.status === "active");
  const usedCodes = codes.filter(c => c.status === "used");

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)" }}>
          <Gift className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Afiliados & Revenda</h1>
          <p className="text-xs text-muted-foreground">Indique amigos, ganhe dias extras · Compre códigos e revenda</p>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-1 gap-1">
        {[
          { id: "indicacoes", label: "Indicações", icon: Users },
          { id: "codigos", label: "Códigos Gift", icon: Ticket },
        ].map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              style={tab === t.id ? { background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)", color: "var(--color-primary)" } : {}}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {tab === "indicacoes" ? (
          <motion.div key="indicacoes" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : referralStats ? (
              <>
                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Indicados", value: referralStats.totalReferrals, icon: Users, color: "var(--color-primary)" },
                    { label: "Confirmados", value: referralStats.confirmedReferrals, icon: CheckCircle2, color: "#34d399" },
                    { label: "Dias ganhos", value: referralStats.totalBonusDaysEarned, icon: Star, color: "#fbbf24" },
                  ].map(s => {
                    const Icon = s.icon;
                    return (
                      <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center">
                        <Icon className="w-4 h-4 mx-auto mb-2" style={{ color: s.color }} />
                        <div className="text-2xl font-black" style={{ color: s.color }}>{s.value}</div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{s.label}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Referral link */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck className="w-4 h-4 text-primary" />
                    Seu link de indicação
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 font-mono text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                      {referralStats.referralLink}
                    </div>
                    <CopyBtn text={referralStats.referralLink} label="Copiar link" />
                  </div>
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 flex items-start gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-300">
                      A cada amigo que se cadastrar e ativar um plano usando seu link, você ganha <strong>+{referralStats.bonusDaysPerReferral} dias extras</strong> de acesso automaticamente.
                    </p>
                  </div>
                </div>

                {/* How to share */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
                  <div className="text-sm font-semibold">Como divulgar</div>
                  <div className="space-y-2">
                    {[
                      "Envie seu link no WhatsApp, Telegram ou redes sociais",
                      "Seu amigo clica e se cadastra pela página de registro",
                      "Assim que ele ativar um plano, você ganha os dias automaticamente",
                    ].map((tip, i) => (
                      <div key={i} className="flex items-start gap-2.5 text-xs text-muted-foreground">
                        <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[9px] font-bold text-black mt-0.5"
                          style={{ background: "var(--color-primary)" }}>{i + 1}</span>
                        {tip}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Referral list */}
                {referralStats.referrals.length > 0 && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                    <div className="px-5 py-3 border-b border-white/5">
                      <span className="text-xs font-semibold uppercase tracking-wider">Seus indicados</span>
                    </div>
                    <div className="divide-y divide-white/5">
                      {referralStats.referrals.map(r => (
                        <div key={r.id} className="flex items-center justify-between px-5 py-3">
                          <div>
                            <span className="text-sm font-medium">@{r.referredUsername}</span>
                            <div className="text-[10px] text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("pt-BR")}</div>
                          </div>
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${r.appliedAt ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-400/10 text-amber-400"}`}>
                            {r.appliedAt ? `+${r.bonusDays} dias` : "Pendente"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12 text-muted-foreground text-sm">Erro ao carregar dados de indicação.</div>
            )}
          </motion.div>
        ) : (
          <motion.div key="codigos" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-4">
            {/* Packs to buy */}
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pacotes disponíveis</div>
              {packs.map((pack, i) => {
                const Icon = PACK_ICONS[i] ?? BatteryFull;
                return (
                  <motion.div
                    key={pack.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`relative rounded-2xl border p-5 transition-all ${pack.highlight ? "border-primary/40 bg-primary/5" : "border-white/10 bg-white/[0.03] hover:border-white/20"}`}
                  >
                    {pack.highlight && (
                      <span className="absolute -top-2.5 left-4 text-[9px] uppercase tracking-[0.3em] font-bold text-black px-2 py-0.5 rounded-full" style={{ background: "var(--color-primary)" }}>
                        Mais vantajoso
                      </span>
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${pack.highlight ? "text-primary" : "text-muted-foreground"}`} />
                        <div>
                          <div className="font-bold">{pack.label}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{pack.description}</div>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-xs text-muted-foreground">
                              R$ <span className="font-semibold text-foreground">{pack.perCodeBrl}</span>/código
                            </span>
                            <span className="text-xs text-emerald-400 font-semibold">−{pack.savings}% do varejo</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-xl font-black ${pack.highlight ? "text-primary" : "text-foreground"}`}>
                          R$ {pack.amountBrl}
                        </div>
                        <div className="text-[10px] text-muted-foreground">pagamento único</div>
                      </div>
                    </div>
                    <button
                      onClick={() => setBuyPack(pack)}
                      className="mt-4 w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                      style={pack.highlight ? { background: "var(--color-primary)", color: "#000" } : { background: "rgba(255,255,255,0.06)", color: "var(--color-foreground)", border: "1px solid rgba(255,255,255,0.1)" }}
                    >
                      <Wallet className="w-4 h-4" /> Comprar pacote
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </motion.div>
                );
              })}
            </div>

            {/* My codes */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Meus códigos</div>
                <button onClick={loadCodes} className="text-xs text-primary hover:underline">Atualizar</button>
              </div>

              {codesLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : codes.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
                  <Ticket className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Você ainda não tem códigos. Compre um pacote acima.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activeCodes.length > 0 && (
                    <>
                      <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold px-1">Ativos ({activeCodes.length})</div>
                      {activeCodes.map(c => (
                        <div key={c.code} className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                          <div>
                            <span className="font-mono text-sm text-emerald-300 font-bold tracking-wider">{c.code}</span>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{c.days} dias · expira {new Date(c.expiresAt).toLocaleDateString("pt-BR")}</div>
                          </div>
                          <CopyBtn text={c.code} />
                        </div>
                      ))}
                    </>
                  )}
                  {usedCodes.length > 0 && (
                    <>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold px-1 mt-3">Utilizados ({usedCodes.length})</div>
                      {usedCodes.map(c => (
                        <div key={c.code} className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02] opacity-60">
                          <div>
                            <span className="font-mono text-sm text-muted-foreground font-bold tracking-wider">{c.code}</span>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Usado por @{c.redeemedBy} · {c.redeemedAt ? new Date(c.redeemedAt).toLocaleDateString("pt-BR") : ""}
                            </div>
                          </div>
                          <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/50 px-2 py-1 rounded-full border border-white/5">USADO</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Info box */}
            <div className="rounded-2xl border border-sky-400/20 bg-sky-400/5 p-4 flex items-start gap-3">
              <ArrowRight className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <p className="text-xs text-sky-300 leading-relaxed">
                Os códigos são entregues imediatamente após a confirmação do pagamento. Cada código ativa <strong>{packs[0]?.days ?? 7} a {packs[packs.length - 1]?.days ?? 30} dias</strong> de acesso para outro usuário. Revenda com lucro!
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Buy modal */}
      <AnimatePresence>
        {buyPack && (
          <BuyPackModal
            pack={buyPack}
            onClose={() => setBuyPack(null)}
            onSuccess={() => { setBuyPack(null); loadCodes(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
