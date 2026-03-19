import { useAppStore } from '@/store/useAppStore';
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
