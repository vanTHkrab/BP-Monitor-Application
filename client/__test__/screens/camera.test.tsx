/**
 * Camera — the four gates that render *instead of* the camera.
 *
 * The capture surface itself is out of reach here: it is a native Kotlin view
 * (`modules/bp-vision`) behind `expo-camera`, with a CameraX analysis stream
 * feeding live framing. The stub below forwards a ref whose `capture()` is a
 * test double, which is enough to prove *which chain the screen runs on a
 * shot* — nothing more. Framing, focus, and the analysis stream stay device
 * questions. What is otherwise reachable is everything the screen decides
 * *before* it mounts that surface, and those four early returns are where the
 * screen's real judgement lives:
 *
 *  1. A caregiver with no patient selected.
 *  2. A caregiver whose grant is `view` only.
 *  3. Permission not yet resolved.
 *  4. Permission refused — in two variants, because "ask again" and "go to
 *     Settings" are different instructions.
 *
 * Gates 1 and 2 sit deliberately *before* the permission gate. The screen's
 * own comment says why, and it is the assertion worth having: asking for the
 * camera first means a caregiver frames, captures, and confirms a reading the
 * gateway was always going to refuse — and the measurement the patient just
 * sat through is gone. Ordering, not just presence, is what these pin.
 *
 * The native and media modules are stubbed at their package boundary. None of
 * them is reached on any path this file exercises; they are mocked because
 * they throw at *import* time under jest, so without them the suite does not
 * load at all and the gates cannot be tested either.
 */
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [mockPermission.current, jest.fn()],
  CameraView: () => null,
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('expo-image', () => {
  const { Image } = require('react-native');
  return { Image };
});

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(() => Promise.resolve({ isConnected: true })),
  addEventListener: jest.fn(() => jest.fn()),
}));

/*
 * The capture module's barrel reaches the native `bp-vision` view at import,
 * so it is replaced wholesale rather than spread.
 *
 * The two hook stubs mirror the real return shapes exactly — `state`, not
 * `framing`; `phase`/`result`/`lowConfidence`/`isSaving`, not a subset. A
 * near-miss here does not fail as a bad mock: the screen destructures
 * `undefined` and dies inside a render with `Cannot read properties of
 * undefined (reading 'label')`, which reads as a bug in the screen. `state:
 * 'searching'` is also the honest default — it is what a device with no live
 * detection reports, which the screen supports as a degraded mode rather than
 * an error.
 */
jest.mock('@/modules/capture', () => {
  const { forwardRef, useImperativeHandle } = require('react');
  return {
    // Records its live props so a test can fire `onMountError` /
    // `onCameraReady` itself, the way the real native view would, and
    // forwards a ref whose `capture()` is swappable per test. Without the
    // ref, `takePicture()` returns on its first line and the entire
    // live-camera branch is unreachable — which is how a stale mock of it
    // once stayed green.
    BpCameraView: forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<{ capture: () => unknown }>) => {
        mockBpCameraViewProps.current = props;
        useImperativeHandle(ref, () => ({ capture: () => mockCapture.current() }), []);
        return null;
      },
    ),
    PHASE_LABEL: {},
    isLiveDetectionSupported: () => false,
    // The two prepare chains are separate exports because the screen picks
    // between them, and asserting which one ran is the point of that split.
    prepareCaptureForAnalysis: jest.fn(),
    prepareImageForAnalysis: jest.fn(),
    useCameraAnalysis: () => mockCameraAnalysis.current,
    useLiveFraming: () => ({
      state: 'searching',
      isCountingDown: false,
      countdownProgress: 0,
      onFrame: jest.fn(),
      cancelAutoCapture: jest.fn(),
      reset: jest.fn(),
    }),
  };
});

const mockPermission = {
  current: null as { granted: boolean; canAskAgain: boolean } | null,
};

const mockSession = {
  current: {
    user: null as Record<string, unknown> | null,
    isAuthenticated: true,
  },
};
const mockActivePatient = {
  current: {
    patient: null as Record<string, unknown> | null,
    viewingPatientId: undefined as string | undefined,
  },
};

