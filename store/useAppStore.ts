import { getBPStatus } from '@/constants/colors';
import { auth, db } from '@/constants/firebase';
import { BloodPressureReading, CommunityPost, User } from '@/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import {
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    updateProfile,
} from 'firebase/auth';
import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    DocumentData,
    getDoc,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    Timestamp,
    updateDoc,
} from 'firebase/firestore';
import { create } from 'zustand';

interface AppState {
  // Auth
  isAuthenticated: boolean;
  user: User | null;
  authInitialized: boolean;
  authErrorCode: string | null;
  authErrorMessage: string | null;
  authErrorRawMessage: string | null;
  
  // Blood Pressure
  readings: BloodPressureReading[];
  
  // Community
  posts: CommunityPost[];

  // Theme
  themePreference: 'light' | 'dark';
  themeHydrated: boolean;
  
  // Actions
  login: (phone: string, password: string) => Promise<boolean>;
  register: (name: string, phone: string, password: string, avatarUri?: string | null) => Promise<boolean>;
  logout: () => void;
  clearAuthError: () => void;

  updateMyProfile: (input: { name?: string; phone?: string }) => Promise<boolean>;

  uploadMyAvatar: (avatarUri: string) => Promise<boolean>;

  createReading: (input: {
    systolic: number;
    diastolic: number;
    pulse: number;
    measuredAt?: Date;
    imageUri?: string;
    notes?: string;
  }) => Promise<boolean>;

  deleteReading: (id: string) => Promise<void>;
  
  toggleLike: (postId: string) => Promise<void>;

  createPost: (input: { content: string; category: CommunityPost['category'] }) => Promise<boolean>;

  updatePost: (input: { postId: string; content: string; category: CommunityPost['category'] }) => Promise<boolean>;

  deletePost: (postId: string) => Promise<boolean>;

  hydrateTheme: () => Promise<void>;
  setThemePreference: (pref: 'light' | 'dark') => Promise<void>;
}

const THEME_STORAGE_KEY = 'bp:theme-preference';

const normalizePhone = (value: string) => value.replace(/\D/g, '');

const phoneToEmail = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  const digits = normalizePhone(trimmed);
  return `${digits || 'user'}@bp.local`;
};

const authErrorToThai = (code?: string): string => {
  switch (code) {
    case 'auth/configuration-not-found':
      return 'Firebase Auth ยังไม่ได้ตั้งค่า/เปิดใช้งานสำหรับโปรเจกต์นี้ (ไปที่ Firebase Console → Authentication → Get started และเปิด Email/Password)';
    case 'auth/email-already-in-use':
      return 'เบอร์/อีเมลนี้ถูกใช้งานแล้ว';
    case 'auth/missing-email':
      return 'กรุณากรอกอีเมล/เบอร์โทรศัพท์';
    case 'auth/invalid-email':
      return 'รูปแบบอีเมลไม่ถูกต้อง';
    case 'auth/weak-password':
      return 'รหัสผ่านอ่อนเกินไป (อย่างน้อย 6 ตัวอักษร)';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
    case 'auth/network-request-failed':
      return 'เครือข่ายมีปัญหา กรุณาลองใหม่';
    case 'auth/operation-not-allowed':
      return 'ยังไม่ได้เปิดใช้งานผู้ให้บริการเข้าสู่ระบบ (Email/Password) ใน Firebase Console';
    case 'auth/too-many-requests':
      return 'ถูกจำกัดการลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่';
    case 'auth/invalid-api-key':
      return 'Firebase API key ไม่ถูกต้อง/ตั้งค่าไม่ครบ';
    case 'auth/app-not-authorized':
      return 'แอปนี้ยังไม่ได้รับอนุญาต (ตรวจสอบ Bundle ID/Package name ใน Firebase Console)';
    case 'auth/unauthorized-domain':
      return 'โดเมน/แอปยังไม่ได้รับอนุญาตใน Firebase';
    default:
      return 'เกิดข้อผิดพลาด กรุณาลองใหม่';
  }
};

