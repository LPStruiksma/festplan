import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { T, pillBtn } from '../lib/ui'
import {
  getFestivalWithSlots,
  updateFestivalMeta,
  upsertSlot,
  deleteSlot,
} from '../lib/admin-api'

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN FESTIVAL EDIT — /admin/festivals/:id
   Metadata form + inline-editable timetable slots table.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Shared styles ─────────────────────────────────────────────────────────────

const fieldLabel = {
  display:       'block',
  fontFamily:    T.body,
  fontSize:      10,
  fontWeight:    800,
  letterSpacing: 2,
  textTransform: 'uppercase',
  color:         'var(--fp-text-mute)',
  marginBottom:  5,
}

const textInput = (error) => ({
  width:        '100%',
  boxSizing:    'border-box',
  background:   'var(--fp-s2)',
  border:       `1px solid ${error ? '#f44336' : 'var(--fp-border)'}`,
  borderRadius: 'var(--fp-radius-sm)',
  padding:      '8px 12px',
  fontFamily:   T.body,
  fontSize:     13,
  color:        'var(--fp-text)',
  outline:      'none',
})

const sectionCard = {
  background:   'var(--fp-s1)',
  border:       '1px solid var(--fp-border)',
  borderRadius: 'var(--fp-radius-lg)',
  padding:      '24px 28px',
  marginBottom: 24,
}

const sectionTitle = {
  fontFamily:    T.display,
  fontSize:      14,
  fontWeight:    900,
  color:         'var(--fp-text)',
  textTransform: 'uppercase',
  letterSpacing: 2,
  marginBottom:  20,
}

// ── Toast helper ──────────────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState(null)
  const show = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])
  return [toast, show]
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminFestivalEdit({ session }) {
  const navigate   = useNavigate()
  const { id: festivalKey } = useParams()
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL

  // ── Auth gate ──────────────────────────────────────────────────────────────
  if (!session || session.user.email !== adminEmail) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', flexDirection: 'column', gap: 16, fontFamily: T.body,
      }}>
        <div style={{ fontSize: 32 }}>🚫</div>
        <div style={{ fontSize: 14, color: 'var(--fp-text-mute)' }}>Access denied</div>
        <button onClick={() => navigate('/')} style={{ ...pillBtn(false), marginTop: 8 }}>
          ← Back
        </button>
      </div>
    )
  }

  const [loading, setLoading]   = useState(true)
  const [loadErr, setLoadErr]   = useState(null)
  const [meta,    setMeta]      = useState(null)
  const [slots,   setSlots]     = useState([])   // server-confirmed rows
  const [toast, showToast]      = useToast()

  // ── Load festival ──────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    getFestivalWithSlots(decodeURIComponent(festivalKey))
      .then(({ meta, slots }) => {
        setMeta(meta)
        setSlots(slots)
        setLoading(false)
      })
      .catch(e => {
        setLoadErr(e.message)
        setLoading(false)
      })
  }, [festivalKey])

  if (loading) return <LoadingScreen />
  if (loadErr)  return <ErrorScreen msg={loadErr} onBack={() => navigate('/admin/festivals')} />

  return (
    <div style={{
      minHeight:  '100vh',
      background: 'var(--fp-bg)',
      padding:    '40px 24px',
      fontFamily: T.body,
    }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28, flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate('/admin/festivals')}
            style={{ ...pillBtn(false) }}
          >
            ← All Festivals
          </button>
          <div style={{
            fontFamily: T.display, fontSize: 22, fontWeight: 900,
            color: meta?.accent_color || '#c8f400', textTransform: 'uppercase',
            letterSpacing: 1, flex: 1,
          }}>
            {meta?.emoji || '🎵'} {meta?.name}
          </div>
          <div style={{
            fontFamily: T.body, fontSize: 10, fontWeight: 700,
            color: 'var(--fp-text-mute)', letterSpacing: 1.5, textTransform: 'uppercase',
          }}>
            {festivalKey}
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div style={{
            position:     'fixed', top: 20, right: 20, zIndex: 9999,
            padding:      '10px 18px',
            borderRadius: 'var(--fp-radius-md)',
            background:   toast.type === 'error' ? 'rgba(244,67,54,0.15)' : 'rgba(200,244,0,0.12)',
            border:       `1px solid ${toast.type === 'error' ? '#f44336' : '#c8f400'}`,
            color:        toast.type === 'error' ? '#f44336' : '#c8f400',
            fontFamily:   T.body, fontSize: 13, fontWeight: 600,
            boxShadow:    '0 4px 20px rgba(0,0,0,0.3)',
            animation:    'fp-fadeIn 0.2s ease both',
          }}>
            {toast.type === 'error' ? '✗ ' : '✓ '}{toast.msg}
          </div>
        )}

        {/* Metadata form */}
        <MetaForm
          meta={meta}
          festivalKey={decodeURIComponent(festivalKey)}
          onSaved={(updated) => { setMeta(updated); showToast('Metadata saved') }}
          onError={(e) => showToast(e, 'error')}
        />

        {/* Timetable slots */}
        <SlotsTable
          slots={slots}
          meta={meta}
          festivalKey={decodeURIComponent(festivalKey)}
          onSlotsChange={setSlots}
          showToast={showToast}
        />

      </div>
    </div>
  )
}

