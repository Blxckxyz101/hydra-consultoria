import { useInfinityMe, getInfinityMeQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

// Setup the custom fetcher token getter
setAuthTokenGetter(() => localStorage.getItem("infinity_token"));

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const token = localStorage.getItem("infinity_token");

  const { data: user, isLoading, error } = useInfinityMe({
    query: {
      queryKey: getInfinityMeQueryKey(),
      retry: false,
      enabled: !!token,
    }
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error || !user) {
    return null; // Will redirect in useEffect
  }

  return <>{children}</>;
}
