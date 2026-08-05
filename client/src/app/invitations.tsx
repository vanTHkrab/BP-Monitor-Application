/**
 * Invitations — the caregiver↔patient link screen, for both sides.
 * Ported from client-old/app/caregivers.tsx.
 *
 * Renamed from "caregivers" because that named a group of people, and the
 * screen is about a decision: who is asking, who was granted, what is still
 * waiting. A patient opening "ผู้ดูแล" expects a list; what they actually
 * need to find is the one row asking for an answer.
 *
 * Three deliberate departures from client-old:
 *
 *   1. **Sections come from the data, not the role.** The old screen branched
 *      everything on `user.role === 'caregiver'`, so a patient who had also
 *      invited someone — the gateway permits it, `addCaregiverPatient` has no
 *      role check — could not see or cancel their own sent invite. See
 *      `lib/sections.ts`. Role still decides whether the invite *form* is
 *      offered.
 *   2. **The invite waiting on you is first, always.** It is the only thing
 *      on the screen with a deadline attached to someone else's care.
 *   3. **Relationship is a picker, not free text.** The gateway normalises
 *      the string to a seven-value enum and silently stores anything else as
 *      `other`, so "family" and "nurse" both arrived as "อื่น ๆ" on the
 *      patient's consent card.
 *
 * **This screen is the only way into caregiver mode** (C-005). Tapping a
 * patient row sets the viewing context and replaces the route with `/(tabs)`;
 * home and history both gate on that context, so before this they rendered a
 * picker for a mode no user could enter.
 *
 * A row is only openable once `myPatients` has resolved. The link fallback
 * used while it loads carries no `PatientSummary`, and storing a patient the
 * app cannot name would render the banner as an accusation about nobody.
 *
 * The "you are in someone else's account" banner ships with it and is not
 * optional — see `modules/caregivers/components/active-patient-banner.tsx`
 * for why. docs/todo/CLIENT-caregiver.md has the whole picture.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/modules/auth';
import {
  InviteDecisionCard,
  InviteForm,
  LinkGroup,
  LinkRow,
  deriveSections,
  isEmpty,
  linkKey,
  relationshipLabel,
  useActivePatient,
  useCaregiverLinks,
  useMyPatients,
  useRemoveCaregiverLink,
  useRespondToInvite,
  type CaregiverLink,
  type PatientSummary,
} from '@/modules/caregivers';
import { formatErrorMessage } from '@/lib/error-message';
import { SecurityHeader } from '@/modules/security';
import { formatThaiPhone } from '@/utils/phone-format';

export default function InvitationsScreen() {
  const colors = useTheme();
  const fontScale = useFontScale();
  const { user, userId } = useSession();
  const isCaregiver = user?.role === 'caregiver';

  const { links, isLoading, isRefetching, refetch } = useCaregiverLinks();
  const { patients, refetch: refetchPatients } = useMyPatients({ enabled: isCaregiver });
  const { respondToInvite, pendingCaregiverId } = useRespondToInvite();
  const { removeCaregiverLink } = useRemoveCaregiverLink();

  const [error, setError] = useState<string | null>(null);

  const { setActivePatient } = useActivePatient();

  const sections = useMemo(() => deriveSections(links, userId), [links, userId]);

  const respond = async (link: CaregiverLink, accept: boolean) => {
    setError(null);
    try {
      await respondToInvite({ caregiverId: link.caregiverId, accept });
    } catch (caught) {
      setError(formatErrorMessage(caught, 'ตอบรับคำเชิญไม่สำเร็จ กรุณาลองใหม่'));
    }
  };

  /**
   * Alert, not an inline control: this is a one-shot confirmation of an
   * irreversible action, which is the exception the project's
   * "errors are inline, not Alert" rule carves out.
   */
  const confirmRemove = (
    caregiverId: string,
    patientId: string,
    name: string,
    { isSentInvite = false }: { isSentInvite?: boolean } = {},
  ) => {
    Alert.alert(
      isSentInvite ? 'ยกเลิกคำเชิญ' : 'ยกเลิกการเชื่อมโยง',
      isSentInvite
        ? `ยกเลิกคำเชิญที่ส่งถึง ${name} ใช่หรือไม่`
        : `${name} จะไม่เห็นข้อมูลความดันอีกต่อไป ต้องการดำเนินการต่อหรือไม่`,
      [
        { text: 'ไม่ใช่ตอนนี้', style: 'cancel' },
        {
          text: isSentInvite ? 'ยกเลิกคำเชิญ' : 'ยกเลิกการเชื่อมโยง',
          style: 'destructive',
          onPress: async () => {
            setError(null);
            try {
              await removeCaregiverLink({ caregiverId, patientId });
            } catch (caught) {
              setError(formatErrorMessage(caught, 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่'));
            }
          },
        },
      ],
    );
  };

  const refreshAll = () => {
    void refetch();
    if (isCaregiver) void refetchPatients();
  };

  /**
   * `myPatients` carries avatars; the link list does not. It is preferred
   * when it has arrived and the link list is the fallback, so a slow second
   * query shows an unadorned row rather than an empty section.
   */
  const patientRows = useMemo(() => {
    if (patients.length > 0) {
      return patients.map((patient) => ({
        key: patient.id,
        caregiverId: userId ?? '',
        patientId: patient.id,
        firstname: patient.firstname,
        lastname: patient.lastname,
        name: `คุณ${patient.firstname} ${patient.lastname}`.trim(),
        avatarUri: patient.avatar,
        detail: `${formatThaiPhone(patient.phone)} · ${relationshipLabel(patient.relationship)}`,
        patient,
      }));
    }

    return sections.myPatientLinks.map((link) => ({
      key: linkKey(link),
      caregiverId: link.caregiverId,
      patientId: link.patientId,
      firstname: undefined,
      lastname: undefined,
      name: `คุณ${link.patientName}`,
      avatarUri: undefined,
      detail: `${formatThaiPhone(link.patientPhone)} · ${relationshipLabel(link.relationship)}`,
      /**
       * No `PatientSummary` on this path — it is the fallback for when
       * `myPatients` has not resolved, and the store keeps the whole record so
       * the banner can name the patient without a second query. Rows here are
       * not openable; they become openable a moment later when `myPatients`
       * lands. Better than opening with a half-populated patient the banner
       * would render as blank.
       */
      patient: undefined,
    }));
  }, [patients, sections.myPatientLinks, userId]);

  /**
   * C-005: enter the patient's data.
   *
   * `router.replace`, not `push`. The tabs are the destination, not a screen
   * stacked on top of this one — a back gesture landing on the picker while
   * the tabs behind it show someone else's readings is the confusing half of
   * a modal that should have been a mode switch.
   *
   * The store is set first so the tabs mount already scoped; setting it after
   * navigating renders one frame of the caregiver's own (empty) history.
   *
   * This grants nothing. `readings(patientId:)` needs an accepted link on the
   * gateway, so the worst a tampered client achieves is asking for data it
   * will not receive.
   */
  const openPatient = (patient: PatientSummary) => {
    setActivePatient(patient);
    router.replace('/(tabs)');
  };

  const showEmptyState = !isLoading && isEmpty(sections) && !isCaregiver;

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="ผู้ดูแลและผู้ป่วย" />

        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refreshAll} />
          }
        >
          {sections.invitesToAnswer.length > 0 ? (
            <View className="mt-4">
              <Text
                className="mb-2.5 ml-1 font-semibold uppercase"
                style={{
                  fontSize: Math.round(12 * fontScale),
                  color: colors['text-secondary'],
                  letterSpacing: 0.5,
                }}
              >
                {`รอคุณตอบรับ · ${sections.invitesToAnswer.length} คำเชิญ`}
              </Text>

              {sections.invitesToAnswer.map((link) => (
                <InviteDecisionCard
                  key={linkKey(link)}
                  link={link}
                  isResponding={pendingCaregiverId === link.caregiverId}
                  onRespond={(accept) => void respond(link, accept)}
                />
              ))}
            </View>
          ) : null}

          {isCaregiver ? <InviteForm /> : null}

          {isCaregiver ? (
            <LinkGroup title={`ผู้ป่วยที่ฉันดูแล · ${patientRows.length} คน`}>
              {patientRows.length > 0 ? (
                patientRows.map((row, index) => (
                  <LinkRow
                    key={row.key}
                    testID={`patient-${row.patientId}`}
                    firstname={row.firstname}
                    lastname={row.lastname}
                    name={row.name}
                    avatarUri={row.avatarUri}
                    detail={row.detail}
                    onOpen={row.patient ? () => openPatient(row.patient) : undefined}
                    removeLabel="ยกเลิกการเชื่อมโยงกับ"
                    onRemove={() =>
                      confirmRemove(row.caregiverId, row.patientId, row.name)
                    }
                    isLast={index === patientRows.length - 1}
                  />
                ))
              ) : (
                <EmptyRow
                  text={
                    isLoading
                      ? 'กำลังโหลด…'
                      : 'ยังไม่มีผู้ป่วยที่ตอบรับคำเชิญ ส่งคำเชิญด้วยเบอร์โทรศัพท์ด้านบนได้เลย'
                  }
                />
              )}
            </LinkGroup>
          ) : null}

          {sections.sentInvites.length > 0 ? (
            <LinkGroup title={`คำเชิญที่ส่งแล้ว · รอตอบรับ ${sections.sentInvites.length}`}>
              {sections.sentInvites.map((link, index) => (
                <LinkRow
                  key={linkKey(link)}
                  testID={`sent-${link.patientId}`}
                  name={`คุณ${link.patientName || formatThaiPhone(link.patientPhone)}`}
                  detail={`${formatThaiPhone(link.patientPhone)} · ยังไม่ได้ตอบรับ`}
                  muted
                  removeIcon="close"
                  removeLabel="ยกเลิกคำเชิญถึง"
                  onRemove={() =>
                    confirmRemove(
                      link.caregiverId,
                      link.patientId,
                      `คุณ${link.patientName}`,
                      { isSentInvite: true },
                    )
                  }
                  isLast={index === sections.sentInvites.length - 1}
                />
              ))}
            </LinkGroup>
          ) : null}

          {sections.myCaregivers.length > 0 ? (
            <LinkGroup title={`ผู้ดูแลของฉัน · ${sections.myCaregivers.length} คน`}>
              {sections.myCaregivers.map((link, index) => (
                <LinkRow
                  key={linkKey(link)}
                  testID={`caregiver-${link.caregiverId}`}
                  name={`คุณ${link.caregiverName}`}
                  detail={`${formatThaiPhone(link.caregiverPhone)} · ${relationshipLabel(
                    link.relationship,
                  )}`}
                  removeLabel="ยกเลิกการเชื่อมโยงกับ"
                  onRemove={() =>
                    confirmRemove(
                      link.caregiverId,
                      link.patientId,
                      `คุณ${link.caregiverName}`,
                    )
                  }
                  isLast={index === sections.myCaregivers.length - 1}
                />
              ))}
            </LinkGroup>
          ) : null}

          {showEmptyState ? (
            <View
              className="mt-6 rounded-2xl p-5"
              style={{ backgroundColor: colors.surface }}
            >
              <Text
                className="font-bold"
                style={{
                  fontSize: Math.round(16 * fontScale),
                  color: colors['text-primary'],
                }}
              >
                ยังไม่มีใครเชื่อมโยงกับบัญชีนี้
              </Text>
              <Text
                className="mt-2"
                style={{
                  fontSize: Math.round(14 * fontScale),
                  lineHeight: Math.round(21 * fontScale),
                  color: colors['text-secondary'],
                }}
              >
                เมื่อมีผู้ดูแลส่งคำเชิญมา คำเชิญจะแสดงที่หน้านี้ให้คุณกดอนุญาตหรือปฏิเสธ
                จนกว่าคุณจะอนุญาต จะไม่มีใครเห็นค่าความดันของคุณ
              </Text>
            </View>
          ) : null}

          {error ? (
            <Text
              className="mt-4 px-2"
              accessibilityLiveRegion="polite"
              style={{ fontSize: Math.round(15 * fontScale), color: colors.danger }}
            >
              {error}
            </Text>
          ) : null}

          <View className="h-10" />
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

function EmptyRow({ text }: { text: string }) {
  const colors = useTheme();
  const fontScale = useFontScale();

  return (
    <View className="px-4 py-5">
      <Text
        style={{
          fontSize: Math.round(14 * fontScale),
          lineHeight: Math.round(21 * fontScale),
          color: colors['text-secondary'],
        }}
      >
        {text}
      </Text>
    </View>
  );
}
