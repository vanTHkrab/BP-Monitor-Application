/**
 * The ways in that are not phone + password.
 *
 * The reason this is a component rather than two buttons inline: the order and
 * the "ใช้ครั้งล่าสุด" badge depend on what this device did last, and that
 * logic has to sit next to the buttons it reorders or it will drift the first
 * time someone adds a third method.
 *
 * The badge is the whole point. Someone who signed in with a passkey last
 * month does not remember that they did; being told is the difference between
 * one tap and a password reset. It is a hint only — every method stays
 * available and equally reachable, because a wrong hint must never become a
 * dead end.
 */
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { LastLoginMethod } from '../lib/last-login-method';

export type AlternateSignInProps = {
  lastUsed: LastLoginMethod | null;
  onPasskey?: () => void;
  onGoogle?: () => void;
  isPasskeyPending?: boolean;
  isGooglePending?: boolean;
};

export function AlternateSignIn({
  lastUsed,
  onPasskey,
  onGoogle,
  isPasskeyPending = false,
  isGooglePending = false,
}: AlternateSignInProps) {
  const colors = useTheme();

  const methods = [
    onPasskey
      ? {
          key: 'passkey' as const,
          label: 'เข้าสู่ระบบด้วย Passkey',
          icon: 'finger-print' as const,
          onPress: onPasskey,
          pending: isPasskeyPending,
        }
      : null,
    onGoogle
      ? {
          key: 'google' as const,
          label: 'เข้าสู่ระบบด้วย Google',
          icon: 'logo-google' as const,
          onPress: onGoogle,
          pending: isGooglePending,
        }
      : null,
  ].filter((method) => method !== null);

  if (methods.length === 0) return null;

  // The one used last goes first. Not hidden or promoted visually beyond the
  // badge — reordering is enough of a nudge, and restyling one button as
  // "the real one" makes the others look broken.
  const ordered = [...methods].sort((a, b) =>
    a.key === lastUsed ? -1 : b.key === lastUsed ? 1 : 0,
  );

  return (
    <View className="mt-6">
      <View className="mb-4 flex-row items-center">
        <View className="h-px flex-1" style={{ backgroundColor: colors.border }} />
        <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mx-3">
          หรือ
        </ThemedText>
        <View className="h-px flex-1" style={{ backgroundColor: colors.border }} />
      </View>

      {ordered.map((method) => (
        <Pressable
          key={method.key}
          testID={`login-${method.key}`}
          onPress={method.onPress}
          disabled={method.pending}
          accessibilityRole="button"
          accessibilityLabel={
            method.key === lastUsed ? `${method.label} (ใช้ครั้งล่าสุด)` : method.label
          }
          android_ripple={{ color: colors['surface-muted'] }}
          className="mb-3 flex-row items-center rounded-2xl border px-5"
          style={{
            borderColor: colors.border,
            backgroundColor: colors.surface,
            // Matches the primary button's height so the alternatives read as
            // equal choices rather than as an afterthought.
            minHeight: 56,
            opacity: method.pending ? 0.6 : 1,
          }}
        >
          {method.pending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name={method.icon} size={22} color={colors['text-primary']} />
          )}

          <ThemedText type="default" weight="semibold" className="ml-3 flex-1">
            {method.label}
          </ThemedText>

          {method.key === lastUsed ? (
            <View
              className="rounded-full px-2.5 py-1"
              style={{ backgroundColor: colors['surface-muted'] }}
            >
              <ThemedText type="caption" themeColor="text-secondary">
                ใช้ครั้งล่าสุด
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}
