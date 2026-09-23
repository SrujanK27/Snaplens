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
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

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

    const response = await geminiRequest(geminiUrl, postData);

    if (response.status !== 200) {
      console.error('Gemini API error:', response.status, response.body);
      
      // Parse actual error from Gemini for debugging
      let geminiError = 'Unknown error';
      try {
        const errData = JSON.parse(response.body);
        geminiError = errData?.error?.message || response.body.substring(0, 300);
      } catch {
        geminiError = response.body.substring(0, 300);
      }
      
      return { statusCode: 502, body: JSON.stringify({ error: `Gemini API (${response.status}): ${geminiError}` }) };
    }

    const data = JSON.parse(response.body);

    // Extract the text response
    const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResponse) {
      console.error('No text in Gemini response:', JSON.stringify(data));
      return { statusCode: 502, body: JSON.stringify({ error: 'No response from AI. Please try a clearer image.' }) };
    }

    // Parse the JSON response from Gemini
    let result;
    try {
      // Clean up potential markdown code fences
      const cleaned = textResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse Gemini response:', textResponse);
      // Fallback: return raw text as description
      result = {
        name: 'Identified Object',
        category: 'Unknown',
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

  } catch (err) {
    console.error('Function error:', err.message, err.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error: ' + err.message }),
    };
  }
};