const extractFirebaseAuthError = (error: any): { code: string | null; rawMessage: string | null } => {
  const code = typeof error?.code === 'string' ? error.code : null;
  const rawMessage =
    typeof error?.message === 'string'
      ? error.message
      : error
        ? JSON.stringify(error)
        : null;
  return { code, rawMessage };
};

const stringifyErrorSafe = (error: any): string => {
  if (!error) return '';
  try {
    const props = Array.from(new Set([...Object.getOwnPropertyNames(error), ...Object.keys(error)]));
    return JSON.stringify(error, props);
  } catch {
    try {
      return String(error);
    } catch {
      return '[unstringifiable error]';
    }
  }
};

const isRemoteUrl = (uri: string) => /^https?:\/\//i.test(uri);
const isDataUrl = (uri: string) => /^data:/i.test(uri);

const getDataUrlContentType = (dataUrl: string): string => {
  const match = dataUrl.match(/^data:([^;]+);base64,/i);
  return match?.[1] || 'image/jpeg';
};

const ensureDirAsync = async (dirUri: string) => {
  try {
    await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true } as any);
  } catch {
    // ignore (already exists)
  }
};

const getAppDocumentDir = (): string | null => {
  return ((FileSystem as any).documentDirectory as string | undefined) ?? null;
};

const saveAvatarToAppStorage = async (uid: string, inputUri: string): Promise<string> => {
  if (!inputUri) return inputUri;
  if (isRemoteUrl(inputUri)) return inputUri;

  const baseDir = getAppDocumentDir();
  if (!baseDir) {
    // Fallback: keep original uri (still works in-session, may not persist forever)
    return inputUri;
  }

  const avatarDir = `${baseDir}avatars/`;
  await ensureDirAsync(avatarDir);

  const contentType = isDataUrl(inputUri) ? getDataUrlContentType(inputUri) : 'image/jpeg';
  const ext =
    contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : contentType.includes('heic') ? 'heic' : 'jpg';

  const fileUri = `${avatarDir}${uid}_${Date.now()}.${ext}`;

  if (isDataUrl(inputUri)) {
    const match = inputUri.match(/^data:[^;]+;base64,(.*)$/i);
    const base64 = match?.[1] || '';
    await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: 'base64' as any });
    return fileUri;
  }

  // Best-effort copy for file:// URIs
  try {
    await FileSystem.copyAsync({ from: inputUri, to: fileUri } as any);
    return fileUri;
  } catch {
    return inputUri;
  }
};



const userFromFirestore = (uid: string, data: DocumentData | undefined): User => {
  const createdAt = data?.createdAt;
  return {
    id: uid,
    name: (data?.name as string) || 'ผู้ใช้',
    phone: (data?.phone as string) || '',
    email: data?.email as string | undefined,
    avatar: data?.avatar as string | undefined,
    createdAt:
      createdAt instanceof Timestamp
        ? createdAt.toDate()
        : createdAt instanceof Date
          ? createdAt
          : new Date(),
  };
};

const readingFromFirestore = (uid: string, id: string, data: DocumentData): BloodPressureReading => {
  const measuredAtRaw = data.measuredAt;
  const measuredAt =
    measuredAtRaw instanceof Timestamp
      ? measuredAtRaw.toDate()
      : measuredAtRaw instanceof Date
        ? measuredAtRaw
        : new Date();

  return {
    id,
    userId: uid,
    systolic: Number(data.systolic ?? 0),
    diastolic: Number(data.diastolic ?? 0),
    pulse: Number(data.pulse ?? 0),
    measuredAt,
    imageUri: data.imageUri as string | undefined,
    notes: data.notes as string | undefined,
    status: (data.status as BloodPressureReading['status']) || getBPStatus(Number(data.systolic ?? 0), Number(data.diastolic ?? 0)),
  };
};

