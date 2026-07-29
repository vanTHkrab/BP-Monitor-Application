import { useAppStore } from '@/store/use-app-store';
import { useColorScheme as useRNColorScheme } from 'react-native';

export function useColorScheme() {
	const themePreference = useAppStore((s) => s.themePreference);
	const themeHydrated = useAppStore((s) => s.themeHydrated);
	const system = useRNColorScheme() ?? 'light';

	if (themeHydrated) {
		return themePreference;
	}

	return system;
}
