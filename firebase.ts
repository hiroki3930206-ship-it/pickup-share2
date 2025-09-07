// lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// コンソールで表示されている設定をここに貼り付ける
const firebaseConfig = {
  apiKey: "AIzaSyCq0eE4W8vUd2PatMNSrhcIySiRxL8k",   // ← あなたの値
  authDomain: "admin-78a98.firebaseapp.com",        // ← あなたの値
  projectId: "admin-78a98",                         // ← あなたの値
  storageBucket: "admin-78a98.firebasestorage.app", // ← あなたの値
  messagingSenderId: "800665808101",                // ← あなたの値
  appId: "1:800665808101:web:088c3d07429f214f08377c"// ← あなたの値
};

// Firebase アプリを初期化
const app = initializeApp(firebaseConfig);

// Firestore のインスタンスをエクスポート
export const db = getFirestore(app);
