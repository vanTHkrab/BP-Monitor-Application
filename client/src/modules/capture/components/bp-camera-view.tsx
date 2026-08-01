/**
 * One camera surface, two implementations.
 *
 * Exposes a single ref API — `capture(): Promise<{ uri, width, height }>` —
 * plus `onCameraReady` / `onMountError`, and internally renders the native
 * CameraX view on Android or `expo-camera`'s `<CameraView>` everywhere else.
 * This is **the only file that knows the platform split**, which is what keeps
 * the camera screen free of `Platform.OS` branches: the capture result and the
 * event shapes match `takePictureAsync` exactly, so `crop-to-viewport.ts` and
 * the capture flow never learn which camera took the photo.
 *
 * Back camera on both paths — the only mode this screen has ever used.
 */
import { CameraView } from 'expo-camera';
import { cssInterop } from 'nativewind';
import * as React from 'react';
import { Platform } from 'react-native';

import { isBpVisionAvailable } from '@/native/bp-vision';
import {
  BPVisionCameraView,
  type BpVisionCameraCapture,
  type BpVisionCameraNativeRef,
  type BpVisionDetectionFrame,
} from '@/native/bp-vision/BPVisionCameraView';

// The screen positions the preview with `className="absolute inset-0"`.
cssInterop(CameraView, { className: 'style' });
cssInterop(BPVisionCameraView, { className: 'style' });

/**
 * Use the native view only when the module is actually linked — an Android
 * dev/prod build. On iOS, web, and Android **Expo Go** (which ships no custom
 * native modules) the native view is not registered, so rendering it would be
 * rendering something that does not exist. Native-module presence is fixed for
 * the app's lifetime, so this is decided once.
 */
const USE_NATIVE_CAMERA = Platform.OS === 'android' && isBpVisionAvailable();

export type BpCameraCapture = BpVisionCameraCapture;
export type BpCameraDetectionFrame = BpVisionDetectionFrame;

export interface BpCameraViewRef {
  /** One upright JPEG. Rejects if the camera is not ready or capture fails. */
  capture(): Promise<BpCameraCapture>;
}

export interface BpCameraViewProps {
  className?: string;
  onCameraReady?: () => void;
  onMountError?: (event: { message?: string }) => void;
  /**
   * Run the on-device detector over the preview stream and report each frame.
   *
   * Android dev/prod builds only. On iOS, web, and Expo Go this is silently
   * inert and `onDetections` never fires — callers must treat "no detections,
   * ever" as a supported state and keep the screen fully usable, rather than
   * waiting for a signal that is not coming.
   */
  liveDetection?: boolean;
  onDetections?: (frame: BpCameraDetectionFrame) => void;
}

/** True when `liveDetection` can actually do anything on this runtime. */
export const isLiveDetectionSupported = (): boolean => USE_NATIVE_CAMERA;

export const BpCameraView = React.forwardRef<BpCameraViewRef, BpCameraViewProps>(
  ({ className, onCameraReady, onMountError, liveDetection, onDetections }, ref) => {
    const nativeRef = React.useRef<BpVisionCameraNativeRef>(null);
    const cameraViewRef = React.useRef<CameraView>(null);

    React.useImperativeHandle(
      ref,
      () => ({
        capture: async () => {
          if (USE_NATIVE_CAMERA) {
            if (!nativeRef.current) throw new Error('กล้องยังไม่พร้อม');
            return nativeRef.current.capture();
          }
          if (!cameraViewRef.current) throw new Error('กล้องยังไม่พร้อม');
          const photo = await cameraViewRef.current.takePictureAsync({ quality: 0.8 });
          if (!photo) throw new Error('ถ่ายภาพไม่สำเร็จ');
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
          onDetections={(event) => onDetections?.(event.nativeEvent)}
          onCameraReady={() => onCameraReady?.()}
          onMountError={(event) => onMountError?.({ message: event.nativeEvent?.message })}
        />
      );
    }

    // `expo-camera` has no analysis stream. `liveDetection` / `onDetections`
    // are dropped here rather than faked, so the caller's "no signal" branch is
    // the same one it uses before the first frame arrives on Android.
    return (
      <CameraView
        ref={cameraViewRef}
        className={className}
        facing="back"
        onCameraReady={() => onCameraReady?.()}
        onMountError={(event) => onMountError?.({ message: event.message })}
      />
    );
  },
);

BpCameraView.displayName = 'BpCameraView';
