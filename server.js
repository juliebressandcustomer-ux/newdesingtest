import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
    const { mockupUrl, designUrl } = req.body;

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
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const prompt = `You are a world-class graphic designer specializing in product mockups. 
I am providing two images:
1. A base "Mug Mockup" image (blank mug photo).
2. A "Design" image (artwork/logo to apply).

Your task:
- Intelligently identify the visible surface of the mug in the base mockup.
- Map the "Design" image onto that surface.
- Ensure the design follows the physical curvature of the mug perfectly.
- Match the lighting, shadows, and reflections of the original scene so the design looks naturally printed on the mug, not just floating on top.
- The output should be a single final composite image of the mug with the design applied.
- Retain the original background and surrounding elements of the mockup.

Generate a realistic product mockup image.`;

    console.log('Calling Gemini API...');

    // Call Gemini API
    const result = await model.generateContent([
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
      prompt
    ]);

    const response = await result.response;

    // Extract result
    if (!response.candidates || response.candidates.length === 0) {
      throw new Error("No response from AI model");
    }

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const resultImage = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        
        console.log('Mockup generated successfully!');
        
        return res.json({
          success: true,
          image: resultImage,
          mimeType: part.inlineData.mimeType,
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

// Start server
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🎨 Mug Mockup API Server');
  console.log('='.repeat(50));
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log(`📡 API: http://localhost:${PORT}/api/generate-mockup`);
  console.log(`🔑 Gemini API Key: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log('='.repeat(50));
});
