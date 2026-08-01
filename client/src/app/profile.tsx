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
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { GradientButton } from '@/components/ui/gradient-button';
import { OptionRow } from '@/components/ui/option-row';
import { TextField } from '@/components/ui/text-field';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import {
  formatAuthError,
  useSession,
  useUpdateProfile,
  type Gender,
  type User,
} from '@/modules/auth';
import {
  DateField,
  ProfileField,
  ProfileGroup,
  ProfileHero,
  ProfileLinkRow,
  changedFields,
  formFromUser,
  hasChanges,
  useProfileAvatar,
  validateProfile,
  type ProfileErrors,
  type ProfileForm,
} from '@/modules/profile';
import { SecurityHeader } from '@/modules/security';
import { status as statusColor } from '@/theme';
import { formatThaiPhone, stripPhoneDigits } from '@/utils/phone-format';

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'ชาย' },
  { value: 'female', label: 'หญิง' },
  { value: 'other', label: 'อื่น ๆ' },
];

const genderLabel = (gender?: Gender | null): string =>
  GENDER_OPTIONS.find((option) => option.value === gender)?.label ?? '';

const formatThaiDate = (date?: Date | null): string =>
  date
    ? date.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

export default function ProfileScreen() {
  const colors = useTheme();
  const fontScale = useFontScale();

  const { user } = useSession();
  const { updateProfile, isPending } = useUpdateProfile();
  const avatar = useProfileAvatar();

  const [form, setForm] = useState<ProfileForm | null>(null);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // `form === null` *is* read mode. One source of truth for the mode beats a
  // boolean that can disagree with the form it guards.
  const isEditing = form !== null;

  const startEditing = () => {
    setBanner(null);
    setErrors({});
    setForm(formFromUser(user));
  };

  const cancelEditing = () => {
    setForm(null);
    setErrors({});
  };

  const patch = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = async () => {
    if (!form) return;

    const found = validateProfile(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setBanner({ tone: 'error', text: 'กรุณาตรวจสอบข้อมูลที่มีเครื่องหมายสีแดง' });
      return;
    }

    const changes = changedFields(form, user);
    if (!hasChanges(changes)) {
      // Not an error, and not a save either. Saying "บันทึกแล้ว" for a request
      // that never went out teaches people to distrust the message.
      setForm(null);
      setBanner({ tone: 'ok', text: 'ไม่มีข้อมูลที่เปลี่ยนแปลง' });
      return;
    }

    try {
      await updateProfile(changes);
      setForm(null);
      setBanner({ tone: 'ok', text: 'บันทึกข้อมูลเรียบร้อยแล้ว' });
    } catch (error) {
      const { message, field } = formatAuthError(error, {
        fallback: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
      });
      // The gateway's one field-specific rejection here is a duplicate phone.
      if (field === 'phone') setErrors((current) => ({ ...current, phone: message }));
      setBanner({ tone: 'error', text: message });
    }
  };

  const phoneChanged =
    stripPhoneDigits(form?.phone ?? '') !== stripPhoneDigits(user?.phone ?? '');

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="โปรไฟล์ของฉัน" />

        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ProfileHero
            firstname={user?.firstname ?? ''}
            lastname={user?.lastname ?? ''}
            avatarUri={avatar.localPreview ?? user?.avatar}
            role={user?.role}
            isUploading={avatar.isUploading}
            onChangeAvatar={() => void avatar.changeAvatar('library')}
          />

          {avatar.error ? (
            <Text
              className="mt-1 px-2 text-center"
              accessibilityLiveRegion="polite"
              style={{ fontSize: Math.round(14 * fontScale), color: colors.danger }}
            >
              {avatar.error}
            </Text>
          ) : null}

          <ProfileGroup title="ข้อมูลส่วนตัว">
            <ProfileField label="ชื่อ" value={user?.firstname} isEditing={isEditing}>
              <TextField
                testID="profile-firstname"
                placeholder="ชื่อ"
                value={form?.firstname ?? ''}
                onChangeText={(text) => patch('firstname', text)}
                icon="person-outline"
                autoCapitalize="words"
                autoComplete="name"
                editable={!isPending}
                error={errors.firstname}
              />
            </ProfileField>

            <ProfileField label="นามสกุล" value={user?.lastname} isEditing={isEditing}>
              <TextField
                testID="profile-lastname"
                placeholder="นามสกุล"
                value={form?.lastname ?? ''}
                onChangeText={(text) => patch('lastname', text)}
                icon="person-outline"
                autoCapitalize="words"
                autoComplete="name"
                editable={!isPending}
                error={errors.lastname}
              />
            </ProfileField>

            <ProfileField
              label="เบอร์โทรศัพท์"
              value={formatThaiPhone(user?.phone ?? '')}
              isEditing={isEditing}
              isLast
            >
              <View>
                <TextField
                  testID="profile-phone"
                  placeholder="เบอร์โทรศัพท์"
                  value={form?.phone ?? ''}
                  onChangeText={(text) => patch('phone', formatThaiPhone(text))}
                  icon="call-outline"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  editable={!isPending}
                  error={errors.phone}
                />

                {phoneChanged ? (
                  <Text
                    className="-mt-2 mb-3 ml-1"
                    style={{
                      fontSize: Math.round(13 * fontScale),
                      lineHeight: Math.round(19 * fontScale),
                      color: colors['text-secondary'],
                    }}
                  >
                    ผู้ดูแลค้นหาคุณด้วยเบอร์นี้ — คำเชิญที่ส่งไปยังเบอร์เดิมจะหาคุณไม่พบ
                  </Text>
                ) : null}
              </View>
            </ProfileField>
          </ProfileGroup>

          <ProfileGroup title="ข้อมูลสุขภาพ">
            <ProfileField label="วันเกิด" value={formatThaiDate(user?.dob)} isEditing={isEditing}>
              <DateField
                testID="profile-dob"
                value={form?.dob ?? null}
                onChange={(value) => patch('dob', value)}
                displayValue={formatThaiDate(form?.dob)}
                placeholder="เลือกวันเกิด"
                error={errors.dob}
                maximumDate={new Date()}
              />
            </ProfileField>

            {isEditing ? (
              <View className="px-4 pt-1">
                <OptionRow
                  label="เพศ"
                  options={GENDER_OPTIONS}
                  value={form?.gender ?? null}
                  onChange={(value) => patch('gender', value)}
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
              <TextField
                testID="profile-weight"
                placeholder="น้ำหนัก (กก.)"
                value={form?.weight ?? ''}
                onChangeText={(text) => patch('weight', text)}
                icon="barbell-outline"
                keyboardType="decimal-pad"
                editable={!isPending}
                error={errors.weight}
              />
            </ProfileField>

            <ProfileField
              label="ส่วนสูง"
              value={user?.height != null ? `${user.height} ซม.` : ''}
              isEditing={isEditing}
            >
              <TextField
                testID="profile-height"
                placeholder="ส่วนสูง (ซม.)"
                value={form?.height ?? ''}
                onChangeText={(text) => patch('height', text)}
                icon="resize-outline"
                keyboardType="decimal-pad"
                editable={!isPending}
                error={errors.height}
              />
            </ProfileField>

            <ProfileField
              label="โรคประจำตัว"
              value={user?.congenitalDisease}
              isEditing={isEditing}
              isLast
            >
              <View className="mb-4">
                <TextInput
                  testID="profile-congenital-disease"
                  className="rounded-[14px] border-2 px-[14px] py-3 font-semibold"
                  style={{
                    minHeight: 88,
                    fontSize: Math.round(15 * fontScale),
                    color: colors['text-primary'],
                    borderColor: errors.congenitalDisease ? statusColor.high : colors.border,
                    backgroundColor: colors['surface-muted'],
                    textAlignVertical: 'top',
                  }}
                  placeholder="เช่น เบาหวาน ความดันโลหิตสูง — เว้นว่างได้"
                  placeholderTextColor={colors['text-secondary']}
                  value={form?.congenitalDisease ?? ''}
                  onChangeText={(text) => patch('congenitalDisease', text)}
                  editable={!isPending}
                  multiline
                />

                {errors.congenitalDisease ? (
                  <Text
                    className="ml-1 mt-1.5 font-semibold"
                    style={{ fontSize: Math.round(13 * fontScale), color: statusColor.high }}
                  >
                    {errors.congenitalDisease}
                  </Text>
                ) : null}
              </View>
            </ProfileField>
          </ProfileGroup>

          {/* Hidden while editing: both rows navigate away, and leaving a way
              off the screen next to an unsaved form is how edits get lost. */}
          {isEditing ? null : (
            <ProfileGroup title="บัญชี">
              <ProfileLinkRow
                testID="profile-email"
                label="อีเมล"
                value={emailSummary(user)}
                onPress={() => router.push('/verify-email')}
              />
              <ProfileLinkRow
                testID="profile-invitations"
                label="ผู้ดูแลและผู้ป่วย"
                onPress={() => router.push('/invitations')}
                isLast
              />
            </ProfileGroup>
          )}

          {banner ? (
            <Text
              className="mt-4 px-2"
              accessibilityLiveRegion="polite"
              style={{
                fontSize: Math.round(15 * fontScale),
                color: banner.tone === 'ok' ? statusColor.normal : colors.danger,
              }}
            >
              {banner.text}
            </Text>
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
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

/** "ยืนยันแล้ว" is the answer people are looking for; the address is context. */
function emailSummary(user: User | null): string {
  if (!user?.email) return 'ยังไม่ได้ตั้ง';
  return user.emailVerified ? `${user.email} · ยืนยันแล้ว` : `${user.email} · ยังไม่ยืนยัน`;
}
