import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import JobSquare from './pages/JobSquare';
import ResumeManagement from './pages/ResumeManagement';
import PlatformManagement from './pages/PlatformManagement';
import DeliverySettings from './pages/DeliverySettings';
import DeliveryHistory from './pages/DeliveryHistory';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/jobs" element={<JobSquare />} />
          <Route path="/resume" element={<ResumeManagement />} />
          <Route path="/platforms" element={<PlatformManagement />} />
          <Route path="/settings" element={<DeliverySettings />} />
          <Route path="/history" element={<DeliveryHistory />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
