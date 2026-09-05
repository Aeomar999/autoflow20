/**
 * Relative rendering of the last successful graph save — "just now",
 * "N seconds ago", "N minutes ago", or a wall-clock "at HH:MM" once the save
 * is more than an hour old (AF-UX-03).
 *
 * Pure so the header component stays trivial and the bounds are unit-tested
 * without rendering. A clock running ahead of the save (client time skew) is
 * clamped to "just now".
 */
export function formatLastSaved(
  lastSavedAt: number | null,
  now: number,
): string {
  if (lastSavedAt === null) return "";
  const seconds = Math.max(0, Math.floor((now - lastSavedAt) / 1000));
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  return `at ${new Date(lastSavedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
