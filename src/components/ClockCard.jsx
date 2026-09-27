import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import StatusBadge from './StatusBadge'
import { ConfirmDialog } from './Modal'
import { formatClock } from '../lib/eventClock'
import { beep } from '../lib/beep'
import {
  finishEvent,
  markEventReady,
  pauseEvent,
  reopenEventDraft,
  resumeEvent,
  startEvent,
} from '../services/eventsService'

// Control único del reloj: el juez inicia, pausa y finaliza para todos los carriles.
export default function ClockCard({ event, clock, sync, notReadyLanes, onChanged }) {
  const [dialog, setDialog] = useState(null)
  const wasTimeUp = useRef(clock.timeUp)

  useEffect(() => {
    if (clock.timeUp && !wasTimeUp.current) beep({ frequency: 660, times: 3 })
    wasTimeUp.current = clock.timeUp
  }, [clock.timeUp])

  const run = (fn, sound) => async (reason) => {
    await fn(reason)
    if (sound) beep(sound)
    await onChanged()
  }

  const { status } = event
  const clockClass = [
    'clock__time',
    status === 'paused' && 'clock__time--paused',
    clock.timeUp && 'clock__time--up',
    status === 'running' && !clock.timeUp && clock.remainingMs <= 60_000 && 'clock__time--last-minute',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className="card clock">
      <div className="clock__head">
        <StatusBadge status={status} />
        <span className="clock__sync">
          {sync.error
            ? 'Sin sincronizar con el servidor'
            : sync.synced
              ? `Reloj sincronizado (±${Math.round((sync.rtt ?? 0) / 2)} ms)`
              : 'Sincronizando reloj…'}
        </span>
      </div>

      <div className={clockClass} aria-live="polite">
        {formatClock(clock.remainingMs)}
      </div>
      <div className="clock__meta">
        Transcurrido {formatClock(clock.elapsedMs, { roundUp: false })} de {formatClock(clock.durationMs)}
        {' · '}Pileta {event.pool_length_m} m
      </div>

      {clock.timeUp && (
        <div className="alert alert--warning">
          <Icon name="flag-checkered" /> Tiempo cumplido. Esperá las últimas pasadas y finalizá el evento.
        </div>
      )}

      <div className="clock__actions">
        {status === 'draft' && (
          <button
            className="btn btn--primary btn--big"
            onClick={() =>
              setDialog({
                title: 'Confirmar roster',
                message:
                  'Los operadores van a poder marcar "Carril listo". Todavía se pueden agregar nadadores hasta que se inicie el reloj.',
                confirmLabel: 'Listo para largar',
                onConfirm: run(() => markEventReady(event.id)),
              })
            }
          >
            <Icon name="clipboard-check" /> Confirmar roster
          </button>
        )}

        {status === 'ready' && (
          <>
            <button
              className="btn btn--accent btn--big"
              disabled={!sync.synced}
              onClick={() =>
                setDialog(
                  notReadyLanes.length === 0
                    ? {
                        title: 'Iniciar el reloj',
                        message: 'Todos los carriles confirmaron. El reloj arranca para todos a la vez.',
                        confirmLabel: 'Iniciar',
                        onConfirm: run(() => startEvent(event.id, false), { frequency: 990, durationMs: 700 }),
                      }
                    : {
                        title: 'Hay carriles sin confirmar',
                        message: (
                          <>
                            <p>No confirmaron "Carril listo":</p>
                            <ul>
                              {notReadyLanes.map((t) => (
                                <li key={t.id}>Carril {t.lane_number} — {t.name}</li>
                              ))}
                            </ul>
                            <p>Si iniciás igual, queda registrado en la auditoría.</p>
                          </>
                        ),
                        confirmLabel: 'Iniciar igual',
                        danger: true,
                        onConfirm: run(() => startEvent(event.id, true), { frequency: 990, durationMs: 700 }),
                      }
                )
              }
            >
              <Icon name="play" /> Iniciar
            </button>
            <button
              className="btn btn--ghost"
              onClick={() =>
                setDialog({
                  title: 'Volver a borrador',
                  message: 'Los carriles van a tener que confirmar "listo" de nuevo.',
                  confirmLabel: 'Volver a borrador',
                  onConfirm: run(() => reopenEventDraft(event.id)),
                })
              }
            >
              Volver a borrador
            </button>
          </>
        )}

        {status === 'running' && !clock.timeUp && (
          <button
            className="btn btn--warning btn--big"
            onClick={() =>
              setDialog({
                title: 'Pausar el evento',
                message: 'El reloj se detiene para todos los carriles.',
                confirmLabel: 'Pausar',
                requireReason: true,
                onConfirm: run((reason) => pauseEvent(event.id, reason), { frequency: 440 }),
              })
            }
          >
            <Icon name="pause" /> Pausar
          </button>
        )}

        {status === 'paused' && (
          <button
            className="btn btn--accent btn--big"
            onClick={() =>
              setDialog({
                title: 'Reanudar',
                message: 'El reloj vuelve a correr para todos los carriles.',
                confirmLabel: 'Reanudar',
                onConfirm: run(() => resumeEvent(event.id), { frequency: 990 }),
              })
            }
          >
            <Icon name="play" /> Reanudar
          </button>
        )}

        {(status === 'running' || status === 'paused') && (
          <button
            className={`btn ${clock.timeUp ? 'btn--primary btn--big' : 'btn--ghost'}`}
            onClick={() =>
              setDialog({
                title: 'Finalizar el evento',
                message: clock.timeUp
                  ? 'Se cierran los resultados. Las pasadas que lleguen después se rechazan.'
                  : 'El tiempo todavía no terminó. Se corta el evento ahora y se cierran los resultados.',
                confirmLabel: 'Finalizar',
                danger: !clock.timeUp,
                onConfirm: run(() => finishEvent(event.id), { frequency: 660, times: 3 }),
              })
            }
          >
            <Icon name="flag-checkered" /> Finalizar
          </button>
        )}
      </div>

      {dialog && <ConfirmDialog {...dialog} onClose={() => setDialog(null)} />}
    </section>
  )
}
