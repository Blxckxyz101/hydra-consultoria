import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search, AlertTriangle, CheckCircle2, History, FileText,
  IdCard, Building2, Phone, User, CreditCard, Heart,
  MapPin, Car, Users, Briefcase, Mail, Cog, Skull, ScrollText,
  Wallet, Cpu, Network, Syringe, Database, Activity, ShieldCheck,
  ChevronRight, X, RotateCcw, Eye, Camera, Fingerprint,
  BarChart2, Receipt, Gift, AlertOctagon, Landmark,
  FileSearch, Scale, Home, Star, Award,
  Calendar, MessageCircle, GraduationCap, Hash, ThumbsUp, ClipboardList,
} from "lucide-react";
import { ResultViewer } from "@/components/consultas/ResultViewer";
import { CpfFullPanel } from "@/components/consultas/CpfFullPanel";
import { InfinityLoader } from "@/components/ui/InfinityLoader";

type Tipo =
  // Pessoa
  | "cpf" | "cpfbasico" | "cpffull" | "nome" | "rg" | "mae" | "pai" | "nasc" | "nis" | "cns"
  | "titulo" | "email" | "pix" | "telefone" | "endereco" | "cep" | "parentes"
  | "dividas" | "bens" | "score" | "score2" | "obito" | "rais" | "mandado"
  | "beneficios" | "certidoes" | "vacinas" | "faculdades" | "irpf" | "assessoria"
  | "registro" | "spc" | "credilink"
  // Fotos
  | "foto" | "biometria"
  | "fotoma" | "fotoce" | "fotosp" | "fotorj" | "fotoms" | "fotonc"
  | "fotoes" | "fototo" | "fotoro" | "fotomapresos" | "fotopi" | "fotopr"
  | "fotodf" | "fotoal" | "fotogo" | "fotopb" | "fotope" | "fotorn"
  | "fotoba" | "fotomg" | "crlvtofoto" | "crlvmtfoto"
  // Veículo
  | "placa" | "chassi" | "renavam" | "motor" | "frota" | "veiculos"
  | "cnh" | "cnhfull" | "cnham" | "cnhnc" | "cnhrs" | "cnhrr"
  | "fotodetran" | "crlvto" | "crlvmt" | "placafipe" | "placaserpro" | "vistoria"
  // Empresa
  | "cnpj" | "fucionarios" | "socios" | "empregos" | "iptu"
  // Processos
  | "processo" | "processos" | "advogadooab" | "advogadooabuf" | "advogadocpf"
  | "oab" | "matricula" | "cheque"
  // Social
  | "likes" | "telegram"
  // Outros
  | "catcpf" | "catnumero";

type TabDef = {
  id: Tipo;
  label: string;
  category: "Pessoa" | "Fotos" | "Veículo" | "Empresa" | "Processos" | "Social" | "Outros";
  placeholder: string;
  hint: string;
  inputMode?: "numeric" | "text";
  icon: React.ComponentType<{ className?: string }>;
  sanitize?: (s: string) => string;
  hidden?: boolean;
};

const cpf11  = (s: string) => s.replace(/\D/g, "").slice(0, 11);
const cnpj14 = (s: string) => s.replace(/\D/g, "").slice(0, 14);
const placa8 = (s: string) => s.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8);

