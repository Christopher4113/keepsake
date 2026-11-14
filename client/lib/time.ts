// households has no timezone yet, so the demo household's zone is fixed here (NEXT_STEPS: per-household timezone).
export const TZ = "America/Toronto";

// "Saturday, November 14, 2026": what the agent is told today is.
export const longDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(d);

// "2026-11-14": when a memory was added, so "today" in a memory's text can be read against it.
export const isoDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
