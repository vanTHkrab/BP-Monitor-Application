/**
 * Profile — view and edit the account's own details.
 * Ported from `client-old/app/profile.tsx` (884 lines, six concerns).
 *
 * **Read mode renders from `user`; the form only exists while editing.**
 * That is the structural decision behind this file. The old screen seeded
 * eight `useState`s from `user` at mount and never re-seeded, so a profile
 * changed on another device rendered stale until the screen was destroyed —
 * and re-seeding it with an effect would set state during render, which is
 * the cascading-render defect `pnpm check` now fails on. Tapping "แก้ไข" is
 * an event, so it can seed the form honestly, and cancel throws it away.
 *
 * **Only changed fields are sent.** `updateProfile` is a partial update where
 * a present-but-empty value *clears* the column, so posting the whole form
 * would rewrite every column with whatever this screen was holding — silently
 * reverting anything changed elsewhere. `changedFields` does the diff;
 * `lib/form-state.ts` explains the `null` vs `undefined` trap in it.
 *
 * Three parts of the original are deliberately absent:
 *
 *   1. **The sensitive-data lock** (`hideSensitiveData` + password/biometric
 *      unlock + a 30 s re-lock). `modules/security` already owns app lock —
 *      a second, screen-local lock is one more thing to keep in sync for the
 *      same question, and a user who enabled app lock would meet two prompts.
 *   2. **The stats block** (reading count, average BP, join date). Nothing in
 *      this tree reads the SQLite `readings` table yet; it ships with the
 *      history tab, which will own that repository.
 *   3. **The linked-patients list.** `/invitations` is that screen now. A
 *      second copy here is a second thing to update when a link changes.
 *
 * **Email is shown, not edited.** `updateProfile(email:)` writes the column
 * without touching `emailVerified` (`auth.service.ts`), and `emailVerified`
 * is what gates linking a Google account — so an edit here would let a
 * verified user move their address to one they have never proven they own and
 * keep the badge. Changing it needs a gateway change that resets the flag;
 * until then the row links to the verification flow instead.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Alert, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { GradientButton } from '@/components/ui/gradient-button';
import { OptionRow } from '@/components/ui/option-row';
import { TextField } from '@/components/ui/text-field';
import { useTypography } from '@/hooks/use-typography';
import { useTheme } from '@/hooks/use-theme';
import {
  formatAuthError,
  useSession,
  useUpdateProfile,
  type User,
} from '@/modules/auth';
import {
  DateField,
  GENDER_OPTIONS,
  ProfileField,
  ProfileGroup,
  ProfileHero,
  ProfileLinkRow,
  changedFields,
  formatBirthday,
  formFromUser,
  genderLabel,
  hasChanges,
  profileSchema,
  useProfileAvatar,
  type ProfileForm,
} from '@/modules/profile';
import { SecurityHeader } from '@/modules/security';
import { status as statusColor } from '@/theme';
import { formatThaiPhone, stripPhoneDigits } from '@/utils/phone-format';

/**
 * Space left between a focused field and the top of the keyboard.
 *
 * Declared here rather than shared with `auth-shell.tsx`'s constant of the
 * same name: they are two different forms whose spacing has no reason to move
 * together, and one exported number would make the next tweak to either screen
 * a change to both.
 */
const KEYBOARD_BOTTOM_OFFSET = 16;

