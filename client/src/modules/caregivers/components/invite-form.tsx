/**
 * "Invite a patient" — phone *or* email, relationship, send.
 *
 * One field, no mode toggle: `addCaregiverPatient` takes a single polymorphic
 * `patientContact` and splits on "@" server-side, so the caregiver is never
 * asked to classify what they typed. The component still branches on "@", but
 * only to decide whether to touch the text — the phone path formats as you
 * type and strips to digits, and both destroy an address. That rule lives in
 * `lib/contact.ts` so the API layer and this form cannot disagree.
 *
 * The outcome is an inline banner rather than an `Alert` — per the project
 * convention that forms surface errors where the input is, not in a dialog
 * that dismisses the context. Server messages are rendered verbatim through
 * `formatErrorMessage`, which is what lets the gateway say
 * "ไม่พบผู้ใช้จากอีเมลนี้" vs "ไม่พบผู้ใช้จากเบอร์โทรศัพท์นี้" and name back
 * the kind that was actually sent. Mapping the error code to fixed local copy
 * here would guess, and guess wrong half the time.
 *
 * The success copy names the wait explicitly. An invite that succeeds still
 * shows the caregiver nothing about the patient until the patient agrees, and
 * a "สำเร็จ" with no explanation reads as a bug ten seconds later.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { View } from 'react-native';

import { formatErrorMessage } from '@/lib/error-message';
import { ThemedText } from '@/components/themed-text';
import { GradientButton } from '@/components/ui/gradient-button';
import { TextField } from '@/components/ui/text-field';
import { useTheme } from '@/hooks/use-theme';
import { status as statusColor } from '@/theme';

import { useInvitePatient } from '../hooks/use-caregivers';
import { contactError, isEmailContact, nextContactValue } from '../lib/contact';
import { DEFAULT_RELATIONSHIP } from '../lib/relationship';
import type { RelationshipType } from '../types';
import { RelationshipPicker } from './relationship-picker';

export function InviteForm() {
  const colors = useTheme();
  const { invitePatient, isPending } = useInvitePatient();

  const [contact, setContact] = useState('');
  const [relationship, setRelationship] = useState<RelationshipType>(DEFAULT_RELATIONSHIP);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const looksLikeEmail = isEmailContact(contact);

  const submit = async () => {
    setBanner(null);

    const invalid = contactError(contact);
    if (invalid) {
      setFieldError(invalid);
      return;
    }

    setFieldError(undefined);

    try {
      const link = await invitePatient({ patientContact: contact, relationship });
      setContact('');
      setRelationship(DEFAULT_RELATIONSHIP);
      setBanner({
        tone: 'ok',
        text: `ส่งคำเชิญถึงคุณ${link.patientName} แล้ว จะเห็นข้อมูลได้เมื่อผู้ป่วยกดอนุญาต`,
      });
    } catch (error) {
      setBanner({
        tone: 'error',
        text: formatErrorMessage(error, 'ส่งคำเชิญไม่สำเร็จ กรุณาลองใหม่'),
      });
    }
  };

  return (
    <View className="mt-6 rounded-2xl p-4" style={{ backgroundColor: colors.surface }}>
      <View className="mb-4 flex-row items-start">
        <View
          className="mr-3 h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: colors['surface-muted'] }}
        >
          <Ionicons name="person-add-outline" size={22} color={colors.primary} />
        </View>

        <View className="flex-1">
          <ThemedText type="bodyLarge" weight="bold">
            เชิญผู้ป่วยที่ดูแล
          </ThemedText>
          <ThemedText
            type="label"
            weight="regular"
            themeColor="text-secondary"
            className="mt-1"
          >
            กรอกเบอร์โทรศัพท์หรืออีเมลที่ผู้ป่วยใช้สมัคร ระบบจะส่งคำเชิญไปให้ตอบรับก่อน
          </ThemedText>
        </View>
      </View>

      {/*
       * `keyboardType` is "default" on purpose, and it is a compromise.
       * "phone-pad" has no "@" key at all, so in a single-field design it
       * makes an email literally untypeable — and that also rules out
       * switching dynamically, because the switch could never be triggered
       * from the keyboard the user would be stuck on. That leaves a static
       * choice between "default" and "email-address"; "default" wins because
       * the two are the same for phone entry (digits are one layer away in
       * both) and "email-address" would signal "email only" for what is
       * mostly a phone field. The cost is one extra tap for the numeric
       * layer versus the old phone-pad. If that turns out to hurt, the fix is
       * a bigger design change (two entry points), not a keyboardType flip.
       *
       * `autoComplete` *does* switch, because it only feeds the autofill
       * hint — no keyboard is remounted mid-typing, which is the Android
       * hazard that rules the switch out for `keyboardType`. It reads "tel"
       * while the field is empty (the common case) and flips once the user
       * has typed the "@" themselves.
       *
       * `autoCapitalize`/`autoCorrect` are pinned off: iOS otherwise
       * capitalises the first letter of an address and autocorrects the
       * domain, which was harmless while this field was digits-only.
       */}
      <TextField
        testID="invite-contact"
        placeholder="เบอร์โทรศัพท์หรืออีเมลผู้ป่วย"
        value={contact}
        onChangeText={(text) => {
          setContact((prev) => nextContactValue(prev, text));
          if (fieldError) setFieldError(undefined);
        }}
        icon="person-outline"
        keyboardType="default"
        autoComplete={looksLikeEmail ? 'email' : 'tel'}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isPending}
        error={fieldError}
      />

      <RelationshipPicker
        label="คุณเป็นอะไรกับผู้ป่วย"
        value={relationship}
        onChange={setRelationship}
        disabled={isPending}
      />

      <GradientButton
        testID="invite-submit"
        title="ส่งคำเชิญ"
        onPress={() => void submit()}
        loading={isPending}
      />

      {banner ? (
        <ThemedText
          type="body"
          weight="regular"
          className="mt-3 px-1"
          accessibilityLiveRegion="polite"
          // `status.normal` is a BP-severity colour and `danger` is a token —
          // neither is reachable through `themeColor`'s semantic set here.
          style={{ color: banner.tone === 'ok' ? statusColor.normal : colors.danger }}
        >
          {banner.text}
        </ThemedText>
      ) : null}
    </View>
  );
}
