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

// Root endpoint - for Railway default health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'Mug Mockup API',
    version: '3.1',
    endpoints: {
      health: '/health',
      api: '/api/generate-mockup',
      download: '/download/:filename'
    },
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Mug Mockup API is running',
    geminiApiKey: process.env.GEMINI_API_KEY ? 'configured' : 'missing',
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

    // Initialize Gemini AI
    const ai = new GoogleGenAI({ 
      apiKey: process.env.GEMINI_API_KEY 
    });

    // Updated to newer model for better results
    const model = 'gemini-2.0-flash-exp';

    // IMPROVED SIMPLIFIED PROMPT - More focused, less overwhelming
    const prompt = `You are a professional product mockup specialist. Apply the design image to the mug as a realistic full-wrap sublimation print.

CRITICAL REQUIREMENTS:

1. COVERAGE: The design must completely wrap around the visible mug surface from edge to edge, top to bottom. No blank mug surface should be visible.

2. PERSPECTIVE: Apply realistic cylindrical distortion so the design naturally follows the mug's curved shape. The center portion faces forward, edges curve away.

3. REALISM: The design must look like it was printed directly into the ceramic using sublimation printing - NOT like a sticker or label pasted on.

4. LIGHTING: Preserve all original shadows, highlights, and lighting from the mug photo. Apply these effects OVER the design.

5. TRANSPARENCY: If the design has transparent areas, the white mug surface shows through naturally. Do not add any background rectangles or shapes.

6. PRESERVE: Keep the mug handle, background, and scene completely unchanged. Only modify the mug's printable surface.

Result should look like a professional Etsy product photo with a full 360° wrap design.`;

    console.log('Calling Gemini API with model:', model);

    // Call Gemini API
    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          { text: prompt },
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
        const filename = `mockup_${timestamp}_${randomId}.jpg`;
        const filepath = path.join(uploadsDir, filename);

        // Convert base64 to buffer
        const originalBuffer = Buffer.from(part.inlineData.data, 'base64');

        console.log('Original size:', (originalBuffer.length / 1024).toFixed(2), 'KB');

        // Compress image with Sharp (optimized for Etsy)
        const compressedBuffer = await sharp(originalBuffer)
          .jpeg({ 
            quality: quality,
            progressive: true,
            mozjpeg: true
          })
          .resize(2000, 2000, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .toBuffer();

        console.log('Compressed size:', (compressedBuffer.length / 1024).toFixed(2), 'KB');
        console.log('Compression ratio:', ((1 - compressedBuffer.length / originalBuffer.length) * 100).toFixed(1), '%');

        // Save compressed image
        fs.writeFileSync(filepath, compressedBuffer);

        console.log('Mockup generated and saved:', filename);

        // Get base URL
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
          model: model,
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

// Download endpoint
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

// Cleanup old files (runs every hour, deletes files older than 24h)
const cleanupOldFiles = () => {
  try {
    const files = fs.readdirSync(uploadsDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    files.forEach(file => {
      const filepath = path.join(uploadsDir, file);
      const stats = fs.statSync(filepath);
      const age = now - stats.mtimeMs;

      if (age > maxAge) {
        fs.unlinkSync(filepath);
        deletedCount++;
      }
    });

    if (deletedCount > 0) {
      console.log(`Cleanup: Deleted ${deletedCount} old file(s)`);
    }
  } catch (error) {
    console.error('Cleanup error:', error.message);
  }
};

setInterval(cleanupOldFiles, 60 * 60 * 1000);

// Start server - CRITICAL: Bind to 0.0.0.0 for Railway
app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log('🎨 Mug Mockup API Server v3.1');
  console.log('='.repeat(50));
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Host: 0.0.0.0 (Railway compatible)`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log(`📍 Root: http://localhost:${PORT}/`);
  console.log(`📡 API: http://localhost:${PORT}/api/generate-mockup`);
  console.log(`📁 Uploads: ${uploadsDir}`);
  console.log(`🔑 Gemini API Key: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`🤖 AI Model: gemini-2.0-flash-exp`);
  console.log(`🎯 Improved prompt for better quality`);
  console.log('='.repeat(50));
});
