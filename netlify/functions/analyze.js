/**
 * Netlify Serverless Function — Image Analysis via Google Gemini
 * 
 * SECURITY:
 * - API key stored as env var, never exposed to client
 * - Input validation (size, type)
 * - No image persistence
 */

const https = require('https');

function geminiRequest(url, postData) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(25000, () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.write(postData);
    req.end();
  });
}

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { image } = body;

  if (!image || typeof image !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'No image data provided' }) };
  }

  // Validate base64 size (max ~5MB base64 ≈ 3.75MB image)
  if (image.length > 5 * 1024 * 1024) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Image too large' }) };
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    console.error('GEMINI_API_KEY not configured');
    return { statusCode: 500, body: JSON.stringify({ error: 'Service not configured. Please add your Gemini API key.' }) };
  }

  try {
    const prompt = `You are an expert visual identification AI. Analyze this image and identify what is shown.

Respond ONLY with valid JSON in this exact format (no markdown, no code fences):
{
  "name": "The specific name of the object/thing identified",
  "category": "A short category label (e.g., Plant, Animal, Food, Gadget, Landmark, Vehicle, Clothing, Art, etc.)",
  "description": "A clear 2-3 sentence description of what this is",
  "details": ["Detail 1 about it", "Detail 2", "Detail 3", "Detail 4", "Detail 5"],
  "funFact": "One interesting or surprising fact about this thing"
}

Be specific. For example, don't just say "dog" — say "Golden Retriever". Don't just say "flower" — say "Sunflower (Helianthus annuus)". Include useful details like origin, uses, characteristics, or notable features.`;

    const postData = JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: image,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
      },
    });

    const models = [
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b',
      'gemini-2.0-flash-lite'
    ];
    
    let lastError = 'Unable to analyze image. Please try again.';

    for (const model of models) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
      
      // Try up to 2 attempts per model for transient 503/429 errors
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
          // Brief pause before retry
          await new Promise(r => setTimeout(r, 1000));
        }

        const response = await geminiRequest(geminiUrl, postData);

        if (response.status === 200) {
          const data = JSON.parse(response.body);
          const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          
          if (!textResponse) {
            lastError = 'No description generated for this image. Please try another photo.';
            break; // Try next model
          }

          let result;
          try {
            const cleaned = textResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            result = JSON.parse(cleaned);
          } catch {
            result = {
              name: 'Identified Object',
              category: 'General',
              description: textResponse.substring(0, 500),
              details: [],
              funFact: '',
            };
          }

          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
            body: JSON.stringify(result),
          };
        }

        // Handle error responses
        try {
          const errData = JSON.parse(response.body);
          lastError = errData?.error?.message || `API Error (${response.status})`;
        } catch {
          lastError = response.body ? response.body.substring(0, 300) : `Error code ${response.status}`;
        }

        // If not a transient error (503/429/404), don't retry same model
        if (response.status !== 503 && response.status !== 429) {
          break;
        }
      }
    }

    return {
      statusCode: 502,
      body: JSON.stringify({
        error: `AI Service busy (${lastError}). Please tap "Try Again".`
      })
    };

  } catch (err) {
    console.error('Function error:', err.message, err.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error processing request: ' + err.message }),
    };
  }
};
