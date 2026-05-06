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
import Personalizar, { initSavedTheme } from "@/pages/personalizar";
import Skylers from "@/pages/skylers";
import Suporte from "@/pages/suporte";
import Planos from "@/pages/planos";

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
      <Route path="/login" component={Login} />
      {/* /planos is public — accessible without login */}
      <Route path="/planos">
        <TermsGuard>
          <Planos />
        </TermsGuard>
      </Route>
      <Route>
        <TermsGuard>
        <AuthGuard>
          <Layout>
            <Switch>
              <Route path="/" component={Overview} />
              <Route path="/consultas" component={Consultas} />
              <Route path="/ia" component={IA} />
              <Route path="/dossie" component={Dossie} />
              <Route path="/favoritos" component={Favoritos} />
              <Route path="/bases" component={Bases} />
              <Route path="/perfil" component={Perfil} />
              <Route path="/configuracoes" component={Configuracoes} />
              <Route path="/personalizar" component={Personalizar} />
              <Route path="/skylers" component={Skylers} />
              <Route path="/api-promo" component={SkylersPromo} />
              <Route path="/suporte" component={Suporte} />
              {/* /planos also inside layout for logged-in users */}
              <Route path="/planos" component={Planos} />
              <Route component={NotFound} />
            </Switch>
          </Layout>
        </AuthGuard>
        </TermsGuard>
      </Route>
    </Switch>
  );
}

export default Router;
