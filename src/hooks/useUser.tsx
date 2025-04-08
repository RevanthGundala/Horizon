// hooks/useAuth.ts
import { useQuery } from '@tanstack/react-query';

export function useUser() {
  const fetchUser = async () => {
    const res = await fetch('/api/user', {
      credentials: 'include',
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return data.user;
  };

  const { data: user, isLoading: loading } = useQuery({
    queryKey: ['user'],
    queryFn: fetchUser,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });

  return {
    user,
    loading,
  };
}
