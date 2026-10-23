#!/usr/bin/env node
// Creates (or removes) a clearly-labelled FAKE test business with realistic feedback and events, so the
// Analytics charts have something to show. It never touches your real business: the fake data lives in its
// own business under its own fake login.
//
//   Dry run (writes nothing):  node scripts/seed-test-data.mjs --project-ref <ref>
//   Create the fake data:      node scripts/seed-test-data.mjs --project-ref <ref> --apply
//   Remove it again:           node scripts/seed-test-data.mjs --project-ref <ref> --delete
//
// Needs two environment variables in YOUR terminal (never put them in a file or paste them into chat):
//   SUPABASE_URL                 https://<ref>.supabase.co  (must match --project-ref exactly)
//   SUPABASE_SERVICE_ROLE_KEY    Supabase dashboard, Project Settings, API, "service_role" key

import { randomBytes } from 'node:crypto'
import { FAKE_LABEL, TEST_BUSINESS_NAME, TEST_EMAIL, TEST_SLUG, assertSafeTarget, generateSeed, parseArgs } from './lib/seed-data.mjs'

const fail = (msg) => {
  console.error(`\n${msg}\n`)
  process.exit(1)
}

let args
let origin
try {
  args = parseArgs(process.argv.slice(2))
  origin = assertSafeTarget({ projectRef: args.projectRef, supabaseUrl: process.env.SUPABASE_URL })
} catch (e) {
  fail(e.message)
}
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) fail('Refusing to run: SUPABASE_SERVICE_ROLE_KEY is not set in your terminal.')

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
const call = async (path, init = {}) => {
  const res = await fetch(`${origin}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} failed with status ${res.status}`)
  return res.status === 204 ? null : res.json()
}

async function findTestUser() {
  for (let page = 1; page <= 20; page++) {
    const r = await call(`/auth/v1/admin/users?page=${page}&per_page=200`)
    const hit = (r.users ?? []).find((u) => u.email === TEST_EMAIL)
    if (hit) return hit
    if (!r.users || r.users.length < 200) return null
  }
  return null
}

async function insertChunks(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await call(`/rest/v1/${table}`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows.slice(i, i + 500)) })
  }
}

console.log(`Target project: ${args.projectRef}  (${origin})`)
const existing = await findTestUser()

if (args.remove) {
  if (!existing) fail('No fake test account found, so there is nothing to delete.')
  await call(`/auth/v1/admin/users/${existing.id}`, { method: 'DELETE' })
  console.log(`Deleted the fake test account and everything under it (${TEST_EMAIL}).`)
  process.exit(0)
}

if (existing) fail(`The fake test account already exists (${TEST_EMAIL}). Run again with --delete first if you want a fresh one.`)

const today = new Date().toISOString().slice(0, 10)
const preview = generateSeed({ endDate: today, days: args.days })
console.log(`Plan: one fake business "${TEST_BUSINESS_NAME}"`)
console.log(`      ${preview.feedback.length} fake feedback rows and ${preview.events.length} fake events, ${preview.startDate} to ${preview.endDate}`)
console.log(`      every written message starts with ${FAKE_LABEL}; the business is separate from your real one`)
if (!args.apply) {
  console.log('\nDry run only: nothing was written. Add --apply to create it.')
  process.exit(0)
}

const password = randomBytes(18).toString('base64url')
const user = await call('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({ email: TEST_EMAIL, password, email_confirm: true, user_metadata: { fake_data: true, timezone: preview.business.timezone } }),
})

try {
  const [business] = await call('/rest/v1/businesses', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ owner_user_id: user.id, ...preview.business }),
  })
  const questions = await call(`/rest/v1/survey_questions?business_id=eq.${business.id}&select=id,prompt,type,options&order=position`)
  const seed = generateSeed({ endDate: today, days: args.days, timezone: preview.business.timezone, questions })
  await insertChunks('feedback', seed.feedback.map((f) => ({ business_id: business.id, ...f })))
  await insertChunks('events', seed.events.map((e) => ({ business_id: business.id, ...e })))
  console.log(`\nDone. Created ${seed.feedback.length} fake feedback rows and ${seed.events.length} fake events.`)
  console.log(`\nLog in to the app to see the charts (shown once, then gone):`)
  console.log(`   email:    ${TEST_EMAIL}`)
  console.log(`   password: ${password}`)
  console.log(`   page:     /r/${TEST_SLUG}`)
  console.log(`\nRemove it all later with:  node scripts/seed-test-data.mjs --project-ref ${args.projectRef} --delete`)
} catch (e) {
  // don't leave a half-built fake account behind
  await call(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' }).catch(() => {})
  fail(`Seeding failed and was rolled back: ${e.message}`)
}