// ── MetaForm ──────────────────────────────────────────────────────────────────

function MetaForm({ meta, festivalKey, onSaved, onError }) {
  const [form,    setForm]    = useState({
    name:         meta?.name         || '',
    location:     meta?.location     || '',
    emoji:        meta?.emoji        || '🎵',
    accent_color: meta?.accent_color || '',
    start_date:   meta?.start_date   || '',
    end_date:     meta?.end_date     || '',
    // Arrays stored as newline-separated text in the textarea
    days:   (meta?.days   || []).join('\n'),
    stages: (meta?.stages || []).join('\n'),
  })
  const [saving, setSaving] = useState(false)

  function set(key, val) { setForm(f => ({ ...f, [key]: val })) }

  async function handleSave() {
    setSaving(true)
    try {
      const updates = {
        name:         form.name.trim(),
        location:     form.location.trim(),
        emoji:        form.emoji.trim() || '🎵',
        accent_color: form.accent_color.trim() || null,
        start_date:   form.start_date || null,
        end_date:     form.end_date   || null,
        days:   form.days.split('\n').map(s => s.trim()).filter(Boolean),
        stages: form.stages.split('\n').map(s => s.trim()).filter(Boolean),
      }
      const saved = await updateFestivalMeta(festivalKey, updates)
      onSaved(saved)
    } catch (e) {
      onError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={sectionCard}>
      <div style={sectionTitle}>Festival Metadata</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>

        <Field label="Name" span={2}>
          <input
            type="text" value={form.name}
            onChange={e => set('name', e.target.value)}
            style={textInput(false)}
          />
        </Field>

        <Field label="Location">
          <input
            type="text" value={form.location}
            onChange={e => set('location', e.target.value)}
            placeholder="City, Country"
            style={textInput(false)}
          />
        </Field>

        <Field label="Emoji">
          <input
            type="text" value={form.emoji}
            onChange={e => set('emoji', e.target.value)}
            style={{ ...textInput(false), maxWidth: 80 }}
          />
        </Field>

        <Field label="Accent colour (hex)">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text" value={form.accent_color}
              onChange={e => set('accent_color', e.target.value)}
              placeholder="#c8f400"
              style={{ ...textInput(false), flex: 1 }}
            />
            {form.accent_color && (
              <div style={{
                width: 28, height: 28, borderRadius: 'var(--fp-radius-sm)',
                background: form.accent_color,
                border: '1px solid var(--fp-border)',
                flexShrink: 0,
              }} />
            )}
          </div>
        </Field>

        <Field label="Start date">
          <input
            type="date" value={form.start_date}
            onChange={e => set('start_date', e.target.value)}
            style={textInput(false)}
          />
        </Field>

        <Field label="End date">
          <input
            type="date" value={form.end_date}
            onChange={e => set('end_date', e.target.value)}
            style={textInput(false)}
          />
        </Field>

        <Field label="Days (one per line)" span={2}>
          <textarea
            value={form.days}
            onChange={e => set('days', e.target.value)}
            rows={4}
            placeholder={'Fri Jun 27\nSat Jun 28\nSun Jun 29'}
            style={{ ...textInput(false), resize: 'vertical', minHeight: 80 }}
          />
          <div style={{ fontSize: 10, color: 'var(--fp-text-mute)', marginTop: 4 }}>
            One display label per line — used as day tab titles in the schedule.
          </div>
        </Field>

        <Field label="Stages (one per line)" span={2}>
          <textarea
            value={form.stages}
            onChange={e => set('stages', e.target.value)}
            rows={4}
            placeholder={'Pyramid Stage\nOther Stage\nWest Holts'}
            style={{ ...textInput(false), resize: 'vertical', minHeight: 80 }}
          />
        </Field>

      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            ...pillBtn(true),
            opacity: saving ? 0.6 : 1,
            minWidth: 120,
          }}
        >
          {saving ? 'Saving…' : 'Save Metadata'}
        </button>
      </div>
    </div>
  )
}

// ── SlotsTable ────────────────────────────────────────────────────────────────

