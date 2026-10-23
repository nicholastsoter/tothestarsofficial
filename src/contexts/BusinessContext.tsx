import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { describeDbError } from '../lib/dbErrors'
import { randomSuffix, suggestSlug } from '../lib/slug'
import { supabase } from '../lib/supabase'
import { resolveTimeZone } from '../lib/timezone'
import { useAuth } from './AuthContext'

export interface Business {
  id: string
  name: string
  address: string | null
  place_id: string | null
  slug: string
  logo_url: string | null
  brand_color: string
  thank_you_message: string
  tracking_start_date: string
  goal_rating: number | null
  timezone: string
  alerts_enabled: boolean
  qr_downloaded_at: string | null
  created_at: string
}

/** The columns an owner may change (matches the database's column-level grants). */
export type BusinessPatch = Partial<
  Pick<Business, 'name' | 'address' | 'place_id' | 'slug' | 'logo_url' | 'brand_color' | 'thank_you_message' | 'goal_rating' | 'qr_downloaded_at'>
>

interface BusinessState {
  business: Business | null
  loading: boolean
  loadError: string | null
  /** each returns an error message, or null on success */
  create: (name: string) => Promise<string | null>
  update: (patch: BusinessPatch) => Promise<string | null>
  reload: () => Promise<void>
}

const BusinessContext = createContext<BusinessState | null>(null)

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('businesses').select('*').maybeSingle()
    if (error) setLoadError('We couldn’t load your business. Please refresh the page.')
    else {
      setLoadError(null)
      setBusiness(data as Business | null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, user?.id])

  const create = useCallback(
    async (rawName: string) => {
      const name = rawName.trim()
      if (!name || name.length > 120 || !user) return 'Please enter your business name (up to 120 characters).'
      // the time zone captured at signup, or this browser's if the account predates that
      const timezone = resolveTimeZone(user.user_metadata?.timezone)

      // try the plain slug first, then add a short random suffix if it's taken
      for (let attempt = 0; attempt < 5; attempt++) {
        const slug = suggestSlug(name, attempt === 0 ? '' : randomSuffix())
        const { data, error } = await supabase
          .from('businesses')
          .insert({ owner_user_id: user.id, name, slug, timezone })
          .select()
          .single()
        if (!error) {
          setBusiness(data as Business)
          return null
        }
        if (error.code === '23505' && /slug|link name/i.test(error.message)) continue
        if (error.code === '23505') {
          await reload() // an account only gets one business; we must already have one
          return null
        }
        return describeDbError(error)
      }
      return 'We couldn’t find a free link name. Please try a slightly different business name.'
    },
    [user, reload],
  )

  const update = useCallback(
    async (patch: BusinessPatch) => {
      if (!business) return 'No business to update.'
      const { data, error } = await supabase.from('businesses').update(patch).eq('id', business.id).select().single()
      if (error) return describeDbError(error)
      setBusiness(data as Business)
      return null
    },
    [business],
  )

  const value = useMemo(() => ({ business, loading, loadError, create, update, reload }), [business, loading, loadError, create, update, reload])
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>
}

export function useBusiness(): BusinessState {
  const ctx = useContext(BusinessContext)
  if (!ctx) throw new Error('useBusiness must be used inside <BusinessProvider>')
  return ctx
}
