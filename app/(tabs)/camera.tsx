import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
    StatusBar,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/colors';

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Keep a square preview; make it responsive for portrait/landscape
  const maxSquare = isLandscape
    ? Math.min(height - (insets.top + 120), width - 200)
    : width - 80;
  const previewSize = Math.max(220, Math.floor(maxSquare));
  const frameSize = previewSize + 20;

  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const handleBack = () => {
    if (capturedImage) {
      setCapturedImage(null);
    } else {
      router.back();
    }
  };

  const handleFlash = () => {
    setIsFlashOn(!isFlashOn);
  };

  const handleSettings = () => {
    // TODO: Open camera settings
    console.log('Settings pressed');
  };

  const handleCapture = async () => {
    try {
      if (!cameraPermission?.granted) {
        await requestCameraPermission();
        return;
      }

      if (!cameraRef.current) return;

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: true,
      });

      if (photo?.uri) {
        setCapturedImage(photo.uri);
      }
    } catch (error) {
      console.log('Capture error:', error);
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
  };

  const handleUsePhoto = () => {
    // TODO: ต่อไปค่อยส่งรูปไปขั้นตอน detect/OCR
    // ตอนนี้ให้ยืนยันรูปแล้วกลับหน้าเดิม
    router.back();
  };

  const handleGallery = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        setCapturedImage(result.assets[0].uri);
      }
    } catch (error) {
      console.log('Gallery error:', error);
    }
  };

  const renderCameraArea = () => {
    if (!cameraPermission) {
      return (
        <View
          className="bg-gray-800 items-center justify-center rounded-2xl px-4"
          style={{ width: previewSize, height: previewSize }}
        >
          <Ionicons name="camera" size={48} color={AppColors.gray400} />
          <Text className="text-gray-400 text-sm mt-3">กำลังเตรียมกล้อง...</Text>
        </View>
      );
    }

    if (!cameraPermission.granted) {
      return (
        <View
          className="bg-gray-800 items-center justify-center rounded-2xl px-4"
          style={{ width: previewSize, height: previewSize }}
        >
          <Ionicons name="camera" size={48} color={AppColors.gray400} />
          <Text className="text-gray-400 text-sm mt-3">กรุณาอนุญาตการใช้งานกล้อง</Text>
          <TouchableOpacity
            onPress={requestCameraPermission}
            className="mt-3.5 bg-primary px-[18px] py-2.5 rounded-[20px]"
            activeOpacity={0.8}
          >
            <Text className="text-white text-[13px] font-semibold">อนุญาตกล้อง</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (capturedImage) {
      return (
        <Image
          source={{ uri: capturedImage }}
          className="rounded-2xl overflow-hidden"
          style={{ width: previewSize, height: previewSize }}
          contentFit="cover"
        />
      );
    }

    return (
      <CameraView
        ref={cameraRef}
        className="rounded-2xl overflow-hidden"
        style={{ width: previewSize, height: previewSize }}
        facing="back"
        enableTorch={isFlashOn}
      />
    );
  };

  const renderControls = () => {
    const controlsContainerClassName = isLandscape
      ? 'absolute top-0 right-0 bottom-0 w-[110px] justify-between items-center bg-black/60 py-5'
      : 'absolute bottom-0 left-0 right-0 flex-row justify-around items-center py-5 bg-black/60';

    const controlsContainerStyle = isLandscape
      ? { paddingTop: insets.top + 90, paddingBottom: insets.bottom + 90 }
      : { paddingBottom: insets.bottom + 80 };

    if (capturedImage) {
      return (
        <View className={controlsContainerClassName} style={controlsContainerStyle}>
          <TouchableOpacity
            className="flex-row items-center justify-center gap-2 rounded-[26px] py-3 px-4 min-w-[110px] bg-gray-700"
            onPress={handleRetake}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={22} color={AppColors.white} />
            <Text className="text-white text-[13px] font-semibold">ถ่ายใหม่</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-row items-center justify-center gap-2 rounded-[26px] py-3 px-4 min-w-[110px] bg-primary"
            onPress={handleUsePhoto}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark" size={22} color={AppColors.white} />
            <Text className="text-white text-[13px] font-semibold">ใช้รูปนี้</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View className={controlsContainerClassName} style={controlsContainerStyle}>
        <TouchableOpacity className="w-[50px] h-[50px] rounded-full bg-white/20 items-center justify-center" onPress={handleGallery}>
          <Ionicons name="images-outline" size={28} color={AppColors.white} />
        </TouchableOpacity>

        <TouchableOpacity
          className="w-[72px] h-[72px] rounded-full bg-white items-center justify-center border-4 border-gray-300"
          onPress={handleCapture}
        >
          <View className="w-[56px] h-[56px] rounded-full bg-white border-2 border-gray-400" />
        </TouchableOpacity>

        <View className="w-[50px] h-[50px]" />
      </View>
    );
  };

  return (
    <View className="flex-1 bg-black">
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Camera Preview Area */}
      <View className="flex-1">
        {/* Header */}
        <View
          className="absolute top-0 left-0 right-0 z-10 flex-row justify-between items-center px-4 bg-white/95 pb-3"
          style={{ paddingTop: insets.top + 10 }}
        >
          <TouchableOpacity onPress={handleBack} className="p-1">
            <Ionicons name="chevron-back" size={28} color={AppColors.primary} />
          </TouchableOpacity>
          <Text className="text-lg font-bold text-primary">ถ่ายรูปเครื่องวัดความดัน</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity onPress={handleFlash} className="p-1">
              <Ionicons
                name={isFlashOn ? 'flash' : 'flash-off'}
                size={22}
                color={AppColors.gray700}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSettings} className="p-1">
              <Ionicons name="wifi" size={22} color={AppColors.gray700} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Instruction Text */}
        <Text
          style={[
            { top: insets.top + 90, paddingHorizontal: isLandscape ? 120 : 16 },
          ]}
          className="absolute left-0 right-0 text-center text-sm text-primary z-10 font-medium"
        >
          วางหน้าจอเครื่องวัดให้ตรงกรอบ
        </Text>

        {/* Camera View with Frame */}
        <View className="flex-1 items-center justify-center">
          {renderCameraArea()}

          {/* Detection Frame */}
          {!capturedImage && (
            <View
              className="absolute border-2 border-emerald-500 rounded-2xl"
              style={{ width: frameSize, height: frameSize }}
            >
              <View
                className="absolute w-[30px] h-[30px] border-emerald-500"
                style={{ top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 }}
              />
              <View
                className="absolute w-[30px] h-[30px] border-emerald-500"
                style={{ top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 }}
              />
              <View
                className="absolute w-[30px] h-[30px] border-emerald-500"
                style={{ bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 }}
              />
              <View
                className="absolute w-[30px] h-[30px] border-emerald-500"
                style={{ bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 16 }}
              />
            </View>
          )}
        </View>
      </View>

      {renderControls()}
    </View>
  );
}
