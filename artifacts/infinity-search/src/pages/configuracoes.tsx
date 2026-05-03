import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useInfinityMe,
  useInfinityListUsers,
  useInfinityCreateUser,
  useInfinityDeleteUser,
  useInfinityLogout,
  getInfinityListUsersQueryKey,
  getInfinityMeQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ShieldAlert, UserPlus, Trash2, LogOut, User as UserIcon } from "lucide-react";

export default function Configuracoes() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: me } = useInfinityMe({ query: { queryKey: getInfinityMeQueryKey() } });

  const isAdmin = me?.role === "admin";

  const { data: users } = useInfinityListUsers({
    query: {
      queryKey: getInfinityListUsersQueryKey(),
      enabled: isAdmin,
    },
  });

  const createUser = useInfinityCreateUser();
  const deleteUser = useInfinityDeleteUser();
  const logout = useInfinityLogout();

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [formError, setFormError] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!newUsername.trim() || !newPassword.trim()) return;
    try {
      await createUser.mutateAsync({
        data: { username: newUsername.trim(), password: newPassword, role: newRole },
      });
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      queryClient.invalidateQueries({ queryKey: getInfinityListUsersQueryKey() });
    } catch (err: any) {
      setFormError(err?.data?.message || err?.message || "Falha ao criar operador");
    }
  };

  const handleDelete = async (username: string) => {
    if (username === me?.username) return;
    if (!confirm(`Remover operador "${username}"? Esta ação é irreversível.`)) return;
    try {
      await deleteUser.mutateAsync({ username });
      queryClient.invalidateQueries({ queryKey: getInfinityListUsersQueryKey() });
    } catch (err) {
      // silent
    }
  };

  const handleLogout = async () => {
    try {
      await logout.mutateAsync({});
    } catch {}
    localStorage.removeItem("infinity_token");
    setLocation("/login");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-widest neon-text uppercase">Configurações</h1>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mt-2">
          Gerência de operadores e sessão
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-xl p-6"
      >
        <div className="flex items-center gap-2 mb-4">
          <UserIcon className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Sessão Atual
          </h2>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">{me?.username}</div>
            <div className="text-xs uppercase tracking-widest text-primary/70 mt-1">{me?.role}</div>
            {me?.lastLoginAt && (
              <div className="text-xs text-muted-foreground mt-2">
                Último acesso: {new Date(me.lastLoginAt).toLocaleString("pt-BR")}
              </div>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors uppercase tracking-widest text-xs font-bold"
          >
            <LogOut className="w-4 h-4" />
            Encerrar Sessão
          </button>
        </div>
      </motion.div>

      {!isAdmin ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-xl p-12 flex flex-col items-center text-center"
        >
          <ShieldAlert className="w-12 h-12 text-destructive/70 mb-4" />
          <h3 className="text-lg font-bold uppercase tracking-widest">Acesso Restrito</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-md">
            A gerência de operadores está disponível apenas para administradores.
          </p>
        </motion.div>
      ) : (
        <>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-panel rounded-xl p-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <UserPlus className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Novo Operador
              </h2>
            </div>
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Usuário"
                className="bg-black/40 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-primary/50 transition-all"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Senha"
                className="bg-black/40 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-primary/50 transition-all"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as any)}
                className="bg-black/40 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-primary/50 transition-all uppercase text-xs tracking-widest"
              >
                <option value="user">Operador</option>
                <option value="admin">Administrador</option>
              </select>
              <button
                type="submit"
                disabled={createUser.isPending || !newUsername.trim() || !newPassword.trim()}
                className="bg-primary text-primary-foreground font-bold uppercase tracking-widest py-3 rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50"
              >
                {createUser.isPending ? "Criando..." : "Criar"}
              </button>
            </form>
            {formError && (
              <div className="mt-3 text-sm text-destructive">{formError}</div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-panel rounded-xl p-6"
          >
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4">
              Operadores Ativos ({users?.length ?? 0})
            </h2>
            <div className="space-y-2">
              <AnimatePresence>
                {users?.map((u, i) => (
                  <motion.div
                    key={u.username}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ delay: i * 0.03 }}
                    className="bg-black/30 border border-white/5 rounded-lg p-4 flex items-center justify-between hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
                        <UserIcon className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{u.username}</div>
                        <div className="text-xs uppercase tracking-widest text-primary/70">
                          {u.role}
                          {u.username === me?.username && (
                            <span className="ml-2 text-muted-foreground">(você)</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right text-xs text-muted-foreground hidden md:block">
                        <div>Criado em {new Date(u.createdAt).toLocaleDateString("pt-BR")}</div>
                        {u.lastLoginAt && (
                          <div>Último acesso {new Date(u.lastLoginAt).toLocaleDateString("pt-BR")}</div>
                        )}
                      </div>
                      <button
                        disabled={u.username === me?.username || deleteUser.isPending}
                        onClick={() => handleDelete(u.username)}
                        className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title={u.username === me?.username ? "Não é possível remover a si mesmo" : "Remover"}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}
