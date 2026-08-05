/**
 * "Invite a patient" — phone, relationship, send.
 *
 * Two things it does that client-old's version did not. The phone field
 * formats as you type and is stripped back to digits before it is sent, so
 * "081-234-5678" and "0812345678" both find the same person instead of one of
 * them reporting "ไม่พบผู้ใช้". And the outcome is an inline banner rather
 * than an `Alert` — per the project convention that forms surface errors
 * where the input is, not in a dialog that dismisses the context.
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
import { formatThaiPhone, stripPhoneDigits } from '@/utils/phone-format';

import { useInvitePatient } from '../hooks/use-caregivers';
import { DEFAULT_RELATIONSHIP } from '../lib/relationship';
import type { RelationshipType } from '../types';
import { RelationshipPicker } from './relationship-picker';

/** Thai numbers are 9 digits without the trunk "0", 10 with it. */
const MIN_PHONE_DIGITS = 9;

export function InviteForm() {
  const colors = useTheme();
  const { invitePatient, isPending } = useInvitePatient();

  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState<RelationshipType>(DEFAULT_RELATIONSHIP);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const submit = async () => {
    const digits = stripPhoneDigits(phone);
    setBanner(null);

    if (digits.length < MIN_PHONE_DIGITS) {
      setFieldError('กรุณากรอกเบอร์โทรศัพท์ของผู้ป่วยให้ครบ');
      return;
    }

    setFieldError(undefined);

    try {
      const link = await invitePatient({ patientPhone: digits, relationship });
      setPhone('');
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
            กรอกเบอร์โทรศัพท์ที่ผู้ป่วยใช้สมัคร ระบบจะส่งคำเชิญไปให้ตอบรับก่อน
          </ThemedText>
        </View>
      </View>

      <TextField
        testID="invite-phone"
        placeholder="เบอร์โทรศัพท์ผู้ป่วย"
        value={phone}
        onChangeText={(text) => {
          setPhone(formatThaiPhone(text));
          if (fieldError) setFieldError(undefined);
        }}
        icon="call-outline"
        keyboardType="phone-pad"
        autoComplete="tel"
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
          type="small"
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