const postFromFirestore = (currentUid: string | null, id: string, data: DocumentData): CommunityPost => {
  const createdAtRaw = data.createdAt;
  const createdAt =
    createdAtRaw instanceof Timestamp
      ? createdAtRaw.toDate()
      : createdAtRaw instanceof Date
        ? createdAtRaw
        : new Date();

  const likedBy = Array.isArray(data.likedBy) ? (data.likedBy as string[]) : [];
  return {
    id,
    userId: String(data.userId ?? ''),
    userName: String(data.userName ?? 'ผู้ใช้'),
    userAvatar: (data.userAvatar as string | undefined) ?? undefined,
    content: String(data.content ?? ''),
    category: (data.category as CommunityPost['category']) || 'general',
    likes: likedBy.length,
    comments: Number(data.comments ?? 0),
    createdAt,
    isLiked: currentUid ? likedBy.includes(currentUid) : false,
  };
};

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  isAuthenticated: false,
  user: null,
  authInitialized: false,
  authErrorCode: null,
  authErrorMessage: null,
  authErrorRawMessage: null,
  readings: [],
  posts: [],

  themePreference: 'light',
  themeHydrated: false,
  
  // Auth actions
  login: async (phone: string, password: string) => {
    try {
      set({ authErrorCode: null, authErrorMessage: null, authErrorRawMessage: null });
      const email = phoneToEmail(phone);
      await signInWithEmailAndPassword(auth, email, password);
      return true;
    } catch (error: any) {
      const { code, rawMessage } = extractFirebaseAuthError(error);
      set({
        authErrorCode: code,
        authErrorMessage: authErrorToThai(code ?? undefined),
        authErrorRawMessage: rawMessage,
      });
      return false;
    }
  },
  
  register: async (name: string, phone: string, password: string, avatarUri?: string | null) => {
    try {
      set({ authErrorCode: null, authErrorMessage: null, authErrorRawMessage: null });

      const trimmed = phone.trim();
      if (!trimmed.includes('@')) {
        const digits = normalizePhone(trimmed);
        if (digits.length < 9) {
          set({
            authErrorCode: 'bp/invalid-phone',
            authErrorMessage: 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง',
            authErrorRawMessage: null,
          });
          return false;
        }
      }

      const email = phoneToEmail(phone);
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: name });

      await setDoc(
        doc(db, 'users', credential.user.uid),
        {
          name,
          phone: normalizePhone(phone),
          email,
          createdAt: serverTimestamp(),
          avatar: credential.user.photoURL || null,
        },
        { merge: true }
      );

      if (avatarUri && !isRemoteUrl(avatarUri)) {
        try {
          const localPath = await saveAvatarToAppStorage(credential.user.uid, avatarUri);
          await Promise.all([
            updateProfile(credential.user, { photoURL: localPath }),
            updateDoc(doc(db, 'users', credential.user.uid), {
              avatar: localPath,
              updatedAt: serverTimestamp(),
            }),
          ]);
          set((state) => ({
            user: state.user ? { ...state.user, avatar: localPath } : state.user,
          }));
        } catch (error: any) {
          const code = 'avatar/local-save-failed';
          const rawMessage = [typeof error?.message === 'string' ? error.message : null, stringifyErrorSafe(error)]
            .filter(Boolean)
            .join('\n');
          console.error('Avatar local save failed:', code, rawMessage);
          set({
            authErrorCode: code,
            authErrorMessage: 'บันทึกรูปโปรไฟล์ในเครื่องไม่สำเร็จ',
            authErrorRawMessage: rawMessage,
          });
        }
      }

      return true;
    } catch (error: any) {
      const { code, rawMessage } = extractFirebaseAuthError(error);
      set({
        authErrorCode: code,
        authErrorMessage: authErrorToThai(code ?? undefined),
        authErrorRawMessage: rawMessage,
      });
      return false;
    }
  },
  
  logout: () => {
    void signOut(auth);
  },

  clearAuthError: () => {
    set({ authErrorCode: null, authErrorMessage: null, authErrorRawMessage: null });
  },

  updateMyProfile: async (input) => {
    const currentUser = get().user;
    if (!currentUser) return false;

    const patch: Record<string, any> = {};
    if (typeof input.name === 'string' && input.name.trim()) patch.name = input.name.trim();
    if (typeof input.phone === 'string') patch.phone = normalizePhone(input.phone);
    if (Object.keys(patch).length === 0) return true;

    try {
      await updateDoc(doc(db, 'users', currentUser.id), {
        ...patch,
        updatedAt: serverTimestamp(),
      });

      if (patch.name && auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: patch.name });
      }

      set((state) => ({
        user: state.user
          ? {
              ...state.user,
              ...(patch.name ? { name: patch.name } : null),
              ...(typeof patch.phone === 'string' ? { phone: patch.phone } : null),
            }
          : state.user,
      }));
      return true;
    } catch {
      return false;
    }
  },

  uploadMyAvatar: async (avatarUri: string) => {
    const currentUser = get().user;
    if (!currentUser) return false;
    if (!avatarUri) return false;

    try {
      const url = isRemoteUrl(avatarUri) ? avatarUri : await saveAvatarToAppStorage(currentUser.id, avatarUri);
      await Promise.all([
        updateDoc(doc(db, 'users', currentUser.id), {
          avatar: url,
          updatedAt: serverTimestamp(),
        }),
        auth.currentUser ? updateProfile(auth.currentUser, { photoURL: url }) : Promise.resolve(),
      ]);

      set((state) => ({
        user: state.user ? { ...state.user, avatar: url } : state.user,
      }));
      return true;
    } catch (error: any) {
      const code = 'avatar/local-save-failed';
      const rawMessage = [typeof error?.message === 'string' ? error.message : null, stringifyErrorSafe(error)]
        .filter(Boolean)
        .join('\n');
      console.error('uploadMyAvatar failed:', code, rawMessage);
      set({
        authErrorCode: code,
        authErrorMessage: 'บันทึกรูปโปรไฟล์ในเครื่องไม่สำเร็จ',
        authErrorRawMessage: rawMessage,
      });
      return false;
    }
  },

  // Blood Pressure actions
  createReading: async (input) => {
    const currentUser = get().user;
    if (!currentUser) return false;

    const measuredAt = input.measuredAt ?? new Date();
    const systolic = Number(input.systolic);
    const diastolic = Number(input.diastolic);
    const pulse = Number(input.pulse);
    const status = getBPStatus(systolic, diastolic);

    try {
      await addDoc(collection(db, 'users', currentUser.id, 'readings'), {
        systolic,
        diastolic,
        pulse,
        status,
        measuredAt: Timestamp.fromDate(measuredAt),
        imageUri: input.imageUri ?? null,
        notes: input.notes ?? null,
        createdAt: serverTimestamp(),
      });
      return true;
    } catch {
      return false;
    }
  },

  deleteReading: async (id: string) => {
    const currentUser = get().user;
    if (!currentUser) return;
    await deleteDoc(doc(db, 'users', currentUser.id, 'readings', id));
  },

  // Community actions
  toggleLike: async (postId: string) => {
    const currentUser = get().user;
    if (!currentUser) return;

    const currentPosts = get().posts;
    const post = currentPosts.find((p) => p.id === postId);
    const currentlyLiked = Boolean(post?.isLiked);

    const postRef = doc(db, 'posts', postId);
    await updateDoc(postRef, {
      likedBy: currentlyLiked ? arrayRemove(currentUser.id) : arrayUnion(currentUser.id),
    });
  },

  createPost: async ({ content, category }) => {
    const currentUser = get().user;
    if (!currentUser) return false;

    const trimmed = content.trim();
    if (!trimmed) return false;

    try {
      await addDoc(collection(db, 'posts'), {
        userId: currentUser.id,
        userName: currentUser.name || 'ผู้ใช้',
        userAvatar: currentUser.avatar || null,
        content: trimmed,
        category,
        likedBy: [],
        comments: 0,
        createdAt: serverTimestamp(),
      });
      return true;
    } catch {
      return false;
    }
  },

  updatePost: async ({ postId, content, category }) => {
    const currentUser = get().user;
    if (!currentUser) return false;

    const trimmed = content.trim();
    if (!trimmed) return false;

    const post = get().posts.find((p) => p.id === postId);
    if (!post) return false;
    if (post.userId !== currentUser.id) return false;

    try {
      await updateDoc(doc(db, 'posts', postId), {
        content: trimmed,
        category,
        updatedAt: serverTimestamp(),
      });
      return true;
    } catch {
      return false;
    }
  },

  deletePost: async (postId: string) => {
    const currentUser = get().user;
    if (!currentUser) return false;

    const post = get().posts.find((p) => p.id === postId);
    if (!post) return false;
    if (post.userId !== currentUser.id) return false;

    try {
      await deleteDoc(doc(db, 'posts', postId));
      return true;
    } catch {
      return false;
    }
  },

  hydrateTheme: async () => {
    try {
      const raw = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      const pref = raw === 'dark' ? 'dark' : raw === 'light' ? 'light' : null;
      set({ themePreference: pref ?? 'light', themeHydrated: true });
    } catch {
      set({ themeHydrated: true });
    }
  },

  setThemePreference: async (pref) => {
    set({ themePreference: pref });
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // ignore
    }
  },
}));

