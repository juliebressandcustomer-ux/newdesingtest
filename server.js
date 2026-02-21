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

    // Initialize Gemini AI
    const ai = new GoogleGenAI({ 
      apiKey: process.env.GEMINI_API_KEY 
    });

    const model = 'gemini-2.5-flash-image';

    // FULL COVERAGE prompt — design must wrap entire mug surface
    const prompt = `You are a professional product mockup specialist. Your ONLY task is to wrap the provided design image fully around the mug in the photo.

PLACEMENT RULES — CRITICAL:
1. The design must cover the ENTIRE visible surface of the mug from left edge to right edge
2. The design must fill the mug vertically from just below the rim all the way down to just above the base
3. Scale the design UP to completely fill the mug surface — do NOT leave any blank white/colored mug surface visible
4. The design should wrap around the mug following its natural cylindrical curvature
5. Think of it as a full-wrap sublimation print — the design covers 100% of the mug body

WRAPPING & PERSPECTIVE RULES:
- Apply realistic cylindrical perspective distortion so the design follows the mug's curve
- The center portion of the design faces the camera and is most visible
- The left and right edges of the design curve away naturally with the mug shape
- Apply the original photo's lighting, highlights and shadows on top of the design
- The design must look like it was sublimation-printed directly into the ceramic — not a sticker

TRANSPARENCY RULES:
- Transparent/empty areas in the design = mug ceramic surface shows through naturally
- Do NOT add any background color, rectangle, or shape behind the design elements
- Only the actual design artwork (text, illustrations, colors) appears on the mug surface
- White mug stays white wherever the design is transparent

FORBIDDEN — NEVER DO THESE:
❌ Leaving large blank uncovered areas on the mug body
❌ Placing the design only in the center as a small patch or sticker
❌ Shrinking the design so it only covers part of the mug
❌ Adding any background rectangle, square, or shape behind the design
❌ Making the design look like a label with borders or white edges
❌ Changing the mug shape, handle, color or background of the original photo

REQUIRED — ALWAYS DO THESE:
✅ Design fills the FULL visible mug surface from edge to edge, top to bottom
✅ Realistic full-wrap sublimation print appearance
✅ Natural cylindrical perspective and curvature applied to the design
✅ Original photo lighting and shadows preserved and applied over the design
✅ Professional Etsy product photo quality result
✅ The mug handle, background and overall scene remain unchanged`;

    console.log('Calling Gemini API...');

    // Call Gemini API — prompt FIRST for better instruction following
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log('🎨 Mug Mockup API Server v3.0');
  console.log('='.repeat(50));
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log(`📡 API: http://localhost:${PORT}/api/generate-mockup`);
  console.log(`📁 Uploads: ${uploadsDir}`);
  console.log(`🔑 Gemini API Key: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`🎯 Full-Wrap Coverage: ENABLED`);
  console.log(`📐 Prompt Order: TEXT FIRST (better instruction following)`);
  console.log('='.repeat(50));
});
