"use client";

import { formatDistanceToNow } from "date-fns";
import { Loader2Icon, MonitorIcon, ShieldIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";

/**
 * Profile settings (AF-M6-08).
 *
 * Two things a user needs and had no surface for: change their display name,
 * and see and revoke their active sessions. The session half is the
 * security-relevant one — "sign out everywhere" after a lost laptop was
 * impossible from the product until now.
 */
export const ProfileSettings = () => {
  const session = authClient.useSession();
  const user = session.data?.user;

  return (
    <div className="flex flex-col gap-4">
      <ProfileDetails
        loading={session.isPending}
        name={user?.name ?? ""}
        email={user?.email ?? ""}
      />
      <ActiveSessions />
    </div>
  );
};

const ProfileDetails = ({
  loading,
  name,
  email,
}: {
  loading: boolean;
  name: string;
  email: string;
}) => {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);

  // Seed the field from the session once it loads. Guarded on a non-empty
  // incoming name so a mid-edit re-render (the session hook refetches) does not
  // stamp over what the user is typing.
  useEffect(() => {
    if (name) setValue(name);
  }, [name]);

  const dirty = value.trim() !== name && value.trim().length > 0;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      const { error } = await authClient.updateUser({ name: value.trim() });
      if (error) {
        toast.error(error.message ?? "Could not update your name");
        return;
      }
      toast.success("Name updated");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Profile</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <form onSubmit={save} className="flex max-w-md flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-name">Display name</Label>
            {loading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Input
                id="profile-name"
                value={value}
                maxLength={100}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-email">Email</Label>
            {loading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Input
                id="profile-email"
                value={email}
                disabled
                // Changing the sign-in address is an identity change with its
                // own verification flow; it is not an inline field edit, so it
                // is read-only here rather than pretending to be editable.
                readOnly
              />
            )}
            <p className="text-xs text-muted-foreground">
              Your email is used to sign in and cannot be changed here.
            </p>
          </div>

          <div>
            <Button type="submit" disabled={!dirty || saving}>
              {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Save changes
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
};

type SessionRow = {
  id: string;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date | string;
  expiresAt: Date | string;
};

const ActiveSessions = () => {
  const currentSession = authClient.useSession();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const currentToken = currentSession.data?.session?.token;

  // `useCallback` so the effect below can depend on it honestly: `load` closes
  // over only the stable `setState` setters, so its identity never changes and
  // the effect runs once, but the dependency is now declared rather than
  // suppressed.
  const load = useCallback(async () => {
    setError(false);
    const { data, error: listError } = await authClient.listSessions();
    if (listError) {
      setError(true);
      return;
    }
    setSessions((data ?? []) as SessionRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (token: string) => {
    setRevoking(token);
    try {
      const { error: revokeError } = await authClient.revokeSession({ token });
      if (revokeError) {
        toast.error(revokeError.message ?? "Could not revoke that session");
        return;
      }
      toast.success("Session revoked");
      await load();
    } finally {
      setRevoking(null);
    }
  };

  const revokeOthers = async () => {
    setRevoking("__others__");
    try {
      const { error: revokeError } = await authClient.revokeOtherSessions();
      if (revokeError) {
        toast.error(revokeError.message ?? "Could not revoke other sessions");
        return;
      }
      toast.success("Signed out of all other devices");
      await load();
    } finally {
      setRevoking(null);
    }
  };

  const others = (sessions ?? []).filter((s) => s.token !== currentToken);

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Active sessions</PanelTitle>
        {others.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={revoking !== null}
            onClick={revokeOthers}
          >
            <ShieldIcon className="size-4" />
            Sign out other devices
          </Button>
        ) : null}
      </PanelHeader>
      <PanelBody className="p-0">
        {error ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Could not load your sessions.{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => void load()}
            >
              Try again
            </button>
          </p>
        ) : sessions === null ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No active sessions.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {sessions.map((s) => {
              const isCurrent = s.token === currentToken;
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-hairline bg-well text-muted-foreground">
                    <MonitorIcon className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {describeUserAgent(s.userAgent)}
                      {isCurrent ? (
                        <span className="ml-2 text-xs font-normal text-primary">
                          This device
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {s.ipAddress ? `${s.ipAddress} · ` : ""}
                      started{" "}
                      {formatDistanceToNow(new Date(s.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  {!isCurrent ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={revoking !== null}
                      onClick={() => revoke(s.token)}
                    >
                      {revoking === s.token ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : null}
                      Revoke
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
};

/**
 * A short, human label from a User-Agent string. Deliberately coarse — the
 * point is "which of my devices is this", not a parsing library. Falls back to
 * the raw string's head so an unrecognised client is still distinguishable.
 */
function describeUserAgent(ua?: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /edg/i.test(ua)
    ? "Edge"
    : /chrome|crios/i.test(ua)
      ? "Chrome"
      : /firefox|fxios/i.test(ua)
        ? "Firefox"
        : /safari/i.test(ua)
          ? "Safari"
          : null;
  const os = /windows/i.test(ua)
    ? "Windows"
    : /mac os|macintosh/i.test(ua)
      ? "macOS"
      : /android/i.test(ua)
        ? "Android"
        : /iphone|ipad|ios/i.test(ua)
          ? "iOS"
          : /linux/i.test(ua)
            ? "Linux"
            : null;
  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return ua.slice(0, 40);
}
