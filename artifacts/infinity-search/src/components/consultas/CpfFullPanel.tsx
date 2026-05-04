import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Phone, MapPin, Users, Briefcase, IdCard,
  Wallet, BarChart2, FileText, Car, CheckCircle2, XCircle,
  Loader2, MessageCircle, Scale, Building2, Award, Gift,
  AlertTriangle, Receipt, Star, ChevronDown, ChevronUp,
} from "lucide-react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

type ModuleStatus = "idle" | "loading" | "done" | "error";

type ParsedData = {
  fields: [string, string][];
  sections: { name: string; items: string[] }[];
  raw: string;
};

type ModuleResult = {
  status: ModuleStatus;
  data?: ParsedData;
  error?: string;
};

type Identity = {
  nome: string; cpf: string; rg: string; mae: string; pai: string;
  naturalidade: string; nacionalidade: string; dataNascimento: string;
  sexo: string; estadoCivil: string; orgaoEmissor: string; dataEmissao: string;
  situacaoCadastral: string; tipoSanguineo: string;
};
type PhoneEntry  = { ddd: string; numero: string; prioridade: string; classificacao: string; data: string };
type Address     = { logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string; lat?: number; lng?: number };
type Relation    = { cpf: string; relacao: string; nome: string; nascimento: string; sexo: string; grau: string; grauOficial: string; origem: string };
type Employment  = { empresa: string; cnpj: string; cargo: string; admissao: string; demissao: string; salario: string };

const MODULES = [
  { tipo: "cpf",        label: "CPF",           skylers: false },
  { tipo: "cpfbasico",  label: "CPF Básico",     skylers: true  },
  { tipo: "foto",       label: "Foto",           skylers: true  },
  { tipo: "parentes",   label: "Parentes",       skylers: false },
  { tipo: "empregos",   label: "Empregos",       skylers: false },
  { tipo: "cnh",        label: "CNH",            skylers: false },
  { tipo: "obito",      label: "Óbito",          skylers: false },
  { tipo: "score",      label: "Score",          skylers: true  },
  { tipo: "score2",     label: "Score 2",        skylers: true  },
  { tipo: "irpf",       label: "IRPF",           skylers: true  },
  { tipo: "beneficios", label: "Benefícios",     skylers: true  },
  { tipo: "mandado",    label: "Mandados",       skylers: true  },
  { tipo: "dividas",    label: "Dívidas",        skylers: true  },
  { tipo: "bens",       label: "Bens",           skylers: true  },
  { tipo: "processos",  label: "Processos",      skylers: true  },
  { tipo: "spc",        label: "SPC",            skylers: true  },
  { tipo: "titulo",     label: "Título Eleitor", skylers: true  },
];

function normalizeFields(raw: unknown): [string, string][] {
  if (!Array.isArray(raw)) return [];
  if (raw.length === 0) return [];
  const first = raw[0];
  if (Array.isArray(first)) return raw as [string, string][];
  if (typeof first === "object" && first !== null && "key" in first) {
    return (raw as { key: string; value: string }[]).map(f => [f.key ?? "", f.value ?? ""] as [string, string]);
  }
  return [];
}

function gf(fields: [string, string][], ...keys: string[]): string {
  for (const key of keys) {
    const k = key.toUpperCase();
    const f = fields.find(([fk]) => fk.toUpperCase() === k || fk.toUpperCase().includes(k));
    if (f?.[1]?.trim()) return f[1].trim();
  }
  return "";
}

function rxv(raw: string, key: string): string {
  const m = new RegExp(String.raw`${key}[\s:]+([^\n|·]+)`, "i").exec(raw);
  return m?.[1]?.trim() ?? "";
}

async function fetchModule(tipo: string, dados: string, skylers: boolean): Promise<ModuleResult> {
  const token = localStorage.getItem("infinity_token");
  try {
    const endpoint = skylers ? "/api/infinity/external/skylers" : `/api/infinity/consultas/${tipo}`;
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tipo, dados }),
    });
    const json = await r.json() as { success: boolean; data?: unknown; error?: string };
    if (!json.success) return { status: "error", error: json.error ?? "Sem resultado" };
    let parsed: ParsedData;
    if (typeof json.data === "string") {
      parsed = { fields: [], sections: [], raw: json.data };
    } else if (json.data && typeof json.data === "object") {
      const d = json.data as Record<string, unknown>;
      parsed = {
        fields:   normalizeFields(d["fields"]),
        sections: Array.isArray(d["sections"]) ? d["sections"] as ParsedData["sections"] : [],
        raw:      typeof d["raw"] === "string" ? d["raw"] : "",
      };
    } else {
      return { status: "error" };
    }
    return { status: "done", data: parsed };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Erro de rede" };
  }
}

