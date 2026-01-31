# Production Setup Guide

## 1. Supabase Database Setup

1. Create account at https://supabase.com
2. Create new project called "food-tracker"
3. Get connection string from Settings > Database
4. Update your local .env file:
   ```
   DATABASE_URL="your_supabase_connection_string"
   AI_PROVIDER="openai"
   OPENAI_API_KEY="your_openai_key"
   ```
5. Run migrations:
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

## 2. OpenAI API Setup

1. Go to https://platform.openai.com
2. Create API key (has $5 free credit)
3. Add to .env as OPENAI_API_KEY

## 3. Vercel Deployment

1. Push code to GitHub
2. Connect Vercel to your GitHub repo
3. Add environment variables in Vercel dashboard:
   - DATABASE_URL
   - OPENAI_API_KEY
   - AI_PROVIDER=openai

## 4. Test deployment

Your app will be available at https://your-app.vercel.app