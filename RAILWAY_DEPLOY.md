# 🚂 Railway Deployment Guide

## Step 1: Push to GitHub

```bash
# Initialize git repository
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: Mug Mockup API"

# Create repository on GitHub, then push
git remote add origin https://github.com/YOUR_USERNAME/mugmockup-api.git
git branch -M main
git push -u origin main
```

## Step 2: Deploy to Railway

1. **Go to [railway.app](https://railway.app)**

2. **Sign in with GitHub**

3. **Click "New Project"**

4. **Select "Deploy from GitHub repo"**

5. **Choose your `mugmockup-api` repository**

6. **Railway auto-detects Node.js** ✅
   - Runs `npm install`
   - Starts with `node server.js`

## Step 3: Add Environment Variable

1. Click on your service
2. Go to **"Variables"** tab
3. Click **"+ New Variable"**
4. Add:
   ```
   Key: GEMINI_API_KEY
   Value: your_actual_gemini_api_key
   ```
5. Save

## Step 4: Generate Domain

1. Go to **"Settings"** tab
2. Scroll to **"Networking"**
3. Click **"Generate Domain"**
4. Copy your URL: `https://your-app.up.railway.app`

## Step 5: Test Your API

```bash
# Test health endpoint
curl https://your-app.up.railway.app/health

# Test mockup generation
curl -X POST https://your-app.up.railway.app/api/generate-mockup \
  -H "Content-Type: application/json" \
  -d '{
    "mockupUrl": "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=800",
    "designUrl": "https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=400"
  }'
```

## Step 6: Setup n8n

1. **Import workflow:**
   - Open `n8n-workflow.json`
   - Replace `YOUR-APP-NAME.up.railway.app` with your actual Railway URL
   - Import to n8n

2. **Activate workflow**

3. **Test webhook:**
   ```bash
   curl -X POST https://your-n8n.com/webhook/generate-mockup \
     -H "Content-Type: application/json" \
     -d '{
       "mockupUrl": "https://example.com/mug.jpg",
       "designUrl": "https://example.com/logo.png"
     }'
   ```

## 🎉 Done!

Your API is now:
- ✅ Live on Railway
- ✅ Auto-deploys on git push
- ✅ Ready for n8n integration
- ✅ Secured with environment variables

## 💡 Tips

**Auto-Deploy:**
Every time you push to GitHub, Railway automatically redeploys!

**View Logs:**
- Go to your Railway project
- Click "View Logs" to debug issues

**Custom Domain (Optional):**
- Settings → Networking → Custom Domain
- Add your own domain (e.g., `api.yourdomain.com`)

**Pricing:**
- Hobby Plan: $5/month
- Free trial includes $5 credit
- Sleeps after inactivity (wakes in ~1 second)

## 🐛 Troubleshooting

**Build Failed:**
- Check Railway logs
- Ensure `package.json` is correct
- Verify Node.js version compatibility

**API Not Responding:**
- Check `GEMINI_API_KEY` is set
- View logs for error messages
- Test health endpoint first

**Timeout Errors:**
- Railway free tier may have cold starts
- Wait ~10 seconds for first request
- Subsequent requests are fast

---

Need help? Check the main README.md or Railway's documentation.