/** What `BpCameraView` was last rendered with — lets a test fire its events. */
const mockBpCameraViewProps: { current: Record<string, unknown> } = { current: {} };

/** What the forwarded ref's `capture()` resolves with, per test. */
const mockCapture: { current: () => unknown } = { current: jest.fn() };

type MockCameraAnalysis = {
  phase: 'idle' | 'reading' | 'uploading' | 'queued' | 'processing' | 'done' | 'failed';
  result: {
    readings: { systolic: number; diastolic: number; pulse: number } | null;
    confidence: number;
    status: string;
  } | null;
  lowConfidence: boolean;
  unreadable: boolean;
  isSaving: boolean;
  analyze: jest.Mock;
  readOnDevice: jest.Mock;
  save: jest.Mock;
  reset: jest.Mock;
  dismissLowConfidence: jest.Mock;
  dismissUnreadable: jest.Mock;
};

/** A fresh set of jest.fn()s each time, so `.mock.calls` never leaks between tests. */
const createMockCameraAnalysis = (): MockCameraAnalysis => ({
  phase: 'idle',
  result: null,
  lowConfidence: false,
  unreadable: false,
  isSaving: false,
  analyze: jest.fn(),
  readOnDevice: jest.fn(),
  save: jest.fn(),
  reset: jest.fn(),
  dismissLowConfidence: jest.fn(),
  dismissUnreadable: jest.fn(),
});

const mockCameraAnalysis: { current: MockCameraAnalysis } = { current: createMockCameraAnalysis() };

jest.mock('@/modules/auth', () => ({
  useSession: () => mockSession.current,
}));

jest.mock('@/modules/caregivers', () => ({
  ...jest.requireActual('@/modules/caregivers'),
  useActivePatient: () => mockActivePatient.current,
}));

import NetInfo from '@react-native-community/netinfo';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import CameraScreen from '@/app/(tabs)/camera';
import { prepareCaptureForAnalysis, prepareImageForAnalysis } from '@/modules/capture';
import { act, fireEvent, renderScreen, waitFor } from '../test-utils';

const PICK_A_PATIENT = 'เลือกผู้ป่วยก่อนถ่ายภาพ';
const VIEW_ONLY = 'คุณดูข้อมูลได้อย่างเดียว';
const NEEDS_PERMISSION = 'ต้องการสิทธิ์เข้าถึงกล้อง';

/** Runs the button at `index` of the last Alert — same helper shape as `profile.test.tsx` / `history.test.tsx`. */
function pressAlertButton(index: number) {
  const spy = Alert.alert as unknown as jest.Mock;
  const buttons = spy.mock.calls.at(-1)?.[2] as { onPress?: () => void }[] | undefined;
  return buttons?.[index]?.onPress?.();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockPermission.current = { granted: true, canAskAgain: true };
  mockSession.current = { user: { role: 'patient' }, isAuthenticated: true };
  mockActivePatient.current = { patient: null, viewingPatientId: undefined };
  mockBpCameraViewProps.current = {};
  mockCameraAnalysis.current = createMockCameraAnalysis();
  (prepareImageForAnalysis as jest.Mock).mockResolvedValue({
    uri: 'file://prepared.jpg',
    width: 800,
    height: 600,
  });
  // A distinct URI from the gallery chain's, so a test asserting on what was
  // analysed also proves which chain produced it.
  (prepareCaptureForAnalysis as jest.Mock).mockResolvedValue({
    uri: 'file://camera-prepared.jpg',
    width: 900,
    height: 1600,
  });
  mockCapture.current = jest
    .fn()
    .mockResolvedValue({ uri: 'file://shot.jpg', width: 4032, height: 3024 });
});

