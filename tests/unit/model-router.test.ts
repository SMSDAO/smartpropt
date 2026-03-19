import { describe, it, expect } from 'vitest'
import {
  routeModel,
  SUPPORTED_MODELS,
  type ModelConfig,
} from '../../src/services/ai/model-router'

describe('routeModel', () => {
  it('returns gpt-4o-mini for free tier with no model specified', () => {
    const result = routeModel(undefined, 'free')
    expect(result.id).toBe('gpt-4o-mini')
  })

  it('returns gpt-4o-mini for free tier when gpt-4o is requested (tier mismatch)', () => {
    const result = routeModel('gpt-4o', 'free')
    // gpt-4o requires pro tier; free tier falls back to the highest available model
    expect(result.minTier).toBe('free')
  })

  it('returns gpt-4o for pro tier with no model specified (highest priority available)', () => {
    const result = routeModel(undefined, 'pro')
    // gpt-4o has priority 4, the highest available for pro tier
    expect(result.id).toBe('gpt-4o')
  })

  it('returns the requested model when available and tier matches', () => {
    const result = routeModel('gpt-4o-mini', 'pro')
    expect(result.id).toBe('gpt-4o-mini')
  })

  it('respects unavailable flag — falls back to next best model', () => {
    // Temporarily mark gpt-4o as unavailable
    const original = SUPPORTED_MODELS['gpt-4o'].available
    SUPPORTED_MODELS['gpt-4o'].available = false
    try {
      const result = routeModel('gpt-4o', 'pro')
      expect(result.id).not.toBe('gpt-4o')
    } finally {
      SUPPORTED_MODELS['gpt-4o'].available = original
    }
  })

  it('falls back to gpt-4o-mini when unknown model is requested', () => {
    const result = routeModel('does-not-exist', 'free')
    expect(result.id).toBe('gpt-4o-mini')
  })

  it('enterprise tier gets the highest-priority model', () => {
    const result = routeModel(undefined, 'enterprise')
    const allModels = Object.values(SUPPORTED_MODELS).filter((m) => m.available)
    const maxPriority = Math.max(...allModels.map((m) => m.priority))
    expect(result.priority).toBe(maxPriority)
  })

  it('admin tier gets the highest-priority model', () => {
    const result = routeModel(undefined, 'admin')
    const allModels = Object.values(SUPPORTED_MODELS).filter((m) => m.available)
    const maxPriority = Math.max(...allModels.map((m) => m.priority))
    expect(result.priority).toBe(maxPriority)
  })

  it('returns a valid ModelConfig shape', () => {
    const result = routeModel(undefined, 'free')
    const required: Array<keyof ModelConfig> = [
      'id',
      'name',
      'contextWindow',
      'inputCostPer1k',
      'outputCostPer1k',
      'minTier',
      'supportsJsonMode',
      'available',
      'priority',
    ]
    for (const key of required) {
      expect(result).toHaveProperty(key)
    }
  })
})

describe('SUPPORTED_MODELS registry', () => {
  it('contains at least one model available for the free tier', () => {
    const freeModels = Object.values(SUPPORTED_MODELS).filter(
      (m) => m.minTier === 'free' && m.available
    )
    expect(freeModels.length).toBeGreaterThan(0)
  })

  it('all models have a unique priority', () => {
    const priorities = Object.values(SUPPORTED_MODELS).map((m) => m.priority)
    const unique = new Set(priorities)
    expect(unique.size).toBe(priorities.length)
  })

  it('gpt-4o supports JSON mode', () => {
    expect(SUPPORTED_MODELS['gpt-4o'].supportsJsonMode).toBe(true)
  })
})
