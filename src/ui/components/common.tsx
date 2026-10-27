import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { Color, PieceType } from '../../engine'
import { pieceUrl } from '../util'
import type { Toast } from '../util'

export function PieceGlyph({ type, color, className }: { type: PieceType; color: Color; className?: string }) {
  return <img className={className} src={pieceUrl(type, color)} alt="" draggable={false} />
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function Modal({ children, onClose }: { children: ReactNode; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="modal-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      {children}
    </div>
  )
}

export function Check({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Radio<T extends string>({
  name,
  value,
  current,
  label,
  onChange,
}: {
  name: string
  value: T
  current: T
  label: ReactNode
  onChange(v: T): void
}) {
  return (
    <label className="radio">
      <input type="radio" name={name} checked={current === value} onChange={() => onChange(value)} />
      <span>{label}</span>
    </label>
  )
}
