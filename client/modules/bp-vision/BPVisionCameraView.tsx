/**
 * Native CameraX preview view (Android-only) exposed as a React component.
 *
 * Backed by `BPVisionCameraView.kt` in the bp-vision module. `capture()` is a
 * native view function reachable through the component ref; it resolves with an
 * upright JPEG `{ uri, width, height }`, matching `expo-camera`'s
 * `takePictureAsync` contract so `utils/crop-to-viewport.ts` needs no changes.
 *
 * Consumers should go through `components/bp-camera-view.tsx`, which picks this
 * on Android and falls back to `expo-camera` elsewhere — don't render this
 * directly on iOS / web (the native view isn't registered there).
 */
import { requireNativeView } from 'expo';
import * as React from 'react';
import type { ViewProps } from 'react-native';

export interface BpVisionCameraCapture {
  uri: string;
  width: number;
  height: number;
}

/** Imperative handle surfaced on the native view ref. */
export interface BpVisionCameraNativeRef {
  capture(): Promise<BpVisionCameraCapture>;
}

export interface BpVisionCameraViewProps extends ViewProps {
  onCameraReady?: (event: { nativeEvent: Record<string, never> }) => void;
  onMountError?: (event: { nativeEvent: { message?: string } }) => void;
}

// `requireNativeView` doesn't express ref forwarding in its type, but the
// native view does attach its `capture` AsyncFunction onto the ref at runtime.
const NativeView = requireNativeView<BpVisionCameraViewProps>(
  'BPVision',
) as unknown as React.ForwardRefExoticComponent<
  BpVisionCameraViewProps & React.RefAttributes<BpVisionCameraNativeRef>
>;

export const BPVisionCameraView = React.forwardRef<
  BpVisionCameraNativeRef,
  BpVisionCameraViewProps
>((props, ref) => <NativeView {...props} ref={ref} />);

BPVisionCameraView.displayName = 'BPVisionCameraView';
