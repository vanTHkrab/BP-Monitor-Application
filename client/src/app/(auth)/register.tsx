/**
 * Create an account.
 *
 * Ported from client-old/app/(auth)/register.tsx with two API-driven changes:
 *   - `email` is now required. It was optional; the resolver rejects a
 *     registration without one.
 *   - The role picker is gone. `role` was removed from `RegisterInput`, and
 *     sending it is a GraphQL validation error — accepting it at sign-up let
 *     a client make itself a developer.
 *
 * The avatar is optional and uploads after the account exists (see
 * `useRegister`) rather than through `RegisterInput.avatar` — the presign
 * mutations need a session. Unlike the old client there is no SQLite retry
 * queue behind it yet, so a failed upload is simply dropped and the user
 * keeps a working account with no photo.
 */
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientButton } from '@/components/ui/gradient-button';
import { TextField } from '@/components/ui/text-field';
import { useTheme } from '@/hooks/use-theme';
import { useRegister } from '@/modules/auth';
import { AuthErrorBanner } from '@/modules/auth/components/auth-error-banner';
import { AuthShell } from '@/modules/auth/components/auth-shell';
import { AuthTabs } from '@/modules/auth/components/auth-tabs';
import { AvatarPicker } from '@/modules/auth/components/avatar-picker';
import { OptionRow } from '@/components/ui/option-row';
import {
  validateRegister,
  type FieldErrors,
  type RegisterField,
} from '@/modules/auth/lib/validation';
import type { Gender } from '@/modules/auth/types';
import { formatIsoDate, parseIsoDate } from '@/utils/date-formatter';
import { formatThaiPhone, stripPhoneDigits } from '@/utils/phone-format';

const GENDERS: readonly { value: Gender; label: string }[] = [
  { value: 'male', label: 'ชาย' },
  { value: 'female', label: 'หญิง' },
  { value: 'other', label: 'อื่นๆ' },
];

