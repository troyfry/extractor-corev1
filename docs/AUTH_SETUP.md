# Authentication Setup Guide

This document explains how to set up Google OAuth authentication for Work Order Extractor 2.0.

## Overview

The application uses **NextAuth (Auth.js v5)** with Google as the authentication provider. Currently, we use minimal scopes (profile/email) for basic authentication. The structure is prepared to expand scopes later for Google Sheets and Gmail integration.

## Environment Variables

Create a `.env.local` file in the project root with the following variables:

```env
# NextAuth Configuration
AUTH_SECRET=your-secret-here

# Google OAuth Credentials
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### Generating AUTH_SECRET

Generate a secure random string for `AUTH_SECRET`. You can use one of these methods:

**Using OpenSSL:**
```bash
openssl rand -base64 32
```

**Using Node.js:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Using PowerShell (Windows):**
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

### Creating Google OAuth Credentials

1. **Go to Google Cloud Console**
   - Visit: https://console.cloud.google.com/
   - Sign in with your Google account

2. **Create or Select a Project**
   - Click the project dropdown at the top
   - Create a new project or select an existing one

3. **Enable Google+ API** (if needed)
   - Go to "APIs & Services" > "Library"
   - Search for "Google+ API" and enable it (or use the newer Identity API)

4. **Create OAuth 2.0 Credentials**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - If prompted, configure the OAuth consent screen first:
     - Choose "External" (unless you have a Google Workspace)
     - Fill in app name, user support email, developer contact
     - Add scopes: `email`, `profile`, `openid`
     - Add test users if in testing mode
   - For "Application type", select "Web application"
   - Add authorized redirect URIs:
     ```
     http://localhost:3000/api/auth/callback/google
     ```
     (Add your production URL when deploying)

5. **Copy Credentials**
   - After creating, you'll see:
     - **Client ID** → use for `GOOGLE_CLIENT_ID`
     - **Client secret** → use for `GOOGLE_CLIENT_SECRET`
   - Copy these values to your `.env.local` file

## Current Scopes

Currently, the application requests only basic identity scopes:

- `openid` - OpenID Connect authentication
- `email` - User's email address
- `profile` - User's basic profile information

These scopes are defined in `lib/google/scopes.ts` and are sufficient for authentication.

## Future Scope Expansion

The codebase is structured to easily add Google Sheets and Gmail scopes later:

### For Google Sheets Integration

When ready to add Sheets access, you'll need to:

1. **Add scopes** in `lib/google/scopes.ts`:
   ```typescript
   export const GOOGLE_SHEETS_SCOPES = [
     "https://www.googleapis.com/auth/spreadsheets",
     "https://www.googleapis.com/auth/drive.file",
   ];
   ```

2. **Update OAuth consent screen** in Google Cloud Console:
   - Add the Sheets scopes to your app's requested scopes
   - Users will need to re-authorize to grant these permissions

3. **Store access tokens** in the NextAuth JWT callback (see `auth.ts` for TODO comments)

### For Gmail Integration

Similar process for Gmail:

1. **Add scopes** in `lib/google/scopes.ts`:
   ```typescript
   export const GOOGLE_GMAIL_SCOPES = [
     "https://www.googleapis.com/auth/gmail.readonly",
   ];
   ```

2. **Update OAuth consent screen** in Google Cloud Console

3. **Store access tokens** for API calls

## Installation

After setting up environment variables, install dependencies:

```bash
# Using npm
npm install

# Using pnpm
pnpm install

# Using yarn
yarn install
```

This will install `next-auth` (Auth.js v5) along with other dependencies.

## Testing Authentication

1. **Start the development server:**
   ```bash
   npm run dev
   # or
   pnpm dev
   ```

2. **Open the app:**
   - Navigate to `http://localhost:3000`
   - You should be redirected to `/auth/signin` if not authenticated

3. **Sign in:**
   - Click "Sign in with Google"
   - Complete the OAuth flow
   - You should be redirected back to the app

4. **Verify:**
   - Check the top-right corner for your user avatar/name
   - Click it to see the dropdown menu
   - Click "Sign out" to test logout

## Project Structure

Authentication-related files:

```
├── auth.ts                          # NextAuth configuration
├── middleware.ts                    # Route protection middleware
├── app/
│   ├── api/auth/[...nextauth]/     # Auth API routes
│   └── auth/signin/                 # Sign-in page
├── components/auth/
│   ├── AuthProvider.tsx             # SessionProvider wrapper
│   └── UserMenu.tsx                 # User menu component
├── lib/google/
│   └── scopes.ts                    # Google OAuth scopes config
└── types/
    └── next-auth.d.ts               # TypeScript type extensions
```

## Troubleshooting

### "Invalid credentials" error
- Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are correct
- Check that the redirect URI in Google Console matches: `http://localhost:3000/api/auth/callback/google`

### "Redirect URI mismatch" error
- Ensure the redirect URI in Google Cloud Console exactly matches: `http://localhost:3000/api/auth/callback/google`
- For production, add your production URL

### Session not persisting
- Verify `AUTH_SECRET` is set and is a valid random string
- Check browser cookies are enabled

### TypeScript errors
- Ensure `types/next-auth.d.ts` is included in `tsconfig.json`
- Restart the TypeScript server in your IDE

## Next Steps

Once authentication is working:

1. ✅ Users can sign in with Google
2. ✅ Protected routes require authentication
3. ✅ User info is displayed in the UI
4. 🔜 Add Google Sheets API integration (future)
5. 🔜 Add Gmail API integration (future)

## Security Notes

- Never commit `.env.local` to version control
- Use strong, random values for `AUTH_SECRET`
- Keep Google OAuth credentials secure
- When deploying, use environment variables in your hosting platform
- Consider using a database adapter for production (instead of JWT-only sessions)

