// Pure, deterministic generator for FAKE demo data, plus the safety checks the seed script uses.
// No network and no secrets in here, so it can be unit-tested against a real Postgres.

export const FAKE_LABEL = '[FAKE]'
export const TEST_BUSINESS_NAME = 'FAKE DATA: Test Business (safe to delete)'
export const TEST_SLUG = 'fake-data-test-business'
export const TEST_EMAIL = 'fake-data-owner@example.com'

const PROJECT_REF = /^[a-z]{20}$/

/**
 * The seed script writes with the service-role key, which can touch anything. So it refuses unless the
 * caller NAMED the project (--project-ref) AND the URL in the environment is exactly that project.
 */
export function assertSafeTarget({ projectRef, supabaseUrl }) {
  if (!projectRef) throw new Error('Refusing to run: pass --project-ref <your-project-ref> to name the project you mean.')
  if (!PROJECT_REF.test(projectRef)) throw new Error('Refusing to run: --project-ref must be a 20-letter Supabase project ref.')
  if (!supabaseUrl) throw new Error('Refusing to run: SUPABASE_URL is not set.')
  let url
  try {
    url = new URL(supabaseUrl)
  } catch {
    throw new Error('Refusing to run: SUPABASE_URL is not a valid URL.')
  }
  const exact = url.protocol === 'https:' && url.hostname === `${projectRef}.supabase.co` && !url.username && !url.password && !url.port && (url.pathname === '/' || url.pathname === '')
  if (!exact) throw new Error(`Refusing to run: SUPABASE_URL must be exactly https://${projectRef}.supabase.co (the project you named).`)
  return url.origin
}

export function parseArgs(argv) {
  const out = { projectRef: null, apply: false, remove: false, days: 120 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--project-ref') out.projectRef = argv[++i] ?? null
    else if (a.startsWith('--project-ref=')) out.projectRef = a.slice('--project-ref='.length)
    else if (a === '--apply') out.apply = true
    else if (a === '--delete') out.remove = true
    else if (a === '--days') out.days = Number(argv[++i])
    else throw new Error(`Unknown option: ${a}`)
  }
  if (!Number.isInteger(out.days) || out.days < 14 || out.days > 400) throw new Error('--days must be a whole number from 14 to 400.')
  return out
}

// ---- time ---------------------------------------------------------------------------------------------

function zoneOffsetMs(utcMs, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs))
      .map((x) => [x.type, x.value]),
  )
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000
}

/** The UTC instant at which the wall clock in `timeZone` reads date + hh:mm:ss. */
export function localToUtcIso(date, hh, mm, ss, timeZone) {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss)
  let utc = guess - zoneOffsetMs(guess, timeZone)
  utc = guess - zoneOffsetMs(utc, timeZone) // second pass settles days where the offset changes
  return new Date(utc).toISOString()
}

export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// ---- randomness (deterministic) -----------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (rnd, list) => list[Math.floor(rnd() * list.length)]

const GOOD = ['Friendly staff and quick service', 'Loved the food, will be back', 'Great atmosphere', 'Best in the neighbourhood', 'Everything was fresh and hot', 'Fast, tidy and welcoming']
const BAD = ['Waited far too long', 'Order was wrong and cold', 'Staff seemed distracted', 'Too noisy to enjoy our meal', 'Prices went up and portions shrank', 'The table was dirty when we sat down']
const SURVEY_TEXT = ['The wait was the problem', 'Food arrived lukewarm', 'Felt ignored for a while', 'Would like a quieter room']

/**
 * Builds a believable ~`days`-day history ending on `endDate` (a day in `timezone`): quiet weekdays,
 * busier weekends, volume growing over time, and an average rating that improves. Everything is labelled
 * FAKE, and the same seed always gives the same data.
 *
 * `questions` are the business's real starter questions ([{id, prompt, type, options}]) so survey
 * answers look like real snapshots.
 */
