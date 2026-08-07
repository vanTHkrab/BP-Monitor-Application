/**
 * "เลือกผู้ป่วย" — the sheet a caregiver opens from the active-patient banner.
 *
 * The component's own docblock states the reason it is more than a name list:
 * "a caregiver opening this is asking *who needs attention*", which is why
 * `myPatients` was extended to carry a latest reading and why patients with a
 * concerning one sort first. Both of those are real behaviour and neither was
 * asserted anywhere — `sortByAttention` is exported but nothing rendered it,
 * so the ordering could invert without a single test noticing.
 *
 * What is pinned:
 *
 *   - the **rendered** order, not just `sortByAttention`'s return value. The
 *     sort is only worth anything if the list uses it, and the component could
 *     drop the call while the pure function stayed correct;
 *   - the two rows that are not a reading — "ยังไม่มีการวัด" for a patient who
 *     has never recorded, and the read-only marker;
 *   - the accessibility label, which is the entire row for a screen reader:
 *     the colour of the status line is the sighted user's version of it;
 *   - the active row's distinct treatment.
 *
 * **A Tamagui modal `Sheet` keeps its content mounted while closed**, which is
 * why these render with `open` set either way and assert on content rather
 * than on presence — `export-format-sheet.test.tsx` records the same property.
 * That also means "closed hides it" is not an assertion this component can
 * support, and it is deliberately not attempted.
 */
import {
  PatientSwitcherSheet,
  sortByAttention,
} from '@/modules/caregivers/components/patient-switcher-sheet';
import type { PatientLatestReading, PatientSummary } from '@/modules/caregivers/types';

import { renderScreen } from '../test-utils';

const reading = (
  status: PatientLatestReading['status'],
  systolic: number,
  diastolic: number,
): PatientLatestReading => ({
  systolic,
  diastolic,
  pulse: 72,
  status,
  measuredAt: new Date(2026, 0, 15, 9, 30),
});

const patient = (
  id: string,
  firstname: string,
  overrides: Partial<PatientSummary> = {},
): PatientSummary => ({
  id,
  firstname,
  lastname: 'ใจดี',
  phone: '0800000000',
  permission: 'full',
  ...overrides,
});

const NORMAL = patient('p-normal', 'นวล', { latestReading: reading('normal', 118, 76) });
const CRITICAL = patient('p-critical', 'คริส', { latestReading: reading('critical', 190, 120) });
const NEVER = patient('p-never', 'นิว');
const VIEW_ONLY = patient('p-view', 'วิว', {
  permission: 'view',
  latestReading: reading('elevated', 132, 84),
});

const noop = () => {};

const props = {
  open: true,
  onOpenChange: noop,
  onSelect: noop,
};

/** Row order as rendered, excluding the trailing cancel button. */
const rowOrder = (view: Awaited<ReturnType<typeof renderScreen>>) =>
  view
    .getAllByTestId(/^patient-switch-p-/)
    .map((node) => node.props.testID as string);

