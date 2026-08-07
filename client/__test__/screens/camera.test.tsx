/**
 * Camera — the four gates that render *instead of* the camera.
 *
 * The capture surface itself is out of reach here: it is a native Kotlin view
 * (`modules/bp-vision`) behind `expo-camera`, with a CameraX analysis stream
 * feeding live framing. There is no test seam for it and this batch does not
 * open one. What is reachable is everything the screen decides *before* it
 * mounts that surface, and those four early returns are where the screen's
 * real judgement lives:
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
jest.mock('@/modules/capture', () => ({
  BpCameraView: () => null,
  PHASE_LABEL: {},
  cropToViewport: jest.fn(),
  isLiveDetectionSupported: () => false,
  prepareImageForAnalysis: jest.fn(),
  useCameraAnalysis: () => ({
    phase: 'idle',
    result: null,
    lowConfidence: false,
    isSaving: false,
    analyze: jest.fn(),
    readOnDevice: jest.fn(),
    save: jest.fn(),
    reset: jest.fn(),
    dismissLowConfidence: jest.fn(),
  }),
  useLiveFraming: () => ({
    state: 'searching',
    isCountingDown: false,
    countdownProgress: 0,
    onFrame: jest.fn(),
    cancelAutoCapture: jest.fn(),
    reset: jest.fn(),
  }),
}));

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

jest.mock('@/modules/auth', () => ({
  useSession: () => mockSession.current,
}));

jest.mock('@/modules/caregivers', () => ({
  ...jest.requireActual('@/modules/caregivers'),
  useActivePatient: () => mockActivePatient.current,
}));

import CameraScreen from '@/app/(tabs)/camera';
import { renderScreen } from '../test-utils';

const PICK_A_PATIENT = 'เลือกผู้ป่วยก่อนถ่ายภาพ';
const VIEW_ONLY = 'คุณดูข้อมูลได้อย่างเดียว';
const NEEDS_PERMISSION = 'ต้องการสิทธิ์เข้าถึงกล้อง';

beforeEach(() => {
  jest.clearAllMocks();
  mockPermission.current = { granted: true, canAskAgain: true };
  mockSession.current = { user: { role: 'patient' }, isAuthenticated: true };
  mockActivePatient.current = { patient: null, viewingPatientId: undefined };
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
