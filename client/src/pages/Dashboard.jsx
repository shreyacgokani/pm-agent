import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.dashboard()
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Loading dashboard...</div>;

  return (
    <div>
      <h2 className="page-title">Dashboard</h2>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Prompts</div>
          <div className="value">{data.counts.prompts}</div>
        </div>
        <div className="stat-card">
          <div className="label">Skills</div>
          <div className="value">{data.counts.skills}</div>
        </div>
        <div className="stat-card">
          <div className="label">Generations</div>
          <div className="value">{data.counts.generations}</div>
        </div>
      </div>

      <div className="card">
        <h3>Active Prompt</h3>
        <p>{data.activePrompt || 'No active prompt — set one in Prompts'}</p>
      </div>

      <div className="card">
        <h3>Recent Generations</h3>
        {data.recentGenerations.length === 0 ? (
          <p style={{ color: '#5e6c84', fontSize: 14 }}>
            No generations yet. <Link to="/pm-agent">Generate your first plan</Link>
          </p>
        ) : (
          <ul className="recent-list">
            {data.recentGenerations.map((g) => (
              <li key={g.id}>
                <span>{g.repo_name || g.repo_url}</span>
                <span className="date">{new Date(g.created_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3>Quick Start</h3>
        <ol style={{ paddingLeft: 20, fontSize: 14, lineHeight: 2 }}>
          <li>Configure your <Link to="/prompts">AI prompt</Link> for epic/story generation</li>
          <li>Add team <Link to="/skills">skills</Link> (frontend &amp; backend)</li>
          <li>Go to <Link to="/pm-agent">PM Agent</Link> and paste a GitHub repo URL</li>
        </ol>
      </div>
    </div>
  );
}
