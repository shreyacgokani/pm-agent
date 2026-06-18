CREATE TABLE IF NOT EXISTS prompts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS skills (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100) DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generations (
  id SERIAL PRIMARY KEY,
  repo_url TEXT NOT NULL,
  repo_name VARCHAR(255),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO prompts (name, content, is_active) VALUES
  ('Default PM Prompt', 'You are an expert product manager. Analyze the GitHub repository and design context to create well-structured epics, user stories, and subtasks. Separate work clearly between frontend and backend developers. Each story should have acceptance criteria.', true);

INSERT INTO skills (name, description, category) VALUES
  ('React', 'Frontend development with React and modern hooks', 'frontend'),
  ('Node.js', 'Backend API development with Express', 'backend'),
  ('PostgreSQL', 'Database design and queries', 'backend'),
  ('REST APIs', 'Designing and consuming RESTful endpoints', 'backend'),
  ('UI/UX', 'User interface design and usability', 'frontend');
