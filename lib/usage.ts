import { createServerSupabaseClient } from './supabase'
import type { SubscriptionTier } from './auth'

// Usage limits per tier (monthly)
const USAGE_LIMITS: Record<SubscriptionTier, number> = {
  free: 10,
  pro: 1000,
  enterprise: -1, // unlimited
  lifetime: -1,   // unlimited
  admin: -1,      // unlimited
}

export interface UsageCheckResult {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: Date
}

// Check if user has remaining usage
export async function checkUsageLimit(
  userId: string,
  tier: SubscriptionTier
): Promise<UsageCheckResult> {
  const supabase = await createServerSupabaseClient()

  const { data: user } = await supabase
    .from('users')
    .select('usage_count, usage_reset_at')
    .eq('id', userId)
    .single()

  if (!user) {
    throw new Error('User not found')
  }

  const limit = USAGE_LIMITS[tier]
  const resetAt = new Date(user.usage_reset_at)
  const now = new Date()

  // Reset usage if period expired
  if (now > resetAt) {
    const newResetAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // 30 days
    
    const { error } = await supabase
      .from('users')
      .update({
        usage_count: 0,
        usage_reset_at: newResetAt.toISOString(),
      })
      .eq('id', userId)

    if (error) {
      throw new Error(`Failed to reset usage: ${error.message}`)
    }

    return {
      allowed: true,
      remaining: limit === -1 ? -1 : limit,
      limit,
      resetAt: newResetAt,
    }
  }

  // Check limit
  const remaining = limit === -1 ? -1 : limit - user.usage_count
  const allowed = limit === -1 || user.usage_count < limit

  return {
    allowed,
    remaining,
    limit,
    resetAt,
  }
}

// Increment usage count
export async function incrementUsage(userId: string): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.rpc('increment_usage', { user_id: userId })
  
  if (error) {
    throw new Error(`Failed to increment usage: ${error.message || String(error)}`)
  }
}

/**
 * Decrement usage count by 1, never going below 0.
 *
 * Used to roll back an incremented quota slot when a downstream call
 * (e.g. the OpenAI optimisation) fails after the atomic check-and-increment
 * has already consumed a slot. Errors here are non-fatal and are only logged
 * so that a rollback failure never masks the original error.
 */
export async function decrementUsage(userId: string): Promise<void> {
  const supabase = await createServerSupabaseClient()

  // Try the RPC-based decrement first (defined in scripts/setup-atomic-usage.sql)
  const { error } = await supabase.rpc('decrement_usage', { user_id: userId })

  if (!error) return

  // RPC not yet deployed — fall back to a conditional direct update.
  // Minor race conditions on this fallback path are acceptable; the primary
  // increment path is already protected by row-level locking.
  if (error.code === 'PGRST202' || error.message?.includes('decrement_usage')) {
    const { data: user } = await supabase
      .from('users')
      .select('usage_count')
      .eq('id', userId)
      .single()

    if (user && user.usage_count > 0) {
      const { error: updateError } = await supabase
        .from('users')
        .update({
          usage_count: user.usage_count - 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)

      if (updateError) {
        console.error(`Failed to roll back usage for user ${userId}:`, updateError)
      }
    }
  } else {
    console.error(`Failed to roll back usage for user ${userId}:`, error)
  }
}

/**
 * Atomically check usage and increment in a single RPC call.
 * Uses the check_and_increment_usage PostgreSQL function which applies
 * row-level locking (FOR UPDATE) to eliminate race conditions.
 *
 * Falls back to the non-atomic checkUsageLimit + incrementUsage pair
 * if the RPC function is not available (e.g., during local development
 * before running scripts/setup-atomic-usage.sql).
 */
export async function atomicCheckAndIncrement(
  userId: string,
  tier: SubscriptionTier
): Promise<UsageCheckResult> {
  const supabase = await createServerSupabaseClient()
  const limit = USAGE_LIMITS[tier]

  // For unlimited tiers, skip the RPC and just increment directly
  if (limit === -1) {
    await incrementUsage(userId).catch((err) =>
      console.error('Failed to increment unlimited usage (non-blocking):', err)
    )
    return {
      allowed: true,
      remaining: -1,
      limit: -1,
      resetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }
  }

  const { data, error } = await supabase.rpc('check_and_increment_usage', {
    p_user_id: userId,
    p_tier: tier,
    p_limit: limit,
  })

  // If the RPC function doesn't exist yet, fall back gracefully
  if (error) {
    if (
      error.code === 'PGRST202' ||
      error.message?.includes('check_and_increment_usage')
    ) {
      console.warn(
        'check_and_increment_usage RPC not found — falling back to non-atomic path. ' +
          'Run scripts/setup-atomic-usage.sql in Supabase to enable atomic usage tracking.'
      )
      const check = await checkUsageLimit(userId, tier)
      if (check.allowed) {
        await incrementUsage(userId)
      }
      return check
    }
    throw new Error(`Atomic usage check failed: ${error.message}`)
  }

  if (!data || data.length === 0) {
    throw new Error('Atomic usage check returned no data')
  }

  const row = data[0] as { allowed: boolean; remaining: number; reset_at: string }
  // Use the real reset_at returned by the SQL function instead of synthesising it
  const resetAt = row.reset_at
    ? new Date(row.reset_at)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  return {
    allowed: row.allowed,
    remaining: row.remaining,
    limit,
    resetAt,
  }
}

// Get usage stats
export async function getUsageStats(userId: string) {
  const supabase = await createServerSupabaseClient()

  const { data: user } = await supabase
    .from('users')
    .select('usage_count, usage_reset_at, subscription_tier')
    .eq('id', userId)
    .single()

  if (!user) {
    throw new Error('User not found')
  }

  const limit = USAGE_LIMITS[user.subscription_tier as SubscriptionTier]
  const remaining = limit === -1 ? -1 : limit - user.usage_count

  return {
    used: user.usage_count,
    remaining,
    limit,
    resetAt: new Date(user.usage_reset_at),
    tier: user.subscription_tier,
  }
}

