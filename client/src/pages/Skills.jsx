import { useEffect, useState } from 'react';
import { api } from '../api';

const emptyForm = { name: '', description: '', category: 'general' };

export default function Skills() {
  const [skills, setSkills] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  function load() {
    api.skills.list().then(setSkills).catch((err) => setError(err.message));
  }

  useEffect(() => { load(); }, []);

  function startEdit(skill) {
    setForm({ name: skill.name, description: skill.description, category: skill.category });
    setEditingId(skill.id);
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
        await api.skills.update(editingId, form);
      } else {
        await api.skills.create(form);
      }
      cancel();
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this skill?')) return;
    try {
      await api.skills.delete(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Skills</h2>
        <button className="btn btn-primary" onClick={() => { cancel(); setShowForm(true); }}>
          Add Skill
        </button>
      </div>

      <p style={{ marginBottom: 20, color: '#5e6c84', fontSize: 14 }}>
        Define team skills so the AI can assign epics, stories, and subtasks to frontend or backend developers appropriately.
      </p>

      {error && <div className="error">{error}</div>}

      {showForm && (
        <div className="card">
          <h3>{editingId ? 'Edit Skill' : 'New Skill'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. React, Node.js, PostgreSQL"
                required
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description of the skill"
              />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option value="frontend">Frontend</option>
                <option value="backend">Backend</option>
                <option value="general">General</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
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
              <th>Category</th>
              <th>Description</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {skills.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td><span className={`badge badge-${s.category === 'frontend' ? 'frontend' : 'backend'}`}>{s.category}</span></td>
                <td style={{ color: '#5e6c84', fontSize: 13 }}>{s.description || '—'}</td>
                <td className="actions">
                  <button className="btn btn-secondary" onClick={() => startEdit(s)}>Edit</button>
                  <button className="btn btn-danger" onClick={() => handleDelete(s.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
