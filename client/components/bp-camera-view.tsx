/**
 * Uniform camera surface for the BP capture screen.
 *
 * Exposes ONE ref API — `capture(): Promise<{ uri, width, height }>` — plus
 * `onCameraReady` / `onMountError`, and internally renders the native CameraX
 * view (`BPVisionCameraView`) on Android, falling back to `expo-camera`'s
 * `<CameraView>` on iOS / web. This is the only place that knows the platform
 * split, so `app/(tabs)/camera.tsx` stays camera-implementation-agnostic: the
 * `capture()` result and the event shapes match `takePictureAsync` exactly, and
 * `utils/crop-to-viewport.ts` / `startCaptureFlow` are untouched.
 *
 * Back camera is fixed on both paths (the only mode the screen ever used).
 */
import {
  BPVisionCameraView,
  type BpVisionCameraCapture,
  type BpVisionCameraNativeRef,
  type BpVisionDetectionFrame,
} from '@/modules/bp-vision/BPVisionCameraView';
import { CameraView } from 'expo-camera';
import { cssInterop } from 'nativewind';
import * as React from 'react';
import { Platform } from 'react-native';

import { isBpVisionAvailable } from '@/modules/bp-vision';

// NativeWind className → style for both underlying camera surfaces (the camera
// screen positions the preview with `className="absolute inset-0"`).
cssInterop(CameraView, { className: 'style' });
cssInterop(BPVisionCameraView, { className: 'style' });

// Use the native CameraX view only when the bp-vision module is actually
// linked — i.e. an Android dev/prod build. On iOS / web, and on Android *Expo
// Go* (which ships no custom native modules), the native view isn't
// registered, so fall back to expo-camera's <CameraView> (which IS bundled in
// Expo Go) instead of rendering a view that doesn't exist. Native-module
// presence is fixed for the app's lifetime, so this is evaluated once.
const USE_NATIVE_CAMERA = Platform.OS === 'android' && isBpVisionAvailable();

export type BpCameraCapture = BpVisionCameraCapture;

export interface BpCameraViewRef {
  /** Take one upright JPEG. Rejects if the camera isn't ready or capture fails. */
  capture(): Promise<BpCameraCapture>;
}

export type BpCameraDetectionFrame = BpVisionDetectionFrame;

export interface BpCameraViewProps {
  className?: string;
  onCameraReady?: () => void;
  onMountError?: (event: { message?: string }) => void;
  /**
   * Run the on-device detector on the preview stream and report each frame's
   * boxes through `onDetections`.
   *
   * Android + a real dev/prod build only. On iOS, web, and Expo Go there is no
   * on-device detector, so this is silently inert and `onDetections` never
   * fires — callers must treat "no detections ever" as a supported state and
   * keep the screen fully usable without it, rather than waiting for a signal
   * that will not arrive.
   */
  liveDetection?: boolean;
  onDetections?: (frame: BpCameraDetectionFrame) => void;
}

/** True when `liveDetection` can actually do anything on this runtime. */
export const isLiveDetectionSupported = (): boolean => USE_NATIVE_CAMERA;

export const BpCameraView = React.forwardRef<BpCameraViewRef, BpCameraViewProps>(
  (
    { className, onCameraReady, onMountError, liveDetection, onDetections },
    ref,
  ) => {
    const nativeRef = React.useRef<BpVisionCameraNativeRef>(null);
    const cameraViewRef = React.useRef<CameraView>(null);

    React.useImperativeHandle(
      ref,
      () => ({
        capture: async () => {
          if (USE_NATIVE_CAMERA) {
            if (!nativeRef.current) throw new Error('Camera not ready');
            return nativeRef.current.capture();
          }
          if (!cameraViewRef.current) throw new Error('Camera not ready');
          const photo = await cameraViewRef.current.takePictureAsync({
            quality: 0.8,
          });
          if (!photo) throw new Error('Capture returned no photo');
          return { uri: photo.uri, width: photo.width, height: photo.height };
        },
      }),
      [],
    );

    if (USE_NATIVE_CAMERA) {
      return (
        <BPVisionCameraView
          ref={nativeRef}
          className={className}
          liveDetection={liveDetection}
          onDetections={(e) => onDetections?.(e.nativeEvent)}
          onCameraReady={() => onCameraReady?.()}
          onMountError={(e) => onMountError?.({ message: e.nativeEvent?.message })}
        />
      );
    }

    // expo-camera has no analysis stream — `liveDetection` / `onDetections`
    // are dropped here rather than faked, so the caller's "no signal" branch
    // is the same one it uses before the first frame arrives on Android.
    return (
      <CameraView
        ref={cameraViewRef}
        className={className}
        facing="back"
        onCameraReady={() => onCameraReady?.()}
        onMountError={(e) => onMountError?.({ message: e.message })}
      />
    );
  },
);

BpCameraView.displayName = 'BpCameraView';
