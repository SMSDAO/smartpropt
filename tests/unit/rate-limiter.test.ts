import { describe, it, expect, beforeEach } from 'vitest'
import { checkAIRateLimit } from '../../src/services/ai/rate-limiter'

describe('checkAIRateLimit', () => {
  // Use unique user IDs per test to avoid cross-test interference in the
  // in-memory store.
  let baseId: string

  beforeEach(() => {
    baseId = `test-user-${Math.random().toString(36).slice(2)}`
  })

  it('allows the first request for any tier', () => {
    const result = checkAIRateLimit(baseId, 'free')
    expect(result.success).toBe(true)
  })

  it('returns a valid RateLimitResult shape', () => {
    const result = checkAIRateLimit(baseId, 'pro')
    expect(result).toHaveProperty('success')
    expect(result).toHaveProperty('limit')
    expect(result).toHaveProperty('remaining')
    expect(result).toHaveProperty('reset')
  })

  it('sets a higher limit for enterprise than for free', () => {
    const freeId = `${baseId}-free`
    const enterpriseId = `${baseId}-enterprise`
    const freeResult = checkAIRateLimit(freeId, 'free')
    const enterpriseResult = checkAIRateLimit(enterpriseId, 'enterprise')
    expect(enterpriseResult.limit).toBeGreaterThan(freeResult.limit)
  })

  it('sets a higher limit for pro than for free', () => {
    const freeId = `${baseId}-free`
    const proId = `${baseId}-pro`
    const freeResult = checkAIRateLimit(freeId, 'free')
    const proResult = checkAIRateLimit(proId, 'pro')
    expect(proResult.limit).toBeGreaterThan(freeResult.limit)
  })

  it('decrements remaining on each call', () => {
    const result1 = checkAIRateLimit(baseId, 'pro')
    const result2 = checkAIRateLimit(baseId, 'pro')
    expect(result2.remaining).toBe(result1.remaining - 1)
  })

  it('blocks requests once the limit is reached', () => {
    // Use a unique ID and exhaust the free tier (limit = 5)
    const userId = `${baseId}-exhaust`
    for (let i = 0; i < 5; i++) {
      checkAIRateLimit(userId, 'free')
    }
    const result = checkAIRateLimit(userId, 'free')
    expect(result.success).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('admin tier has the highest limit', () => {
    const adminId = `${baseId}-admin`
    const enterpriseId = `${baseId}-ent`
    const adminResult = checkAIRateLimit(adminId, 'admin')
    const enterpriseResult = checkAIRateLimit(enterpriseId, 'enterprise')
    expect(adminResult.limit).toBeGreaterThanOrEqual(enterpriseResult.limit)
  })
})
