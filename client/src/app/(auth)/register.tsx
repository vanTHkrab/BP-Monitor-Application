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
 *
 * Form handling is React Hook Form + Zod (`registerSchema` in
 * `modules/auth/lib/validation.ts`), validating `onBlur` and re-validating
 * `onChange` once a field has an error — mistakes surface as the user fills
 * the form rather than all at once at submit. Every field but the avatar is
 * required; see the schema's docblock for why the health block being
 * required here is a client-only policy and not a wire-contract change.
 *
 * `TextField`, `DateField`, and `OptionRow` are all controlled components
 * taking `value`/`onChange` rather than native inputs, so each one is wired
 * through `Controller` rather than RHF's `register()`.
 *
 * **Nothing here scrolls a focused field above the keyboard any more, and
 * that is the fix rather than a regression.** `AuthShell` now renders a
 * `KeyboardAwareScrollView` from `react-native-keyboard-controller`, which
 * does it natively from the IME insets. What that replaced was a
 * `useScrollFieldIntoView` hook in this file: a `ref` on a wrapper `View`
 * around all nine text fields, a `measureLayout` against the `ScrollView`'s
 * inner content node, and an `onFocus` on every field to drive it. It never
 * ran once on this app. Under Fabric — the only renderer on RN 0.86 —
 * `measureLayout` guards its ancestor argument with `relativeToNativeNode
 * instanceof ReactNativeElement` and returns early when it fails, without
 * calling `onFail`; the handle the hook passed it, `getInnerViewNode()`, is
 * typed `?number` and returns a legacy numeric node that can never satisfy
 * that check. The only evidence was a dev-mode `console.error`. Its
 * predecessor, a sum of `onLayout` offsets, was a separate bug that at least
 * scrolled — in the wrong direction, for the two fields nested one wrapper
 * deeper than the rest. Two hand-rolled attempts, two silent failures: if a
 * future change needs finer control than `bottomOffset` gives, reach for the
 * library's own API before writing a third.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Controller, useForm, type FieldErrors } from 'react-hook-form';
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
  registerSchema,
  type RegisterField,
  type RegisterFormValues,
} from '@/modules/auth/lib/validation';
// Through the barrel, not by path: this is a screen, and the barrel rule that
// sends `modules/profile`'s own lib files around it applies to lib files, not
// to screens. `app/profile.tsx` reaches both of these the same way.
import { DateField, formatBirthday } from '@/modules/profile';
import { formatThaiPhone, stripPhoneDigits } from '@/utils/phone-format';

const GENDERS = [
  { value: 'male', label: 'ชาย' },
  { value: 'female', label: 'หญิง' },
  { value: 'other', label: 'อื่นๆ' },
] as const;

const DEFAULT_VALUES: RegisterFormValues = {
  firstname: '',
  lastname: '',
  phone: '',
  email: '',
  password: '',
  confirmPassword: '',
  dob: null,
  gender: null,
  weight: '',
  height: '',
  congenitalDisease: '',
};

/**
 * A field's client-side error is withheld until the user has actually
 * reached it — by blurring it (`isTouched`) or by attempting to submit.
 * Without this gate, blurring the *first* field on a form this long would
 * reveal "required" messages under nine fields nobody has typed into yet,
 * because the resolver validates the whole schema on every trigger, not just
 * the field that changed.
 *
 * `dob` and `gender` never set `isTouched` on their own — a `Pressable`-backed
 * field has no blur event to fire it from, and deliberately does not fake one
 * by calling `field.onBlur()` from `onChange`: that forces an extra,
 * `mode: 'onBlur'`-triggered validation pass beyond the one the change itself
 * may already schedule under `reValidateMode: 'onChange'`. The practical
 * effect is that neither field shows a "required" message until a submit is
 * attempted, which given only three fixed options for gender and a bounded
 * native picker for dob, is the only time either can realistically be wrong
 * anyway.
 *
 * Reads `errors` / `touchedFields` from the **top-level** `formState` this
 * screen destructures once, deliberately not from each `Controller`'s own
 * `fieldState`. `Controller` subscribes to per-field state independently of
 * its parent, so its own `fieldState` can commit on a different tick than
 * the top-level `formState` does — observed directly while building this
 * screen: `isSubmitted` had already flipped to `true` with the right message
 * sitting in the top-level `errors`, while the very `Controller` for the
 * field that message belonged to was still rendering `fieldState.error as
 * undefined`, and never caught up. Reading everything from the one
 * subscription this screen already holds removes the second one that could
 * disagree with it.
 *
 * A server-side error (CONFLICT on phone/email) always wins and is never
 * gated — it only ever exists after a submit attempt.
 */
