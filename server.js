import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import sharp from 'sharp';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from uploads directory
app.use('/uploads', express.static(uploadsDir));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Mug Mockup API is running',
    timestamp: new Date().toISOString()
  });
});

// Generate mockup from image URLs
app.post('/api/generate-mockup', async (req, res) => {
  try {
    const { mockupUrl, designUrl, quality = 75 } = req.body;

    // Validate inputs
    if (!mockupUrl || !designUrl) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields: mockupUrl and designUrl' 
      });
    }

    console.log('Processing mockup request...');
    console.log('Mockup URL:', mockupUrl);
    console.log('Design URL:', designUrl);
    console.log('Quality:', quality);

    // Fetch images from URLs
    const mockupResponse = await fetch(mockupUrl);
    if (!mockupResponse.ok) {
      throw new Error(`Failed to fetch mockup image: ${mockupResponse.statusText}`);
    }
    const mockupBuffer = await mockupResponse.arrayBuffer();
    const mockupBase64 = Buffer.from(mockupBuffer).toString('base64');
    const mockupMimeType = mockupResponse.headers.get('content-type') || 'image/png';

    const designResponse = await fetch(designUrl);
    if (!designResponse.ok) {
      throw new Error(`Failed to fetch design image: ${designResponse.statusText}`);
    }
    const designBuffer = await designResponse.arrayBuffer();
    const designBase64 = Buffer.from(designBuffer).toString('base64');
    const designMimeType = designResponse.headers.get('content-type') || 'image/png';

    // Initialize Gemini AI (using AI Studio SDK)
    const ai = new GoogleGenAI({ 
      apiKey: process.env.GEMINI_API_KEY 
    });

    // Use the same model as AI Studio
    const model = 'gemini-2.5-flash-image';

    // Improved prompt to avoid black backgrounds and handle transparent designs
    const prompt = `You are a world-class graphic designer specializing in product mockups. 
I am providing two images:
1. A base "Mug Mockup" image (blank mug photo).
2. A "Design" image (artwork/logo to apply).

CRITICAL INSTRUCTIONS:
- Intelligently identify the visible surface of the mug in the base mockup.
- Map the "Design" image onto that surface with perfect alignment.
- Ensure the design follows the physical curvature of the mug perfectly.
- Match the lighting, shadows, and reflections of the original scene so the design looks naturally printed on the mug.
- PRESERVE THE ORIGINAL MUG COLOR: The mug surface should maintain its original color (white, black, colored, etc.).
- If the design has a transparent background, apply ONLY the visible design elements without any background color.
- If the design contains black text or dark elements, do NOT add a black background behind them.
- The design should appear as if it was directly printed on the mug surface, not as a sticker with a background.
- Retain the original background and surrounding elements of the mockup scene.
- The final result should look like a professional product photo with the design seamlessly integrated.

Generate a realistic, natural-looking product mockup image.`;

    console.log('Calling Gemini API...');

    // Call Gemini API (using AI Studio SDK format)
    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          {
            inlineData: {
              data: mockupBase64,
              mimeType: mockupMimeType,
            },
          },
          {
            inlineData: {
              data: designBase64,
              mimeType: designMimeType,
            },
          },
          { text: prompt },
        ],
      },
    });

    // Extract result
    if (!response.candidates || response.candidates.length === 0) {
      throw new Error("No response from AI model");
    }

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        // Generate unique filename
        const timestamp = Date.now();
        const randomId = crypto.randomBytes(8).toString('hex');
        const filename = `mockup_${timestamp}_${randomId}.jpg`; // Use JPG for better compression
        const filepath = path.join(uploadsDir, filename);

        // Convert base64 to buffer
        const originalBuffer = Buffer.from(part.inlineData.data, 'base64');

        console.log('Original size:', (originalBuffer.length / 1024).toFixed(2), 'KB');

        // Compress image with Sharp (optimized for Etsy)
        const compressedBuffer = await sharp(originalBuffer)
          .jpeg({ 
            quality: quality, // Default 75, good for Etsy
            progressive: true, // Progressive loading
            mozjpeg: true // Use mozjpeg for better compression
          })
          .resize(2000, 2000, { // Max 2000px for Etsy
            fit: 'inside',
            withoutEnlargement: true
          })
          .toBuffer();

        console.log('Compressed size:', (compressedBuffer.length / 1024).toFixed(2), 'KB');
        console.log('Compression ratio:', ((1 - compressedBuffer.length / originalBuffer.length) * 100).toFixed(1), '%');

        // Save compressed image
        fs.writeFileSync(filepath, compressedBuffer);

        console.log('Mockup generated and saved:', filename);

        // Get base URL (Railway provides this in headers or env)
        const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
          ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
          : process.env.BASE_URL 
          ? process.env.BASE_URL
          : `http://localhost:${PORT}`;

        const downloadUrl = `${baseUrl}/uploads/${filename}`;
        
        return res.json({
          success: true,
          url: downloadUrl,
          filename: filename,
          mimeType: 'image/jpeg',
          originalSize: originalBuffer.length,
          compressedSize: compressedBuffer.length,
          compressionRatio: `${((1 - compressedBuffer.length / originalBuffer.length) * 100).toFixed(1)}%`,
          timestamp: new Date().toISOString()
        });
      }
    }

    throw new Error("No image in response");

  } catch (error) {
    console.error('Error generating mockup:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to generate mockup',
      message: error.message 
    });
  }
});

// Download endpoint (alternative direct download)
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(uploadsDir, filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ 
      success: false,
      error: 'File not found' 
    });
  }

  res.download(filepath);
});

// Cleanup old files (runs every hour)
const cleanupOldFiles = () => {
  try {
    const files = fs.readdirSync(uploadsDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    let deletedCount = 0;

    files.forEach(file => {
      const filepath = path.join(uploadsDir, file);
      const stats = fs.statSync(filepath);
      const age = now - stats.mtimeMs;

      if (age > maxAge) {
        fs.unlinkSync(filepath);
        deletedCount++;
        console.log('Deleted old file:', file);
      }
    });

    if (deletedCount > 0) {
      console.log(`Cleanup: Deleted ${deletedCount} old file(s)`);
    }
  } catch (error) {
    console.error('Cleanup error:', error.message);
  }
};

// Run cleanup every hour
setInterval(cleanupOldFiles, 60 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🎨 Mug Mockup API Server (Optimized for Etsy)');
  console.log('='.repeat(50));
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log(`📡 API: http://localhost:${PORT}/api/generate-mockup`);
  console.log(`📁 Uploads: ${uploadsDir}`);
  console.log(`🔑 Gemini API Key: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`📦 Compression: JPEG quality 75%, max 2000px`);
  console.log('='.repeat(50));
});