describe('PatientSwitcherSheet', () => {
  it('renders one row per patient and says how many there are', async () => {
    const view = await renderScreen(
      <PatientSwitcherSheet {...props} patients={[NORMAL, CRITICAL, NEVER]} />,
    );

    expect(view.getByText('เลือกผู้ป่วย')).toBeOnTheScreen();
    expect(view.getByText('คุณดูแลอยู่ 3 คน')).toBeOnTheScreen();
    expect(rowOrder(view)).toHaveLength(3);
    expect(view.getByTestId('patient-switch-cancel')).toBeOnTheScreen();
  });

  /*
   * The ordering rule, asserted through the rendered list. `sortByAttention`
   * ranks critical above unknown above normal — an unmeasured patient is not
   * "fine", they are unknown, and unknown sits between the two. Passing the
   * input in the *opposite* order is what makes this fail if the component
   * stops sorting: a list rendered in prop order would come back reversed.
   */
  it('puts the patient who needs attention first and the healthy one last', async () => {
    const view = await renderScreen(
      <PatientSwitcherSheet {...props} patients={[NORMAL, NEVER, CRITICAL]} />,
    );

    expect(rowOrder(view)).toEqual([
      'patient-switch-p-critical',
      'patient-switch-p-never',
      'patient-switch-p-normal',
    ]);
  });

  // The pure function is exported and used elsewhere; this pins the tie-break
  // the rendered test cannot show, since equal-rank rows sort by Thai name.
  it('breaks a tie between equal ranks by name', async () => {
    const somchai = patient('p-a', 'สมชาย', { latestReading: reading('normal', 118, 76) });
    const anong = patient('p-b', 'อนงค์', { latestReading: reading('normal', 120, 78) });

    expect(sortByAttention([anong, somchai]).map((p) => p.id)).toEqual(['p-a', 'p-b']);
  });

  it('leads each row with the latest reading', async () => {
    const view = await renderScreen(<PatientSwitcherSheet {...props} patients={[CRITICAL]} />);

    expect(view.getByText(/^190\/120 · /)).toBeOnTheScreen();
  });

  // A patient with no readings must not read as a patient with a normal one.
  it('says so when a patient has never recorded anything', async () => {
    const view = await renderScreen(<PatientSwitcherSheet {...props} patients={[NEVER]} />);

    expect(view.getByText('ยังไม่มีการวัด')).toBeOnTheScreen();
    expect(view.getByTestId('patient-switch-p-never')).toHaveProp(
      'accessibilityLabel',
      'คุณนิว ใจดี ยังไม่มีการวัด',
    );
  });

  /*
   * Read-only is labelled here rather than only at the camera, because
   * "finding out you cannot record after switching to someone is a wasted
   * switch". It appears twice — as a visible chip and inside the accessibility
   * label — and the negative case is asserted so the marker is not simply
   * always on.
   */
  it('marks a read-only link, and only a read-only link', async () => {
    const restricted = await renderScreen(
      <PatientSwitcherSheet {...props} patients={[VIEW_ONLY]} />,
    );
    expect(restricted.getByText('· ดูอย่างเดียว')).toBeOnTheScreen();
    expect(restricted.getByTestId('patient-switch-p-view').props.accessibilityLabel).toContain(
      'ดูได้อย่างเดียว',
    );

    const full = await renderScreen(<PatientSwitcherSheet {...props} patients={[NORMAL]} />);
    expect(full.queryByText('· ดูอย่างเดียว')).toBeNull();
    expect(full.getByTestId('patient-switch-p-normal').props.accessibilityLabel).not.toContain(
      'ดูได้อย่างเดียว',
    );
  });

  /*
   * The active row is the answer to "who am I looking at", so it has to be
   * distinguishable at a glance. Nothing textual changes — only the border
   * weight and colour and the trailing glyph do — so this reads the style.
   *
   * It reads `borderTopWidth`, not `borderWidth`: Tamagui expands the
   * shorthand into all four sides before it reaches the rendered node, so
   * `style.borderWidth` is `undefined` on every row and an assertion on it
   * fails identically for the active and inactive cases. Both rows are read,
   * so a component that gave every row a 2px border would fail here.
   */
  it('gives the active row a heavier border than the others', async () => {
    const view = await renderScreen(
      <PatientSwitcherSheet {...props} patients={[NORMAL, CRITICAL]} activePatientId="p-normal" />,
    );

    const borderOf = (testID: string) =>
      view.getByTestId(testID).props.style as {
        borderTopWidth?: number;
        borderTopColor?: string;
      };

    const active = borderOf('patient-switch-p-normal');
    const inactive = borderOf('patient-switch-p-critical');

    // Defined-first: two `undefined`s compare equal and would give a test that
    // cannot fail.
    expect(active.borderTopWidth).toBeDefined();
    expect(inactive.borderTopWidth).toBeDefined();
    expect(active.borderTopWidth).toBeGreaterThan(inactive.borderTopWidth as number);
    expect(active.borderTopColor).not.toBe(inactive.borderTopColor);
  });
});
