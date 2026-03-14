import { NextRequest, NextResponse } from 'next/server'
import { upsertUser } from '@/lib/auth'
import { atomicCheckAndIncrement } from '@/lib/usage'
import { optimizePrompt } from '@/src/services/ai/prompt-optimizer'
import { checkAIRateLimit } from '@/src/services/ai/rate-limiter'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase'
import type { SubscriptionTier } from '@/lib/auth'

const OptimizeSchema = z.object({
  prompt: z.string().min(1).max(10000),
  model: z.string().optional(),
  context: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    // Get authenticated user from session
    const supabase = await createServerSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in' },
        { status: 401 }
      )
    }

    const userId = session.user.id
    const email = session.user.email || ''

    // Upsert user to ensure they exist in database
    const user = await upsertUser(userId, email)

    // Check if user is banned
    if (user.banned) {
      return NextResponse.json(
        { error: 'Account banned - Please contact support' },
        { status: 403 }
      )
    }

    // Rate limiting — per-minute limits scale with the user's subscription tier.
    const rateLimitResult = checkAIRateLimit(userId, user.subscription_tier as SubscriptionTier)

    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          limit: rateLimitResult.limit,
          remaining: rateLimitResult.remaining,
          reset: rateLimitResult.reset,
        },
        { status: 429 }
      )
    }

    // Parse and validate request body before checking usage to avoid
    // charging users for malformed requests.
    const body = await req.json()
    const validatedData = OptimizeSchema.parse(body)

    // Atomically check and increment usage in a single DB round-trip,
    // eliminating the race condition between separate check + increment calls.
    const usageCheck = await atomicCheckAndIncrement(userId, user.subscription_tier)

    if (!usageCheck.allowed) {
      return NextResponse.json(
        {
          error: 'Usage limit reached',
          limit: usageCheck.limit,
          remaining: usageCheck.remaining,
          resetAt: usageCheck.resetAt,
          tier: user.subscription_tier,
        },
        { status: 403 }
      )
    }

    // Optimize the prompt using the service-layer which routes to the best
    // available model for the user's subscription tier.
    const result = await optimizePrompt({
      prompt: validatedData.prompt,
      model: validatedData.model,
      context: validatedData.context,
      userTier: user.subscription_tier,
    })

    // Return result with usage info
    return NextResponse.json({
      success: true,
      data: result,
      usage: {
        remaining: usageCheck.remaining,
        limit: usageCheck.limit,
        resetAt: usageCheck.resetAt,
        tier: user.subscription_tier,
      },
    })
  } catch (error) {
    console.error('Optimize API error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
