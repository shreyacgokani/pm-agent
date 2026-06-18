import { createContext, useContext, useMemo, useState } from 'react';

const AgentContext = createContext(null);

export function AgentProvider({ children }) {
  const [status, setStatus] = useState('ready');
  const [callActive, setCallActive] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState(null);

  const value = useMemo(() => ({
    status,
    setStatus,
    callActive,
    setCallActive,
    callStartedAt,
    setCallStartedAt,
  }), [status, callActive, callStartedAt]);

  return (
    <AgentContext.Provider value={value}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  return useContext(AgentContext);
}
