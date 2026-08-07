/**
 * The single-choice pill row. Its only branch that survives a screenshot is
 * `value === null` — an optional field nobody has answered yet, which must
 * show no pill selected rather than defaulting to the first one. Gender on
 * the register form is the live consumer, and a row that pre-selects "ชาย"
 * for everyone is a data-quality bug that looks like a UI detail.
 */
import { OptionRow } from '@/components/ui/option-row';
import { renderScreen } from '../test-utils';

const OPTIONS = [
  { value: 'male', label: 'ชาย' },
  { value: 'female', label: 'หญิง' },
  { value: 'other', label: 'อื่น ๆ' },
] as const;

const noop = () => {};

describe('OptionRow', () => {
  it('renders the field label and every option', async () => {
    const view = await renderScreen(
      <OptionRow label="เพศ" options={OPTIONS} value={null} onChange={noop} />,
    );

    expect(view.getByText('เพศ')).toBeOnTheScreen();
    for (const option of OPTIONS) {
      expect(view.getByText(option.label)).toBeOnTheScreen();
    }
  });

  it('selects nothing when the field is unanswered', async () => {
    const view = await renderScreen(
      <OptionRow label="เพศ" options={OPTIONS} value={null} onChange={noop} />,
    );

    for (const option of OPTIONS) {
      expect(view.getByRole('radio', { name: option.label })).not.toBeSelected();
    }
  });

  it('selects exactly the answered option', async () => {
    const view = await renderScreen(
      <OptionRow label="เพศ" options={OPTIONS} value="female" onChange={noop} />,
    );

    expect(view.getByRole('radio', { name: 'หญิง' })).toBeSelected();
    expect(view.getByRole('radio', { name: 'ชาย' })).not.toBeSelected();
    expect(view.getByRole('radio', { name: 'อื่น ๆ' })).not.toBeSelected();
  });
});
