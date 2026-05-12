import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, AlertTriangle, CheckCircle2, Loader2, Shield, ShieldAlert,
  MapPin, Briefcase, Users, Scale, DollarSign, FileSearch,
  Clock, ChevronRight, RotateCcw, Download, Scan, Activity,
  User, Calendar, Phone, Mail, Home, Building2, X,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

type Field  = [string, string];
type Section = { name: string; items: string[] };
type ParsedData = { fields: Field[]; sections: Section[]; raw: string };

type ModKey = "identidade" | "mandado" | "dividas" | "processos" | "rais" | "endereco" | "parentes";
type ModStatus = "idle" | "loading" | "done" | "error";
type ModuleState = { status: ModStatus; data?: ParsedData };

const MODULE_META: { key: ModKey; label: string; tipo: string; endpoint: "skylers" | "regular"; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "identidade", label: "Identificação Civil",    tipo: "cpfbasico",  endpoint: "skylers",  icon: User       },
  { key: "mandado",    label: "Mandado de Prisão",      tipo: "mandado",    endpoint: "skylers",  icon: ShieldAlert },
  { key: "dividas",    label: "Dívidas e Restrições",   tipo: "dividas",    endpoint: "skylers",  icon: DollarSign  },
  { key: "processos",  label: "Processos Judiciais",    tipo: "processos",  endpoint: "skylers",  icon: Scale      },
  { key: "rais",       label: "Histórico Profissional", tipo: "rais",       endpoint: "skylers",  icon: Briefcase  },
  { key: "endereco",   label: "Histórico de Endereços", tipo: "endereco",   endpoint: "skylers",  icon: MapPin     },
  { key: "parentes",   label: "Vínculos Familiares",    tipo: "parentes",   endpoint: "regular",  icon: Users      },
];

function emptyModules(): Record<ModKey, ModuleState> {
  return Object.fromEntries(MODULE_META.map(m => [m.key, { status: "idle" }])) as Record<ModKey, ModuleState>;
}

function getField(data: ParsedData | undefined, ...keys: string[]): string {
  if (!data) return "—";
  for (const [k, v] of data.fields) {
    const ku = k.toUpperCase();
    for (const key of keys) if (ku.includes(key.toUpperCase())) return v?.trim() || "—";
  }
  return "—";
}

function hasRisk(data: ParsedData | undefined): boolean {
  if (!data) return false;
  const raw = data.raw.toUpperCase();
  if (raw.includes("NADA CONSTA") || raw.includes("SEM REGISTRO") || raw.includes("NÃO ENCONTRADO")) return false;
  return data.sections.some(s => s.items.length > 0) || data.fields.some(([, v]) => v && v !== "—");
}

function fmtCPF(s: string) {
  const d = s.replace(/\D/g, "");
  if (d.length !== 11) return s;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
}

async function fetchModule(tipo: string, dados: string, endpoint: "skylers" | "regular", token: string): Promise<ParsedData | null> {
  try {
    const url   = endpoint === "skylers" ? "/api/infinity/external/skylers" : `/api/infinity/consultas/${tipo}`;
    const body  = endpoint === "skylers" ? { tipo, dados } : { tipo, dados };
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    const json = await r.json() as { success: boolean; data?: ParsedData };
    return json.success && json.data ? json.data : null;
  } catch { return null; }
}

