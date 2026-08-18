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
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Controller, useForm, type FieldErrors } from 'react-hook-form';
import { ScrollView, View } from 'react-native';

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

// Space kept above a field once it is scrolled into view, so its own border
// does not sit flush against the top of the visible area.
const SCROLL_TOP_PADDING = 16;

/**
 * Brings a focused field back above the keyboard on a form long enough that
 * the last few inputs sit under it with nothing to reveal them. Deliberately
 * dependency-free: each text field reports its own native node via a `ref`,
 * and `measureLayout` asks the platform for that node's position relative to
 * the `ScrollView`'s own content — the same primitive React Native's own
 * `scrollResponderScrollNativeHandleToKeyboard` uses internally for this
 * exact problem.
 *
 * This is deliberately **not** built by summing `onLayout` positions up
 * through each field's ancestors — an earlier version did that, and it
 * silently scrolled the wrong direction for two of the nine fields. It
 * assumed every field was a **direct child of the card** `AuthShell`
 * renders, true for 7 of 9 but false for `weight` and `height`, which sit
 * inside an extra `flex-row` > `flex-1` wrapper for the two-column layout.
 * `onLayout`'s `y` is only ever relative to the *immediate* parent, so the
 * sum measured the field's offset within that wrapper — basically just the
 * height of the unit label above it — not its offset from the card, and
 * `scrollTo`-ing to that number moved the view *away* from the field.
 * `measureLayout` makes no such assumption: it walks the entire native
 * layout tree between the field and whatever ancestor node it is given, no
 * matter how many wrappers sit in between, so this cannot regress the same
 * way the next time a field's container changes shape.
 *
 * The ancestor passed to `measureLayout` is the `ScrollView`'s **inner
 * content node** (`getInnerViewNode()`), not the scrollable viewport
 * (`getNativeScrollRef()`). The content's own coordinate space does not
 * move as the user scrolls — only the viewport's window onto it does — so
 * the `y` this yields is already the absolute value `scrollTo` expects.
 * Measuring against the viewport instead would give the field's position
 * relative to whatever is *currently visible*, which changes on every
 * scroll and would need the live content offset added back in to mean
 * anything.
 */
function useScrollFieldIntoView() {
  const scrollRef = useRef<ScrollView>(null);
  const fieldRefs = useRef(new Map<RegisterField, View | null>());

  const registerFieldRef = useCallback(
    (field: RegisterField) => (node: View | null) => {
      fieldRefs.current.set(field, node);
    },
    [],
  );

  const scrollFieldIntoView = useCallback((field: RegisterField) => {
    const fieldNode = fieldRefs.current.get(field);
    const scrollNode = scrollRef.current;
    if (!fieldNode || !scrollNode) return;

    fieldNode.measureLayout(
      scrollNode.getInnerViewNode(),
      (_x, y) => {
        scrollNode.scrollTo({ y: Math.max(y - SCROLL_TOP_PADDING, 0), animated: true });
      },
      () => {
        // No handler needed: failing to measure just means the field does
        // not get scrolled into view, not that anything else breaks.
      },
    );
  }, []);

  return { scrollRef, registerFieldRef, scrollFieldIntoView };
}

