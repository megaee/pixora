export interface Stat {
  label: string
  /** null while it is still being worked out */
  value: number | null
  /** small legend dot before the label */
  dot?: 'dark' | 'soft'
  /** extra detail on hover */
  hint?: string
}

/** One soft panel with four large figures, each under a small uppercase label. */
export function FileStatistics({ stats }: { stats: Stat[] }) {
  return (
    <section className="stats" aria-label="Folder statistics">
      {stats.map((s) => (
        <div className="stat" key={s.label} title={s.hint}>
          <div className="stat-label">
            {s.dot && <span className={`stat-dot ${s.dot}`} aria-hidden="true" />}
            {s.label}
          </div>
          <div className="stat-value">{s.value === null ? '…' : s.value.toLocaleString()}</div>
          {s.hint && <span className="sr-only">{s.hint}</span>}
        </div>
      ))}
    </section>
  )
}
