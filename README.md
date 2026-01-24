# DataLoom

AI-powered database query assistant with a natural language interface. Query your databases using plain English, visualize results automatically, and explore data safely with read-only protection.

## Features

- **Natural Language Queries** - Ask questions in plain English, get instant results
- **Read-Only Protection** - Multiple security layers ensure your data stays safe
- **Smart Visualization** - Automatic chart recommendations based on query patterns
- **Multi-Database Support** - SQLite, PostgreSQL, and SQL Server
- **Knowledge Base** - Store and manage database metadata and business logic
- **AI Integration** - Connect to GitHub Copilot for enhanced SQL generation

## Tech Stack

### Backend
- Node.js 18+ with TypeScript
- Express.js web framework
- SQLite (internal database)
- Jest for testing

### Frontend
- React 18 with TypeScript
- Vite for fast development
- Material-UI components
- Zustand for state management
- Recharts for data visualization

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd DataLoom

# Install dependencies
npm run install:all

# Initialize the database
cd backend
npm run db:init
```

### Development

```bash
# Start backend (runs on port 8060)
npm run dev:backend

# In another terminal, start frontend (runs on port 3060)
npm run dev:frontend
```

Open http://localhost:3060 in your browser.

### Testing

```bash
# Run backend tests
npm run test:backend
```

## Project Structure

```
DataLoom/
├── backend/                 # Express + TypeScript backend
│   └── src/
│       ├── routes/         # API endpoints (query, copilot, dataloom)
│       ├── services/       # Business logic
│       │   ├── database/   # SQL validation & connection management
│       │   ├── copilot/    # AI integration
│       │   └── dataloom/   # Knowledge base management
│       ├── prompts/        # AI prompt templates
│       └── types/          # TypeScript definitions
├── frontend/               # React + Vite frontend
│   └── src/
│       ├── components/     # UI components & pages
│       │   ├── charts/     # Data visualization components
│       │   └── pages/      # Main application pages
│       ├── services/       # API client & utilities
│       ├── store/          # Zustand state management
│       └── types/          # TypeScript definitions
└── tests/                  # E2E and integration tests
```

## Security

DataLoom enforces read-only access through multiple layers:

1. **SQL Keyword Blocking** - Prevents INSERT, UPDATE, DELETE, and other data-modifying operations
2. **Injection Detection** - Blocks comment injection, statement chaining, and UNION attacks
3. **Database-Level Protection** - SQLite in readonly mode, PostgreSQL with READ ONLY transactions
4. **Performance Guards** - Limits on JOINs, query timeout, and result rows

## License

MIT License - see [LICENSE](LICENSE) for details

## Author & Owner

**Tony Xu** <fihtony@gmail.com>

Copyright © 2026 Tony Xu. All rights reserved.