/** Optional numeric fields go out as `undefined`, never `NaN` or `0`. */
const optionalNumber = (text: string): number | undefined => {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

export default function RegisterScreen() {
  const colors = useTheme();

  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dob, setDob] = useState('');
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [gender, setGender] = useState<Gender | null>(null);
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [congenitalDisease, setCongenitalDisease] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors<RegisterField>>({});
  const { register, isPending, error, clearError } = useRegister();

  const bind = (field: RegisterField, setter: (value: string) => void) => (text: string) => {
    setter(text);
    if (fieldErrors[field] !== undefined) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    clearError();
  };

  // `onChange` (discriminating on `event.type === 'dismissed'`) is deprecated
  // in favour of these two separate callbacks — `onValueChange` only fires
  // for a real selection, so there is no dismissed case to filter out here.
  const handleDobChange = (_event: unknown, selected: Date) => {
    // Android's picker is a modal the OS dismisses on any action; iOS renders
    // an inline spinner that stays until the user closes it.
    if (Platform.OS !== 'ios') setShowDobPicker(false);
    setDob(formatIsoDate(selected));
  };

  const handleDobDismiss = () => {
    if (Platform.OS !== 'ios') setShowDobPicker(false);
  };

  const handleSubmit = async () => {
    if (isPending) return;

    const errors = validateRegister({
      firstname,
      lastname,
      phone,
      email,
      password,
      confirmPassword,
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      await register({
        firstname: firstname.trim(),
        lastname: lastname.trim(),
        phone: stripPhoneDigits(phone),
        email: email.trim(),
        password,
        dob: parseIsoDate(dob) ?? undefined,
        gender: gender ?? undefined,
        weight: optionalNumber(weight),
        height: optionalNumber(height),
        congenitalDisease: congenitalDisease.trim() || undefined,
        avatarUri,
      });
      router.replace('/(tabs)');
    } catch {
      // Already formatted by `useRegister`; rendered from `error` below.
    }
  };

  // A duplicate phone or email arrives as CONFLICT with the field named, so
  // it belongs under that input rather than in the banner.
  const errorFor = (field: RegisterField) =>
    fieldErrors[field] ?? (error && error.field === field ? error.message : undefined);

  return (
    <AuthShell>
      <AuthTabs active="register" />

      {error && error.field === null ? <AuthErrorBanner message={error.message} /> : null}

      <AvatarPicker uri={avatarUri} onChange={setAvatarUri} />

      <TextField
        testID="register-firstname"
        placeholder="ชื่อ"
        value={firstname}
        onChangeText={bind('firstname', setFirstname)}
        icon="person-outline"
        autoCapitalize="words"
        autoComplete="name"
        error={errorFor('firstname')}
      />

      <TextField
        testID="register-lastname"
        placeholder="นามสกุล"
        value={lastname}
        onChangeText={bind('lastname', setLastname)}
        icon="person-outline"
        autoCapitalize="words"
        error={errorFor('lastname')}
      />

      <TextField
        testID="register-phone"
        placeholder="เบอร์โทรศัพท์"
        value={phone}
        onChangeText={(text) => bind('phone', setPhone)(formatThaiPhone(text))}
        icon="call-outline"
        keyboardType="phone-pad"
        autoComplete="tel"
        error={errorFor('phone')}
      />

      <TextField
        testID="register-email"
        placeholder="อีเมล"
        value={email}
        onChangeText={bind('email', setEmail)}
        icon="mail-outline"
        keyboardType="email-address"
        autoComplete="email"
        error={errorFor('email')}
      />

      <ThemedText type="label" themeColor="text-secondary" className="mb-3 ml-1">
        ข้อมูลสุขภาพ (ไม่บังคับ)
      </ThemedText>

      <Pressable
        onPress={() => setShowDobPicker(true)}
        accessibilityRole="button"
        accessibilityLabel="เลือกวันเกิด"
        className="mb-4 flex-row items-center rounded-[14px] border-2 px-[14px] py-4"
        style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
        <Ionicons name="calendar-outline" size={20} color={colors['text-secondary']} />
        <ThemedText type="body" weight="semibold" className="ml-3 flex-1" style={{ color: dob ? colors['text-primary'] : colors['text-secondary'] }}>
          {dob || 'วันเกิด'}
        </ThemedText>
      </Pressable>

      {showDobPicker ? (
        <DateTimePicker
          value={parseIsoDate(dob) ?? new Date(1970, 0, 1)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          onValueChange={handleDobChange}
          onDismiss={handleDobDismiss}
        />
      ) : null}

      <OptionRow label="เพศ" options={GENDERS} value={gender} onChange={setGender} />

      <View className="flex-row gap-3">
        <View className="flex-1">
          <TextField
            testID="register-weight"
            placeholder="น้ำหนัก (กก.)"
            value={weight}
            onChangeText={setWeight}
            keyboardType="numeric"
          />
        </View>
        <View className="flex-1">
          <TextField
            testID="register-height"
            placeholder="ส่วนสูง (ซม.)"
            value={height}
            onChangeText={setHeight}
            keyboardType="numeric"
          />
        </View>
      </View>

      <TextField
        testID="register-congenital-disease"
        placeholder="โรคประจำตัว"
        value={congenitalDisease}
        onChangeText={setCongenitalDisease}
        icon="medkit-outline"
        autoCapitalize="sentences"
      />

      <ThemedText type="label" themeColor="text-secondary" className="mb-3 ml-1">
        ตั้งรหัสผ่าน
      </ThemedText>

      <TextField
        testID="register-password"
        placeholder="รหัสผ่าน"
        value={password}
        onChangeText={bind('password', setPassword)}
        icon="lock-closed-outline"
        secureTextEntry
        autoComplete="new-password"
        error={errorFor('password')}
      />

      <TextField
        testID="register-confirm-password"
        placeholder="ยืนยันรหัสผ่าน"
        value={confirmPassword}
        onChangeText={bind('confirmPassword', setConfirmPassword)}
        icon="lock-closed-outline"
        secureTextEntry
        autoComplete="new-password"
        error={errorFor('confirmPassword')}
      />

      <View className="mt-2">
        <GradientButton
          testID="register-submit"
          title="ลงทะเบียน"
          onPress={handleSubmit}
          loading={isPending}
          size="large"
        />
      </View>
    </AuthShell>
  );
}
