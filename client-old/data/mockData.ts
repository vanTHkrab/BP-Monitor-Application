import { getBPStatus } from '@/constants/colors';
import { BloodPressureReading, ChartDataPoint, CommunityPost, HealthTip, User } from '@/types';

// Mock user data
export const mockUser: User = {
  id: '1',
  firstname: 'intira',
  lastname: '',
  phone: '0891234567',
  avatar: 'https://i.pravatar.cc/150?img=5',
  createdAt: new Date('2024-01-15'),
};

// Helper function to create dates
const createDate = (daysAgo: number, hour: number = 8, minute: number = 44): Date => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date;
};

// Mock blood pressure readings
export const mockReadings: BloodPressureReading[] = [
  {
    id: '1',
    userId: '1',
    systolic: 112,
    diastolic: 78,
    pulse: 80,
    measuredAt: createDate(0),
    status: getBPStatus(112, 78),
  },
  {
    id: '2',
    userId: '1',
    systolic: 108,
    diastolic: 58,
    pulse: 110,
    measuredAt: createDate(1),
    status: getBPStatus(108, 58),
  },
  {
    id: '3',
    userId: '1',
    systolic: 158,
    diastolic: 98,
    pulse: 80,
    measuredAt: createDate(2),
    status: getBPStatus(158, 98),
  },
  {
    id: '4',
    userId: '1',
    systolic: 67,
    diastolic: 48,
    pulse: 80,
    measuredAt: createDate(3),
    status: getBPStatus(67, 48),
  },
  {
    id: '5',
    userId: '1',
    systolic: 190,
    diastolic: 108,
    pulse: 146,
    measuredAt: createDate(4),
    status: getBPStatus(190, 108),
  },
  {
    id: '6',
    userId: '1',
    systolic: 125,
    diastolic: 82,
    pulse: 75,
    measuredAt: createDate(5),
    status: getBPStatus(125, 82),
  },
  {
    id: '7',
    userId: '1',
    systolic: 118,
    diastolic: 76,
    pulse: 72,
    measuredAt: createDate(7),
    status: getBPStatus(118, 76),
  },
  {
    id: '8',
    userId: '1',
    systolic: 132,
    diastolic: 84,
    pulse: 78,
    measuredAt: createDate(10),
    status: getBPStatus(132, 84),
  },
  {
    id: '9',
    userId: '1',
    systolic: 115,
    diastolic: 75,
    pulse: 70,
    measuredAt: createDate(14),
    status: getBPStatus(115, 75),
  },
  {
    id: '10',
    userId: '1',
    systolic: 122,
    diastolic: 80,
    pulse: 74,
    measuredAt: createDate(21),
    status: getBPStatus(122, 80),
  },
];

// Mock chart data for the line chart
export const mockChartData: ChartDataPoint[] = [
  { date: '1 Jun', systolic: 95, diastolic: 65 },
  { date: '3 Jun', systolic: 98, diastolic: 70 },
  { date: '16 Jun', systolic: 105, diastolic: 75 },
  { date: '10 Jun', systolic: 100, diastolic: 72 },
  { date: '17 Jun', systolic: 132, diastolic: 84 },
  { date: '25 Jun', systolic: 115, diastolic: 78 },
];

// Mock community posts
export const mockPosts: CommunityPost[] = [
  {
    id: '1',
    userId: '2',
    userName: 'ครัวคุณภู',
    content: 'แคล็ดไม่ลับสุดวิเศษเพียงแค่อ่าน สามารถเพิ่มกล้ามเป็น Jiren ได้ สามารถเริ่มได้โดยเข้ายิมในเวลา 4 - 5 วัน และ...',
    category: 'general',
    likes: 12,
    comments: 5,
    createdAt: new Date(Date.now() - 60000), // 1 minute ago
    isLiked: false,
  },
  {
    id: '2',
    userId: '3',
    userName: 'ครัวคุณภู',
    content: 'แคล็ดไม่ลับสุดวิเศษเพียงแค่อ่าน สามารถเพิ่มกล้ามเป็น Jiren ได้ สามารถเริ่มได้โดยเข้ายิมในเวลา 4 - 5 วัน และ...',
    category: 'general',
    likes: 12,
    comments: 5,
    createdAt: new Date(Date.now() - 60000),
    isLiked: false,
  },
  {
    id: '3',
    userId: '4',
    userName: 'ครัวคุณภู',
    content: 'แคล็ดไม่ลับสุดวิเศษเพียงแค่อ่าน สามารถเพิ่มกล้ามเป็น Jiren ได้ สามารถเริ่มได้โดยเข้ายิมในเวลา 4 - 5 วัน และ...',
    category: 'experience',
    likes: 12,
    comments: 5,
    createdAt: new Date(Date.now() - 60000),
    isLiked: false,
  },
];

// Health tips
export const healthTips: HealthTip[] = [
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

// Format date helper
export const formatThaiDate = (date: Date): string => {
  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];
  
  const thaiDays = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  
  const day = date.getDate();
  const month = thaiMonths[date.getMonth()];
  const year = date.getFullYear() + 543; // Buddhist year
  const dayName = thaiDays[date.getDay()];
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  
  return `${dayName} ${day} ${month} ${year} เวลา ${hours}:${minutes}`;
};

export const formatShortDate = (date: Date): string => {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear() + 543;
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  
  return `${day}/${month}/${year} เวลา ${hours}.${minutes}`;
};

export const getRelativeTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return 'เมื่อสักครู่';
  if (diffMins < 60) return `${diffMins} นาทีที่แล้ว`;
  if (diffHours < 24) return `${diffHours} ชั่วโมงที่แล้ว`;
  if (diffDays === 0) return 'วันนี้';
  if (diffDays === 1) return 'เมื่อวาน';
  return formatShortDate(date);
};
