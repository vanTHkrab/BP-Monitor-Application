// constants/firebase.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from "firebase/app";
import * as FirebaseAuth from 'firebase/auth';
import { getFirestore } from "firebase/firestore";
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: "AIzaSyDOCkQ2bjgQiHUPDDK2egzunNZqeW6aEEY",
  authDomain: "bpmobiletest.firebaseapp.com",
  projectId: "bpmobiletest",
  // NOTE: Firebase Storage bucket is typically <projectId>.appspot.com
  storageBucket: "bpmobiletest.appspot.com",
  messagingSenderId: "127986144546",
  appId: "1:127986144546:web:f9edde03acccd845ff417b",
  measurementId: "G-73R6VLLF2Y"
};

const app = initializeApp(firebaseConfig);

const getReactNativePersistence = (FirebaseAuth as any)
  .getReactNativePersistence as ((storage: unknown) => unknown) | undefined;

export const auth = (() => {
  if (Platform.OS === 'web') {
    return FirebaseAuth.getAuth(app);
  }

  try {
    if (!getReactNativePersistence) {
      return FirebaseAuth.getAuth(app);
    }

    return FirebaseAuth.initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage) as any,
    });
  } catch {
    // If Auth was already initialized elsewhere (fast refresh / multiple imports), fall back.
    return FirebaseAuth.getAuth(app);
  }
})();
export const db = getFirestore(app);
export const storage = getStorage(app);
