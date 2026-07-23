/**
 * Native CameraX preview view (Android-only) exposed as a React component.
 *
 * Backed by `BPVisionCameraView.kt` in the bp-vision module. `capture()` is a
 * native view function reachable through the component ref; it resolves with an
 * upright JPEG `{ uri, width, height }`, matching `expo-camera`'s
 * `takePictureAsync` contract so `utils/crop-to-viewport.ts` needs no changes.
 *
 * Consumers should go through `components/bp-camera-view.tsx`, which picks this
 * only when the bp-vision native module is linked (an Android dev/prod build)
 * and falls back to `expo-camera` otherwise — including Android Expo Go, where
 * no custom native modules exist. Don't render this directly on iOS / web /
 * Expo Go (the native view isn't registered there).
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

type NativeViewComponent = React.ForwardRefExoticComponent<
  BpVisionCameraViewProps & React.RefAttributes<BpVisionCameraNativeRef>
>;

// Resolve the native view lazily (on first render) instead of at import time.
// `requireNativeView('BPVision')` logs "Unable to get the view config for
// BPVision" on any runtime where the view isn't registered — that's iOS / web
// AND Android *Expo Go* (no custom native modules). `BpCameraView` only renders
// this component when `isBpVisionAvailable()` is true (a real dev/prod build),
// so deferring the lookup to render keeps that warning from firing on runtimes
// that never actually use the native camera. Cached after the first resolve.
// `requireNativeView` doesn't express ref forwarding in its type, but the
// native view does attach its `capture` AsyncFunction onto the ref at runtime.
let nativeViewCache: NativeViewComponent | null = null;

function getNativeView(): NativeViewComponent {
  if (!nativeViewCache) {
    nativeViewCache = requireNativeView<BpVisionCameraViewProps>(
      'BPVision',
    ) as unknown as NativeViewComponent;
  }
  return nativeViewCache;
}

export const BPVisionCameraView = React.forwardRef<
  BpVisionCameraNativeRef,
  BpVisionCameraViewProps
>((props, ref) => {
  const NativeView = getNativeView();
  return <NativeView {...props} ref={ref} />;
});

BPVisionCameraView.displayName = 'BPVisionCameraView';
