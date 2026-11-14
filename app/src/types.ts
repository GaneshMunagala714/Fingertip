export type Contact = {
  id: string
  name: string
  number: string
  knows_sign: boolean
  kind: 'person' | 'business'
  style?: 'casual' | 'polite'
  fav?: boolean
  note?: string
  /** BCP-47 the other person speaks; '' or undefined = English. Needs Gemini on the server. */
  language?: string
}

export type Line = {
  id: string
  who: 'caller' | 'me'
  text: string
  status: string // caller: partial|final ; me: speaking|spoken|interrupted
  level: string
  kind: string
  unclear: boolean
  heard: string
  /** Other-language calls: the caller's own words (text is the English). */
  original?: string
  /** Other-language calls: what the caller actually heard. */
  spoken?: string
  ts: number
}

export type Draft = {
  id: string
  text: string
  source: string
  signs: string[]
  level: 'auto' | 'quick' | 'confirm'
  confirm_summary: string
  problems: string[]
  blocked: boolean
  tone: string
  hash: string
}

export type Analysis = {
  question_type: string
  options: string[]
  chips: string[]
  note_fact_key: string | null
  involves_money: boolean
  involves_commitment: boolean
  unclear: boolean
}

export type CallView = {
  sid: string
  state: string
  direction: 'incoming' | 'outgoing'
  contact: Contact
  startedAt: number | null
  lines: Line[]
  caption: Line | null
  draft: Draft | null
  analysis: Analysis | null
  confirm: { summary: string; sentence: string; hash: string } | null
  recap: string[]
  endedReason: string
  notice: { kind: string; text: string } | null
  editDraft: boolean
}

export type Recent = {
  id: string
  name: string
  number: string
  direction: 'incoming' | 'outgoing' | 'missed'
  at: number
  seconds: number
  contactId?: string
}

export type SavedTranscript = {
  id: string
  name: string
  at: number
  recap: string[]
  lines: { who: string; text: string }[]
}
