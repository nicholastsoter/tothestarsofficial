// The Google rating panel's daily caps, in ONE place. Change these two numbers to change the limits.
// Both are counted per UTC day (the counters reset together at 00:00 UTC), and the counters in the
// rate_limits table hold counts only, never anything that came from Google.
//
// Why 5 and 30: Google bills rating lookups at $20 per 1,000 after 1,000 free requests a month for the
// whole app, which is about 33 a day. A global cap of 30 a day stays inside that free allowance.
export const GOOGLE_RATING_PER_BUSINESS_PER_DAY = 5
export const GOOGLE_RATING_GLOBAL_PER_DAY = 30
