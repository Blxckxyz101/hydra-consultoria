import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Copy,
  Check,
  Download,
  FileJson,
  Eye,
  EyeOff,
  Sparkles,
  FolderOpen,
  CheckCircle2,
  Star,
  FileText,
  Camera,
} from "lucide-react";
import { addFavorito, isFavorito } from "@/pages/favoritos";

const STORAGE_KEY = "infinity_dossies";

type DossieStub = { id: string; title: string };

function loadDossieStubs(): DossieStub[] {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return arr.map((d: { id: string; title: string }) => ({ id: d.id, title: d.title }));
  } catch { return []; }
}

function saveToD(dossieId: string, item: object) {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    const idx = arr.findIndex((d: { id: string }) => d.id === dossieId);
    if (idx === -1) return false;
    arr[idx].items = [item, ...(arr[idx].items ?? [])];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    return true;
  } catch { return false; }
}

function SaveToDossieButton({ tipo, query, data }: { tipo: string; query: string; data: unknown }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const stubs = loadDossieStubs();

  if (stubs.length === 0) return (
    <span className="text-[10px] uppercase tracking-widest text-muted-foreground/40">
      Crie um dossiê primeiro
    </span>
  );

  if (saved) return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-emerald-400">
      <CheckCircle2 className="w-3 h-3" /> Salvo
    </span>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-amber-300 transition-colors"
      >
        <FolderOpen className="w-3 h-3" /> Salvar no Dossiê
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-50 min-w-[200px] rounded-xl border border-white/10 bg-[#06091a]/95 backdrop-blur-2xl shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-white/5">
            <p className="text-[9px] uppercase tracking-[0.4em] text-muted-foreground">Selecionar dossiê</p>
          </div>
          {stubs.map((d) => (
            <button
              key={d.id}
              onClick={() => {
                const parsed = (data as { fields?: unknown[]; sections?: unknown[]; raw?: string }) ?? {};
                const ok = saveToD(d.id, {
                  id: Math.random().toString(36).slice(2) + Date.now().toString(36),
                  tipo, query,
                  addedAt: new Date().toISOString(),
                  note: "",
                  fields: parsed.fields ?? [],
                  sections: parsed.sections ?? [],
                  raw: parsed.raw ?? "",
                });
                if (ok) { setSaved(true); setOpen(false); }
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-white/5 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
              <span className="truncate">{d.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FavoriteButton({ tipo, query, data }: { tipo: string; query: string; data: unknown }) {
  const [fav, setFav] = useState(() => isFavorito(tipo, query));
  const [added, setAdded] = useState(false);

  const toggle = () => {
    if (fav) return;
    const parsed = (data as { fields?: unknown[]; sections?: unknown[]; raw?: string }) ?? {};
    const ok = addFavorito({
      tipo, query,
      note: "",
      fields: (parsed.fields ?? []) as Array<{ key: string; value: string }>,
      sections: (parsed.sections ?? []) as Array<{ name: string; items: string[] }>,
      raw: parsed.raw ?? "",
    });
    if (ok) {
      setFav(true);
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={fav}
      title={fav ? "Já é favorito" : "Adicionar aos favoritos"}
      className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest transition-colors ${
        fav
          ? "text-amber-400 cursor-default"
          : "text-muted-foreground hover:text-amber-400"
      }`}
    >
      <Star className={`w-3 h-3 ${fav ? "fill-amber-400" : ""}`} />
      {added ? "Favoritado" : fav ? "Favorito" : "Favoritar"}
    </button>
  );
}

type ParsedField = { key: string; value: string };
type ParsedSection = { name: string; items: string[] };
type Parsed = { fields: ParsedField[]; sections: ParsedSection[]; raw: string };

type Props = {
  tipo: string;
  query?: string;
  result: { success: boolean; error?: string | null; data?: Parsed | unknown };
};

function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
    >
      {done ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {done ? "Copiado" : label}
    </button>
  );
}

function isParsed(d: unknown): d is Parsed {
  return (
    typeof d === "object" && d !== null &&
    "fields" in d && Array.isArray((d as Parsed).fields) &&
    "sections" in d && Array.isArray((d as Parsed).sections)
  );
}

// Humaniza chaves com underscores e números (ex: MARCA_MODEL0 → Marca/Modelo)
const KEY_FIXES: Record<string, string> = {
  "MARCA_MODEL0": "Marca / Modelo",
  "MARCA_MODELO": "Marca / Modelo",
  "PROPRIETARIO_NOME": "Proprietário",
  "PROPRIETARIO_CPF": "CPF do Proprietário",
  "ESTADO_ENDERECO": "Estado (Endereço)",
  "TIPO_VEICULO": "Tipo de Veículo",
  "ANO_MODELO": "Ano do Modelo",
  "ANO_FABRICACAO": "Ano de Fabricação",
  "HABILITADO_PARA_DIRIGIR": "Habilitado p/ Dirigir",
  "DATA_NASCIMENTO": "Data de Nascimento",
  "NOME_MAE": "Nome da Mãe",
  "NOME_PAI": "Nome do Pai",
  "RAZAO_SOCIAL": "Razão Social",
  "NOME_FANTASIA": "Nome Fantasia",
  "CAPITAL_SOCIAL": "Capital Social",
  "NATUREZA_JURIDICA": "Natureza Jurídica",
  "DATA_ABERTURA": "Data de Abertura",
  "DATA_SITUACAO": "Data da Situação",
  "ULTIMA_ATUALIZACAO": "Última Atualização",
};

function humanizeKey(key: string): string {
  if (KEY_FIXES[key]) return KEY_FIXES[key];
  return key
    .replace(/_/g, " ")
    .replace(/0$/, "O") // MODELO0 → MODELOO não, apenas substituir trailing 0 por O em casos específicos
    .trim();
}

// Filtra valores vazios/inúteis
function isUselessValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v || v === "none" || v === "null" || v === "undefined") return true;
  if (v === "sem informação" || v === "sem informacao" || v === "sem info") return true;
  if (v === "não informado" || v === "nao informado") return true;
  if (/^r\$\s*0[,.]00$/.test(v)) return false; // manter multas zeradas pois são informativas
  return false;
}

function isImportantField(key: string): boolean {
  const k = key.toUpperCase();
  const important = ["NOME", "CPF", "CNPJ", "RAZÃO SOCIAL", "RAZAO SOCIAL", "PLACA", "CHASSI", "TELEFONE", "EMAIL", "RG", "DATA NASCIMENTO", "NASCIMENTO", "NOME MÃE", "NOME PAI", "FOTO_URL"];
  return important.some((imp) => k.includes(imp));
}

function fieldGradient(key: string): string {
  const k = key.toUpperCase();
  if (k.includes("CPF") || k.includes("RG") || k.includes("CNS")) return "from-sky-400/20 to-cyan-400/5";
  if (k.includes("CNPJ") || k.includes("RAZÃO") || k.includes("EMPRESA")) return "from-violet-400/20 to-fuchsia-400/5";
  if (k.includes("TELEFONE") || k.includes("EMAIL") || k.includes("PIX")) return "from-emerald-400/20 to-teal-400/5";
  if (k.includes("PLACA") || k.includes("CHASSI") || k.includes("RENAVAM") || k.includes("MOTOR")) return "from-amber-400/20 to-orange-400/5";
  if (k.includes("NOME") || k.includes("NASCIMENTO") || k.includes("MÃE") || k.includes("PAI")) return "from-rose-400/20 to-pink-400/5";
  return "from-white/10 to-white/0";
}

function fieldAccent(key: string): string {
  const k = key.toUpperCase();
  if (k.includes("CPF") || k.includes("RG")) return "text-sky-300";
  if (k.includes("CNPJ") || k.includes("RAZÃO")) return "text-violet-300";
  if (k.includes("TELEFONE") || k.includes("EMAIL")) return "text-emerald-300";
  if (k.includes("PLACA") || k.includes("CHASSI")) return "text-amber-300";
  if (k.includes("NOME")) return "text-rose-300";
  return "text-primary";
}

export function ResultViewer({ tipo, query = "", result }: Props) {
  const [showRaw, setShowRaw] = useState(false);

  const parsed: Parsed = useMemo(() => {
    if (isParsed(result.data)) {
      const d = result.data as Parsed;
      // Apply humanizeKey and filter useless values
      const cleanFields = d.fields
        .filter((f) => f.key !== "FOTO_URL" && !isUselessValue(f.value))
        .map((f) => ({ key: humanizeKey(f.key), value: f.value }));
      const fotoField = d.fields.find((f) => f.key === "FOTO_URL");
      return {
        fields: fotoField ? [fotoField, ...cleanFields] : cleanFields,
        sections: d.sections,
        raw: d.raw,
      };
    }
    return { fields: [], sections: [], raw: typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? {}) };
  }, [result.data]);

  const photoUrl = parsed.fields.find((f) => f.key === "FOTO_URL")?.value;
  const displayFields = parsed.fields.filter((f) => f.key !== "FOTO_URL");
  const headlineFields = displayFields.filter((f) => isImportantField(f.key)).slice(0, 4);
  const otherFields = displayFields.filter((f) => !headlineFields.includes(f));

  const exportText = useMemo(() => {
    const lines = [
      `═══ INFINITY SEARCH ═══`,
      `Tipo: ${tipo.toUpperCase()}`,
      `Data: ${new Date().toLocaleString("pt-BR")}`,
      ``,
    ];
    parsed.fields.forEach((f) => lines.push(`${f.key}: ${f.value}`));
    parsed.sections.forEach((s) => {
      lines.push("");
      lines.push(`━ ${s.name} (${s.items.length}) ━`);
      s.items.forEach((it) => lines.push(`  • ${it}`));
    });
    lines.push("");
    lines.push("Made by blxckxyz · Infinity Search");
    return lines.join("\n");
  }, [parsed, tipo]);

  const downloadTxt = () => {
    const blob = new Blob([exportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `infinity-${tipo}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = () => {
    const date = new Date().toLocaleString("pt-BR");
    const fieldsHtml = parsed.fields.map(f => `
      <tr>
        <td class="key">${f.key}</td>
        <td class="val">${f.value || "—"}</td>
      </tr>`).join("");

    const sectionsHtml = parsed.sections.map(s => `
      <div class="section">
        <div class="sec-title">${s.name} <span class="badge">${s.items.length}</span></div>
        <ul>${s.items.map(it => `<li>${it}</li>`).join("")}</ul>
      </div>`).join("");

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Infinity Search · ${tipo.toUpperCase()} · ${query}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111;padding:28px 36px;font-size:13px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #0891b2;padding-bottom:14px;margin-bottom:20px}
    .logo{font-size:22px;font-weight:900;letter-spacing:4px;text-transform:uppercase;color:#0891b2}
    .meta{text-align:right;color:#555;font-size:11px;line-height:1.7}
    .meta strong{color:#111}
    table{width:100%;border-collapse:collapse;margin-bottom:20px}
    tr:nth-child(even){background:#f4fbfd}
    td{padding:7px 10px;border-bottom:1px solid #e0f2f8;vertical-align:top}
    td.key{font-weight:700;color:#0e7490;text-transform:uppercase;font-size:11px;letter-spacing:1px;width:36%;white-space:nowrap}
    td.val{color:#111;font-size:13px;word-break:break-all}
    .section{margin-bottom:18px}
    .sec-title{font-weight:800;text-transform:uppercase;letter-spacing:2px;font-size:11px;color:#0891b2;margin-bottom:8px;display:flex;align-items:center;gap:8px}
    .badge{background:#0891b2;color:#fff;border-radius:9px;padding:1px 7px;font-size:10px}
    ul{list-style:none;padding:0}
    li{padding:5px 10px;background:#f4fbfd;border-left:3px solid #0891b2;margin-bottom:4px;font-size:12px;font-family:monospace;word-break:break-all}
    .footer{margin-top:24px;border-top:1px solid #e0f2f8;padding-top:10px;text-align:center;color:#aaa;font-size:10px;letter-spacing:2px;text-transform:uppercase}
    @media print{body{padding:10px 16px}button{display:none}}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">∞ Infinity Search</div>
      <div style="margin-top:4px;font-size:11px;color:#555">Relatório OSINT gerado automaticamente</div>
    </div>
    <div class="meta">
      <div><strong>Tipo:</strong> ${tipo.toUpperCase()}</div>
      <div><strong>Consulta:</strong> ${query}</div>
      <div><strong>Data:</strong> ${date}</div>
      <div><strong>Campos:</strong> ${parsed.fields.length} &nbsp;·&nbsp; <strong>Listas:</strong> ${parsed.sections.length}</div>
    </div>
  </div>

  ${parsed.fields.length > 0 ? `<table>${fieldsHtml}</table>` : ""}
  ${sectionsHtml}

  <div class="footer">Made by blxckxyz · Infinity Search · ${date}</div>
  <script>setTimeout(()=>window.print(),300)</script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=900,height=700");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  if (!result.success && parsed.fields.length === 0 && parsed.sections.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/5 backdrop-blur-xl p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold uppercase tracking-widest text-amber-200">Sem resultado</div>
            <p className="text-xs text-amber-100/80 mt-1">{result.error ?? "O provedor não retornou dados para esta consulta."}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6 space-y-4"
    >
      {/* Status header */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-1">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className={`w-2 h-2 rounded-full ${result.success ? "bg-emerald-400" : "bg-amber-400"}`} />
            <div className={`absolute inset-0 w-2 h-2 rounded-full ${result.success ? "bg-emerald-400" : "bg-amber-400"} animate-ping`} />
          </div>
          <span className={`text-[10px] uppercase tracking-[0.4em] font-semibold ${result.success ? "text-emerald-300" : "text-amber-300"}`}>
            {result.success ? "Resultado encontrado" : "Sem dados"}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            · {parsed.fields.length} campos · {parsed.sections.length} listas
          </span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <FavoriteButton tipo={tipo} query={query} data={result.data} />
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
          >
            {showRaw ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showRaw ? "Ocultar bruto" : "Ver bruto"}
          </button>
          <button
            onClick={downloadTxt}
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
          >
            <Download className="w-3 h-3" /> Exportar
          </button>
          <button
            onClick={downloadPdf}
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-rose-400 transition-colors"
          >
            <FileText className="w-3 h-3" /> PDF
          </button>
          <CopyButton text={exportText} label="Copiar tudo" />
          <SaveToDossieButton tipo={tipo} query={query} data={result.data} />
        </div>
      </div>

      {/* Foto CNH card */}
      {photoUrl && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/10 to-sky-500/5 backdrop-blur-xl p-5 flex flex-col sm:flex-row items-center gap-5"
        >
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-xl bg-cyan-400/20 blur-xl" />
            <img
              src={photoUrl}
              alt="Foto CNH"
              className="relative w-32 h-40 object-cover rounded-xl border-2 border-cyan-400/40 shadow-[0_0_30px_rgba(34,211,238,0.3)]"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <div className="flex flex-col gap-2 text-center sm:text-left">
            <div className="flex items-center gap-2 justify-center sm:justify-start">
              <Camera className="w-4 h-4 text-cyan-400" />
              <span className="text-[10px] uppercase tracking-[0.4em] font-bold text-cyan-300">Foto CNH · DarkFlow</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">Foto biométrica encontrada na base de dados da CNH.</p>
            <div className="flex gap-2 justify-center sm:justify-start flex-wrap">
              <CopyButton text={photoUrl} label="Copiar URL" />
              <a
                href={photoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-cyan-300 transition-colors"
              >
                <Eye className="w-3 h-3" /> Abrir original
              </a>
            </div>
          </div>
        </motion.div>
      )}

      {/* Headline cards (most important fields) */}
      {headlineFields.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {headlineFields.map((f, i) => (
            <motion.div
              key={`${f.key}-${i}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              whileHover={{ y: -2 }}
              className={`relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br ${fieldGradient(f.key)} backdrop-blur-xl p-4`}
            >
              <div className="absolute inset-0 bg-black/30" />
              <div className="relative">
                <div className="flex items-center justify-between mb-1.5">
                  <p className={`text-[9px] uppercase tracking-[0.3em] font-semibold ${fieldAccent(f.key)}`}>{f.key}</p>
                  <Sparkles className={`w-3 h-3 ${fieldAccent(f.key)} opacity-60`} />
                </div>
                <p className="text-base sm:text-lg font-bold break-words leading-tight">{f.value || "—"}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* All fields grid */}
      {otherFields.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6">
          <h3 className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mb-4">Detalhes</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
            {otherFields.map((f, i) => (
              <motion.div
                key={`${f.key}-${i}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.4) }}
                className="group flex flex-col gap-0.5 py-2 border-b border-white/5 last:border-0"
              >
                <div className="flex items-center justify-between">
                  <p className={`text-[9px] uppercase tracking-[0.25em] ${fieldAccent(f.key)} opacity-80`}>{f.key}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(f.value)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Copiar"
                  >
                    <Copy className="w-3 h-3 text-muted-foreground hover:text-primary" />
                  </button>
                </div>
                <p className="text-sm font-medium break-words">{f.value || "—"}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Sections (lists like SÓCIOS, EMAILS, TELEFONES) */}
      {parsed.sections.map((sec, idx) => (
        <motion.div
          key={`${sec.name}-${idx}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + idx * 0.05 }}
          className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold uppercase tracking-[0.3em] text-primary">{sec.name}</h3>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md">
                {sec.items.length}
              </span>
            </div>
            <CopyButton text={sec.items.join("\n")} label={`Copiar ${sec.name.toLowerCase()}`} />
          </div>
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-2">
            {sec.items.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.015, 0.5) }}
                className="group flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-primary/20 transition-all"
              >
                <div className="w-6 h-6 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <p className="text-sm flex-1 break-words leading-relaxed font-mono">{item}</p>
                <button
                  onClick={() => navigator.clipboard.writeText(item)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1"
                >
                  <Copy className="w-3.5 h-3.5 text-muted-foreground hover:text-primary" />
                </button>
              </motion.div>
            ))}
          </div>
        </motion.div>
      ))}

      {/* Raw response (toggle) */}
      {showRaw && parsed.raw && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-2xl p-5 overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileJson className="w-3.5 h-3.5 text-muted-foreground" />
              <h3 className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">Resposta bruta do provedor</h3>
            </div>
            <CopyButton text={parsed.raw} />
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-muted-foreground/80 max-h-96 overflow-y-auto">
            {parsed.raw}
          </pre>
        </motion.div>
      )}

      <div className="text-center text-[10px] uppercase tracking-[0.5em] text-muted-foreground/60 pt-2">
        Made by blxckxyz · Infinity Search
      </div>
    </motion.div>
  );
}
