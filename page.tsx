'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';

/* ====== 定数・型 ====== */
const DAYS = ['月', '火', '水', '木', '金'] as const;
type DayKey = typeof DAYS[number];
type CellValue = 'A' | 'B' | 'C' | 'D' | '-';

type DaySlots = {
  morning: CellValue;
  evening: CellValue;
  morningNote?: string;
  eveningNote?: string;
};
type Schedule = Record<DayKey, DaySlots>;

const MEMBERS: Record<CellValue, { label: string; color: string }> = {
  '-': { label: '未定', color: 'bg-gray-100 text-gray-600' },
  A: { label: '美香', color: 'bg-red-100 text-red-800' },
  B: { label: '宏樹', color: 'bg-blue-100 text-blue-800' },
  C: { label: '祖母', color: 'bg-purple-100 text-purple-800' },
  D: { label: '祖父', color: 'bg-green-100 text-green-800' },
};

const defaultSchedule = (): Schedule => ({
  月: { morning: '-', evening: '-' },
  火: { morning: '-', evening: '-' },
  水: { morning: '-', evening: '-' },
  木: { morning: '-', evening: '-' },
  金: { morning: '-', evening: '-' },
});

/* ====== 日付ユーティリティ ====== */
const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));
const formatYMD = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toJPShort = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
const toJPShortSafe = (d?: Date) => (d ? toJPShort(d) : '--/--');

