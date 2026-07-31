/**
 * Draws a lock over the app when the app lock is on and the app has been away.
 *
 * Wraps the navigator rather than living inside a screen: locking has to
 * survive whatever route the user was on, and a per-screen implementation
 * would leave whichever screen forgot it as an open door.
 *
 * What counts as "away" is the interesting decision. Locking on every
 * `inactive` would fire on a notification shade pull or a permission dialog —
 * many times a session, each needing a fingerprint, which trains people to
 * turn the feature off. Only a real `background` transition locks. The cost is
 * a few seconds of visible content in the app switcher; the benefit is a lock
 * people keep enabled.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, Text, View, type AppStateStatus } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useAppLockStore } from '../hooks/use-app-lock';
import { biometricErrorMessage, promptDeviceUnlock } from '../lib/app-lock';

export function AppLockGate({ children }: { children: ReactNode }) {
  const enabled = useAppLockStore((state) => state.enabled);
  const unlocked = useAppLockStore((state) => state.unlocked);
  const capability = useAppLockStore((state) => state.capability);
  const hydrate = useAppLockStore((state) => state.hydrate);
  const lock = useAppLockStore((state) => state.lock);
  const unlock = useAppLockStore((state) => state.unlock);

  const [message, setMessage] = useState<string | null>(null);
  const isPrompting = useRef(false);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (enabled === null) void hydrate();
  }, [enabled, hydrate]);

  const attemptUnlock = useCallback(async () => {
    // A ref, not state: this guard is also read from the AppState callback,
    // where a state value would be whatever it was when the listener was
    // registered. Nothing renders from it either, so state would only buy a
    // wasted re-render and a stale read.
    if (isPrompting.current) return;
    isPrompting.current = true;
    setMessage(null);

    try {
      const ok = await promptDeviceUnlock('ปลดล็อกเพื่อเข้าใช้งานแอป');
      if (ok) unlock();
      else setMessage(biometricErrorMessage('authentication_failed'));
    } catch {
      setMessage(biometricErrorMessage());
    } finally {
      isPrompting.current = false;
    }
  }, [unlock]);

  useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current === 'background' && next === 'active') {
        // Coming back is when the lock goes up, not when leaving: putting it
        // up on the way out would leave a locked screen in the app switcher
        // preview, which tells a shoulder-surfer nothing but confuses the
        // owner.
        lock();
        // Prompting straight from the event rather than from an effect
        // watching `unlocked`: returning to the app should cost one
        // fingerprint, not a tap and then a fingerprint. A cold start is
        // deliberately *not* auto-prompted — a system sheet over a
        // still-settling launch screen is startling, and the button is right
        // there.
        void attemptUnlock();
      }
      appState.current = next;
    });

    return () => subscription.remove();
  }, [enabled, lock, attemptUnlock]);

  if (!enabled || unlocked) return <>{children}</>;

  return <LockScreen onUnlock={attemptUnlock} message={message} label={capability?.label} />;
}

function LockScreen({
  onUnlock,
  message,
  label,
}: {
  onUnlock: () => void;
  message: string | null;
  label?: string;
}) {
  const colors = useTheme();
  const fontScale = useFontScale();

  return (
    <GradientBackground>
      <View className="flex-1 items-center justify-center px-8">
        <View
          className="mb-6 h-24 w-24 items-center justify-center rounded-full"
          style={{ backgroundColor: colors['surface-muted'] }}
        >
          <Ionicons name="lock-closed" size={44} color={colors.primary} />
        </View>

        <Text
          className="mb-2 text-center font-bold"
          style={{ fontSize: Math.round(22 * fontScale), color: colors['text-primary'] }}
        >
          แอปถูกล็อกอยู่
        </Text>

        <Text
          className="mb-8 text-center"
          style={{ fontSize: Math.round(16 * fontScale), color: colors['text-secondary'] }}
        >
          {message ?? `ยืนยันตัวตนด้วย${label ?? 'ระบบล็อกหน้าจอ'}เพื่อเข้าใช้งาน`}
        </Text>

        <Pressable
          onPress={onUnlock}
          accessibilityRole="button"
          accessibilityLabel="ปลดล็อกแอป"
          // 64dp tall: this is the one control on the screen, and the people
          // most likely to have the lock on are the least likely to hit a
          // small target on the first try.
          className="w-full flex-row items-center justify-center rounded-2xl px-6"
          style={{ backgroundColor: colors.primary, minHeight: 64 }}
        >
          <Ionicons name="finger-print" size={24} color="#FFFFFF" />
          <Text
            className="ml-2 font-bold"
            style={{ fontSize: Math.round(17 * fontScale), color: '#FFFFFF' }}
          >
            ปลดล็อก
          </Text>
        </Pressable>
      </View>
    </GradientBackground>
  );
}
