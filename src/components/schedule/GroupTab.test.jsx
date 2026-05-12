// @vitest-environment jsdom
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import GroupTab from './GroupTab'

// ── Mocks ─────────────────────────────────────────────────────────────────────

// GroupTab calls useIsMobile() — mock it as desktop so the participants list
// is always expanded and all buttons are visible.
vi.mock('../../lib/use-is-mobile', () => ({ useIsMobile: () => false }))

vi.mock('../../lib/festivals', () => ({
  norm:          (s) => (s || '').toLowerCase().trim(),
  toMins:        (t) => {
    if (!t) return 0
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  },
  FRIEND_COLORS: ['#ff6b6b', '#4ecdc4', '#45b7d1'],
}))

vi.mock('../../lib/ui', () => ({
  T:       { body: 'sans-serif', display: 'serif' },
  pillBtn: () => ({}),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FA = '#c8f400'

const FEST = {
  days:   ['Friday', 'Saturday'],
  lineup: [
    { artist: 'Radiohead', stage: 'Main Stage',  day: 0, start: '21:00', end: '23:00' },
    { artist: 'Bicep',     stage: 'Other Stage', day: 0, start: '22:30', end: '00:00' },
  ],
}

// Helper: build a friend object
function friend(name, artists = []) {
  return { name, artists, source_user_id: null }
}

// Shared props — override per test.  All vi.fn() callbacks are cleared
// between tests by beforeEach so call counts stay isolated.
const baseProps = {
  fa:             FA,
  fest:           FEST,
  isLineupOnly:   false,
  friends:        [],
  myArtists:      ['Radiohead'],
  day:            0,
  setDay:         vi.fn(),
  allParticipants:[{ name: 'Me', artists: ['Radiohead'], color: FA }],
  addingFriend:   false,
  setAddingFriend:vi.fn(),
  newFName:       '',
  setNewFName:    vi.fn(),
  newFArtists:    '',
  setNewFArtists: vi.fn(),
  onAddFriend:    vi.fn(),
  onRemoveFriend: vi.fn(),
  onInvite:       vi.fn(),
  inviteStatus:   'idle',
}

beforeEach(() => { vi.clearAllMocks() })

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GroupTab', () => {

  // ── Empty state ─────────────────────────────────────────────────────────────

  test('shows the empty-state CTA when friends list is empty', () => {
    render(<GroupTab {...baseProps} />)
    expect(screen.getByText('Add a friend to see your group picks')).toBeInTheDocument()
  })

  test('empty-state CTA disappears once a friend is present', () => {
    render(<GroupTab {...baseProps} friends={[friend('Alice', ['Bicep'])]} />)
    expect(screen.queryByText('Add a friend to see your group picks')).not.toBeInTheDocument()
  })

  // ── Add-friend button ────────────────────────────────────────────────────────

  test('"+ Add Friend" button is visible when friends.length < 3', () => {
    render(<GroupTab {...baseProps} friends={[]} />)
    expect(screen.getByRole('button', { name: '+ Add Friend' })).toBeInTheDocument()
  })

  test('"+ Add Friend" button is hidden when friends.length reaches 3', () => {
    const fullFriends = [
      friend('Alice', ['Radiohead']),
      friend('Bob',   ['Bicep']),
      friend('Carol', ['Caribou']),
    ]
    render(<GroupTab {...baseProps} friends={fullFriends} />)
    expect(screen.queryByRole('button', { name: '+ Add Friend' })).not.toBeInTheDocument()
  })

  test('clicking "+ Add Friend" calls setAddingFriend(true)', () => {
    render(<GroupTab {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add Friend' }))
    expect(baseProps.setAddingFriend).toHaveBeenCalledWith(true)
  })

  // ── Add-friend form ──────────────────────────────────────────────────────────

  test('add-friend form is hidden when addingFriend is false', () => {
    render(<GroupTab {...baseProps} addingFriend={false} />)
    expect(screen.queryByPlaceholderText("Friend's name")).not.toBeInTheDocument()
  })

  test('add-friend form is visible when addingFriend is true', () => {
    render(<GroupTab {...baseProps} addingFriend={true} />)
    expect(screen.getByPlaceholderText("Friend's name")).toBeInTheDocument()
  })

  test('clicking Add calls onAddFriend with the trimmed name and parsed artists array', () => {
    const onAddFriend = vi.fn()
    render(
      <GroupTab
        {...baseProps}
        addingFriend={true}
        newFName="Alice"
        newFArtists="Radiohead, Bicep"
        onAddFriend={onAddFriend}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAddFriend).toHaveBeenCalledWith('Alice', ['Radiohead', 'Bicep'])
  })

  test('clicking Cancel calls setAddingFriend(false)', () => {
    render(<GroupTab {...baseProps} addingFriend={true} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(baseProps.setAddingFriend).toHaveBeenCalledWith(false)
  })

  // ── Remove friend ────────────────────────────────────────────────────────────

  test('clicking × on a friend calls onRemoveFriend with the friend index', () => {
    const onRemoveFriend = vi.fn()
    render(
      <GroupTab
        {...baseProps}
        friends={[friend('Alice', ['Bicep'])]}
        onRemoveFriend={onRemoveFriend}
      />
    )
    fireEvent.click(screen.getByText('×'))
    expect(onRemoveFriend).toHaveBeenCalledWith(0)
  })

  // ── Invite flow ──────────────────────────────────────────────────────────────

  test('invite button calls onInvite when clicked', () => {
    const onInvite = vi.fn()
    render(<GroupTab {...baseProps} onInvite={onInvite} />)
    fireEvent.click(screen.getByRole('button', { name: /Invite Friend/ }))
    expect(onInvite).toHaveBeenCalledTimes(1)
  })

  test('shows "✓ Link Copied!" when inviteStatus is "copied"', () => {
    render(<GroupTab {...baseProps} inviteStatus="copied" />)
    expect(screen.getByText('✓ Link Copied!')).toBeInTheDocument()
  })

  // ── "All Going" section ──────────────────────────────────────────────────────

  test('"All Going" section header appears when all participants share an artist', () => {
    // Both "Me" and "Alice" have Radiohead → allGoingSlots.length = 1
    const allParticipants = [
      { name: 'Me',    artists: ['Radiohead'], color: FA },
      { name: 'Alice', artists: ['Radiohead'], color: '#ff6b6b' },
    ]
    render(
      <GroupTab
        {...baseProps}
        friends={[friend('Alice', ['Radiohead'])]}
        allParticipants={allParticipants}
      />
    )
    expect(screen.getByText(/All Going/)).toBeInTheDocument()
  })

  test('"All Going" section is absent when no act has every participant', () => {
    // Me → Radiohead, Alice → Bicep: no artist shared by all
    const allParticipants = [
      { name: 'Me',    artists: ['Radiohead'], color: FA },
      { name: 'Alice', artists: ['Bicep'],     color: '#ff6b6b' },
    ]
    render(
      <GroupTab
        {...baseProps}
        friends={[friend('Alice', ['Bicep'])]}
        allParticipants={allParticipants}
      />
    )
    expect(screen.queryByText(/All Going —/)).not.toBeInTheDocument()
  })
})
