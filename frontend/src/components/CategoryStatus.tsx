import type { LibraryState } from '../types'

interface Props {
  lib: LibraryState
  onStart: () => void
  onCancel: () => void
}

/** Shown in place of the category cards until photos have been classified. */
export function CategoryStatus({ lib, onStart, onCancel }: Props) {
  const ai = lib.ai
  if (lib.edition === 'web')
    return (
      <div className="cta">
        <b>Categories are in the desktop app</b>
        <p>
          Sorting by what photos show (Travel, Food, Screenshots…) uses AI models that run on your
          computer with the Pixora desktop app. This web edition finds similar sets and the best
          shot in each, right in your browser.
        </p>
        {import.meta.env.VITE_REPO_URL && (
          <a href={import.meta.env.VITE_REPO_URL}>Get the desktop app on GitHub</a>
        )}
      </div>
    )
  if (!ai.available)
    return (
      <div className="cta">
        <b>Sort photos by what they show</b>
        <p>
          Categories like Travel, Food or Screenshots need Pixora's optional AI add-on. Install it
          once with <code>make setup-ai</code> and restart Pixora.
        </p>
      </div>
    )
  if (ai.status === 'loading' || ai.status === 'running')
    return (
      <div className="cta">
        <b>{ai.status === 'loading' ? 'Loading the AI models…' : 'Sorting your photos…'}</b>
        <p>
          {ai.status === 'loading'
            ? 'The first time, this downloads about 700 MB of models (once).'
            : `${ai.progress} of ${ai.total} photos analysed. Finished photos are saved, so you can stop and resume.`}
        </p>
        <progress value={ai.status === 'loading' ? undefined : ai.progress} max={ai.total || 1} />
        <button onClick={onCancel}>Stop</button>
      </div>
    )
  return (
    <div className="cta">
      <b>Sort photos by what they show</b>
      <p>
        Pixora looks at each photo with local AI models (CLIP and DINOv2) and sorts it into
        categories like Travel &amp; Vibes, Food &amp; Cafés or Screenshots. Everything runs on this
        computer: no photo is uploaded. Nothing on disk is moved or changed.
      </p>
      {ai.status === 'error' && <p className="red">Last run failed: {ai.error}</p>}
      {ai.status === 'cancelled' && <p className="muted">Stopped. Finished photos were kept.</p>}
      <button className="primary" onClick={onStart}>
        {ai.status === 'cancelled' ? 'Resume sorting' : 'Sort into categories'}
      </button>
    </div>
  )
}
