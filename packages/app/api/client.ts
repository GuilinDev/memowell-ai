import { Platform } from 'react-native';
import type {
  Patient,
  TrendsData,
  SummaryData,
  EventReportResponse,
  EventOut,
  HandoffOut,
} from '../types';

function getDefaultBaseUrl(): string {
  if (Platform.OS === 'web') {
    // Use env var if set (Railway deployment), otherwise same-origin (local dev with proxy)
    if (typeof process !== 'undefined' && (process.env as any).NEXT_PUBLIC_API_URL) {
      return (process.env as any).NEXT_PUBLIC_API_URL;
    }
    return '';
  }
  if (Platform.OS === 'android') return 'http://10.0.2.2:8000';
  return 'http://localhost:8000';
}

let baseUrl: string = getDefaultBaseUrl();

export function getBaseUrl(): string {
  return baseUrl;
}

export function setBaseUrl(url: string): void {
  baseUrl = url;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getPatients(): Promise<Patient[]> {
  return apiGet('/api/patients');
}

export async function getTrends(patientId: string): Promise<TrendsData> {
  return apiGet(`/api/trends/${patientId}`);
}

export async function getSummary(patientId: string): Promise<SummaryData> {
  return apiGet(`/api/summary/${patientId}`);
}

// --- V2: Events ---

export async function reportEvent(
  patientId: number,
  reporterId: number,
  text: string
): Promise<EventReportResponse> {
  const form = new FormData();
  form.append('patient_id', patientId.toString());
  form.append('reporter_id', reporterId.toString());
  form.append('text', text);
  const res = await fetch(`${baseUrl}/api/events/report`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function recordIntervention(
  eventId: number,
  text: string
): Promise<any> {
  const form = new FormData();
  form.append('text', text);
  const res = await fetch(`${baseUrl}/api/events/${eventId}/intervention`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function recordOutcome(
  eventId: number,
  text: string,
  resolved: boolean
): Promise<any> {
  const form = new FormData();
  form.append('text', text);
  form.append('resolved', resolved.toString());
  const res = await fetch(`${baseUrl}/api/events/${eventId}/outcome`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function listEvents(patientId?: number): Promise<EventOut[]> {
  const query = patientId ? `?patient_id=${patientId}` : '';
  return apiGet(`/api/events${query}`);
}

export async function getEvent(eventId: number): Promise<EventOut> {
  return apiGet(`/api/events/${eventId}`);
}

// --- V2: Handoffs ---

export async function generateHandoff(
  shift: string,
  reporterId: number,
  patientIds: number[]
): Promise<any> {
  const form = new FormData();
  form.append('shift', shift);
  form.append('reporter_id', reporterId.toString());
  patientIds.forEach((id) => form.append('patient_ids', id.toString()));
  const res = await fetch(`${baseUrl}/api/handoffs/generate`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function listHandoffs(): Promise<HandoffOut[]> {
  return apiGet('/api/handoffs');
}

export async function acknowledgeHandoff(handoffId: number): Promise<any> {
  const res = await fetch(`${baseUrl}/api/handoffs/${handoffId}/acknowledge`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// --- V2: RAG ---

export async function searchProtocols(
  query: string,
  nResults: number = 5
): Promise<any> {
  const res = await fetch(`${baseUrl}/api/rag/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, n_results: nResults }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