describe('CameraScreen — the caregiver gates', () => {
  it('asks a caregiver to pick a patient before opening the camera', async () => {
    mockSession.current = {
      user: { role: 'caregiver' },
      isAuthenticated: true,
    };
    const view = await renderScreen(<CameraScreen />);

    expect(view.getByText(PICK_A_PATIENT)).toBeOnTheScreen();
  });

  /*
   * The ordering assertion. This gate is reached with permission unresolved
   * (`null`), which would otherwise render the loading gate — so seeing the
   * caregiver message here proves the caregiver check runs first. Reversed,
   * the app asks for a camera it cannot use yet.
   */
  it('checks for a patient before it checks for camera permission', async () => {
    mockSession.current = {
      user: { role: 'caregiver' },
      isAuthenticated: true,
    };
    mockPermission.current = null;
    const view = await renderScreen(<CameraScreen />);

    expect(view.getByText(PICK_A_PATIENT)).toBeOnTheScreen();
    expect(view.queryByText('กำลังโหลด...')).toBeNull();
  });

  /*
   * A `view`-only caregiver is stopped before the camera, not at save time.
   * The gateway refuses the write either way, but finding out after framing,
   * capturing, and confirming loses the one measurement the patient just sat
   * through.
   */
  it('stops a view-only caregiver before the camera rather than at save time', async () => {
    mockSession.current = {
      user: { role: 'caregiver' },
      isAuthenticated: true,
    };
    mockActivePatient.current = {
      patient: { firstname: 'สมชาย', permission: 'view' },
      viewingPatientId: 'p1',
    };
    const view = await renderScreen(<CameraScreen />);

    expect(view.getByTestId('camera-view-only')).toBeOnTheScreen();
    expect(view.getByText(VIEW_ONLY)).toBeOnTheScreen();
  });

  // Names the patient who set the grant, so the user knows who to ask.
  it('names the patient whose grant is the limit', async () => {
    mockSession.current = {
      user: { role: 'caregiver' },
      isAuthenticated: true,
    };
    mockActivePatient.current = {
      patient: { firstname: 'สมชาย', permission: 'view' },
      viewingPatientId: 'p1',
    };
    const view = await renderScreen(<CameraScreen />);

    expect(view.getByText(/คุณสมชาย ให้สิทธิ์คุณดูข้อมูลเท่านั้น/)).toBeOnTheScreen();
  });

  // Read-only access is still access, so the caregiver is pointed at the
  // history rather than left on a dead end.
  it('offers the history as the thing a view-only caregiver can do', async () => {
    mockSession.current = {
      user: { role: 'caregiver' },
      isAuthenticated: true,
    };
    mockActivePatient.current = {
      patient: { firstname: 'สมชาย', permission: 'view' },
      viewingPatientId: 'p1',
    };
    const view = await renderScreen(<CameraScreen />);

    expect(view.getByText('ดูประวัติแทน')).toBeOnTheScreen();
  });

  it('lets a `full` caregiver past both gates', async () => {
    mockSession.current = {
      user: { role: 'caregiver' },
      isAuthenticated: true,
    };
    mockActivePatient.current = {
      patient: { firstname: 'สมชาย', permission: 'full' },
      viewingPatientId: 'p1',
    };
    const view = await renderScreen(<CameraScreen />);

    expect(view.queryByText(PICK_A_PATIENT)).toBeNull();
    expect(view.queryByText(VIEW_ONLY)).toBeNull();
  });

  // A patient is never subject to either gate, whatever the active-patient
  // store happens to hold.
  it('never shows a caregiver gate to a patient', async () => {
    const view = await renderScreen(<CameraScreen />);

    expect(view.queryByText(PICK_A_PATIENT)).toBeNull();
    expect(view.queryByText(VIEW_ONLY)).toBeNull();
  });
});