function fieldError(
  field: keyof RegisterFormValues,
  errors: FieldErrors<RegisterFormValues>,
  touchedFields: Partial<Readonly<Record<keyof RegisterFormValues, boolean>>>,
  serverError: string | undefined,
  isSubmitted: boolean,
): string | undefined {
  if (serverError) return serverError;
  if (!touchedFields[field] && !isSubmitted) return undefined;
  return errors[field]?.message;
}

export default function RegisterScreen() {
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const { register, isPending, error, clearError } = useRegister();

  // Built once per mount rather than as a module-level constant: it closes
  // over `now`, and a fresh `Date()` per screen visit is what `validateDob`
  // is meant to compare against, not a value frozen at module load.
  const schema = useMemo(() => registerSchema(), []);

  const {
    control,
    handleSubmit,
    formState: { isSubmitted, errors, touchedFields },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: DEFAULT_VALUES,
  });

  // A duplicate phone or email arrives as CONFLICT with the field named, so
  // it belongs under that input rather than in the banner.
  const serverErrorFor = (field: RegisterField) =>
    error && error.field === field ? error.message : undefined;

  const onValid = async (values: RegisterFormValues) => {
    if (isPending) return;

    try {
      await register({
        firstname: values.firstname.trim(),
        lastname: values.lastname.trim(),
        phone: stripPhoneDigits(values.phone),
        email: values.email.trim(),
        password: values.password,
        dob: values.dob ?? undefined,
        gender: values.gender ?? undefined,
        // Safe to convert directly: the schema already refused submission
        // unless both parsed as plausible numbers in range.
        weight: Number(values.weight),
        height: Number(values.height),
        congenitalDisease: values.congenitalDisease.trim(),
        avatarUri,
      });
      // Not `/(tabs)`: a fresh registration has no `roleSelectedAt`, and
      // `resolveGate()` only runs at the `/` entry route — replacing straight
      // into the tab navigator skips it, landing a new user in the app
      // having never chosen patient or caregiver. `onboarding-phone.tsx`
      // already does this correctly for its own post-auth flow.
      router.replace('/onboarding/role');
    } catch {
      // Already formatted by `useRegister`; rendered from `error` below.
    }
  };

  return (
    <AuthShell showHero={false}>
      <AuthTabs active="register" />

      {error && error.field === null ? <AuthErrorBanner message={error.message} /> : null}

      <AvatarPicker uri={avatarUri} onChange={setAvatarUri} />

      <Controller
        control={control}
        name="firstname"
        render={({ field }) => (
          <TextField
            testID="register-firstname"
            placeholder="ชื่อ"
            value={field.value}
            onChangeText={(text) => {
              field.onChange(text);
              clearError();
            }}
            onBlur={field.onBlur}
            icon="person-outline"
            autoCapitalize="words"
            autoComplete="name"
            error={fieldError('firstname', errors, touchedFields, serverErrorFor('firstname'), isSubmitted)}
          />
        )}
      />

      <Controller
        control={control}
        name="lastname"
        render={({ field }) => (
          <TextField
            testID="register-lastname"
            placeholder="นามสกุล"
            value={field.value}
            onChangeText={(text) => {
              field.onChange(text);
              clearError();
            }}
            onBlur={field.onBlur}
            icon="person-outline"
            autoCapitalize="words"
            error={fieldError('lastname', errors, touchedFields, serverErrorFor('lastname'), isSubmitted)}
          />
        )}
      />

      <Controller
        control={control}
        name="phone"
        render={({ field }) => (
          <TextField
            testID="register-phone"
            placeholder="เบอร์โทรศัพท์"
            value={field.value}
            onChangeText={(text) => {
              field.onChange(formatThaiPhone(text));
              clearError();
            }}
            onBlur={field.onBlur}
            icon="call-outline"
            keyboardType="phone-pad"
            autoComplete="tel"
            error={fieldError('phone', errors, touchedFields, serverErrorFor('phone'), isSubmitted)}
          />
        )}
      />

      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextField
            testID="register-email"
            placeholder="อีเมล"
            value={field.value}
            onChangeText={(text) => {
              field.onChange(text);
              clearError();
            }}
            onBlur={field.onBlur}
            icon="mail-outline"
            keyboardType="email-address"
            autoComplete="email"
            error={fieldError('email', errors, touchedFields, serverErrorFor('email'), isSubmitted)}
          />
        )}
      />

      <ThemedText type="label" themeColor="text-secondary" className="mb-3 ml-1">
        ข้อมูลสุขภาพ
      </ThemedText>

      {/*
        * The same control the profile and caregiver forms use. The hand-rolled
        * copy this replaces had no clear button, so an optional field became
        * permanent the moment it was filled; it also seeded the spinner at
        * 1970 and skipped `validateDob` entirely.
        */}
      <Controller
        control={control}
        name="dob"
        render={({ field }) => (
          <DateField
            testID="register-dob"
            value={field.value}
            onChange={(value) => {
              field.onChange(value);
              clearError();
            }}
            displayValue={formatBirthday(field.value)}
            placeholder="วันเกิด"
            error={fieldError('dob', errors, touchedFields, serverErrorFor('dob'), isSubmitted)}
            maximumDate={new Date()}
          />
        )}
      />

      <Controller
        control={control}
        name="gender"
        render={({ field }) => (
          <OptionRow
            label="เพศ"
            options={GENDERS}
            value={field.value}
            onChange={(value) => {
              field.onChange(value);
              clearError();
            }}
            error={fieldError('gender', errors, touchedFields, serverErrorFor('gender'), isSubmitted)}
          />
        )}
      />

      <View className="flex-row gap-3">
        <View className="flex-1">
          <ThemedText type="label" themeColor="text-secondary" className="mb-2 ml-1">
            น้ำหนัก (กก.)
          </ThemedText>
          <Controller
            control={control}
            name="weight"
            render={({ field }) => (
              <TextField
                testID="register-weight"
                placeholder="น้ำหนัก"
                value={field.value}
                onChangeText={(text) => {
                  field.onChange(text);
                  clearError();
                }}
                onBlur={field.onBlur}
                keyboardType="numeric"
                error={fieldError('weight', errors, touchedFields, serverErrorFor('weight'), isSubmitted)}
              />
            )}
          />
        </View>
        <View className="flex-1">
          <ThemedText type="label" themeColor="text-secondary" className="mb-2 ml-1">
            ส่วนสูง (ซม.)
          </ThemedText>
          <Controller
            control={control}
            name="height"
            render={({ field }) => (
              <TextField
                testID="register-height"
                placeholder="ส่วนสูง"
                value={field.value}
                onChangeText={(text) => {
                  field.onChange(text);
                  clearError();
                }}
                onBlur={field.onBlur}
                keyboardType="numeric"
                error={fieldError('height', errors, touchedFields, serverErrorFor('height'), isSubmitted)}
              />
            )}
          />
        </View>
      </View>

      <Controller
        control={control}
        name="congenitalDisease"
        render={({ field }) => (
          <TextField
            testID="register-congenital-disease"
            placeholder="โรคประจำตัว"
            value={field.value}
            onChangeText={(text) => {
              field.onChange(text);
              clearError();
            }}
            onBlur={field.onBlur}
            icon="medkit-outline"
            autoCapitalize="sentences"
            error={fieldError('congenitalDisease', errors, touchedFields, serverErrorFor('congenitalDisease'), isSubmitted)}
          />
        )}
      />

      <ThemedText type="label" themeColor="text-secondary" className="mb-3 ml-1">
        ตั้งรหัสผ่าน
      </ThemedText>

      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextField
            testID="register-password"
            placeholder="รหัสผ่าน"
            value={field.value}
            onChangeText={(text) => {
              field.onChange(text);
              clearError();
            }}
            onBlur={field.onBlur}
            icon="lock-closed-outline"
            secureTextEntry
            autoComplete="new-password"
            error={fieldError('password', errors, touchedFields, serverErrorFor('password'), isSubmitted)}
          />
        )}
      />

      <Controller
        control={control}
        name="confirmPassword"
        render={({ field }) => (
          <TextField
            testID="register-confirm-password"
            placeholder="ยืนยันรหัสผ่าน"
            value={field.value}
            onChangeText={(text) => {
              field.onChange(text);
              clearError();
            }}
            onBlur={field.onBlur}
            icon="lock-closed-outline"
            secureTextEntry
            autoComplete="new-password"
            error={fieldError('confirmPassword', errors, touchedFields, serverErrorFor('confirmPassword'), isSubmitted)}
          />
        )}
      />

      <View className="mt-2">
        <GradientButton
          testID="register-submit"
          title="ลงทะเบียน"
          onPress={() => {
            void handleSubmit(onValid)();
          }}
          loading={isPending}
          size="large"
        />
      </View>
    </AuthShell>
  );
}