function getMonday(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}
function mondayFromYMD(ymd: string): Date {
  const [y, m, dd] = ymd.split('-').map((s) => parseInt(s, 10));
  return getMonday(new Date(y, m - 1, dd));
}
function getWeekDays(monday: Date): Date[] {
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/* ====== Undo ミニ履歴 ====== */
function useHistory<T>(initial: T) {
  const [stack, setStack] = useState<T[]>([initial]);
  const [index, setIndex] = useState(0);
  const value = stack[index];
  const set = (next: T) => {
    const head = stack.slice(0, index + 1);
    setStack([...head, next]);
    setIndex(index + 1);
  };
  const canUndo = index > 0;
  const canRedo = index < stack.length - 1;
  const undo = () => canUndo && setIndex(index - 1);
  const redo = () => canRedo && setIndex(index + 1);
  const reset = (v: T) => {
    setStack([v]);
    setIndex(0);
  };
  return { value, set, undo, redo, canUndo, canRedo, reset };
}

/* ====== Firestore の設定 ====== */
/** 夫婦用の固定ルームID：両方の端末で同じ値にしてください */
const ROOM_ID = 'family';

/** 週のドキュメントIDを生成（ルームID_YYYY-MM-DD） */
const docIdOf = (weekStart: string) => `${ROOM_ID}_${weekStart}`;

/* ====== メインコンポーネント ====== */
export default function Page() {
  // Hydration対策：マウント後に週開始日を決める
  const [mounted, setMounted] = useState(false);
  const [weekStart, setWeekStart] = useState<string | null>(null);

  // スケジュール（Undo対応）
  const history = useHistory<Schedule>(defaultSchedule());
  const schedule = history.value;

  // Firestore購読の解除用
  const unsubscribeRef = useRef<() => void>();

  // Firestoreのスナップショット反映中フラグ（書き込みループ防止）
  const applyingRemoteRef = useRef(false);

  // ローカル変更の保存をデバウンス
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  // 初期週（今週の月曜）を決定 & その週の購読を開始
  useEffect(() => {
    if (!mounted) return;
    const wsToday = formatYMD(getMonday(new Date()));
    setWeekStart(wsToday);
  }, [mounted]);

  // 週が決まったら Firestore を購読
  useEffect(() => {
    if (!mounted || !weekStart) return;

    // 既存の購読を解除
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = undefined;
    }

    const ref = doc(db, 'schedules', docIdOf(weekStart));

    // ドキュメントが無ければ初期値を作成（初回のみ）
    (async () => {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, defaultSchedule());
      }
    })().catch(() => {});

    // リアルタイム購読
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as Schedule;

      // 受信データを適用中は保存を発火しない
      applyingRemoteRef.current = true;
      history.reset(data);
      // 次のタスクで解除（State反映後）
      setTimeout(() => (applyingRemoteRef.current = false), 0);
    });

    unsubscribeRef.current = unsub;

    // クリーンアップ
    return () => {
      unsub();
      unsubscribeRef.current = undefined;
    };
  }, [mounted, weekStart]); // 週が変わるたび購読し直す

  // ローカルの変更をFirestoreへ保存（デバウンス & 受信中は無効）
  useEffect(() => {
    if (!mounted || !weekStart) return;
    if (applyingRemoteRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await setDoc(doc(db, 'schedules', docIdOf(weekStart)), schedule);
      } catch {
        // 書き込み失敗は無視（次の変更で再度試行）
      }
    }, 350); // 0.35秒デバウンス
  }, [mounted, weekStart, schedule]);

  /* ====== UI 操作 ====== */
  const changeWeek = (baseYMD: string, deltaDays: number) => {
    const base = mondayFromYMD(baseYMD);
    base.setDate(base.getDate() + deltaDays);
    const ws = formatYMD(getMonday(base));
    setWeekStart(ws);
  };
  const prevWeek = () => weekStart && changeWeek(weekStart, -7);
  const nextWeek = () => weekStart && changeWeek(weekStart, +7);
  const onPickDate = (v: string) => {
    if (!v) return;
    const ws = formatYMD(getMonday(new Date(v)));
    setWeekStart(ws);
  };

  const setCell = (day: DayKey, slot: 'morning' | 'evening', v: CellValue) => {
    history.set({ ...schedule, [day]: { ...schedule[day], [slot]: v } });
  };
  const setNote = (day: DayKey, slot: 'morning' | 'evening', note: string) => {
    const key = slot === 'morning' ? 'morningNote' : 'eveningNote';
    history.set({ ...schedule, [day]: { ...schedule[day], [key]: note } as DaySlots });
  };

  const weekDates = useMemo(
    () => (weekStart ? getWeekDays(mondayFromYMD(weekStart)) : []),
    [weekStart]
  );

  const totals = useMemo(() => {
    const counts: Record<CellValue, number> = { A: 0, B: 0, C: 0, D: 0, '-': 0 };
    for (const d of DAYS) {
      counts[schedule[d].morning] = (counts[schedule[d].morning] || 0) + 1;
      counts[schedule[d].evening] = (counts[schedule[d].evening] || 0) + 1;
    }
    return counts;
  }, [schedule]);

  const cellSelect = (day: DayKey, slot: 'morning' | 'evening', value: CellValue) => (
    <select
      className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      value={value}
      onChange={(e) => setCell(day, slot, e.target.value as CellValue)}
    >
      {Object.entries(MEMBERS).map(([key, info]) => (
        <option key={key} value={key}>
          {info.label}
        </option>
      ))}
    </select>
  );

  const exportCSV = () => {
    const rows: string[][] = [];
    rows.push(['', ...DAYS.map((_, i) => `${DAYS[i]}(${toJPShortSafe(weekDates[i])})`)]);
    const toLabel = (v: CellValue) => MEMBERS[v].label;
    rows.push(['朝(送り)', ...DAYS.map((d) => toLabel(schedule[d].morning))]);
    rows.push(['朝メモ', ...DAYS.map((d) => schedule[d].morningNote ?? '')]);
    rows.push(['夕(迎え)', ...DAYS.map((d) => toLabel(schedule[d].evening))]);
    rows.push(['夕メモ', ...DAYS.map((d) => schedule[d].eveningNote ?? '')]);
    const csv = rows
      .map((r) =>
        r.map((c) => (c.includes(',') || c.includes('\n') ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')
      )
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `送り迎え分担_${weekStart ?? '週'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /* ====== ローディング（Hydration回避） ====== */
  if (!mounted || !weekStart) {
    return (
      <div className="min-h-screen w-full bg-gray-50 p-6">
        <div className="mx-auto max-w-md text-center text-sm text-gray-500">読み込み中…</div>
      </div>
    );
  }

  const mondayLabel = weekDates.length ? toJPShortSafe(weekDates[0]) : '';
  const fridayLabel = weekDates.length ? toJPShortSafe(weekDates[4]) : '';

  /* ====== 画面 ====== */
  return (
    <div className="min-h-screen w-full bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* ヘッダー */}
        <header className="sticky top-0 z-30 -mx-4 mb-2 bg-gray-50/80 px-4 py-3 backdrop-blur sm:mx-0 sm:bg-transparent sm:px-0 sm:py-0 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">送り・迎え 分担表（同期版）</h1>
            <p className="text-xs sm:text-sm text-gray-600">ROOM: <code className="rounded bg-gray-100 px-1 py-0.5">{ROOM_ID}</code></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => history.undo()} disabled={!history.canUndo} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">戻す</button>
            <button onClick={() => history.redo()} disabled={!history.canRedo} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">進む</button>
            <button onClick={() => setWeekStart(formatYMD(getMonday(new Date())))} className="rounded-lg border px-3 py-2 text-sm">今週へ</button>
          </div>
        </header>

        {/* 週の指定 */}
        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="mb-3 text-lg font-semibold">週の指定</h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <button onClick={prevWeek} className="rounded-lg border px-3 py-2 text-sm">前の週</button>
              <button onClick={nextWeek} className="rounded-lg border px-3 py-2 text-sm">次の週</button>
            </div>
            <div className="sm:ml-auto flex items-center gap-2">
              <label className="text-sm text-gray-700">週の開始日（月曜）</label>
              <input
                type="date"
                value={weekStart}
                onChange={(e) => onPickDate(e.target.value)}
                className="rounded-lg border border-gray-300 p-2 text-sm"
              />
            </div>
          </div>
          <p className="mt-2 text-sm text-gray-600">
            表示範囲：<span className="font-medium">{mondayLabel}</span> 〜 <span className="font-medium">{fridayLabel}</span>
          </p>
        </section>

        {/* モバイル：カード */}
        <section className="sm:hidden space-y-3">
          {DAYS.map((d, idx) => (
            <div key={d} className="rounded-2xl bg-white p-4 shadow">
              <div className="mb-3 flex items-baseline justify-between">
                <div className="text-base font-semibold">
                  {d}
                  <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                    {toJPShortSafe(weekDates[idx])}
                  </span>
                </div>
              </div>
              {/* 朝 */}
              <div className="grid grid-cols-[92px_1fr] items-center gap-2">
                <div className="text-sm text-gray-600">朝(送り)</div>
                {cellSelect(d as DayKey, 'morning', schedule[d as DayKey].morning)}
              </div>
              <div className="mt-2 grid grid-cols-[92px_1fr] items-start gap-2">
                <div />
                <textarea
                  rows={2}
                  value={schedule[d as DayKey].morningNote ?? ''}
                  onChange={(e) => setNote(d as DayKey, 'morning', e.target.value)}
                  placeholder="メモ（例：9時に早出、兄を先に）"
                  className="w-full rounded-lg border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {/* 夕 */}
              <div className="mt-3 grid grid-cols-[92px_1fr] items-center gap-2">
                <div className="text-sm text-gray-600">夕(迎え)</div>
                {cellSelect(d as DayKey, 'evening', schedule[d as DayKey].evening)}
              </div>
              <div className="mt-2 grid grid-cols-[92px_1fr] items-start gap-2">
                <div />
                <textarea
                  rows={2}
                  value={schedule[d as DayKey].eveningNote ?? ''}
                  onChange={(e) => setNote(d as DayKey, 'evening', e.target.value)}
                  placeholder="メモ（例：延長保育、祖母が先に到着）"
                  className="w-full rounded-lg border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          ))}
        </section>

        {/* デスクトップ：テーブル */}
        <section className="hidden sm:block rounded-xl bg-white p-4 shadow">
          <h2 className="mb-4 text-lg font-semibold">分担表</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] table-fixed border">
              <thead>
                <tr>
                  <th className="w-32 bg-gray-100 p-3 text-left text-sm font-semibold">時間帯</th>
                  {DAYS.map((d, idx) => (
                    <th key={d} className="p-3 text-left text-sm font-semibold">
                      {d}
                      <span className="ml-1 text-gray-500">({toJPShortSafe(weekDates[idx])})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(['morning','evening'] as const).map((slot) => (
                  <tr key={slot} className="odd:bg-white even:bg-gray-50 align-top">
                    <td className="bg-gray-100 p-3 text-sm">{slot === 'morning' ? '朝(送り)' : '夕(迎え)'}</td>
                    {DAYS.map((d) => {
                      const v = schedule[d][slot];
                      const noteKey = slot === 'morning' ? 'morningNote' : 'eveningNote';
                      const noteVal = (schedule[d] as any)[noteKey] ?? '';
                      return (
                        <td key={`${d}-${slot}`} className="p-2">
                          <div>{cellSelect(d, slot, v)}</div>
                          <div className="mt-1">
                            <span className={`inline-block rounded-lg px-2 py-1 text-xs font-medium ${MEMBERS[v].color}`}>
                              {MEMBERS[v].label}
                            </span>
                          </div>
                          <textarea
                            rows={2}
                            value={noteVal}
                            onChange={(e) => setNote(d, slot, e.target.value)}
                            placeholder={slot === 'morning' ? 'メモ（例：9時に早出）' : 'メモ（例：延長保育あり）'}
                            className="mt-2 w-full rounded-lg border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 合計（モバイル固定バー） */}
        <div className="sm:hidden sticky bottom-3 z-20 mx-auto w-full max-w-md">
          <div className="mx-4 rounded-2xl border bg-white/95 p-3 shadow-lg backdrop-blur">
            <div className="flex flex-wrap gap-2 text-sm">
              {(['A','B','C','D'] as CellValue[]).map((k) => (
                <div key={k} className={`flex-1 ${MEMBERS[k].color} rounded px-2 py-1 text-center`}>
                  {MEMBERS[k].label}: {totals[k]}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 共有・エクスポート */}
        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="mb-4 text-lg font-semibold">エクスポート</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button className="rounded-lg border px-4 py-2 text-sm" onClick={exportCSV}>
              CSVエクスポート（この週・メモ含む）
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            変更は自動でクラウドに保存・同期されます（Firestore / ROOM: {ROOM_ID}）。
          </p>
        </section>
      </div>
    </div>
  );
}
