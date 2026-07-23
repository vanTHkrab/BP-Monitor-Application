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
} from '@/modules/bp-vision/BPVisionCameraView';
import { CameraView } from 'expo-camera';
import { cssInterop } from 'nativewind';
import * as React from 'react';
import { Platform } from 'react-native';

// NativeWind className → style for both underlying camera surfaces (the camera
// screen positions the preview with `className="absolute inset-0"`).
cssInterop(CameraView, { className: 'style' });
cssInterop(BPVisionCameraView, { className: 'style' });

const IS_ANDROID = Platform.OS === 'android';

export type BpCameraCapture = BpVisionCameraCapture;

export interface BpCameraViewRef {
  /** Take one upright JPEG. Rejects if the camera isn't ready or capture fails. */
  capture(): Promise<BpCameraCapture>;
}

export interface BpCameraViewProps {
  className?: string;
  onCameraReady?: () => void;
  onMountError?: (event: { message?: string }) => void;
}

export const BpCameraView = React.forwardRef<BpCameraViewRef, BpCameraViewProps>(
  ({ className, onCameraReady, onMountError }, ref) => {
    const nativeRef = React.useRef<BpVisionCameraNativeRef>(null);
    const cameraViewRef = React.useRef<CameraView>(null);

    React.useImperativeHandle(
      ref,
      () => ({
        capture: async () => {
          if (IS_ANDROID) {
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

    if (IS_ANDROID) {
      return (
        <BPVisionCameraView
          ref={nativeRef}
          className={className}
          onCameraReady={() => onCameraReady?.()}
          onMountError={(e) => onMountError?.({ message: e.nativeEvent?.message })}
        />
      );
    }

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
