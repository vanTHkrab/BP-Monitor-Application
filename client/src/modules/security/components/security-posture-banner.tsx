/**
 * The screen's answer, before its settings.
 *
 * Tone is carried by a single accent — the icon and a hairline — over the
 * ordinary surface, not by a filled red or green panel. A patient opening a
 * blood-pressure app should not meet a red block about their account; the
 * severity has to be readable without being alarming, because the thing it is
 * usually reporting is "you could add a passkey", not "you have been
 * breached".
 *
 * This is where the 10% of the palette goes: everything else on the screen is
 * surface and structure, and the one accent is spent on the one judgement.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { status as statusColor } from '@/theme';
import type { PostureTone, SecurityPosture } from '../lib/security-posture';

const TONE_ICON: Record<PostureTone, keyof typeof Ionicons.glyphMap> = {
  good: 'shield-checkmark',
  attention: 'information-circle',
  risk: 'alert-circle',
};

export function SecurityPostureBanner({
  posture,
  onAction,
}: {
  posture: SecurityPosture;
  onAction: () => void;
}) {
  const colors = useTheme();

  const accent =
    posture.tone === 'good'
      ? statusColor.normal
      : posture.tone === 'attention'
        ? statusColor.elevated
        : statusColor.high;

  return (
    <View
      className="mt-2 overflow-hidden rounded-2xl"
      style={{ backgroundColor: colors.surface }}
    >
      {/* A 3px rule along the top, not a thick left border: it reads as the
          card's own edge rather than as a sticker applied to it. */}
      <View style={{ height: 3, backgroundColor: accent }} />

      <View className="flex-row items-start p-5">
        <Ionicons name={TONE_ICON[posture.tone]} size={28} color={accent} />

        <View className="ml-3.5 flex-1">
          <ThemedText size={18} weight="bold">
            {posture.headline}
          </ThemedText>
          <ThemedText type="body" weight="regular" themeColor="text-secondary" className="mt-1.5">
            {posture.detail}
          </ThemedText>
        </View>
      </View>

      {posture.actionRoute && posture.actionLabel ? (
        <Pressable
          testID="security-posture-action"
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={posture.actionLabel}
          android_ripple={{ color: colors['surface-muted'] }}
          className="flex-row items-center justify-center border-t px-5"
          style={{ borderTopColor: colors.border, minHeight: 56 }}
        >
          <ThemedText type="default" weight="semibold" style={{ color: accent }}>
            {posture.actionLabel}
          </ThemedText>
          <Ionicons
            name="arrow-forward"
            size={18}
            color={accent}
            style={{ marginLeft: 6 }}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
