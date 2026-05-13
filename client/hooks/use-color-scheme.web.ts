import { useAppStore } from '@/store/use-app-store';
import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  const themePreference = useAppStore((s) => s.themePreference);
  const themeHydrated = useAppStore((s) => s.themeHydrated);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return themeHydrated ? themePreference : colorScheme;
  }

  return 'light';
}
