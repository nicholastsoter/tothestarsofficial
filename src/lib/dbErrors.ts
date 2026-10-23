import type { PostgrestError } from '@supabase/supabase-js'

/** Turns a database error into a sentence an owner can act on. */
export function describeDbError(error: Pick<PostgrestError, 'code' | 'message'>): string {
  if (error.code === '23505') {
    return /slug|link name/i.test(error.message) ? 'That link name is already taken. Please choose another.' : 'That value is already in use.'
  }
  if (error.code === '23514') {
    if (/slug/i.test(error.message)) return 'That link name isn’t allowed. Use 3-50 lowercase letters, numbers and hyphens, and avoid reserved words.'
    if (/place_id/i.test(error.message)) return 'That Google listing ID looks invalid.'
    return 'One of the values isn’t allowed. Please check the form.'
  }
  if (/at most 10 questions/i.test(error.message)) return 'A survey can have at most 10 questions. Delete one to add another.'
  if (/1-100 characters/i.test(error.message)) return 'Each answer option must be between 1 and 100 characters.'
  if (/all be different/i.test(error.message)) return 'Each answer option must be different.'
  if (error.code === 'P0001' && /too many times/i.test(error.message)) return 'This link name has been changed too many times. Contact support to change it again.'
  if (error.code === '42501') return 'You don’t have permission to do that.'
  return 'Something went wrong. Please try again.'
}
