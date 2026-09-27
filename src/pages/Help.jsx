import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'

const SECTIONS = [
  { id: 'operador', label: 'Operador de carril' },
  { id: 'juez', label: 'Juez' },
  { id: 'reclamos', label: 'Reclamos' },
  { id: 'organizacion', label: 'Organización' },
  { id: 'problemas', label: 'Problemas frecuentes' },
]

const PROBLEMS = [
  [
    'Arriba dice "Sin señal" en el celular del carril.',
    'El celular perdió el WiFi.',
    'Seguir marcando: las pasadas se guardan en el celular y se envían solas al volver la señal. No cerrar la app. Revisar el router si pasa en varios carriles.',
  ],
  [
    'El juez ve un carril en rojo: "Sin pasadas a … del inicio".',
    'El operador no está marcando o su celular no envía.',
    'Ir al carril. Si el operador sí marcó, mirar su pantalla: si dice "Sin señal", las pasadas llegarán al reconectar.',
  ],
  [
    'Se apagó o se rompió el celular de un carril.',
    'Batería o golpe.',
    'Con el celular de respaldo: iniciar sesión como operador y elegir el mismo carril. Las pasadas que quedaron guardadas en el celular apagado se envían cuando se lo vuelva a prender y se abra la pantalla del carril con señal. El veedor sigue la planilla de papel.',
  ],
  [
    'El operador tocó dos veces por error.',
    'Doble toque.',
    'Si fue a menos de los segundos del anti doble toque, el sistema lo ignora solo. Si no, "Deshacer" en los 30 s siguientes, o el juez la anula desde Correcciones.',
  ],
  [
    'Una pasada quedó a nombre del nadador equivocado.',
    'El cambio real no siguió el orden cargado.',
    'Juez → Correcciones → Reasignar, con motivo. Operador: antes del próximo toque, "Saltear a" o "Elegir otro".',
  ],
  [
    'El operador ve pasadas en "No registradas".',
    'El servidor las rechazó (fuera de tiempo, reloj del celular desfasado…).',
    'Avisar al juez: las ve en el Historial y, si correspondía, las agrega a mano desde Correcciones.',
  ],
  [
    'Rechazos por "reloj del dispositivo desfasado".',
    'El celular tiene mal la hora y no pudo sincronizarse.',
    'Recargar la app con señal: se sincroniza sola con el servidor.',
  ],
  [
    'El operador no ve el evento en "Elegir carril".',
    'El juez todavía no confirmó el roster, o el usuario no pertenece a la organización.',
    'Juez: "Confirmar roster". Organización: revisar el rol del usuario.',
  ],
  [
    'El marcador o los resultados dicen "no disponible".',
    'El evento no es público.',
    'Juez → Configuración → Marcador público → cambiar.',
  ],
  [
    'La pantalla del celular se apaga sola.',
    'La app se abrió sin https o el ahorro de batería la bloquea.',
    'Desactivar el bloqueo automático del celular durante el evento.',
  ],
]

