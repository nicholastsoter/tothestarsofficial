import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Set when the .env file is missing values; the app shows a setup screen instead of crashing. */
export const configError =
  !url || !anonKey ? 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.' : null

// Placeholder values keep createClient from throwing when configError is set.
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing')
