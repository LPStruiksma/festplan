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

   Tab bar:  Metadata | Day 1 | Day 2 | … | (All Slots)

   • Metadata tab  — existing MetaForm, completely unchanged.
   • Day tabs      — per-stage column grid.  Each column has inline slot
                     cards (artist + start→end), a "Paste" button for bulk
                     entry, and an "+ Add Slot" button at the bottom.
   • All Slots tab — the original flat table, kept for a bird's-eye view.

   Bulk paste format per line:  Artist,HH:MM,HH:MM
                             or Artist,HH:MM   (end = start + 60 min)

   End-time auto-suggest: focusing an empty end_time field fills it with
   start_time + 60 min (both in the stage cards and the flat table).
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

const cellInputStyle = {
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

// ── Time helpers ──────────────────────────────────────────────────────────────

/** "21:30" + 60 min → "22:30".  Returns "" if input is invalid. */
function addSixtyMin(timeStr) {
  if (!timeStr) return ''
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return ''
  const totalMin = Number(match[1]) * 60 + Number(match[2]) + 60
  const h = Math.floor(totalMin / 60) % 24
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Parse one bulk-paste line into { artist, start_time, end_time }. */
function parseBulkLine(line) {
  const parts = line.split(',').map(s => s.trim())
  const artist    = parts[0] || ''
  const startTime = parts[1] || null
  const endTime   = parts[2] || (startTime ? addSixtyMin(startTime) || null : null)
  return { artist, start_time: startTime, end_time: endTime }
}

/** Derive day tabs [{value:0, label:'Fri Jun 27'}, …] from meta. */
function getDayTabs(meta) {
  if (!meta) return []
  if (meta.days?.length > 0) {
    return meta.days.map((label, i) => ({ value: i, label }))
  }
  if (meta.start_date && meta.end_date) {
    const tabs = []
    const cur  = new Date(meta.start_date + 'T12:00:00Z')
    const end  = new Date(meta.end_date   + 'T12:00:00Z')
    let i = 0
    while (cur <= end) {
      tabs.push({ value: i, label: `Day ${i + 1}` })
      cur.setUTCDate(cur.getUTCDate() + 1)
      i++
    }
    return tabs
  }
  return [{ value: 0, label: 'Day 1' }]
}

// ── Local ID counter ──────────────────────────────────────────────────────────

let _localIdCounter = 1

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

  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [meta,    setMeta]    = useState(null)
  const [slots,   setSlots]   = useState([])
  const [toast,   showToast]  = useToast()
  const [activeTab, setActiveTab] = useState('metadata')

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

  const dayTabs = getDayTabs(meta)

  return (
    <div style={{
      minHeight:  '100vh',
      background: 'var(--fp-bg)',
      padding:    '40px 24px',
      fontFamily: T.body,
    }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/admin/festivals')} style={{ ...pillBtn(false) }}>
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

        {/* ── Toast ── */}
        {toast && (
          <div style={{
            position: 'fixed', top: 20, right: 20, zIndex: 9999,
            padding: '10px 18px', borderRadius: 'var(--fp-radius-md)',
            background: toast.type === 'error' ? 'rgba(244,67,54,0.15)' : 'rgba(200,244,0,0.12)',
            border:     `1px solid ${toast.type === 'error' ? '#f44336' : '#c8f400'}`,
            color:      toast.type === 'error' ? '#f44336' : '#c8f400',
            fontFamily: T.body, fontSize: 13, fontWeight: 600,
            boxShadow:  '0 4px 20px rgba(0,0,0,0.3)',
          }}>
            {toast.type === 'error' ? '✗ ' : '✓ '}{toast.msg}
          </div>
        )}

        {/* ── Tab bar ── */}
        <TabBar
          dayTabs={dayTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {/* ── Tab content ── */}
        {activeTab === 'metadata' && (
          <MetaForm
            meta={meta}
            festivalKey={decodeURIComponent(festivalKey)}
            onSaved={(updated) => { setMeta(updated); showToast('Metadata saved') }}
            onError={(e) => showToast(e, 'error')}
          />
        )}

        {typeof activeTab === 'number' && (
          <DayView
            key={activeTab}
            dayIndex={activeTab}
            meta={meta}
            slots={slots}
            festivalKey={decodeURIComponent(festivalKey)}
            onSlotsChange={setSlots}
            showToast={showToast}
          />
        )}

        {activeTab === 'all' && (
          <SlotsTable
            slots={slots}
            meta={meta}
            festivalKey={decodeURIComponent(festivalKey)}
            onSlotsChange={setSlots}
            showToast={showToast}
          />
        )}

      </div>
    </div>
  )
}

// ── TabBar ────────────────────────────────────────────────────────────────────

function TabBar({ dayTabs, activeTab, onTabChange }) {
  const pill = (isActive) => ({
    background:    isActive ? '#c8f400' : 'transparent',
    color:         isActive ? '#000'    : 'var(--fp-text-mute)',
    border:        'none',
    borderRadius:  'var(--fp-radius-md)',
    padding:       '7px 14px',
    fontFamily:    T.body,
    fontSize:      11,
    fontWeight:    800,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    cursor:        'pointer',
    whiteSpace:    'nowrap',
    transition:    'background 0.15s, color 0.15s',
  })

  return (
    <div style={{
      display:       'flex',
      gap:           4,
      alignItems:    'center',
      background:    'var(--fp-s1)',
      border:        '1px solid var(--fp-border)',
      borderRadius:  'var(--fp-radius-lg)',
      padding:       5,
      marginBottom:  24,
      overflowX:     'auto',
    }}>
      {/* Metadata */}
      <button onClick={() => onTabChange('metadata')} style={pill(activeTab === 'metadata')}>
        Metadata
      </button>

      {/* Divider */}
      {dayTabs.length > 0 && (
        <div style={{ width: 1, height: 18, background: 'var(--fp-border)', flexShrink: 0, margin: '0 2px' }} />
      )}

      {/* Day tabs */}
      {dayTabs.map(tab => (
        <button key={tab.value} onClick={() => onTabChange(tab.value)} style={pill(activeTab === tab.value)}>
          {tab.label}
        </button>
      ))}

      {/* Spacer + All Slots link */}
      <div style={{ flex: 1 }} />
      <button
        onClick={() => onTabChange('all')}
        style={{
          ...pill(activeTab === 'all'),
          color:         activeTab === 'all' ? '#000' : 'var(--fp-text-mute)',
          background:    activeTab === 'all' ? '#c8f400' : 'transparent',
          opacity:       activeTab === 'all' ? 1 : 0.7,
          fontSize:      10,
        }}
      >
        ≡ All Slots
      </button>
    </div>
  )
}

// ── DayView ───────────────────────────────────────────────────────────────────

function DayView({ dayIndex, meta, slots, festivalKey, onSlotsChange, showToast }) {
  const [localSlots, setLocalSlots] = useState(slots)
  const [saving,     setSaving]     = useState({})
  const [bulkModal,  setBulkModal]  = useState(null) // { stage } | null

  useEffect(() => { setLocalSlots(slots) }, [slots])

  const definedStages = meta?.stages?.length > 0 ? meta.stages : []

  // Slots for this day
  const dayLocalSlots = localSlots.filter(s => Number(s.day_index) === dayIndex)

  // Slots with a stage not in definedStages (or no stage at all)
  const unassigned = dayLocalSlots.filter(s => !s.stage || !definedStages.includes(s.stage))

  // Always show defined stage columns; show "No Stage" only if there are unassigned slots
  const columns = definedStages.length > 0
    ? (unassigned.length > 0 ? [...definedStages, ''] : definedStages)
    : ['']   // no stages defined → single unnamed column

  function getStageSlots(stage) {
    const list = stage === ''
      ? dayLocalSlots.filter(s => !s.stage || !definedStages.includes(s.stage))
      : dayLocalSlots.filter(s => s.stage === stage)

    return [...list].sort((a, b) => {
      if (!a.start_time && !b.start_time) return 0
      if (!a.start_time) return 1
      if (!b.start_time) return -1
      return a.start_time.localeCompare(b.start_time)
    })
  }

  function updateLocal(key, field, value) {
    setLocalSlots(ls => ls.map(s =>
      (s.id ?? s._localId) === key ? { ...s, [field]: value } : s
    ))
  }

  function addSlot(stage) {
    const _localId = `new-${_localIdCounter++}`
    setLocalSlots(ls => [...ls, {
      _localId,
      festival_key: festivalKey,
      artist:       '',
      stage:        stage || null,
      day_index:    dayIndex,
      start_time:   null,
      end_time:     null,
    }])
  }

  async function saveSlot(slot) {
    const key = slot.id ?? slot._localId
    setSaving(s => ({ ...s, [key]: true }))
    try {
      const payload = {
        id:           slot.id || undefined,
        festival_key: festivalKey,
        artist:       slot.artist?.trim(),
        stage:        slot.stage || null,
        day_index:    dayIndex,
        start_time:   slot.start_time?.trim() || null,
        end_time:     slot.end_time?.trim()   || null,
      }
      if (!payload.artist) {
        showToast('Artist name is required', 'error')
        return
      }
      const saved = await upsertSlot(payload)
      setLocalSlots(ls => ls.map(s => (s.id ?? s._localId) === key ? saved : s))
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

  async function removeSlot(slot) {
    const key = slot.id ?? slot._localId
    if (!slot.id) {
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

  function handleBulkSuccess(newSlots) {
    const merge = (list) => {
      const ids = new Set(list.map(s => s.id).filter(Boolean))
      const updated = list.map(s => newSlots.find(ns => ns.id === s.id) || s)
      const added   = newSlots.filter(ns => !ids.has(ns.id))
      return [...updated, ...added]
    }
    setLocalSlots(merge)
    onSlotsChange(merge)
    setBulkModal(null)
    showToast(`Added ${newSlots.length} slot${newSlots.length !== 1 ? 's' : ''}`)
  }

  const totalDay = dayLocalSlots.filter(s => s.id).length   // saved slots on this day

  return (
    <>
      {/* Day summary */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          fontFamily: T.body, fontSize: 10, fontWeight: 700,
          color: 'var(--fp-text-mute)', letterSpacing: 1.5, textTransform: 'uppercase',
        }}>
          {totalDay} slot{totalDay !== 1 ? 's' : ''} across {columns.filter(c => c !== '').length || 1} stage{(columns.filter(c => c !== '').length || 1) !== 1 ? 's' : ''}
        </div>
        {definedStages.length === 0 && (
          <div style={{ fontFamily: T.body, fontSize: 11, color: '#f44336' }}>
            No stages defined — add them in the Metadata tab.
          </div>
        )}
      </div>

      {/* Stage columns */}
      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <div style={{
          display:               'grid',
          gridTemplateColumns:   `repeat(${columns.length}, 236px)`,
          gap:                   12,
          minWidth:              columns.length * 248,
        }}>
          {columns.map(stage => (
            <StageColumn
              key={stage || '__no_stage__'}
              stage={stage}
              slots={getStageSlots(stage)}
              saving={saving}
              onUpdateField={updateLocal}
              onSave={saveSlot}
              onDelete={removeSlot}
              onAddSlot={addSlot}
              onBulkPaste={(s) => setBulkModal({ stage: s })}
            />
          ))}
        </div>
      </div>

      {/* Bulk paste modal */}
      {bulkModal && (
        <BulkPasteModal
          stage={bulkModal.stage}
          dayIndex={dayIndex}
          festivalKey={festivalKey}
          onClose={() => setBulkModal(null)}
          onSuccess={handleBulkSuccess}
        />
      )}
    </>
  )
}

// ── StageColumn ───────────────────────────────────────────────────────────────

function StageColumn({ stage, slots, saving, onUpdateField, onSave, onDelete, onAddSlot, onBulkPaste }) {
  const displayName = stage || 'No Stage'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

      {/* Column header */}
      <div style={{
        padding:      '10px 12px',
        background:   'var(--fp-s1)',
        borderRadius: 'var(--fp-radius-md)',
        border:       '1px solid var(--fp-border)',
      }}>
        <div style={{
          fontFamily:    T.body,
          fontSize:      10,
          fontWeight:    800,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          color:         'var(--fp-text)',
          marginBottom:  6,
        }}>
          {displayName}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: T.body, fontSize: 10, color: 'var(--fp-text-mute)' }}>
            {slots.filter(s => s.id).length} slot{slots.filter(s => s.id).length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => onBulkPaste(stage)}
            style={{
              marginLeft:    'auto',
              background:    'var(--fp-s2)',
              border:        '1px solid var(--fp-border)',
              borderRadius:  'var(--fp-radius-sm)',
              padding:       '3px 9px',
              fontFamily:    T.body,
              fontSize:      9,
              fontWeight:    800,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color:         'var(--fp-text-mute)',
              cursor:        'pointer',
              transition:    'color 0.15s',
            }}
          >
            ⊞ Paste
          </button>
        </div>
      </div>

      {/* Slot cards */}
      {slots.map(slot => (
        <StagedSlotCard
          key={slot.id ?? slot._localId}
          slot={slot}
          isSaving={saving[slot.id ?? slot._localId] || false}
          onFieldChange={(field, val) => onUpdateField(slot.id ?? slot._localId, field, val)}
          onSave={() => onSave(slot)}
          onDelete={() => onDelete(slot)}
        />
      ))}

      {/* Add slot */}
      <button
        onClick={() => onAddSlot(stage)}
        style={{
          background:   'transparent',
          border:       '1px dashed var(--fp-border)',
          borderRadius: 'var(--fp-radius-sm)',
          padding:      '7px',
          fontFamily:   T.body,
          fontSize:     11,
          fontWeight:   700,
          color:        'var(--fp-text-mute)',
          cursor:       'pointer',
          textAlign:    'center',
        }}
      >
        + Add Slot
      </button>
    </div>
  )
}

// ── StagedSlotCard ────────────────────────────────────────────────────────────

function StagedSlotCard({ slot, isSaving, onFieldChange, onSave, onDelete }) {
  const isNew   = !slot.id
  const [hovered, setHovered] = useState(false)

  function handleEndTimeFocus() {
    if (!slot.end_time && slot.start_time) {
      const suggested = addSixtyMin(slot.start_time)
      if (suggested) onFieldChange('end_time', suggested)
    }
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding:      '8px 10px',
        borderRadius: 'var(--fp-radius-sm)',
        background:   isNew   ? 'rgba(200,244,0,0.04)' : 'var(--fp-s1)',
        border:       `1px solid ${isNew ? 'rgba(200,244,0,0.25)' : 'var(--fp-border)'}`,
        opacity:      isSaving ? 0.6 : 1,
        display:      'flex',
        flexDirection: 'column',
        gap:          6,
        transition:   'border-color 0.1s',
      }}
    >
      {/* Artist */}
      <input
        type="text"
        value={slot.artist || ''}
        onChange={e => onFieldChange('artist', e.target.value)}
        onBlur={onSave}
        placeholder="Artist name"
        style={cellInputStyle}
      />

      {/* Time row */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <input
          type="text"
          value={slot.start_time || ''}
          onChange={e => onFieldChange('start_time', e.target.value)}
          onBlur={onSave}
          placeholder="21:00"
          style={{ ...cellInputStyle, flex: 1, textAlign: 'center' }}
        />
        <span style={{ color: 'var(--fp-text-mute)', fontSize: 10, flexShrink: 0 }}>→</span>
        <input
          type="text"
          value={slot.end_time || ''}
          onChange={e => onFieldChange('end_time', e.target.value)}
          onFocus={handleEndTimeFocus}
          onBlur={onSave}
          placeholder="22:00"
          style={{ ...cellInputStyle, flex: 1, textAlign: 'center' }}
        />

        {/* Delete */}
        <button
          onClick={onDelete}
          disabled={isSaving}
          title="Delete slot"
          style={{
            background:  'transparent',
            border:      'none',
            color:       hovered ? '#f44336' : 'transparent',
            cursor:      'pointer',
            padding:     '2px 4px',
            fontSize:    12,
            lineHeight:  1,
            flexShrink:  0,
            transition:  'color 0.15s',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// ── BulkPasteModal ────────────────────────────────────────────────────────────

function BulkPasteModal({ stage, dayIndex, festivalKey, onClose, onSuccess }) {
  const [text,    setText]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)
  const [preview, setPreview] = useState([])

  useEffect(() => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    setPreview(lines.map(parseBulkLine).filter(p => p.artist))
  }, [text])

  async function handleSubmit() {
    if (preview.length === 0) return
    setSaving(true)
    setError(null)
    try {
      const results = []
      for (const p of preview) {
        const saved = await upsertSlot({
          festival_key: festivalKey,
          artist:       p.artist,
          stage:        stage || null,
          day_index:    dayIndex,
          start_time:   p.start_time || null,
          end_time:     p.end_time   || null,
        })
        results.push(saved)
      }
      onSuccess(results)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const modalInput = {
    width:        '100%',
    boxSizing:    'border-box',
    background:   'var(--fp-s2)',
    border:       '1px solid var(--fp-border)',
    borderRadius: 'var(--fp-radius-md)',
    padding:      '10px 14px',
    fontFamily:   T.body,
    fontSize:     13,
    color:        'var(--fp-text)',
    outline:      'none',
    resize:       'vertical',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background:   'var(--fp-s1)',
        border:       '1px solid var(--fp-border)',
        borderRadius: 'var(--fp-radius-lg)',
        padding:      '28px 32px',
        width:        '100%',
        maxWidth:     480,
        maxHeight:    '85vh',
        overflowY:    'auto',
      }}>
        {/* Title */}
        <div style={{
          fontFamily: T.display, fontSize: 14, fontWeight: 900,
          textTransform: 'uppercase', letterSpacing: 2,
          color: 'var(--fp-text)', marginBottom: 4,
        }}>
          Bulk paste
        </div>
        <div style={{
          fontFamily: T.body, fontSize: 11, color: 'var(--fp-text-mute)',
          marginBottom: 16, lineHeight: 1.5,
        }}>
          Stage: <strong style={{ color: 'var(--fp-text)' }}>{stage || 'No Stage'}</strong>
          {' · '}
          Format:{' '}
          <code style={{ background: 'var(--fp-s2)', padding: '1px 5px', borderRadius: 3 }}>
            Artist,HH:MM,HH:MM
          </code>
          {' '}or{' '}
          <code style={{ background: 'var(--fp-s2)', padding: '1px 5px', borderRadius: 3 }}>
            Artist,HH:MM
          </code>
          {' '}(end = start + 60 min)
        </div>

        {/* Textarea */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={9}
          placeholder={'Radiohead,21:00,23:00\nBicep,18:30\nSlowdive,16:00,17:30'}
          style={modalInput}
          autoFocus
        />

        {/* Live preview */}
        {preview.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{
              fontFamily: T.body, fontSize: 9, fontWeight: 800,
              letterSpacing: 2, textTransform: 'uppercase',
              color: 'var(--fp-text-mute)', marginBottom: 8,
            }}>
              Preview — {preview.length} slot{preview.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {preview.map((p, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, alignItems: 'center',
                  padding: '4px 10px',
                  background: 'var(--fp-s2)',
                  borderRadius: 'var(--fp-radius-sm)',
                  fontFamily: T.body, fontSize: 12,
                }}>
                  <span style={{ flex: 1, color: 'var(--fp-text)' }}>{p.artist}</span>
                  <span style={{ color: 'var(--fp-text-mute)', fontSize: 11, flexShrink: 0 }}>
                    {p.start_time || '—'} → {p.end_time || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, color: '#f44336', fontFamily: T.body, fontSize: 12 }}>
            ✗ {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ ...pillBtn(false) }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || preview.length === 0}
            style={{
              ...pillBtn(true),
              opacity:  saving || preview.length === 0 ? 0.5 : 1,
              minWidth: 110,
            }}
          >
            {saving
              ? 'Saving…'
              : `Add ${preview.length} Slot${preview.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── MetaForm ──────────────────────────────────────────────────────────────────

function MetaForm({ meta, festivalKey, onSaved, onError }) {
  const [form,   setForm]   = useState({
    name:         meta?.name         || '',
    location:     meta?.location     || '',
    emoji:        meta?.emoji        || '🎵',
    accent_color: meta?.accent_color || '',
    start_date:   meta?.start_date   || '',
    end_date:     meta?.end_date     || '',
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
                background: form.accent_color, border: '1px solid var(--fp-border)',
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
          style={{ ...pillBtn(true), opacity: saving ? 0.6 : 1, minWidth: 120 }}
        >
          {saving ? 'Saving…' : 'Save Metadata'}
        </button>
      </div>
    </div>
  )
}

// ── SlotsTable (flat, bird's-eye view) ────────────────────────────────────────

const COL = {
  artist:  '25%',
  stage:   '20%',
  day:     '8%',
  start:   '10%',
  end:     '10%',
  actions: '5%',
}

function SlotsTable({ slots, meta, festivalKey, onSlotsChange, showToast }) {
  const [localSlots, setLocalSlots] = useState(slots)
  const [saving,     setSaving]     = useState({})

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
      if (!payload.artist) { showToast('Artist name is required', 'error'); return }
      const saved = await upsertSlot(payload)
      setLocalSlots(ls => ls.map(s => (s.id ?? s._localId) === key ? saved : s))
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={sectionTitle}>All Timetable Slots</div>
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
          No slots yet. Click "+ Add Slot" to add artists and times.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `${COL.artist} ${COL.stage} ${COL.day} ${COL.start} ${COL.end} ${COL.actions}`,
            gap: '0 8px', padding: '0 4px 6px',
            borderBottom: '1px solid var(--fp-border)', marginBottom: 4,
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

// ── SlotRow (flat table row) ──────────────────────────────────────────────────

function SlotRow({ slot, stages, isSaving, onFieldChange, onSave, onDelete }) {
  const isNew = !slot.id
  const [hovered, setHovered] = useState(false)

  function handleEndTimeFocus() {
    if (!slot.end_time && slot.start_time) {
      const suggested = addSixtyMin(slot.start_time)
      if (suggested) onFieldChange('end_time', suggested)
    }
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display:             'grid',
        gridTemplateColumns: `${COL.artist} ${COL.stage} ${COL.day} ${COL.start} ${COL.end} ${COL.actions}`,
        gap:                 '0 8px',
        alignItems:          'center',
        padding:             '4px',
        borderRadius:        'var(--fp-radius-sm)',
        background:          isNew ? 'rgba(200,244,0,0.04)' : (hovered ? 'var(--fp-s2)' : 'transparent'),
        border:              `1px solid ${isNew ? 'rgba(200,244,0,0.2)' : (hovered ? 'var(--fp-border)' : 'transparent')}`,
        transition:          'background 0.1s ease',
        opacity:             isSaving ? 0.6 : 1,
      }}
    >
      {/* Artist */}
      <input
        type="text"
        value={slot.artist || ''}
        onChange={e => onFieldChange('artist', e.target.value)}
        onBlur={onSave}
        placeholder="Artist name"
        style={cellInputStyle}
      />

      {/* Stage */}
      {stages.length > 0 ? (
        <select
          value={slot.stage || ''}
          onChange={e => onFieldChange('stage', e.target.value)}
          onBlur={onSave}
          style={{ ...cellInputStyle, cursor: 'pointer' }}
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
          style={cellInputStyle}
        />
      )}

      {/* Day index */}
      <input
        type="number"
        value={slot.day_index ?? 0}
        min={0}
        onChange={e => onFieldChange('day_index', e.target.value)}
        onBlur={onSave}
        style={{ ...cellInputStyle, textAlign: 'center' }}
      />

      {/* Start time */}
      <input
        type="text"
        value={slot.start_time || ''}
        onChange={e => onFieldChange('start_time', e.target.value)}
        onBlur={onSave}
        placeholder="21:00"
        style={cellInputStyle}
      />

      {/* End time — auto-suggest on focus */}
      <input
        type="text"
        value={slot.end_time || ''}
        onChange={e => onFieldChange('end_time', e.target.value)}
        onFocus={handleEndTimeFocus}
        onBlur={onSave}
        placeholder="22:30"
        style={cellInputStyle}
      />

      {/* Delete */}
      <button
        onClick={onDelete}
        disabled={isSaving}
        title="Delete slot"
        style={{
          background:     'transparent',
          border:         '1px solid transparent',
          borderRadius:   'var(--fp-radius-sm)',
          color:          hovered ? '#f44336' : 'var(--fp-text-mute)',
          cursor:         'pointer',
          padding:        '4px 6px',
          fontSize:       14,
          lineHeight:     1,
          transition:     'color 0.15s ease',
          display:        'flex',
          alignItems:     'center',
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