function buildIdentity(r1?: ModuleResult, r2?: ModuleResult): Identity {
  const f = [...(r1?.data?.fields ?? []), ...(r2?.data?.fields ?? [])];
  const raw = (r1?.data?.raw ?? "") + (r2?.data?.raw ?? "");
  return {
    nome:              gf(f,"NOME","NOME COMPLETO")                          || rxv(raw,"NOME"),
    cpf:               gf(f,"CPF","NUMERO CPF")                              || rxv(raw,"CPF"),
    rg:                gf(f,"RG","NUMERO RG","REGISTRO GERAL")               || rxv(raw,"RG"),
    mae:               gf(f,"NOME MÃE","NOME MAE","MAE")                    || rxv(raw,"MAE"),
    pai:               gf(f,"NOME PAI","PAI")                               || rxv(raw,"PAI"),
    naturalidade:      gf(f,"MUNICIPIO DE NASCIMENTO","MUNICÍPIO DE NASCIMENTO","NATURALIDADE") || rxv(raw,"NATURALIDADE"),
    nacionalidade:     gf(f,"NACIONALIDADE","PAIS NASCIMENTO")              || "BRASIL",
    dataNascimento:    gf(f,"DATA NASCIMENTO","DT NASCIMENTO","NASCIMENTO")  || rxv(raw,"NASCIMENTO"),
    sexo:              gf(f,"SEXO","GENERO","GÊNERO")                        || rxv(raw,"SEXO"),
    estadoCivil:       gf(f,"ESTADO CIVIL","ESTADO_CIVIL")                  || rxv(raw,"ESTADO CIVIL"),
    orgaoEmissor:      gf(f,"ORGAO EMISSOR","ÓRGÃO EMISSOR","ORGAO_EMISSOR") || rxv(raw,"ORGAO"),
    dataEmissao:       gf(f,"DATA EMISSAO","DATA EMISSÃO")                  || rxv(raw,"EMISSAO"),
    situacaoCadastral: gf(f,"SITUACAO CADASTRAL","SITUAÇÃO CADASTRAL","STATUS NA RECEITA","STATUS") || rxv(raw,"SITUACAO"),
    tipoSanguineo:     gf(f,"TIPO SANGUINEO","TIPO SANGÚINEO","SANGUE")     || rxv(raw,"SANGUE"),
  };
}

