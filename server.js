import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import sharp from 'sharp';

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

// Generate mockup with optional JPEG compression
app.post('/api/generate-mockup', async (req, res) => {
  try {
    const { 
      mockupUrl, 
      designUrl,
      referenceUrl,           // NEW: Optional reference image for sizing
      outputFormat = 'jpeg',  // 'jpeg' or 'png'
      quality = 85,           // 1-100
      maxWidth = 2000,        // pixels
      designSize = 'medium'   // NEW: 'small', 'medium', 'large'
    } = req.body;

    // Validate inputs
    if (!mockupUrl || !designUrl) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields: mockupUrl and designUrl' 
      });
    }

    console.log('🎨 Processing mockup request...');
    console.log('📸 Mockup URL:', mockupUrl);
    console.log('🎨 Design URL:', designUrl);
    console.log('📏 Design Size:', designSize);
    if (referenceUrl) console.log('🔗 Reference URL:', referenceUrl);
    console.log('⚙️ Output format:', outputFormat);
    console.log('⚙️ Quality:', quality);

    // Fetch images from URLs
    const mockupResponse = await fetch(mockupUrl);
    if (!mockupResponse.ok) {
      throw new Error(`Failed to fetch mockup: ${mockupResponse.statusText}`);
    }
    const mockupBuffer = await mockupResponse.arrayBuffer();
    const mockupBase64 = Buffer.from(mockupBuffer).toString('base64');
    const mockupMimeType = mockupResponse.headers.get('content-type') || 'image/png';

    const designResponse = await fetch(designUrl);
    if (!designResponse.ok) {
      throw new Error(`Failed to fetch design: ${designResponse.statusText}`);
    }
    const designBuffer = await designResponse.arrayBuffer();
    const designBase64 = Buffer.from(designBuffer).toString('base64');
    const designMimeType = designResponse.headers.get('content-type') || 'image/png';

    // Fetch reference image if provided
    let referenceBase64 = null;
    let referenceMimeType = null;
    if (referenceUrl) {
      const referenceResponse = await fetch(referenceUrl);
      if (referenceResponse.ok) {
        const referenceBuffer = await referenceResponse.arrayBuffer();
        referenceBase64 = Buffer.from(referenceBuffer).toString('base64');
        referenceMimeType = referenceResponse.headers.get('content-type') || 'image/png';
        console.log('✅ Reference image loaded');
      }
    }

    // Initialize Gemini AI
    const ai = new GoogleGenAI({ 
      apiKey: process.env.GEMINI_API_KEY 
    });

    const model = 'gemini-2.5-flash-image';

    // Design size specifications
    const sizeSpecs = {
      small: {
        coverage: '35-40%',
        description: 'Small, subtle design (like a small logo or icon)',
        dimensions: '2 inches wide on a standard 11oz mug'
      },
      medium: {
        coverage: '50-60%',
        description: 'Medium-sized design (standard product mockup)',
        dimensions: '3-3.5 inches wide on a standard 11oz mug'
      },
      large: {
        coverage: '65-75%',
        description: 'Large, prominent design (wrap-around effect)',
        dimensions: '4-4.5 inches wide on a standard 11oz mug'
      }
    };

    const selectedSize = sizeSpecs[designSize] || sizeSpecs.medium;

    // Build the prompt with reference handling
    let prompt = `You are a world-class graphic designer specializing in product mockups. 

I am providing ${referenceBase64 ? 'three' : 'two'} images:
${referenceBase64 ? '1. A REFERENCE mockup showing EXACTLY the size and positioning I want you to replicate\n2. A base "Mug Mockup" image (blank mug photo)\n3. A "Design" image (artwork/logo to apply)' : '1. A base "Mug Mockup" image (blank mug photo)\n2. A "Design" image (artwork/logo to apply)'}

CRITICAL SIZING REQUIREMENTS:
${referenceBase64 
  ? '- Study the REFERENCE image carefully and replicate the EXACT size and position of the design\n- The design in the reference shows the perfect scale - match it precisely\n- Maintain the same relative proportions as shown in the reference'
  : `- The design MUST cover approximately ${selectedSize.coverage} of the visible mug width\n- Design specifications: ${selectedSize.description}\n- Physical size reference: ${selectedSize.dimensions}\n- The design size MUST remain consistent regardless of mug angle or perspective`
}

POSITIONING REQUIREMENTS:
- Center the design both horizontally and vertically on the visible mug surface
- Position the design at the same height as shown in ${referenceBase64 ? 'the reference image' : 'standard product photography'}
- Maintain consistent positioning even if the mug is viewed from different angles

QUALITY REQUIREMENTS:
- Intelligently identify the visible surface of the mug in the base mockup
- Map the design onto that surface following the physical curvature perfectly
- Apply perspective distortion to match the mug's cylindrical shape
- Match the lighting, shadows, and reflections of the original scene
- The design should look naturally printed on the mug, not pasted on
- Retain the original background and surrounding elements of the mockup
- Ensure crisp, clear design details

${referenceBase64 ? 'REMEMBER: The reference image is your sizing guide. Match it exactly!' : `REMEMBER: Consistency is KEY. Every mockup with "${designSize}" size should have the design at ${selectedSize.coverage} of mug width.`}

Generate a realistic, professionally-sized product mockup image.`;

    console.log('⚡ Calling Gemini API...');

    // Build parts array for API call
    const parts = [];
    
    // Add reference first if provided (so AI sees it first)
    if (referenceBase64) {
      parts.push({
        inlineData: {
          data: referenceBase64,
          mimeType: referenceMimeType,
        },
      });
    }
    
    // Add mockup and design
    parts.push(
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
      { text: prompt }
    );

    // Call Gemini API
    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: parts,
      },
    });

    // Extract result
    if (!response.candidates || response.candidates.length === 0) {
      throw new Error("No response from AI model");
    }

    let geminiImageBase64 = null;
    let geminiMimeType = 'image/png';

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        geminiImageBase64 = part.inlineData.data;
        geminiMimeType = part.inlineData.mimeType;
        break;
      }
    }

    if (!geminiImageBase64) {
      throw new Error("No image in response");
    }

    const originalBuffer = Buffer.from(geminiImageBase64, 'base64');
    const originalSizeMB = (originalBuffer.length / 1024 / 1024).toFixed(2);
    
    console.log('✅ Mockup generated by Gemini');
    console.log('📦 Original size:', originalSizeMB, 'MB');

    // 🗜️ CONVERT TO JPEG & COMPRESS
    console.log('🗜️ Converting to JPEG and compressing...');

    let processedBuffer;
    let finalMimeType;

    if (outputFormat === 'jpeg' || outputFormat === 'jpg') {
      // Convert to JPEG with quality control
      processedBuffer = await sharp(originalBuffer)
        .resize(maxWidth, maxWidth, { 
          fit: 'inside',
          withoutEnlargement: true 
        })
        .jpeg({ 
          quality: quality,
          mozjpeg: true  // Better compression
        })
        .toBuffer();
      
      finalMimeType = 'image/jpeg';
    } else {
      // Keep as PNG but optimize
      processedBuffer = await sharp(originalBuffer)
        .resize(maxWidth, maxWidth, { 
          fit: 'inside',
          withoutEnlargement: true 
        })
        .png({ 
          quality: quality,
          compressionLevel: 9
        })
        .toBuffer();
      
      finalMimeType = 'image/png';
    }

    const processedSizeKB = (processedBuffer.length / 1024).toFixed(2);
    const reduction = ((1 - processedBuffer.length / originalBuffer.length) * 100).toFixed(0);

    console.log('✅ Processed size:', processedSizeKB, 'KB');
    console.log('💰 Reduction:', reduction, '%');
    console.log('📄 Format:', finalMimeType);

    // Return processed image
    const processedBase64 = processedBuffer.toString('base64');
    
    return res.json({
      success: true,
      image: `data:${finalMimeType};base64,${processedBase64}`,
      mimeType: finalMimeType,
      originalSizeMB: originalSizeMB,
      processedSizeKB: processedSizeKB,
      reduction: `${reduction}%`,
      format: outputFormat,
      quality: quality,
      designSize: designSize,
      sizeSpec: selectedSize,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
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
  console.log('🎨 Mug Mockup API (with Consistent Sizing)');
  console.log('='.repeat(50));
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`📍 API: http://localhost:${PORT}/api/generate-mockup`);
  console.log(`🔑 Gemini API Key: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log('='.repeat(50));
  console.log('\n📏 Available design sizes:');
  console.log('   • small: 35-40% coverage (subtle)');
  console.log('   • medium: 50-60% coverage (standard) ⭐');
  console.log('   • large: 65-75% coverage (prominent)');
  console.log('='.repeat(50));
});
