/**
 * "What this reading means", and the gate that is the whole point of the
 * component: the emergency pair renders **only** for `high` and `critical`.
 *
 * That gating is what keeps "โทร 1669" from becoming the control people learn
 * to scroll past — it is on screen only when it is the answer. Widen it and
 * the button appears next to a normal reading, which is how an emergency
 * affordance stops being read as one. Narrow it and a patient in the
 * `critical` band is shown reassurance with no way to call.
 *
 * All five statuses are asserted in both directions rather than the two
 * interesting ones, because the failure mode is a comparison edited to the
 * wrong operator and the boundary is where that shows.
 */
import { EMERGENCY_NUMBER, GuidanceCard } from '@/modules/readings/components/guidance-card';
import type { BPStatus } from '@/modules/readings/types';
import { renderScreen } from '../test-utils';

const noop = () => {};

const HEADLINE: Record<BPStatus, string> = {
  low: 'ค่าความดันค่อนข้างต่ำ',
  normal: 'ค่าความดันอยู่ในเกณฑ์ดี',
  elevated: 'เริ่มสูงกว่าปกติ',
  high: 'ความดันค่อนข้างสูง',
  critical: 'เสี่ยงอันตราย ควรพบแพทย์ด่วน',
};

describe('GuidanceCard', () => {
  it('gives each status its own headline', async () => {
    for (const [status, headline] of Object.entries(HEADLINE) as [BPStatus, string][]) {
      const view = await renderScreen(<GuidanceCard status={status} onOpenHelp={noop} />);

      expect(view.getByTestId('home-guidance')).toBeOnTheScreen();
      expect(view.getByText(headline)).toBeOnTheScreen();
    }
  });

  describe('the emergency pair', () => {
    it.each(['high', 'critical'] as const)('is offered for %s', async (status) => {
      const view = await renderScreen(<GuidanceCard status={status} onOpenHelp={noop} />);

      expect(view.getByTestId('home-emergency-call')).toBeOnTheScreen();
      expect(view.getByTestId('home-open-help')).toBeOnTheScreen();
    });

    it.each(['low', 'normal', 'elevated'] as const)('is withheld for %s', async (status) => {
      const view = await renderScreen(<GuidanceCard status={status} onOpenHelp={noop} />);

      expect(view.queryByTestId('home-emergency-call')).toBeNull();
      expect(view.queryByTestId('home-open-help')).toBeNull();
    });

    /*
     * The number is on the button face, not only in the handler. Someone
     * whose phone cannot dial — a tablet — needs to be able to read it off
     * the screen, which is also what the `Linking` failure path falls back to.
     */
    it('shows the number itself, not just a "call" verb', async () => {
      const view = await renderScreen(<GuidanceCard status="critical" onOpenHelp={noop} />);

      expect(view.getByTestId('home-emergency-call')).toHaveTextContent(`โทร ${EMERGENCY_NUMBER}`);
      expect(EMERGENCY_NUMBER).toBe('1669');
    });

    it('spells the button out for a screen reader', async () => {
      const view = await renderScreen(<GuidanceCard status="high" onOpenHelp={noop} />);

      expect(view.getByTestId('home-emergency-call')).toHaveProp(
        'accessibilityLabel',
        `โทรหาหน่วยแพทย์ฉุกเฉิน ${EMERGENCY_NUMBER}`,
      );
    });
  });
});
