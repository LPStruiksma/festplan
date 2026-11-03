// Past vs. upcoming festivals.
// A festival is "past" once its last day is before today's local calendar day,
// so a festival running today still counts as upcoming. Festivals without any
// date are kept: we cannot tell, so we do not hide them.

const pad = n => String(n).padStart(2, '0')

// "YYYY-MM-DD" for the local calendar day of `date`.
export function localISODate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Last day of a festival as "YYYY-MM-DD": endDate, else startDate plus its
// number of days, else startDate, else null.
export function festivalEndDate(f) {
  if (f?.endDate) return f.endDate
  if (!f?.startDate) return null
  const extra = Array.isArray(f.days) && f.days.length > 1 ? f.days.length - 1 : 0
  if (!extra) return f.startDate
  const [y, m, d] = f.startDate.split('-').map(Number)
  return localISODate(new Date(y, m - 1, d + extra))
}

export function isPastFestival(f, today = new Date()) {
  const end = festivalEndDate(f)
  return end != null && end < localISODate(today)
}

// Split a list into { upcoming, past }, each keeping the original order.
export function splitPastFestivals(festivals, today = new Date()) {
  const upcoming = []
  const past = []
  for (const f of festivals || []) (isPastFestival(f, today) ? past : upcoming).push(f)
  return { upcoming, past }
}