export default function RegisterScreen() {
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const { register, isPending, error, clearError } = useRegister();
  const { scrollRef, registerFieldRef, scrollFieldIntoView } = useScrollFieldIntoView();

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
    <AuthShell scrollRef={scrollRef}>
      <AuthTabs active="register" />

      {error && error.field === null ? <AuthErrorBanner message={error.message} /> : null}

      <AvatarPicker uri={avatarUri} onChange={setAvatarUri} />

      <Controller
        control={control}
        name="firstname"
        render={({ field }) => (
          <View ref={registerFieldRef('firstname')}>
            <TextField
              testID="register-firstname"
              placeholder="ชื่อ"
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                clearError();
              }}
              onBlur={field.onBlur}
              onFocus={() => scrollFieldIntoView('firstname')}
              icon="person-outline"
              autoCapitalize="words"
              autoComplete="name"
              error={fieldError('firstname', errors, touchedFields, serverErrorFor('firstname'), isSubmitted)}
            />
          </View>
        )}
      />

      <Controller
        control={control}
        name="lastname"
        render={({ field }) => (
          <View ref={registerFieldRef('lastname')}>
            <TextField
              testID="register-lastname"
              placeholder="นามสกุล"
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                clearError();
              }}
              onBlur={field.onBlur}
              onFocus={() => scrollFieldIntoView('lastname')}
              icon="person-outline"
              autoCapitalize="words"
              error={fieldError('lastname', errors, touchedFields, serverErrorFor('lastname'), isSubmitted)}
            />
          </View>
        )}
      />

      <Controller
        control={control}
        name="phone"
        render={({ field }) => (
          <View ref={registerFieldRef('phone')}>
            <TextField
              testID="register-phone"
              placeholder="เบอร์โทรศัพท์"
              value={field.value}
              onChangeText={(text) => {
                field.onChange(formatThaiPhone(text));
                clearError();
              }}
              onBlur={field.onBlur}
              onFocus={() => scrollFieldIntoView('phone')}
              icon="call-outline"
              keyboardType="phone-pad"
              autoComplete="tel"
              error={fieldError('phone', errors, touchedFields, serverErrorFor('phone'), isSubmitted)}
            />
          </View>
        )}
      />

      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <View ref={registerFieldRef('email')}>
            <TextField
              testID="register-email"
              placeholder="อีเมล"
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                clearError();
              }}
              onBlur={field.onBlur}
              onFocus={() => scrollFieldIntoView('email')}
              icon="mail-outline"
              keyboardType="email-address"
              autoComplete="email"
              error={fieldError('email', errors, touchedFields, serverErrorFor('email'), isSubmitted)}
            />
          </View>
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
              <View ref={registerFieldRef('weight')}>
                <TextField
                  testID="register-weight"
                  placeholder="น้ำหนัก"
                  value={field.value}
                  onChangeText={(text) => {
                    field.onChange(text);
                    clearError();
                  }}
                  onBlur={field.onBlur}
                  onFocus={() => scrollFieldIntoView('weight')}
                  keyboardType="numeric"
                  error={fieldError('weight', errors, touchedFields, serverErrorFor('weight'), isSubmitted)}
                />
              </View>
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
              <View ref={registerFieldRef('height')}>
                <TextField
                  testID="register-height"
                  placeholder="ส่วนสูง"
                  value={field.value}
                  onChangeText={(text) => {
                    field.onChange(text);
                    clearError();
                  }}
                  onBlur={field.onBlur}
                  onFocus={() => scrollFieldIntoView('height')}
                  keyboardType="numeric"
                  error={fieldError('height', errors, touchedFields, serverErrorFor('height'), isSubmitted)}
                />
              </View>
            )}
          />
        </View>
      </View>

      <Controller
        control={control}
        name="congenitalDisease"
        render={({ field }) => (
          <View ref={registerFieldRef('congenitalDisease')}>
            <TextField
              testID="register-congenital-disease"
              placeholder="โรคประจำตัว"
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                clearError();
              }}
              onBlur={field.onBlur}
              onFocus={() => scrollFieldIntoView('congenitalDisease')}
              icon="medkit-outline"
              autoCapitalize="sentences"
              error={fieldError('congenitalDisease', errors, touchedFields, serverErrorFor('congenitalDisease'), isSubmitted)}
            />
          </View>
        )}
      />

      <ThemedText type="label" themeColor="text-secondary" className="mb-3 ml-1">
        ตั้งรหัสผ่าน
      </ThemedText>

      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <View ref={registerFieldRef('password')}>
            <TextField
              testID="register-password"
              placeholder="รหัสผ่าน"
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                clearError();
              }}
              onBlur={field.onBlur}
              onFocus={() => scrollFieldIntoView('password')}
              icon="lock-closed-outline"
              secureTextEntry
              autoComplete="new-password"
              error={fieldError('password', errors, touchedFields, serverErrorFor('password'), isSubmitted)}
            />
          </View>
        )}
      />

      <Controller
        control={control}
        name="confirmPassword"
        render={({ field }) => (
          <View ref={registerFieldRef('confirmPassword')}>
            <TextField
              testID="register-confirm-password"
              placeholder="ยืนยันรหัสผ่าน"
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                clearError();
              }}
              onBlur={field.onBlur}
              onFocus={() => scrollFieldIntoView('confirmPassword')}
              icon="lock-closed-outline"
              secureTextEntry
              autoComplete="new-password"
              error={fieldError('confirmPassword', errors, touchedFields, serverErrorFor('confirmPassword'), isSubmitted)}
            />
          </View>
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
