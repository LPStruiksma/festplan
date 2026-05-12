// Festival utility functions and accent color palette.
// Festival data now lives exclusively in Supabase (festival_meta + timetable_slots).
// Seed each festival with:
//   node --env-file=.env scripts/seed-festival.mjs scripts/festivals/<id>-2026.json

// ── UTILITIES ─────────────────────────────────────────────────────────────────

// Normalize artist names for case-insensitive comparison
export const norm = s => s.toLowerCase().trim()

// Convert "HH:MM" to total minutes, treating post-midnight hours correctly.
// Returns 0 for null/undefined (lineup-only slots have no time data).
export const toMins = t => {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return (h < 6 ? h + 24 : h) * 60 + m
}

// Check if two lineup slots overlap in time (on the same day).
// Slots with null start/end (lineup-only) never overlap.
export const overlaps = (a, b) =>
  a.day === b.day && a.start != null && b.start != null &&
  toMins(a.start) < toMins(b.end) &&
  toMins(b.start) < toMins(a.end)

// ── ACCENT COLORS ─────────────────────────────────────────────────────────────

export const FEST_COLORS = {
  coachella:      '#e8c547',
  glastonbury:    '#82d96e',
  primavera:      '#ff5577',
  lowlands:       '#ff8c42',
  bestkeptsecret: '#4ade80',
}

export const FRIEND_COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#fb923c']
