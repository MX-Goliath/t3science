import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { useEnvironments } from "../state/environments";
import { environmentShell } from "../state/shell";
import { threadNotificationContent } from "../threadNotificationContent";
import { watchThreadNotificationDetail } from "../threadNotificationDetail";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  setNotificationBadge,
  showThreadNotification,
  type ThreadNotification,
  unlockNotificationAudio,
} from "../threadNotifications";
import { resolveSidebarThreadStatus } from "./Sidebar.logic";
import { toastManager } from "./ui/toast";

export function ThreadNotificationCoordinator() {
  const { environments } = useEnvironments();
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const pending = useRef(
    new Map<string, { environmentId: EnvironmentId; notification: ThreadNotification }>(),
  );
  const onNotification = useCallback(
    (environmentId: EnvironmentId, notification: ThreadNotification) => {
      pending.current.get(notification.tag)?.notification.close();
      pending.current.set(notification.tag, { environmentId, notification });
      setNotificationBadge(pending.current.size);
      return () => {
        if (pending.current.get(notification.tag)?.notification !== notification) return;
        pending.current.delete(notification.tag);
        setNotificationBadge(pending.current.size);
      };
    },
    [],
  );

  useEffect(() => {
    const activeIds = new Set(environments.map(({ environmentId }) => environmentId));
    const count = pending.current.size;
    for (const [tag, { environmentId, notification }] of pending.current) {
      if (activeIds.has(environmentId)) continue;
      notification.close();
      pending.current.delete(tag);
    }
    if (count !== pending.current.size) setNotificationBadge(pending.current.size);
  }, [environments]);

  useEffect(() => {
    const clear = () => {
      for (const { notification } of pending.current.values()) notification.close();
      pending.current.clear();
      setNotificationBadge(0);
    };
    clear();
    if (!hasDesktopNotifications(mode)) return;
    const unsubscribe = window.desktopBridge?.onNotificationBadgeClear?.(clear);
    window.addEventListener("focus", clear);
    return () => {
      unsubscribe?.();
      window.removeEventListener("focus", clear);
      clear();
    };
  }, [mode]);

  useEffect(() => {
    if (!hasNotificationSound(mode)) return;
    document.addEventListener("pointerdown", unlockNotificationAudio);
    document.addEventListener("keydown", unlockNotificationAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockNotificationAudio);
      document.removeEventListener("keydown", unlockNotificationAudio);
    };
  }, [mode]);

  if (mode === "off" && !inAppNotificationsEnabled) return null;

  return environments.map((environment) => (
    <EnvironmentNotifications
      key={environment.environmentId}
      environmentId={environment.environmentId}
      onNotification={onNotification}
    />
  ));
}