describe('CameraScreen — the permission gates', () => {
  // `null` is "not asked yet", which is not the same as refused. Collapsing
  // the two shows a refusal screen to someone who was never asked.
  it('waits rather than claiming refusal while permission is unresolved', async () => {
    mockPermission.current = null;
    const view = await renderScreen(<CameraScreen />);

    expect(view.getByText('กำลังโหลด...')).toBeOnTheScreen();
    expect(view.queryByText(NEEDS_PERMISSION)).toBeNull();
  });

  it('asks for the camera when permission has not been granted', async () => {
    mockPermission.current = { granted: false, canAskAgain: true };
    const view = await renderScreen(<CameraScreen />);

    expect(view.getByText(NEEDS_PERMISSION)).toBeOnTheScreen();
    expect(
      view.getByText('แอปต้องการสิทธิ์ในการเข้าถึงกล้องเพื่อถ่ายภาพเครื่องวัดความดัน'),
    ).toBeOnTheScreen();
    expect(view.getByText('อนุญาตใช้กล้อง')).toBeOnTheScreen();
  });

  /*
   * Once the OS will not ask again, an in-app prompt does nothing — the only
   * working instruction is "go to Settings", and a button still labelled
   * "อนุญาตใช้กล้อง" is a button that silently fails every time.
   */
  it('sends the user to Settings once the OS will not ask again', async () => {
    mockPermission.current = { granted: false, canAskAgain: false };
    const view = await renderScreen(<CameraScreen />);

    expect(
      view.getByText('ตอนนี้แอปยังใช้กล้องไม่ได้ กรุณาเปิดสิทธิ์กล้องจากหน้าการตั้งค่า'),
    ).toBeOnTheScreen();
    expect(view.getByText('เปิดการตั้งค่า')).toBeOnTheScreen();
    expect(view.queryByText('อนุญาตใช้กล้อง')).toBeNull();
  });

  // Recovery for a grant that landed while the camera surface did not pick it
  // up. Offered on both refusal variants, since either can be the desync.
  it('offers a retry alongside the permission prompt', async () => {
    mockPermission.current = { granted: false, canAskAgain: true };
    const view = await renderScreen(<CameraScreen />);

    expect(view.getByLabelText('ลองใช้กล้องอีกครั้ง')).toBeOnTheScreen();
  });

  it('shows no permission gate once the camera is granted', async () => {
    const view = await renderScreen(<CameraScreen />);

    expect(view.queryByText(NEEDS_PERMISSION)).toBeNull();
    expect(view.queryByText('กำลังโหลด...')).toBeNull();
  });
});

/**
 * Past all four gates — everything above proved the screen decides *before*
 * mounting the camera surface; this covers what happens once it has.
 *
 * The gallery pick (`เลือกรูปจากอัลบั้ม`) is the entry point for most tests
 * here because `pickImage()` reaches `startCaptureFlow` without touching the
 * camera ref. The shutter is reachable too, via the `capture()` the stubbed
 * `BpCameraView` forwards, and one test uses it — the two paths prepare the
 * photo differently and that difference is worth pinning.
 *
 * `useCameraAnalysis` is a live, per-test-controllable double
 * (`mockCameraAnalysis.current`) rather than the fixed stub the gates above
 * use — the whole point here is asserting on what the screen does with
 * different `analyze` / `readOnDevice` outcomes.
 */
