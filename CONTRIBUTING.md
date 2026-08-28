# Contributing

1. Use Node.js 20+ and Python 3.12+.
2. Keep game rules in `FarmRoom`; clients and RL adapters should send intents.
3. Preserve deterministic seeded behavior in headless code.
4. Add a verifier for mechanic, observation, reward, or protocol changes.
5. Run `npm test`, `npm run test:python`, and `npm run check:public`.
6. Do not commit saves, credentials, installed dependencies, model artifacts,
   trajectories, proprietary game data, or ROM/emulator artifacts.

Observation, action, checkpoint, and trajectory schema changes require a
version bump and migration note.
