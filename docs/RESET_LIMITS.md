# Reset Limits for Dev Testing

This guide shows how to reset free tier usage limits for development testing.

## Quick Methods

### Method 1: Dev API Endpoint (Recommended)

Use the dev endpoint to reset limits via HTTP request:

```bash
# Reset ALL limits (daily, monthly, global)
curl -X DELETE http://localhost:3000/api/dev/reset-limits?scope=all

# Reset only daily limits
curl -X DELETE http://localhost:3000/api/dev/reset-limits?scope=daily

# Reset only monthly limits
curl -X DELETE http://localhost:3000/api/dev/reset-limits?scope=monthly

# Reset only global limits
curl -X DELETE http://localhost:3000/api/dev/reset-limits?scope=global

# Reset limits for a specific IP hash
curl -X DELETE "http://localhost:3000/api/dev/reset-limits?scope=all&ip=your_ip_hash"
```

**View current limits:**
```bash
# View all limits
curl http://localhost:3000/api/dev/reset-limits

# View limits for specific IP
curl "http://localhost:3000/api/dev/reset-limits?ip=your_ip_hash"
```

### Method 2: SQL Script

Run the SQL script directly:

```bash
# Using psql
psql -d your_database_name -f scripts/reset-limits.sql

# Or connect and run manually
psql -U your_user -d your_database
\i scripts/reset-limits.sql
```

**Edit `scripts/reset-limits.sql`** to choose which limits to reset:
- Uncomment the DELETE statements you want
- Comment out the ones you don't want

### Method 3: Direct SQL Commands

Connect to your database and run:

```sql
-- Reset ALL limits
DELETE FROM free_usage_daily;
DELETE FROM free_usage_monthly;
DELETE FROM free_usage_global;

-- Reset only daily limits (keeps monthly/global)
DELETE FROM free_usage_daily;

-- Reset only monthly limits
DELETE FROM free_usage_monthly;

-- Reset only global limits
DELETE FROM free_usage_global;

-- Reset for specific IP hash
DELETE FROM free_usage_daily WHERE ip_hash = 'your_ip_hash';
DELETE FROM free_usage_monthly WHERE ip_hash = 'your_ip_hash';

-- Reset for current day/month only
DELETE FROM free_usage_daily WHERE day_key = CURRENT_DATE::text;
DELETE FROM free_usage_monthly WHERE month_key = TO_CHAR(CURRENT_DATE, 'YYYY-MM');
DELETE FROM free_usage_global WHERE month_key = TO_CHAR(CURRENT_DATE, 'YYYY-MM');
```

## Understanding IP Hash

The limits are tracked by IP hash (not raw IP). To find your IP hash:

1. **Check logs** - Look for `[incrementFreeUsage]` logs that show the IP hash
2. **View via API** - `GET /api/dev/reset-limits` shows all IP hashes
3. **Query database** - `SELECT DISTINCT ip_hash FROM free_usage_daily;`

## Current Limits

- **Daily**: 10 documents per IP per day
- **Monthly**: 20 documents per IP per month  
- **Global**: 1000 documents per month (all users combined)

These are defined in `lib/limits/checkFreeLimits.ts`:
```typescript
const MAX_PER_DAY = 10;
const MAX_PER_MONTH = 20;
const FREE_GLOBAL_MAX_DOCS_PER_MONTH = 1000;
```

## Important: Limits Are Independent

**The numbers don't add up!** These are three separate checks, not cumulative:

- **Daily**: "Has THIS IP processed 10+ documents TODAY?"
- **Monthly**: "Has THIS IP processed 20+ documents THIS MONTH?" (accumulates across days)
- **Global**: "Have ALL IPs processed 1000+ documents THIS MONTH?" (sum of all IPs)

### Example Scenario:
- IP "abc123" processes 5 documents on Dec 15 → Daily=5, Monthly=5, Global=5
- IP "abc123" processes 5 more on Dec 15 → Daily=10, Monthly=10, Global=10
- IP "abc123" processes 5 more on Dec 16 → Daily=5 (new day), Monthly=15, Global=15
- IP "abc123" processes 5 more on Dec 16 → Daily=10, Monthly=20, Global=20
- **Result**: Daily limit hit (10), Monthly limit hit (20), but Global is fine (20 < 1000)

### What Happens If You Reset Only Daily?

If you delete daily records but keep monthly/global:
- ✅ Daily count goes to 0 → User can process 10 more TODAY
- ⚠️ Monthly count stays → If monthly=20, user is still blocked by monthly limit
- ⚠️ Global count stays → If global=1000, everyone is blocked

**In Dev**: This is usually fine! The limits are just to prevent abuse, not for billing. You can:
- Reset individual scopes to test specific limit scenarios
- Reset all if you want a clean slate
- Don't worry about mismatches - they're expected when testing

## Verification

After resetting, verify the limits are cleared:

```bash
# Via API
curl http://localhost:3000/api/dev/reset-limits

# Via SQL
SELECT COUNT(*) FROM free_usage_daily;
SELECT COUNT(*) FROM free_usage_monthly;
SELECT COUNT(*) FROM free_usage_global;
```

## Production Warning

⚠️ **The dev API endpoint (`/api/dev/reset-limits`) is automatically disabled in production.**

If you need to reset limits in production:
1. Use direct SQL commands (Method 3)
2. Or add additional authentication to the dev endpoint

## Troubleshooting

**Issue**: Endpoint returns 403 in production
- **Solution**: This is expected. Use SQL commands instead.

**Issue**: Limits not resetting
- **Check**: Verify you're connected to the correct database
- **Check**: Verify table names match (`free_usage_daily`, `free_usage_monthly`, `free_usage_global`)

**Issue**: Need to reset for specific IP
- **Solution**: Find the IP hash first, then use `?ip=hash` parameter or SQL WHERE clause

