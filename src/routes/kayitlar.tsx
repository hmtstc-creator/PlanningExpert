import { createFileRoute } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery } from '../lib/convexTransport'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/kayitlar')({
  component: KayitlarPage,
})

const CATEGORIES = [
  { value: 'decision', label: 'Decision', color: 'bg-blue-100 text-blue-800' },
  { value: 'rule', label: 'Business Rule', color: 'bg-purple-100 text-purple-800' },
  { value: 'improvement', label: 'Improvement', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'issue', label: 'Open Issue', color: 'bg-red-100 text-red-800' },
  { value: 'maintenance', label: 'Maintenance', color: 'bg-amber-100 text-amber-900' },
]

// Categories used to be stored with Turkish keys. Existing rows keep those
// keys, so they are mapped onto the current ones instead of being rewritten.
const LEGACY_CATEGORIES: Record<string, string> = {
  karar: 'decision',
  kural: 'rule',
  gelistirme: 'improvement',
  sorun: 'issue',
  'bakım': 'maintenance',
}

function normaliseCategory(value: string): string {
  return LEGACY_CATEGORIES[value] ?? value
}

function KayitlarPage() {
  const { results: logs, status } = usePaginatedQuery(
    api.changeLog.list,
    {},
    { initialNumItems: 100 },
  )
  const create = useMutation(api.changeLog.create)
  const remove = useMutation(api.changeLog.remove)

  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [category, setCategory] = useState('decision')
  const [author, setAuthor] = useState('')
  const [filter, setFilter] = useState<string | null>(null)

  async function handleAdd() {
    if (!title.trim()) return
    await create({
      title,
      detail: detail || undefined,
      category,
      author: author || undefined,
    })
    setTitle('')
    setDetail('')
  }

  const visible = filter
    ? logs.filter((l) => normaliseCategory(l.category) === filter)
    : logs

  return (
    <div className="w-full px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Change Log</h1>
      <p className="mt-2 text-muted-foreground">
        Decisions, business rules, improvements and open issues are recorded
        here, so the answer to "why did we do it this way?" is never lost.
      </p>

      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <input
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Title — e.g. 'Storage locations 1009/2009/2010 included in planning'"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          rows={3}
          placeholder="Detail / rationale (optional)"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                category === c.value ? c.color : 'bg-muted text-muted-foreground'
              }`}
            >
              {c.label}
            </button>
          ))}
          <input
            className="w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            placeholder="Who?"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
          <button
            onClick={() => void handleAdd()}
            className="ml-auto rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Add entry
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={() => setFilter(null)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${!filter ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
        >
          All ({logs.length})
        </button>
        {CATEGORIES.map((c) => {
          const count = logs.filter((l) => normaliseCategory(l.category) === c.value).length
          return (
            <button
              key={c.value}
              onClick={() => setFilter(c.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${filter === c.value ? c.color : 'bg-muted text-muted-foreground'}`}
            >
              {c.label} ({count})
            </button>
          )
        })}
      </div>

      <div className="mt-4 space-y-3">
        {status === 'LoadingFirstPage' && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {status !== 'LoadingFirstPage' && visible.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No entries yet.
          </p>
        )}
        {visible.map((log) => {
          const cat = CATEGORIES.find((c) => c.value === normaliseCategory(log.category))
          return (
            <div key={log._id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cat?.color ?? 'bg-muted'}`}>
                      {cat?.label ?? log.category}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString('en-GB')}
                      {log.author && ` · ${log.author}`}
                    </span>
                  </div>
                  <p className="mt-1 font-medium text-foreground">{log.title}</p>
                  {log.detail && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {log.detail}
                    </p>
                  )}
                </div>
                <button
                  className="text-xs text-destructive hover:underline"
                  onClick={() => void remove({ id: log._id })}
                >
                  Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
