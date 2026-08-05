/**
 * The bundled tips and their icon mapping, ported verbatim from
 * client-old's `data/mockData.ts` (`healthTips`) and the `TIP_ICONS` table in
 * `client-old/app/health-tips.tsx`. Copy is unchanged — this is a port, not
 * a content rewrite.
 */
import { palette, status } from '@/theme';

import type { HealthTip, HealthTipIcon } from '../types';

export const HEALTH_TIPS: readonly HealthTip[] = [
  {
    id: '1',
    title: 'ลดการบริโภคเกลือ',
    description: 'พยายามลดปริมาณเกลือในอาหารลงเพื่อช่วยควบคุมความดันโลหิต',
    icon: 'salt',
  },
  {
    id: '2',
    title: 'ออกกำลังกายสม่ำเสมอ',
    description: 'ออกกำลังกายอย่างน้อย 30 นาทีต่อวัน 5 วันต่อสัปดาห์',
    icon: 'fitness',
  },
  {
    id: '3',
    title: 'พักผ่อนให้เพียงพอ',
    description: 'นอนหลับ 7-8 ชั่วโมงต่อคืนเพื่อสุขภาพที่ดี',
    icon: 'sleep',
  },
  {
    id: '4',
    title: 'หลีกเลี่ยงความเครียด',
    description: 'ฝึกการหายใจลึกๆ หรือทำสมาธิเพื่อลดความเครียด',
    icon: 'meditation',
  },
];

/**
 * Two of these accents match a theme token exactly (`fitness` is
 * `status.normal`, `sleep` is `palette.purple`) and are written as the token
 * so a future palette change carries. The other two have no token — amber and
 * teal are not in the app's brand set — and stay as the literals client-old
 * chose. The pale `bg` chips are deliberately not mode-flipped: they sit on
 * top of the card surface in both schemes, exactly as the old screen had them.
 */
const TIP_ICONS: Record<string, HealthTipIcon> = {
  salt: { name: 'restaurant-outline', tint: '#E67E22', bg: '#FDEBD0' },
  fitness: { name: 'barbell-outline', tint: status.normal, bg: '#E8F5E9' },
  sleep: { name: 'moon-outline', tint: palette.purple, bg: '#EDE7F6' },
  meditation: { name: 'leaf-outline', tint: '#16A085', bg: '#E0F2F1' },
};

const FALLBACK_ICON: HealthTipIcon = {
  name: 'sparkles-outline',
  tint: palette.blue,
  bg: '#EBF5FB',
};

/**
 * Takes a plain `string`, not `HealthTipIconKey`, so the fallback stays
 * reachable. `HEALTH_TIPS` is typed and can never miss, but the point of the
 * fallback is the case the type system cannot see: a tip whose key arrives
 * from somewhere else, or one added to the list without a matching entry
 * here. Rendering a generic sparkle beats rendering an empty chip.
 */
export function resolveTipIcon(icon: string): HealthTipIcon {
  return TIP_ICONS[icon] ?? FALLBACK_ICON;
}
