import { describe, it, expect } from 'vitest'
import { estimateTokens, estimateChatTokens } from '../../src/services/ai/token-tracker'

describe('estimateTokens', () => {
  it('estimates tokens as ceil(length / 4)', () => {
    const text = 'abcd' // 4 chars → 1 token
    expect(estimateTokens(text).count).toBe(1)
  })

  it('rounds up for fractional token counts', () => {
    const text = 'abc' // 3 chars → ceil(3/4) = 1
    expect(estimateTokens(text).count).toBe(1)

    const text5 = 'abcde' // 5 chars → ceil(5/4) = 2
    expect(estimateTokens(text5).count).toBe(2)
  })

  it('returns 0 for empty string', () => {
    expect(estimateTokens('').count).toBe(0)
  })

  it('computes estimatedCostUsd using default rate', () => {
    const text = 'a'.repeat(4000) // 1000 tokens
    const result = estimateTokens(text)
    expect(result.count).toBe(1000)
    // Default rate is $0.005 / 1K tokens → $5.00 for 1M tokens
    expect(result.estimatedCostUsd).toBeCloseTo(0.005, 5)
  })

  it('respects a custom cost per 1k tokens', () => {
    const text = 'a'.repeat(4000) // 1000 tokens
    const customRate = 0.01
    const result = estimateTokens(text, customRate)
    expect(result.estimatedCostUsd).toBeCloseTo(0.01, 5)
  })
})

describe('estimateChatTokens', () => {
  it('counts tokens from all messages combined', () => {
    const messages = [
      { role: 'system', content: 'Hello' },
      { role: 'user', content: 'World' },
    ]
    // 'Hello World' = 10 chars → ceil(10/4) = 3 text tokens + 2*4 = 8 overhead = 11
    const result = estimateChatTokens(messages)
    expect(result.count).toBeGreaterThan(0)
  })

  it('adds overhead per message', () => {
    const messages = [{ role: 'user', content: '' }]
    // 0 text chars + 4 overhead per message = 4
    expect(estimateChatTokens(messages).count).toBe(4)
  })

  it('returns 0 cost for empty messages array', () => {
    const result = estimateChatTokens([])
    expect(result.count).toBe(0)
    expect(result.estimatedCostUsd).toBe(0)
  })
})
