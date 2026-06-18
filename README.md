# PM Agent

A PERN stack app that analyzes GitHub repositories and generates epics, stories, and subtasks for frontend and backend developers using OpenAI.

## Stack

- **P**ostgreSQL — data storage
- **E**xpress — REST API
- **R**eact — frontend (Vite)
- **N**ode.js — backend runtime

## Features

- **Dashboard** — overview of prompts, skills, and recent generations
- **PM Agent** — paste a GitHub repo URL to generate epics, stories, and subtasks
- **Prompts** — configure the AI system prompt used for generation
- **Skills** — define team skills (frontend/backend) to guide task assignment

## Setup

### 1. Start PostgreSQL

```bash
cd pm-agent
docker compose up -d
```

### 2. Configure environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set your `OPENAI_API_KEY`. Optionally set `GITHUB_TOKEN` for higher GitHub API rate limits.

### 3. Install dependencies

```bash
npm run install:all
```

### 4. Run the app

```bash
npm run dev
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:5001

## Usage

1. Go to **Prompts** and create/activate an AI prompt
2. Go to **Skills** and add your team's frontend/backend skills
3. Go to **PM Agent**, paste a GitHub repo URL (e.g. `https://github.com/facebook/react`), and click **Generate**
4. View generated epics, stories (with acceptance criteria), and subtasks assigned to frontend or backend devs

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard` | Dashboard stats |
| GET/POST/PUT/DELETE | `/api/prompts` | Manage prompts |
| GET/POST/PUT/DELETE | `/api/skills` | Manage skills |
| GET/POST | `/api/generate` | List or create generations |
