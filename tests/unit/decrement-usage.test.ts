/**
 * Tests for decrementUsage — the rollback helper used by /api/optimize when
 * an optimisation call fails after a usage slot has already been reserved.
 *
 * Because decrementUsage calls Supabase, all Supabase interactions are mocked
 * so these tests run fully offline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Inline mock for lib/supabase — must be declared before the import that
// triggers the module evaluation.
// ---------------------------------------------------------------------------
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('../../lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}))

// Import AFTER the mock is registered
import { decrementUsage } from '../../lib/usage'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wire up a fluent Supabase chain: .from().select().eq().single() */
function setupSelectChain(
  returnData: { usage_count: number } | null,
  returnError: { code?: string; message: string } | null = null
) {
  mockSingle.mockResolvedValueOnce({ data: returnData, error: returnError })
  mockEq.mockReturnValueOnce({ single: mockSingle })
  mockSelect.mockReturnValueOnce({ eq: mockEq })
  mockFrom.mockReturnValueOnce({ select: mockSelect, update: mockUpdate })
}

/** Wire up a fluent Supabase chain: .from().update().eq() */
function setupUpdateChain(returnError: { message: string } | null = null) {
  mockEq.mockReturnValueOnce({ error: returnError })
  mockUpdate.mockReturnValueOnce({ eq: mockEq })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: both select and update chains on .from() need chaining
  mockFrom.mockReturnValue({
    select: mockSelect,
    update: mockUpdate,
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('decrementUsage', () => {
  it('succeeds via RPC when decrement_usage is available', async () => {
    mockRpc.mockResolvedValueOnce({ error: null })

    await expect(decrementUsage('user-1')).resolves.toBeUndefined()
    expect(mockRpc).toHaveBeenCalledWith('decrement_usage', { user_id: 'user-1' })
    // Should not fall back to direct update
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('falls back to direct update when RPC is not deployed (PGRST202)', async () => {
    // RPC not found
    mockRpc.mockResolvedValueOnce({
      error: { code: 'PGRST202', message: 'function decrement_usage not found' },
    })

    // Fallback: select returns count = 5
    setupSelectChain({ usage_count: 5 })
    // Fallback: update succeeds
    setupUpdateChain(null)

    await expect(decrementUsage('user-2')).resolves.toBeUndefined()
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ usage_count: 4 })
    )
  })

  it('does not decrement below 0 in the fallback path', async () => {
    mockRpc.mockResolvedValueOnce({
      error: { code: 'PGRST202', message: 'function decrement_usage not found' },
    })

    // User already has usage_count = 0
    setupSelectChain({ usage_count: 0 })

    await expect(decrementUsage('user-3')).resolves.toBeUndefined()
    // update should NOT have been called when count is already 0
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('does not throw when an unexpected RPC error occurs (logs instead)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRpc.mockResolvedValueOnce({
      error: { code: '500', message: 'internal error' },
    })

    await expect(decrementUsage('user-4')).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('does not throw when the fallback update fails (logs instead)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRpc.mockResolvedValueOnce({
      error: { code: 'PGRST202', message: 'function decrement_usage not found' },
    })

    setupSelectChain({ usage_count: 3 })
    setupUpdateChain({ message: 'DB write error' })

    await expect(decrementUsage('user-5')).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
