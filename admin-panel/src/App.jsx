import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import BusManagement from './pages/BusManagement';
import DriverManagement from './pages/DriverManagement';
import DriverApplications from './pages/DriverApplications';
import LiveMap from './pages/LiveMap';
import Alerts from './pages/Alerts';
import RouteEditor from './pages/RouteEditor';
import Analytics from './pages/Analytics';
import Passengers from './pages/Passengers';
import Layout from './components/Layout';
import { RealtimeProvider } from './lib/realtime';

// Map-based workspaces use the whole viewport.
const FULL_BLEED = new Set(['/map', '/alerts', '/applications', '/routes']);

/** One shell (and one socket connection) for every signed-in page. */
function Shell({ setIsAuthenticated }) {
  const { pathname } = useLocation();
  return (
    <RealtimeProvider>
      <Layout setIsAuthenticated={setIsAuthenticated} fullBleed={FULL_BLEED.has(pathname)}>
        <Outlet />
      </Layout>
    </RealtimeProvider>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(localStorage.getItem('token')));

  return (
    <Router>
      <Routes>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <Login setIsAuthenticated={setIsAuthenticated} />} />
        <Route element={isAuthenticated ? <Shell setIsAuthenticated={setIsAuthenticated} /> : <Navigate to="/login" />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/map" element={<LiveMap />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/applications" element={<DriverApplications />} />
          <Route path="/routes" element={<RouteEditor />} />
          <Route path="/buses" element={<BusManagement />} />
          <Route path="/drivers" element={<DriverManagement />} />
          <Route path="/passengers" element={<Passengers />} />
          <Route path="/analytics" element={<Analytics />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;
