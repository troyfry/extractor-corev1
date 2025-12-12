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