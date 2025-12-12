# Testing the AI Prompt

## Method 1: Test Endpoint (Recommended)

A test endpoint is available at `/api/test-ai-prompt` that allows you to test the prompt with sample data.

### Test the Prompt Only (No OpenAI Call)

```bash
curl -X POST http://localhost:3000/api/test-ai-prompt \
  -H "Content-Type: application/json" \
  -d '{
    "emailSubject": "Work Order #1910446 - HVAC Repair",
    "emailBody": "Please complete the HVAC repair at the facility.",
    "pdfText": "Work Order Number: 1910446\nCustomer: ABC Corp\nService Address: 123 Main St\nScheduled Date: 2024-12-15\nAmount: $500.00",
    "testPromptOnly": true
  }'
```

This returns the generated prompt without calling OpenAI.

### Test with OpenAI (Requires OPENAI_API_KEY)

```bash
curl -X POST http://localhost:3000/api/test-ai-prompt \
  -H "Content-Type: application/json" \
  -d '{
    "emailSubject": "Work Order #1910446 - HVAC Repair",
    "emailBody": "Please complete the HVAC repair at the facility.",
    "pdfText": "Work Order Number: 1910446\nCustomer: ABC Corp\nService Address: 123 Main St\nScheduled Date: 2024-12-15\nAmount: $500.00",
    "testPromptOnly": false
  }'
```

This calls OpenAI and returns:
- `prompt`: The generated prompt
- `aiResponse`: Raw OpenAI response
- `parsedResult`: Parsed work orders array

## Method 2: Using a Real Email

1. Make sure you have an email in the database with PDF attachments
2. Set `OPENAI_API_KEY` in your environment
3. Click "Process this email" in the UI
4. Check the console logs for AI parsing results

## Method 3: Test Script

Create a file `test-prompt.js`:

```javascript
const testData = {
  emailSubject: "Work Order #1910446 - HVAC Repair",
  emailBody: "Please complete the HVAC repair at the facility.",
  pdfText: `Work Order Number: 1910446
Customer: ABC Corporation
Service Address: 123 Main Street, City, State 12345
Job Type: HVAC Repair
Scheduled Date: December 15, 2024
Amount: $500.00
Priority: High
Notes: Please contact facility manager before arrival.`
};

fetch('http://localhost:3000/api/test-ai-prompt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...testData, testPromptOnly: false })
})
  .then(r => r.json())
  .then(data => {
    console.log('Prompt:', data.prompt);
    console.log('AI Response:', data.aiResponse);
    console.log('Parsed Result:', JSON.stringify(data.parsedResult, null, 2));
  });
```

## Environment Variables

Make sure these are set in your `.env.local`:

```bash
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL_NAME=gpt-4o  # Optional, defaults to gpt-4o-mini
INDUSTRY_PROFILE_LABEL=Facility Management  # Optional
INDUSTRY_PROFILE_EXAMPLES=...  # Optional, examples for the prompt
```

## Testing Tips

1. **Start with `testPromptOnly: true`** to verify the prompt structure
2. **Use realistic sample data** that matches your actual work orders
3. **Check the parsed result** to ensure field mapping is correct
4. **Test edge cases**: missing fields, multiple work orders, date formats
5. **Monitor OpenAI costs** - each test call uses tokens

