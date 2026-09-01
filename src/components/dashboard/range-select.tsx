"use client";

import { CalendarIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;

const formatUtcDay = (date: Date) =>
  date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/**
 * The dates the chosen window actually covers, spelled out.
 *
 * "Last 30 days" is a rule, not a range, and on a cost report the difference
 * matters. Resolved after mount because the server and the browser would
 * otherwise disagree about what "today" is.
 */
const PeriodDates = ({ days }: { days: number }) => {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const start = new Date(end.getTime() - (days - 1) * DAY_MS);
    setLabel(`${formatUtcDay(start)} - ${formatUtcDay(end)}`);
  }, [days]);

  return (
    <span className="flex h-8 items-center gap-1.5 px-2.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
      <CalendarIcon className="size-3.5 shrink-0" />
      {label ?? `Last ${days} days`}
    </span>
  );
};

/**
 * Reporting period control, identical on Monitoring and Costs: the rule on the
 * left, the dates it resolves to on the right, in one bordered group.
 */
export const RangeSelect = ({
  value,
  options,
  onChange,
  className,
}: {
  value: number;
  options: readonly number[];
  onChange: (days: number) => void;
  className?: string;
}) => (
  <div
    className={cn(
      "flex items-center rounded-md border border-hairline bg-panel",
      className,
    )}
  >
    <Select
      value={String(value)}
      onValueChange={(next) => onChange(Number(next))}
    >
      <SelectTrigger
        aria-label="Reporting period"
        className="h-8 w-[130px] border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={String(option)} className="text-xs">
            Last {option} days
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    <span aria-hidden className="h-5 w-px shrink-0 bg-hairline" />
    <PeriodDates days={value} />
  </div>
);
