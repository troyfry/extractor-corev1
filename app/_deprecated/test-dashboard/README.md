# Test Dashboard

A visual dashboard for viewing categorized unit test results.

## Usage

1. **Generate test results:**
   ```bash
   npm run test:report
   ```
   This will:
   - Run all tests
   - Generate a JSON report
   - Copy it to `public/test-results.json` for the dashboard to read

2. **View the dashboard:**
   - Start the dev server: `npm run dev`
   - Navigate to: `http://localhost:3000/test-dashboard`

## Features

- **Categorized Tests**: Tests are automatically grouped by category (pdf, templates, signed, coords, gmail, workspace)
- **Pass/Fail Status**: Color-coded status indicators for each test
- **Test Suites**: Tests are organized by their test suite (describe blocks)
- **Duration**: Shows how long each test took to run
- **Error Details**: Failed tests show expandable error messages
- **Summary Statistics**: Overview cards showing total tests, pass rate, etc.

## Test Categories

- **PDF**: PDF intent policy and processing tests
- **Templates**: Template validation, regions, page dimensions, filename validation
- **Signed**: Signed PDF processing and preconditions
- **Coords**: Template coordinate conversion utilities
- **Gmail**: 
  - Gmail label state machine
  - Gmail processing utilities (work order extraction, success message formatting, batch aggregation)
  - Gmail signed PDF normalization (ensures Gmail PDFs are normalized like uploaded PDFs)
  - Gmail label name extraction and display
- **Workspace**: Workspace resolution logic
- **Process**: Process Access Layer tests (PDF rendering, raster detection, OCR)

