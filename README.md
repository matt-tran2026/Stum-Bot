# Sports Bet MVP (Discord + API + EV Engine)

MVP monorepo for running a sports picks Discord server with onboarding helpers and EV utilities.

## What this includes

- `apps/bot`: Discord helper bot for onboarding, rules, and admin posting templates
- `apps/api`: API for picks, odds snapshots, and EV calculation
- `packages/db`: Prisma schema for picks, books, odds, and results
- `packages/shared`: Shared TypeScript utilities (odds conversion and EV)

## MVP flow

1. Admins post picks manually in Discord using `/post-template`.
2. Include selection, odds, book comparisons, and bet link.
3. Use shared EV logic/API for deeper analysis and future automation.

## Quick start

1. Install dependencies at repo root.
2. Configure `.env` files for each app.
3. Run Prisma migrate against Postgres.
4. Start API and bot apps.

## Environment variables (minimum)

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `DATABASE_URL`
- `ODDS_API_KEY`
- `DISCORD_RULES_CHANNEL_ID`
- `DISCORD_FREE_PICKS_CHANNEL_ID`
- `DISCORD_PREMIUM_PICKS_CHANNEL_ID`
- `DISCORD_HELP_CHANNEL_ID`
- `DISCORD_SUPPORT_ROLE_ID`

## Notes

- This scaffold uses placeholder odds ingestion. Wire `fetchMarketOdds` to your odds provider.
- Add legal/compliance text and responsible gambling disclaimers before production usage.
