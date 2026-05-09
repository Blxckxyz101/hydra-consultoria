import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wallet, Plus, ArrowUpRight, ArrowDownLeft, Loader2, QrCode,
  Clock, Check, Copy, X, TrendingUp, History, RefreshCw,
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

interface WalletData {
  balanceCents: number;
  balanceBrl: string;
  updatedAt: string;
  recentTxns: Txn[];
}

interface Txn {
  id: number;
  direction: "credit" | "debit";
  amountCents: number;
  amountBrl: string;
  description: string;
  refId: string | null;
  createdAt: string;
}

function CopyBtn({ text }: { text: string }) {
  const [cp, setCp] = useState(false);
  return (
    <button onClick={async () => { await navigator.clipboard.writeText(text); setCp(true); setTimeout(() => setCp(false), 2000); }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-muted-foreground hover:text-foreground transition-all">
      {cp ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado!</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
    </button>
  );
}

const TOPUP_PRESETS = [50, 100, 200, 500];

function TopupModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount] = useState<string>("100");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pixData, setPixData] = useState<{
    paymentId: string; pixCopiaECola: string; qrcode_base64: string; amountBrl: string;
  } | null>(null);
  const [polling, setPolling] = useState(false);
  const [countdown, setCountdown] = useState(180);
  const [paid, setPaid] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const amountNum = Number(amount);
  const valid = !isNaN(amountNum) && amountNum >= 10 && amountNum <= 5000;

  const startPoll = (paymentId: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPolling(true);
    setCountdown(180);
    const cdInt = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);

    (async () => {
      try {
        const token = localStorage.getItem("infinity_token");
        const r = await fetch(`${BASE}/api/infinity/wallet/topup/${paymentId}/watch`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        if (!r.ok || !r.body) return;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find(l => l.startsWith("data: "));
            if (!line) continue;
            try {
              const d = JSON.parse(line.slice(6)) as { status: string };
              if (d.status === "paid") {
                clearInterval(cdInt); setPolling(false); setPaid(true);
                setTimeout(() => onSuccess(), 1500); return;
              }
              if (d.status === "expired" || d.status === "failed") {
                clearInterval(cdInt); setPolling(false); return;
              }
            } catch {}
          }
        }
      } catch {}
      clearInterval(cdInt);
      setPolling(false);
    })();
  };

  const handleGenerate = async () => {
    setError(""); setLoading(true);
    try {
      const r = await authFetch("/wallet/topup", {
        method: "POST", body: JSON.stringify({ amountBrl: amountNum }),
      });
      const d = await r.json() as { paymentId?: string; pixCopiaECola?: string; qrcode_base64?: string; amountBrl?: string; error?: string };
      if (!r.ok) { setError(d.error ?? "Erro ao gerar PIX"); setLoading(false); return; }
      setPixData({ paymentId: d.paymentId!, pixCopiaECola: d.pixCopiaECola!, qrcode_base64: d.qrcode_base64!, amountBrl: d.amountBrl! });
      setLoading(false);
      startPoll(d.paymentId!);
    } catch { setError("Falha na conexão"); setLoading(false); }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={!loading && !polling ? onClose : undefined} />
      <motion.div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#05080f] shadow-2xl p-6"
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-bold text-lg">Adicionar Saldo</h3>
            <p className="text-xs text-muted-foreground">Pague via PIX e o saldo é creditado na hora</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-white/10 text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <AnimatePresence mode="wait">
          {paid ? (
            <motion.div key="paid" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "2px solid var(--color-primary)" }}>
                <Check className="w-8 h-8 text-primary" />
              </div>
              <h4 className="font-bold text-lg mb-1">Saldo creditado!</h4>
              <p className="text-sm text-muted-foreground">R$ {pixData?.amountBrl} adicionado à sua carteira</p>
            </motion.div>
          ) : !pixData ? (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {/* Presets */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {TOPUP_PRESETS.map(p => (
                  <button key={p} onClick={() => setAmount(String(p))}
                    className={`py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                      Number(amount) === p ? "text-black border-primary/50" : "text-muted-foreground border-white/10 hover:border-white/20"
                    }`}
                    style={Number(amount) === p ? { background: "var(--color-primary)" } : {}}>
                    R${p}
                  </button>
                ))}
              </div>

              {/* Custom amount */}
              <div className="relative mb-5">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">R$</span>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                  min={10} max={5000}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-primary/50 transition-colors"
                  placeholder="Valor personalizado" />
              </div>

              {error && <p className="text-xs text-rose-400 bg-rose-400/8 border border-rose-400/20 rounded-lg px-3 py-2 mb-4">{error}</p>}

              <p className="text-[10px] text-muted-foreground/60 mb-4 text-center">Mínimo R$10 · Máximo R$5.000 por depósito</p>

              <button onClick={handleGenerate} disabled={!valid || loading}
                className="w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest text-black disabled:opacity-40 flex items-center justify-center gap-2 transition-all"
                style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 75%, white))" }}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando...</> : <><QrCode className="w-4 h-4" /> Gerar PIX</>}
              </button>
            </motion.div>
          ) : (
            <motion.div key="pix" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="flex flex-col items-center gap-4 mb-5">
                {pixData.qrcode_base64 && (
                  <div className="p-3 rounded-2xl bg-white shadow-xl">
                    <img
                      src={
                        pixData.qrcode_base64.startsWith("http") ? pixData.qrcode_base64 :
                        pixData.qrcode_base64.startsWith("data:") ? pixData.qrcode_base64 :
                        `data:image/png;base64,${pixData.qrcode_base64}`
                      }
                      alt="QR PIX" className="w-44 h-44"
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
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

export default function Carteira() {
  const [data, setData] = useState<WalletData | null>(null);
  const [allTxns, setAllTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [txnLoading, setTxnLoading] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch("/wallet");
      const d = await r.json() as WalletData;
      setData(d);
    } catch {}
    setLoading(false);
  }, []);

  const loadAllTxns = useCallback(async () => {
    setTxnLoading(true);
    try {
      const r = await authFetch("/wallet/transactions?limit=100");
      const d = await r.json() as Txn[];
      setAllTxns(Array.isArray(d) ? d : []);
    } catch {}
    setTxnLoading(false);
  }, []);

  useEffect(() => { load(); loadAllTxns(); }, [load, loadAllTxns]);

  const txns = allTxns.length > 0 ? allTxns : (data?.recentTxns ?? []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 40%, transparent)" }}>
            <Wallet className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Carteira</h1>
            <p className="text-sm text-muted-foreground">Saldo para compras instantâneas de pacotes</p>
          </div>
        </div>
        <button onClick={() => { load(); loadAllTxns(); }} className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors" title="Atualizar">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </motion.div>

      {/* Balance card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="relative overflow-hidden rounded-3xl p-6"
        style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 20%, #05080f), #05080f)", border: "1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)" }}>
        {/* BG glow */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse at 10% 50%, color-mix(in srgb, var(--color-primary) 12%, transparent) 0%, transparent 70%)",
        }} />
        <div className="relative">
          <div className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground/60 mb-2">Saldo Disponível</div>
          {loading ? (
            <div className="h-12 flex items-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            <div className="text-5xl font-bold tracking-tight"
              style={{ background: "linear-gradient(to right, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, white))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              R$ {data?.balanceBrl ?? "0,00"}
            </div>
          )}
          {data?.updatedAt && (
            <div className="text-[10px] text-muted-foreground/40 mt-2">
              Atualizado {new Date(data.updatedAt).toLocaleString("pt-BR")}
            </div>
          )}
          <button onClick={() => setTopupOpen(true)}
            className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-black transition-all"
            style={{ background: "var(--color-primary)" }}>
            <Plus className="w-4 h-4" /> Adicionar Saldo
          </button>
        </div>
      </motion.div>

      {/* Quick stats */}
      {!loading && txns.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          className="grid grid-cols-2 gap-3">
          {[
            {
              label: "Total Depositado",
              value: `R$ ${(txns.filter(t => t.direction === "credit").reduce((a, t) => a + t.amountCents, 0) / 100).toFixed(2)}`,
              icon: ArrowDownLeft, color: "text-emerald-400",
            },
            {
              label: "Total Gasto",
              value: `R$ ${(txns.filter(t => t.direction === "debit").reduce((a, t) => a + t.amountCents, 0) / 100).toFixed(2)}`,
              icon: ArrowUpRight, color: "text-rose-400",
            },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="rounded-2xl border border-white/8 bg-black/30 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${s.color}`} />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">{s.label}</span>
                </div>
                <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
              </div>
            );
          })}
        </motion.div>
      )}

      {/* Transaction history */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4 text-muted-foreground/60" />
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">Histórico de Transações</h2>
        </div>

        {txnLoading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : txns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-white/8 rounded-2xl bg-black/20">
            <TrendingUp className="w-10 h-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma transação ainda.</p>
            <p className="text-xs text-muted-foreground/50 mt-1">Adicione saldo para começar.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {txns.map((t, i) => {
              const isCredit = t.direction === "credit";
              return (
                <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="flex items-center gap-4 p-4 rounded-xl border border-white/8 bg-black/20 hover:bg-black/30 transition-colors">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isCredit ? "bg-emerald-500/10" : "bg-rose-500/10"}`}>
                    {isCredit
                      ? <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                      : <ArrowUpRight className="w-4 h-4 text-rose-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.description}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(t.createdAt).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <div className={`text-sm font-bold shrink-0 ${isCredit ? "text-emerald-400" : "text-rose-400"}`}>
                    {isCredit ? "+" : "−"}R$ {t.amountBrl}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Topup modal */}
      <AnimatePresence>
        {topupOpen && (
          <TopupModal
            onClose={() => setTopupOpen(false)}
            onSuccess={() => { setTopupOpen(false); load(); loadAllTxns(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
