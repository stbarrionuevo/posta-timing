import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ADMIN_ROLES, JUDGE_ROLES, LANE_ROLES } from './lib/roles'
import RequireRole from './components/RequireRole'
import Login from './pages/Login'
import JudgeEvents from './pages/judge/JudgeEvents'
import JudgePanel from './pages/judge/JudgePanel'
import JudgeCorrections from './pages/judge/JudgeCorrections'
import LanePicker from './pages/lane/LanePicker'
import LaneOperator from './pages/lane/LaneOperator'
import Scoreboard from './pages/public/Scoreboard'
import Results from './pages/public/Results'
import Help from './pages/Help'
import JudgeChecklist from './pages/judge/JudgeChecklist'
import PaperSheets from './pages/judge/PaperSheets'
import AdminUsers from './pages/admin/AdminUsers'

const JUDGE_DENIED = 'Tu cuenta no tiene rol de juez o administrador en ninguna organización.'
const LANE_DENIED = 'Tu cuenta no tiene rol de operador en ninguna organización.'
const ADMIN_DENIED = 'Solo un administrador de la organización puede manejar usuarios.'

// Jueces al panel; operadores directo a elegir carril.
function RoleHome() {
  const { memberships } = useAuth()
  const isJudge = memberships.some((m) => JUDGE_ROLES.includes(m.role))
  return <Navigate to={isJudge ? '/juez' : '/carril'} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<RequireRole roles={LANE_ROLES} deniedText={LANE_DENIED}><RoleHome /></RequireRole>} />
          <Route path="/login" element={<Login />} />
          {/* Públicas: sin sesión si el evento es público (RLS decide qué se ve). */}
          <Route path="/marcador/:eventId" element={<Scoreboard />} />
          <Route path="/resultados/:eventId" element={<Results />} />
          <Route path="/ayuda" element={<Help />} />
          <Route path="/juez" element={<RequireRole roles={JUDGE_ROLES} deniedText={JUDGE_DENIED}><JudgeEvents /></RequireRole>} />
          <Route path="/juez/evento/:eventId" element={<RequireRole roles={JUDGE_ROLES} deniedText={JUDGE_DENIED}><JudgePanel /></RequireRole>} />
          <Route path="/juez/evento/:eventId/correcciones" element={<RequireRole roles={JUDGE_ROLES} deniedText={JUDGE_DENIED}><JudgeCorrections /></RequireRole>} />
          <Route path="/juez/evento/:eventId/checklist" element={<RequireRole roles={JUDGE_ROLES} deniedText={JUDGE_DENIED}><JudgeChecklist /></RequireRole>} />
          <Route path="/juez/evento/:eventId/planillas" element={<RequireRole roles={JUDGE_ROLES} deniedText={JUDGE_DENIED}><PaperSheets /></RequireRole>} />
          <Route path="/admin/usuarios" element={<RequireRole roles={ADMIN_ROLES} deniedText={ADMIN_DENIED}><AdminUsers /></RequireRole>} />
          <Route path="/carril" element={<RequireRole roles={LANE_ROLES} deniedText={LANE_DENIED}><LanePicker /></RequireRole>} />
          <Route path="/carril/:eventId/:teamId" element={<RequireRole roles={LANE_ROLES} deniedText={LANE_DENIED}><LaneOperator /></RequireRole>} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
