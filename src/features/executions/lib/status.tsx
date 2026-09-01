import {
  BanIcon,
  CheckCircle2Icon,
  ClockIcon,
  Loader2Icon,
  StopCircleIcon,
  TimerIcon,
  XCircleIcon,
} from "lucide-react";

import {
  StatusPill,
  type StatusTone,
} from "@/components/dashboard/status-pill";

/**
 * One description of an execution status, shared by the executions list, the
 * cost tables and anywhere else a run is shown. Colour and wording used to be
 * re-decided per component, so the same FAILED run was red in one list and
 * plain grey in another.
 */
export const EXECUTION_STATUS_META: Record<
  string,
  { label: string; tone: StatusTone; icon: React.ReactNode }
> = {
  SUCCESS: {
    label: "Success",
    tone: "success",
    icon: <CheckCircle2Icon />,
  },
  RUNNING: {
    label: "Running",
    tone: "info",
    icon: <Loader2Icon className="animate-spin" />,
  },
  FAILED: { label: "Failed", tone: "danger", icon: <XCircleIcon /> },
  TIMED_OUT: { label: "Timed out", tone: "warning", icon: <TimerIcon /> },
  CANCELLED: {
    label: "Cancelled",
    tone: "neutral",
    icon: <StopCircleIcon />,
  },
  QUOTA_EXCEEDED: {
    label: "Quota exceeded",
    tone: "danger",
    icon: <BanIcon />,
  },
};

const FALLBACK = {
  label: "Pending",
  tone: "neutral" as StatusTone,
  icon: <ClockIcon />,
};

export const executionStatusMeta = (status: string) =>
  EXECUTION_STATUS_META[status] ?? FALLBACK;

export const ExecutionStatusPill = ({ status }: { status: string }) => {
  const meta = executionStatusMeta(status);
  return (
    <StatusPill tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </StatusPill>
  );
};
