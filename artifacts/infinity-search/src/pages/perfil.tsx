import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Camera, Image as ImageIcon, Trash2, Save, CheckCircle2, User as UserIcon } from "lucide-react";
import { useInfinityMe, getInfinityMeQueryKey } from "@workspace/api-client-react";

const LS_PHOTO = "infinity_profile_photo";
const LS_BANNER = "infinity_profile_banner";

function dispatchUpdate() {
  window.dispatchEvent(new CustomEvent("infinity-profile-updated"));
}

export default function Perfil() {
  const { data: user } = useInfinityMe({ query: { queryKey: getInfinityMeQueryKey() } });
  const [photo, setPhoto] = useState<string | null>(() => localStorage.getItem(LS_PHOTO));
  const [banner, setBanner] = useState<string | null>(() => localStorage.getItem(LS_BANNER));
  const [saved, setSaved] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await readFile(file);
    setPhoto(url);
  };

  const handleBannerChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await readFile(file);
    setBanner(url);
  };

  const handleSave = () => {
    if (photo) localStorage.setItem(LS_PHOTO, photo);
    else localStorage.removeItem(LS_PHOTO);
    if (banner) localStorage.setItem(LS_BANNER, banner);
    else localStorage.removeItem(LS_BANNER);
    dispatchUpdate();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const removePhoto = () => setPhoto(null);
  const removeBanner = () => setBanner(null);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-widest neon-text uppercase">Perfil</h1>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mt-2">
          Personalize sua foto e banner
        </p>
      </div>

      {/* Banner preview */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl overflow-hidden border border-white/10"
      >
        {/* Banner */}
        <div
          className="relative h-36 flex items-center justify-center cursor-pointer group"
          style={
            banner
              ? { backgroundImage: `url(${banner})`, backgroundSize: "cover", backgroundPosition: "center" }
              : {}
          }
          onClick={() => bannerRef.current?.click()}
        >
          {!banner && (
            <div className="absolute inset-0 bg-gradient-to-br from-sky-900/60 via-cyan-900/40 to-black/60" />
          )}
          <div className="relative z-10 flex flex-col items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center border border-white/20">
              <ImageIcon className="w-5 h-5 text-white" />
            </div>
            <span className="text-[10px] uppercase tracking-widest text-white/80">
              {banner ? "Trocar banner" : "Adicionar banner"}
            </span>
          </div>
          {banner && (
            <button
              onClick={(e) => { e.stopPropagation(); removeBanner(); }}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center border border-white/20 hover:bg-destructive/60 transition-colors z-20"
            >
              <Trash2 className="w-3.5 h-3.5 text-white" />
            </button>
          )}
        </div>

        {/* Profile photo row */}
        <div className="bg-black/40 px-6 pb-5 pt-0 relative">
          <div className="flex items-end gap-4">
            <div className="relative -mt-10">
              <div
                className="w-20 h-20 rounded-full overflow-hidden border-4 border-[#06091a] bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center text-black font-bold text-2xl cursor-pointer group"
                onClick={() => photoRef.current?.click()}
              >
                {photo ? (
                  <img src={photo} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span>{user?.username?.[0]?.toUpperCase() ?? "?"}</span>
                )}
                <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="w-5 h-5 text-white" />
                </div>
              </div>
              {photo && (
                <button
                  onClick={removePhoto}
                  className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-destructive/80 flex items-center justify-center border border-white/20 hover:bg-destructive transition-colors"
                >
                  <Trash2 className="w-3 h-3 text-white" />
                </button>
              )}
            </div>
            <div className="pb-1">
              <div className="font-bold text-lg tracking-wide">{user?.username}</div>
              <div className="text-[9px] uppercase tracking-[0.4em] text-primary/70">{user?.role}</div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Controls */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-6 space-y-4"
      >
        <div className="flex items-center gap-2 mb-1">
          <UserIcon className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Personalização
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => photoRef.current?.click()}
            className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors text-sm font-medium"
          >
            <Camera className="w-4 h-4 text-primary" />
            <span>{photo ? "Trocar foto" : "Adicionar foto"}</span>
          </button>
          <button
            onClick={() => bannerRef.current?.click()}
            className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-sm font-medium"
          >
            <ImageIcon className="w-4 h-4 text-muted-foreground" />
            <span>{banner ? "Trocar banner" : "Adicionar banner"}</span>
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">
          Imagens salvas localmente no navegador
        </p>

        <button
          onClick={handleSave}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 text-black font-bold uppercase tracking-widest text-sm hover:shadow-[0_0_25px_rgba(56,189,248,0.5)] transition-all"
        >
          {saved ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Salvo!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Salvar alterações
            </>
          )}
        </button>
      </motion.div>

      <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
      <input ref={bannerRef} type="file" accept="image/*" className="hidden" onChange={handleBannerChange} />
    </div>
  );
}