// Column widths for consistent layout
const COL = {
  artist:    '25%',
  stage:     '20%',
  day:       '8%',
  start:     '10%',
  end:       '10%',
  actions:   '5%',
}

// A locally-tracked slot may be:
//   { id, festival_key, artist, stage, day_index, start_time, end_time }  — existing
//   { _localId, festival_key, artist:'', ... }  — new, not yet saved

let _localIdCounter = 1

function SlotsTable({ slots, meta, festivalKey, onSlotsChange, showToast }) {
  // localSlots mirrors server slots + pending new rows
  const [localSlots, setLocalSlots] = useState(slots)
  const [saving, setSaving]         = useState({})   // { [id|_localId]: true }

  // Sync when parent refreshes (e.g. initial load)
  useEffect(() => { setLocalSlots(slots) }, [slots])

  const stages = meta?.stages || []

  function updateLocal(key, field, value) {
    setLocalSlots(ls => ls.map(s =>
      (s.id ?? s._localId) === key ? { ...s, [field]: value } : s
    ))
  }

  function addRow() {
    const _localId = `new-${_localIdCounter++}`
    setLocalSlots(ls => [...ls, {
      _localId,
      festival_key: festivalKey,
      artist:       '',
      stage:        stages[0] || '',
      day_index:    0,
      start_time:   null,
      end_time:     null,
    }])
  }

  async function saveRow(slot) {
    const key = slot.id ?? slot._localId
    setSaving(s => ({ ...s, [key]: true }))
    try {
      const payload = {
        id:           slot.id || undefined,
        festival_key: festivalKey,
        artist:       slot.artist?.trim(),
        stage:        slot.stage || null,
        day_index:    Number(slot.day_index) || 0,
        start_time:   slot.start_time?.trim() || null,
        end_time:     slot.end_time?.trim()   || null,
      }
      if (!payload.artist) {
        showToast('Artist name is required', 'error')
        return
      }
      const saved = await upsertSlot(payload)
      // Replace local row with server row (gets a real id)
      setLocalSlots(ls => ls.map(s =>
        (s.id ?? s._localId) === key ? saved : s
      ))
      onSlotsChange(prev =>
        prev.some(s => s.id === saved.id)
          ? prev.map(s => s.id === saved.id ? saved : s)
          : [...prev, saved]
      )
      showToast(`Saved ${saved.artist}`)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setSaving(s => ({ ...s, [key]: false }))
    }
  }

  async function removeRow(slot) {
    const key = slot.id ?? slot._localId
    if (!slot.id) {
      // Unsaved row — just remove locally
      setLocalSlots(ls => ls.filter(s => (s.id ?? s._localId) !== key))
      return
    }
    setSaving(s => ({ ...s, [key]: true }))
    try {
      await deleteSlot(slot.id)
      setLocalSlots(ls => ls.filter(s => s.id !== slot.id))
      onSlotsChange(prev => prev.filter(s => s.id !== slot.id))
      showToast('Slot deleted')
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setSaving(s => ({ ...s, [key]: false }))
    }
  }

  return (
    <div style={sectionCard}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20,
      }}>
        <div style={sectionTitle}>Timetable Slots</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{
            fontFamily: T.body, fontSize: 10, fontWeight: 700,
            color: 'var(--fp-text-mute)', letterSpacing: 1, textTransform: 'uppercase',
          }}>
            {localSlots.length} slot{localSlots.length !== 1 ? 's' : ''}
          </div>
          <button onClick={addRow} style={{ ...pillBtn(false), display: 'flex', gap: 6, alignItems: 'center' }}>
            + Add Slot
          </button>
        </div>
      </div>

      {localSlots.length === 0 ? (
        <div style={{
          padding: '24px', textAlign: 'center',
          color: 'var(--fp-text-mute)', fontSize: 13,
          border: '1px dashed var(--fp-border)', borderRadius: 'var(--fp-radius-md)',
        }}>
          No slots yet.  Click "+ Add Slot" to add artists and times.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `${COL.artist} ${COL.stage} ${COL.day} ${COL.start} ${COL.end} ${COL.actions}`,
            gap: '0 8px',
            padding: '0 4px 6px',
            borderBottom: '1px solid var(--fp-border)',
            marginBottom: 4,
          }}>
            {['Artist', 'Stage', 'Day', 'Start', 'End', ''].map(h => (
              <div key={h} style={{
                fontFamily: T.body, fontSize: 9, fontWeight: 800,
                color: 'var(--fp-text-mute)', letterSpacing: 2, textTransform: 'uppercase',
              }}>
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {localSlots.map(slot => (
              <SlotRow
                key={slot.id ?? slot._localId}
                slot={slot}
                stages={stages}
                isSaving={saving[slot.id ?? slot._localId] || false}
                onFieldChange={(field, val) => updateLocal(slot.id ?? slot._localId, field, val)}
                onSave={() => saveRow(slot)}
                onDelete={() => removeRow(slot)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── SlotRow ───────────────────────────────────────────────────────────────────

function SlotRow({ slot, stages, isSaving, onFieldChange, onSave, onDelete }) {
  const isNew = !slot.id
  const [hovered, setHovered] = useState(false)

  const cellInput = {
    width:        '100%',
    boxSizing:    'border-box',
    background:   'var(--fp-s2)',
    border:       '1px solid var(--fp-border)',
    borderRadius: 'var(--fp-radius-sm)',
    padding:      '5px 8px',
    fontFamily:   T.body,
    fontSize:     12,
    color:        'var(--fp-text)',
    outline:      'none',
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: `${COL.artist} ${COL.stage} ${COL.day} ${COL.start} ${COL.end} ${COL.actions}`,
        gap: '0 8px',
        alignItems: 'center',
        padding: '4px',
        borderRadius: 'var(--fp-radius-sm)',
        background: isNew ? 'rgba(200,244,0,0.04)' : (hovered ? 'var(--fp-s2)' : 'transparent'),
        border: `1px solid ${isNew ? 'rgba(200,244,0,0.2)' : (hovered ? 'var(--fp-border)' : 'transparent')}`,
        transition: 'background 0.1s ease',
        opacity: isSaving ? 0.6 : 1,
      }}
    >
      {/* Artist */}
      <input
        type="text"
        value={slot.artist || ''}
        onChange={e => onFieldChange('artist', e.target.value)}
        onBlur={onSave}
        placeholder="Artist name"
        style={cellInput}
      />

      {/* Stage — dropdown if stages defined, text otherwise */}
      {stages.length > 0 ? (
        <select
          value={slot.stage || ''}
          onChange={e => { onFieldChange('stage', e.target.value); }}
          onBlur={onSave}
          style={{ ...cellInput, cursor: 'pointer' }}
        >
          <option value="">— no stage —</option>
          {stages.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      ) : (
        <input
          type="text"
          value={slot.stage || ''}
          onChange={e => onFieldChange('stage', e.target.value)}
          onBlur={onSave}
          placeholder="Stage"
          style={cellInput}
        />
      )}

      {/* Day index */}
      <input
        type="number"
        value={slot.day_index ?? 0}
        min={0}
        onChange={e => onFieldChange('day_index', e.target.value)}
        onBlur={onSave}
        style={{ ...cellInput, textAlign: 'center' }}
      />

      {/* Start time */}
      <input
        type="text"
        value={slot.start_time || ''}
        onChange={e => onFieldChange('start_time', e.target.value)}
        onBlur={onSave}
        placeholder="21:00"
        style={cellInput}
      />

      {/* End time */}
      <input
        type="text"
        value={slot.end_time || ''}
        onChange={e => onFieldChange('end_time', e.target.value)}
        onBlur={onSave}
        placeholder="22:30"
        style={cellInput}
      />

      {/* Delete button */}
      <button
        onClick={onDelete}
        disabled={isSaving}
        title="Delete slot"
        style={{
          background:   'transparent',
          border:       '1px solid transparent',
          borderRadius: 'var(--fp-radius-sm)',
          color:        hovered ? '#f44336' : 'var(--fp-text-mute)',
          cursor:       'pointer',
          padding:      '4px 6px',
          fontSize:     14,
          lineHeight:   1,
          transition:   'color 0.15s ease',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'center',
        }}
      >
        ✕
      </button>
    </div>
  )
}

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({ label, children, span = 1 }) {
  return (
    <div style={{ gridColumn: span === 2 ? '1 / -1' : undefined }}>
      <label style={fieldLabel}>{label}</label>
      {children}
    </div>
  )
}

// ── Loading / Error screens ───────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', flexDirection: 'column', gap: 16, fontFamily: T.body,
    }}>
      <div style={{
        width: 20, height: 20,
        border: '2px solid #c8f400', borderTopColor: 'transparent',
        borderRadius: '50%', animation: 'fp-spin 0.8s linear infinite',
      }} />
      <div style={{ fontSize: 11, color: 'var(--fp-text-mute)', letterSpacing: 4, textTransform: 'uppercase' }}>
        Loading
      </div>
    </div>
  )
}

function ErrorScreen({ msg, onBack }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', flexDirection: 'column', gap: 16, fontFamily: T.body,
    }}>
      <div style={{ fontSize: 13, color: '#f44336' }}>{msg}</div>
      <button onClick={onBack} style={{ ...pillBtn(false) }}>← Back</button>
    </div>
  )
}
