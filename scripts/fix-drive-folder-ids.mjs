/**
 * Fix NULL drive_folder_id values in workspaces table.
 * This is required before making drive_folder_id NOT NULL.
 */

import { Pool } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL is not set in .env.local or .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

async function fixDriveFolderIds() {
  try {
    console.log('🔍 Checking for NULL drive_folder_id values...');
    
    // Check current state
    const { rows: nullRows } = await pool.query(
      'SELECT COUNT(*) as count FROM workspaces WHERE drive_folder_id IS NULL'
    );
    const nullCount = parseInt(nullRows[0].count, 10);
    
    if (nullCount === 0) {
      console.log('✅ No NULL values found. Migration should work!');
      return;
    }
    
    console.log(`📊 Found ${nullCount} workspaces with NULL drive_folder_id`);
    
    // Show which workspaces need fixing
    const { rows: nullWorkspaces } = await pool.query(
      'SELECT id, spreadsheet_id, name FROM workspaces WHERE drive_folder_id IS NULL LIMIT 10'
    );
    
    if (nullWorkspaces.length > 0) {
      console.log('\n📋 Sample workspaces with NULL drive_folder_id:');
      nullWorkspaces.forEach(ws => {
        console.log(`  - ${ws.id} (spreadsheet: ${ws.spreadsheet_id || 'none'}, name: ${ws.name || 'none'})`);
      });
      if (nullCount > 10) {
        console.log(`  ... and ${nullCount - 10} more`);
      }
    }
    
    console.log('\n🔧 Populating NULL values with placeholder...');
    
    // Populate NULL values with a placeholder
    const result = await pool.query(`
      UPDATE workspaces 
      SET drive_folder_id = 'TEMP-' || id,
          updated_at = NOW()
      WHERE drive_folder_id IS NULL
    `);
    
    console.log(`✅ Updated ${result.rowCount} rows`);
    
    // Verify
    const { rows: verifyRows } = await pool.query(
      'SELECT COUNT(*) as count FROM workspaces WHERE drive_folder_id IS NULL'
    );
    const remainingNulls = parseInt(verifyRows[0].count, 10);
    
    if (remainingNulls === 0) {
      console.log('✅ All NULL values have been populated!');
      console.log('\n⚠️  NOTE: These are placeholder values. You should update them with real Drive folder IDs later.');
      console.log('   For now, you can run: npx drizzle-kit push');
    } else {
      console.error(`❌ Still have ${remainingNulls} NULL values. Something went wrong.`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

fixDriveFolderIds();
