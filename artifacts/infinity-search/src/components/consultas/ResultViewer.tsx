import { motion } from "framer-motion";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  User,
  Calendar,
  MapPin,
  Phone,
  Building2,
  Briefcase,
  Hash,
  Mail,
  Syringe,
  ShieldCheck,
} from "lucide-react";

type Tipo = "cpf" | "cnpj" | "telefone" | "sipni";

type Props = {
  tipo: Tipo;
  result: { success: boolean; error?: string | null; data?: any };
};

function CopyButton({ text }: { text: string }) {
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
      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
    >
      {done ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {done ? "Copiado" : "Copiar"}
    </button>
  );
}

function Field({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: any;
  label: string;
  value?: string | number | null;
  mono?: boolean;
}) {
  if (value === undefined || value === null || value === "") return null;
  const v = String(value);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-white/5 bg-black/30 p-4 backdrop-blur-sm hover:border-primary/30 transition-colors group"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          <Icon className="w-3 h-3 text-primary/70" />
          {label}
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          <CopyButton text={v} />
        </div>
      </div>
      <div className={`text-sm text-foreground break-words ${mono ? "font-mono" : ""}`}>{v}</div>
    </motion.div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-[0.4em] text-primary/60">{title}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function CnpjView({ data }: { data: any }) {
  if (!data) return null;
  return (
    <div className="space-y-6">
      <Section title="Identificação">
        <Field icon={Building2} label="Razão Social" value={data.nome || data.razao_social} />
        <Field icon={Briefcase} label="Nome Fantasia" value={data.fantasia || data.nome_fantasia} />
        <Field icon={Hash} label="CNPJ" value={data.cnpj} mono />
        <Field icon={ShieldCheck} label="Situação" value={data.situacao || data.situacao_cadastral} />
        <Field icon={Calendar} label="Abertura" value={data.abertura || data.data_inicio_atividade} />
        <Field icon={Briefcase} label="Tipo" value={data.tipo || data.porte} />
        <Field icon={Briefcase} label="Natureza Jurídica" value={data.natureza_juridica} />
        <Field icon={Hash} label="Capital Social" value={data.capital_social} />
      </Section>

      {(data.atividade_principal?.[0] || data.cnae_fiscal_descricao) && (
        <Section title="Atividade Principal">
          <Field
            icon={Briefcase}
            label="CNAE"
            value={
              data.atividade_principal?.[0]?.code ||
              data.cnae_fiscal ||
              data.atividade_principal?.[0]?.text
            }
          />
          <Field
            icon={Briefcase}
            label="Descrição"
            value={
              data.atividade_principal?.[0]?.text ||
              data.cnae_fiscal_descricao
            }
          />
        </Section>
      )}

      {(data.logradouro || data.municipio) && (
        <Section title="Endereço">
          <Field icon={MapPin} label="Logradouro" value={`${data.logradouro || ""} ${data.numero || ""}`.trim()} />
          <Field icon={MapPin} label="Complemento" value={data.complemento} />
          <Field icon={MapPin} label="Bairro" value={data.bairro} />
          <Field icon={MapPin} label="CEP" value={data.cep} mono />
          <Field icon={MapPin} label="Município" value={data.municipio} />
          <Field icon={MapPin} label="UF" value={data.uf} />
        </Section>
      )}

      {(data.email || data.telefone) && (
        <Section title="Contato">
          <Field icon={Mail} label="E-mail" value={data.email} />
          <Field icon={Phone} label="Telefone" value={data.telefone} mono />
        </Section>
      )}

      {Array.isArray(data.qsa) && data.qsa.length > 0 && (
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-[0.4em] text-primary/60">Quadro Societário</div>
          <div className="space-y-2">
            {data.qsa.map((q: any, i: number) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="rounded-lg border border-white/5 bg-black/30 p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{q.nome}</div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground truncate">
                      {q.qual}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CpfView({ data }: { data: any }) {
  if (!data) return null;
  return (
    <Section title="Pessoa Física">
      <Field icon={User} label="Nome" value={data.nome} />
      <Field icon={Hash} label="CPF" value={data.cpf} mono />
      <Field icon={Calendar} label="Nascimento" value={data.nascimento || data.dataNascimento} />
      <Field icon={User} label="Sexo" value={data.sexo} />
      <Field icon={User} label="Nome da Mãe" value={data.nomeMae || data.mae} />
      <Field icon={MapPin} label="UF" value={data.uf} />
      <Field icon={ShieldCheck} label="Situação" value={data.situacao} />
    </Section>
  );
}

function TelefoneView({ data }: { data: any }) {
  if (!data) return null;
  return (
    <Section title="Telefone">
      <Field icon={Phone} label="Número" value={data.telefone || data.numero} mono />
      <Field icon={User} label="Titular" value={data.titular || data.nome} />
      <Field icon={Building2} label="Operadora" value={data.operadora} />
      <Field icon={MapPin} label="Localidade" value={data.localidade || data.cidade} />
      <Field icon={MapPin} label="UF" value={data.uf} />
    </Section>
  );
}

function SipniView({ data }: { data: any }) {
  if (!data) return null;
  const paciente = data.paciente;
  const vacinas: any[] = Array.isArray(data.vacinas) ? data.vacinas : [];
  return (
    <div className="space-y-6">
      {paciente && (
        <Section title="Paciente">
          <Field icon={User} label="Nome" value={paciente.nome} />
          <Field icon={Hash} label="CPF" value={data.cpf} mono />
          <Field icon={Calendar} label="Nascimento" value={paciente.nascimento} />
          <Field icon={User} label="Sexo" value={paciente.sexo} />
          <Field icon={User} label="Nome da Mãe" value={paciente.nomeMae} />
        </Section>
      )}

      <div className="space-y-3">
        <div className="text-[10px] uppercase tracking-[0.4em] text-primary/60">
          Histórico de Vacinas — {vacinas.length} registro(s)
        </div>
        {vacinas.length === 0 ? (
          <div className="rounded-xl border border-white/5 bg-black/30 p-6 text-center text-sm text-muted-foreground">
            Nenhum registro de vacinação retornado pelo SIPNI.
          </div>
        ) : (
          <div className="space-y-2">
            {vacinas.map((v, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="rounded-lg border border-white/5 bg-black/30 p-3 grid grid-cols-2 md:grid-cols-5 gap-3"
              >
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Data</div>
                  <div className="text-sm font-mono">{v.data}</div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                    <Syringe className="w-3 h-3 text-primary/70" /> Vacina
                  </div>
                  <div className="text-sm">{v.vacina}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Dose</div>
                  <div className="text-sm">{v.dose}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Lote</div>
                  <div className="text-sm font-mono">{v.lote}</div>
                </div>
                {v.estabelecimento && (
                  <div className="col-span-2 md:col-span-5">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Estabelecimento</div>
                    <div className="text-sm">{v.estabelecimento}</div>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ResultViewer({ tipo, result }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const { success, error, data } = result;
  const hasData = data && Object.keys(data).length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6 rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl overflow-hidden"
    >
      <div
        className={`px-6 py-4 flex items-center justify-between border-b border-white/5 ${
          success ? "bg-primary/5" : "bg-destructive/5"
        }`}
      >
        <div className="flex items-center gap-3">
          {success ? (
            <CheckCircle2 className="w-5 h-5 text-primary" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-destructive" />
          )}
          <div>
            <div className="text-sm font-semibold uppercase tracking-widest">
              {success ? "Consulta concluída" : "Falha na consulta"}
            </div>
            {!success && error && (
              <div className="text-xs text-destructive/80 mt-1">{error}</div>
            )}
          </div>
        </div>
        {hasData && (
          <button
            type="button"
            onClick={() => setShowRaw((s) => !s)}
            className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
          >
            {showRaw ? "Ver formatado" : "Ver JSON bruto"}
          </button>
        )}
      </div>

      <div className="p-6">
        {!hasData && !error && (
          <div className="text-center text-sm text-muted-foreground py-8">
            Nenhum dado retornado.
          </div>
        )}

        {hasData && showRaw && (
          <pre className="text-xs font-mono bg-black/50 border border-white/5 rounded-xl p-4 overflow-auto max-h-[480px] text-foreground/80">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}

        {hasData && !showRaw && (
          <>
            {tipo === "cnpj" && <CnpjView data={data} />}
            {tipo === "cpf" && <CpfView data={data} />}
            {tipo === "telefone" && <TelefoneView data={data} />}
            {tipo === "sipni" && <SipniView data={data} />}
          </>
        )}
      </div>

      <div className="px-6 py-3 border-t border-white/5 flex items-center justify-between text-[10px] uppercase tracking-[0.4em] text-muted-foreground bg-black/20">
        <span>Made by blxckxyz</span>
        <span className="text-primary/60">Infinity Search</span>
      </div>
    </motion.div>
  );
}
