import { Switch, Route } from "wouter";
import SkylersPromo from "./pages/skylers-promo";
import { AuthGuard } from "@/components/layout/AuthGuard";
import { Layout } from "@/components/layout/Layout";
import { TermsGuard } from "@/components/ui/TermsGuard";

import Login from "@/pages/login";
import Overview from "@/pages/overview";
import IA from "@/pages/ia";
import Consultas from "@/pages/consultas";
import Configuracoes from "@/pages/configuracoes";
import Dossie from "@/pages/dossie";
import Perfil from "@/pages/perfil";
import Bases from "@/pages/bases";
import Favoritos from "@/pages/favoritos";
import { AdminGuard } from "@/components/layout/AdminGuard";
import Personalizar, { initSavedTheme } from "@/pages/personalizar";
import Skylers from "@/pages/skylers";
import Suporte from "@/pages/suporte";
import Historico from "@/pages/historico";
import Registro from "@/pages/registro";
import Afiliados from "@/pages/afiliados";
import Carteira from "@/pages/carteira";
import Comunidade from "@/pages/comunidade";
import PerfilPublico from "@/pages/perfil-publico";
import DM from "@/pages/dm";

// Apply saved color theme immediately on load
initSavedTheme();

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h1 className="text-6xl font-bold neon-text tracking-widest">404</h1>
      <p className="text-sm uppercase tracking-widest text-muted-foreground mt-4">
        Rota não encontrada
      </p>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      {/* ── Rotas públicas (sem login) ── */}
      <Route path="/login" component={Login} />
      <Route path="/registro"><Registro /></Route>
      <Route path="/planos"><Registro /></Route>

      {/* ── Perfil público — acessível sem conta ── */}
      <Route path="/u/:username" component={PerfilPublico} />

      {/* ── Rotas protegidas ── */}
      <Route>
        <AuthGuard>
          <TermsGuard>
            <Layout>
              <Switch>
                <Route path="/" component={Overview} />
                <Route path="/consultas" component={Consultas} />
                <Route path="/ia" component={IA} />
                <Route path="/dossie" component={Dossie} />
                <Route path="/favoritos" component={Favoritos} />
                <Route path="/bases">
                  <AdminGuard><Bases /></AdminGuard>
                </Route>
                <Route path="/perfil" component={Perfil} />
                <Route path="/configuracoes" component={Configuracoes} />
                <Route path="/personalizar" component={Personalizar} />
                <Route path="/skylers" component={Skylers} />
                <Route path="/api-promo" component={SkylersPromo} />
                <Route path="/suporte" component={Suporte} />
                <Route path="/historico" component={Historico} />
                <Route path="/planos">{() => { window.location.replace("/registro"); return null; }}</Route>
                <Route path="/afiliados" component={Afiliados} />
                <Route path="/carteira" component={Carteira} />
                <Route path="/comunidade" component={Comunidade} />
                <Route path="/dm/:username" component={DM} />
                <Route component={NotFound} />
              </Switch>
            </Layout>
          </TermsGuard>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

export default Router;
