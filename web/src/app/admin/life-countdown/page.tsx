"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { readApiError } from "@/lib/api";
import type { LifeCountdownProfile, LifeCountdownWarning } from "@/types/auth";
import { Button, TextField } from "@radix-ui/themes";

type CountdownParts = {
  expired: boolean;
  totalDays: number;
  years: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

function padTime(value: number): string {
  return String(value).padStart(2, "0");
}

function formatCalendarDate(value?: string): string {
  if (!value) {
    return "--";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "--";
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calculateCountdown(deathDate?: string, nowMs?: number): CountdownParts | null {
  if (!deathDate || !nowMs) {
    return null;
  }

  const target = new Date(`${deathDate}T23:59:59`);
  if (Number.isNaN(target.getTime())) {
    return null;
  }

  const diffMs = target.getTime() - nowMs;
  if (diffMs <= 0) {
    return {
      expired: true,
      totalDays: 0,
      years: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    };
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const totalDays = Math.floor(totalSeconds / 86400);

  return {
    expired: false,
    totalDays,
    years: Math.floor(totalDays / 365),
    days: totalDays % 365,
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

function toDateInputValue(value?: string): string {
  if (!value) {
    return "";
  }
  const normalized = formatCalendarDate(value);
  return normalized === "--" ? "" : normalized;
}

export default function LifeCountdownPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const canRead = hasPermission("life_countdown.read") || hasPermission("life_countdown.manage");
  const canManage = hasPermission("life_countdown.manage");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [profile, setProfile] = useState<LifeCountdownProfile | null>(null);
  const [deathDateInput, setDeathDateInput] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timerId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  const loadProfile = useCallback(async () => {
    if (!user || !canRead) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    const response = await fetchWithAuth("/api/v1/admin/life-countdown/current");
    if (!response.ok) {
      setError(await readApiError(response));
      setLoading(false);
      return;
    }

    const payload = (await response.json()) as LifeCountdownProfile;
    setProfile(payload);
    setDeathDateInput(toDateInputValue(payload.deathDate));
    setLoading(false);
  }, [canRead, fetchWithAuth, user]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const countdown = useMemo(
    () => calculateCountdown(profile?.deathDate, nowMs),
    [profile?.deathDate, nowMs],
  );

  const handleSave = async () => {
    if (!canManage) {
      return;
    }
    if (!deathDateInput) {
      setError("请选择死亡日期");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    const response = await fetchWithAuth("/api/v1/admin/life-countdown/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deathDate: deathDateInput }),
    });

    if (!response.ok) {
      setError(await readApiError(response));
      setSaving(false);
      return;
    }

    const payload = (await response.json()) as LifeCountdownProfile;
    setProfile(payload);
    setDeathDateInput(toDateInputValue(payload.deathDate));
    setSuccess("死亡日期已保存");
    setSaving(false);
  };

  const handleGenerateWarning = async (forceRefresh: boolean) => {
    if (!canManage) {
      return;
    }
    if (!profile?.deathDate) {
      setError("请先设置死亡日期");
      return;
    }

    setGenerating(true);
    setError("");
    setSuccess("");

    const response = await fetchWithAuth("/api/v1/admin/life-countdown/generate-warning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forceRefresh }),
    });

    if (!response.ok) {
      setError(await readApiError(response));
      setGenerating(false);
      return;
    }

    const warning = (await response.json()) as LifeCountdownWarning;
    setProfile((prev) => ({
      ...(prev ?? {}),
      deathDate: prev?.deathDate,
      todayWarningText: warning.warningText,
      todayWarningDate: warning.warningDate,
      todayWarningGeneratedAt: warning.generatedAt,
      todayWarningModel: warning.modelName,
    }));

    setSuccess(warning.cached ? "已返回今日缓存警示语" : forceRefresh ? "已重新生成今日警示语" : "已生成今日警示语");
    setGenerating(false);
  };

  if (initializing || loading) {
    return <p className="text-sm text-[var(--gray-11)]">Loading life countdown...</p>;
  }

  if (!user) {
    return <div className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm text-sm text-[var(--gray-11)]">请先登录后再访问该页面。</div>;
  }

  if (!canRead) {
    return <div className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `life_countdown.read`）。</div>;
  }

  return (
    <div className="space-y-6">
      {error && <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error}</pre>}
      {success && <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--green-6)] bg-[var(--green-a2)] p-4 text-sm text-[var(--green-11)]">{success}</pre>}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">生命倒计时</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">设定你的死亡日期，看清剩余时间，并用一句话把自己拉回今天。</p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
              profile?.deathDate ? "bg-[var(--accent-a3)] text-[var(--accent-11)]" : "bg-[var(--gray-a3)] text-[var(--gray-11)]"
            }`}
          >
            {profile?.deathDate ? "已设定日期" : "未设定日期"}
          </span>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <article className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">死亡日期</h3>
              <p className="mt-1 text-sm text-[var(--gray-11)]">倒计时按所选日期当天 23:59:59 结束。</p>
            </div>
            <Button size="1" type="button" onClick={() => void handleSave()} disabled={!canManage || saving}>
              {saving ? "保存中..." : "保存日期"}
            </Button>
          </div>

          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">死亡日期</span>
            <TextField.Root
              type="date"
              value={deathDateInput}
              min={formatCalendarDate(new Date().toISOString())}
              disabled={!canManage || saving}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setDeathDateInput(event.currentTarget.value)}
            />
          </label>

          <dl className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--gray-11)]">当前设定</dt>
              <dd>{formatCalendarDate(profile?.deathDate)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--gray-11)]">最后更新</dt>
              <dd>{profile?.updateDate ? new Date(profile.updateDate).toLocaleString() : "--"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--gray-11)]">今日文案缓存</dt>
              <dd>{formatCalendarDate(profile?.todayWarningDate)}</dd>
            </div>
          </dl>
        </article>

        <article className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-base font-semibold">剩余时间</h3>
            <p className="mt-1 text-sm text-[var(--gray-11)]">不是抽象的人生，而是精确减少的今天。</p>
          </div>

          {!profile?.deathDate ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-[var(--gray-11)]">
              先设定死亡日期，再开始倒数。
            </div>
          ) : countdown?.expired ? (
            <div className="space-y-2 rounded-lg border border-[var(--red-7)] bg-[var(--red-a3)] px-4 py-4 text-sm text-[var(--red-11)]">
              <p className="font-medium">设定日期已到</p>
              <p>这一天已经过去。要么重新设定日期，要么立刻处理今天最重要的事。</p>
            </div>
          ) : countdown ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border px-3 py-2">
                  <p className="text-xs text-[var(--gray-11)]">目标日期</p>
                  <p className="text-lg font-semibold">{formatCalendarDate(profile.deathDate)}</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-2">
                  <p className="text-xs text-[var(--gray-11)]">剩余总天数</p>
                  <p className="text-lg font-semibold">{countdown.totalDays}</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-2">
                  <p className="text-xs text-[var(--gray-11)]">今天</p>
                  <p className="text-lg font-semibold">{formatCalendarDate(new Date().toISOString())}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-5">
                <div className="rounded-lg border border-border px-3 py-4 text-center">
                  <p className="text-2xl font-semibold">{countdown.years}</p>
                  <p className="text-xs text-[var(--gray-11)]">年</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-4 text-center">
                  <p className="text-2xl font-semibold">{countdown.days}</p>
                  <p className="text-xs text-[var(--gray-11)]">天</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-4 text-center">
                  <p className="text-2xl font-semibold">{padTime(countdown.hours)}</p>
                  <p className="text-xs text-[var(--gray-11)]">小时</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-4 text-center">
                  <p className="text-2xl font-semibold">{padTime(countdown.minutes)}</p>
                  <p className="text-xs text-[var(--gray-11)]">分钟</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-4 text-center">
                  <p className="text-2xl font-semibold">{padTime(countdown.seconds)}</p>
                  <p className="text-xs text-[var(--gray-11)]">秒</p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--gray-11)]">无法解析当前倒计时日期。</p>
          )}
        </article>
      </section>

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">今日警示语</h3>
            <p className="mt-1 text-sm text-[var(--gray-11)]">按天缓存。重新生成会覆盖今天的文案。</p>
          </div>
          <div className="flex gap-2">
            <Button
              size="1"
              type="button"
              disabled={!canManage || !profile?.deathDate || Boolean(countdown?.expired) || generating}
              onClick={() => void handleGenerateWarning(false)}
            >
              {generating ? "生成中..." : "生成今日警示语"}
            </Button>
            <Button
              size="1"
              variant="soft"
              type="button"
              disabled={!canManage || !profile?.deathDate || Boolean(countdown?.expired) || generating}
              onClick={() => void handleGenerateWarning(true)}
            >
              重新生成
            </Button>
          </div>
        </div>

        {profile?.todayWarningText ? (
          <div className="rounded-lg border border-border bg-white/70 px-4 py-4">
            <p className="text-base leading-7">{profile.todayWarningText}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--gray-11)]">
              <span>日期：{formatCalendarDate(profile.todayWarningDate)}</span>
              <span>生成时间：{profile.todayWarningGeneratedAt ? new Date(profile.todayWarningGeneratedAt).toLocaleString() : "--"}</span>
              <span>模型：{profile.todayWarningModel || "--"}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-[var(--gray-11)]">
            暂无今日警示语，点击上方按钮生成。
          </div>
        )}
      </section>
    </div>
  );
}
