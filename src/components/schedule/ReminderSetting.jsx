import React from 'react'
import { T } from '../../lib/ui'
import { REMINDER_CHOICES } from '../../lib/ical'

/**
 * Calendar-export reminder picker: alarm at start, 15 or 30 minutes before.
 *
 * Props:
 *   value     — 0 | 15 | 30
 *   onChange  — (mins) => void
 */
const LABELS = { 0: 'At start time', 15: '15 min before', 30: '30 min before' }

export default function ReminderSetting({ value, onChange }) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      fontFamily: T.body, fontSize: 11, color: 'var(--fp-text-dim)',
      marginBottom: 14,
    }}>
      Calendar reminder
      <select
        value={String(value)}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          background: 'var(--fp-s1)', color: 'var(--fp-text)',
          border: '1px solid var(--fp-border)', borderRadius: 'var(--fp-radius-sm)',
          padding: '4px 8px', fontFamily: T.body, fontSize: 11,
        }}
      >
        {REMINDER_CHOICES.map(m => <option key={m} value={String(m)}>{LABELS[m]}</option>)}
      </select>
    </label>
  )
}
