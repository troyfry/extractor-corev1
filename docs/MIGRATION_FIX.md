# Database Migration Fix Guide

## Issue
The migration is failing because the `email_messages` table (or possibly `work_orders`) already exists in your database.

## Solution Options

### Option 1: Use `db:push` (Recommended for Development)

If you're in development and don't mind Drizzle syncing the schema directly:

```bash
pnpm db:push
```

This will:
- Add the `user_id` column to `work_orders` if it doesn't exist
- Sync any other schema changes
- Skip creating migration files

**Note:** If `work_orders` already has data, you'll need to handle the `user_id` column being NOT NULL. See Option 3.

### Option 2: Drop and Recreate (Development Only - Data Loss!)

If this is a development database and you don't mind losing data:

```sql
-- Connect to your database and run:
DROP TABLE IF EXISTS work_orders CASCADE;
DROP TABLE IF EXISTS email_messages CASCADE;
```

Then run:
```bash
pnpm db:migrate
```

### Option 3: Manual Migration (Production/Keep Data)

If you have existing data and need to preserve it:

1. **Add the column as nullable first:**
```sql
ALTER TABLE work_orders ADD COLUMN user_id VARCHAR(255);
```

2. **Assign existing work orders to a default user (or delete them):**
```sql
-- Option A: Delete existing work orders (if they're test data)
DELETE FROM work_orders;

-- Option B: Assign to a default user (replace 'default-user-id' with actual user ID)
UPDATE work_orders SET user_id = 'default-user-id' WHERE user_id IS NULL;
```

3. **Make the column NOT NULL:**
```sql
ALTER TABLE work_orders ALTER COLUMN user_id SET NOT NULL;
```

4. **Mark the migration as applied:**
```bash
# The migration should now pass, or you can use db:push to sync
pnpm db:push
```

### Option 4: Check if Tables Exist

If you want to check what tables exist first:

```sql
-- Connect to your database
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('work_orders', 'email_messages');
```

If both tables exist, use Option 3.
If neither exists, use Option 1 or 2.

## Recommended Approach

For **development/testing**:
1. Use `pnpm db:push` - it's simpler and handles schema sync automatically
2. If you have test data you want to keep, use Option 3

For **production**:
1. Always use Option 3 (manual migration) to preserve data
2. Test the migration on a staging database first

## After Migration

Once the migration is complete, verify:

```sql
-- Check that user_id column exists and is NOT NULL
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'work_orders' 
  AND column_name = 'user_id';
```

You should see:
- `column_name`: `user_id`
- `data_type`: `character varying`
- `is_nullable`: `NO`