// --- Realtime subscriptions (module-level singleton behavior) ---
let unsubscribeReadings: (() => void) | null = null;
let unsubscribePosts: (() => void) | null = null;

const startPostsSubscription = () => {
  if (unsubscribePosts) {
    unsubscribePosts();
    unsubscribePosts = null;
  }

  const postsQuery = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(100));
  unsubscribePosts = onSnapshot(postsQuery, (snapshot) => {
    const currentUid = useAppStore.getState().user?.id ?? null;
    const posts = snapshot.docs.map((d) => postFromFirestore(currentUid, d.id, d.data()));
    useAppStore.setState({ posts });
  });
};

startPostsSubscription();

onAuthStateChanged(auth, async (firebaseUser) => {
  // Mark auth ready the first time we get called.
  if (!useAppStore.getState().authInitialized) {
    useAppStore.setState({ authInitialized: true });
  }

  // Restart posts subscription so initial snapshot recomputes isLiked.
  startPostsSubscription();

  if (!firebaseUser) {
    if (unsubscribeReadings) {
      unsubscribeReadings();
      unsubscribeReadings = null;
    }

    useAppStore.setState({
      isAuthenticated: false,
      user: null,
      readings: [],
    });

    return;
  }

  // Load/create user profile
  const userRef = doc(db, 'users', firebaseUser.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    await setDoc(
      userRef,
      {
        name: firebaseUser.displayName || 'ผู้ใช้',
        phone: '',
        email: firebaseUser.email || null,
        avatar: firebaseUser.photoURL || null,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  const latestSnap = snap.exists() ? snap : await getDoc(userRef);
  const user = userFromFirestore(firebaseUser.uid, latestSnap.data());

  useAppStore.setState({
    isAuthenticated: true,
    user,
  });

  // Subscribe readings for this user
  if (unsubscribeReadings) {
    unsubscribeReadings();
    unsubscribeReadings = null;
  }

  const readingsQuery = query(collection(db, 'users', firebaseUser.uid, 'readings'), orderBy('measuredAt', 'desc'), limit(200));
  unsubscribeReadings = onSnapshot(readingsQuery, (snapshot) => {
    const readings = snapshot.docs.map((d) => readingFromFirestore(firebaseUser.uid, d.id, d.data()));
    useAppStore.setState({ readings });
  });
});
