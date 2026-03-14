import { describe, it, expect } from 'vitest'
import { withFallback } from '../../src/services/ai/fallback'

describe('withFallback', () => {
  it('returns the result of the primary function on success', async () => {
    const result = await withFallback(() => Promise.resolve('primary'))
    expect(result).toBe('primary')
  })

  it('falls back to the next function when primary throws', async () => {
    const result = await withFallback(
      () => Promise.reject(new Error('primary failed')),
      () => Promise.resolve('fallback-1')
    )
    expect(result).toBe('fallback-1')
  })

  it('tries each fallback in order', async () => {
    const order: number[] = []
    const result = await withFallback(
      () => { order.push(1); return Promise.reject(new Error('fail 1')) },
      () => { order.push(2); return Promise.reject(new Error('fail 2')) },
      () => { order.push(3); return Promise.resolve('ok') }
    )
    expect(result).toBe('ok')
    expect(order).toEqual([1, 2, 3])
  })

  it('throws the last error when all fallbacks fail', async () => {
    await expect(
      withFallback(
        () => Promise.reject(new Error('first')),
        () => Promise.reject(new Error('last'))
      )
    ).rejects.toThrow('last')
  })

  it('works with a single primary function that succeeds', async () => {
    const result = await withFallback(() => Promise.resolve(42))
    expect(result).toBe(42)
  })

  it('preserves the return type', async () => {
    const result = await withFallback(
      (): Promise<{ value: number }> => Promise.resolve({ value: 7 })
    )
    expect(result.value).toBe(7)
  })
})
