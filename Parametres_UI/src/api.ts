// API contract for the n8n "settings" webhooks (v2 database).
//   GET  {BASE}/settings         -> Bootstrap
//   POST {BASE}/settings/action  -> { entity, action, data } -> { id?, exercise_id? }
// Identity: the SERVER derives user_id from the verified Telegram initData header.
// The client never sends a user id in the body.
export type Id = string
export interface Metric { key: string; label: string; unit: string | null }
export interface Sport { id: Id; name: string }
export interface Exercise { id: Id; name: string; sport_id: Id | null; metric_keys: string[] }
export interface Split { id: Id; name: string }
export interface Day { id: Id; split_id: Id; name: string }
export interface Item { id: Id; day_id: Id; exercise_id: Id; target_sets: number | null; targets: Record<string, number> }
export interface Bootstrap { sports: Sport[]; metrics: Metric[]; exercises: Exercise[]; splits: Split[]; days: Day[]; items: Item[] }
export type Entity = 'split' | 'day' | 'item'
export type Action = 'create' | 'update' | 'delete'
export interface ActionResult { id?: Id; exercise_id?: Id }

const BASE = import.meta.env.VITE_API_BASE as string | undefined

function identity(): Record<string, string> {
  const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp
  if (tg?.initData) return { 'X-Telegram-Init-Data': tg.initData }
  const dev = import.meta.env.VITE_DEV_TELEGRAM_ID as string | undefined
  if (import.meta.env.DEV && dev) return { 'X-Dev-Telegram-Id': dev }
  throw new Error('No Telegram identity. Open this page from the RepVibe bot.')
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  if (!BASE) throw new Error('VITE_API_BASE is not set (see .env.example).')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(BASE + path, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true', ...identity() },
    })
    if (!(res.headers.get('content-type') ?? '').includes('application/json'))
      throw new Error('Server did not return JSON. Is the workflow active and the URL using /webhook/ ?')
    const body = await res.json()
    if (!res.ok || body?.error) throw new Error(body?.error ?? `Request failed (${res.status})`)
    return body as T
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('Request timed out.')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

const str = (v: unknown) => String(v)
export async function loadBootstrap(): Promise<Bootstrap> {
  const r = await call<Partial<Bootstrap>>('/settings', { method: 'GET' })
  return {
    sports: (r.sports ?? []).map((s) => ({ ...s, id: str(s.id) })),
    metrics: r.metrics ?? [],
    exercises: (r.exercises ?? []).map((e) => ({ ...e, id: str(e.id), sport_id: e.sport_id == null ? null : str(e.sport_id), metric_keys: e.metric_keys ?? [] })),
    splits: (r.splits ?? []).map((s) => ({ ...s, id: str(s.id) })),
    days: (r.days ?? []).map((d) => ({ ...d, id: str(d.id), split_id: str(d.split_id) })),
    items: (r.items ?? []).map((i) => ({ ...i, id: str(i.id), day_id: str(i.day_id), exercise_id: str(i.exercise_id), targets: i.targets ?? {} })),
  }
}

export const act = (entity: Entity, action: Action, data: Record<string, unknown>) =>
  call<ActionResult>('/settings/action', { method: 'POST', body: JSON.stringify({ entity, action, data }) })
