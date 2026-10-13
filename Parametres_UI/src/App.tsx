import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Dumbbell, Pencil, Plus, Trash2, X } from 'lucide-react'
import { act, loadBootstrap, type ActionResult, type Bootstrap, type Exercise, type Id, type Item } from './api'

const isTmp = (id: Id) => id.startsWith('tmp-')
const tmpId = () => `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`

// ───────── generic list panel ─────────
interface Row { id: Id; name: string; detail?: string }
interface PanelProps {
  title: string; sub?: string; rows: Row[]; activeId?: Id | null; disabled?: boolean; hint: string; empty: string; addLabel: string
  onSelect?: (id: Id) => void; onAdd?: (name: string) => void; onRename?: (id: Id, name: string) => void
  onAddClick?: () => void; onEdit?: (id: Id) => void; onDelete: (id: Id) => void
}
function Panel(p: PanelProps) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Id | null>(null)
  const [draft, setDraft] = useState('')
  const modalMode = !!p.onAddClick
  const commit = () => {
    const v = draft.trim()
    if (v) { if (editing) p.onRename?.(editing, v); else p.onAdd?.(v) }
    setAdding(false); setEditing(null); setDraft('')
  }
  const cancel = () => { setAdding(false); setEditing(null); setDraft('') }
  const editor = (
    <div className="edit">
      <input autoFocus value={draft} placeholder="Name…" onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }} />
      <button className="ib ok" onClick={commit} aria-label="Save"><Check size={16} /></button>
      <button className="ib" onClick={cancel} aria-label="Cancel"><X size={16} /></button>
    </div>
  )
  return (
    <section className="panel">
      <header className="ph">
        <div><h2>{p.title}</h2>{p.sub ? <small>{p.sub}</small> : null}</div>
        <span className="badge">{p.rows.length}</span>
      </header>
      <ul className="list">
        {p.disabled ? <li className="hint">{p.hint}</li> : p.rows.length === 0 && !adding ? <li className="hint">{p.empty}</li> : null}
        {!p.disabled && p.rows.map((r) => {
          if (editing === r.id) return <li key={r.id}>{editor}</li>
          const pend = isTmp(r.id)
          return (
            <li key={r.id}>
              <div className={`row ${p.onSelect ? 'sel' : ''} ${r.id === p.activeId ? 'on' : ''} ${pend ? 'pend' : ''}`} onClick={() => p.onSelect?.(r.id)}>
                <div className="tx"><div className="nm">{r.name}</div>{r.detail ? <div className="dt">{r.detail}</div> : null}</div>
                <div className="acts">
                  <button className="ib" disabled={pend} aria-label={`Edit ${r.name}`}
                    onClick={(e) => { e.stopPropagation(); if (modalMode) p.onEdit?.(r.id); else { setEditing(r.id); setDraft(r.name) } }}><Pencil size={14} /></button>
                  <button className="ib del" disabled={pend} aria-label={`Delete ${r.name}`}
                    onClick={(e) => { e.stopPropagation(); p.onDelete(r.id) }}><Trash2 size={14} /></button>
                </div>
                {p.onSelect ? <ChevronRight size={16} color={r.id === p.activeId ? '#f97316' : '#475569'} /> : null}
              </div>
            </li>
          )
        })}
        {adding && !p.disabled ? <li>{editor}</li> : null}
      </ul>
      <div className="foot">
        <button className="btn" disabled={p.disabled || adding || !!editing} onClick={() => (modalMode ? p.onAddClick!() : setAdding(true))}>
          <Plus size={16} />{p.addLabel}
        </button>
      </div>
    </section>
  )
}

