import { useInfinityMe, getInfinityMeQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useEffect } from "react";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useInfinityMe({
    query: { queryKey: getInfinityMeQueryKey(), retry: false },
  });

  useEffect(() => {
    if (!isLoading && user && user.role !== "admin") {
      setLocation("/");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) return null;
  if (!user || user.role !== "admin") return null;

  return <>{children}</>;
}
