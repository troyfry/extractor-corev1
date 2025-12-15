-- SQL script to reset free tier usage limits for development/testing
-- 
-- Usage:
--   psql -d your_database_name -f scripts/reset-limits.sql
-- 
-- Or connect to your database and run these commands manually:
--   psql -U your_user -d your_database
--   \i scripts/reset-limits.sql

-- Option 1: Reset ALL limits (daily, monthly, global)
-- Uncomment the lines below to reset everything:

-- DELETE FROM free_usage_daily;
-- DELETE FROM free_usage_monthly;
-- DELETE FROM free_usage_global;

-- Option 2: Reset limits for a specific IP hash
-- Replace 'your_ip_hash_here' with the actual IP hash you want to reset:

-- DELETE FROM free_usage_daily WHERE ip_hash = 'your_ip_hash_here';
-- DELETE FROM free_usage_monthly WHERE ip_hash = 'your_ip_hash_here';

-- Option 3: Reset only daily limits (keeps monthly and global)
DELETE FROM free_usage_daily;

-- Option 4: Reset only monthly limits (keeps daily and global)
-- DELETE FROM free_usage_monthly;

-- Option 5: Reset only global limits (keeps daily and monthly)
-- DELETE FROM free_usage_global;

-- Option 6: Reset limits for current day/month only
-- DELETE FROM free_usage_daily WHERE day_key = CURRENT_DATE::text;
-- DELETE FROM free_usage_monthly WHERE month_key = TO_CHAR(CURRENT_DATE, 'YYYY-MM');
-- DELETE FROM free_usage_global WHERE month_key = TO_CHAR(CURRENT_DATE, 'YYYY-MM');

-- View current limits (for verification)
SELECT 'Daily Limits:' as info;
SELECT ip_hash, day_key, count, updated_at 
FROM free_usage_daily 
ORDER BY updated_at DESC 
LIMIT 10;

SELECT 'Monthly Limits:' as info;
SELECT ip_hash, month_key, count, updated_at 
FROM free_usage_monthly 
ORDER BY updated_at DESC 
LIMIT 10;

SELECT 'Global Limits:' as info;
SELECT month_key, count, updated_at 
FROM free_usage_global 
ORDER BY updated_at DESC;

