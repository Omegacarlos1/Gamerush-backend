# PlayRush Backend — AGENTS.md

## Mission
Implement the PlayRush browser-gaming backend using the approved PRD and milestone plan. Work only on the current approved milestone.

## Stack
Node.js, strict TypeScript, Express.js, Socket.IO when required, MySQL production and XAMPP MySQL local. Backend tests: Mocha, Chai, Supertest. Postman for API samples. Jest is reserved for frontend work.

## Architecture
Use a modular monolith. Separate routes/controllers, application services, repositories, domain rules and shared infrastructure. Keep API versioned at `/api/v1`. Validate input; use standardized errors, structured logging, dependency injection where helpful, parameterized SQL, transactions and versioned migrations.

## Product invariants
- Score: 1 point per metre, 10 points per coin, subject to trustworthy validation.
- XP: 1 XP per 10 validated score points; 500 XP per level; clarify rounding/thresholds before M04.
- Cosmetic characters unlock at levels 3 and 5; no competitive advantage.
- Weekly leaderboard: Monday 00:00 UTC reset; highest validated weekly score; earliest completion breaks ties.
- Top 10: virtual XP/badge rewards, granted idempotently.
- No cash staking, entry fees, real-money rewards or payment integration in initial release.

## Security and integrity
Do not trust client scores, XP, rewards, roles or completion timestamps. Reject duplicate/replayed sessions and invalid requests. Protect secrets, use least privilege, rate limiting and authorization. Do not expose stack traces in production. No unapproved production changes.

## Milestone workflow
1. Read the PRD, this file, milestone specification and latest report.
2. List assumptions, dependencies, acceptance criteria and test matrix.
3. Implement only the approved milestone.
4. Run formatting, lint, typecheck, build and relevant automated tests.
5. Generate Postman samples (positive and negative) for new endpoints.
6. Update architecture/API/migration docs and milestone report.
7. Provide the exact commands, results, counts, failures and known risks.
8. Update this AGENTS.md only if needed; summarize changes.
9. Write a copy-ready prompt for the next milestone based on actual repo state.
10. STOP and wait for explicit approval. Never claim unrun tests passed.

## Definition of done
A milestone is PASS only when its acceptance criteria are demonstrated with evidence, required tests and quality checks pass, API examples are documented, and there are no unresolved blocking defects. Otherwise report FAIL or BLOCKED.

## Required artifacts
`docs/milestones/Mxx.md`, `docs/reports/Mxx-report.md`, `docs/postman/Mxx.postman_collection.json` (when APIs exist), `docs/prompts/Mnext.md`, plus updated README/architecture/OpenAPI as needed.