export function generateSeed({ seed = 1, days = 120, endDate, timezone = 'America/Chicago', trackingStartDaysAgo = 45, questions = [] }) {
  const rnd = mulberry32(seed)
  const startDate = addDays(endDate, -(days - 1))
  const trackingStart = addDays(endDate, -trackingStartDaysAgo)
  const feedback = []
  const events = []
  let fakePeople = 0

  const at = (date) => localToUtcIso(date, 8 + Math.floor(rnd() * 14), Math.floor(rnd() * 60), Math.floor(rnd() * 60), timezone)
  const later = (iso, minSec) => new Date(Date.parse(iso) + (30 + Math.floor(rnd() * minSec)) * 1000).toISOString()

  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i)
    const t = i / (days - 1) // 0 at the start, 1 today
    const dow = new Date(Date.parse(`${date}T12:00:00Z`)).getUTCDay() // 0 Sunday .. 6 Saturday
    const weekend = dow === 5 || dow === 6 ? 1.7 : dow === 0 ? 1.2 : 1
    const beforeTracking = date < trackingStart ? 0.4 : 1 // they were only testing the page before the official start
    const views = Math.round((4 + 9 * (0.45 + 0.55 * t)) * weekend * beforeTracking * (0.55 + rnd() * 0.9))

    const unhappy = 0.32 - 0.22 * t
    const neutral = 0.23 - 0.08 * t

    for (let v = 0; v < views; v++) {
      const viewAt = at(date)
      events.push({ type: 'page_view', star_rating: null, created_at: viewAt })
      if (rnd() > 0.55 + 0.1 * t) continue // most visitors tap a star, not all

      const r = rnd()
      const star = r < unhappy ? (rnd() < 0.4 ? 1 : 2) : r < unhappy + neutral ? 3 : rnd() < 0.55 + 0.1 * t ? 5 : 4
      const tapAt = later(viewAt, 20)
      events.push({ type: 'star_click', star_rating: star, created_at: tapAt })

      let message = null
      let answers = []
      if (star >= 4) {
        if (rnd() < 0.45) message = `${FAKE_LABEL} ${pick(rnd, GOOD)}`
      } else {
        if (rnd() < 0.35) message = `${FAKE_LABEL} ${pick(rnd, BAD)}`
        if (questions.length && rnd() < 0.7) {
          answers = questions.map((q) => ({
            question_id: q.id, prompt: q.prompt, type: q.type,
            answer: q.type === 'multiple_choice' ? pick(rnd, q.options ?? ['Service']) : `${FAKE_LABEL} ${pick(rnd, SURVEY_TEXT)}`,
          }))
        }
      }
      const submittedAt = later(tapAt, 90)
      if (answers.length) events.push({ type: 'survey_completed', star_rating: star, created_at: submittedAt })

      const optIn = star <= 3 && (message || answers.length) && rnd() < 0.08
      if (optIn) fakePeople++
      const daysOld = days - 1 - i
      feedback.push({
        star_rating: star,
        message,
        survey_answers: answers,
        contact_name: optIn ? `${FAKE_LABEL} Person ${fakePeople}` : null,
        contact_email: optIn ? `fake-person-${fakePeople}@example.com` : null,
        contact_consent: Boolean(optIn),
        status: daysOld > 14 && rnd() < 0.7 ? 'resolved' : 'new',
        private_note: daysOld > 14 && rnd() < 0.15 ? `${FAKE_LABEL} followed up by phone` : null,
        created_at: submittedAt,
        updated_at: submittedAt,
      })

      // the Google link is offered to everyone; happier customers use it more
      if (rnd() < (star >= 4 ? 0.55 : star === 3 ? 0.2 : 0.1)) events.push({ type: 'google_link_click', star_rating: star, created_at: later(submittedAt, 60) })
    }
  }

  return {
    business: { name: TEST_BUSINESS_NAME, slug: TEST_SLUG, timezone, tracking_start_date: trackingStart, goal_rating: 4.5, brand_color: '#2a78d6', thank_you_message: 'Thanks! (This is fake demo data.)' },
    feedback,
    events,
    startDate,
    endDate,
  }
}
