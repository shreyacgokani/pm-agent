import { useEffect, useState } from 'react';
import { api } from '../api';

const emptyForm = { name: '', content: '', is_active: false };

export default function Prompts() {
  const [prompts, setPrompts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [databaseMode, setDatabaseMode] = useState(null);

  function load() {
    api.prompts.list().then(setPrompts).catch((err) => setError(err.message));
    api.dashboard().then((d) => setDatabaseMode(d.database)).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  function startEdit(prompt) {
    setForm({ name: prompt.name, content: prompt.content, is_active: prompt.is_active });
    setEditingId(prompt.id);
    setShowForm(true);
  }

  function cancel() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.prompts.update(editingId, form);
      } else {
        await api.prompts.create(form);
      }
      cancel();
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this prompt?')) return;
    try {
      await api.prompts.delete(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleActivate(id) {
    try {
      await api.prompts.update(id, { is_active: true });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Prompts</h2>
        <button className="btn btn-primary" onClick={() => { cancel(); setShowForm(true); }}>
          Add Prompt
        </button>
      </div>

      <p style={{ marginBottom: 20, color: '#5e6c84', fontSize: 14 }}>
        Define the PM prompt that controls Jira ticket formatting. Only one prompt can be active at a time.
      </p>

      {databaseMode && (
        <div className="prompt-active-banner" style={{ marginBottom: 16 }}>
          Prompt storage: <strong>{databaseMode === 'postgres' ? 'PostgreSQL (persistent)' : 'File-backed at server/data/store.json'}</strong>
          {databaseMode === 'memory' && ' — saved to disk on every edit'}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {showForm && (
        <div className="card">
          <h3>{editingId ? 'Edit Prompt' : 'New Prompt'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Prompt Content</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="You are an expert product manager..."
                required
              />
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Set as active prompt
            </label>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary">
                {editingId ? 'Update' : 'Create'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={cancel}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {prompts.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  {p.is_active
                    ? <span className="badge badge-active">Active</span>
                    : <span style={{ color: '#97a0af', fontSize: 13 }}>Inactive</span>}
                </td>
                <td className="actions">
                  {!p.is_active && (
                    <button className="btn btn-secondary" onClick={() => handleActivate(p.id)}>Activate</button>
                  )}
                  <button className="btn btn-secondary" onClick={() => startEdit(p)}>Edit</button>
                  <button className="btn btn-danger" onClick={() => handleDelete(p.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
