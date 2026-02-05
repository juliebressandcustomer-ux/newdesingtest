# 🎨 Mug Mockup Generator API

AI-powered product mockup generator using Google Gemini. Perfect for n8n automation workflows.

## 🚀 Quick Start

### Deploy to Railway (Recommended)

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/mugmockup-api.git
   git push -u origin main
   ```

2. **Deploy to Railway:**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Add environment variable: `GEMINI_API_KEY`
   - Railway auto-deploys! 🎉

3. **Get your API URL:**
   - Settings → Generate Domain
   - Copy URL (e.g., `https://mugmockup-api.up.railway.app`)

### Local Development

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Add your Gemini API key to .env
GEMINI_API_KEY=your_key_here

# Run server
npm start
```

Server runs at `http://localhost:3000`

## 📡 API Usage

### Health Check
```bash
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "message": "Mug Mockup API is running",
  "timestamp": "2024-02-05T10:30:00.000Z"
}
```

### Generate Mockup
```bash
POST /api/generate-mockup
Content-Type: application/json

{
  "mockupUrl": "https://example.com/mug-photo.jpg",
  "designUrl": "https://example.com/logo.png"
}
```

**Response:**
```json
{
  "success": true,
  "image": "data:image/png;base64,iVBORw0KGgo...",
  "mimeType": "image/png",
  "timestamp": "2024-02-05T10:30:15.000Z"
}
```

### cURL Example
```bash
curl -X POST https://your-api.railway.app/api/generate-mockup \
  -H "Content-Type: application/json" \
  -d '{
    "mockupUrl": "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=800",
    "designUrl": "https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=400"
  }'
```

## 🤖 n8n Integration

### Setup Workflow

1. **Create HTTP Request Node:**
   - Method: POST
   - URL: `https://your-api.railway.app/api/generate-mockup`
   - Body:
     ```json
     {
       "mockupUrl": "{{ $json.mockupUrl }}",
       "designUrl": "{{ $json.designUrl }}"
     }
     ```

2. **Process Response:**
   - The `image` field contains base64 data
   - Use it to save files, send emails, upload to cloud storage, etc.

### Example n8n Workflows

**Automated Product Mockups:**
```
Webhook → Generate Mockup → Save to Google Drive → Send Email
```

**Batch Processing:**
```
Google Sheets → Loop → Generate Mockup → Update Sheet
```

**E-commerce Integration:**
```
Shopify Order → Extract Design → Generate Mockup → Update Order
```

## 💰 Costs

| Service | Cost |
|---------|------|
| Railway Hosting | $5/month (hobby plan) |
| Gemini API | ~$0.003 per mockup |
| **Total for 1,000 mockups** | **~$8/month** |

### Free Tier
- Railway: $5 credit on trial
- Gemini: 1,500 requests/day free

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GEMINI_API_KEY` | Your Google Gemini API key | ✅ Yes |
| `PORT` | Server port (default: 3000) | ❌ No |

### Get Gemini API Key

1. Go to [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click "Create API Key"
3. Copy and use in your `.env` or Railway settings

## 📊 Performance

- **Response Time:** 5-10 seconds per mockup
- **Rate Limit:** 15 requests/minute (Gemini free tier)
- **Image Size:** Up to 5MB recommended
- **Supported Formats:** PNG, JPG, JPEG, WebP

## 🐛 Troubleshooting

### "Missing required fields" error
- Ensure you're sending both `mockupUrl` and `designUrl`
- Check JSON format is correct

### "Failed to fetch image" error
- Make sure image URLs are publicly accessible
- Try opening URLs in browser to verify
- Avoid Google Drive share links (use direct image URLs)

### Timeout errors
- Increase timeout in n8n to 30 seconds
- Try smaller images (<2MB)
- Check Railway logs for details

### "No response from AI model"
- Verify Gemini API key is correct
- Check API key has credits/quota remaining
- Ensure images are in supported formats

## 🔒 Security

- ✅ API key stored server-side (never exposed)
- ✅ CORS enabled for all origins (adjust if needed)
- ✅ Request size limited to 50MB
- ✅ `.gitignore` protects sensitive files

### Optional: Add API Authentication

Add to `server.js` before routes:

```javascript
const API_KEY = process.env.API_KEY || 'your-secret-key';

app.use('/api/*', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

Then in n8n, add header: `X-API-Key: your-secret-key`

## 📝 License

MIT

## 🤝 Contributing

Issues and pull requests welcome!

## ⭐ Support

If this helps you, give it a star on GitHub!

---

Built with ❤️ using Express.js and Google Gemini AI