// ───────── exercise modal (metric-driven) ─────────
interface ItemPayload { exercise_id?: Id; new_exercise?: { name: string; metric_keys: string[]; sport_id: Id | null }; target_sets: number; targets: Record<string, number> }
function ExerciseModal({ db, item, onSave, onClose }: { db: Bootstrap; item: Item | null; onSave: (p: ItemPayload) => void; onClose: () => void }) {
  const existing = item ? db.exercises.find((e) => e.id === item.exercise_id) ?? null : null
  const [query, setQuery] = useState(existing?.name ?? '')
  const [picked, setPicked] = useState<Exercise | null>(existing)
  const [creating, setCreating] = useState(false)
  const [sport, setSport] = useState<Id>('')
  const [newKeys, setNewKeys] = useState<string[]>([])
  const [sets, setSets] = useState(String(item?.target_sets ?? 3))
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(Object.entries(item?.targets ?? {}).map(([k, v]) => [k, String(v)])))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [onClose])

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => (q ? db.exercises.filter((e) => !isTmp(e.id) && e.name.toLowerCase().includes(q)).slice(0, 6) : []), [db.exercises, q])
  const exact = db.exercises.some((e) => e.name.toLowerCase() === q)
  const keys = picked ? picked.metric_keys : creating ? newKeys : []
  const label = (k: string) => db.metrics.find((m) => m.key === k)
  const toggle = (k: string) => setNewKeys((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))

  function save() {
    const n = Number(sets)
    if (!Number.isInteger(n) || n < 1) return setError('Sets must be a whole number of at least 1.')
    if (!picked && !creating) return setError('Choose an exercise or create a new one.')
    if (creating && (exact || !q)) return setError(exact ? 'That exercise already exists — select it from the list.' : 'Enter a name.')
    if (creating && newKeys.length === 0) return setError('Pick at least one metric to track.')
    const targets: Record<string, number> = {}
    for (const k of keys) {
      const raw = (vals[k] ?? '').trim()
      if (raw === '') continue
      const v = Number(raw)
      if (!Number.isFinite(v) || v < 0) return setError(`${label(k)?.label ?? k} must be a positive number.`)
      targets[k] = v
    }
    onSave(picked
      ? { exercise_id: picked.id, target_sets: n, targets }
      : { new_exercise: { name: query.trim(), metric_keys: newKeys, sport_id: sport || null }, target_sets: n, targets })
  }

  return (
    <div className="ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true">
        <header className="mh"><h2>{item ? 'Edit Exercise Targets' : 'Add Exercise'}</h2>
          <button className="ib" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <div className="mb">
          <div className="fld">
            <label htmlFor="ex">Exercise</label>
            {item || picked ? (
              <div className="pick"><span>{picked?.name ?? query}</span>
                {!item ? <button className="ib" onClick={() => { setPicked(null); setCreating(false) }} aria-label="Change"><X size={14} /></button> : null}</div>
            ) : (
              <>
                <input id="ex" autoFocus className="in" value={query} placeholder="Search or type a new name…"
                  onChange={(e) => { setQuery(e.target.value); setCreating(false); setError(null) }} />
                <div className="opts">
                  {matches.map((m) => <button key={m.id} className="opt" onClick={() => { setPicked(m); setQuery(m.name); setError(null) }}>
                    <span>{m.name}</span><small>{m.metric_keys.join(', ')}</small></button>)}
                  {q && !exact && !creating ? <button className="opt" onClick={() => setCreating(true)}><span>+ Create “{query.trim()}”</span></button> : null}
                </div>
              </>
            )}
          </div>
          {creating && !picked ? (
            <>
              <div className="fld"><label htmlFor="sp">Sport (optional)</label>
                <select id="sp" className="in" value={sport} onChange={(e) => setSport(e.target.value)}>
                  <option value="">—</option>{db.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div className="fld"><span className="lbl">What do you track?</span>
                <div className="chips">{db.metrics.map((m) => <button key={m.key} className={`chip ${newKeys.includes(m.key) ? 'on' : ''}`} onClick={() => toggle(m.key)}>{m.label}</button>)}</div></div>
            </>
          ) : null}
          {picked || creating ? (
            <div className="grid2">
              <div className="fld"><label htmlFor="sets">Sets</label>
                <input id="sets" className="in" type="number" min={1} value={sets} onChange={(e) => setSets(e.target.value)} /></div>
              {keys.map((k) => { const m = label(k); return (
                <div className="fld" key={k}><label htmlFor={`m-${k}`}>{m ? m.label + (m.unit ? ` (${m.unit})` : '') : k} · target</label>
                  <input id={`m-${k}`} className="in" type="number" min={0} placeholder="—" value={vals[k] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} /></div>) })}
            </div>
          ) : null}
          {error ? <p className="er">{error}</p> : null}
        </div>
        <footer className="mf"><button className="btn ghost sm" onClick={onClose}>Cancel</button><button className="btn sm" onClick={save}>Save</button></footer>
      </div>
    </div>
  )
}