export default function ProfileScreen() {
  const colors = useTheme();
  const typography = useTypography();

  const { user } = useSession();
  const { updateProfile, isPending } = useUpdateProfile();
  const avatar = useProfileAvatar();

  /**
   * Read mode is its own flag now, and that is a real cost of this screen's
   * move to React Hook Form, worth naming rather than discovering.
   *
   * The old form used `form === null` *as* the mode, on the stated ground that
   * one source of truth beats a boolean that can disagree with the form it
   * guards. RHF removes that option — `useForm` cannot be created
   * conditionally, so the values always exist. The compensating rule is that
   * nothing outside `startEditing` / `cancelEditing` writes either half: each
   * sets the flag and seeds or discards the values in the same breath, so the
   * two cannot drift the way independently-updated state would.
   */
  const [isEditing, setIsEditing] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // Per mount, not module load: `validateDob` inside the schema compares
  // against `now`, and a module-level schema would freeze "today" at the
  // moment the bundle was evaluated.
  const schema = useMemo(() => profileSchema(), []);

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ProfileForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: formFromUser(null),
  });

  const startEditing = () => {
    setBanner(null);
    // `reset` seeds the values and clears every error in one call, which is
    // what carries the old screen's "tapping แก้ไข is an event, so it can seed
    // honestly" property across — no effect writes state during render.
    reset(formFromUser(user));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    reset(formFromUser(user));
  };

  /**
   * Still diffs before sending, and that has not become optional.
   * `updateProfile` is a partial update where a present-but-empty value clears
   * the column, so posting `values` wholesale would rewrite every column with
   * whatever this screen was holding — silently reverting anything another
   * device changed. RHF changes who owns the values, not what the gateway does
   * with them.
   */
  const onValid = async (values: ProfileForm) => {
    const changes = changedFields(values, user);
    if (!hasChanges(changes)) {
      // Not an error, and not a save either. Saying "บันทึกแล้ว" for a request
      // that never went out teaches people to distrust the message.
      setIsEditing(false);
      setBanner({ tone: 'ok', text: 'ไม่มีข้อมูลที่เปลี่ยนแปลง' });
      return;
    }

    try {
      await updateProfile(changes);
      setIsEditing(false);
      setBanner({ tone: 'ok', text: 'บันทึกข้อมูลเรียบร้อยแล้ว' });
    } catch (error) {
      const { message, field } = formatAuthError(error, {
        fallback: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
      });
      // The gateway's one field-specific rejection here is a duplicate phone.
      if (field === 'phone') setError('phone', { message });
      setBanner({ tone: 'error', text: message });
    }
  };

  const save = () => {
    setBanner(null);
    void handleSubmit(onValid, () => {
      setBanner({ tone: 'error', text: 'กรุณาตรวจสอบข้อมูลที่มีเครื่องหมายสีแดง' });
    })();
  };

  /*
   * `useWatch`, not the `watch()` returned by `useForm`. React Compiler is on
   * in this tree and `react-hooks/incompatible-library` rejects `watch()` by
   * name: it hands back a *function* that cannot be memoized without risking
   * stale UI, so the compiler skips optimising the whole component rather than
   * get it wrong. `--max-warnings 0` makes that a build failure, which is the
   * correct outcome — the answer is RHF's own subscription hook, which returns
   * a value, not a suppression comment over a real limitation.
   */
  const watchedPhone = useWatch({ control, name: 'phone' });
  const phoneChanged =
    stripPhoneDigits(watchedPhone ?? '') !== stripPhoneDigits(user?.phone ?? '');

  /**
   * Same action sheet as `auth/components/avatar-picker.tsx`'s register-form
   * picker, copy included — `useProfileAvatar` already implements both
   * sources (`change-avatar.ts`'s `AvatarSource`), so this screen only needed
   * to offer the choice `ProfileHero`'s single `onChangeAvatar` callback was
   * hiding behind a hardcoded `'library'`.
   */
  const openAvatarPicker = () => {
    Alert.alert('เลือกรูปโปรไฟล์', 'กรุณาเลือกวิธีการ', [
      { text: 'ถ่ายภาพ', onPress: () => void avatar.changeAvatar('camera') },
      { text: 'เลือกรูปจากแกลเลอรี', onPress: () => void avatar.changeAvatar('library') },
      { text: 'ยกเลิก', style: 'cancel' },
    ]);
  };

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="โปรไฟล์ของฉัน" subject="self" />

        {/*
          One `KeyboardAwareScrollView` where a `KeyboardAvoidingView` used to
          wrap a `ScrollView`. It reads the IME insets natively and scrolls the
          focused input clear of the keyboard, which is what this form actually
          needed — the pair it replaces only ever moved the *container*, so a
          field low in a long form still landed under the keyboard with nothing
          to reveal it.

          It also retires a platform split that had already gone wrong once:
          `behavior` had to be `undefined` on Android to avoid
          double-compensating against the manifest's own
          `windowSoftInputMode="adjustResize"`, and `'height'` there is exactly
          what broke the register form. There is no `behavior` to get wrong any
          more. `auth-shell.tsx` made this move first; see
          `app/(auth)/register.tsx`'s header for what it cost to find out.

          Still wraps only the form and not the header above it — the header has
          nothing to avoid and shouldn't shift when the keyboard opens.

          Plain `style` / `contentContainerStyle` rather than NativeWind's
          `className`: this is a third-party component, which NativeWind will not
          map without an explicit `cssInterop` registration, and a className that
          silently does nothing is worse than a style object that plainly does.
        */}
        <KeyboardAwareScrollView
          testID="profile-keyboard-avoiding-view"
          style={{ flex: 1, paddingHorizontal: 16 }}
          bottomOffset={KEYBOARD_BOTTOM_OFFSET}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ProfileHero
            firstname={user?.firstname ?? ''}
            lastname={user?.lastname ?? ''}
            avatarUri={avatar.localPreview ?? user?.avatar}
            role={user?.role}
            isUploading={avatar.isUploading}
            onChangeAvatar={openAvatarPicker}
          />

          {avatar.error ? (
            <ThemedText type="small" weight="regular" themeColor="danger" accessibilityLiveRegion="polite" className="mt-1 px-2 text-center">
              {avatar.error}
            </ThemedText>
          ) : null}

          <ProfileGroup title="ข้อมูลส่วนตัว">
            <ProfileField label="ชื่อ" value={user?.firstname} isEditing={isEditing}>
              <Controller
                control={control}
                name="firstname"
                render={({ field }) => (
                  <TextField
                    testID="profile-firstname"
                    placeholder="ชื่อ"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    icon="person-outline"
                    autoCapitalize="words"
                    autoComplete="name"
                    editable={!isPending}
                    error={errors.firstname?.message}
                  />
                )}
              />
            </ProfileField>

            <ProfileField label="นามสกุล" value={user?.lastname} isEditing={isEditing}>
              <Controller
                control={control}
                name="lastname"
                render={({ field }) => (
                  <TextField
                    testID="profile-lastname"
                    placeholder="นามสกุล"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    icon="person-outline"
                    autoCapitalize="words"
                    autoComplete="name"
                    editable={!isPending}
                    error={errors.lastname?.message}
                  />
                )}
              />
            </ProfileField>

            <ProfileField
              label="เบอร์โทรศัพท์"
              value={formatThaiPhone(user?.phone ?? '')}
              isEditing={isEditing}
              isLast
            >
              <View>
                <Controller
                  control={control}
                  name="phone"
                  render={({ field }) => (
                    <TextField
                      testID="profile-phone"
                      placeholder="เบอร์โทรศัพท์"
                      value={field.value}
                      onChangeText={(text) => field.onChange(formatThaiPhone(text))}
                      onBlur={field.onBlur}
                      icon="call-outline"
                      keyboardType="phone-pad"
                      autoComplete="tel"
                      editable={!isPending}
                      error={errors.phone?.message}
                    />
                  )}
                />

                {phoneChanged ? (
                  <ThemedText type="label" weight="regular" themeColor="text-secondary" className="-mt-2 mb-3 ml-1">
                    ผู้ดูแลค้นหาคุณด้วยเบอร์นี้ — คำเชิญที่ส่งไปยังเบอร์เดิมจะหาคุณไม่พบ
                  </ThemedText>
                ) : null}
              </View>
            </ProfileField>
          </ProfileGroup>

          <ProfileGroup title="ข้อมูลสุขภาพ">
            <ProfileField label="วันเกิด" value={formatBirthday(user?.dob)} isEditing={isEditing}>
              <Controller
                control={control}
                name="dob"
                render={({ field }) => (
                  <DateField
                    testID="profile-dob"
                    value={field.value}
                    onChange={field.onChange}
                    displayValue={formatBirthday(field.value)}
                    placeholder="เลือกวันเกิด"
                    error={errors.dob?.message}
                    maximumDate={new Date()}
                  />
                )}
              />
            </ProfileField>

            {isEditing ? (
              <View className="px-4 pt-1">
                <Controller
                  control={control}
                  name="gender"
                  render={({ field }) => (
                    <OptionRow
                      label="เพศ"
                      options={GENDER_OPTIONS}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </View>
            ) : (
              <ProfileField label="เพศ" value={genderLabel(user?.gender)} isEditing={false} />
            )}

            <ProfileField
              label="น้ำหนัก"
              value={user?.weight != null ? `${user.weight} กก.` : ''}
              isEditing={isEditing}
            >
              <Controller
                control={control}
                name="weight"
                render={({ field }) => (
                  <TextField
                    testID="profile-weight"
                    placeholder="น้ำหนัก (กก.)"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    icon="barbell-outline"
                    keyboardType="decimal-pad"
                    editable={!isPending}
                    error={errors.weight?.message}
                  />
                )}
              />
            </ProfileField>

            <ProfileField
              label="ส่วนสูง"
              value={user?.height != null ? `${user.height} ซม.` : ''}
              isEditing={isEditing}
            >
              <Controller
                control={control}
                name="height"
                render={({ field }) => (
                  <TextField
                    testID="profile-height"
                    placeholder="ส่วนสูง (ซม.)"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    icon="resize-outline"
                    keyboardType="decimal-pad"
                    editable={!isPending}
                    error={errors.height?.message}
                  />
                )}
              />
            </ProfileField>

            <ProfileField
              label="โรคประจำตัว"
              value={user?.congenitalDisease}
              isEditing={isEditing}
              isLast
            >
              <Controller
                control={control}
                name="congenitalDisease"
                render={({ field }) => (
                  <View className="mb-4">
                    <TextInput
                      testID="profile-congenital-disease"
                      className="rounded-[14px] border-2 px-[14px] py-3"
                      style={{
                        minHeight: 88,
                        // No line height: this input had none, and acquiring one
                        // here would re-centre the text inside the 88px box.
                        ...typography({ size: 15, weight: 'semibold', lineHeight: null }),
                        color: colors['text-primary'],
                        borderColor: errors.congenitalDisease
                          ? statusColor.high
                          : colors.border,
                        backgroundColor: colors['surface-muted'],
                        textAlignVertical: 'top',
                      }}
                      placeholder="เช่น เบาหวาน ความดันโลหิตสูง — เว้นว่างได้"
                      placeholderTextColor={colors['text-secondary']}
                      value={field.value}
                      onChangeText={field.onChange}
                      onBlur={field.onBlur}
                      editable={!isPending}
                      multiline
                    />

                    {errors.congenitalDisease ? (
                      <ThemedText type="label" className="ml-1 mt-1.5" style={{ color: statusColor.high }}>
                        {errors.congenitalDisease.message}
                      </ThemedText>
                    ) : null}
                  </View>
                )}
              />
            </ProfileField>
          </ProfileGroup>

          {/*
            The navigating rows are hidden while editing — leaving a way off the
            screen next to an unsaved form is how edits get lost — but the email
            row is not, and that is deliberate.

            Every other field on this form became editable; email did not, and a
            row that simply vanishes on "แก้ไข" reads as an oversight rather than
            a decision. Shown read-only, it answers the question the edit mode
            raises. The reason it cannot be edited is in this file's header:
            `updateProfile(email:)` writes the column without clearing
            `emailVerified`, so editing here would move a verified badge onto an
            address nobody has proven they own. Making it editable is a gateway
            change, not a client one.
          */}
          <ProfileGroup title="บัญชี">
            <ProfileLinkRow
              testID="profile-email"
              label="อีเมล"
              value={emailSummary(user)}
              onPress={() => router.push('/verify-email')}
              isLast={isEditing}
            />
            {isEditing ? null : (
              <ProfileLinkRow
                testID="profile-invitations"
                label="ผู้ดูแลและผู้ป่วย"
                onPress={() => router.push('/invitations')}
                isLast
              />
            )}
          </ProfileGroup>

          {banner ? (
            <ThemedText type="body" weight="regular" accessibilityLiveRegion="polite" className="mt-4 px-2" style={{ color: banner.tone === 'ok' ? statusColor.normal : colors.danger }}>
              {banner.text}
            </ThemedText>
          ) : null}

          <View className="mt-6" style={{ gap: 10 }}>
            {isEditing ? (
              <>
                <GradientButton
                  testID="profile-save"
                  title="บันทึก"
                  onPress={() => void save()}
                  loading={isPending}
                />
                <GradientButton
                  testID="profile-cancel"
                  title="ยกเลิก"
                  variant="secondary"
                  onPress={cancelEditing}
                  disabled={isPending}
                />
              </>
            ) : (
              <GradientButton testID="profile-edit" title="แก้ไขข้อมูล" onPress={startEditing} />
            )}
          </View>

          <View className="h-10" />
        </KeyboardAwareScrollView>
      </View>
    </GradientBackground>
  );
}

/** "ยืนยันแล้ว" is the answer people are looking for; the address is context. */
function emailSummary(user: User | null): string {
  if (!user?.email) return 'ยังไม่ได้ตั้ง';
  return user.emailVerified ? `${user.email} · ยืนยันแล้ว` : `${user.email} · ยังไม่ยืนยัน`;
}
