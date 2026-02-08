import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
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

// Helper function to ensure image is in PNG format for Gemini
async function ensurePNG(buffer, originalMimeType) {
  try {
    // If already PNG, return as-is
    if (originalMimeType === 'image/png') {
      return { buffer, mimeType: 'image/png' };
    }
    
    console.log(`   Converting ${originalMimeType} to PNG...`);
    
    // Convert to PNG
    const pngBuffer = await sharp(buffer)
      .png()
      .toBuffer();
    
    return { buffer: pngBuffer, mimeType: 'image/png' };
  } catch (error) {
    console.error('Error converting image:', error);
    throw new Error(`Failed to convert image to PNG: ${error.message}`);
  }
}

// Generate mockup with optional JPEG compression
app.post('/api/generate-mockup', async (req, res) => {
  try {
    const { 
      mockupUrl, 
      designUrl,
      referenceUrl,           // Optional reference image for sizing
      outputFormat = 'jpeg',  // 'jpeg' or 'png'
      quality = 85,           // 1-100
      maxWidth = 2000,        // pixels
      designSize = 'medium'   // 'small', 'medium', 'large'
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

    // Fetch mockup image
    console.log('📥 Fetching mockup image...');
    const mockupResponse = await fetch(mockupUrl);
    if (!mockupResponse.ok) {
      throw new Error(`Failed to fetch mockup: ${mockupResponse.statusText}`);
    }
    let mockupBuffer = Buffer.from(await mockupResponse.arrayBuffer());
    const mockupOriginalMimeType = mockupResponse.headers.get('content-type') || 'image/png';
    console.log('   Original format:', mockupOriginalMimeType);
    
    // Convert mockup to PNG for Gemini
    const mockupConverted = await ensurePNG(mockupBuffer, mockupOriginalMimeType);
    const mockupBase64 = mockupConverted.buffer.toString('base64');
    const mockupMimeType = mockupConverted.mimeType;
    console.log('   Using format:', mockupMimeType);

    // Fetch design image
    console.log('📥 Fetching design image...');
    const designResponse = await fetch(designUrl);
    if (!designResponse.ok) {
      throw new Error(`Failed to fetch design: ${designResponse.statusText}`);
    }
    let designBuffer = Buffer.from(await designResponse.arrayBuffer());
    const designOriginalMimeType = designResponse.headers.get('content-type') || 'image/png';
    console.log('   Original format:', designOriginalMimeType);
    
    // Convert design to PNG for Gemini
    const designConverted = await ensurePNG(designBuffer, designOriginalMimeType);
    const designBase64 = designConverted.buffer.toString('base64');
    const designMimeType = designConverted.mimeType;
    console.log('   Using format:', designMimeType);

    // Fetch reference image if provided
    let referenceBase64 = null;
    let referenceMimeType = null;
    if (referenceUrl) {
      console.log('📥 Fetching reference image...');
      const referenceResponse = await fetch(referenceUrl);
      if (referenceResponse.ok) {
        let referenceBuffer = Buffer.from(await referenceResponse.arrayBuffer());
        const referenceOriginalMimeType = referenceResponse.headers.get('content-type') || 'image/png';
        console.log('   Original format:', referenceOriginalMimeType);
        
        // Convert reference to PNG
        const referenceConverted = await ensurePNG(referenceBuffer, referenceOriginalMimeType);
        referenceBase64 = referenceConverted.buffer.toString('base64');
        referenceMimeType = referenceConverted.mimeType;
        console.log('✅ Reference image loaded and converted');
      }
    }

    // Initialize Gemini AI
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

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

    // Build the prompt with reference handling and transparency fix
    let prompt = `You are a world-class graphic designer specializing in product mockups. 

I am providing ${referenceBase64 ? 'three' : 'two'} images:
${referenceBase64 ? '1. A REFERENCE mockup showing EXACTLY the size and positioning I want you to replicate\n2. A base "Mug Mockup" image (blank mug photo)\n3. A "Design" image (artwork/logo to apply)' : '1. A base "Mug Mockup" image (blank mug photo)\n2. A "Design" image (artwork/logo to apply)'}

🚨 CRITICAL BACKGROUND/TRANSPARENCY RULES:
- The mug surface MUST remain WHITE (or its original color) wherever there is NO design
- If the design has a black background, DO NOT apply black to the mug - treat black backgrounds as transparent
- ONLY apply the actual design elements (text, graphics, illustrations) to the mug
- Ignore any background color in the design image - backgrounds should be treated as transparent
- The white mug should stay completely white except where the design artwork appears
- Think of the design as a sticker or decal - only the printed elements go on the mug, not the background

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
- Map ONLY the design elements (not backgrounds) onto that surface
- Follow the physical curvature of the mug perfectly
- Apply perspective distortion to match the mug's cylindrical shape
- Match the lighting, shadows, and reflections of the original scene
- The design should look naturally printed on the mug, not pasted on
- Retain the original background and surrounding elements of the mockup
- Ensure crisp, clear design details
- Keep the mug's original white color intact outside the design area

EXAMPLES OF CORRECT HANDLING:
✅ Design with black background → Apply only the colored/white elements, ignore black background
✅ Design with white text on black → Apply only the white text as white print on the mug
✅ Colorful logo on black background → Apply only the logo, keep mug white around it
✅ Text design → Apply text cleanly without any background rectangles or patches

${referenceBase64 ? 'REMEMBER: The reference image is your sizing guide. Match it exactly!' : `REMEMBER: Consistency is KEY. Every mockup with "${designSize}" size should have the design at ${selectedSize.coverage} of mug width.`}

Generate a realistic, professionally-sized product mockup with proper transparency handling.`;

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
    const result = await model.generateContent(parts);
    const response = await result.response;

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
    console.log('🗜️ Converting to output format and compressing...');

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
    console.error('❌ Stack:', error.stack);
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
  console.log('🎨 Mug Mockup API (PNG Compatible)');
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
  console.log('\n🎨 Input format: PNG (auto-converted if needed)');
  console.log('🎨 Transparency handling:');
  console.log('   • Black backgrounds treated as transparent');
  console.log('   • Only design elements applied to mug');
  console.log('   • White mug stays white outside design');
  console.log('='.repeat(50));
});