function buildPhones(r?: ModuleResult): PhoneEntry[] {
  if (!r?.data) return [];
  const phones: PhoneEntry[] = [];
  for (const sec of r.data.sections) {
    if (/TELEFON|CONTATO|CELULAR|FONE/i.test(sec.name)) {
      for (const item of sec.items) {
        const ddd  = item.match(/DDD[\s:]+(\d{1,3})/i)?.[1]   ?? item.match(/^\s*(\d{2})\s/)?.[1] ?? "";
        const num  = item.match(/(?:NUMERO|TELEFONE|CELULAR|NUM)[\s:]+(\d{7,11})/i)?.[1] ?? item.match(/\d{2}\s+(\d{8,9})/)?.[1] ?? "";
        const prio = item.match(/PRIORIDADE[\s:]+([^\s|·]+)/i)?.[1] ?? "";
        const cls  = item.match(/CLASSIFICA[CÇ][AÃ]O[\s:]+([^\s|·]+)/i)?.[1] ?? "";
        const data = item.match(/DATA[\s:]+(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? "Não Informado";
        if (num) phones.push({ ddd, numero: num, prioridade: prio, classificacao: cls, data });
      }
    }
  }
  for (const [k, v] of r.data.fields) {
    if (/TELEFON|CELULAR/i.test(k) && /\d{7,}/.test(v)) {
      const clean = v.replace(/\D/g,"");
      const ddd   = clean.length >= 10 ? clean.slice(0,2) : "";
      const num   = clean.length >= 10 ? clean.slice(2)   : clean;
      if (num && !phones.some(p => p.numero === num))
        phones.push({ ddd, numero: num, prioridade: "", classificacao: "", data: "Não Informado" });
    }
  }
  return phones;
}

function buildAddresses(r?: ModuleResult): Address[] {
  if (!r?.data) return [];
  const out: Address[] = [];
  for (const sec of r.data.sections) {
    if (/ENDEREC|LOGRADOURO|ENDERE/i.test(sec.name)) {
      for (const item of sec.items) {
        out.push({
          logradouro:  item.match(/(?:LOGRADOURO|ENDERECO)[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
          numero:      item.match(/(?:NUMERO|N[º°])[\s:]+([^|·\n\s]+)/i)?.[1]?.trim() ?? "",
          complemento: item.match(/(?:COMPLEMENTO|COMPL)[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "Não Informado",
          bairro:      item.match(/BAIRRO[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
          cidade:      item.match(/CIDADE[\s:]+([^|·\n\-]+)/i)?.[1]?.trim() ?? "",
          uf:          item.match(/(?:\bUF\b|ESTADO)[\s:]+([A-Z]{2})/i)?.[1]?.trim() ?? "",
          cep:         item.match(/CEP[\s:]+(\d{5}-?\d{3}|\d{8})/i)?.[1]?.trim() ?? "",
        });
      }
    }
  }
  if (out.length === 0) {
    const f = r.data.fields;
    const logradouro = gf(f,"LOGRADOURO","ENDERECO","RUA","ENDERECO COMPLETO");
    if (logradouro) out.push({
      logradouro,
      numero:      gf(f,"NUMERO","NÚMERO","NUM"),
      complemento: gf(f,"COMPLEMENTO","COMPL") || "Não Informado",
      bairro:      gf(f,"BAIRRO"),
      cidade:      gf(f,"CIDADE","MUNICIPIO","MUNICÍPIO"),
      uf:          gf(f,"UF","ESTADO"),
      cep:         gf(f,"CEP"),
    });
  }
  return out;
}

function buildRelations(r?: ModuleResult): Relation[] {
  if (!r?.data) return [];
  const out: Relation[] = [];
  for (const sec of r.data.sections) {
    for (const item of sec.items) {
      const cpf       = item.match(/CPF[\s:]+(\d{11})/i)?.[1] ?? "";
      const relacao   = item.match(/RELAC[AÃ]O[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? sec.name ?? "";
      const nome      = item.match(/NOME[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "";
      const nascimento= item.match(/(?:NASC|NASCIMENTO|DATA NASC)[\s:]+(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? "";
      const sexo      = item.match(/SEXO[\s:]+([^|·\n\s]+)/i)?.[1] ?? "";
      const grau      = item.match(/\bGRAU\b[\s:]+([^|·\n\s]+)/i)?.[1] ?? "";
      const grauOfc   = item.match(/GRAU OFICIAL[\s:]+([^|·\n\s]+)/i)?.[1] ?? "";
      const origem    = item.match(/ORIGEM[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "";
      if (nome || cpf) out.push({ cpf, relacao, nome, nascimento, sexo, grau, grauOficial: grauOfc, origem });
    }
  }
  return out;
}

function buildEmployments(r?: ModuleResult): Employment[] {
  if (!r?.data) return [];
  const out: Employment[] = [];
  for (const sec of r.data.sections) {
    for (const item of sec.items) {
      out.push({
        empresa:  item.match(/(?:EMPRESA|RAZAO|EMPREGADOR)[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
        cnpj:     item.match(/CNPJ[\s:]+(\d+)/i)?.[1] ?? "",
        cargo:    item.match(/(?:CARGO|FUNCAO|FUNÇÃO)[\s:]+([^|·\n]+)/i)?.[1]?.trim() ?? "",
        admissao: item.match(/(?:ADMISSAO|ADMISSÃO|ENTRADA|INICIO)[\s:]+(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? "",
        demissao: item.match(/(?:DEMISSAO|DEMISSÃO|SAIDA)[\s:]+(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? "",
        salario:  item.match(/(?:SALARIO|SALÁRIO|REMUNER)[\s:]+([^\s|·\n]+)/i)?.[1] ?? "",
      });
    }
  }
  return out;
}

function fmtCPF(c: string) {
  const d = c.replace(/\D/g,"");
  return d.length === 11 ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}` : c;
}

function SectionHeader({ icon: Icon, title, count }: { icon: React.ComponentType<{className?:string}>; title: string; count?: number }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2.5">
        <Icon className="w-5 h-5" style={{ color: "var(--color-primary)" }} />
        <h2 className="text-xl font-bold text-white">
          {title}
          {count !== undefined && (
            <span className="text-base font-normal ml-1.5" style={{ color: "color-mix(in srgb, var(--color-primary) 55%, transparent)" }}>
              ({count})
            </span>
          )}
        </h2>
      </div>
      <div className="h-px mt-2.5" style={{ background: "linear-gradient(to right, var(--color-primary), transparent)" }} />
    </div>
  );
}

function IdentityCard({ id, photo }: { id: Identity; photo?: string }) {
  const uf = id.orgaoEmissor.match(/\b([A-Z]{2})$/)?.[1] ?? "";
  const F = ({ label, value }: { label: string; value: string }) => (
    <div>
      <p className="text-[8px] uppercase tracking-[0.22em] text-white/35 font-semibold mb-0.5">{label}</p>
      <p className="text-[13px] font-bold text-white leading-tight">{value || "Não Informado"}</p>
      <div className="h-px bg-white/5 mt-2" />
    </div>
  );
  const photoSrc = photo
    ? photo.startsWith("data:") ? photo : photo.startsWith("http") ? photo : `data:image/jpeg;base64,${photo}`
    : null;

  return (
    <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/60">
      <div className="relative px-8 py-7 text-center overflow-hidden" style={{ background: "linear-gradient(135deg, #5b21b6 0%, #4338ca 50%, #6d28d9 100%)" }}>
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 15% 50%, #fff 1.5px, transparent 1.5px), radial-gradient(circle at 85% 20%, #fff 1.5px, transparent 1.5px)", backgroundSize: "55px 55px" }} />
        <div className="relative z-10">
          <div className="text-2xl mb-2">🇧🇷</div>
          <p className="text-[10px] font-extrabold tracking-[0.28em] text-white/95">REPÚBLICA FEDERATIVA DO BRASIL</p>
          {uf && <p className="text-[9px] tracking-[0.18em] text-white/65 mt-0.5">ESTADO DE {uf}</p>}
          <p className="text-[8.5px] tracking-[0.14em] text-white/55 mt-0.5">SECRETARIA DE SEGURANÇA PÚBLICA - SSP</p>
          <p className="text-[15px] font-black tracking-[0.38em] text-white mt-2.5">CARTEIRA DE IDENTIDADE</p>
          <span className="inline-block mt-2 text-[8.5px] bg-white/20 backdrop-blur rounded-full px-3 py-0.5 text-white/85 border border-white/20">1ª Via</span>
        </div>
      </div>

      <div className="bg-[#0c0e1c] p-6 sm:p-8">
        <div className="text-center mb-7">
          <p className="text-[9px] uppercase tracking-[0.32em] text-white/35">Registro Geral Nº</p>
          <p className="text-[32px] font-black tracking-[0.15em] text-white mt-1.5 leading-none">{id.rg || "—"}</p>
        </div>
        <div className="h-px bg-white/8 mb-7" />

        <div className="flex gap-6">
          <div className="flex-1 space-y-3.5 min-w-0">
            <F label="Nome" value={id.nome} />
            <F label="Filiação" value={[id.mae, id.pai].filter(Boolean).join("  /  ") || "Não Informado"} />
            <div className="grid grid-cols-2 gap-4">
              <F label="Naturalidade" value={id.naturalidade} />
              <F label="Nacionalidade" value={id.nacionalidade || "BRASIL"} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <F label="Data de Nascimento" value={id.dataNascimento} />
              <F label="Sexo" value={id.sexo} />
              <F label="Estado Civil" value={id.estadoCivil} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="CPF" value={fmtCPF(id.cpf)} />
              <F label="Situação Cadastral" value={id.situacaoCadastral} />
            </div>
            <F label="Órgão Emissor / UF" value={id.orgaoEmissor} />
            <div className="grid grid-cols-3 gap-3">
              <F label="Data de Emissão" value={id.dataEmissao} />
              <F label="Data Identificação" value={id.dataEmissao} />
              <F label="Última Emissão" value={id.dataEmissao} />
            </div>
          </div>

          <div className="shrink-0 hidden sm:flex flex-col items-center gap-2">
            <div className="w-28 h-36 rounded-xl overflow-hidden border border-white/15 bg-white/5 flex items-center justify-center">
              {photoSrc
                ? <img src={photoSrc} alt="Foto" className="w-full h-full object-cover" />
                : <User className="w-12 h-12 text-white/15" />
              }
            </div>
            <p className="text-[8px] uppercase tracking-[0.22em] text-white/25">Foto do Titular</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CollapsibleSection({ title, icon: Icon, count, children }: { title: string; icon: React.ComponentType<{className?:string}>; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-5">
        <button onClick={() => setOpen(v => !v)} className="flex items-center gap-2.5 w-full text-left group">
          <Icon className="w-5 h-5" style={{ color: "var(--color-primary)" }} />
          <span className="text-xl font-bold text-white">
            {title}
            {count !== undefined && (
              <span className="text-base font-normal ml-1.5" style={{ color: "color-mix(in srgb, var(--color-primary) 55%, transparent)" }}>
                ({count})
              </span>
            )}
          </span>
          <span className="ml-auto text-white/30 group-hover:text-white/60 transition-colors">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </button>
        <div className="h-px mt-2.5" style={{ background: "linear-gradient(to right, var(--color-primary), transparent)" }} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="content" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

type Props = { cpf: string };

export function CpfFullPanel({ cpf }: Props) {
  const [running, setRunning]   = useState(false);
  const [done, setDone]         = useState(false);
  const [mStates, setMStates]   = useState<Record<string, ModuleStatus>>({});
  const [mResults, setMResults] = useState<Record<string, ModuleResult>>({});
  const [geoAddr, setGeoAddr]   = useState<Address[]>([]);
  const runRef = useRef(0);

  useEffect(() => {
    const clean = cpf.replace(/\D/g,"");
    if (clean.length !== 11) return;

    const id = ++runRef.current;
    setRunning(true); setDone(false);
    setMStates(Object.fromEntries(MODULES.map(m => [m.tipo, "loading"])));
    setMResults({});
    setGeoAddr([]);

    void Promise.allSettled(
      MODULES.map(async ({ tipo, skylers }) => {
        const res = await fetchModule(tipo, clean, skylers);
        if (runRef.current !== id) return;
        setMStates(p => ({ ...p, [tipo]: res.status }));
        setMResults(p => ({ ...p, [tipo]: res }));
      })
    ).then(() => {
      if (runRef.current === id) { setRunning(false); setDone(true); }
    });

    return () => { runRef.current = id + 1; };
  }, [cpf]);

  useEffect(() => {
    if (!done) return;
    const addrs = buildAddresses(mResults["cpf"]);
    if (!addrs.length) { setGeoAddr([]); return; }
    let cancelled = false;
    (async () => {
      const result: Address[] = [];
      for (const addr of addrs.slice(0, 8)) {
        if (cancelled) break;
        const q = [addr.logradouro, addr.numero, addr.bairro, addr.cidade, addr.uf, "Brasil"].filter(Boolean).join(", ");
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`, { headers: { "Accept-Language": "pt-BR" } });
          const data = await r.json() as { lat: string; lon: string }[];
          result.push(data[0] ? { ...addr, lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : addr);
        } catch { result.push(addr); }
        await new Promise(res => setTimeout(res, 350));
      }
      if (!cancelled) setGeoAddr(result);
    })();
    return () => { cancelled = true; };
  }, [done, mResults]);

  const identity    = buildIdentity(mResults["cpf"], mResults["cpfbasico"]);
  const phones      = buildPhones(mResults["cpf"]);
  const relations   = buildRelations(mResults["parentes"]);
  const addresses   = buildAddresses(mResults["cpf"]);
  const employments = buildEmployments(mResults["empregos"]);

  const photoRaw  = mResults["foto"]?.data;
  const photo     = photoRaw
    ? (photoRaw.fields.find(([k]) => /FOTO|URL|BASE64|IMG/i.test(k))?.[1] ?? (photoRaw.raw.length < 200000 ? photoRaw.raw : ""))
    : undefined;

  const score1    = gf(mResults["score"]?.data?.fields ?? [],  "SCORE","PONTUACAO","PONTUAÇÃO") || (mResults["score"]?.data?.raw?.match(/\d{3,4}/)?.[0] ?? "");
  const score2Val = gf(mResults["score2"]?.data?.fields ?? [], "SCORE","PONTUACAO","PONTUAÇÃO") || (mResults["score2"]?.data?.raw?.match(/\d{3,4}/)?.[0] ?? "");

  const doneCount = MODULES.filter(m => mStates[m.tipo] === "done").length;
  const geocoded  = geoAddr.filter(a => a.lat && a.lng);
  const center: [number,number] = geocoded[0] ? [geocoded[0].lat!, geocoded[0].lng!] : [-14.235, -51.925];

  const hasIdentity = !!(identity.nome || identity.cpf || identity.rg);
  const hasCNH      = mResults["cnh"]?.status === "done" && (mResults["cnh"]?.data?.fields.length ?? 0) > 0;
  const hasObito    = mResults["obito"]?.status === "done" && (mResults["obito"]?.data?.fields.length ?? 0) > 0;
  const hasLegal    = ["processos","mandado"].some(k => mResults[k]?.status === "done" && (mResults[k]?.data?.sections?.length ?? 0) > 0);
  const extras      = (["irpf","beneficios","dividas","bens","titulo","spc"] as const).filter(k =>
    mResults[k]?.status === "done" && mResults[k]?.data &&
    ((mResults[k]!.data!.fields.length > 0) || (mResults[k]!.data!.sections.length > 0))
  );

  const extraLabels: Record<string, { label: string; icon: React.ComponentType<{className?:string}> }> = {
    irpf:      { label: "IRPF",                icon: Receipt },
    beneficios:{ label: "Benefícios Sociais",  icon: Gift },
    dividas:   { label: "Dívidas",             icon: Wallet },
    bens:      { label: "Bens",                icon: Building2 },
    titulo:    { label: "Título de Eleitor",   icon: Award },
    spc:       { label: "SPC / Negativação",   icon: AlertTriangle },
  };

  const noData = done && !hasIdentity && !phones.length && !relations.length && !addresses.length;

  return (
    <div className="mt-6 space-y-8">
      {/* Progress */}
      <AnimatePresence>
        {(running || done) && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                {running ? "Consultando módulos..." : `Concluído — ${doneCount}/${MODULES.length} módulos com dados`}
              </span>
              {running && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
            </div>
            <div className="h-1 bg-white/5 rounded-full mb-4 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: "var(--color-primary)" }}
                animate={{ width: `${(doneCount / MODULES.length) * 100}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-1.5">
              {MODULES.map(m => {
                const s = mStates[m.tipo] ?? "idle";
                return (
                  <div key={m.tipo} className="flex items-center gap-1.5 text-[10px] truncate">
                    {s === "loading" && <Loader2 className="w-3 h-3 animate-spin shrink-0 text-primary" />}
                    {s === "done"    && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                    {s === "error"   && <XCircle className="w-3 h-3 text-red-400/50 shrink-0" />}
                    {s === "idle"    && <div className="w-3 h-3 rounded-full bg-white/10 shrink-0" />}
                    <span className={s === "done" ? "text-white/70" : s === "error" ? "text-white/20" : "text-white/40"} title={m.label}>{m.label}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <AnimatePresence>
        {done && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="space-y-10">

            {/* Carteira de Identidade */}
            {hasIdentity && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <SectionHeader icon={IdCard} title="Carteira de Identidade" />
                <IdentityCard id={identity} photo={photo} />
              </motion.div>
            )}

            {/* Telefones */}
            {phones.length > 0 && (
              <CollapsibleSection icon={Phone} title="Telefones" count={phones.length}>
                <div className="rounded-2xl border border-white/10 bg-[#0c0e1c] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead>
                        <tr className="border-b border-white/10 bg-black/25">
                          {[["📞","DDD"],["📞","Telefone"],["⭐","Prioridade"],["🎯","Classificação"],["📅","Data"],["📱","WhatsApp"]].map(([ico,h]) => (
                            <th key={h} className="px-4 py-3 text-left">
                              <span className="text-[9px] uppercase tracking-[0.22em] text-white/35 font-semibold">{ico} {h}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {phones.map((p, i) => (
                          <tr key={i} className="border-b border-white/5 hover:bg-white/[0.025] transition-colors">
                            <td className="px-4 py-3 text-white/60 font-mono text-sm">{p.ddd || "—"}</td>
                            <td className="px-4 py-3 text-white font-mono font-semibold">{p.numero || "—"}</td>
                            <td className="px-4 py-3 text-white/60 text-sm">{p.prioridade || "—"}</td>
                            <td className="px-4 py-3">
                              <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/8 text-white/65">{p.classificacao || "—"}</span>
                            </td>
                            <td className="px-4 py-3 text-white/45 text-xs">{p.data}</td>
                            <td className="px-4 py-3">
                              {(p.ddd || p.numero) && (
                                <a
                                  href={`https://wa.me/55${p.ddd}${p.numero.replace(/\D/g,"")}`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-[11px] font-bold transition-colors whitespace-nowrap"
                                >
                                  <MessageCircle className="w-3 h-3" /> WhatsApp
                                </a>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Relações */}
            {relations.length > 0 && (
              <CollapsibleSection icon={Users} title="Relações" count={relations.length}>
                <div className="rounded-2xl border border-white/10 bg-[#0c0e1c] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[750px]">
                      <thead>
                        <tr className="border-b border-white/10 bg-black/25">
                          {["Foto","CPF","Relação","Nome","Nascimento","Sexo","Grau","Grau Oficial","Origem"].map(h => (
                            <th key={h} className="px-3 py-3 text-left text-[9px] uppercase tracking-[0.18em] text-white/35 font-semibold whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {relations.map((rel, i) => (
                          <tr key={i} className="border-b border-white/5 hover:bg-white/[0.025] transition-colors">
                            <td className="px-3 py-2.5">
                              <div className="w-10 h-12 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                                <User className="w-5 h-5 text-white/15" />
                              </div>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs text-white/50">{fmtCPF(rel.cpf) || "—"}</td>
                            <td className="px-3 py-2.5">
                              <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold bg-white/10 text-white/80">{rel.relacao || "—"}</span>
                            </td>
                            <td className="px-3 py-2.5 text-white font-semibold text-[13px] whitespace-nowrap">{rel.nome || "—"}</td>
                            <td className="px-3 py-2.5 text-white/55 text-xs whitespace-nowrap">{rel.nascimento || "—"}</td>
                            <td className="px-3 py-2.5 text-white/55 text-xs">{rel.sexo || "—"}</td>
                            <td className="px-3 py-2.5 text-white/55 text-xs text-center">{rel.grau || "—"}</td>
                            <td className="px-3 py-2.5 text-white/55 text-xs text-center">{rel.grauOficial || "—"}</td>
                            <td className="px-3 py-2.5 text-white/50 text-xs">{rel.origem || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Visualização Geográfica */}
            {addresses.length > 0 && (
              <CollapsibleSection icon={MapPin} title="Visualização Geográfica" count={addresses.length}>
                <div className="rounded-2xl border border-white/10 overflow-hidden">
                  <div className="relative h-[300px]">
                    <MapContainer center={center} zoom={geocoded.length > 0 ? 7 : 4} className="h-full w-full z-10" style={{ background: "#0c0e1c" }}>
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                      />
                      {geocoded.map((addr, i) => (
                        <CircleMarker key={i} center={[addr.lat!, addr.lng!]} radius={15} fillColor="#7c3aed" color="#5b21b6" weight={2} fillOpacity={0.92}>
                          <Popup>
                            <div className="text-xs space-y-1 min-w-[170px]">
                              <p className="font-bold text-gray-800 text-sm">{i+1}. {addr.logradouro}{addr.numero ? `, ${addr.numero}` : ""}</p>
                              {addr.complemento && addr.complemento !== "Não Informado" && <p className="text-gray-500">{addr.complemento}</p>}
                              {addr.bairro && <p className="text-gray-600">{addr.bairro}</p>}
                              <p className="text-gray-600">{[addr.cidade, addr.uf].filter(Boolean).join(" - ")}</p>
                              {addr.cep && <p className="text-gray-500">CEP: {addr.cep}</p>}
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([addr.logradouro,addr.numero,addr.bairro,addr.cidade,addr.uf].filter(Boolean).join(", "))}`}
                                target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-violet-600 font-semibold hover:underline mt-1.5"
                              >
                                📍 Google Maps
                              </a>
                            </div>
                          </Popup>
                        </CircleMarker>
                      ))}
                    </MapContainer>
                    <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 bg-[#0c0e1c]/90 backdrop-blur rounded-xl px-3 py-2 border border-white/10 pointer-events-none">
                      <MapPin className="w-3.5 h-3.5" style={{ color:"var(--color-primary)" }} />
                      <span className="text-xs font-semibold text-white">Visualização Geográfica</span>
                      <span className="text-xs text-white/35">{addresses.length} endereços</span>
                    </div>
                  </div>

                  <div className="bg-[#0c0e1c] border-t border-white/8 overflow-x-auto">
                    <table className="w-full text-sm min-w-[700px]">
                      <thead>
                        <tr className="border-b border-white/10 bg-black/25">
                          {[["📍","Logradouro"],["#","Número"],["🏢","Complemento"],["🏘","Bairro"],["🏙","Cidade"],["🚩","UF"],["📮","CEP"],["🗺","Localização"]].map(([ico,h]) => (
                            <th key={h} className="px-4 py-3 text-left text-[9px] uppercase tracking-[0.18em] text-white/35 font-semibold whitespace-nowrap">{ico} {h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {addresses.map((a, i) => (
                          <tr key={i} className="border-b border-white/5 hover:bg-white/[0.025] transition-colors">
                            <td className="px-4 py-3 text-white font-semibold">{a.logradouro || "—"}</td>
                            <td className="px-4 py-3 text-white/65">{a.numero || "—"}</td>
                            <td className="px-4 py-3 text-white/45 text-xs">{a.complemento || "—"}</td>
                            <td className="px-4 py-3 text-white/60">{a.bairro || "—"}</td>
                            <td className="px-4 py-3 text-white font-medium">{a.cidade || "—"}</td>
                            <td className="px-4 py-3 text-white/55 font-mono">{a.uf || "—"}</td>
                            <td className="px-4 py-3 text-white/40 font-mono text-xs">{a.cep || "—"}</td>
                            <td className="px-4 py-3">
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([a.logradouro,a.numero,a.bairro,a.cidade,a.uf].filter(Boolean).join(", "))}`}
                                target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-[11px] font-bold transition-colors whitespace-nowrap"
                                style={{ background:"color-mix(in srgb, var(--color-primary) 25%, transparent)", border:"1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)" }}
                              >
                                <MapPin className="w-3 h-3" /> Maps
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Empregos */}
            {employments.length > 0 && (
              <CollapsibleSection icon={Briefcase} title="Empregos" count={employments.length}>
                <div className="rounded-2xl border border-white/10 bg-[#0c0e1c] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead>
                        <tr className="border-b border-white/10 bg-black/25">
                          {["Empresa","CNPJ","Cargo","Admissão","Demissão","Salário"].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-[9px] uppercase tracking-[0.2em] text-white/35 font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {employments.map((e, i) => (
                          <tr key={i} className="border-b border-white/5 hover:bg-white/[0.025]">
                            <td className="px-4 py-3 text-white font-semibold">{e.empresa || "—"}</td>
                            <td className="px-4 py-3 text-white/40 font-mono text-xs">{e.cnpj || "—"}</td>
                            <td className="px-4 py-3 text-white/65">{e.cargo || "—"}</td>
                            <td className="px-4 py-3 text-white/55 text-xs">{e.admissao || "—"}</td>
                            <td className="px-4 py-3 text-white/55 text-xs">{e.demissao || "—"}</td>
                            <td className="px-4 py-3 text-emerald-400 font-bold">{e.salario || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Score */}
            {(score1 || score2Val) && (
              <CollapsibleSection icon={BarChart2} title="Score de Crédito">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[{ label: "Score 1", val: score1, grad: "from-violet-600 to-indigo-600" }, { label: "Score 2", val: score2Val, grad: "from-sky-600 to-indigo-500" }].filter(s => s.val).map(s => (
                    <div key={s.label} className="rounded-2xl border border-white/10 bg-[#0c0e1c] p-5 flex items-center gap-5">
                      <div className={`w-16 h-16 rounded-xl flex items-center justify-center text-xl font-black text-white shrink-0 bg-gradient-to-br ${s.grad}`}>
                        {s.val}
                      </div>
                      <div className="flex-1">
                        <p className="text-[9px] uppercase tracking-widest text-white/35 mb-2">{s.label}</p>
                        <div className="h-2 bg-white/8 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full bg-gradient-to-r ${s.grad}`} style={{ width: `${Math.min(100, (parseInt(s.val) / 1000) * 100)}%` }} />
                        </div>
                        <p className="text-[10px] text-white/30 mt-1.5">{s.val} / 1000</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* CNH */}
            {hasCNH && (
              <CollapsibleSection icon={Car} title="CNH">
                <div className="rounded-2xl border border-white/10 bg-[#0c0e1c] p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {(mResults["cnh"]?.data?.fields ?? []).map(([k, v], i) => (
                    <div key={i}>
                      <p className="text-[9px] uppercase tracking-[0.2em] text-white/30 mb-0.5">{k}</p>
                      <p className="text-sm font-semibold text-white">{v}</p>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Processos / Mandados */}
            {hasLegal && (
              <CollapsibleSection icon={Scale} title="Processos & Mandados">
                <div className="space-y-3">
                  {["processos","mandado"].flatMap(tipo => {
                    const res = mResults[tipo];
                    if (!res?.data?.sections?.length) return [];
                    return res.data.sections.map((sec, si) => (
                      <div key={`${tipo}-${si}`} className="rounded-2xl border border-white/10 bg-[#0c0e1c] overflow-hidden">
                        <div className="px-4 py-2.5 bg-black/25 border-b border-white/8 flex items-center gap-2">
                          <span className="text-[9px] uppercase tracking-widest text-white/35 font-bold">{sec.name || tipo.toUpperCase()}</span>
                          <span className="text-[9px] text-white/20">({sec.items.length})</span>
                        </div>
                        <div className="divide-y divide-white/5">
                          {sec.items.map((item, ii) => (
                            <div key={ii} className="px-4 py-3 text-sm text-white/65 leading-relaxed">{item}</div>
                          ))}
                        </div>
                      </div>
                    ));
                  })}
                </div>
              </CollapsibleSection>
            )}

            {/* Extras */}
            {extras.length > 0 && (
              <CollapsibleSection icon={FileText} title="Dados Adicionais">
                <div className="space-y-4">
                  {extras.map(key => {
                    const meta = extraLabels[key];
                    const res  = mResults[key];
                    if (!meta || !res?.data) return null;
                    const { label, icon: Icon } = meta;
                    const { fields, sections } = res.data;
                    return (
                      <div key={key} className="rounded-2xl border border-white/10 bg-[#0c0e1c] overflow-hidden">
                        <div className="px-4 py-3 bg-black/25 border-b border-white/8 flex items-center gap-2">
                          <Icon className="w-3.5 h-3.5" style={{ color:"var(--color-primary)" }} />
                          <span className="text-[11px] uppercase tracking-widest font-bold text-white">{label}</span>
                        </div>
                        <div className="p-4 space-y-4">
                          {fields.length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              {fields.map(([k, v], i) => (
                                <div key={i}>
                                  <p className="text-[8.5px] uppercase tracking-[0.18em] text-white/28 mb-0.5">{k}</p>
                                  <p className="text-sm font-semibold text-white">{v}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          {sections.map((sec, si) => (
                            <div key={si}>
                              {sec.name && <p className="text-[9px] uppercase tracking-widest text-white/28 mb-2">{sec.name}</p>}
                              <div className="divide-y divide-white/5 rounded-xl border border-white/8 overflow-hidden">
                                {sec.items.map((item, ii) => (
                                  <div key={ii} className="px-4 py-2.5 text-sm text-white/65">{item}</div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>
            )}

            {/* Óbito */}
            {hasObito && (
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
                <SectionHeader icon={AlertTriangle} title="Registro de Óbito" />
                <div className="rounded-2xl border border-red-500/25 bg-red-950/15 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    <span className="text-xs text-red-400 font-semibold uppercase tracking-widest">Pessoa falecida conforme registros</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {(mResults["obito"]?.data?.fields ?? []).map(([k, v], i) => (
                      <div key={i}>
                        <p className="text-[9px] uppercase tracking-[0.2em] text-red-400/45 mb-0.5">{k}</p>
                        <p className="text-sm font-semibold text-red-200">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Sem dados */}
            {noData && (
              <div className="text-center py-20 text-muted-foreground">
                <FileText className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <p className="text-sm">Nenhum dado encontrado para este CPF.</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
