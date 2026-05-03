import { useInfinityMe, getInfinityMeQueryKey, setAuthTokenGetter } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { AnimatedBackground } from "@/components/ui/AnimatedBackground";
import { InfinityLoader } from "@/components/ui/InfinityLoader";

setAuthTokenGetter(() => localStorage.getItem("infinity_token"));

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const token = typeof window !== "undefined" ? localStorage.getItem("infinity_token") : null;

  const { data: user, isLoading, error } = useInfinityMe({
    query: {
      queryKey: getInfinityMeQueryKey(),
      retry: false,
      enabled: !!token,
    },
  });

  useEffect(() => {
    if (!token) {
      setLocation("/login");
    } else if (error) {
      localStorage.removeItem("infinity_token");
      setLocation("/login");
    }
  }, [token, error, setLocation]);

  if (!token || isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center relative">
        <AnimatedBackground />
        <InfinityLoader label="Verificando sessão" />
      </div>
    );
  }

  if (error || !user) return null;

  return <>{children}</>;
}