function EnvironmentNotifications({
  environmentId,
  onNotification,
}: {
  environmentId: EnvironmentId;
  onNotification: (environmentId: EnvironmentId, notification: ThreadNotification) => () => void;
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const navigate = useNavigate();
  const { environmentId: activeEnvironmentId, threadId: activeThreadId } = useParams({
    strict: false,
  });
  const previous = useRef(
    new Map<ThreadId, { attention: string | null; completion: number | null }>(),
  );
  const loading = useRef(new Map<ThreadId, { key: string; cancel: () => void }>());
  const cancelLoading = useCallback(() => {
    for (const request of loading.current.values()) request.cancel();
    loading.current.clear();
  }, []);

  useEffect(() => {
    if (!hasDesktopNotifications(mode)) {
      cancelLoading();
      return;
    }
    window.addEventListener("focus", cancelLoading);
    const unsubscribe = window.desktopBridge?.onNotificationBadgeClear?.(cancelLoading);
    return () => {
      window.removeEventListener("focus", cancelLoading);
      unsubscribe?.();
      cancelLoading();
    };
  }, [cancelLoading, mode]);

  useEffect(() => {
    if (shell.status !== "live" || Option.isNone(shell.snapshot)) {
      cancelLoading();
      previous.current.clear();
      return;
    }
    const next = new Map<ThreadId, { attention: string | null; completion: number | null }>();
    for (const thread of shell.snapshot.value.threads) {
      let status = resolveSidebarThreadStatus(thread);
      if (status === "ready" && thread.latestTurn?.state === "error") status = "failed";
      const prior = previous.current.get(thread.id);
      const attention =
        status === "input" || status === "approval" || status === "failed"
          ? `${thread.latestTurn?.turnId ?? ""}:${status}`
          : null;
      const completedAt = Date.parse(thread.latestTurn?.completedAt ?? "");
      const completion =
        status === "ready" &&
        thread.latestTurn?.state === "completed" &&
        Number.isFinite(completedAt)
          ? completedAt
          : (prior?.completion ?? null);
      next.set(thread.id, { attention, completion });
      const eventKey = `${thread.latestTurn?.turnId ?? ""}:${attention ?? completion}`;
      const pending = loading.current.get(thread.id);
      if (pending && (pending.key !== eventKey || thread.archivedAt !== null)) {
        pending.cancel();
        loading.current.delete(thread.id);
      }
      if (!prior || thread.archivedAt !== null) continue;
      const kind =
        attention && attention !== prior.attention
          ? "input"
          : completion !== null && (prior.completion === null || completion > prior.completion)
            ? "completion"
            : null;
      if (!kind) continue;
      const title =
        kind === "completion"
          ? "Thread completed"
          : status === "approval"
            ? "Approval needed"
            : status === "failed"
              ? "Thread failed"
              : "Input needed";
      const isActive = () => document.visibilityState === "visible" && document.hasFocus();
      if (!isActive() && hasNotificationSound(mode)) {
        void playNotificationSound(
          kind,
          () => !isActive() && hasNotificationSound(getClientSettings().notificationMode),
        );
      }
      if (
        inAppNotificationsEnabled &&
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        (activeEnvironmentId !== environmentId || activeThreadId !== thread.id)
      ) {
        const toastId = toastManager.add({
          type: kind === "completion" ? "success" : status === "failed" ? "error" : "warning",
          title,
          description: thread.title,
          data: {
            hideCopyButton: true,
            leadingIcon:
              kind === "completion" ? (
                <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />
              ) : status === "approval" ? (
                <ShieldQuestionIcon aria-hidden className="size-4 text-warning-foreground" />
              ) : status === "failed" ? (
                <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />
              ) : (
                <MessageCircleQuestionIcon aria-hidden className="size-4 text-info-foreground" />
              ),
          },
          actionProps: {
            children: "Open thread",
            onClick: () => {
              toastManager.close(toastId);
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId, threadId: thread.id },
              });
            },
          },
        });
        continue;
      }
      if (
        !hasDesktopNotifications(mode) ||
        (document.visibilityState === "visible" && document.hasFocus())
      )
        continue;
      const notificationKind =
        kind === "completion"
          ? "done"
          : status === "failed"
            ? "error"
            : status === "approval"
              ? "approval"
              : "input";
      const request = { key: eventKey, cancel: () => {} };
      loading.current.set(thread.id, request);
      request.cancel = watchThreadNotificationDetail(
        { environmentId, threadId: thread.id },
        thread,
        notificationKind,
        (detail) => {
          if (loading.current.get(thread.id) !== request) return;
          loading.current.delete(thread.id);
          if (isActive() || !hasDesktopNotifications(getClientSettings().notificationMode)) return;
          const content = threadNotificationContent(thread, notificationKind, detail);
          try {
            let removeNotification: (() => void) | undefined;
            const notification = showThreadNotification(
              content.title,
              content.body,
              `${environmentId}:${thread.id}`,
              () => {
                notification?.close();
                window.focus();
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: { environmentId, threadId: thread.id },
                });
              },
              () => removeNotification?.(),
            );
            if (notification) removeNotification = onNotification(environmentId, notification);
          } catch {
            // Some browsers expose Notification but reject desktop presentation.
          }
        },
      );
    }
    for (const [threadId, request] of loading.current) {
      if (next.has(threadId)) continue;
      request.cancel();
      loading.current.delete(threadId);
    }
    previous.current = next;
  }, [
    activeEnvironmentId,
    activeThreadId,
    cancelLoading,
    environmentId,
    inAppNotificationsEnabled,
    mode,
    navigate,
    onNotification,
    shell,
  ]);

  return null;
}
