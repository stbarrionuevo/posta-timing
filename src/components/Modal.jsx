import { useState } from 'react'
import { friendlyError } from '../lib/errors'

export function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

// Pide confirmación y, si requireReason, un motivo obligatorio que queda en la auditoría.
// Campos extra: renderFields({ values, setValue }) + initialValues + isValid(values);
// onConfirm recibe (reason, values).
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  danger = false,
  requireReason = false,
  reasonLabel = 'Motivo',
  initialValues = {},
  renderFields,
  isValid = () => true,
  onConfirm,
  onClose,
}) {
  const [reason, setReason] = useState('')
  const [values, setValues] = useState(initialValues)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const setValue = (key, value) => setValues((v) => ({ ...v, [key]: value }))
  const canConfirm = !busy && (!requireReason || reason.trim().length > 0) && isValid(values)

  async function handleConfirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(reason.trim(), values)
      onClose()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={busy ? undefined : onClose}>
      {message && <div className="modal__message">{message}</div>}
      {renderFields?.({ values, setValue })}
      {requireReason && (
        <label className="field">
          <span className="field__label">{reasonLabel} (queda registrado)</span>
          <textarea
            className="input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus={!renderFields}
          />
        </label>
      )}
      {error && <div className="alert alert--danger">{friendlyError(error)}</div>}
      <div className="modal__actions">
        <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button
          className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
          onClick={handleConfirm}
          disabled={!canConfirm}
        >
          {busy ? 'Enviando…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