const TABS: TabDef[] = [
  // ── PESSOA ────────────────────────────────────────────────────────────────
  { id: "cpf",        label: "CPF",          category: "Pessoa", placeholder: "00000000000",         hint: "11 dígitos · Padrão / Full / Básico",      inputMode: "numeric", icon: IdCard,        sanitize: cpf11 },
  { id: "nome",       label: "Nome",         category: "Pessoa", placeholder: "Nome completo",       hint: "texto livre",                              icon: User,            sanitize: (s) => s.slice(0, 80) },
  { id: "telefone",   label: "Telefone",     category: "Pessoa", placeholder: "11999999999",         hint: "DDD + número sem DDI 55 · ex: 11999999999",inputMode: "numeric", icon: Phone,         sanitize: (s) => { const d = s.replace(/\D/g, ""); return d.startsWith("55") && d.length > 11 ? d.slice(2, 13) : d.slice(0, 13); } },
  { id: "email",      label: "Email",        category: "Pessoa", placeholder: "exemplo@dominio.com", hint: "texto livre",                              icon: Mail },
  { id: "pix",        label: "PIX",          category: "Pessoa", placeholder: "CPF, email, telefone ou chave aleatória",           hint: "ex: 12345678900 · email@dominio.com · +5511999999999 · chave-uuid",             icon: Wallet },
  { id: "parentes",   label: "Parentes",     category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos — rede familiar",               inputMode: "numeric", icon: Users,         sanitize: cpf11 },
  { id: "rg",         label: "RG",           category: "Pessoa", placeholder: "RG ou identidade",    hint: "texto/numérico",                           icon: ScrollText },
  { id: "mae",        label: "Mãe",          category: "Pessoa", placeholder: "CPF do filho(a)",     hint: "11 dígitos — busca pela mãe",              inputMode: "numeric", icon: Heart,         sanitize: cpf11 },
  { id: "pai",        label: "Pai",          category: "Pessoa", placeholder: "CPF do filho(a)",     hint: "11 dígitos — busca pelo pai",              inputMode: "numeric", icon: Heart,         sanitize: cpf11 },
  { id: "endereco",   label: "Endereço",     category: "Pessoa", placeholder: "00000000000",         hint: "CPF · endereço residencial · Skylers",     inputMode: "numeric", icon: MapPin,        sanitize: cpf11 },
  { id: "cep",        label: "CEP",          category: "Pessoa", placeholder: "00000000",            hint: "8 dígitos",                                inputMode: "numeric", icon: MapPin,        sanitize: (s) => s.replace(/\D/g, "").slice(0, 8) },
  { id: "nasc",       label: "Nascimento",   category: "Pessoa", placeholder: "Digite o CPF",         hint: "Informe o CPF para obter a data de nascimento cadastrada · Skylers",       inputMode: "numeric", icon: Calendar,      sanitize: cpf11 },
  { id: "obito",      label: "Óbito",        category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos",                               inputMode: "numeric", icon: Skull,         sanitize: cpf11 },
  { id: "nis",        label: "NIS/PIS",      category: "Pessoa", placeholder: "NIS/PIS",             hint: "11 dígitos",                               inputMode: "numeric", icon: CreditCard,    sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  { id: "titulo",     label: "Título",       category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · título eleitor · Skylers",    inputMode: "numeric", icon: Award,         sanitize: cpf11 },
  { id: "score",      label: "Score",        category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · score de crédito · Skylers",  inputMode: "numeric", icon: BarChart2,     sanitize: cpf11 },
  { id: "score2",     label: "Score 2",      category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · score alternativo · Skylers", inputMode: "numeric", icon: BarChart2,     sanitize: cpf11 },
  { id: "irpf",       label: "IRPF",         category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · declaração IR · Skylers",     inputMode: "numeric", icon: Receipt,       sanitize: cpf11 },
  { id: "beneficios", label: "Benefícios",   category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · Bolsa Família/BPC · Skylers", inputMode: "numeric", icon: Gift,          sanitize: cpf11 },
  { id: "mandado",    label: "Mandado",      category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · mandado de prisão · Skylers", inputMode: "numeric", icon: AlertOctagon,  sanitize: cpf11 },
  { id: "dividas",    label: "Dívidas",      category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · BACEN/FGTS · Skylers",        inputMode: "numeric", icon: Landmark,      sanitize: cpf11 },
  { id: "bens",       label: "Bens",         category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · patrimônio · Skylers",        inputMode: "numeric", icon: Star,          sanitize: cpf11 },
  { id: "certidoes",  label: "Certidões",    category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · Skylers",                     inputMode: "numeric", icon: FileSearch,    sanitize: cpf11 },
  { id: "vacinas",    label: "Vacinas",      category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos",                               inputMode: "numeric", icon: Syringe,       sanitize: cpf11 },
  { id: "rais",       label: "RAIS",         category: "Pessoa", placeholder: "CPF",                 hint: "CPF · histórico empregos · Skylers",       inputMode: "numeric", icon: Briefcase,     sanitize: cpf11 },
  { id: "faculdades", label: "Faculdades",   category: "Pessoa", placeholder: "CPF",                 hint: "CPF · educação superior · Skylers",        inputMode: "numeric", icon: GraduationCap, sanitize: cpf11 },
  { id: "assessoria", label: "Assessoria",   category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · Skylers",                     inputMode: "numeric", icon: FileText,      sanitize: cpf11 },
  { id: "registro",   label: "Registro",     category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · Skylers",                     inputMode: "numeric", icon: ClipboardList, sanitize: cpf11 },
  { id: "spc",        label: "CPF SPC",      category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · dados de crédito · Skylers",  inputMode: "numeric", icon: CreditCard,    sanitize: cpf11 },
  { id: "credilink",  label: "CrediLink",    category: "Pessoa", placeholder: "CPF",                 hint: "11 dígitos · score financeiro · Skylers",  inputMode: "numeric", icon: CreditCard,    sanitize: cpf11 },
  { id: "cpffull",    label: "CPF Full",     category: "Pessoa", placeholder: "00000000000",         hint: "11 dígitos · consulta completa · 17 módulos", inputMode: "numeric", icon: IdCard,     sanitize: cpf11, hidden: true },
  { id: "cpfbasico",  label: "CPF Básico",   category: "Pessoa", placeholder: "00000000000",         hint: "11 dígitos · Skylers",                     inputMode: "numeric", icon: FileText,      sanitize: cpf11, hidden: true },

  // ── FOTOS ─────────────────────────────────────────────────────────────────
  { id: "foto",          label: "Foto CNH",       category: "Fotos", placeholder: "CPF", hint: "11 dígitos · foto da CNH · Skylers",        inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "biometria",     label: "Biometria",      category: "Fotos", placeholder: "CPF", hint: "11 dígitos · foto biométrica · Skylers",    inputMode: "numeric", icon: Fingerprint, sanitize: cpf11 },
  { id: "fotoma",        label: "Foto MA",        category: "Fotos", placeholder: "CPF", hint: "Maranhão · Skylers",                        inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotoce",        label: "Foto CE",        category: "Fotos", placeholder: "CPF", hint: "Ceará · Skylers",                           inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotosp",        label: "Foto SP",        category: "Fotos", placeholder: "CPF", hint: "São Paulo · Skylers",                       inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotorj",        label: "Foto RJ",        category: "Fotos", placeholder: "CPF", hint: "Rio de Janeiro · Skylers",                  inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotoms",        label: "Foto MS",        category: "Fotos", placeholder: "CPF", hint: "Mato Grosso do Sul · Skylers",              inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotonc",        label: "Foto Nacional",  category: "Fotos", placeholder: "CPF", hint: "Nacional · Skylers",                        inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotoes",        label: "Foto ES",        category: "Fotos", placeholder: "CPF", hint: "Espírito Santo · Skylers",                  inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fototo",        label: "Foto TO",        category: "Fotos", placeholder: "CPF", hint: "Tocantins · Skylers",                       inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotoro",        label: "Foto RO",        category: "Fotos", placeholder: "CPF", hint: "Rondônia · Skylers",                        inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotomapresos",  label: "Foto MA Presos", category: "Fotos", placeholder: "CPF", hint: "Maranhão (presos) · Skylers",               inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotopi",        label: "Foto PI",        category: "Fotos", placeholder: "CPF", hint: "Piauí · Skylers",                           inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotopr",        label: "Foto PR",        category: "Fotos", placeholder: "CPF", hint: "Paraná · Skylers",                          inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotodf",        label: "Foto DF",        category: "Fotos", placeholder: "CPF", hint: "Distrito Federal · Skylers",                inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotoal",        label: "Foto AL",        category: "Fotos", placeholder: "CPF", hint: "Alagoas · Skylers",                         inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotogo",        label: "Foto GO",        category: "Fotos", placeholder: "CPF", hint: "Goiás · Skylers",                           inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotopb",        label: "Foto PB",        category: "Fotos", placeholder: "CPF", hint: "Paraíba · Skylers",                         inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotope",        label: "Foto PE",        category: "Fotos", placeholder: "CPF", hint: "Pernambuco · Skylers",                      inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotorn",        label: "Foto RN",        category: "Fotos", placeholder: "CPF", hint: "Rio Grande do Norte · Skylers",             inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotoba",        label: "Foto BA",        category: "Fotos", placeholder: "CPF", hint: "Bahia · Skylers",                           inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "fotomg",        label: "Foto MG",        category: "Fotos", placeholder: "CPF", hint: "Minas Gerais · Skylers",                    inputMode: "numeric", icon: Camera,     sanitize: cpf11 },
  { id: "crlvtofoto",    label: "CRLV TO Foto",   category: "Fotos", placeholder: "ABC1234", hint: "placa · Tocantins · Skylers",          icon: Camera,          sanitize: placa8 },
  { id: "crlvmtfoto",    label: "CRLV MT Foto",   category: "Fotos", placeholder: "ABC1234", hint: "placa · Mato Grosso · Skylers",        icon: Camera,          sanitize: placa8 },

  // ── VEÍCULO ───────────────────────────────────────────────────────────────
  { id: "placa",       label: "Placa",        category: "Veículo", placeholder: "ABC1234",        hint: "Mercosul ou antiga",                 icon: Car,         sanitize: placa8 },
  { id: "chassi",      label: "Chassi",       category: "Veículo", placeholder: "9BWZZZ...",      hint: "VIN 17 caracteres",                  icon: Cog,         sanitize: (s) => s.toUpperCase().slice(0, 17) },
  { id: "renavam",     label: "Renavam",      category: "Veículo", placeholder: "00000000000",    hint: "11 dígitos",                         inputMode: "numeric", icon: ScrollText, sanitize: (s) => s.replace(/\D/g, "").slice(0, 11) },
  { id: "motor",       label: "Motor",        category: "Veículo", placeholder: "Nº do motor",    hint: "alfanumérico",                       icon: Cpu },
  { id: "veiculos",    label: "Veículos/CPF", category: "Veículo", placeholder: "CPF",            hint: "CPF do proprietário · Skylers",      inputMode: "numeric", icon: Car,        sanitize: cpf11 },
  { id: "cnh",         label: "CNH",          category: "Veículo", placeholder: "CPF",            hint: "11 dígitos",                         inputMode: "numeric", icon: IdCard,     sanitize: cpf11 },
  { id: "cnhfull",     label: "CNH Full",     category: "Veículo", placeholder: "CPF",            hint: "CPF · dados completos CNH · Skylers",inputMode: "numeric", icon: ShieldCheck, sanitize: cpf11 },
  { id: "cnham",       label: "CNH AM",       category: "Veículo", placeholder: "CPF",            hint: "Amazonas · Skylers",                 inputMode: "numeric", icon: IdCard,     sanitize: cpf11 },
  { id: "cnhnc",       label: "CNH NC",       category: "Veículo", placeholder: "CPF",            hint: "Skylers",                            inputMode: "numeric", icon: IdCard,     sanitize: cpf11 },
  { id: "cnhrs",       label: "CNH RS",       category: "Veículo", placeholder: "CPF",            hint: "Rio Grande do Sul · Skylers",        inputMode: "numeric", icon: IdCard,     sanitize: cpf11 },
  { id: "cnhrr",       label: "CNH RR",       category: "Veículo", placeholder: "CPF",            hint: "Roraima · Skylers",                  inputMode: "numeric", icon: IdCard,     sanitize: cpf11 },
  { id: "frota",       label: "Frota",        category: "Veículo", placeholder: "CPF/CNPJ",       hint: "frota do titular",                   icon: Network,     sanitize: (s) => s.replace(/\D/g, "").slice(0, 14) },
  { id: "fotodetran",  label: "Foto Detran",  category: "Veículo", placeholder: "ABC1234",        hint: "placa · foto Detran · Skylers",      icon: Camera,      sanitize: placa8 },
  { id: "crlvto",      label: "CRLV TO",      category: "Veículo", placeholder: "ABC1234",        hint: "placa · Tocantins · Skylers",        icon: FileText,    sanitize: placa8 },
  { id: "crlvmt",      label: "CRLV MT",      category: "Veículo", placeholder: "ABC1234",        hint: "placa · Mato Grosso · Skylers",      icon: FileText,    sanitize: placa8 },
  { id: "placafipe",   label: "Placa FIPE",   category: "Veículo", placeholder: "ABC1234",        hint: "placa · tabela FIPE · Skylers",      icon: Car,         sanitize: placa8 },
  { id: "placaserpro", label: "Placa Serpro", category: "Veículo", placeholder: "ABC1234",        hint: "placa · Serpro · Skylers",           icon: Car,         sanitize: placa8 },
  { id: "vistoria",    label: "Vistoria",     category: "Veículo", placeholder: "ABC1234",        hint: "placa · vistoria veicular · Skylers",icon: ShieldCheck, sanitize: placa8 },

  // ── EMPRESA ───────────────────────────────────────────────────────────────
  { id: "cnpj",        label: "CNPJ",         category: "Empresa", placeholder: "00000000000000", hint: "14 dígitos",            inputMode: "numeric", icon: Building2, sanitize: cnpj14 },
  { id: "socios",      label: "Sócios",       category: "Empresa", placeholder: "CNPJ",           hint: "14 dígitos",            inputMode: "numeric", icon: Users,     sanitize: cnpj14 },
  { id: "fucionarios", label: "Funcionários", category: "Empresa", placeholder: "CNPJ",           hint: "14 dígitos · Skylers",  inputMode: "numeric", icon: Users,     sanitize: cnpj14 },
  { id: "empregos",    label: "Empregos",     category: "Empresa", placeholder: "CPF",            hint: "histórico empregos",    inputMode: "numeric", icon: Briefcase, sanitize: cpf11 },
  { id: "iptu",        label: "IPTU",         category: "Empresa", placeholder: "CPF",            hint: "11 dígitos · Skylers",  inputMode: "numeric", icon: Home,      sanitize: cpf11 },

  // ── PROCESSOS ─────────────────────────────────────────────────────────────
  { id: "processo",       label: "Processo",       category: "Processos", placeholder: "0000000-00.0000.0.00.0000", hint: "número do processo · Skylers",    icon: Scale },
  { id: "processos",      label: "Processos/CPF",  category: "Processos", placeholder: "CPF",    hint: "CPF · processos judiciais · Skylers",    inputMode: "numeric", icon: Scale,      sanitize: cpf11 },
  { id: "advogadooab",    label: "Adv. por OAB",   category: "Processos", placeholder: "123456/SP", hint: "número OAB/UF · Skylers",             icon: User },
  { id: "advogadooabuf",  label: "Adv. OAB por UF",category: "Processos", placeholder: "SP",     hint: "sigla do estado · Skylers",              icon: User,        sanitize: (s) => s.toUpperCase().slice(0, 2) },
  { id: "advogadocpf",    label: "Adv. por CPF",   category: "Processos", placeholder: "CPF",    hint: "CPF do advogado · Skylers",              inputMode: "numeric", icon: User,      sanitize: cpf11 },
  { id: "oab",            label: "OAB",            category: "Processos", placeholder: "123456/SP", hint: "número OAB/UF · Skylers",             icon: Award },
  { id: "matricula",      label: "Matrícula",      category: "Processos", placeholder: "0000000",hint: "número de matrícula · Skylers",           icon: Hash,        sanitize: (s) => s.replace(/\D/g, "").slice(0, 20) },
  { id: "cheque",         label: "Cheque",         category: "Processos", placeholder: "000000000", hint: "número do cheque · Skylers",          icon: CreditCard,  sanitize: (s) => s.replace(/\D/g, "").slice(0, 20) },

  // ── SOCIAL ────────────────────────────────────────────────────────────────
  { id: "telegram", label: "Telegram / Nick", category: "Social", placeholder: "usuario",      hint: "username sem @ · busca Telegram · Skylers", icon: MessageCircle, sanitize: (s) => s.replace(/^@/, "").slice(0, 60) },
  { id: "likes",    label: "Likes",           category: "Social", placeholder: "ID numérico",  hint: "ID da conta · região BR · Skylers",         inputMode: "numeric", icon: ThumbsUp, sanitize: (s) => s.replace(/\D/g, "") },

  // ── OUTROS ────────────────────────────────────────────────────────────────
  { id: "cns",       label: "CNS / SUS",     category: "Outros", placeholder: "Cartão SUS",   hint: "15 dígitos",                   inputMode: "numeric", icon: Heart,    sanitize: (s) => s.replace(/\D/g, "").slice(0, 15) },
  { id: "catcpf",    label: "Catálogo CPF",  category: "Outros", placeholder: "CPF",          hint: "11 dígitos · Skylers",         inputMode: "numeric", icon: Database, sanitize: cpf11 },
  { id: "catnumero", label: "Catálogo Nº",   category: "Outros", placeholder: "11999999999",  hint: "número de telefone · Skylers", inputMode: "numeric", icon: Phone,    sanitize: (s) => s.replace(/\D/g, "").slice(0, 13) },
];

const CATEGORIES = ["Pessoa", "Fotos", "Veículo", "Empresa", "Processos", "Social", "Outros"] as const;

const CATEGORY_GRADIENT: Record<string, string> = {
  Pessoa:    "from-rose-400 to-pink-300",
  Fotos:     "from-purple-400 to-indigo-300",
  Veículo:   "from-amber-400 to-orange-300",
  Empresa:   "from-violet-400 to-fuchsia-300",
  Processos: "from-emerald-400 to-teal-300",
  Social:    "from-blue-400 to-cyan-300",
  Outros:    "from-sky-400 to-cyan-300",
};

type Historico = Array<{ id: number; tipo: string; query: string; username: string; success: boolean; result: unknown | null; createdAt: string }>;

const INTERNO_TO_TIPO: Record<string, string> = {
  "iseek-cpf": "cpf", "iseek-cpfbasico": "cpfbasico",
  "iseek-dados---nasc": "nasc", "iseek-dados---parentes": "parentes",
  "iseek-dados---mae": "mae", "iseek-dados---pai": "pai",
  "iseek-dados---obito": "obito", "iseek-dados---nis": "nis",
  "iseek-dados---catcpf": "catcpf", "iseek-dados---catnumero": "catnumero",
  "iseek-dados---rg": "rg", "iseek-dados---vacinas": "vacinas",
  "iseek-dados---endereco": "endereco", "iseek-dados---registro": "registro",
  "iseek-dados---assessoria": "assessoria", "iseek-dados---score": "score",
  "iseek-dados---titulo": "titulo", "iseek-dados---irpf": "irpf",
  "iseek-dados---beneficios": "beneficios", "iseek-dados---mandado": "mandado",
  "iseek-dados---dividas": "dividas", "iseek-dados---bens": "bens",
  "iseek-dados---processos": "processos", "credilink": "credilink",
  "cnh-full": "cnhfull", "placa-fipe": "placafipe",
  "iseek-fotos---fotocnh": "foto", "iseek-fotos---biometria": "biometria",
  "unknown": "consulta",
};

function friendlyTipo(rawTipo: string): string {
  const stripped = rawTipo.replace(/^skylers:/, "");
  const mapped = INTERNO_TO_TIPO[stripped] ?? stripped;
  const tab = TABS.find(t => t.id === mapped);
  return (tab?.label ?? mapped).toUpperCase();
}

const PANEL_EXTERNAL_TIPOS = new Set<Tipo>([
  "cpf", "nome", "rg", "mae", "pai", "parentes", "obito", "nis", "cns", "vacinas",
  "telefone", "email", "pix", "cep", "placa", "chassi", "renavam", "motor", "cnh",
  "frota", "cnpj", "socios", "empregos",
]);

const SKYLERS_ONLY_TIPOS = new Set<Tipo>([
  "cpfbasico", "titulo", "score", "score2", "irpf", "beneficios", "mandado",
  "dividas", "bens", "certidoes", "cnhfull", "foto", "biometria",
  "nasc", "endereco", "rais", "faculdades", "assessoria", "registro", "credilink", "spc",
  "fotoma","fotoce","fotosp","fotorj","fotoms","fotonc","fotoes","fototo","fotoro",
  "fotomapresos","fotopi","fotopr","fotodf","fotoal","fotogo","fotopb","fotope",
  "fotorn","fotoba","fotomg","crlvtofoto","crlvmtfoto",
  "veiculos","fotodetran","crlvto","crlvmt","placafipe","placaserpro","vistoria",
  "cnham","cnhnc","cnhrs","cnhrr",
  "fucionarios","iptu",
  "processo","processos","advogadooab","advogadooabuf","advogadocpf","oab","matricula","cheque",
  "likes","telegram",
  "catcpf","catnumero",
]);

type ExternalBase = "skylers" | "credilink";
const CREDILINK_BASES = new Set<Tipo>(["cpf"]);

export default function Consultas() {
  const [tab, setTab] = useState<Tipo>("cpf");
  const [cpfVariant, setCpfVariant] = useState<"cpf" | "cpffull" | "cpfbasico">("cpf");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ success: boolean; error?: string | null; data?: unknown } | null>(null);
  const [pending, setPending] = useState(false);
  const [activeCategory, setActiveCategory] = useState<typeof CATEGORIES[number]>("Pessoa");
  const [showBaseSelector, setShowBaseSelector] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<{ tipo: Tipo; dados: string } | null>(null);
  const baseSelectorRef = useRef<HTMLDivElement>(null);
  const [cpfFullQuery, setCpfFullQuery] = useState<string | null>(null);
  const [moduleSearch, setModuleSearch] = useState("");
  const queryClient = useQueryClient();

  const [skylersTotal, setSkylersTotal] = useState<number | null>(null);
  const [skylersLimit, setSkylersLimit] = useState<number>(25);
  const [isAdmin, setIsAdmin] = useState(false);

  type ProviderStatus = { online: boolean; ms: number; circuitOpen: boolean } | null;
  const [geassStatus, setGeassStatus]     = useState<ProviderStatus>(null);
  const [skylersStatus, setSkylersStatus] = useState<ProviderStatus>(null);

  useEffect(() => {
    const token = localStorage.getItem("infinity_token");
    fetch("/api/infinity/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((d: { skylersTotal?: number; skylersLimit?: number; role?: string }) => {
        setSkylersTotal(d.skylersTotal ?? 0);
        setSkylersLimit(d.skylersLimit ?? 25);
        setIsAdmin(d.role === "admin");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const fetchPing = () => {
      const token = localStorage.getItem("infinity_token");
      fetch("/api/infinity/providers/ping", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then((d: { geass: ProviderStatus; skylers: ProviderStatus }) => {
          setGeassStatus(d.geass);
          setSkylersStatus(d.skylers);
        })
        .catch(() => {});
    };
    fetchPing();
    const id = setInterval(fetchPing, 60_000);
    return () => clearInterval(id);
  }, []);

  // Scroll base selector into view on desktop when it appears
  useEffect(() => {
    if (showBaseSelector && baseSelectorRef.current) {
      setTimeout(() => {
        baseSelectorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 80);
    }
  }, [showBaseSelector]);

  const historyKey = ["infinity-history", 20] as const;
  const { data: history } = useQuery<Historico>({
    queryKey: historyKey,
    queryFn: async () => {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/consultas?limit=20", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0]!;
  const ActiveIcon = activeTab.icon;

  const executeQuery = async (tipo: Tipo, dados: string, base: ExternalBase | null) => {
    setResult(null);
    setPending(true);
    setShowBaseSelector(false);
    setPendingQuery(null);
    try {
      const token = localStorage.getItem("infinity_token");
      let endpoint: string;
      let body: Record<string, string>;

      if (tipo === "likes" || tipo === "telegram") {
        endpoint = "/api/infinity/skylers";
        body = { endpoint: tipo, valor: dados };
      } else if (base === "credilink") {
        endpoint = "/api/infinity/external/skylers";
        body = { tipo: "credilink", dados };
      } else if (base) {
        endpoint = `/api/infinity/external/${base}`;
        body = { tipo, dados };
      } else {
        endpoint = `/api/infinity/consultas/${tipo}`;
        body = { tipo, dados };
      }

      const fetchCtrl = new AbortController();
      const fetchTimer = setTimeout(() => fetchCtrl.abort(), 18_000);
      let r: Response;
      try {
        r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
          signal: fetchCtrl.signal,
        });
      } finally {
        clearTimeout(fetchTimer);
      }
      const data = await r.json() as { success: boolean; error?: string | null; data?: unknown; rateLimited?: boolean };
      if (data.rateLimited) {
        setResult({ success: false, error: data.error ?? "Limite diário atingido." });
        toast.error("Limite diário atingido.");
      } else if (base && base !== "credilink" && data.success && typeof data.data === "string") {
        setResult({ success: true, data: { fields: [], sections: [], raw: data.data } });
        toast.success("Consulta concluída");
      } else {
        setResult(data);
        if (data.success) toast.success("Consulta concluída");
        else toast.error(data.error ?? "Sem dados para esta consulta");
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      const msg = isAbort
        ? "Serviços OSINT temporariamente indisponíveis. Tente novamente em instantes."
        : err instanceof Error ? err.message : "Falha na requisição";
      setResult({ success: false, error: msg, data: { fields: [], sections: [], raw: "" } });
      toast.error(msg);
    } finally {
      setPending(false);
      queryClient.invalidateQueries({ queryKey: historyKey });
      const t2 = localStorage.getItem("infinity_token");
      fetch("/api/infinity/me", { headers: { Authorization: `Bearer ${t2}` } })
        .then(r => r.json())
        .then((d: { skylersTotal?: number; skylersLimit?: number; role?: string }) => {
          setSkylersTotal(d.skylersTotal ?? 0);
          setSkylersLimit(d.skylersLimit ?? 25);
          setIsAdmin(d.role === "admin");
        })
        .catch(() => {});
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || pending) return;
    const effectiveTab: Tipo = tab === "cpf" ? cpfVariant : tab;
    if (effectiveTab === "cpffull") {
      setCpfFullQuery(query.trim());
      return;
    }
    if (SKYLERS_ONLY_TIPOS.has(effectiveTab)) {
      await executeQuery(effectiveTab, query.trim(), "skylers");
      return;
    }
    if (PANEL_EXTERNAL_TIPOS.has(effectiveTab)) {
      setPendingQuery({ tipo: effectiveTab, dados: query.trim() });
      setShowBaseSelector(true);
      return;
    }
    await executeQuery(effectiveTab, query.trim(), null);
  };

  const repeatQuery = (tipo: string, dados: string) => {
    const tabDef = TABS.find((t) => t.id === tipo);
    if (!tabDef) return;
    setActiveCategory(tabDef.category);
    setQuery(dados);
    setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Remap hidden CPF variants back to the unified CPF tile
    if (tabDef.id === "cpffull" || tabDef.id === "cpfbasico") {
      setTab("cpf");
      setCpfVariant(tabDef.id);
      if (tabDef.id === "cpffull") {
        setCpfFullQuery(dados);
      } else {
        executeQuery("cpfbasico", dados, "skylers");
      }
      return;
    }
    setTab(tabDef.id);
    if (SKYLERS_ONLY_TIPOS.has(tabDef.id)) {
      executeQuery(tabDef.id, dados, "skylers");
    } else if (PANEL_EXTERNAL_TIPOS.has(tabDef.id)) {
      setPendingQuery({ tipo: tabDef.id, dados });
      setShowBaseSelector(true);
    } else {
      executeQuery(tabDef.id, dados, null);
    }
  };

  const loadSavedResult = (item: Historico[number]) => {
    if (!item.result) return;
    setResult({ success: item.success, error: null, data: item.result });
    const tabDef = TABS.find((t) => t.id === item.tipo);
    if (tabDef) { setActiveCategory(tabDef.category); setTab(tabDef.id); }
    setQuery(item.query);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const searchTrim = moduleSearch.trim().toLowerCase();
  const isSearching = searchTrim.length > 0;
  const tabsInCategory = isSearching
    ? TABS.filter((t) =>
        !t.hidden && (
          t.label.toLowerCase().includes(searchTrim) ||
          t.id.toLowerCase().includes(searchTrim) ||
          t.category.toLowerCase().includes(searchTrim) ||
          t.hint.toLowerCase().includes(searchTrim)
        )
      )
    : TABS.filter((t) => t.category === activeCategory && !t.hidden);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hero */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl sm:text-3xl font-bold tracking-[0.25em] uppercase bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(to right, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, white))" }}
          >
            Consultas
          </motion.h1>
          <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-2">
            {TABS.length} módulos · Geass + Skylers API conectados
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {skylersTotal !== null && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors ${
                isAdmin
                  ? "bg-primary/5 border-primary/20"
                  : skylersTotal >= skylersLimit
                  ? "bg-rose-400/15 border-rose-400/40"
                  : skylersTotal >= skylersLimit * 0.8
                  ? "bg-amber-400/10 border-amber-400/30"
                  : "bg-sky-400/10 border-sky-400/20"
              }`}
              title={isAdmin ? "Admins têm acesso ilimitado à Skylers" : "Quota diária Skylers — reseta à meia-noite"}
            >
              <Network className={`w-3 h-3 ${isAdmin ? "text-primary/60" : skylersTotal >= skylersLimit ? "text-rose-400" : skylersTotal >= skylersLimit * 0.8 ? "text-amber-400" : "text-sky-400"}`} />
              <span className={`text-[10px] uppercase tracking-widest font-semibold ${isAdmin ? "text-primary/60" : skylersTotal >= skylersLimit ? "text-rose-300" : skylersTotal >= skylersLimit * 0.8 ? "text-amber-300" : "text-sky-300"}`}>
                {isAdmin ? "Skylers ∞" : `Skylers ${skylersTotal}/${skylersLimit}`}
              </span>
            </motion.div>
          )}
          {/* Header provider status — reflects real Skylers health */}
          {skylersStatus === null ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
              <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold">Verificando</span>
            </div>
          ) : skylersStatus.online && !skylersStatus.circuitOpen ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-400/10 border border-emerald-400/30">
              <div className="relative">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              </div>
              <span className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">Online</span>
            </div>
          ) : skylersStatus.circuitOpen ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-400/10 border border-amber-400/30">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-[10px] uppercase tracking-widest text-amber-300 font-semibold">Degradado</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-400/10 border border-rose-400/30">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span className="text-[10px] uppercase tracking-widest text-rose-300 font-semibold">Offline</span>
            </div>
          )}
        </div>
      </div>

      {/* Skylers urgent warning */}
      {!isAdmin && skylersTotal !== null && skylersTotal >= skylersLimit - 4 && skylersTotal < skylersLimit && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/8 backdrop-blur-xl px-4 py-3"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-xs text-amber-300/90 leading-relaxed">
            <span className="font-bold">Atenção:</span> você tem apenas <span className="font-bold text-amber-200">{skylersLimit - skylersTotal}</span> consulta{skylersLimit - skylersTotal !== 1 ? "s" : ""} Skylers restante{skylersLimit - skylersTotal !== 1 ? "s" : ""}. Entre em contato com o suporte para ampliar seu limite.
          </p>
        </motion.div>
      )}
      {!isAdmin && skylersTotal !== null && skylersTotal >= skylersLimit && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/8 backdrop-blur-xl px-4 py-3"
        >
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <p className="text-xs text-rose-300/90 leading-relaxed">
            <span className="font-bold">Limite Skylers atingido.</span> Suas {skylersLimit} consultas vitalícias foram utilizadas. Contate o suporte para adquirir mais.
          </p>
        </motion.div>
      )}

      {/* Recentes */}
      {history && history.length > 0 && (() => {
        const seen = new Set<string>();
        const recentes: Array<{ tipo: string; query: string }> = [];
        for (const h of history) {
          const key = `${h.tipo}:${h.query}`;
          if (!seen.has(key) && recentes.length < 5) { seen.add(key); recentes.push({ tipo: h.tipo, query: h.query }); }
        }
        if (recentes.length === 0) return null;
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <History className="w-3 h-3 text-muted-foreground/40" />
              <span className="text-[9px] uppercase tracking-[0.4em] text-muted-foreground/40">Recentes</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {recentes.map((h) => (
                <button
                  key={`${h.tipo}:${h.query}`}
                  onClick={() => repeatQuery(h.tipo, h.query)}
                  className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/8 bg-white/4 hover:bg-primary/10 hover:border-primary/30 text-muted-foreground hover:text-primary transition-all text-[10px]"
                >
                  <span className="font-bold uppercase tracking-wide text-primary/50 group-hover:text-primary/80 transition-colors">{friendlyTipo(h.tipo)}</span>
                  <span className="text-muted-foreground/30">·</span>
                  <span className="font-mono">{h.query.length > 16 ? h.query.slice(0, 16) + "…" : h.query}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Search bar + Category pills */}
      <div className="space-y-3">
        {/* Module search input */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
          <input
            value={moduleSearch}
            onChange={(e) => setModuleSearch(e.target.value)}
            placeholder="Buscar módulo… (ex: placa, score, foto, telegram)"
            className="w-full bg-black/30 border border-white/8 rounded-xl pl-9 pr-9 py-2.5 text-[12px] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
          />
          {moduleSearch && (
            <button
              onClick={() => setModuleSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category pills — hidden during search */}
        {!isSearching && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat;
              const count = TABS.filter((t) => t.category === cat && !t.hidden).length;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`shrink-0 px-4 py-2 rounded-full text-[10px] uppercase tracking-[0.3em] font-bold transition-all border ${
                    isActive
                      ? `bg-gradient-to-r ${CATEGORY_GRADIENT[cat]} text-black border-transparent shadow-[0_0_24px_-4px_rgba(56,189,248,0.5)]`
                      : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20"
                  }`}
                >
                  {cat} <span className="opacity-60">· {count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Search results label */}
        {isSearching && (
          <div className="flex items-center gap-2">
            <Search className="w-3 h-3 text-muted-foreground/40" />
            <span className="text-[9px] uppercase tracking-[0.4em] text-muted-foreground/40">
              {tabsInCategory.length} resultado{tabsInCategory.length !== 1 ? "s" : ""} para &ldquo;{moduleSearch}&rdquo;
            </span>
          </div>
        )}
      </div>

      {/* Tab grid */}
      <motion.div
        key={isSearching ? `search-${searchTrim}` : activeCategory}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2"
      >
        {tabsInCategory.length === 0 && (
          <div className="col-span-full py-10 flex flex-col items-center gap-3 text-muted-foreground/40">
            <Search className="w-8 h-8 opacity-30" />
            <p className="text-xs">Nenhum módulo encontrado para &ldquo;{moduleSearch}&rdquo;</p>
          </div>
        )}
        {tabsInCategory.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setQuery(""); setResult(null); setCpfFullQuery(null); setModuleSearch(""); setActiveCategory(t.category); }}
              className={`relative group flex flex-col items-center gap-1.5 p-3 sm:p-4 rounded-xl border transition-all ${
                isActive
                  ? "bg-primary/15 border-primary/50 shadow-[0_0_20px_-4px_rgba(56,189,248,0.6)]"
                  : "bg-black/20 border-white/5 hover:border-white/15 hover:bg-white/5"
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"} transition-colors`} />
              <span className={`text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-center leading-tight ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}>
                {t.label}
              </span>
              {isSearching && (
                <span className={`text-[7px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
                  CATEGORY_GRADIENT[t.category]
                    ? `bg-gradient-to-r ${CATEGORY_GRADIENT[t.category]} text-black border-transparent opacity-80`
                    : "bg-white/5 border-white/10 text-muted-foreground"
                }`}>
                  {t.category}
                </span>
              )}
            </button>
          );
        })}
      </motion.div>

      {/* Query form + result */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.4em] text-primary/70">
            <ActiveIcon className="w-3.5 h-3.5" />
            {activeTab.label} · {activeTab.hint}
          </div>

          {/* CPF sub-type selector */}
          {tab === "cpf" && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] uppercase tracking-[0.4em] text-muted-foreground/40">Tipo:</span>
              {([
                { id: "cpf"      as const, label: "Padrão",   hint: "Geass" },
                { id: "cpffull"  as const, label: "Completo",  hint: "17 módulos" },
                { id: "cpfbasico"as const, label: "Básico",    hint: "Skylers" },
              ]).map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setCpfVariant(v.id)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] uppercase tracking-widest font-bold transition-all ${
                    cpfVariant === v.id
                      ? "bg-primary/20 border-primary/50 text-primary shadow-[0_0_12px_-2px_color-mix(in_srgb,var(--color-primary)_50%,transparent)]"
                      : "bg-white/5 border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground"
                  }`}
                >
                  {v.label}
                  <span className="opacity-40 font-normal text-[8px]">· {v.hint}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <input
                value={query}
                onChange={(e) => setQuery(activeTab.sanitize ? activeTab.sanitize(e.target.value) : e.target.value)}
                placeholder={activeTab.placeholder}
                inputMode={activeTab.inputMode}
                className="w-full bg-black/40 border border-white/10 rounded-xl pl-12 pr-4 py-3.5 sm:py-4 font-mono tracking-wider text-base sm:text-lg focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={!query.trim() || pending}
              className="text-black font-bold uppercase tracking-[0.3em] text-xs px-6 sm:px-8 py-3.5 sm:py-0 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ background: "var(--color-primary)", boxShadow: pending ? "" : "0 0 0 transparent", ["--tw-shadow" as string]: "" }}
              onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).style.boxShadow = "0 0 30px color-mix(in srgb, var(--color-primary) 45%, transparent)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ""; }}
            >
              {pending ? "Consultando" : "Consultar"}
            </button>
          </div>
        </form>

        <AnimatePresence mode="wait">
          {showBaseSelector && pendingQuery && !pending && (
            <motion.div
              key="base-selector"
              ref={baseSelectorRef}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="mt-5"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[9px] uppercase tracking-[0.5em] text-muted-foreground/50 mb-1">Origem dos dados</p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-foreground/90 bg-white/5 border border-white/10 px-2.5 py-0.5 rounded-md">{pendingQuery.dados}</span>
                    <span className="text-[10px] text-muted-foreground">— selecione a base</span>
                  </div>
                </div>
                <button
                  onClick={() => { setShowBaseSelector(false); setPendingQuery(null); }}
                  className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-muted-foreground hover:bg-white/5 transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className={`grid gap-3 ${CREDILINK_BASES.has(pendingQuery.tipo) ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
                <motion.button
                  whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
                  onClick={() => executeQuery(pendingQuery.tipo, pendingQuery.dados, null)}
                  className="group relative flex flex-col gap-3 p-4 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] to-transparent hover:border-primary/40 hover:from-primary/[0.12] transition-all duration-200 text-left overflow-hidden"
                >
                  <div className="flex items-start justify-between">
                    <div className="p-2 rounded-xl bg-primary/15 border border-primary/25 group-hover:bg-primary/20 transition-colors">
                      <Database className="w-4 h-4 text-primary" />
                    </div>
                    {geassStatus === null ? (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                        <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse" />
                        <span className="text-[8px] uppercase tracking-wider text-muted-foreground/40 font-semibold">—</span>
                      </div>
                    ) : geassStatus.online ? (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                        <Activity className="w-2.5 h-2.5 text-emerald-400" />
                        <span className="text-[8px] uppercase tracking-wider text-emerald-400 font-semibold">Online</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20">
                        <Activity className="w-2.5 h-2.5 text-rose-400" />
                        <span className="text-[8px] uppercase tracking-wider text-rose-400 font-semibold">Offline</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-primary group-hover:text-sky-200 transition-colors">Hydra Consultoria</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">OSINT completo via Geass API · recomendado</p>
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-primary/50 group-hover:text-primary transition-colors">
                    <ShieldCheck className="w-3 h-3" /><span>Fonte principal</span>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
                  onClick={() => executeQuery(pendingQuery.tipo, pendingQuery.dados, "skylers")}
                  className="group relative flex flex-col gap-3 p-4 rounded-2xl border border-white/8 bg-gradient-to-br from-white/[0.04] to-transparent hover:border-sky-400/30 hover:from-sky-500/[0.07] transition-all duration-200 text-left overflow-hidden"
                >
                  <div className="flex items-start justify-between">
                    <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20 group-hover:bg-sky-500/15 transition-colors">
                      <Network className="w-4 h-4 text-sky-400" />
                    </div>
                    {skylersStatus === null ? (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                        <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse" />
                        <span className="text-[8px] uppercase tracking-wider text-muted-foreground/40 font-semibold">—</span>
                      </div>
                    ) : skylersStatus.online && !skylersStatus.circuitOpen ? (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                        <Activity className="w-2.5 h-2.5 text-emerald-400" />
                        <span className="text-[8px] uppercase tracking-wider text-emerald-400 font-semibold">Online</span>
                      </div>
                    ) : skylersStatus.circuitOpen ? (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                        <Activity className="w-2.5 h-2.5 text-amber-400" />
                        <span className="text-[8px] uppercase tracking-wider text-amber-400 font-semibold">Protegido</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20">
                        <Activity className="w-2.5 h-2.5 text-rose-400" />
                        <span className="text-[8px] uppercase tracking-wider text-rose-400 font-semibold">Offline</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-sky-300 group-hover:text-white transition-colors">Skylers API</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">Provedor avançado · 90+ módulos OSINT</p>
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-sky-400/50 group-hover:text-sky-400 transition-colors">
                    <ChevronRight className="w-3 h-3" /><span>Fonte alternativa</span>
                  </div>
                </motion.button>

                {CREDILINK_BASES.has(pendingQuery.tipo) && (
                  <motion.button
                    whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
                    onClick={() => executeQuery(pendingQuery.tipo, pendingQuery.dados, "credilink")}
                    className="group relative flex flex-col gap-3 p-4 rounded-2xl border border-white/8 bg-gradient-to-br from-white/[0.04] to-transparent hover:border-blue-400/30 hover:from-blue-500/[0.07] transition-all duration-200 text-left overflow-hidden"
                  >
                    <div className="flex items-start justify-between">
                      <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 group-hover:bg-blue-500/15 transition-colors">
                        <CreditCard className="w-4 h-4 text-blue-400" />
                      </div>
                      {skylersStatus === null ? (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                          <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse" />
                          <span className="text-[8px] uppercase tracking-wider text-muted-foreground/40 font-semibold">—</span>
                        </div>
                      ) : skylersStatus.online && !skylersStatus.circuitOpen ? (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                          <Activity className="w-2.5 h-2.5 text-emerald-400" />
                          <span className="text-[8px] uppercase tracking-wider text-emerald-400 font-semibold">Online</span>
                        </div>
                      ) : skylersStatus.circuitOpen ? (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                          <Activity className="w-2.5 h-2.5 text-amber-400" />
                          <span className="text-[8px] uppercase tracking-wider text-amber-400 font-semibold">Protegido</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20">
                          <Activity className="w-2.5 h-2.5 text-rose-400" />
                          <span className="text-[8px] uppercase tracking-wider text-rose-400 font-semibold">Offline</span>
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-blue-300 group-hover:text-white transition-colors">CrediLink</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">CPF via CrediLink · Skylers · dados financeiros</p>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-blue-400/50 group-hover:text-blue-400 transition-colors">
                      <ChevronRight className="w-3 h-3" /><span>Fonte financeira</span>
                    </div>
                  </motion.button>
                )}
              </div>
            </motion.div>
          )}

          {pending && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-12 flex items-center justify-center">
              <InfinityLoader size={72} label="Consultando fontes" />
            </motion.div>
          )}
          {!pending && !showBaseSelector && result && tab !== "cpffull" && (
            <ResultViewer
              tipo={tab}
              query={query}
              result={result as { success: boolean; error?: string | null; data?: unknown }}
            />
          )}
        </AnimatePresence>
      </motion.div>

      {/* CPF Full panel — rendered below the form block */}
      {tab === "cpffull" && cpfFullQuery && (
        <CpfFullPanel cpf={cpfFullQuery} />
      )}

      {/* History */}
      <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.4em] text-muted-foreground">Histórico Recente</h2>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{history?.length ?? 0} registro(s)</span>
        </div>
        {!history || history.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm flex flex-col items-center gap-3">
            <FileText className="w-10 h-10 opacity-20" />
            Nenhuma consulta registrada ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.4) }}
                className="bg-black/30 border border-white/5 rounded-xl p-3 sm:p-4 flex items-center justify-between hover:border-primary/30 hover:bg-black/40 transition-all group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-2 py-1 rounded-md shrink-0">{friendlyTipo(item.tipo)}</span>
                  <span className="font-mono text-sm truncate">{item.query}</span>
                  <span className="text-xs text-muted-foreground truncate hidden md:inline">— {item.username}</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">
                    {new Date(item.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {item.success ? <CheckCircle2 className="w-4 h-4 text-emerald-300" /> : <AlertTriangle className="w-4 h-4 text-amber-300" />}
                  {!!item.result && item.success && (
                    <button
                      onClick={() => loadSavedResult(item)}
                      title="Ver resultado salvo"
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-all"
                    >
                      <Eye className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={() => repeatQuery(item.tipo, item.query)}
                    title="Repetir consulta"
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-all"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-[10px] uppercase tracking-[0.4em] text-muted-foreground">
          <span>Hydra Consultoria</span>
          <span className="text-primary/60">v1.0</span>
        </div>
      </div>
    </div>
  );
}
