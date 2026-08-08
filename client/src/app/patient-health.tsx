/**
 * A caregiver edits their patient's health information.
 *
 * ## Whose data is on screen
 *
 * `useSubject()`, the app's existing answer, and nothing new. The caregiver
 * enters a patient from `app/invitations.tsx` — which sets
 * `activePatientId` — and this screen reads the subject from there rather
 * than taking a route parameter. Two reasons, and the first is sufficient:
 *
 *   1. A `patientId` in the URL is a second source of truth for a question
 *      the app already answers, and the failure mode is the one
 *      `use-subject.ts` was written to make unrepresentable — a screen
 *      showing one person's data while the banner names another. Here it
 *      would be worse than on a read screen: this one *writes*.
 *   2. A route parameter is untrusted input on a deep link. The gateway
 *      would refuse an id the caregiver has no link to, but the screen would
 *      still have rendered a form promising to edit a stranger's record.
 *
 * `SecurityHeader subject="patient"` therefore carries `CompactPatientBanner`,
 * and it says whose account this is on every frame of the edit.
 *
 * ## Five fields, and why the profile form is not reused
 *
 * `app/profile.tsx` edits eight columns including `phone` and links out to
 * the email flow. A caregiver may write none of those — `email` and `phone`
 * are unique login identities, and a caregiver who could change the email
 * could request a password reset and take the account. The gateway keeps them
 * out by giving `updatePatientHealth` its own input type; this screen is a
 * separate file for the same reason. Sharing the form and hiding the inputs
 * would leave those fields one render condition away from the wire.
 *
 * The *vocabulary* is shared (`GENDER_OPTIONS`, `formatBirthday`,
 * `ProfileField`, `DateField`), because the two screens writing the same
 * column must not name it differently.
 *
 * ## Only changed fields are sent
 *
 * `myPatients` carries all five, so the form seeds every field it may write
 * and nothing starts blank for want of a query. The submit is still a patch
 * rather than a full write: two caregivers can look after the same patient,
 * and sending the whole form would make every save an overwrite, so the
 * second to submit would silently revert a field the first had just changed
 * without either of them editing it. See `modules/caregivers/lib/health-form.ts`
 * for the absent-vs-null mechanics.
 *
 * ## The permission check here is not the authority
 *
 * `canEditPatientHealth` decides whether to *offer* the form; the gateway
 * decides whether the write lands. The patient can downgrade a grant at any
 * moment via `updateCaregiverPermission`, so a refusal can arrive for a form
 * that rendered honestly a second earlier — and when it does, the server's
 * Thai message is what the caregiver reads, not a locally guessed one.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { ThemedText } from '@/components/themed-text';
import { GradientButton } from '@/components/ui/gradient-button';
import { OptionRow } from '@/components/ui/option-row';
import { TextField } from '@/components/ui/text-field';
import { useTypography } from '@/hooks/use-typography';
import { useTheme } from '@/hooks/use-theme';
import { formatErrorMessage } from '@/lib/error-message';
import {
  canEditPatientHealth,
  changedHealthFields,
  hasHealthChanges,
  healthFormFromPatient,
  useSubject,
  useUpdatePatientHealth,
  validateHealthForm,
  type HealthBaseline,
  type HealthErrors,
  type HealthForm,
  type PatientHealthProfile,
} from '@/modules/caregivers';
import {
  DateField,
  GENDER_OPTIONS,
  ProfileField,
  ProfileGroup,
  formatBirthday,
  genderLabel,
} from '@/modules/profile';
import { SecurityHeader } from '@/modules/security';
import { status as statusColor } from '@/theme';

export default function PatientHealthScreen() {
  const colors = useTheme();
  const typography = useTypography();

  const { patient, patientIdArg } = useSubject();
  const { updatePatientHealth, isPending } = useUpdatePatientHealth();

  /**
   * What a save returned, for the rest of this session.
   *
   * The only way `gender` and `congenitalDisease` are ever readable by a
   * caregiver: the mutation answers with all five columns, so a second edit
   * can show what the first one wrote instead of asking the caregiver to
   * remember. Not persisted and not put in the query cache — it is one
   * screen's memory of its own write, and treating it as a general read would
   * be claiming a read path that does not exist.
   */
  const [known, setKnown] = useState<PatientHealthProfile | null>(null);

  /**
   * `form === null` *is* read mode — the same structure as `app/profile.tsx`,
   * and for the same reason: seeding state from props in an effect is the
   * cascading-render defect `pnpm check` fails on, while tapping "แก้ไข" is an
   * event and can seed honestly.
   */
  const [form, setForm] = useState<HealthForm | null>(null);
  /** What the form was seeded with, so `changedHealthFields` has something to diff against. */
  const [baseline, setBaseline] = useState<HealthBaseline | null>(null);
  const [errors, setErrors] = useState<HealthErrors>({});
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const isEditing = form !== null;
  const canEdit = canEditPatientHealth(patient);

  // Read-mode values come from the patient record and from whatever the last
  // save returned, never from `form` — a cancelled edit must not leave its
  // typing on screen as though it had been saved.
  const currentDob = known?.dob ?? patient?.dob;
  const currentWeight = known?.weight ?? patient?.weight;
  const currentHeight = known?.height ?? patient?.height;

  const startEditing = () => {
    setBanner(null);
    setErrors({});
    const seeded = healthFormFromPatient(patient, known);
    setForm(seeded);
    setBaseline(seeded);
  };

  const cancelEditing = () => {
    setForm(null);
    setBaseline(null);
    setErrors({});
  };

  const patch = <K extends keyof HealthForm>(key: K, value: HealthForm[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = async () => {
    if (!form || !baseline || !patientIdArg) return;

    const found = validateHealthForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setBanner({ tone: 'error', text: 'กรุณาตรวจสอบข้อมูลที่มีเครื่องหมายสีแดง' });
      return;
    }

    const input = changedHealthFields(form, baseline);
    if (!hasHealthChanges(input)) {
      // Not an error and not a save. Saying "บันทึกแล้ว" for a request that
      // never went out teaches people to distrust the message — and on a
      // screen whose whole premise is an audit trail, a save that logs
      // nothing while claiming to have saved is the exact thing being audited.
      cancelEditing();
      setBanner({ tone: 'ok', text: 'ไม่มีข้อมูลที่เปลี่ยนแปลง' });
      return;
    }

    try {
      const updated = await updatePatientHealth({ patientId: patientIdArg, input });
      setKnown(updated);
      cancelEditing();
      setBanner({
        tone: 'ok',
        text: 'บันทึกเรียบร้อยแล้ว ผู้ป่วยจะเห็นรายการนี้ในประวัติการแก้ไขของเขา',
      });
    } catch (error) {
      // The server's own Thai message, verbatim — `FORBIDDEN` when the grant
      // was downgraded between render and submit, `NOT_FOUND` when the link
      // is gone. A local guess would be wrong precisely in the case that
      // matters, because the client's copy of the permission is the stale one.
      setBanner({
        tone: 'error',
        text: formatErrorMessage(error, 'บันทึกไม่สำเร็จ กรุณาลองใหม่'),
      });
    }
  };

  /*
   * No active patient. Reachable by a deep link or by backing into the route
   * after leaving a patient, and rendering an empty form would invite someone
   * to fill it in for nobody.
   */
  if (!patient || !patientIdArg) {
    return (
      <GradientBackground>
        <View className="flex-1">
          <SecurityHeader title="ข้อมูลสุขภาพ" subject="patient" />
          <View className="px-4 pt-4">
            <Notice
              testID="patient-health-no-subject"
              title="ยังไม่ได้เลือกผู้ป่วย"
              text='เลือกผู้ป่วยที่ต้องการดูแลจากหน้า "ผู้ดูแลและผู้ป่วย" ก่อน'
            />
            <GradientButton
              testID="patient-health-pick"
              title="ไปที่ผู้ดูแลและผู้ป่วย"
              onPress={() => router.replace('/invitations')}
            />
          </View>
        </View>
      </GradientBackground>
    );
  }

  const patientName = `คุณ${patient.firstname}`;

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="ข้อมูลสุขภาพ" subject="patient" />

        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="heading" weight="bold" className="mb-1 mt-1 px-1">
            {`ข้อมูลสุขภาพของ${patientName}`}
          </ThemedText>
          <ThemedText
            type="small"
            weight="regular"
            themeColor="text-secondary"
            className="mb-3 px-1"
          >
            {canEdit
              ? `${patientName}จะเห็นทุกการแก้ไขที่คุณบันทึก พร้อมชื่อของคุณและเวลาที่แก้`
              : `${patientName}ให้สิทธิ์คุณดูอย่างเดียว จึงแก้ไขข้อมูลนี้ไม่ได้`}
          </ThemedText>

          <ProfileGroup title="ข้อมูลสุขภาพ">
            <ProfileField
              testID="patient-health-dob"
              label="วันเกิด"
              value={formatBirthday(currentDob)}
              isEditing={isEditing}
            >
              <DateField
                testID="patient-health-dob-field"
                value={form?.dob ?? null}
                onChange={(value) => patch('dob', value)}
                displayValue={formatBirthday(form?.dob)}
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
              <ProfileField
                testID="patient-health-gender"
                label="เพศ"
                value={genderLabel(known?.gender)}
                isEditing={false}
              />
            )}

            <ProfileField
              testID="patient-health-weight"
              label="น้ำหนัก"
              value={currentWeight != null ? `${currentWeight} กก.` : ''}
              isEditing={isEditing}
            >
              <TextField
                testID="patient-health-weight-field"
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
              testID="patient-health-height"
              label="ส่วนสูง"
              value={currentHeight != null ? `${currentHeight} ซม.` : ''}
              isEditing={isEditing}
            >
              <TextField
                testID="patient-health-height-field"
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
              testID="patient-health-congenital-disease"
              label="โรคประจำตัว"
              value={known?.congenitalDisease}
              isEditing={isEditing}
              isLast
            >
              <View className="mb-4">
                <TextInput
                  testID="patient-health-congenital-disease-field"
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
                  placeholder="เช่น เบาหวาน ความดันโลหิตสูง — เว้นว่างไว้ถ้าไม่แก้"
                  placeholderTextColor={colors['text-secondary']}
                  value={form?.congenitalDisease ?? ''}
                  onChangeText={(text) => patch('congenitalDisease', text)}
                  editable={!isPending}
                  multiline
                />

                {errors.congenitalDisease ? (
                  <ThemedText
                    type="label"
                    className="ml-1 mt-1.5"
                    style={{ color: statusColor.high }}
                  >
                    {errors.congenitalDisease}
                  </ThemedText>
                ) : null}
              </View>
            </ProfileField>
          </ProfileGroup>

          {/*
            Errors are inline on this screen rather than an `Alert` — the
            project reserves `Alert.alert` for permission prompts and one-shot
            irreversible confirmations, and a refused save is neither.
          */}
          {banner ? (
            <ThemedText
              testID="patient-health-banner"
              type="body"
              weight="regular"
              accessibilityLiveRegion="polite"
              className="mt-4 px-2"
              style={{ color: banner.tone === 'ok' ? statusColor.normal : colors.danger }}
            >
              {banner.text}
            </ThemedText>
          ) : null}

          <View className="mt-6" style={{ gap: 10 }}>
            {isEditing ? (
              <>
                <GradientButton
                  testID="patient-health-save"
                  title="บันทึก"
                  onPress={() => void save()}
                  loading={isPending}
                />
                <GradientButton
                  testID="patient-health-cancel"
                  title="ยกเลิก"
                  variant="secondary"
                  onPress={cancelEditing}
                  disabled={isPending}
                />
              </>
            ) : canEdit ? (
              <GradientButton
                testID="patient-health-edit"
                title="แก้ไขข้อมูลสุขภาพ"
                onPress={startEditing}
              />
            ) : (
              /*
                A `view` caregiver gets no edit entry point at all — not a
                disabled button. A greyed-out control invites a tap and then
                explains nothing; the subtitle above already says why, in the
                patient's terms.
              */
              <Notice
                testID="patient-health-read-only"
                title="ดูอย่างเดียว"
                text={`หากต้องการแก้ไขข้อมูลสุขภาพแทน${patientName} ให้ขอให้เขาเปลี่ยนสิทธิ์เป็น "บันทึกแทนได้" ในหน้าผู้ดูแลของเขา`}
              />
            )}
          </View>

          <View className="h-10" />
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

function Notice({
  title,
  text,
  testID,
}: {
  title: string;
  text: string;
  testID?: string;
}) {
  const colors = useTheme();

  return (
    <View
      testID={testID}
      className="mb-3 rounded-2xl border p-4"
      style={{ backgroundColor: colors.surface, borderColor: colors['border-strong'] }}
    >
      <ThemedText type="default" weight="bold" className="mb-1.5">
        {title}
      </ThemedText>
      <ThemedText type="small" weight="regular" themeColor="text-secondary">
        {text}
      </ThemedText>
    </View>
  );
}
