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
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/ui/tab-buttons';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/modules/auth';
import {
  InviteDecisionCard,
  InviteForm,
  LinkGroup,
  LinkRow,
  PersonCard,
  deriveSections,
  linkKey,
  relationshipLabel,
  useActivePatient,
  useCaregiverLinks,
  useInviteAlerts,
  useMyPatients,
  useRemoveCaregiverLink,
  useRespondToInvite,
  type CaregiverLink,
  type CaregiverPermission,
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
  /*
   * Which half of the screen is showing. `people` is the default because it
   * is what the screen is *for* once the account is set up; a waiting request
   * is surfaced from there by a banner and by the count on the tab, so
   * defaulting to `requests` would put an empty tab in front of everyone who
   * has nothing to answer.
   */
  const [tab, setTab] = useState<'people' | 'requests'>('people');

  const { setActivePatient } = useActivePatient();

  const sections = useMemo(() => deriveSections(links, userId), [links, userId]);

  /*
   * Announces a request the patient has not been told about. Mounted on this
   * screen rather than app-wide because this is where the link list is
   * already fetched — a global watcher would mean a second `caregiverLinks`
   * query whose cache could disagree with this one about what is pending.
   * Cost: a request that arrives while the app sits on another screen is
   * announced the next time this screen loads it, not the moment it lands.
   */
  useInviteAlerts(sections.invitesToAnswer, userId);

  const respond = async (
    link: CaregiverLink,
    accept: boolean,
    permission: CaregiverPermission,
  ) => {
    setError(null);
    try {
      await respondToInvite({ caregiverId: link.caregiverId, accept, permission });
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
        detail: formatThaiPhone(patient.phone),
        /*
         * Read-only is labelled here as well as in the switcher sheet:
         * discovering you cannot record only after opening the patient and
         * framing a photo wastes the measurement they just sat through.
         */
        chips: [
          { label: relationshipLabel(patient.relationship) },
          ...(patient.permission === 'view'
            ? [{ label: 'ดูอย่างเดียว', tone: 'accent' as const }]
            : []),
        ],
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
      avatarUri: link.patientAvatar,
      detail: formatThaiPhone(link.patientPhone),
      chips: [{ label: relationshipLabel(link.relationship) }],
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

  const pendingCount = sections.invitesToAnswer.length;
  const hasPeople = sections.myCaregivers.length > 0 || patientRows.length > 0;
  const hasRequests = pendingCount > 0 || sections.sentInvites.length > 0;

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="ผู้ดูแลและผู้ป่วย" />

        <View className="px-4 pb-1 pt-2">
          <TabButtons
            testIDPrefix="invitations-tab"
            tabs={[
              { key: 'people', label: 'ผู้ดูแล' },
              {
                key: 'requests',
                label: pendingCount > 0 ? `คำขอของฉัน · ${pendingCount}` : 'คำขอของฉัน',
              },
            ]}
            activeTab={tab}
            onTabChange={setTab}
          />
        </View>

        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refreshAll} />
          }
        >
          {tab === 'people' ? (
            <View className="pt-4">
              {/*
                * A pending request is the one thing on this screen with
                * someone else waiting on it, and the other tab hides it. This
                * is a pointer, not a duplicate of the card — answering still
                * happens in one place.
                */}
              {pendingCount > 0 ? (
                <Pressable
                  testID="pending-requests-hint"
                  onPress={() => setTab('requests')}
                  accessibilityRole="button"
                  accessibilityLabel={`ดูคำขอที่รอคุณตอบรับ ${pendingCount} รายการ`}
                  className="mb-4 flex-row items-center rounded-2xl border-2 p-3.5"
                  style={({ pressed }) => ({
                    backgroundColor: colors.surface,
                    borderColor: colors.accent,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Ionicons name="mail-unread-outline" size={20} color={colors.accent} />
                  <Text
                    className="ml-2.5 flex-1 font-semibold"
                    style={{
                      fontSize: Math.round(14 * fontScale),
                      color: colors['text-primary'],
                    }}
                  >
                    {`มี ${pendingCount} คำขอรอคุณตอบรับ`}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors['text-secondary']}
                  />
                </Pressable>
              ) : null}

              {sections.myCaregivers.length > 0 ? (
                <>
                  <SectionTitle text={`ผู้ดูแลของฉัน · ${sections.myCaregivers.length} คน`} />
                  {sections.myCaregivers.map((link) => (
                    <PersonCard
                      key={linkKey(link)}
                      testID={`caregiver-${link.caregiverId}`}
                      name={`คุณ${link.caregiverName}`}
                      avatarUri={link.caregiverAvatar}
                      detail={formatThaiPhone(link.caregiverPhone)}
                      chips={[{ label: relationshipLabel(link.relationship) }]}
                      removeLabel="ยกเลิกการเชื่อมโยงกับ"
                      onRemove={() =>
                        confirmRemove(
                          link.caregiverId,
                          link.patientId,
                          `คุณ${link.caregiverName}`,
                        )
                      }
                    />
                  ))}
                </>
              ) : null}

              {isCaregiver ? (
                <>
                  <SectionTitle text={`ผู้ป่วยที่ฉันดูแล · ${patientRows.length} คน`} />
                  {patientRows.length > 0 ? (
                    patientRows.map((row) => (
                      <PersonCard
                        key={row.key}
                        testID={`patient-${row.patientId}`}
                        firstname={row.firstname}
                        lastname={row.lastname}
                        name={row.name}
                        avatarUri={row.avatarUri}
                        detail={row.detail}
                        chips={row.chips}
                        onOpen={row.patient ? () => openPatient(row.patient) : undefined}
                        removeLabel="ยกเลิกการเชื่อมโยงกับ"
                        onRemove={() =>
                          confirmRemove(row.caregiverId, row.patientId, row.name)
                        }
                      />
                    ))
                  ) : (
                    <EmptyCard
                      text={
                        isLoading
                          ? 'กำลังโหลด…'
                          : 'ยังไม่มีผู้ป่วยที่ตอบรับคำเชิญ ส่งคำเชิญได้ที่แท็บ "คำขอของฉัน"'
                      }
                    />
                  )}
                </>
              ) : null}

              {!hasPeople && !isCaregiver ? (
                <EmptyCard
                  title="ยังไม่มีใครเชื่อมโยงกับบัญชีนี้"
                  text={
                    'เมื่อมีผู้ดูแลส่งคำขอมา คำขอจะอยู่ในแท็บ "คำขอของฉัน" ให้คุณกดอนุญาตหรือปฏิเสธ ' +
                    'จนกว่าคุณจะอนุญาต จะไม่มีใครเห็นค่าความดันของคุณ'
                  }
                />
              ) : null}
            </View>
          ) : (
            <View className="pt-4">
              {pendingCount > 0 ? (
                <>
                  <SectionTitle text={`รอคุณตอบรับ · ${pendingCount} คำขอ`} />
                  {sections.invitesToAnswer.map((link) => (
                    <InviteDecisionCard
                      key={linkKey(link)}
                      link={link}
                      isResponding={pendingCaregiverId === link.caregiverId}
                      onRespond={(accept, permission) =>
                        void respond(link, accept, permission)
                      }
                    />
                  ))}
                </>
              ) : null}

              {isCaregiver ? <InviteForm /> : null}

              {sections.sentInvites.length > 0 ? (
                <LinkGroup
                  title={`คำเชิญที่ส่งแล้ว · รอตอบรับ ${sections.sentInvites.length}`}
                >
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

              {!hasRequests && !isCaregiver ? (
                <EmptyCard
                  title="ไม่มีคำขอที่ต้องตอบ"
                  text={
                    isLoading
                      ? 'กำลังโหลด…'
                      : 'เมื่อมีผู้ดูแลส่งคำขอมา จะแจ้งเตือนและแสดงที่นี่'
                  }
                />
              ) : null}
            </View>
          )}

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

function SectionTitle({ text }: { text: string }) {
  const colors = useTheme();
  const fontScale = useFontScale();

  return (
    <Text
      className="mb-2.5 ml-1 mt-2 font-semibold uppercase"
      style={{
        fontSize: Math.round(12 * fontScale),
        color: colors['text-secondary'],
        letterSpacing: 0.5,
      }}
    >
      {text}
    </Text>
  );
}

function EmptyCard({ title, text }: { title?: string; text: string }) {
  const colors = useTheme();
  const fontScale = useFontScale();

  return (
    <View
      className="mb-3 rounded-2xl border p-5"
      style={{ backgroundColor: colors.surface, borderColor: colors['border-strong'] }}
    >
      {title ? (
        <Text
          className="mb-2 font-bold"
          style={{ fontSize: Math.round(16 * fontScale), color: colors['text-primary'] }}
        >
          {title}
        </Text>
      ) : null}
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
