import { Switch, Route } from "wouter";
import { AuthGuard } from "@/components/layout/AuthGuard";
import { Layout } from "@/components/layout/Layout";

import Login from "@/pages/login";
import Overview from "@/pages/overview";
import IA from "@/pages/ia";
import Consultas from "@/pages/consultas";
import Configuracoes from "@/pages/configuracoes";
import Dossie from "@/pages/dossie";

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
      <Route>
        <AuthGuard>
          <Layout>
            <Switch>
              <Route path="/" component={Overview} />
              <Route path="/consultas" component={Consultas} />
              <Route path="/ia" component={IA} />
              <Route path="/dossie" component={Dossie} />
              <Route path="/configuracoes" component={Configuracoes} />
              <Route component={NotFound} />
            </Switch>
          </Layout>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

export default Router;