export default function Help() {
  const navigate = useNavigate()

  return (
    <div className="help">
      <header className="results-hero no-print">
        <div className="results-hero__inner">
          <div>
            <h1>Manual de uso</h1>
            <div className="results-hero__sub">Postas americanas · operadores, jueces y organización</div>
          </div>
          <button className="topbar__action" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
            <Icon name="arrow-left" /> Volver
          </button>
        </div>
      </header>

      <main className="page help__page">
        <nav className="help__nav no-print">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' }) }}>
              {s.label}
            </a>
          ))}
          <button className="btn btn--ghost btn--small" onClick={() => window.print()}>
            <Icon name="print" /> Imprimir
          </button>
        </nav>

        {/* Tarjeta del operador: pensada para imprimir y dejar en el carril. */}
        <section id="operador" className="card help__section help__card">
          <h2>
            <Icon name="hand-pointer" /> Tarjeta del operador de carril
          </h2>
          <ol className="help__steps">
            <li>
              <strong>Ingresá</strong> con tu usuario y elegí el evento y <strong>tu carril</strong>.
            </li>
            <li>
              Antes de largar tocá <strong>CARRIL LISTO</strong> y verificá que arriba diga <strong>Conectado</strong>.
            </li>
            <li>
              Mirá quién figura <strong>En el agua</strong>: tiene que ser el primer nadador de tu equipo.
            </li>
            <li>
              Cada vez que el nadador <strong>completa un largo</strong>, tocá <strong>PASADA una sola vez</strong>. El
              turno pasa solo al siguiente nadador.
            </li>
            <li>
              Si entra otro nadador que no es el que muestra la pantalla, cambialo <strong>antes del próximo toque</strong>{' '}
              con "Saltear a" o "Elegir otro".
            </li>
            <li>
              ¿Te equivocaste? Tocá <strong>Deshacer</strong> (tenés unos 30 segundos) y avisale al juez.
            </li>
            <li>
              Si dice <strong>Sin señal</strong>, <strong>seguí marcando</strong>: las pasadas se guardan en el celular y
              se envían solas.
            </li>
            <li>
              No cierres la app, no cambies de aplicación y no bloquees el celular hasta que el juez finalice.
            </li>
          </ol>
          <div className="help__note">
            "Doble toque ignorado" significa que el sistema descartó un toque repetido: no hace falta hacer nada. Si ves
            algo en "No registradas", avisale al juez.
          </div>
        </section>

        <section id="juez" className="card help__section">
          <h2>
            <Icon name="gavel" /> Juez
          </h2>
          <h3>Antes del evento</h3>
          <ol className="help__steps">
            <li>Crear el evento: duración, largo de pileta, anti doble toque, qué pasa con la pasada incompleta, rotación automática y si el marcador es público.</li>
            <li>Cargar los equipos (carril y color) y sus nadadores <strong>en orden de relevo</strong>. Ese orden es el que sigue la rotación automática.</li>
            <li>Abrir el <strong>Checklist</strong> y resolver lo pendiente. Imprimir las <strong>planillas de papel</strong> para los veedores.</li>
            <li>
              <strong>Confirmar roster</strong>. Desde ahí los operadores pueden marcar "Carril listo". Todavía se pueden agregar nadadores sin trámite.
            </li>
            <li>Esperar a que todos los carriles estén en "Listo" y tocar <strong>Iniciar</strong>. Si alguno no confirmó, el sistema lo avisa; iniciar igual queda registrado.</li>
          </ol>
          <h3>Durante el evento</h3>
          <ul className="help__list">
            <li>El reloj es uno solo, para todos los carriles. Lo manejás vos: <strong>Pausar</strong> pide motivo; <strong>Reanudar</strong> y <strong>Finalizar</strong>.</li>
            <li>
              Mirá el tablero de carriles. Las alertas en rojo piden acción inmediata: <em>sin dispositivo</em>, <em>sin señal</em>,{' '}
              <em>sin pasadas al minuto de iniciar</em>. En amarillo: <em>última pasada hace más de 2 minutos</em>.
            </li>
            <li>Con el evento en curso, los cambios de roster (alta tardía, baja por lesión) se hacen desde el Roster y piden motivo.</li>
            <li>La rotación automática se puede apagar en Configuración si un equipo cambia de nadador fuera de orden todo el tiempo.</li>
          </ul>
          <h3>Correcciones</h3>
          <ul className="help__list">
            <li><strong>Pasada olvidada</strong>: elegís "después de la pasada #N" y el nadador. Queda marcada como manual.</li>
            <li><strong>Reasignar</strong>: la pasada existió, pero era de otro nadador.</li>
            <li><strong>Anular / Restaurar</strong>: una pasada que no debía contar, o que se anuló por error.</li>
            <li><strong>Penalizaciones y ajustes</strong>: restan o suman metros al equipo. <strong>Pasada incompleta</strong>: metros del último largo al cortar el tiempo, si la regla los cuenta.</li>
            <li>Todo pide motivo y queda en el <strong>Historial</strong> con tu nombre y la hora.</li>
          </ul>
          <h3>Al terminar</h3>
          <ol className="help__steps">
            <li>Tocar <strong>Finalizar</strong> cuando termine la última pasada en curso.</li>
            <li>Cargar la pasada incompleta si corresponde y revisar el Historial contra las planillas de papel.</li>
            <li>Descargar el <strong>PDF</strong> y el <strong>CSV</strong> de resultados y el CSV de auditoría.</li>
            <li>Compartir el link o el QR de resultados.</li>
          </ol>
        </section>

        <section id="reclamos" className="card help__section">
          <h2>
            <Icon name="scale-balanced" /> Cómo resolver "no me tomó el tiempo"
          </h2>
          <ol className="help__steps">
            <li>Abrir <strong>Correcciones y auditoría → Historial</strong> y filtrar por <strong>Rechazos</strong> y <strong>Dispositivos</strong> para ese carril.</li>
            <li>
              Si hay un <strong>toque rechazado</strong>, el operador sí tocó: el motivo dice por qué no contó (doble toque, fuera de tiempo, reloj
              desfasado).
            </li>
            <li>Si no hay nada, el celular <strong>no registró ningún toque</strong> en ese momento: revisar si el carril estuvo "Sin señal" y si el celular tiene pasadas sin enviar.</li>
            <li>Comparar con la <strong>planilla de papel</strong> del veedor.</li>
            <li>Decidir y, si corresponde, agregar la pasada o reasignarla <strong>con un motivo claro</strong>. Queda registrado quién decidió y por qué.</li>
          </ol>
          <div className="help__note">
            El reloj no depende de ningún celular: lo inicia el juez desde el servidor. Por eso no existe el caso de "el operador no tocó el botón de
            arrancar".
          </div>
        </section>

        <section id="organizacion" className="card help__section">
          <h2>
            <Icon name="building" /> Organización
          </h2>
          <h3>Usuarios</h3>
          <ul className="help__list">
            <li><strong>Administrador</strong>: todo lo que hace el juez, más los usuarios (Eventos → Usuarios): altas, roles, contraseñas y bajas. Una organización siempre tiene al menos un administrador.</li>
            <li><strong>Juez</strong>: crea y maneja eventos, corrige y ve la auditoría.</li>
            <li><strong>Operador</strong>: solo marca pasadas en el carril que elige.</li>
            <li>Conviene un usuario por persona: el historial muestra quién hizo cada cosa. Al crear un usuario, la app muestra los datos de acceso para copiar y mandar; la contraseña no se vuelve a mostrar.</li>
            <li>Si alguien olvida su contraseña, el administrador le genera una nueva desde la lista de usuarios.</li>
          </ul>
          <h3>Equipamiento recomendado</h3>
          <ul className="help__list">
            <li>Un celular por carril, más uno de respaldo. Cualquier celular con navegador actualizado.</li>
            <li>Router WiFi propio del evento, cerca de la pileta. No depender de la red del predio.</li>
            <li>Batería externa por celular y fundas para el agua.</li>
            <li>Notebook o tablet para el juez, y una TV o proyector para el marcador.</li>
          </ul>
          <h3>Datos</h3>
          <ul className="help__list">
            <li>Cada organización ve solo sus eventos. El marcador y los resultados son públicos solo si el juez lo activa.</li>
            <li>Las pasadas no se borran: se anulan con motivo. El historial no se puede modificar.</li>
          </ul>
        </section>

        <section id="problemas" className="card help__section">
          <h2>
            <Icon name="screwdriver-wrench" /> Problemas frecuentes
          </h2>
          <div className="table-wrap">
            <table className="table help__table">
              <thead>
                <tr>
                  <th>Qué pasa</th>
                  <th>Por qué</th>
                  <th>Qué hacer</th>
                </tr>
              </thead>
              <tbody>
                {PROBLEMS.map(([what, why, how]) => (
                  <tr key={what}>
                    <td className="strong">{what}</td>
                    <td>{why}</td>
                    <td>{how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
