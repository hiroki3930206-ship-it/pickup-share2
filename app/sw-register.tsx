'use client';
import { useEffect } from 'react';

export default function SWRegister() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // manifest.webmanifest と public/sw.js がある前提
      navigator.serviceWorker
        .register('/sw.js')
        .catch(() => {
          /* 失敗は無視（オフライン時など） */
        });
    }
  }, []);
  return null;
}

