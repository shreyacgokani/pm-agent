import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { AgentProvider } from './context/AgentContext';
import Dashboard from './pages/Dashboard';
import PMAgent from './pages/PMAgent';
import Prompts from './pages/Prompts';
import Skills from './pages/Skills';
import DesignAgent from './pages/DesignAgent';
import Integrations from './pages/Integrations';

export default function App() {
  return (
    <AgentProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="pm-agent" element={<PMAgent />} />
          <Route path="design-agent" element={<DesignAgent />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="prompts" element={<Prompts />} />
          <Route path="skills" element={<Skills />} />
        </Route>
      </Routes>
    </AgentProvider>
  );
}