describe('CameraScreen — the capture flow, once past the gates', () => {
  const GALLERY_BUTTON = 'เลือกรูปจากอัลบั้ม';
  const SHUTTER = 'ถ่ายภาพเครื่องวัดความดัน';
  const CONFIRM_CAPTURE = 'ยืนยันภาพและกรอกค่าความดัน';
  const ENTRY_SHEET_TITLE = 'กรอกค่าความดัน';
  const UNREADABLE_ALERT_TITLE = 'ไม่สามารถอ่านค่าจากภาพได้';
  const UNREADABLE_ALERT_MESSAGE =
    'กรุณาจัดเครื่องวัดความดันให้อยู่ตรงหน้ากล้อง ไม่เอียง ไม่ไกลเกินไป และไม่กลับหัว แล้วลองถ่ายภาพอีกครั้ง';

  const pickFromGallery = (uri = 'file://gallery.jpg') => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri, width: 1200, height: 900 }],
    });
  };

  /*
   * The two intake paths must not converge on one chain. A live capture is
   * cropped back to the viewport it was framed in — that is what makes
   * "captured" equal "framed" — and a gallery pick must not be, because it was
   * never bound to a preview and cropping would only throw away image area.
   * Both assertions are one `await` apart in the screen and nothing else
   * would notice them swapping.
   */
  it('runs the live capture through the cropping chain', async () => {
    const view = await renderScreen(<CameraScreen />);

    await fireEvent.press(view.getByLabelText(SHUTTER));

    await waitFor(() => expect(prepareCaptureForAnalysis).toHaveBeenCalled());
    // The photo's own dimensions are forwarded, not re-measured: `Image.getSize`
    // has been seen to hang on a fresh camera URI.
    expect(prepareCaptureForAnalysis).toHaveBeenCalledWith(
      'file://shot.jpg',
      4032,
      3024,
      expect.any(Number),
    );
    expect(prepareImageForAnalysis).not.toHaveBeenCalled();

    // And what reaches the analyser is that chain's output, not the raw shot.
    await waitFor(() =>
      expect(mockCameraAnalysis.current.analyze).toHaveBeenCalledWith(
        'file://camera-prepared.jpg',
        expect.anything(),
      ),
    );
  });

  it('runs a gallery pick through the chain that does not crop', async () => {
    pickFromGallery();

    const view = await renderScreen(<CameraScreen />);
    await fireEvent.press(view.getByLabelText(GALLERY_BUTTON));

    await waitFor(() => expect(prepareImageForAnalysis).toHaveBeenCalled());
    expect(prepareImageForAnalysis).toHaveBeenCalledWith('file://gallery.jpg', 1200, 900);
    expect(prepareCaptureForAnalysis).not.toHaveBeenCalled();
  });

  it('still records the reading when the shutter itself fails', async () => {
    // Nothing on this screen may prevent a reading being recorded, so a failed
    // capture has to leave the screen usable and stop short of the analysis
    // chain — not throw through `startCaptureFlow`.
    mockCapture.current = jest.fn().mockRejectedValue(new Error('camera busy'));

    const view = await renderScreen(<CameraScreen />);
    await fireEvent.press(view.getByLabelText(SHUTTER));

    await waitFor(() => expect(mockCapture.current).toHaveBeenCalled());
    expect(prepareCaptureForAnalysis).not.toHaveBeenCalled();
    expect(mockCameraAnalysis.current.analyze).not.toHaveBeenCalled();
    // The shutter is still there to try again.
    expect(view.getByLabelText(SHUTTER)).toBeOnTheScreen();
  });

  // Task 1 (camera-lifecycle bug): only the JS-level wiring is provable here
  // — that a cancelled gallery pick reuses `retryCamera()`. Whether the
  // native preview actually goes black and actually recovers is a real
  // device/emulator question this suite cannot answer; see the report.
  it('clears a reported camera-mount error once the gallery picker is cancelled', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: true,
      assets: null,
    });

    const view = await renderScreen(<CameraScreen />);

    // Simulate the native view reporting a broken mount, the same event
    // `BPVisionCameraView` / `expo-camera` fire for a genuine bind failure.
    await act(async () => {
      (mockBpCameraViewProps.current.onMountError as (e: { message?: string }) => void)?.({
        message: 'เปิดกล้องไม่สำเร็จ',
      });
    });
    expect(view.getByText('กล้องใช้งานไม่ได้')).toBeOnTheScreen();

    await fireEvent.press(view.getByLabelText(GALLERY_BUTTON));

    // `retryCamera()` is what clears `cameraMountError` — its other two
    // effects (`cameraKey`, `isCameraReady`) have no observable trace
    // through this mock, which is exactly why this fix cannot be fully
    // proven here (see Task 1 in the report).
    await waitFor(() => expect(view.queryByText('กล้องใช้งานไม่ได้')).toBeNull());
  });

  // Task 2: the online path now matches the offline path's "open
  // unconditionally on completion" behaviour, instead of requiring a manual
  // tap on "ยืนยันภาพ". The mock calls `onSettled` the same way the real
  // `analyze` now does — synchronously, before its own promise resolves —
  // because that ordering is itself load-bearing: it is what lets React
  // batch the sheet opening with the hook's `phase: 'done'` update into one
  // commit, so the phase pill and the sheet read as the same event rather
  // than a pill-then-popup lag. A test built around `.then()` on the
  // returned promise would not catch a regression back to that.
  type MockAnalyzeOptions = { onSettled?: (outcome: unknown) => void };

  it('opens the entry sheet once an online analysis finishes, and fills a confident read', async () => {
    pickFromGallery();
    let settle: () => void = () => {};
    mockCameraAnalysis.current.analyze = jest.fn(
      (_uri: string, options?: MockAnalyzeOptions) =>
        new Promise((resolve) => {
          settle = () => {
            const outcome = { confident: true, readings: { systolic: 120, diastolic: 80, pulse: 70 } };
            options?.onSettled?.(outcome);
            resolve(outcome);
          };
        }),
    );

    const view = await renderScreen(<CameraScreen />);
    await fireEvent.press(view.getByLabelText(GALLERY_BUTTON));

    // The photo is captured and `analyze` is in flight, but nothing has
    // settled yet — the sheet must not be open.
    await waitFor(() => expect(mockCameraAnalysis.current.analyze).toHaveBeenCalled());
    expect(view.queryByText(ENTRY_SHEET_TITLE)).toBeNull();

    await act(async () => {
      settle();
    });

    await waitFor(() => expect(view.getByText(ENTRY_SHEET_TITLE)).toBeOnTheScreen());
    expect(view.getByDisplayValue('120')).toBeOnTheScreen();
    expect(view.getByDisplayValue('80')).toBeOnTheScreen();
    expect(view.getByDisplayValue('70')).toBeOnTheScreen();
  });

  /*
   * Superseded by the unreadable dialog below: an engine that ran and found
   * nothing no longer opens the sheet with an in-sheet banner — it fires
   * `Alert.alert` instead, and the sheet stays closed until the user picks
   * "กรอกเอง". `analyze`'s `onSettled` still runs synchronously in the same
   * tick as `phase: 'done'` (see the comment on the confident-read test
   * above); this pins that the *reaction* to that outcome changed, not the
   * timing.
   */
  it('fires the unreadable dialog instead of opening the entry sheet, when the online analysis finds nothing', async () => {
    pickFromGallery();
    let settle: () => void = () => {};
    mockCameraAnalysis.current.analyze = jest.fn(
      (_uri: string, options?: MockAnalyzeOptions) =>
        new Promise((resolve) => {
          settle = () => {
            const outcome = { confident: false, readings: null };
            mockCameraAnalysis.current.unreadable = true;
            options?.onSettled?.(outcome);
            resolve(outcome);
          };
        }),
    );

    const view = await renderScreen(<CameraScreen />);
    await fireEvent.press(view.getByLabelText(GALLERY_BUTTON));
    await waitFor(() => expect(mockCameraAnalysis.current.analyze).toHaveBeenCalled());

    await act(async () => {
      settle();
    });

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        UNREADABLE_ALERT_TITLE,
        UNREADABLE_ALERT_MESSAGE,
        expect.arrayContaining([
          expect.objectContaining({ text: 'ถ่ายใหม่' }),
          expect.objectContaining({ text: 'กรอกเอง' }),
        ]),
      ),
    );
    // Never a gate, but also never an open sheet the user did not ask for —
    // the dialog's own two actions are what decide where the user goes next.
    expect(view.queryByText(ENTRY_SHEET_TITLE)).toBeNull();
  });

  // The offline branch fires the identical dialog for the identical
  // reason — the screen's reaction to "engine ran, found nothing" does not
  // depend on which engine ran it.
  it('fires the same unreadable dialog on the offline path', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: false });
    pickFromGallery();
    mockCameraAnalysis.current.readOnDevice = jest.fn(async () => {
      mockCameraAnalysis.current.unreadable = true;
      return { confident: false, readings: null };
    });

    const view = await renderScreen(<CameraScreen />);
    await fireEvent.press(view.getByLabelText(GALLERY_BUTTON));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        UNREADABLE_ALERT_TITLE,
        UNREADABLE_ALERT_MESSAGE,
        expect.any(Array),
      ),
    );
    expect(view.queryByText(ENTRY_SHEET_TITLE)).toBeNull();
  });

  /*
   * The dialog's two actions, both reachable only after `Alert.alert` fired
   * (above) — this is what "never a gate" resolves to now that the banner is
   * gone. "ถ่ายใหม่" (index 0) returns to the live preview without ever
   * opening the sheet; "กรอกเอง" (index 1) opens it for manual entry, empty,
   * alongside whatever independent banners the sheet already shows (the
   * offline notice, here, to also cover that the two facts — offline, and
   * unreadable — still render together once the sheet does open).
   */
  it('"ถ่ายใหม่" clears back to the live camera without opening the sheet', async () => {
    pickFromGallery();
    let settle: () => void = () => {};
    mockCameraAnalysis.current.analyze = jest.fn(
      (_uri: string, options?: MockAnalyzeOptions) =>
        new Promise((resolve) => {
          settle = () => {
            const outcome = { confident: false, readings: null };
            options?.onSettled?.(outcome);
            resolve(outcome);
          };
        }),
    );

    const view = await renderScreen(<CameraScreen />);
    await fireEvent.press(view.getByLabelText(GALLERY_BUTTON));
    await waitFor(() => expect(mockCameraAnalysis.current.analyze).toHaveBeenCalled());
    // Confirms the captured-photo screen (not the live preview) is what is
    // showing right before the retake, so the assertion below is a real
    // transition rather than a no-op.
    expect(view.getByLabelText(CONFIRM_CAPTURE)).toBeOnTheScreen();

    await act(async () => {
      settle();
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());

    await act(async () => {
      await pressAlertButton(0);
    });

    expect(view.queryByLabelText(CONFIRM_CAPTURE)).toBeNull();
    expect(view.getByLabelText(SHUTTER)).toBeOnTheScreen();
    expect(view.queryByText(ENTRY_SHEET_TITLE)).toBeNull();
  });

  /*
   * The retake-with-no-re-capture case, and the reason `retake` bumps
   * `captureGenerationRef` rather than leaving that to `startCaptureFlow`.
   *
   * A superseded `readOnDevice` returns `null` — deliberately the same value
   * as "no on-device engine on this platform", which the offline branch
   * treats as a reason to open the entry sheet for manual entry. Nothing
   * downstream of that return can tell the two apart, so the generation
   * check is the only thing that keeps an abandoned photo's late read from
   * opening the sheet on top of a live camera preview. If the user retakes
   * and then simply waits — never taking a second photo — `startCaptureFlow`
   * never runs again, so a bump that lived only there would never fire.
   */
  it('ignores an on-device read that lands after a retake, with no new capture in between', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: false });
    pickFromGallery();
    let settleRead: (value: unknown) => void = () => {};
    mockCameraAnalysis.current.readOnDevice = jest.fn(
      () => new Promise((resolve) => (settleRead = resolve)),
    );

    const view = await renderScreen(<CameraScreen />);
    await fireEvent.press(view.getByLabelText(GALLERY_BUTTON));

    // The photo is on screen and the on-device engine is still running.
    await waitFor(() => expect(mockCameraAnalysis.current.readOnDevice).toHaveBeenCalled());
    expect(view.getByLabelText(CONFIRM_CAPTURE)).toBeOnTheScreen();

    // The user gives up on this shot and goes back to the camera — and then
    // does nothing. No second capture follows.
    await fireEvent.press(view.getByLabelText('ถ่ายภาพใหม่'));
    expect(view.getByLabelText(SHUTTER)).toBeOnTheScreen();

    // Only now does the abandoned read finish. `null` is what the real hook
    // returns for a superseded read (its own generation guard fired first).
    await act(async () => {
      settleRead(null);
    });

    // It must change nothing: the user is left on the live camera, not
    // staring at an entry sheet for a photo they already discarded.
    expect(view.queryByText(ENTRY_SHEET_TITLE)).toBeNull();
    expect(view.getByLabelText(SHUTTER)).toBeOnTheScreen();
    expect(view.queryByLabelText(CONFIRM_CAPTURE)).toBeNull();
    // And the offline banner's flag must not have been forced back on for a
    // capture that no longer exists.
    expect(view.queryByText(/ตอนนี้ออฟไลน์อยู่/)).toBeNull();
  });

  it('"กรอกเอง" opens the sheet empty, offline notice and all', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: false });
    pickFromGallery();
    mockCameraAnalysis.current.readOnDevice = jest.fn(async () => ({
      confident: false,
      readings: null,
    }));

    const view = await renderScreen(<CameraScreen />);
    await fireEvent.press(view.getByLabelText(GALLERY_BUTTON));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());

    await act(async () => {
      await pressAlertButton(1);
    });

    await waitFor(() => expect(view.getByText(ENTRY_SHEET_TITLE)).toBeOnTheScreen());
    expect(view.getByText(/ตอนนี้ออฟไลน์อยู่/)).toBeOnTheScreen();
    expect(view.getByPlaceholderText('SYS').props.value).toBe('');
    expect(view.getByPlaceholderText('DIA').props.value).toBe('');
  });

  /*
   * The low-confidence banner used to offer a choice — "ใช้ค่านี้" applied the
   * read, "แก้เอง" discarded it. Both are gone: the read is auto-applied the
   * same way a confident one is (see `applyOutcomeReadings` in the screen),
   * and the banner's one button is a plain acknowledgement that neither
   * fills nor clears anything.
   */
  it('auto-applies a low-confidence read and offers only one way to dismiss the banner', async () => {
    pickFromGallery();
    let settle: () => void = () => {};
    mockCameraAnalysis.current.analyze = jest.fn(
      (_uri: string, options?: MockAnalyzeOptions) =>
        new Promise((resolve) => {
          settle = () => {
            const outcome = { confident: false, readings: { systolic: 118, diastolic: 76, pulse: 68 } };
            mockCameraAnalysis.current.lowConfidence = true;
            mockCameraAnalysis.current.result = {
              readings: outcome.readings,
              confidence: 0.3,
              status: 'low_confidence',
            };
            options?.onSettled?.(outcome);
            resolve(outcome);
          };
        }),
    );

    const view = await renderScreen(<CameraScreen />);
    await fireEvent.press(view.getByLabelText(GALLERY_BUTTON));
    await waitFor(() => expect(mockCameraAnalysis.current.analyze).toHaveBeenCalled());

    await act(async () => {
      settle();
    });

    await waitFor(() => expect(view.getByText(ENTRY_SHEET_TITLE)).toBeOnTheScreen());
    // Filled without a tap, unlike the old two-button version of this banner.
    expect(view.getByDisplayValue('118')).toBeOnTheScreen();
    expect(view.getByDisplayValue('76')).toBeOnTheScreen();
    expect(view.getByDisplayValue('68')).toBeOnTheScreen();
    // The choice is gone — neither old button survives — leaving exactly one.
    expect(view.queryByText('ใช้ค่านี้')).toBeNull();
    expect(view.queryByText('แก้เอง')).toBeNull();
    expect(view.getByText('เข้าใจแล้ว')).toBeOnTheScreen();

    await fireEvent.press(view.getByText('เข้าใจแล้ว'));

    // Dismissing the banner only hides it — the numbers it already filled
    // must survive the tap, not reset to whatever "discard" used to mean.
    expect(mockCameraAnalysis.current.dismissLowConfidence).toHaveBeenCalled();
    expect(view.getByDisplayValue('118')).toBeOnTheScreen();
    expect(view.getByDisplayValue('76')).toBeOnTheScreen();
    expect(view.getByDisplayValue('68')).toBeOnTheScreen();
  });
});
