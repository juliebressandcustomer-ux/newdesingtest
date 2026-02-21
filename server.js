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
    
    // Remove white background from design (convert white to transparent)
    console.log('Removing white background from design...');
    const processedDesign = await sharp(Buffer.from(designBuffer))
      .ensureAlpha() // Add alpha channel if not present
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    const { data, info } = processedDesign;
    const pixels = new Uint8ClampedArray(data);
    
    // Convert white/near-white pixels to transparent
    const threshold = 240; // Adjust this value (0-255) - higher = more aggressive removal
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      
      // If pixel is white or near-white, make it transparent
      if (r > threshold && g > threshold && b > threshold) {
        pixels[i + 3] = 0; // Set alpha to 0 (transparent)
      }
    }
    
    // Convert back to PNG with transparency
    const transparentDesignBuffer = await sharp(pixels, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4
      }
    })
    .png()
    .toBuffer();
    
    const designBase64 = transparentDesignBuffer.toString('base64');
    const designMimeType = 

    // Initialize Gemini AI
    const ai = new GoogleGenAI({ 
      apiKey: process.env.GEMINI_API_KEY 
    });

    // Use the latest available Gemini Flash model
    const model = 'gemini-1.5-flash-latest';

    // OPTIMIZED PROMPT - Handles white background designs correctly
    const prompt = `You are a professional product mockup specialist. Apply the design elements from the second image onto the white mug in the first image.

CRITICAL INSTRUCTIONS:

1. EXTRACT ONLY THE DESIGN ELEMENTS: The second image shows the design on a white background. Only apply the actual design elements (text, graphics, colors, patterns) to the mug. The white background in the design image should be ignored - it represents the mug's natural white ceramic surface.

2. FULL WRAP COVERAGE: Scale and wrap the design elements to completely cover the visible mug surface from left edge to right edge, top to bottom. The design should fill the entire cylindrical surface.

3. NATURAL PERSPECTIVE: Apply realistic cylindrical distortion so design elements curve naturally with the mug shape. Center elements face forward, edges curve away following the mug's form.

4. SUBLIMATION PRINT QUALITY: The design must look printed directly into the ceramic, not like a sticker. Apply the original photo's lighting, shadows, and highlights over the design.

5. PRESERVE ORIGINAL: Keep the mug handle, background, table, and entire scene unchanged. Only modify the mug's outer surface with the design.

6. WHITE AREAS: Any white or light areas in the design blend seamlessly with the white mug ceramic - they are not separate backgrounds or rectangles.

Think: "What would this mug look like if these design elements were sublimation-printed covering its entire surface?"`;

    console.log('Calling Gemini API with model:', model);

    // Call Gemini API with timeout
    const apiCallPromise = ai.models.generateContent({
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

    // Set a timeout of 60 seconds
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('API call timed out after 60 seconds')), 60000);
    });

    const response = await Promise.race([apiCallPromise, timeoutPromise]);

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

        // Free up memory
        if (global.gc) {
          global.gc();
          console.log('Memory cleanup performed');
        }

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

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process - just log the error
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process - just log the error
});

// Handle SIGTERM gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

// Handle SIGINT gracefully (Ctrl+C)
process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

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
  console.log(`🤖 AI Model: gemini-1.5-flash-latest`);
  console.log(`🎯 Improved prompt for better quality`);
  console.log('='.repeat(50));
});
