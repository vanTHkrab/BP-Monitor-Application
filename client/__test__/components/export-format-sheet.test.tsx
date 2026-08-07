/**
 * "PDF or CSV?", asked once for all three export entry points.
 *
 * The component's own docblock says why it replaced an `Alert`: "It is
 * assertable. A test can find the PDF button and press it. The Alert version
 * could only be tested by reaching into `Alert.alert`'s mock and invoking the
 * callback at index 0 — which passes just as happily when the buttons are in
 * the wrong order." This is that test, minus the press.
 *
 * What is worth pinning is the `summary` and the per-format hints. The row
 * count and the period are what tell someone they are about to export the
 * right thing, and the hints are the only place the two formats are told
 * apart — "PDF" and "CSV" alone are three letters each to an audience that
 * may know neither.
 *
 * **Tamagui keeps a modal `Sheet`'s content mounted while closed**, which is
 * why an `open={false}` render still finds the buttons. That is the same
 * property `active-patient-banner.test.tsx` had to scope around, and it is
 * what makes this assertable without an interaction.
 */
import { ExportFormatSheet } from '@/modules/readings/components/export-format-sheet';
import { renderScreen } from '../test-utils';

const noop = () => {};

const props = {
  open: true,
  onOpenChange: noop,
  onSelect: noop,
  summary: 'ช่วง 30 วัน · 12 รายการ',
};

describe('ExportFormatSheet', () => {
  it('offers both formats', async () => {
    const view = await renderScreen(<ExportFormatSheet {...props} />);

    expect(view.getByTestId('export-format-pdf')).toBeOnTheScreen();
    expect(view.getByTestId('export-format-csv')).toBeOnTheScreen();
    expect(view.getByTestId('export-format-cancel')).toBeOnTheScreen();
  });

  // The reason this is a sheet rather than an Alert: an Alert body is a
  // single unstyled string and cannot say what is being exported.
  it('says what is about to be exported', async () => {
    const view = await renderScreen(<ExportFormatSheet {...props} />);

    expect(view.getByText('ช่วง 30 วัน · 12 รายการ')).toBeOnTheScreen();
  });

  it('titles itself for the general case by default', async () => {
    const view = await renderScreen(<ExportFormatSheet {...props} />);

    expect(view.getByText('ส่งออกรายงาน')).toBeOnTheScreen();
  });

  // The history sheet is about a range, not everything, and overrides it.
  it('takes an overriding title', async () => {
    const view = await renderScreen(<ExportFormatSheet {...props} title="ส่งออกช่วงที่เลือก" />);

    expect(view.getByText('ส่งออกช่วงที่เลือก')).toBeOnTheScreen();
    expect(view.queryByText('ส่งออกรายงาน')).toBeNull();
  });

  /*
   * The hints are what make the choice a decision rather than an acronym
   * quiz, and they are also the whole accessible name of each button — the
   * label reads "PDF — รายงานพร้อมพิมพ์ …", so losing the hint costs a screen
   * reader the distinction entirely.
   */
  it('explains what each format is for', async () => {
    const view = await renderScreen(<ExportFormatSheet {...props} />);

    expect(view.getByText('รายงานพร้อมพิมพ์ เหมาะกับการส่งให้แพทย์')).toBeOnTheScreen();
    expect(view.getByText('ตารางข้อมูล เปิดใน Excel หรือ Google Sheets ได้')).toBeOnTheScreen();

    expect(view.getByTestId('export-format-pdf')).toHaveProp(
      'accessibilityLabel',
      'PDF — รายงานพร้อมพิมพ์ เหมาะกับการส่งให้แพทย์',
    );
    expect(view.getByTestId('export-format-csv')).toHaveProp(
      'accessibilityLabel',
      'CSV — ตารางข้อมูล เปิดใน Excel หรือ Google Sheets ได้',
    );
  });
});
