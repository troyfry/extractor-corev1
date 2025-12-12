Great — you’re at the perfect moment to set up a **clean staging environment** for the Work Order Extractor (Free + future Pro/Premium).
Let’s list *exactly* which environment variables you will need for staging.

I’ll break this into:

* **Required now**
* **Recommended for staging**
* **Future (for when you add auth/billing)**
* **Local-only variables** (that MUST NOT go to staging)

This is tailored to your architecture:

* **Free = BYOK** (client only — no server usage)
* **Pro/Premium = server OpenAI key**
* **Dev-only toggle for testing tiers**
* **No billing yet**

---

# ✅ **REQUIRED NOW (Staging Environment)**

These are the environment variables you *must* have to run your app on a staging server.

---

## **1️⃣ Server OpenAI Key (for Pro & Premium)**

The only secret that needs to exist on your server:

```
OPENAI_API_KEY=sk-xxxxx
```

This key is **never exposed to the client**.
Used only in your server routes for Pro/Premium processing.

---

## **2️⃣ NEXT_PUBLIC_APP_ENV (optional but helpful)**

Lets your app conditionally show staging banners, logs, switches.

```
NEXT_PUBLIC_APP_ENV=staging
```

You can check:

```ts
const isStaging = process.env.NEXT_PUBLIC_APP_ENV === "staging";
```

---

## **3️⃣ NEXT_PUBLIC_SHOW_DEV_TIERS**

If you want staging to act like dev (show Pro/Premium tabs, etc.):

```
NEXT_PUBLIC_SHOW_DEV_TIERS=true
```

If staging should look exactly like production:

```
NEXT_PUBLIC_SHOW_DEV_TIERS=false
```

I recommend **true for staging**, so you can test all tiers.

---

## **4️⃣ NEXT_PUBLIC_DEV_MODE**

Controls whether Pro/Premium features are enabled for you.

```
NEXT_PUBLIC_DEV_MODE=true
```

Combined with your `isDevMode` flag, this makes staging behave like a “fake Pro environment” for testing.

---

# 🟦 **RECOMMENDED FOR STAGING**

Not required, but very useful.

---

## **5️⃣ LOGGING LEVELS (debug mode)**

Have a toggle to turn on deeper logs for server routes:

```
LOG_LEVEL=debug
```

Then in server routes:

```ts
if (process.env.LOG_LEVEL === "debug") console.log("payload:", payload);
```

---

## **6️⃣ GOOGLE SHEETS CONFIG (if applicable)**

Only if you plan to use service accounts for writing spreadsheets on staging:

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

**If you are using OAuth from your local browser, you do NOT need these.**

Since you’re using BYOK and personal Sheets for now, Sheets credentials might not be necessary yet.

---

# 🟪 **WHAT YOU DO *NOT* NEED YET**

### ❌ STRIPE keys

Not until billing is implemented.

### ❌ CLERK / SUPABASE auth env vars

Not needed unless you’re adding login/plan detection now.

### ❌ Database URL

You aren’t storing user data or production invoices yet.

### ❌ BYOK storage variables

BYOK is **only in the client**, stored in session/localStorage, not env.

### ❌ Any API key for external services (Make, Zapier, QuickBooks)

These belong in Premium later.

---

# 🟥 **LOCAL-ONLY ENV VARIABLES**

These **must NOT** be added to staging/production:

```
NEXT_PUBLIC_DEV_MODE=true
NEXT_PUBLIC_SHOW_DEV_TIERS=true
```

Unless you want staging to allow dev testing.
In production, set both to:

```
false
```

---

# 🎯 FINAL CHECKLIST FOR STAGING

Here is the clean minimal `.env.staging`:

```
OPENAI_API_KEY=sk-xxxxx

NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_SHOW_DEV_TIERS=true
NEXT_PUBLIC_DEV_MODE=true

# Optional debug logging
LOG_LEVEL=debug
```

That’s it.

---

# 🧪 Testing order on staging

Here’s the sequence you should follow when testing:

### 1. Visit the free tool → ensure BYOK prompt works

* Enter OpenAI key
* Confirm extraction works
* Confirm key stays in session/localStorage

### 2. Pretend to “upgrade” (set plan manually or via dev toggle)

* In dev mode or staging mode, flip plan to Pro in `useCurrentPlan()`
* Verify BYOK key is automatically cleared
* Confirm app uses your server key (you should see usage logs)

### 3. Test hiding vs showing Pro/Premium

* Flip `NEXT_PUBLIC_SHOW_DEV_TIERS=false`
* Confirm UI hides Pro/Premium

### 4. Flip `NEXT_PUBLIC_SHOW_DEV_TIERS=true`

* Confirm UI shows Pro/Premium and features are accessible to you only.

---

# Want me to generate the **deployment configuration** for:

* Vercel
* Hostinger
* Railway
* Render
* DigitalOcean
* elest.io

Just tell me which platform you’re staging on and I’ll generate **exact environment setup steps + recommended build settings**.
