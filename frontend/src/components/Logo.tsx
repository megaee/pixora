/** Pixora mark: a 3x3 grid of photo tiles going from charcoal to blush, i.e. pixels being sorted.
 *  The same drawing is inlined as the favicon in index.html. */
const TILES = [
  ['#241e20', '#241e20', '#7b4b65'],
  ['#241e20', '#7b4b65', '#d9a0ab'],
  ['#7b4b65', '#d9a0ab', '#f4dcda'],
]

export function Logo({ size = 28, title = 'Pixora' }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={title}>
      <rect width="32" height="32" rx="9" fill="#fbecea" />
      {TILES.flatMap((row, y) =>
        row.map((fill, x) => (
          <rect
            key={`${x}${y}`}
            x={6 + x * 7}
            y={6 + y * 7}
            width="6"
            height="6"
            rx="1.6"
            fill={fill}
          />
        )),
      )}
    </svg>
  )
}

export const TAGLINE = 'Your photos, beautifully sorted.'
