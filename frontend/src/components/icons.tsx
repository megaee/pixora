/** Small outline icons (1.6px stroke, currentColor) used across the UI. */
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const FolderIcon = () => (
  <svg {...base}>
    <path d="M3.5 6.8c0-.9.7-1.6 1.6-1.6h4l2 2.1h7.8c.9 0 1.6.7 1.6 1.6v8.9c0 .9-.7 1.6-1.6 1.6H5.1c-.9 0-1.6-.7-1.6-1.6z" />
  </svg>
)

export const CameraIcon = () => (
  <svg {...base}>
    <path d="M4 8.2c0-.9.7-1.6 1.6-1.6h2.1l1.4-2h5.8l1.4 2h2.1c.9 0 1.6.7 1.6 1.6v9.2c0 .9-.7 1.6-1.6 1.6H5.6c-.9 0-1.6-.7-1.6-1.6z" />
    <circle cx="12" cy="12.6" r="3.4" />
  </svg>
)

export const UndoIcon = () => (
  <svg {...base}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
)

export const ShuffleIcon = () => (
  <svg {...base}>
    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </svg>
)