// ───────── app ─────────
export default function App() {
  const [db, setDb] = useState<Bootstrap | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [splitId, setSplitId] = useState<Id | null>(null)
  const [dayId, setDayId] = useState<Id | null>(null)
  const [modal, setModal] = useState<{ item: Item | null } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    setLoadErr(null); setDb(null)
    try {
      const d = await loadBootstrap(); setDb(d)
      setSplitId(d.splits[0]?.id ?? null); setDayId(d.days.find((x) => x.split_id === d.splits[0]?.id)?.id ?? null)
    } catch (e) { setLoadErr(e instanceof Error ? e.message : 'Failed to load.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const flash = (e: unknown) => { setToast(e instanceof Error ? e.message : 'Something went wrong.'); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setToast(null), 5000) }
  // optimistic update: apply now, run request, on failure run `undo` (an inverse of `apply`, so concurrent edits are never lost)
  const mutate = (apply: (d: Bootstrap) => Bootstrap, undo: (d: Bootstrap) => Bootstrap, req: () => Promise<ActionResult>, ok?: (d: Bootstrap, r: ActionResult) => Bootstrap) => {
    setDb((d) => (d ? apply(d) : d))
    req().then((r) => { if (ok) setDb((d) => (d ? ok(d, r) : d)) }).catch((e) => { setDb((d) => (d ? undo(d) : d)); flash(e) })
  }

  if (loadErr) return <Shell><div className="center"><p style={{ color: '#ef4444' }}>{loadErr}</p><button className="btn sm" onClick={() => void load()}>Retry</button></div></Shell>
  if (!db) return <Shell><div className="center">Loading your plan…</div></Shell>

  const days = db.days.filter((d) => d.split_id === splitId)
  const items = db.items.filter((i) => i.day_id === dayId)
  const exName = (id: Id) => db.exercises.find((e) => e.id === id)?.name ?? 'Unknown exercise'
  const detail = (i: Item) => [i.target_sets != null ? `${i.target_sets} sets` : '', ...Object.entries(i.targets).map(([k, v]) => { const m = db.metrics.find((x) => x.key === k); return `${m?.label ?? k} ${v}${m?.unit ? ' ' + m.unit : ''}` })].filter(Boolean).join(' • ')
  const swap = (a: Id, b: Id) => (x: Id | null) => (x === a ? b : x)

  // splits
  const addSplit = (name: string) => { const t = tmpId(); setSplitId(t); setDayId(null)
    mutate((d) => ({ ...d, splits: [...d.splits, { id: t, name }] }), (d) => ({ ...d, splits: d.splits.filter((s) => s.id !== t) }), () => act('split', 'create', { name }),
      (d, r) => { if (!r.id) return d; setSplitId(swap(t, String(r.id))); return { ...d, splits: d.splits.map((s) => (s.id === t ? { ...s, id: String(r.id) } : s)) } }) }
  const renameSplit = (id: Id, name: string) => { const old = db.splits.find((s) => s.id === id)?.name ?? ''
    mutate((d) => ({ ...d, splits: d.splits.map((s) => (s.id === id ? { ...s, name } : s)) }), (d) => ({ ...d, splits: d.splits.map((s) => (s.id === id ? { ...s, name: old } : s)) }), () => act('split', 'update', { id, name })) }
  const delSplit = (id: Id) => { if (!window.confirm('Delete this split and all its days and exercises?')) return
    const split = db.splits.find((s) => s.id === id)!; const dd = db.days.filter((d) => d.split_id === id); const ids = new Set(dd.map((d) => d.id)); const ii = db.items.filter((i) => ids.has(i.day_id))
    if (splitId === id) { setSplitId(db.splits.find((s) => s.id !== id)?.id ?? null); setDayId(null) }
    mutate((d) => ({ ...d, splits: d.splits.filter((s) => s.id !== id), days: d.days.filter((x) => x.split_id !== id), items: d.items.filter((i) => !ids.has(i.day_id)) }),
      (d) => ({ ...d, splits: [...d.splits, split], days: [...d.days, ...dd], items: [...d.items, ...ii] }), () => act('split', 'delete', { id })) }
  // days
  const addDay = (name: string) => { if (!splitId || isTmp(splitId)) return; const t = tmpId(), sid = splitId; setDayId(t)
    mutate((d) => ({ ...d, days: [...d.days, { id: t, split_id: sid, name }] }), (d) => ({ ...d, days: d.days.filter((x) => x.id !== t) }), () => act('day', 'create', { split_id: sid, name }),
      (d, r) => { if (!r.id) return d; setDayId(swap(t, String(r.id))); return { ...d, days: d.days.map((x) => (x.id === t ? { ...x, id: String(r.id) } : x)) } }) }
  const renameDay = (id: Id, name: string) => { const old = db.days.find((x) => x.id === id)?.name ?? ''
    mutate((d) => ({ ...d, days: d.days.map((x) => (x.id === id ? { ...x, name } : x)) }), (d) => ({ ...d, days: d.days.map((x) => (x.id === id ? { ...x, name: old } : x)) }), () => act('day', 'update', { id, name })) }
  const delDay = (id: Id) => { if (!window.confirm('Delete this day and its exercises?')) return
    const day = db.days.find((x) => x.id === id)!; const ii = db.items.filter((i) => i.day_id === id)
    if (dayId === id) setDayId(null)
    mutate((d) => ({ ...d, days: d.days.filter((x) => x.id !== id), items: d.items.filter((i) => i.day_id !== id) }), (d) => ({ ...d, days: [...d.days, day], items: [...d.items, ...ii] }), () => act('day', 'delete', { id })) }
  // items (exercise targets inside a day)
  const saveItem = (p: ItemPayload) => { const editing = modal?.item ?? null; setModal(null)
    if (editing) { const old = editing; const id = editing.id
      return mutate((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, target_sets: p.target_sets, targets: p.targets } : i)) }), (d) => ({ ...d, items: d.items.map((i) => (i.id === id ? old : i)) }),
        () => act('item', 'update', { id, target_sets: p.target_sets, targets: p.targets })) }
    if (!dayId || isTmp(dayId)) return
    const t = tmpId(), ex = p.new_exercise ? tmpId() : p.exercise_id!, did = dayId, newEx: Exercise | null = p.new_exercise ? { id: ex, name: p.new_exercise.name, sport_id: p.new_exercise.sport_id, metric_keys: p.new_exercise.metric_keys } : null
    mutate((d) => ({ ...d, exercises: newEx ? [...d.exercises, newEx] : d.exercises, items: [...d.items, { id: t, day_id: did, exercise_id: ex, target_sets: p.target_sets, targets: p.targets }] }),
      (d) => ({ ...d, exercises: d.exercises.filter((e) => e.id !== ex || !newEx), items: d.items.filter((i) => i.id !== t) }),
      () => act('item', 'create', { day_id: did, position: items.length, ...p }),
      (d, r) => ({ ...d, exercises: d.exercises.map((e) => (e.id === ex && newEx && r.exercise_id ? { ...e, id: String(r.exercise_id) } : e)),
        items: d.items.map((i) => (i.id === t ? { ...i, id: r.id ? String(r.id) : i.id, exercise_id: newEx && r.exercise_id ? String(r.exercise_id) : i.exercise_id } : i)) })) }
  const delItem = (id: Id) => { const it = db.items.find((i) => i.id === id)!
    mutate((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }), (d) => ({ ...d, items: [...d.items, it] }), () => act('item', 'delete', { id })) }

  const activeSplit = db.splits.find((s) => s.id === splitId), activeDay = db.days.find((d) => d.id === dayId)
  return (
    <Shell toast={toast}>
      <div className="cols">
        <Panel title="Workout Splits" rows={db.splits} activeId={splitId} hint="" empty="No splits yet. Add one to get started." addLabel="Add New Split"
          onSelect={(id) => { setSplitId(id); setDayId(null) }} onAdd={addSplit} onRename={renameSplit} onDelete={delSplit} />
        <Panel title="Routine Days" sub={activeSplit?.name} rows={days} activeId={dayId} disabled={!activeSplit || isTmp(activeSplit.id)} hint="Select a split to view its days." empty="No days in this split yet." addLabel="Add New Day"
          onSelect={setDayId} onAdd={addDay} onRename={renameDay} onDelete={delDay} />
        <Panel title="Planned Exercises" sub={activeDay?.name} rows={items.map((i) => ({ id: i.id, name: exName(i.exercise_id), detail: detail(i) }))} disabled={!activeDay || isTmp(activeDay.id)}
          hint="Select a day to view its exercises." empty="No exercises planned yet." addLabel="Add Exercise"
          onAddClick={() => setModal({ item: null })} onEdit={(id) => setModal({ item: db.items.find((i) => i.id === id) ?? null })} onDelete={delItem} />
      </div>
      {modal ? <ExerciseModal db={db} item={modal.item} onSave={saveItem} onClose={() => setModal(null)} /> : null}
    </Shell>
  )
}

function Shell({ children, toast }: { children: React.ReactNode; toast?: string | null }) {
  return (
    <main className="app">
      <header className="top"><span className="logo"><Dumbbell size={20} color="#fff" /></span>
        <div><h1>Workout Builder</h1><p>Splits → Days → Exercises</p></div></header>
      {toast ? <div className="err" role="alert">{toast}</div> : null}
      {children}
    </main>
  )
}
