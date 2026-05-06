import jsPDF from "jspdf";

// ─── Types (mirrors CpfFullPanel internal types) ──────────────────────────────
type ParsedData  = { fields: [string, string][]; sections: { name: string; items: string[] }[]; raw: string };
type ModuleResult = { status: string; data?: ParsedData };
type Identity    = { nome: string; cpf: string; rg: string; mae: string; pai: string; naturalidade: string; nacionalidade: string; dataNascimento: string; sexo: string; estadoCivil: string; orgaoEmissor: string; dataEmissao: string; situacaoCadastral: string; tipoSanguineo: string; tituloEleitor: string; pis: string; nis: string; email: string; enderecoPrincipal: string };
type PhoneEntry  = { ddd: string; numero: string; prioridade: string; classificacao: string; data: string; tipo: string };
type Address     = { logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string };
type Employment  = { empresa: string; cnpj: string; cargo: string; admissao: string; demissao: string; salario: string };
type Relative    = { cpf: string; nome: string; nasc: string; sexo: string; relacao: string; origem: string };

export interface LaudoData {
  cpf: string;
  identity: Identity;
  phones: PhoneEntry[];
  addresses: Address[];
  employments: Employment[];
  relatives: Relative[];
  photo: string | null;
  relPhotos: Record<string, string>;
  score1: string;
  score2Val: string;
  mResults: Record<string, ModuleResult>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hex(h: string): [number, number, number] {
  const c = h.replace("#", "");
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}

function fmt(v: string | null | undefined): string {
  return (v || "").trim() || "—";
}

function fmtCPF(cpf: string): string {
  const d = cpf.replace(/\D/g,"");
  if (d.length !== 11) return cpf;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
}

function fmtPhone(ph: PhoneEntry): string {
  return `(${ph.ddd}) ${ph.numero.slice(0,5)}-${ph.numero.slice(5)}`;
}

// ─── PDF Generator ────────────────────────────────────────────────────────────
export async function generateLaudoPDF(data: LaudoData): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210;
  const margin = 15;
  const col = W - margin * 2;
  let y = 0;
  let page = 1;

  const C = {
    bg:      "#09090f" as string,
    primary: "#38bdf8" as string,
    accent:  "#7c3aed" as string,
    rose:    "#f43f5e" as string,
    green:   "#22c55e" as string,
    amber:   "#f59e0b" as string,
    text:    "#111827" as string,
    sub:     "#6b7280" as string,
    border:  "#e5e7eb" as string,
    light:   "#f8fafc" as string,
  };

  function newPage() {
    doc.addPage();
    page++;
    y = 12;
    // Thin header stripe on new pages
    doc.setFillColor(...hex(C.bg));
    doc.rect(0, 0, W, 8, "F");
    doc.setFillColor(...hex(C.primary));
    doc.rect(0, 8, W, 0.5, "F");
    doc.setTextColor(...hex(C.primary));
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.text("INFINITY SEARCH — LAUDO PERICIAL DIGITAL — CONFIDENCIAL", margin, 5.5);
    doc.text(`Pág. ${page}`, W - margin, 5.5, { align: "right" });
    doc.setTextColor(...hex(C.text));
    y = 15;
  }

  function checkY(needed: number) {
    if (y + needed > 277) newPage();
  }

