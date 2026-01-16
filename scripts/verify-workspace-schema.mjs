/**
 * Verify workspace table schema after migration.
 */

import { Pool } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function verifySchema() {
  try {
    const { rows } = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'workspaces'
      ORDER BY ordinal_position
    `);
    
    console.log('📊 Workspaces table schema:');
    console.log(JSON.stringify(rows, null, 2));
    
    // Check specific fields
    const spreadsheetId = rows.find(r => r.column_name === 'spreadsheet_id');
    const driveFolderId = rows.find(r => r.column_name === 'drive_folder_id');
    const exportEnabled = rows.find(r => r.column_name === 'export_enabled');
    const primaryReadSource = rows.find(r => r.column_name === 'primary_read_source');
    
    console.log('\n✅ Key fields:');
    console.log(`  spreadsheet_id: ${spreadsheetId?.is_nullable === 'YES' ? '✅ nullable' : '❌ NOT NULL'}`);
    console.log(`  drive_folder_id: ${driveFolderId?.is_nullable === 'NO' ? '✅ NOT NULL' : '❌ nullable'}`);
    console.log(`  export_enabled: ${exportEnabled ? '✅ exists' : '❌ missing'}`);
    console.log(`  primary_read_source: ${primaryReadSource?.column_default || 'no default'}`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

verifySchema();
