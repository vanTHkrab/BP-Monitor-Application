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
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientButton } from '@/components/ui/gradient-button';
import { TextField } from '@/components/ui/text-field';
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
// Through the barrel, not by path: this is a screen, and the barrel rule that
// sends `modules/profile`'s own lib files around it applies to lib files, not
// to screens. `app/profile.tsx` reaches both of these the same way.
import { DateField, formatBirthday } from '@/modules/profile';
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
  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // A `Date`, not the ISO string this screen used to hold. `DateField` takes
  // and returns `Date | null`, and threading both representations through the
  // screen is how the two drift — the conversion happens once, at submit.
  const [dob, setDob] = useState<Date | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [congenitalDisease, setCongenitalDisease] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors<RegisterField>>({});
  const { register, isPending, error, clearError } = useRegister();

  // Split out of `bind` so the date picker — which sets a `Date`, not a
  // string — clears its error the same way every text input does.
  const clearFieldError = (field: RegisterField) => {
    if (fieldErrors[field] !== undefined) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    clearError();
  };

  const bind = (field: RegisterField, setter: (value: string) => void) => (text: string) => {
    setter(text);
    clearFieldError(field);
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
      dob,
      gender,
      weight,
      height,
      congenitalDisease,
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
        dob: dob ?? undefined,
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

      {/*
        * The same control the profile and caregiver forms use. The hand-rolled
        * copy this replaces had no clear button, so an optional field became
        * permanent the moment it was filled; it also seeded the spinner at
        * 1970 and skipped `validateDob` entirely.
        */}
      <DateField
        testID="register-dob"
        value={dob}
        onChange={(value) => {
          setDob(value);
          clearFieldError('dob');
        }}
        displayValue={formatBirthday(dob)}
        placeholder="วันเกิด"
        error={errorFor('dob')}
        maximumDate={new Date()}
      />


      <OptionRow label="เพศ" options={GENDERS} value={gender} onChange={setGender} />

      <View className="flex-row gap-3">
        <View className="flex-1">
          <TextField
            testID="register-weight"
            placeholder="น้ำหนัก (กก.)"
            value={weight}
            onChangeText={bind('weight', setWeight)}
            keyboardType="numeric"
            error={errorFor('weight')}
          />
        </View>
        <View className="flex-1">
          <TextField
            testID="register-height"
            placeholder="ส่วนสูง (ซม.)"
            value={height}
            onChangeText={bind('height', setHeight)}
            keyboardType="numeric"
            error={errorFor('height')}
          />
        </View>
      </View>

      <TextField
        testID="register-congenital-disease"
        placeholder="โรคประจำตัว"
        value={congenitalDisease}
        onChangeText={bind('congenitalDisease', setCongenitalDisease)}
        icon="medkit-outline"
        autoCapitalize="sentences"
        error={errorFor('congenitalDisease')}
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
