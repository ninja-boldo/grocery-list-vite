# Server Docs

```
┌─────────────────────────────────────────────────────────────┐
│                    [[server-infrastructure]]                 │
└────────────────────────┬────────────────────────────────────┘
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
┌───▼───┐         ┌──────▼──────┐      ┌──────▼──────┐
│  [[auth]]  │     │  [[daemons]] │      │  [[ml]]      │
└─────────┘     └──────────────┘      └──────────────┘
                                                   
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ [[api-endpoints]] │  │ [[api-helpers]] │  │ [[query-builder]] │
└────────────────┘  └────────────────┘  └────────────────┘

┌────────────────┐  ┌────────────────┐
│   [[database]]  │  │   [[schema]]    │
└────────────────┘  └────────────────┘
```

## Quick Reference

| Topic | File | Key Functions |
|-------|------|---------------|
| All endpoints | `api-endpoints.md` | - |
| Business logic | `api-helpers.md` | `addItemToInventory`, `getWeekPlanForUser` |
| DB connection | `database.md` | `DatabaseManager.fetch_with_retry` |
| Schema details | `schema.md` | - |
| Background tasks | `daemons.md` | `classificationDaemon` |
| Authentication | `auth.md` | `verify_token`, `create_access_token` |

## Start Server

```bash
cd server
python server.py
# Runs on http://0.0.0.0:3030
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `GROQ_API_KEY` | required | Whisper transcription |
| `ACCESS_TOKEN_EXPIRE_SECONDS` | 1800 (30min) | JWT expiry |
| `ADMIN_USERNAMES` | "" | Comma-separated admin list |
| `RUNNING_IN_CONTAINER` | false | Use container DB URL |
| `MIN_PASSWORD_LENGTH` | 4 | Password validation |
| `DEPRECATION_DAYS_CATALOGUE` | 30 | Offer freshness |