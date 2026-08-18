/**
 * Shared chrome for login and register. Presentational — the only branch is
 * `showHero`, and it exists so the taller register form keeps its fields
 * above the fold. A register screen that renders the 120dp hero pushes the
 * first input off screen on a small device, which is a bug nobody sees on the
 * simulator they develop against.
 */
import { ThemedText } from '@/components/themed-text';
import { AuthShell } from '@/modules/auth/components/auth-shell';
import { renderScreen } from '../test-utils';

describe('AuthShell', () => {
  it('renders the form it wraps', async () => {
    const view = await renderScreen(
      <AuthShell>
        <ThemedText>แบบฟอร์ม</ThemedText>
      </AuthShell>,
    );

    expect(view.getByText('แบบฟอร์ม')).toBeOnTheScreen();
  });

  it('shows the hero by default', async () => {
    const view = await renderScreen(
      <AuthShell>
        <ThemedText>แบบฟอร์ม</ThemedText>
      </AuthShell>,
    );

    expect(view.getByText('BP Mobile')).toBeOnTheScreen();
    expect(view.getByText('ติดตามความดันโลหิตอย่างง่ายดาย')).toBeOnTheScreen();
  });

  it('hides it for the taller form', async () => {
    const view = await renderScreen(
      <AuthShell showHero={false}>
        <ThemedText>แบบฟอร์ม</ThemedText>
      </AuthShell>,
    );

    expect(view.queryByText('BP Mobile')).toBeNull();
    expect(view.queryByText('ติดตามความดันโลหิตอย่างง่ายดาย')).toBeNull();
    // The form still renders — hiding the hero must not take the card with it.
    expect(view.getByText('แบบฟอร์ม')).toBeOnTheScreen();
  });

  it('keeps the copyright line in both modes', async () => {
    for (const showHero of [true, false]) {
      const view = await renderScreen(
        <AuthShell showHero={showHero}>
          <ThemedText>แบบฟอร์ม</ThemedText>
        </AuthShell>,
      );

      expect(view.getByText('Copyright©2026 BP Mobile App')).toBeOnTheScreen();
    }
  });
});
