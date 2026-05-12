import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera, Upload, X, Search, AlertTriangle,
  Eye, RotateCcw, Info, Fingerprint, ShieldCheck, ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { InfinityLoader } from "@/components/ui/InfinityLoader";

type ParsedData = { fields: [string, string][]; sections: { name: string; items: string[] }[]; raw: string };

function extractPhotoUrl(data: ParsedData): string | null {
  for (const [k, v] of data.fields) {
    if (!v) continue;
    const ku = k.toUpperCase();
    if ((ku.includes("FOTO") || ku.includes("IMAGEM") || ku.includes("URL")) && v.startsWith("http")) return v;
  }
  const m = data.raw.match(/https?:\/\/[^\s\u23AF\n\r"'<>]+\.(jpg|jpeg|png|webp)([^\s\u23AF\n\r"'<>]*)/i);
  if (m) return m[0];
  for (const [, v] of data.fields) {
    if (v && v.startsWith("http") && /\.(jpg|jpeg|png|webp)/i.test(v)) return v;
  }
  return null;
}

export default function FaceMatch() {
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);
  const [cpf, setCpf] = useState("");
  const [pending, setPending] = useState(false);
  const [officialPhoto, setOfficialPhoto] = useState<string | null>(null);
  const [officialErr, setOfficialErr] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Arquivo inválido — use uma imagem."); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Imagem muito grande (máx. 10 MB)."); return; }
    const reader = new FileReader();
    reader.onload = e => { setUploadedPreview(e.target?.result as string); setOfficialPhoto(null); setQueryError(null); setOfficialErr(false); };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0]; if (file) handleFile(file);
  }, [handleFile]);

  const handleSearch = async () => {
    const clean = cpf.replace(/\D/g, "");
    if (clean.length !== 11) { toast.error("CPF inválido — 11 dígitos."); return; }
    setPending(true); setOfficialPhoto(null); setQueryError(null); setOfficialErr(false);
    try {
      const token = localStorage.getItem("infinity_token");
      const r = await fetch("/api/infinity/external/skylers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tipo: "foto", dados: clean }),
      });
      const json = await r.json() as { success: boolean; error?: string; data?: ParsedData };
      if (json.success && json.data) {
        const url = extractPhotoUrl(json.data);
        if (url) { setOfficialPhoto(url); toast.success("Foto oficial localizada"); }
        else { setQueryError("Foto não encontrada para este CPF."); toast.error("Foto não localizada"); }
      } else {
        setQueryError(json.error ?? "Sem retorno para este CPF."); toast.error(json.error ?? "Sem retorno");
      }
    } catch { setQueryError("Falha na consulta. Tente novamente."); toast.error("Falha na consulta"); }
    finally { setPending(false); }
  };

  const reset = () => { setUploadedPreview(null); setOfficialPhoto(null); setQueryError(null); setCpf(""); setOfficialErr(false); };
  const bothPhotos = uploadedPreview && officialPhoto && !officialErr;

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl p-4"
            onClick={() => setLightbox(null)}
          >
            <motion.img
              initial={{ scale: 0.88 }} animate={{ scale: 1 }} exit={{ scale: 0.88 }}
              src={lightbox} alt=""
              className="max-w-full max-h-full rounded-2xl shadow-2xl border border-white/10 object-contain"
              onClick={e => e.stopPropagation()}
            />
            <button onClick={() => setLightbox(null)} className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div>
        <motion.h1
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="text-2xl sm:text-3xl font-bold tracking-[0.25em] uppercase bg-clip-text text-transparent"
          style={{ backgroundImage: "linear-gradient(to right, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, white))" }}
        >
          Face Match
        </motion.h1>
        <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-2">
          Comparação visual · Foto enviada vs. CNH/Detran oficial
        </p>
      </div>

      {/* Warning */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/5 px-4 py-3 backdrop-blur-xl"
      >
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80 leading-relaxed">
          <span className="font-bold uppercase tracking-wide">Uso profissional —</span>{" "}
          recupera a foto oficial da CNH cadastrada no Skylers para comparação visual humana. Utilize apenas para verificação legítima de identidade.
        </p>
      </motion.div>

      {/* Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Upload */}
        <motion.div
          initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 }}
          className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl overflow-hidden flex flex-col"
        >
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)" }}>
                <Camera className="w-3.5 h-3.5" style={{ color: "var(--color-primary)" }} />
              </div>
              <span className="text-xs font-bold uppercase tracking-[0.25em]">Foto Enviada</span>
            </div>
            {uploadedPreview && (
              <button onClick={() => { setUploadedPreview(null); setOfficialPhoto(null); }} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-rose-400 transition-colors">
                <X className="w-3 h-3" /> Remover
              </button>
            )}
          </div>

          <div className="p-5 flex-1 flex flex-col">
            {uploadedPreview ? (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative group flex-1">
                <div className="w-full aspect-[3/4] max-h-[380px] rounded-xl overflow-hidden border border-white/10 bg-black/20 mx-auto" style={{ maxWidth: 280 }}>
                  <img src={uploadedPreview} alt="Foto enviada" className="w-full h-full object-cover" />
                </div>
                <button
                  onClick={() => setLightbox(uploadedPreview)}
                  className="absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <div className="absolute top-3 left-3 px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest text-black" style={{ background: "var(--color-primary)" }}>
                  ENVIADA
                </div>
              </motion.div>
            ) : (
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`flex-1 min-h-[280px] rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-4 cursor-pointer transition-all select-none ${
                  dragging ? "border-primary/70 bg-primary/8 scale-[1.01]" : "border-white/15 hover:border-primary/40 hover:bg-white/[0.02]"
                }`}
              >
                <motion.div
                  animate={{ y: dragging ? -4 : 0 }}
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)" }}
                >
                  <Upload className="w-7 h-7" style={{ color: "var(--color-primary)" }} />
                </motion.div>
                <div className="text-center px-6">
                  <p className="text-sm font-semibold text-foreground/80 mb-1">Arraste ou clique para enviar</p>
                  <p className="text-[10px] text-muted-foreground/50">JPG · PNG · WEBP · Máx. 10 MB</p>
                </div>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          </div>
        </motion.div>

        {/* Right: CPF + Official photo */}
        <motion.div
          initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 }}
          className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl overflow-hidden flex flex-col"
        >
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)" }}>
              <Fingerprint className="w-3.5 h-3.5" style={{ color: "var(--color-primary)" }} />
            </div>
            <span className="text-xs font-bold uppercase tracking-[0.25em]">Foto Oficial · Skylers</span>
          </div>

          <div className="p-5 flex flex-col flex-1 gap-4">
            {/* CPF input */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground/60">CPF do consultado</label>
              <div className="flex gap-2">
                <input
                  value={cpf}
                  onChange={e => setCpf(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  placeholder="00000000000"
                  inputMode="numeric"
                  className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder-muted-foreground/20 min-w-0"
                  onKeyDown={e => { if (e.key === "Enter") handleSearch(); }}
                />
                <button
                  onClick={handleSearch}
                  disabled={pending || cpf.replace(/\D/g, "").length !== 11}
                  className="px-4 py-3 rounded-xl font-bold text-black text-xs uppercase tracking-widest disabled:opacity-30 transition-all hover:brightness-110 active:scale-95 flex items-center gap-2 shrink-0"
                  style={{ background: "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, white))" }}
                >
                  {pending ? <InfinityLoader size={14} /> : <Search className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Result area */}
            <div className="flex-1 flex flex-col">
              {pending ? (
                <div className="flex-1 min-h-[220px] rounded-xl border border-white/[0.06] bg-black/20 flex flex-col items-center justify-center gap-3">
                  <InfinityLoader size={36} />
                  <p className="text-xs text-muted-foreground/50 animate-pulse tracking-widest uppercase text-[9px]">Consultando Skylers...</p>
                </div>
              ) : queryError ? (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  className="flex-1 min-h-[220px] rounded-xl border border-rose-500/25 bg-rose-500/5 flex flex-col items-center justify-center gap-3 p-6 text-center"
                >
                  <AlertTriangle className="w-8 h-8 text-rose-400/50" />
                  <p className="text-sm text-rose-300/70">{queryError}</p>
                </motion.div>
              ) : officialPhoto ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex-1 relative group">
                  {officialErr ? (
                    <div className="flex-1 min-h-[280px] rounded-xl border border-rose-500/25 bg-rose-500/5 flex flex-col items-center justify-center gap-2">
                      <AlertTriangle className="w-6 h-6 text-rose-400/50" />
                      <p className="text-xs text-rose-300/60">Não foi possível carregar a imagem.</p>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="w-full aspect-[3/4] max-h-[380px] rounded-xl overflow-hidden border border-emerald-400/30 bg-black/20 mx-auto" style={{ maxWidth: 280 }}>
                        <img src={officialPhoto} alt="Foto oficial" className="w-full h-full object-cover" onError={() => setOfficialErr(true)} />
                      </div>
                      <button
                        onClick={() => setLightbox(officialPhoto)}
                        className="absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>
                      <div className="absolute top-3 left-3 px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest bg-emerald-400 text-black">
                        OFICIAL
                      </div>
                    </div>
                  )}
                </motion.div>
              ) : (
                <div className="flex-1 min-h-[220px] rounded-xl border-2 border-dashed border-white/8 flex flex-col items-center justify-center gap-3 text-center px-6">
                  <Eye className="w-10 h-10 text-muted-foreground/15" />
                  <p className="text-xs text-muted-foreground/40 leading-relaxed">
                    Informe o CPF e clique em buscar para recuperar a foto oficial da CNH/Detran.
                  </p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Comparison strip */}
      <AnimatePresence>
        {bothPhotos && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl border overflow-hidden backdrop-blur-2xl"
            style={{ borderColor: "color-mix(in srgb, var(--color-primary) 35%, transparent)", background: "color-mix(in srgb, var(--color-primary) 4%, rgba(0,0,0,0.5))" }}
          >
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "color-mix(in srgb, var(--color-primary) 15%, transparent)" }}>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
                <span className="text-xs font-bold uppercase tracking-[0.3em]">Análise Comparativa Visual</span>
              </div>
              <button onClick={reset} className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
                <RotateCcw className="w-3 h-3" /> Nova consulta
              </button>
            </div>

            <div className="p-6">
              <div className="flex items-center justify-center gap-4 sm:gap-8 flex-wrap">
                {/* Uploaded */}
                <div className="text-center">
                  <motion.div
                    whileHover={{ scale: 1.03 }}
                    onClick={() => setLightbox(uploadedPreview!)}
                    className="w-36 h-48 rounded-2xl overflow-hidden border-2 cursor-zoom-in shadow-lg mx-auto"
                    style={{ borderColor: "color-mix(in srgb, var(--color-primary) 50%, transparent)", boxShadow: "0 0 30px -8px color-mix(in srgb, var(--color-primary) 30%, transparent)" }}
                  >
                    <img src={uploadedPreview!} alt="" className="w-full h-full object-cover" />
                  </motion.div>
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mt-2.5">Foto Enviada</p>
                </div>

                {/* VS divider */}
                <div className="flex flex-col items-center gap-2 py-4">
                  <div className="w-px h-10 rounded-full" style={{ background: "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--color-primary) 50%, transparent))" }} />
                  <div className="w-10 h-10 rounded-full flex items-center justify-center border" style={{ borderColor: "color-mix(in srgb, var(--color-primary) 30%, transparent)", background: "color-mix(in srgb, var(--color-primary) 8%, transparent)" }}>
                    <Eye className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
                  </div>
                  <span className="text-[8px] font-bold uppercase tracking-widest" style={{ color: "var(--color-primary)" }}>VS</span>
                  <div className="w-px h-10 rounded-full" style={{ background: "linear-gradient(to top, transparent, color-mix(in srgb, var(--color-primary) 50%, transparent))" }} />
                </div>

                {/* Official */}
                <div className="text-center">
                  <motion.div
                    whileHover={{ scale: 1.03 }}
                    onClick={() => setLightbox(officialPhoto!)}
                    className="w-36 h-48 rounded-2xl overflow-hidden border-2 cursor-zoom-in shadow-lg mx-auto"
                    style={{ borderColor: "#22c55e88", boxShadow: "0 0 30px -8px #22c55e40" }}
                  >
                    <img src={officialPhoto!} alt="" className="w-full h-full object-cover" />
                  </motion.div>
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mt-2.5">Foto Oficial CNH</p>
                </div>
              </div>

              <div className="mt-6 flex items-start gap-2 text-[10px] text-muted-foreground/50 justify-center text-center max-w-md mx-auto">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>A conclusão da comparação é responsabilidade exclusiva do operador. Esta ferramenta apenas exibe as imagens para verificação visual humana.</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
