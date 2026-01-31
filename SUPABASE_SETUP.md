# Supabase Connection String Setup

The connection string in .env.production needs to be the **pooled connection string** from Supabase.

## How to get the correct connection string:

1. Go to your Supabase project dashboard
2. Click **Settings** (gear icon in sidebar)
3. Click **Database**
4. In the **Connection string** section, choose **URI**
5. Make sure **Use connection pooling** is checked
6. Copy the connection string that looks like:
   ```
   postgresql://postgres.xxx:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```

## Key differences:
- Port should be **6543** (not 5432)
- Host should include **.pooler.supabase.com**
- Should include connection pooling

## Alternative: Try the direct connection
If pooled doesn't work, try the **Transaction** mode connection string which uses port 5432 but might need additional SSL parameters:

```
postgresql://postgres.xxx:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

Please check your Supabase dashboard and update the DATABASE_URL in .env.production with the correct connection string.