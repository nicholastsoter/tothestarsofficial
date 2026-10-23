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
