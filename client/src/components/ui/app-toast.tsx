/**
 * The app's single toast surface.
 *
 * Tamagui's toast is imperative: any component calls `useToastController()`
 * and the one `<AppToast />` mounted in `app/_layout.tsx` renders whatever was
 * pushed. That indirection is the point — a screen reporting the outcome of a
 * one-shot action should not have to own a piece of UI for it, which is how
 * `Alert.alert` became the default answer everywhere.
 *
 * **Why this replaced `Alert.alert` for outcomes.** An Alert is modal: it
 * stops the app and demands a tap to dismiss. That is right for a decision
 * ("delete this?") and wrong for a report ("saved") — especially here, where
 * the success case arrives while the OS share sheet is animating in, and an
 * Alert would fight it for the screen. Decisions stay on Alert; outcomes are
 * toasts. See `modules/readings/hooks/use-export-readings.ts`.
 *
 * Colours come from the Tamagui theme, which `tamagui.config.ts` builds from
 * `theme/tokens.js` — the same source `bg-surface` reads in NativeWind, so
 * this matches the screens around it in both light and dark.
 */
import { Ionicons } from '@expo/vector-icons';
import { Toast, useToastState } from 'tamagui';

import { status } from '@/theme';

/** Set by callers via `toast.show(title, { customData: { tone } })`. */
export type ToastTone = 'success' | 'error';

const TONE: Record<ToastTone, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  // Mode-independent, like the BP status colours they come from: a failure
  // must read as the same red whichever theme the user is on.
  success: { icon: 'checkmark-circle', color: status.normal },
  error: { icon: 'alert-circle', color: status.high },
};

const isTone = (value: unknown): value is ToastTone =>
  value === 'success' || value === 'error';

export function AppToast() {
  const toast = useToastState();

  // `isHandledNatively` marks a toast the platform rendered itself; drawing
  // ours on top would show it twice.
  if (!toast || toast.isHandledNatively) return null;

  const tone = isTone(toast.customData?.tone) ? toast.customData.tone : 'success';

  return (
    <Toast
      key={toast.id}
      duration={toast.duration ?? 4000}
      // Enters and leaves upward, matching where the viewport is anchored.
      enterStyle={{ opacity: 0, scale: 0.94, y: -20 }}
      exitStyle={{ opacity: 0, scale: 0.96, y: -12 }}
      y={0}
      opacity={1}
      scale={1}
      transition="quick"
      bg="$surface"
      borderColor="$border"
      borderWidth={1}
      rounded="$6"
      px="$4"
      py="$3"
      flexDirection="row"
      items="center"
      gap="$3"
      shadowColor="#000"
      shadowOpacity={0.15}
      shadowRadius={12}
      shadowOffset={{ width: 0, height: 4 }}
      elevation={4}
    >
      <Ionicons name={TONE[tone].icon} size={22} color={TONE[tone].color} />
      <Toast.Title color="$text-primary" fontWeight="600" shrink={1}>
        {toast.title}
      </Toast.Title>
      {toast.message ? (
        <Toast.Description color="$text-secondary" shrink={1}>
          {toast.message}
        </Toast.Description>
      ) : null}
    </Toast>
  );
}