  function sectionHeader(title: string, sub?: string) {
    checkY(14);
    doc.setFillColor(...hex(C.bg));
    doc.roundedRect(margin, y, col, 9, 2, 2, "F");
    doc.setFillColor(...hex(C.primary));
    doc.rect(margin, y, 3, 9, "F");
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text(title.toUpperCase(), margin + 6, y + 6);
    if (sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...hex(C.primary));
      doc.text(sub, margin + 6 + doc.getTextWidth(title.toUpperCase()) + 4, y + 6);
    }
    y += 12;
  }

  function fieldGrid(fields: { label: string; value: string }[], cols = 3) {
    const cw = col / cols;
    let col_ = 0;
    const startY = y;
    let rowH = 0;
    for (const f of fields) {
      const x = margin + col_ * cw;
      if (col_ === 0 && col_ === 0 && f !== fields[0]) checkY(14);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...hex(C.sub));
      doc.text(f.label.toUpperCase(), x, y + 4);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...hex(C.text));
      const lines = doc.splitTextToSize(fmt(f.value), cw - 3);
      doc.text(lines[0], x, y + 9);
      rowH = Math.max(rowH, 13);
      col_++;
      if (col_ >= cols) {
        col_ = 0;
        y += rowH + 2;
        rowH = 0;
      }
    }
    if (col_ !== 0) y += rowH + 2;
    void startY;
    y += 2;
  }

  function tableRow(cells: string[], widths: number[], isHeader = false, alternate = false) {
    checkY(7);
    let x = margin;
    const rowH = 6.5;
    if (alternate) {
      doc.setFillColor(...hex(C.light));
      doc.rect(margin, y, col, rowH, "F");
    }
    if (isHeader) {
      doc.setFillColor(...hex(C.bg));
      doc.rect(margin, y, col, rowH, "F");
    }
    for (let i = 0; i < cells.length; i++) {
      doc.setFontSize(isHeader ? 7 : 8);
      doc.setFont("helvetica", isHeader ? "bold" : "normal");
      if (isHeader) doc.setTextColor(255, 255, 255);
      else doc.setTextColor(...hex(C.text));
      const txt = doc.splitTextToSize(cells[i], widths[i] - 3);
      doc.text(txt[0], x + 2, y + 4.5);
      x += widths[i];
    }
    y += rowH;
  }

  function divider() {
    y += 3;
    doc.setDrawColor(...hex(C.border));
    doc.setLineWidth(0.2);
    doc.line(margin, y, W - margin, y);
    y += 4;
  }

  // ── PAGE 1: HEADER ─────────────────────────────────────────────────────────
  doc.setFillColor(...hex(C.bg));
  doc.rect(0, 0, W, 52, "F");

  // Accent stripe
  doc.setFillColor(...hex(C.primary));
  doc.rect(0, 52, W, 1.5, "F");

  // Photo placeholder
  let photoX = margin;
  const photoW = 28, photoH = 38;
  if (data.photo) {
    try {
      doc.addImage(data.photo, "JPEG", margin, 7, photoW, photoH);
      doc.setDrawColor(...hex(C.primary));
      doc.setLineWidth(0.5);
      doc.rect(margin, 7, photoW, photoH);
      photoX = margin + photoW + 8;
    } catch {
      photoX = margin;
    }
  }

  // Title block
  doc.setTextColor(...hex(C.primary));
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "normal");
  doc.text("SISTEMA DE INTELIGÊNCIA • INFINITY SEARCH", photoX, 13);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(19);
  doc.setFont("helvetica", "bold");
  doc.text("LAUDO PERICIAL", photoX, 22);

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 200, 220);
  doc.text("RELATÓRIO FORENSE DIGITAL — CONFIDENCIAL", photoX, 29);

  // Identity quick-view
  const nameStr = fmt(data.identity.nome);
  doc.setTextColor(...hex(C.primary));
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(nameStr, photoX, 39);

  doc.setTextColor(180, 180, 200);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.text(`CPF: ${fmtCPF(data.cpf)}  |  Emitido: ${new Date().toLocaleString("pt-BR")}`, photoX, 45);

  const protocol = `INF-${Date.now().toString(36).toUpperCase().slice(-8)}`;
  doc.setTextColor(...hex(C.accent));
  doc.setFontSize(7);
  doc.text(`Protocolo: ${protocol}`, photoX, 50);

  y = 63;

  // ── IDENTIFICAÇÃO ──────────────────────────────────────────────────────────
  sectionHeader("Identificação Civil");
  fieldGrid([
    { label: "Nome Completo",      value: data.identity.nome },
    { label: "CPF",                value: fmtCPF(data.cpf) },
    { label: "RG",                 value: data.identity.rg },
    { label: "Órgão Emissor",      value: data.identity.orgaoEmissor },
    { label: "Data de Emissão",    value: data.identity.dataEmissao },
    { label: "Data de Nascimento", value: data.identity.dataNascimento },
    { label: "Sexo",               value: data.identity.sexo },
    { label: "Estado Civil",       value: data.identity.estadoCivil },
    { label: "Naturalidade",       value: data.identity.naturalidade },
    { label: "Nome da Mãe",        value: data.identity.mae },
    { label: "Nome do Pai",        value: data.identity.pai },
    { label: "Situação Cadastral", value: data.identity.situacaoCadastral },
    { label: "Tipo Sanguíneo",     value: data.identity.tipoSanguineo },
    { label: "Título de Eleitor",  value: data.identity.tituloEleitor },
    { label: "PIS / NIS",          value: data.identity.pis || data.identity.nis },
    { label: "E-mail",             value: data.identity.email },
    { label: "Endereço Principal", value: data.identity.enderecoPrincipal },
    { label: "Nacionalidade",      value: data.identity.nacionalidade },
  ], 3);

  // ── SCORE ──────────────────────────────────────────────────────────────────
  if (data.score1 || data.score2Val) {
    divider();
    sectionHeader("Score de Crédito");
    const scores = [
      { label: "Serasa / Bureau 1", val: data.score1 },
      { label: "Bureau 2",          val: data.score2Val },
    ].filter(s => s.val);
    for (const s of scores) {
      checkY(18);
      const pct = Math.min(100, Math.max(0, (parseInt(s.val) / 1000) * 100));
      const barColor = pct > 70 ? C.green : pct > 40 ? C.amber : C.rose;
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...hex(C.sub));
      doc.text(s.label, margin, y + 4);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...hex(barColor));
      doc.text(s.val, margin + 50, y + 4);
      // Bar
      doc.setFillColor(230, 230, 235);
      doc.roundedRect(margin, y + 6, col, 3.5, 1, 1, "F");
      doc.setFillColor(...hex(barColor));
      doc.roundedRect(margin, y + 6, col * (pct / 100), 3.5, 1, 1, "F");
      y += 14;
    }
  }

  // ── TELEFONES ──────────────────────────────────────────────────────────────
  if (data.phones.length > 0) {
    divider();
    sectionHeader("Telefones", `(${data.phones.length})`);
    const tw = [col * 0.3, col * 0.25, col * 0.25, col * 0.2];
    tableRow(["Número","Tipo","Classificação","Data"], tw, true);
    data.phones.slice(0, 30).forEach((ph, i) => {
      tableRow([fmtPhone(ph), fmt(ph.tipo), fmt(ph.classificacao), fmt(ph.data)], tw, false, i % 2 === 0);
    });
    y += 3;
  }

  // ── ENDEREÇOS ──────────────────────────────────────────────────────────────
  if (data.addresses.length > 0) {
    divider();
    sectionHeader("Endereços", `(${data.addresses.length})`);
    const aw = [col * 0.42, col * 0.1, col * 0.22, col * 0.12, col * 0.14];
    tableRow(["Logradouro","Número","Cidade","UF","CEP"], aw, true);
    data.addresses.slice(0, 20).forEach((a, i) => {
      tableRow([fmt(a.logradouro), fmt(a.numero), fmt(a.cidade), fmt(a.uf), fmt(a.cep)], aw, false, i % 2 === 0);
    });
    y += 3;
  }

  // ── EMPREGOS ───────────────────────────────────────────────────────────────
  if (data.employments.length > 0) {
    divider();
    sectionHeader("Histórico Profissional", `(${data.employments.length})`);
    const ew = [col * 0.38, col * 0.3, col * 0.17, col * 0.15];
    tableRow(["Empresa","Cargo","Admissão","Demissão"], ew, true);
    data.employments.slice(0, 20).forEach((e, i) => {
      tableRow([fmt(e.empresa), fmt(e.cargo), fmt(e.admissao), fmt(e.demissao) === "—" ? "Ativo" : fmt(e.demissao)], ew, false, i % 2 === 0);
    });
    y += 3;
  }

  // ── PARENTES ───────────────────────────────────────────────────────────────
  if (data.relatives.length > 0) {
    divider();
    sectionHeader("Árvore Genealógica", `(${data.relatives.length} pessoas)`);
    const rw = [col * 0.37, col * 0.26, col * 0.18, col * 0.1, col * 0.09];
    tableRow(["Nome","CPF","Relação","Nascimento","Sexo"], rw, true);
    data.relatives.forEach((r, i) => {
      const hasPhoto = r.cpf && data.relPhotos[r.cpf];
      void hasPhoto;
      tableRow([fmt(r.nome), r.cpf ? fmtCPF(r.cpf) : "—", fmt(r.relacao), fmt(r.nasc), fmt(r.sexo)], rw, false, i % 2 === 0);
    });
    y += 3;
  }

  // ── PROCESSOS & MANDADOS ───────────────────────────────────────────────────
  const legalSecs = ["processos", "mandado"].flatMap(tipo => {
    const res = data.mResults[tipo];
    if (!res?.data) return [];
    return res.data.sections.map(sec => ({ tipo, ...sec }));
  });
  if (legalSecs.length > 0) {
    divider();
    sectionHeader("Processos & Mandados");
    for (const sec of legalSecs) {
      checkY(12);
      doc.setFillColor(...hex("#7f1d1d"));
      doc.roundedRect(margin, y, col, 7.5, 1.5, 1.5, "F");
      doc.setTextColor(255, 180, 180);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      doc.text(`⚠ ${sec.name || sec.tipo.toUpperCase()}`, margin + 4, y + 5);
      y += 10;
      for (const item of sec.items.slice(0, 15)) {
        checkY(6);
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...hex(C.text));
        const lines = doc.splitTextToSize(`• ${item}`, col - 4);
        doc.text(lines.slice(0, 2), margin + 3, y + 4);
        y += Math.min(lines.length, 2) * 4 + 1;
      }
      y += 3;
    }
  }

  // ── DADOS EXTRAS ───────────────────────────────────────────────────────────
  const extras = ["irpf","beneficios","dividas","bens","titulo","spc"].filter(k => {
    const r = data.mResults[k];
    return r?.status === "done" && r.data && (r.data.fields.length > 0 || r.data.sections.length > 0 || r.data.raw.length > 20);
  });
  if (extras.length > 0) {
    divider();
    sectionHeader("Dados Adicionais");
    for (const key of extras) {
      const res = data.mResults[key];
      if (!res?.data) continue;
      const labels: Record<string,string> = { irpf:"IRPF / Imposto de Renda", beneficios:"Benefícios Sociais", dividas:"Dívidas", bens:"Bens Registrados", titulo:"Título de Eleitor", spc:"SPC / Negativação" };
      checkY(10);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...hex(C.accent));
      doc.text(`▸ ${labels[key] || key.toUpperCase()}`, margin, y + 5);
      y += 8;
      if (res.data.fields.length > 0) {
        fieldGrid(res.data.fields.slice(0, 9).map(([k, v]) => ({ label: k, value: v })), 3);
      }
      for (const sec of res.data.sections.slice(0, 3)) {
        for (const item of sec.items.slice(0, 5)) {
          checkY(5);
          doc.setFontSize(7.5);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(...hex(C.text));
          const lines = doc.splitTextToSize(`• ${item}`, col - 4);
          doc.text(lines.slice(0,1), margin + 3, y + 4);
          y += 5;
        }
      }
      y += 3;
    }
  }

  // ── FOOTER on last page ────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    const fy = 290;
    doc.setFillColor(...hex(C.bg));
    doc.rect(0, fy - 4, W, 12, "F");
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...hex(C.sub));
    doc.text("Documento gerado por Infinity Search. Uso restrito — informações sigilosas.", margin, fy + 1);
    doc.text(`Protocolo: ${protocol}  |  ${new Date().toLocaleString("pt-BR")}  |  Pág. ${p}/${totalPages}`, W - margin, fy + 1, { align: "right" });
    doc.setDrawColor(...hex(C.primary));
    doc.setLineWidth(0.4);
    doc.line(margin, fy - 3, W - margin, fy - 3);
  }

  const safeName = (data.identity.nome || data.cpf).replace(/[^a-z0-9]/gi, "_").slice(0, 30);
  doc.save(`Laudo_${safeName}_${new Date().toISOString().slice(0,10)}.pdf`);
}
