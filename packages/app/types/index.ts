export interface Patient {
  id: string;
  name: string;
  age: number;
  diagnosis: string;
  cognitive_level: string;
}

export interface TrendEntry {
  session_date: string;
  turn: number;
  emotion: string;
  memory_quality: string;
  engagement: string;
  scores: {
    emotion: number;
    memory_quality: number;
    engagement: number;
  };
  risk_flags: string;
}

export interface AlertEntry {
  date: string;
  turn: number;
  flag: string;
  emotion: string;
}

export interface TrendsData {
  trends: TrendEntry[];
  alerts: AlertEntry[];
}

export interface SummaryData {
  patient_id: string;
  patient_name: string;
  summary: string;
  session_count: number;
}

// --- V2 Types ---

export interface EventParsed {
  event_type: string;
  severity: string;
  location: string;
  trigger: string;
  summary: string;
}

export interface ProtocolStep {
  text: string;
  source: string;
  title: string;
  page: number;
  filename: string;
  score?: number;
}

export interface EventReportResponse {
  event_id: number;
  parsed: EventParsed;
  protocols: ProtocolStep[];
  transcription?: string;
}

export interface EventOut {
  id: number;
  patient_id: number;
  reporter_id: number;
  shift?: string;
  event_type: string;
  severity: string;
  description: string;
  location?: string;
  trigger?: string;
  protocol_matched?: any[];
  intervention_description?: string;
  intervention_at?: string;
  outcome_description?: string;
  outcome_at?: string;
  resolved: boolean;
  follow_up?: any[];
  event_at?: string;
  created_at?: string;
}

export interface HandoffOut {
  id: number;
  facility_id: number;
  from_shift: string;
  to_shift: string;
  handoff_time?: string;
  events_summary?: any[];
  pending_items?: any[];
  acknowledged_by_id?: number;
  acknowledged_at?: string;
  created_at?: string;
}
