import { supabase } from '../../lib/supabase'
import type { ExportRow } from '../../lib/csv'
import { PAGE_SIZE, toRpcArgs, type Filters } from './filters'

export interface InboxRow extends ExportRow {
  id: string
  private_note: string | null
}

interface RawRow extends InboxRow {
  total_count: number | string
}

export interface ListOptions {
  onlySurveys?: boolean
}

export async function fetchPage(filters: Filters, page: number, opts: ListOptions = {}): Promise<{ rows: InboxRow[]; total: number }> {
  const { data, error } = await supabase.rpc('inbox_feedback', toRpcArgs(filters, { ...opts, limit: PAGE_SIZE, offset: page * PAGE_SIZE }))
  if (error) throw new Error('Could not load feedback')
  const rows = (data ?? []) as RawRow[]
  return { rows, total: rows.length ? Number(rows[0].total_count) : 0 }
}

/** Every row matching the filters, fetched 500 at a time. */
export async function fetchAll(filters: Filters, opts: ListOptions = {}, onProgress?: (done: number, total: number) => void): Promise<InboxRow[]> {
  const out: InboxRow[] = []
  let total = Infinity
  while (out.length < total) {
    const { data, error } = await supabase.rpc('inbox_feedback', toRpcArgs(filters, { ...opts, limit: 500, offset: out.length }))
    if (error) throw new Error('Could not load feedback')
    const rows = (data ?? []) as RawRow[]
    if (rows.length === 0) break
    total = Number(rows[0].total_count)
    out.push(...rows)
    onProgress?.(out.length, total)
  }
  return out
}

export async function setStatus(id: string, status: 'new' | 'resolved'): Promise<boolean> {
  const { data, error } = await supabase.from('feedback').update({ status }).eq('id', id).select('id')
  if (!error && data && data.length === 1) notifyChanged()
  return !error && !!data && data.length === 1
}

export async function setNote(id: string, note: string): Promise<boolean> {
  const { data, error } = await supabase.from('feedback').update({ private_note: note.trim() === '' ? null : note.trim() }).eq('id', id).select('id')
  return !error && !!data && data.length === 1
}

export async function deleteItem(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('feedback').delete().eq('id', id).select('id')
  if (!error && data && data.length === 1) notifyChanged()
  return !error && !!data && data.length === 1
}

export async function fetchNewCount(): Promise<number> {
  const { data, error } = await supabase.rpc('new_feedback_count')
  return error ? 0 : Number(data ?? 0)
}

/** Lets the side-nav badge refresh straight away after a status change or delete. */
export const CHANGED_EVENT = 'feedback-changed'
export const notifyChanged = () => window.dispatchEvent(new Event(CHANGED_EVENT))
