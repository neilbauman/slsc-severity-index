# Setup Guide

## Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `slsc-severity-index`
3. Description: "Multi-Country Shelter Severity Classification Toolset"
4. Choose: **Public** or **Private** (your choice)
5. Do NOT check "Initialize with README" (we already have files)
6. Click **"Create repository"**

## Step 2: Connect Your Local Project to GitHub

After creating the repo, GitHub will show you commands. Run these:

```bash
cd "/Users/neilbauman/Desktop/SLSC Severity Index/slsc-severity-index"
git remote add origin https://github.com/YOUR_USERNAME/slsc-severity-index.git
git branch -M main
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

## Step 3: Get Supabase Keys

1. Go to: https://supabase.com/dashboard/project/zanbizkpowwinhkrlkgd/settings/api
2. Copy these values:
   - **Project URL**: `https://zanbizkpowwinhkrlkgd.supabase.co` (already in .env.local.example)
   - **anon/public key**: Copy the "anon" or "public" key (starts with `eyJ...`)
   - **service_role key**: Copy the "service_role" key (keep this secret!)

3. Create your local `.env.local` file:
   ```bash
   cp .env.local.example .env.local
   ```
   
4. Edit `.env.local` and replace:
   - `your_anon_key_here` → paste your anon key
   - `your_service_role_key_here` → paste your service_role key

## Step 4: Deploy to Vercel

1. Go to: https://vercel.com
2. Sign up/Login with your GitHub account
3. Click **"Add New Project"**
4. Import your `slsc-severity-index` repository
5. Vercel will auto-detect Next.js settings
6. Add these Environment Variables (click "Environment Variables"):
   
   - **Name**: `NEXT_PUBLIC_SUPABASE_URL`
     **Value**: `https://zanbizkpowwinhkrlkgd.supabase.co`
   
   - **Name**: `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     **Value**: (paste your anon key from Step 3)
   
   - **Name**: `SUPABASE_SERVICE_ROLE_KEY`
     **Value**: (paste your service_role key from Step 3)

7. Click **"Deploy"**
8. Wait 2-3 minutes for deployment
9. Your app will be live at: `https://slsc-severity-index.vercel.app` (or similar)

## Step 5: Test Locally

```bash
cd "/Users/neilbauman/Desktop/SLSC Severity Index/slsc-severity-index"
npm run dev
```

Visit: http://localhost:3000

## That's It! 🎉

Your app is now:
- ✅ On GitHub
- ✅ Connected to Supabase
- ✅ Deployed on Vercel
- ✅ Ready to use!