// ─── Loading Screen ──────────────────────────────────────────────────────────
function LoadingScreen({ cpf, modules }: { cpf: string; modules: Record<ModKey, ModuleState> }) {
  const doneCount = MODULE_META.filter(m => modules[m.key].status === "done" || modules[m.key].status === "error").length;
  const pct = Math.round((doneCount / MODULE_META.length) * 100);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="flex flex-col items-center justify-center min-h-[60vh] gap-8"
    >
      {/* Animated scan ring */}
      <div className="relative flex items-center justify-center">
        <motion.div
          className="w-28 h-28 rounded-full border-2 absolute"
          style={{ borderColor: "color-mix(in srgb, var(--color-primary) 30%, transparent)" }}
          animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="w-20 h-20 rounded-full border-2 absolute"
          style={{ borderColor: "color-mix(in srgb, var(--color-primary) 50%, transparent)" }}
          animate={{ scale: [1, 1.18, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
        />
        <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", border: "2px solid color-mix(in srgb, var(--color-primary) 40%, transparent)" }}>
          <Scan className="w-7 h-7" style={{ color: "var(--color-primary)" }} />
        </div>
      </div>

      {/* Labels */}
      <div className="text-center space-y-2">
        <p className="text-[10px] uppercase tracking-[0.6em] text-muted-foreground/50">Analisando</p>
        <p className="text-2xl font-bold font-mono tracking-wider" style={{ color: "var(--color-primary)" }}>
          {fmtCPF(cpf)}
        </p>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-sm">
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(to right, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, white))" }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
        <p className="text-[9px] text-right text-muted-foreground/30 mt-1 tracking-widest">{pct}%</p>
      </div>

      {/* Module list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-sm">
        {MODULE_META.map((m, i) => {
          const st = modules[m.key].status;
          const Icon = m.icon;
          return (
            <motion.div
              key={m.key}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-colors ${
                st === "done"    ? "border-emerald-400/30 bg-emerald-400/5"
                : st === "error" ? "border-rose-400/20 bg-rose-400/5"
                : st === "loading" ? "border-primary/30 bg-primary/5"
                : "border-white/5 bg-white/[0.02]"
              }`}
            >
              {st === "loading" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: "var(--color-primary)" }} />
              ) : st === "done" ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : st === "error" ? (
                <X className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              ) : (
                <Icon className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
              )}
              <span className={`text-[10px] font-medium truncate ${
                st === "done" ? "text-emerald-300/80"
                : st === "error" ? "text-rose-300/60"
                : st === "loading" ? "text-foreground/70"
                : "text-muted-foreground/30"
              }`}>{m.label}</span>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ─── Identity Hero ────────────────────────────────────────────────────────────
function IdentityHero({ data, cpf, riskLevel, onReset }: {
  data: ParsedData | undefined;
  cpf: string;
  riskLevel: "low" | "medium" | "high";
  onReset: () => void;
}) {
  const nome       = getField(data, "NOME");
  const nasc       = getField(data, "NASC", "DATA NASC", "DT NASC");
  const mae        = getField(data, "MAE", "MÃE", "NOME MAE", "NOME MÃE");
  const situacao   = getField(data, "SITUACAO", "SITUAÇÃO", "STATUS");
  const sexo       = getField(data, "SEXO");
  const rg         = getField(data, "RG", "IDENTIDADE");

  const riskColors = {
    low:    { border: "#22c55e55", bg: "#22c55e08", badge: "#22c55e", label: "PERFIL LIMPO",     icon: Shield },
    medium: { border: "#f59e0b55", bg: "#f59e0b08", badge: "#f59e0b", label: "ATENÇÃO",           icon: AlertTriangle },
    high:   { border: "#ef444455", bg: "#ef444408", badge: "#ef4444", label: "RISCO ELEVADO",     icon: ShieldAlert },
  };
  const rc  = riskColors[riskLevel];
  const RiskIcon = rc.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border backdrop-blur-2xl overflow-hidden"
      style={{ borderColor: rc.border, background: `linear-gradient(135deg, ${rc.bg} 0%, rgba(0,0,0,0.4) 100%)` }}
    >
      <div className="px-5 py-3 border-b flex items-center justify-between flex-wrap gap-2" style={{ borderColor: rc.border }}>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: rc.badge }} />
          <span className="text-[9px] uppercase tracking-[0.5em] text-muted-foreground/60">Hydra Investigação · CPF {fmtCPF(cpf)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-widest" style={{ borderColor: rc.border, background: `${rc.badge}18`, color: rc.badge }}>
            <RiskIcon className="w-2.5 h-2.5" />
            {rc.label}
          </div>
          <button onClick={onReset} className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <RotateCcw className="w-3 h-3" /> Nova
          </button>
        </div>
      </div>

      <div className="px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-8">
          {/* Avatar placeholder */}
          <div className="shrink-0 w-16 h-20 rounded-xl border flex items-center justify-center text-2xl font-bold" style={{ borderColor: rc.border, background: `${rc.badge}10`, color: rc.badge }}>
            {nome.split(" ")[0]?.[0]?.toUpperCase() ?? "?"}
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{nome}</h2>
            <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground/50 mt-0.5 font-mono">
              CPF: {fmtCPF(cpf)}
            </p>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { icon: Calendar, label: "Nascimento", value: nasc },
                { icon: User,     label: "Sexo",       value: sexo },
                { icon: Home,     label: "Situação",   value: situacao },
                { icon: FileSearch,label: "RG",        value: rg },
                { icon: Users,    label: "Nome da Mãe", value: mae, span: true },
              ].map(f => (
                <div key={f.label} className={`min-w-0 ${(f as any).span ? "sm:col-span-2" : ""}`}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <f.icon className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                    <span className="text-[8px] uppercase tracking-widest text-muted-foreground/40">{f.label}</span>
                  </div>
                  <span className="text-sm font-semibold text-foreground/90 truncate block">{f.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Risk Panel ───────────────────────────────────────────────────────────────
function RiskPanel({ mandado, dividas, processos }: { mandado: ModuleState; dividas: ModuleState; processos: ModuleState }) {
  const sections = [
    { key: "mandado",   label: "Mandado de Prisão",    data: mandado,   iconColor: "#ef4444", bgColor: "#ef444415", borderColor: "#ef444435" },
    { key: "dividas",   label: "Dívidas e Restrições", data: dividas,   iconColor: "#f59e0b", bgColor: "#f59e0b10", borderColor: "#f59e0b30" },
    { key: "processos", label: "Processos Judiciais",  data: processos, iconColor: "#a78bfa", bgColor: "#a78bfa10", borderColor: "#a78bfa30" },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
      className="rounded-2xl border border-white/8 bg-black/30 backdrop-blur-2xl overflow-hidden flex flex-col"
    >
      <div className="px-4 py-3.5 border-b border-white/[0.06] flex items-center gap-2">
        <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
        <span className="text-xs font-bold uppercase tracking-[0.25em]">Análise de Risco</span>
      </div>

      <div className="p-4 space-y-3 flex-1">
        {sections.map(sec => {
          const d   = sec.data.data;
          const ok  = sec.data.status === "done";
          const clean = ok && d && !hasRisk(d);
          const items = d ? d.sections.flatMap(s => s.items.slice(0, 3)) : [];
          const fields = d ? d.fields.slice(0, 4) : [];
          const hasContent = items.length > 0 || fields.some(([, v]) => v && v !== "—");

          return (
            <div key={sec.key} className="rounded-xl border p-3 space-y-2 transition-colors" style={{ borderColor: sec.borderColor, background: sec.bgColor }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: sec.iconColor }}>{sec.label}</span>
                {sec.data.status === "loading" ? (
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/40" />
                ) : clean ? (
                  <div className="flex items-center gap-1 text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    <span className="text-[8px] font-bold uppercase tracking-widest">Limpo</span>
                  </div>
                ) : hasContent ? (
                  <AlertTriangle className="w-3.5 h-3.5" style={{ color: sec.iconColor }} />
                ) : null}
              </div>

              {sec.data.status === "loading" && (
                <p className="text-[10px] text-muted-foreground/30 animate-pulse">Consultando...</p>
              )}
              {sec.data.status === "error" && (
                <p className="text-[10px] text-rose-400/50">Sem retorno</p>
              )}
              {ok && clean && (
                <p className="text-[10px] text-emerald-400/60">Nada consta nesta base.</p>
              )}
              {ok && !clean && hasContent && (
                <ul className="space-y-1">
                  {[...fields.filter(([,v]) => v && v !== "—").map(([k,v]) => `${k}: ${v}`), ...items].slice(0, 5).map((item, i) => (
                    <li key={i} className="text-[10px] text-foreground/70 leading-relaxed pl-2 border-l border-current/20 truncate" style={{ borderColor: sec.iconColor + "40" }}>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {ok && !clean && !hasContent && d && (
                <p className="text-[10px] text-muted-foreground/40 italic">Dados retornados — verifique na consulta completa.</p>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ─── Family Panel ─────────────────────────────────────────────────────────────
function FamilyPanel({ parentes }: { parentes: ModuleState }) {
  const data = parentes.data;

  type Pessoa = { nome: string; cpf: string; relacao: string; nasc: string };
  const pessoas: Pessoa[] = [];
  if (data) {
    for (const sec of data.sections) {
      for (const item of sec.items) {
        const parts = item.split(/\u23AF|·|\|/).map(p => p.trim());
        const entry: Partial<Pessoa> = { relacao: sec.name };
        for (const p of parts) {
          if (/^\d{11}$/.test(p.replace(/\D/g, "")) && p.replace(/\D/g,"").length === 11) entry.cpf = p.replace(/\D/g,"");
          else if (/\d{2}\/\d{2}\/\d{4}/.test(p)) entry.nasc = p;
          else if (p.length > 3 && !/^\d/.test(p)) entry.nome = p;
        }
        if (entry.nome) pessoas.push({ nome: entry.nome, cpf: entry.cpf ?? "", relacao: entry.relacao ?? sec.name, nasc: entry.nasc ?? "—" });
      }
    }
    if (pessoas.length === 0 && data.fields.length > 0) {
      for (const [k, v] of data.fields) {
        if (v && v !== "—") pessoas.push({ nome: v, cpf: "", relacao: k, nasc: "—" });
        if (pessoas.length >= 10) break;
      }
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
      className="rounded-2xl border border-white/8 bg-black/30 backdrop-blur-2xl overflow-hidden flex flex-col"
    >
      <div className="px-4 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5" style={{ color: "var(--color-primary)" }} />
          <span className="text-xs font-bold uppercase tracking-[0.25em]">Rede Familiar</span>
        </div>
        {pessoas.length > 0 && (
          <span className="text-[9px] text-muted-foreground/40 uppercase tracking-widest">{pessoas.length} vínculos</span>
        )}
      </div>

      <div className="p-4 flex-1 overflow-y-auto max-h-72">
        {parentes.status === "loading" ? (
          <div className="flex items-center gap-2 text-muted-foreground/30 text-xs py-4 animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando parentes...
          </div>
        ) : parentes.status === "error" || pessoas.length === 0 ? (
          <div className="text-center py-6">
            <Users className="w-8 h-8 text-muted-foreground/15 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground/30">Sem vínculos encontrados</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pessoas.slice(0, 12).map((p, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 + i * 0.04 }}
                className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.04] transition-colors group"
              >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold text-black" style={{ background: "var(--color-primary)" }}>
                  {p.nome[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-foreground/80 truncate leading-none">{p.nome}</p>
                  <p className="text-[9px] text-muted-foreground/40 mt-0.5 truncate">{p.relacao}{p.nasc !== "—" ? ` · ${p.nasc}` : ""}</p>
                </div>
                {p.cpf && (
                  <Link href={`/investigacao?cpf=${p.cpf}`}>
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-primary" title="Investigar este CPF">
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </Link>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Timeline Panel ───────────────────────────────────────────────────────────
function TimelinePanel({ rais, endereco }: { rais: ModuleState; endereco: ModuleState }) {
  type TLItem = { label: string; sub: string; date: string; type: "work" | "address" };
  const items: TLItem[] = [];

  if (rais.data) {
    for (const sec of rais.data.sections) {
      for (const item of sec.items.slice(0, 6)) {
        items.push({ label: item.split(/\u23AF|\||·/)[0]?.trim() ?? item, sub: "Emprego", date: "", type: "work" });
      }
    }
    for (const [k, v] of rais.data.fields.slice(0, 8)) {
      if (v && v !== "—") items.push({ label: v, sub: k, date: "", type: "work" });
    }
  }

  if (endereco.data) {
    for (const sec of endereco.data.sections) {
      for (const item of sec.items.slice(0, 6)) {
        items.push({ label: item.split(/\u23AF|\||·/)[0]?.trim() ?? item, sub: "Endereço", date: "", type: "address" });
      }
    }
    for (const [k, v] of endereco.data.fields.slice(0, 6)) {
      if (v && v !== "—") items.push({ label: v, sub: k, date: "", type: "address" });
    }
  }

  const workItems = items.filter(i => i.type === "work").slice(0, 8);
  const addressItems = items.filter(i => i.type === "address").slice(0, 8);

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}
      className="rounded-2xl border border-white/8 bg-black/30 backdrop-blur-2xl overflow-hidden flex flex-col"
    >
      <div className="px-4 py-3.5 border-b border-white/[0.06] flex items-center gap-2">
        <Clock className="w-3.5 h-3.5" style={{ color: "var(--color-primary)" }} />
        <span className="text-xs font-bold uppercase tracking-[0.25em]">Linha do Tempo</span>
      </div>

      <div className="p-4 flex-1 overflow-y-auto max-h-72 space-y-4">
        {/* Empregos */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Briefcase className="w-3 h-3 text-sky-400" />
            <span className="text-[9px] uppercase tracking-[0.4em] text-sky-400/70 font-semibold">
              Empregos (RAIS) {rais.status === "loading" ? "· carregando..." : ""}
            </span>
          </div>
          {rais.status === "loading" && <p className="text-[10px] text-muted-foreground/30 animate-pulse pl-4">Consultando...</p>}
          {rais.status !== "loading" && workItems.length === 0 && (
            <p className="text-[10px] text-muted-foreground/30 pl-4">Sem registros</p>
          )}
          <div className="relative space-y-2 pl-4">
            {workItems.length > 0 && <div className="absolute left-[6px] top-0 bottom-0 w-px bg-sky-400/20" />}
            {workItems.map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.04 }}
                className="relative"
              >
                <div className="absolute -left-[10px] top-1.5 w-2.5 h-2.5 rounded-full border border-sky-400/40 bg-sky-400/20" />
                <p className="text-[10px] font-medium text-foreground/70 leading-tight truncate">{item.label}</p>
                <p className="text-[8px] text-muted-foreground/35 uppercase tracking-wide">{item.sub}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Endereços */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <MapPin className="w-3 h-3 text-violet-400" />
            <span className="text-[9px] uppercase tracking-[0.4em] text-violet-400/70 font-semibold">
              Endereços {endereco.status === "loading" ? "· carregando..." : ""}
            </span>
          </div>
          {endereco.status === "loading" && <p className="text-[10px] text-muted-foreground/30 animate-pulse pl-4">Consultando...</p>}
          {endereco.status !== "loading" && addressItems.length === 0 && (
            <p className="text-[10px] text-muted-foreground/30 pl-4">Sem registros</p>
          )}
          <div className="relative space-y-2 pl-4">
            {addressItems.length > 0 && <div className="absolute left-[6px] top-0 bottom-0 w-px bg-violet-400/20" />}
            {addressItems.map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.14 + i * 0.04 }}
                className="relative"
              >
                <div className="absolute -left-[10px] top-1.5 w-2.5 h-2.5 rounded-full border border-violet-400/40 bg-violet-400/20" />
                <p className="text-[10px] font-medium text-foreground/70 leading-tight truncate">{item.label}</p>
                <p className="text-[8px] text-muted-foreground/35 uppercase tracking-wide">{item.sub}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Entry Form ───────────────────────────────────────────────────────────────
function EntryForm({ onStart }: { onStart: (cpf: string) => void }) {
  const [cpf, setCpf] = useState("");
  const formatted = cpf.replace(/\D/g,"");
  const valid = formatted.length === 11;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8 text-center">
      {/* Decorative rings */}
      <div className="relative flex items-center justify-center">
        {[80, 120, 164].map((size, i) => (
          <motion.div key={size}
            className="absolute rounded-full border"
            style={{ width: size, height: size, borderColor: `color-mix(in srgb, var(--color-primary) ${30 - i * 8}%, transparent)` }}
            animate={{ rotate: i % 2 === 0 ? 360 : -360 }}
            transition={{ duration: 16 + i * 8, repeat: Infinity, ease: "linear" }}
          />
        ))}
        <div className="w-16 h-16 rounded-full flex items-center justify-center relative z-10" style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", border: "2px solid color-mix(in srgb, var(--color-primary) 40%, transparent)" }}>
          <Search className="w-7 h-7" style={{ color: "var(--color-primary)" }} />
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-widest uppercase" style={{ background: "linear-gradient(to right, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, white))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Modo Investigação
        </h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
          Análise completa e visual de um CPF — identidade, risco, família e histórico em uma tela unificada.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        <input
          value={cpf}
          onChange={e => setCpf(e.target.value.replace(/\D/g,"").slice(0,11))}
          placeholder="CPF — 11 dígitos"
          inputMode="numeric"
          className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-center text-lg font-mono focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all placeholder-muted-foreground/20 tracking-widest"
          onKeyDown={e => { if (e.key === "Enter" && valid) onStart(formatted); }}
        />
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={() => valid && onStart(formatted)}
          disabled={!valid}
          className="w-full py-4 rounded-2xl font-bold text-black text-sm uppercase tracking-[0.35em] disabled:opacity-30 transition-all flex items-center justify-center gap-3"
          style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, white))", boxShadow: valid ? "0 0 40px -8px color-mix(in srgb, var(--color-primary) 60%, transparent)" : "none" }}
        >
          <Activity className="w-4 h-4" />
          Iniciar Investigação
        </motion.button>
      </div>

      <div className="flex flex-wrap justify-center gap-3 text-[9px] uppercase tracking-[0.4em] text-muted-foreground/35">
        {["Identidade", "Mandado", "Dívidas", "Processos", "RAIS", "Endereços", "Família"].map(m => (
          <span key={m} className="px-2 py-1 rounded-full border border-white/5 bg-white/[0.02]">{m}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Investigacao() {
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const [cpf, setCpfState] = useState("");
  const [modules, setModules] = useState<Record<ModKey, ModuleState>>(emptyModules());

  const updateModule = useCallback((key: ModKey, state: Partial<ModuleState>) => {
    setModules(prev => ({ ...prev, [key]: { ...prev[key], ...state } }));
  }, []);

  const startInvestigation = useCallback(async (cpfVal: string) => {
    setCpfState(cpfVal);
    setModules(emptyModules());
    setPhase("loading");

    const token = localStorage.getItem("infinity_token") ?? "";

    await Promise.allSettled(MODULE_META.map(async (m) => {
      updateModule(m.key, { status: "loading" });
      const data = await fetchModule(m.tipo, cpfVal, m.endpoint, token);
      updateModule(m.key, { status: data ? "done" : "error", data: data ?? undefined });
    }));

    setPhase("done");
    toast.success("Investigação concluída");
  }, [updateModule]);

  const riskLevel = (): "low" | "medium" | "high" => {
    if (modules.mandado.status === "done" && hasRisk(modules.mandado.data)) return "high";
    if ((modules.dividas.status === "done" && hasRisk(modules.dividas.data)) || (modules.processos.status === "done" && hasRisk(modules.processos.data))) return "medium";
    return "low";
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header — always visible */}
      {phase !== "idle" && (
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
              className="text-2xl sm:text-3xl font-bold tracking-[0.25em] uppercase bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(to right, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, white))" }}
            >
              Investigação
            </motion.h1>
            <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-1">
              CPF {fmtCPF(cpf)} · {MODULE_META.length} módulos
            </p>
          </div>
          <button
            onClick={() => { setPhase("idle"); setCpfState(""); setModules(emptyModules()); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-xl"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Nova investigação
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {phase === "idle" && (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -8 }}>
            <EntryForm onStart={startInvestigation} />
          </motion.div>
        )}

        {phase === "loading" && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <LoadingScreen cpf={cpf} modules={modules} />
          </motion.div>
        )}

        {phase === "done" && (
          <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
            {/* Identity hero */}
            <IdentityHero
              data={modules.identidade.data}
              cpf={cpf}
              riskLevel={riskLevel()}
              onReset={() => { setPhase("idle"); setCpfState(""); setModules(emptyModules()); }}
            />

            {/* 3-col grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <RiskPanel mandado={modules.mandado} dividas={modules.dividas} processos={modules.processos} />
              <FamilyPanel parentes={modules.parentes} />
              <TimelinePanel rais={modules.rais} endereco={modules.endereco} />
            </div>

            {/* Investigar parentes CTA */}
            {modules.parentes.status === "done" && modules.parentes.data && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-3"
              >
                <Users className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                <p className="text-xs text-muted-foreground/60 flex-1">
                  Clique no ícone <ChevronRight className="inline w-3 h-3" /> ao lado de um parente para investigar o CPF dele.
                </p>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
