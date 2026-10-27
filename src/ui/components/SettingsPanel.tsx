import { Check, Modal } from './common'
import { updateSettings, useSettings } from '../settings'
import { sound } from '../sound'

export function SettingsPanel({ onClose }: { onClose(): void }) {
  const s = useSettings()
  return (
    <Modal onClose={onClose}>
      <div className="panel settings menu-font" role="dialog" aria-label="Settings">
        <div className="row">
          <h3>Settings</h3>
          <button className="x-btn" onClick={onClose} aria-label="Close">
            X
          </button>
        </div>
        <div className="row">
          <Check label="Enable sound" checked={s.sound} onChange={(v) => updateSettings({ sound: v })} />
          <input
            className="slider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.volume}
            aria-label="Sound volume"
            disabled={!s.sound}
            onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
            onPointerUp={() => {
              sound.unlock()
              sound.play('move')
            }}
          />
        </div>
        <Check label="Animations" checked={s.animations} onChange={(v) => updateSettings({ animations: v })} />
        <Check label="Auto perspective flip" checked={s.autoFlip} onChange={(v) => updateSettings({ autoFlip: v })} />
        <Check label="Tilted 3D camera" checked={s.cameraMode === '3d'} onChange={(v) => updateSettings({ cameraMode: v ? '3d' : '2d' })} />
        <Check label="Travel arrows for every turn" checked={s.allArrows} onChange={(v) => updateSettings({ allArrows: v })} />
        <Check label="Move highlights on past boards" checked={s.historyHighlights} onChange={(v) => updateSettings({ historyHighlights: v })} />
        <div className="meta">
          Chess pieces by Colin M.L. Burnett (cburnett), BSD license.
          <br />
          5D Chess web edition
        </div>
      </div>
    </Modal>
  )
}
