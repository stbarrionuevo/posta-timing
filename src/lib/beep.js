// Señal sonora para inicio/fin/pausa. Los navegadores exigen un gesto del
// usuario antes de sonar: se llama desde los botones del juez.
let ctx = null

export function beep({ frequency = 880, durationMs = 350, times = 1 } = {}) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    for (let i = 0; i < times; i++) {
      const start = ctx.currentTime + i * (durationMs / 1000 + 0.12)
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = frequency
      gain.gain.setValueAtTime(0.25, start)
      gain.gain.exponentialRampToValueAtTime(0.001, start + durationMs / 1000)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + durationMs / 1000)
    }
  } catch {
    // Sin audio disponible: la señal visual alcanza.
  }
}
