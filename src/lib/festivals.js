// Festival data, accent colors, and shared utility functions.
// This is the single source of truth for all lineup information.

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

// ── FESTIVAL DATA ─────────────────────────────────────────────────────────────

export const FESTIVALS = {
  coachella: {
    id: 'coachella', name: 'Coachella 2026', location: 'Indio, CA', emoji: '🌵',
    days: ['Fri Apr 10', 'Sat Apr 11', 'Sun Apr 12'],
    stages: ['Coachella Stage', 'Outdoor Theatre', 'Mojave', 'Gobi', 'Sahara', 'Yuma'],
    lineup: [
      // ── FRIDAY ──
      { artist: 'Teddy Swims',        stage: 'Coachella Stage', day: 0, start: '17:30', end: '18:20' },
      { artist: 'The xx',             stage: 'Coachella Stage', day: 0, start: '19:00', end: '19:55' },
      { artist: 'Sabrina Carpenter',  stage: 'Coachella Stage', day: 0, start: '21:05', end: '22:35' },
      { artist: 'Anyma',              stage: 'Coachella Stage', day: 0, start: '00:00', end: '01:30' },
      { artist: 'Lykke Li',           stage: 'Outdoor Theatre', day: 0, start: '17:20', end: '18:10' },
      { artist: 'Dijon',              stage: 'Outdoor Theatre', day: 0, start: '18:40', end: '19:30' },
      { artist: 'Turnstile',          stage: 'Outdoor Theatre', day: 0, start: '20:05', end: '21:00' },
      { artist: 'Disclosure',         stage: 'Outdoor Theatre', day: 0, start: '22:35', end: '23:50' },
      { artist: 'Central Cee',        stage: 'Mojave',          day: 0, start: '17:30', end: '18:20' },
      { artist: 'DEVO',               stage: 'Mojave',          day: 0, start: '18:45', end: '19:40' },
      { artist: 'Moby',               stage: 'Mojave',          day: 0, start: '20:10', end: '21:00' },
      { artist: 'Ethel Cain',         stage: 'Mojave',          day: 0, start: '22:35', end: '23:25' },
      { artist: 'Blood Orange',       stage: 'Mojave',          day: 0, start: '23:55', end: '00:45' },
      { artist: 'Cmat',               stage: 'Gobi',            day: 0, start: '18:15', end: '19:05' },
      { artist: 'Holly Humberstone',  stage: 'Gobi',            day: 0, start: '20:25', end: '21:10' },
      { artist: 'Joost',              stage: 'Gobi',            day: 0, start: '21:50', end: '22:40' },
      { artist: 'Röyksopp',          stage: 'Yuma',            day: 0, start: '19:00', end: '20:15' },
      { artist: 'WhoMadeWho',         stage: 'Yuma',            day: 0, start: '20:30', end: '21:45' },
      { artist: 'Green Velvet',       stage: 'Yuma',            day: 0, start: '22:00', end: '23:15' },
      // ── SATURDAY ──
      { artist: 'Addison Rae',        stage: 'Coachella Stage', day: 1, start: '17:30', end: '18:20' },
      { artist: 'Giveon',             stage: 'Coachella Stage', day: 1, start: '19:00', end: '19:50' },
      { artist: 'The Strokes',        stage: 'Coachella Stage', day: 1, start: '21:00', end: '22:10' },
      { artist: 'Justin Bieber',      stage: 'Coachella Stage', day: 1, start: '23:25', end: '00:30' },
      { artist: 'Sombr',              stage: 'Outdoor Theatre', day: 1, start: '19:05', end: '19:55' },
      { artist: 'Labrinth',           stage: 'Outdoor Theatre', day: 1, start: '20:30', end: '21:25' },
      { artist: 'David Byrne',        stage: 'Outdoor Theatre', day: 1, start: '22:20', end: '23:20' },
      { artist: 'Jack White',         stage: 'Mojave',          day: 1, start: '15:00', end: '15:45' },
      { artist: 'Taemin',             stage: 'Mojave',          day: 1, start: '19:30', end: '20:20' },
      { artist: 'PinkPantheress',     stage: 'Mojave',          day: 1, start: '20:55', end: '21:45' },
      { artist: 'Interpol',           stage: 'Mojave',          day: 1, start: '22:15', end: '23:15' },
      { artist: 'Davido',             stage: 'Gobi',            day: 1, start: '19:50', end: '20:35' },
      { artist: 'BIA',                stage: 'Gobi',            day: 1, start: '21:00', end: '21:45' },
      { artist: 'Nine Inch Noize',    stage: 'Sahara',          day: 1, start: '20:00', end: '20:45' },
      { artist: 'REZZ',               stage: 'Sahara',          day: 1, start: '21:10', end: '22:05' },
      { artist: 'Adriatique',         stage: 'Sahara',          day: 1, start: '22:30', end: '23:25' },
      { artist: 'Worship',            stage: 'Sahara',          day: 1, start: '23:55', end: '01:00' },
      { artist: 'Bedouin',            stage: 'Yuma',            day: 1, start: '20:15', end: '21:45' },
      { artist: 'Boys Noize',         stage: 'Yuma',            day: 1, start: '21:45', end: '23:00' },
      { artist: 'Armin van Buuren x Adam Beyer', stage: 'Yuma', day: 1, start: '23:00', end: '01:00' },
      // ── SUNDAY ──
      { artist: 'Gigi Perez',         stage: 'Outdoor Theatre', day: 2, start: '16:00', end: '16:45' },
      { artist: 'Wet Leg',            stage: 'Coachella Stage', day: 2, start: '16:45', end: '17:30' },
      { artist: 'Clipse',             stage: 'Outdoor Theatre', day: 2, start: '17:15', end: '18:10' },
      { artist: 'Major Lazer',        stage: 'Coachella Stage', day: 2, start: '18:10', end: '19:10' },
      { artist: 'Foster the People',  stage: 'Outdoor Theatre', day: 2, start: '18:45', end: '19:40' },
      { artist: 'Little Simz',        stage: 'Mojave',          day: 2, start: '16:25', end: '17:10' },
      { artist: 'Iggy Pop',           stage: 'Mojave',          day: 2, start: '19:10', end: '20:10' },
      { artist: 'Young Thug',         stage: 'Coachella Stage', day: 2, start: '19:50', end: '20:40' },
      { artist: 'Laufey',             stage: 'Outdoor Theatre', day: 2, start: '20:40', end: '21:40' },
      { artist: 'FKA twigs',          stage: 'Mojave',          day: 2, start: '20:45', end: '22:00' },
      { artist: 'Karol G',            stage: 'Coachella Stage', day: 2, start: '21:55', end: '23:30' },
      { artist: 'Fatboy Slim',        stage: 'Yuma',            day: 2, start: '20:00', end: '22:00' },
      { artist: 'Kaskade',            stage: 'Sahara',          day: 2, start: '22:45', end: '23:55' },
    ],
  },

  primavera: {
    id: 'primavera', name: 'Primavera Sound 2026', location: 'Barcelona, Spain', emoji: '🌊',
    days: ['Thu Jun 4', 'Fri Jun 5', 'Sat Jun 6', 'Sun Jun 7'],
    stages: ['Primavera Stage', 'Pitchfork Stage', 'Desperados Stage', 'Ray-Ban Stage', 'Green Stage'],
    lineup: [
      // ── THURSDAY ──
      { artist: 'Doja Cat',           stage: 'Primavera Stage',  day: 0, start: '22:30', end: '00:00' },
      { artist: 'Massive Attack',     stage: 'Primavera Stage',  day: 0, start: '20:30', end: '22:00' },
      { artist: 'Blood Orange',       stage: 'Pitchfork Stage',  day: 0, start: '21:00', end: '22:30' },
      { artist: 'Mac DeMarco',        stage: 'Ray-Ban Stage',    day: 0, start: '20:00', end: '21:00' },
      { artist: 'Alex G',             stage: 'Green Stage',      day: 0, start: '19:30', end: '20:30' },
      { artist: 'Father John Misty',  stage: 'Pitchfork Stage',  day: 0, start: '19:00', end: '20:30' },
      { artist: 'TV Girl',            stage: 'Ray-Ban Stage',    day: 0, start: '18:00', end: '19:00' },
      { artist: 'Overmono',           stage: 'Desperados Stage', day: 0, start: '22:00', end: '23:30' },
      { artist: 'Bad Gyal',           stage: 'Desperados Stage', day: 0, start: '20:30', end: '21:30' },
      { artist: 'Ravyn Lenae',        stage: 'Green Stage',      day: 0, start: '21:00', end: '22:00' },
      // ── FRIDAY ──
      { artist: 'The Cure',           stage: 'Primavera Stage',  day: 1, start: '22:00', end: '00:00' },
      { artist: 'Skrillex',           stage: 'Desperados Stage', day: 1, start: '23:00', end: '01:00' },
      { artist: 'PinkPantheress',     stage: 'Primavera Stage',  day: 1, start: '20:30', end: '21:30' },
      { artist: 'Ethel Cain',         stage: 'Pitchfork Stage',  day: 1, start: '21:00', end: '22:00' },
      { artist: 'Amaarae',            stage: 'Ray-Ban Stage',    day: 1, start: '20:00', end: '21:00' },
      { artist: 'Slowdive',           stage: 'Green Stage',      day: 1, start: '21:00', end: '22:15' },
      { artist: 'Addison Rae',        stage: 'Primavera Stage',  day: 1, start: '19:00', end: '20:00' },
      { artist: 'Rilo Kiley',         stage: 'Pitchfork Stage',  day: 1, start: '19:30', end: '20:45' },
      { artist: 'Viagra Boys',        stage: 'Ray-Ban Stage',    day: 1, start: '18:30', end: '19:30' },
      { artist: 'JADE',               stage: 'Green Stage',      day: 1, start: '18:00', end: '19:00' },
      { artist: 'Ralphie Choo',       stage: 'Desperados Stage', day: 1, start: '19:30', end: '20:30' },
      // ── SATURDAY ──
      { artist: 'The xx',             stage: 'Primavera Stage',  day: 2, start: '22:30', end: '00:00' },
      { artist: 'Gorillaz',           stage: 'Primavera Stage',  day: 2, start: '20:30', end: '22:00' },
      { artist: 'my bloody valentine',stage: 'Pitchfork Stage',  day: 2, start: '22:00', end: '00:00' },
      { artist: 'Peggy Gou',          stage: 'Desperados Stage', day: 2, start: '23:00', end: '01:00' },
      { artist: 'Little Simz',        stage: 'Ray-Ban Stage',    day: 2, start: '21:00', end: '22:00' },
      { artist: 'Big Thief',          stage: 'Green Stage',      day: 2, start: '21:00', end: '22:15' },
      { artist: 'Dijon',              stage: 'Pitchfork Stage',  day: 2, start: '20:00', end: '21:00' },
      { artist: 'KNEECAP',            stage: 'Ray-Ban Stage',    day: 2, start: '19:00', end: '20:00' },
      { artist: 'MARINA',             stage: 'Primavera Stage',  day: 2, start: '19:00', end: '20:00' },
      { artist: 'Ashnikko',           stage: 'Green Stage',      day: 2, start: '19:00', end: '20:00' },
      { artist: 'Knocked Loose',      stage: 'Desperados Stage', day: 2, start: '20:00', end: '21:00' },
      { artist: 'Lambrini Girls',     stage: 'Ray-Ban Stage',    day: 2, start: '17:30', end: '18:30' },
      { artist: 'Touché Amoré',      stage: 'Pitchfork Stage',  day: 2, start: '18:00', end: '19:00' },
      // ── SUNDAY ──
      { artist: 'Carl Cox',           stage: 'Desperados Stage', day: 3, start: '23:00', end: '02:00' },
      { artist: 'BLOND:ISH',          stage: 'Desperados Stage', day: 3, start: '21:00', end: '23:00' },
      { artist: 'Joseph Capriati',    stage: 'Primavera Stage',  day: 3, start: '22:00', end: '00:00' },
    ],
  },

  lowlands: {
    id: 'lowlands', name: 'Lowlands 2026', location: 'Biddinghuizen, NL', emoji: '⛺',
    days: ['Thu Aug 13', 'Fri Aug 14', 'Sat Aug 15', 'Sun Aug 16'],
    stages: ['Alpha', 'Beta', 'Bravo', 'Gamma', 'India'],
    lineup: [
      // Confirmed + estimated acts for 2026
      { artist: 'Clipse',         stage: 'Alpha', day: 0, start: '21:30', end: '23:00' },
      { artist: 'Blood Orange',   stage: 'Beta',  day: 0, start: '21:00', end: '22:00' },
      { artist: 'Dijon',          stage: 'Bravo', day: 0, start: '19:30', end: '20:30' },
      { artist: '2hollis',        stage: 'India', day: 0, start: '18:00', end: '19:00' },
      { artist: 'Peggy Gou',      stage: 'Gamma', day: 0, start: '23:00', end: '01:00' },
      { artist: 'Ethel Cain',     stage: 'Bravo', day: 0, start: '21:00', end: '22:00' },
      { artist: 'Massive Attack', stage: 'Alpha', day: 1, start: '21:30', end: '23:00' },
      { artist: 'Little Simz',    stage: 'Beta',  day: 1, start: '20:00', end: '21:00' },
      { artist: 'Overmono',       stage: 'Gamma', day: 1, start: '22:30', end: '00:00' },
      { artist: 'Turnstile',      stage: 'Bravo', day: 1, start: '19:30', end: '20:30' },
      { artist: 'The xx',         stage: 'Alpha', day: 2, start: '21:00', end: '22:30' },
      { artist: 'Gorillaz',       stage: 'Alpha', day: 2, start: '19:00', end: '20:30' },
      { artist: 'FKA twigs',      stage: 'Beta',  day: 2, start: '20:30', end: '21:30' },
      { artist: 'KNEECAP',        stage: 'Bravo', day: 2, start: '19:00', end: '20:00' },
      { artist: 'Slowdive',       stage: 'India', day: 2, start: '18:00', end: '19:00' },
      { artist: 'Knocked Loose',  stage: 'Beta',  day: 3, start: '20:00', end: '21:00' },
      { artist: 'Laufey',         stage: 'Alpha', day: 3, start: '20:30', end: '21:30' },
      { artist: 'Holly Humberstone', stage: 'Bravo', day: 3, start: '18:30', end: '19:30' },
    ],
  },

  glastonbury: {
    id: 'glastonbury', name: 'Glastonbury 2026', location: 'Worthy Farm, Pilton, UK', emoji: '🎸',
    // 2026 is a fallow year; lineup uses confirmed 2025 artists as placeholders.
    days: ['Fri Jun 26', 'Sat Jun 27', 'Sun Jun 28'],
    stages: ['Pyramid Stage', 'Other Stage', 'West Holts', 'Park Stage', 'John Peel Stage'],
    lineup: [
      // ── FRIDAY ──
      { artist: 'Wet Leg',              stage: 'Pyramid Stage',   day: 0, start: '17:30', end: '18:30' },
      { artist: 'Blossoms',             stage: 'Pyramid Stage',   day: 0, start: '19:30', end: '20:45' },
      { artist: 'IDLES',                stage: 'Pyramid Stage',   day: 0, start: '22:00', end: '23:30' },
      { artist: 'Beabadoobee',          stage: 'Other Stage',     day: 0, start: '17:00', end: '18:00' },
      { artist: 'Noah Kahan',           stage: 'Other Stage',     day: 0, start: '18:30', end: '19:45' },
      { artist: 'Loyle Carner',         stage: 'Other Stage',     day: 0, start: '20:15', end: '21:30' },
      { artist: 'Charli XCX',           stage: 'Other Stage',     day: 0, start: '22:30', end: '00:00' },
      { artist: 'Amaarae',              stage: 'West Holts',      day: 0, start: '19:00', end: '20:00' },
      { artist: 'FKA twigs',            stage: 'West Holts',      day: 0, start: '21:00', end: '22:30' },
      { artist: 'The Last Dinner Party',stage: 'Park Stage',      day: 0, start: '17:45', end: '18:45' },
      { artist: 'Bloc Party',           stage: 'Park Stage',      day: 0, start: '19:45', end: '21:00' },
      { artist: 'Sprints',              stage: 'John Peel Stage', day: 0, start: '15:30', end: '16:30' },
      { artist: 'CMAT',                 stage: 'John Peel Stage', day: 0, start: '18:00', end: '19:00' },
      { artist: 'Lambrini Girls',       stage: 'John Peel Stage', day: 0, start: '21:30', end: '22:30' },
      // ── SATURDAY ──
      { artist: 'Fontaines D.C.',       stage: 'Pyramid Stage',   day: 1, start: '17:30', end: '18:45' },
      { artist: 'Gracie Abrams',        stage: 'Pyramid Stage',   day: 1, start: '19:30', end: '20:45' },
      { artist: 'Neil Young',           stage: 'Pyramid Stage',   day: 1, start: '21:30', end: '23:15' },
      { artist: 'Bombay Bicycle Club',  stage: 'Other Stage',     day: 1, start: '18:30', end: '19:45' },
      { artist: 'Wolf Alice',           stage: 'Other Stage',     day: 1, start: '19:45', end: '21:00' },
      { artist: 'Jungle',               stage: 'Other Stage',     day: 1, start: '21:00', end: '22:30' },
      { artist: 'Mdou Moctar',          stage: 'West Holts',      day: 1, start: '20:00', end: '21:15' },
      { artist: 'Peggy Gou',            stage: 'West Holts',      day: 1, start: '22:30', end: '00:00' },
      { artist: 'PinkPantheress',       stage: 'Park Stage',      day: 1, start: '16:30', end: '17:30' },
      { artist: 'Barry Can\'t Swim',    stage: 'Park Stage',      day: 1, start: '19:30', end: '20:45' },
      { artist: 'Bartees Strange',      stage: 'John Peel Stage', day: 1, start: '18:30', end: '19:30' },
      { artist: 'Mannequin Pussy',      stage: 'John Peel Stage', day: 1, start: '20:30', end: '21:30' },
      // ── SUNDAY ──
      { artist: 'Rod Stewart',          stage: 'Pyramid Stage',   day: 2, start: '14:30', end: '16:00' },
      { artist: 'Doechii',              stage: 'Pyramid Stage',   day: 2, start: '17:00', end: '18:15' },
      { artist: 'Olivia Rodrigo',       stage: 'Pyramid Stage',   day: 2, start: '21:30', end: '23:00' },
      { artist: 'Busta Rhymes',         stage: 'Other Stage',     day: 2, start: '18:00', end: '19:15' },
      { artist: 'The Prodigy',          stage: 'Other Stage',     day: 2, start: '21:45', end: '23:15' },
      { artist: 'Little Simz',          stage: 'West Holts',      day: 2, start: '20:30', end: '21:45' },
      { artist: 'Yard Act',             stage: 'Park Stage',      day: 2, start: '16:45', end: '17:45' },
      { artist: 'English Teacher',      stage: 'Park Stage',      day: 2, start: '19:00', end: '20:00' },
      { artist: 'Jessica Pratt',        stage: 'John Peel Stage', day: 2, start: '18:00', end: '19:00' },
    ],
  },

  bestkeptsecret: {
    id: 'bestkeptsecret', name: "Best Kept Secret '26", location: 'Hilvarenbeek, NL', emoji: '🌲',
    days: ['Thu Jun 11', 'Fri Jun 12', 'Sat Jun 13'],
    stages: ['Main Stage', 'Patronaat', 'Forest Stage', 'Greenhouse'],
    lineup: [
      { artist: 'Big Thief',          stage: 'Main Stage',   day: 0, start: '21:30', end: '23:00' },
      { artist: 'Alex G',             stage: 'Patronaat',    day: 0, start: '20:00', end: '21:00' },
      { artist: 'Father John Misty',  stage: 'Patronaat',    day: 0, start: '21:30', end: '22:30' },
      { artist: 'TV Girl',            stage: 'Forest Stage', day: 0, start: '18:00', end: '19:00' },
      { artist: 'Ravyn Lenae',        stage: 'Greenhouse',   day: 0, start: '22:30', end: '00:00' },
      { artist: 'Dijon',              stage: 'Forest Stage', day: 0, start: '19:30', end: '20:30' },
      { artist: 'The xx',             stage: 'Main Stage',   day: 1, start: '21:00', end: '22:30' },
      { artist: 'Laufey',             stage: 'Patronaat',    day: 1, start: '19:30', end: '20:30' },
      { artist: 'Slowdive',           stage: 'Forest Stage', day: 1, start: '20:30', end: '21:30' },
      { artist: 'Overmono',           stage: 'Greenhouse',   day: 1, start: '23:00', end: '01:00' },
      { artist: 'Holly Humberstone',  stage: 'Patronaat',    day: 1, start: '21:00', end: '22:00' },
      { artist: 'Gigi Perez',         stage: 'Forest Stage', day: 1, start: '18:00', end: '19:00' },
      { artist: 'Gorillaz',           stage: 'Main Stage',   day: 2, start: '21:00', end: '22:30' },
      { artist: 'Little Simz',        stage: 'Main Stage',   day: 2, start: '19:00', end: '20:00' },
      { artist: 'Blood Orange',       stage: 'Patronaat',    day: 2, start: '20:30', end: '21:30' },
      { artist: 'Peggy Gou',          stage: 'Greenhouse',   day: 2, start: '22:30', end: '00:00' },
      { artist: 'Lambrini Girls',     stage: 'Forest Stage', day: 2, start: '18:00', end: '19:00' },
      { artist: '2hollis',            stage: 'Forest Stage', day: 2, start: '19:30', end: '20:30' },
    ],
  },
}

// All unique artist names across every festival — used for autocomplete
export const ALL_ARTISTS = [
  ...new Set(Object.values(FESTIVALS).flatMap(f => f.lineup.map(s => s.artist)))
].sort()