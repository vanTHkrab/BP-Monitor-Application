/**
 * Form-level error banner.
 *
 * Errors that belong to one input render under that input instead — this is
 * for the ones that do not attach anywhere: throttling, connectivity, a
 * suspended account, and the session-expired notice on arrival.
 *
 * Never an Alert. A dialog interrupts, and the message is almost always
 * something the user fixes by editing the form they are already looking at.
 */
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { status } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

export type AuthErrorBannerProps = {
  message: string;
  /** `info` for expected notices (session expired), `error` for failures. */
  tone?: 'error' | 'info';
};

export function AuthErrorBanner({ message, tone = 'error' }: AuthErrorBannerProps) {
  const { scheme } = useColorSchemePreference();
  const isDark = scheme === 'dark';
  const isError = tone === 'error';

  const accent = isError ? status.high : status.low;

  return (
    <View
      className="mb-4 flex-row items-start rounded-2xl border p-3"
      style={{
        borderColor: accent,
        backgroundColor: isDark
          ? isError
            ? '#3F1D1D'
            : '#12283A'
          : isError
            ? '#FEF2F2'
            : '#EFF6FF',
      }}>
      <Ionicons
        name={isError ? 'alert-circle' : 'information-circle'}
        size={20}
        color={accent}
        style={{ marginTop: 1, marginRight: 8 }}
      />
      <ThemedText type="label" className="flex-1" style={{ color: accent }}>
        {message}
      </ThemedText>
    </View>
  );
}
