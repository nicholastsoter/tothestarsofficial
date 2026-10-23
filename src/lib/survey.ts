export type QuestionType = 'short_text' | 'long_text' | 'multiple_choice' | 'rating'

export interface PublicQuestion {
  id: string
  type: QuestionType
  prompt: string
  options: string[] | null
  required: boolean
}

export type AnswerValue = string | number
export type AnswerMap = Record<string, AnswerValue | undefined>

/** Which extra the customer sees: the survey for 1-3 stars, the text box for 4-5. */
export const extraFor = (stars: number): 'survey' | 'text' => (stars <= 3 ? 'survey' : 'text')

/** Returns the id of the first required question left blank, or null. Mirrors the server rule
 *  (which is the real check): required questions only matter once the customer answers anything. */
export function firstMissingRequired(questions: PublicQuestion[], answers: AnswerMap): string | null {
  const answered = (q: PublicQuestion) => {
    const a = answers[q.id]
    return a !== undefined && (typeof a === 'number' || a.trim() !== '')
  }
  if (!questions.some(answered)) return null
  return questions.find((q) => q.required && !answered(q))?.id ?? null
}

/** Only answered questions are sent, as the {question_id, answer} pairs the server expects. */
export function toAnswerPayload(questions: PublicQuestion[], answers: AnswerMap): { question_id: string; answer: AnswerValue }[] {
  const out: { question_id: string; answer: AnswerValue }[] = []
  for (const q of questions) {
    const a = answers[q.id]
    if (a === undefined) continue
    if (typeof a === 'string') {
      if (a.trim() !== '') out.push({ question_id: q.id, answer: a.trim() })
    } else out.push({ question_id: q.id, answer: a })
  }
  return out
}

export const MAX_QUESTIONS = 10
export const MAX_OPTIONS = 10

export interface QuestionDraft {
  type: QuestionType
  prompt: string
  options: string[]
  required: boolean
}

/** A human-readable problem with a question being edited, or null if it can be saved.
 *  The database enforces the same rules; this just gives instant feedback. */
export function validateQuestionDraft(d: QuestionDraft): string | null {
  const prompt = d.prompt.trim()
  if (!prompt) return 'Write the question first.'
  if (prompt.length > 300) return 'Keep the question under 300 characters.'
  if (d.type === 'multiple_choice') {
    const opts = d.options.map((o) => o.trim())
    if (opts.length < 2) return 'Add at least 2 answer options.'
    if (opts.length > MAX_OPTIONS) return `Use at most ${MAX_OPTIONS} options.`
    if (opts.some((o) => o === '')) return 'Fill in or remove the empty option.'
    if (opts.some((o) => o.length > 100)) return 'Keep each option under 100 characters.'
    if (new Set(opts).size !== opts.length) return 'Each option must be different.'
  }
  return null
}

/**
 * The owner edited the survey while a customer was filling it in. Keeps only answers that still
 * fit the CURRENT questions (same id, and for multiple choice an option that still exists),
 * so the customer can resubmit without retyping everything.
 */
export function pruneAnswers(questions: PublicQuestion[], answers: AnswerMap): { answers: AnswerMap; dropped: number } {
  const kept: AnswerMap = {}
  let dropped = 0
  for (const [id, value] of Object.entries(answers)) {
    if (value === undefined) continue
    const q = questions.find((x) => x.id === id)
    const fits =
      q !== undefined &&
      (q.type === 'multiple_choice' ? typeof value === 'string' && (q.options ?? []).includes(value) : q.type === 'rating' ? typeof value === 'number' : typeof value === 'string')
    if (fits) kept[id] = value
    else dropped++
  }
  return { answers: kept, dropped }
}
