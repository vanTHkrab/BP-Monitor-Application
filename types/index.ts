// Type definitions for the Blood Pressure App

export interface User {
  id: string;
  name: string;
  phone: string;
  email?: string;
  avatar?: string;
  createdAt: Date;
}

export interface BloodPressureReading {
  id: string;
  userId: string;
  systolic: number;      // ค่าบน (SYS)
  diastolic: number;     // ค่าล่าง (DIA)
  pulse: number;         // ชีพจร
  measuredAt: Date;
  imageUri?: string;     // รูปถ่ายเครื่องวัด
  notes?: string;
  status: BPStatus;
}

export type BPStatus = 'low' | 'normal' | 'elevated' | 'high' | 'critical';

export interface ChartDataPoint {
  date: string;
  systolic: number;
  diastolic: number;
}

export interface CommunityPost {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  content: string;
  category: 'general' | 'experience' | 'qa';
  likes: number;
  comments: number;
  createdAt: Date;
  isLiked?: boolean;
}

export interface Comment {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: Date;
}

export type TimeFilter = '7days' | '30days' | '3months' | '1year';

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
}

export interface HealthTip {
  id: string;
  title: string;
  description: string;
  icon: string;
}
