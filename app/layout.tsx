import type { Metadata } from 'next';
import './globals.css';
import SWRegister from './sw-register'; // ← 追加

export const metadata: Metadata = {
  title: '送り・迎え 分担表（同期版）',
  description: 'Firestore 同期・PWA対応',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#ffffff" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className="antialiased">
        <SWRegister /> {/* ← 追加：クライアントでSW登録 */}
        {children}
      </body>
    </html>
  );
}

