# Deployment Architecture

## Overview

Three independent components to deploy. Database (Supabase) is already hosted.

| Component | Hosting | Cost |
|---|---|---|
| Frontend (Next.js 14) | Vercel Hobby | $0/month |
| Backend Python cron | GitHub Actions | $0/month |
| Gmail parser (Apps Script) | Keep as-is | $0/month |
| Database | Supabase (existing) | $0/month |
| **Total** | | **$0/month** |

---

## Component 1: Frontend → Vercel

**Why:** Zero-config Next.js deployment, free SSL, custom domain support, global CDN.

### Steps

1. **Security fix first** — remove `google_cloud_json_auth.json` from git:
   ```bash
   git rm --cached google_cloud_json_auth.json
   echo "google_cloud_json_auth.json" >> .gitignore
   git commit -m "remove service account json from repo"
   ```
   Then rotate the key in Google Cloud Console → IAM → Service Accounts.

2. Create account at [vercel.com](https://vercel.com) → Import GitHub repo

3. Set environment variables in Vercel dashboard (Settings → Environment Variables):
   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY   (server-side only)
   ```

4. Connect custom domain: Vercel → Settings → Domains → Add domain → Add the CNAME/A record shown at your registrar

**Limit:** Hobby tier: 100GB bandwidth/month — sufficient for an internal tool.

---

## Component 2: Backend Python Cron → GitHub Actions

**Why:** Free cron scheduling, secrets management built-in, `poppler-utils` available via apt, no server to manage. Private repos get 2,000 free minutes/month; the daily job runs ~5–15 min = ~300 min/month.

### Steps

1. **Add GitHub Secrets** (repo Settings → Secrets → Actions):
   ```
   SUPABASE_URL
   SUPABASE_KEY
   OPENAI_API_KEY
   GOOGLE_SERVICE_ACCOUNT_JSON    ← base64 of the JSON file
   HOTEL_INVOICES
   MMT_INVOICES
   HDFC_MPR_HOTEL_ACCOUNT
   BANK_STATEMENTS
   MMT_PAYOUTS
   ```
   Encode: `base64 -i google_cloud_json_auth.json | tr -d '\n'`

2. **Create `.github/workflows/cron.yml`:**
   ```yaml
   name: Document Processor
   on:
     schedule:
       - cron: '30 20 * * *'   # 2:00 AM IST = 8:30 PM UTC
     workflow_dispatch:          # allow manual trigger from GitHub UI

   jobs:
     process:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4

         - name: Install system dependencies
           run: sudo apt-get install -y poppler-utils

         - name: Set up Python
           uses: actions/setup-python@v5
           with:
             python-version: '3.11'
             cache: 'pip'

         - name: Install dependencies
           run: pip install -r requirements.txt

         - name: Write service account JSON
           run: echo "${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}" | base64 -d > google_cloud_json_auth.json

         - name: Run processor
           env:
             SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
             SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
             OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
             GOOGLE_SERVICE_ACCOUNT_JSON: google_cloud_json_auth.json
             HOTEL_INVOICES: ${{ secrets.HOTEL_INVOICES }}
             MMT_INVOICES: ${{ secrets.MMT_INVOICES }}
             HDFC_MPR_HOTEL_ACCOUNT: ${{ secrets.HDFC_MPR_HOTEL_ACCOUNT }}
             BANK_STATEMENTS: ${{ secrets.BANK_STATEMENTS }}
             MMT_PAYOUTS: ${{ secrets.MMT_PAYOUTS }}
           run: python main.py
   ```

   > Adjust `run: python main.py` and `requirements.txt` path if the backend lives in a subdirectory (e.g., `working-directory: ./backend`).

3. Test with `workflow_dispatch` before relying on the schedule.

**Fallback if minutes run out:** Railway.app or Render.com ~$5/month for a cron container.

---

## Component 3: Google Apps Script → Keep As-Is

**Do not migrate.** Apps Script runs inside Google's infrastructure with native Gmail/Drive access. Moving it to Python would require OAuth token refresh management and a persistent server — added complexity for zero benefit. The Python pipeline already reads its JSON output from Google Drive.

**Ensure:** The Drive folder IDs in `config.yaml` (`MMT_PAYOUTS`, `yatra_payout` folder `11VRWMBTfYJY10s9kXTKm-wq0Yq6QjnL1`) match the folders the Apps Script writes to.

---

## Security Checklist

- [ ] Remove `google_cloud_json_auth.json` from repo (`git rm --cached`)
- [ ] Remove from git history if already pushed (`git filter-repo` or BFG Repo Cleaner)
- [ ] Rotate the service account key in Google Cloud Console
- [ ] Add all secrets to GitHub Secrets and Vercel env vars
- [ ] Confirm `NEXT_PUBLIC_` vars use anon key only (safe to expose); service role key stays server-side

---

## Verification

1. Push to GitHub → Vercel auto-deploys → confirm app loads at `*.vercel.app` URL
2. Add custom domain → add DNS record → confirm HTTPS resolves
3. Manually trigger `workflow_dispatch` → confirm processor runs without errors, new rows appear in Supabase
4. Wait for first scheduled run at 2 AM IST → confirm via GitHub Actions run logs

---

## MCP-Assisted Deployment

If you connect MCP servers for Vercel and GitHub, I can execute the deployment steps directly without you running any commands.

### Currently connected
| Tool | MCP | Status |
|---|---|---|
| Supabase | Yes | **Already connected** in `.mcp.json` |

### Add to `.mcp.json` to unlock full deployment
```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=idlxwlrxucqredqouqrz"
    },
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer <YOUR_GITHUB_PAT>" }
    },
    "vercel": {
      "type": "http",
      "url": "https://vercel.com/mcp",
      "headers": { "Authorization": "Bearer <YOUR_VERCEL_TOKEN>" }
    }
  }
}
```

- **GitHub PAT**: github.com → Settings → Developer settings → Personal access tokens → scopes: `repo`, `workflow`
- **Vercel token**: vercel.com → Settings → Tokens

Once both are added, I can: create the workflow file, push it, trigger a deploy, set env vars, and connect the domain — all without you touching the terminal.

---

## Failure Monitoring

### What's already logged (no work needed)
The backend already writes every failure to Supabase:
- **`files` table** — `status = 'failed'`, `error_message`, `ocr_retry_count`
- **`processing_logs` table** — `operation`, `status = 'failure'`, `details` JSONB (file name, error, document type)

### Gap: no one is notified

**Layer 1 — Backend cron failures**

Individual file failures don't crash the GitHub Actions job (they're caught per-file), so GitHub's built-in email won't trigger. Fix: add a post-run check step to `cron.yml`:

```yaml
- name: Check for processing failures
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
  run: |
    python - <<'EOF'
    import os, sys
    from supabase import create_client
    from datetime import datetime, timedelta, timezone
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    res = sb.table("files").select("file_name,error_message").eq("status","failed").gte("updated_at", cutoff).execute()
    if res.data:
        print(f"FAILURES: {len(res.data)} file(s) failed:")
        for f in res.data: print(f"  - {f['file_name']}: {f['error_message']}")
        sys.exit(1)
    print("All files processed successfully.")
    EOF
```

This causes the job to fail → GitHub emails you automatically. Cost: $0.

**Layer 2 — Frontend failures**

- Deployment failures: Vercel emails you automatically, no setup needed.
- Runtime JS errors: visible in Vercel dashboard. Add Sentry (free tier) for email alerts on runtime errors.

**Layer 3 — Visibility dashboard (recommended)**

Add an admin-only page at `/admin/processing-logs` in the frontend that queries `processing_logs` and `files` — the data is already there. Shows recent failures, error messages, and per-document-type counts. No external service needed.
