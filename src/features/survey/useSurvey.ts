import { useCallback, useEffect, useState } from 'react'
import { describeDbError } from '../../lib/dbErrors'
import { supabase } from '../../lib/supabase'
import type { QuestionDraft, QuestionType } from '../../lib/survey'

export interface Question {
  id: string
  survey_id: string
  position: number
  type: QuestionType
  prompt: string
  options: string[] | null
  required: boolean
}

export interface SurveyState {
  survey: { id: string; enabled: boolean } | null
  questions: Question[]
  loading: boolean
  error: string | null
}

const toRow = (d: QuestionDraft) => ({
  type: d.type,
  prompt: d.prompt.trim(),
  required: d.required,
  options: d.type === 'multiple_choice' ? d.options.map((o) => o.trim()) : null,
})

/** Loads the owner's survey and exposes edits. Every call returns an error message, or null on success. */
export function useSurvey(businessId: string | undefined) {
  const [state, setState] = useState<SurveyState>({ survey: null, questions: [], loading: true, error: null })

  const load = useCallback(async () => {
    if (!businessId) return
    const [s, q] = await Promise.all([
      supabase.from('surveys').select('id, enabled').maybeSingle(),
      supabase.from('survey_questions').select('id, survey_id, position, type, prompt, options, required').order('position'),
    ])
    if (s.error || q.error || !s.data) {
      setState((x) => ({ ...x, loading: false, error: 'We couldn’t load your survey. Please refresh the page.' }))
      return
    }
    setState({ survey: s.data as SurveyState['survey'], questions: (q.data ?? []) as Question[], loading: false, error: null })
  }, [businessId])

  useEffect(() => {
    void load()
  }, [load])

  const setEnabled = async (enabled: boolean) => {
    if (!state.survey) return 'Survey not loaded.'
    const { error } = await supabase.from('surveys').update({ enabled }).eq('id', state.survey.id)
    if (error) return describeDbError(error)
    setState((x) => ({ ...x, survey: x.survey && { ...x.survey, enabled } }))
    return null
  }

  const add = async (draft: QuestionDraft) => {
    if (!state.survey || !businessId) return 'Survey not loaded.'
    const position = state.questions.reduce((m, q) => Math.max(m, q.position), -1) + 1
    const { error } = await supabase.from('survey_questions').insert({ ...toRow(draft), survey_id: state.survey.id, business_id: businessId, position })
    if (error) return describeDbError(error)
    await load()
    return null
  }

  const update = async (id: string, draft: QuestionDraft) => {
    const { error } = await supabase.from('survey_questions').update(toRow(draft)).eq('id', id)
    if (error) return describeDbError(error)
    await load()
    return null
  }

  const remove = async (id: string) => {
    const { error } = await supabase.from('survey_questions').delete().eq('id', id)
    if (error) return describeDbError(error)
    await load()
    return null
  }

  /** Moves a question up (-1) or down (+1). One database call re-numbers everything atomically. */
  const move = async (id: string, direction: -1 | 1) => {
    if (!state.survey) return 'Survey not loaded.'
    const ids = state.questions.map((q) => q.id)
    const from = ids.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= ids.length) return null
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    const previous = state.questions
    setState((x) => ({ ...x, questions: ids.map((qid, i) => ({ ...x.questions.find((q) => q.id === qid)!, position: i })) })) // show it instantly
    const { error } = await supabase.rpc('reorder_survey_questions', { p_survey_id: state.survey.id, p_ids: ids })
    if (error) {
      setState((x) => ({ ...x, questions: previous }))
      return 'We couldn’t save the new order. Please try again.'
    }
    return null
  }

  return { ...state, reload: load, setEnabled, add, update, remove, move }
}
