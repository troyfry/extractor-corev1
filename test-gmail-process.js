/**
 * Quick test script for /api/gmail/process endpoint
 * 
 * Usage:
 *   node test-gmail-process.js <messageId> [autoRemoveLabel]
 * 
 * Example:
 *   node test-gmail-process.js 18c1234567890abcdef true
 * 
 * Note: You'll need to provide a valid session cookie or modify this script
 * to use your authentication method.
 */

const messageId = process.argv[2];
const autoRemoveLabel = process.argv[3] === 'true';

if (!messageId) {
  console.error('Usage: node test-gmail-process.js <messageId> [autoRemoveLabel]');
  console.error('Example: node test-gmail-process.js 18c1234567890abcdef true');
  process.exit(1);
}

const API_URL = process.env.API_URL || 'http://localhost:3000';
const SESSION_COOKIE = process.env.SESSION_COOKIE || ''; // Set this or modify script

async function testGmailProcess() {
  console.log('🧪 Testing Gmail Process API');
  console.log(`   Message ID: ${messageId}`);
  console.log(`   Auto Remove Label: ${autoRemoveLabel}`);
  console.log(`   API URL: ${API_URL}\n`);

  try {
    const response = await fetch(`${API_URL}/api/gmail/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SESSION_COOKIE ? { 'Cookie': SESSION_COOKIE } : {}),
      },
      body: JSON.stringify({
        messageId,
        autoRemoveLabel,
      }),
    });

    const data = await response.json();

    console.log(`📊 Response Status: ${response.status} ${response.statusText}\n`);

    if (!response.ok) {
      console.error('❌ Error Response:');
      console.error(JSON.stringify(data, null, 2));
      return;
    }

    console.log('✅ Success Response:');
    console.log(`   Work Orders Extracted: ${data.workOrders?.length || 0}`);
    console.log(`   Label Removed: ${data.meta?.labelRemoved || false}`);
    console.log(`   Source: ${data.meta?.source || 'unknown'}`);
    console.log(`   Message ID: ${data.meta?.messageId || 'unknown'}\n`);

    if (data.workOrders && data.workOrders.length > 0) {
      console.log('📋 Work Orders:');
      data.workOrders.forEach((wo, idx) => {
        console.log(`\n   ${idx + 1}. Work Order #${wo.workOrderNumber || '(MISSING)'}`);
        console.log(`      Issuer (from CSV): Check CSV export`);
        console.log(`      Customer: ${wo.customerName || 'N/A'}`);
        console.log(`      Vendor: ${wo.vendorName || 'N/A'}`);
        console.log(`      Scheduled: ${wo.scheduledDate || 'N/A'}`);
        console.log(`      Address: ${wo.serviceAddress || 'N/A'}`);
      });
    } else {
      console.log('⚠️  No work orders extracted');
      console.log('   Expected: Label should NOT be removed');
    }

    if (data.csv) {
      console.log('\n📄 CSV Preview (first 3 lines):');
      const csvLines = data.csv.split('\n').slice(0, 3);
      csvLines.forEach(line => console.log(`   ${line}`));
    }

    if (data.meta?.tokenUsage) {
      console.log('\n💰 Token Usage:');
      console.log(`   Prompt: ${data.meta.tokenUsage.promptTokens}`);
      console.log(`   Completion: ${data.meta.tokenUsage.completionTokens}`);
      console.log(`   Total: ${data.meta.tokenUsage.totalTokens}`);
    }

  } catch (error) {
    console.error('❌ Request Failed:');
    console.error(error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

// Run test
testGmailProcess().catch(console.error);

