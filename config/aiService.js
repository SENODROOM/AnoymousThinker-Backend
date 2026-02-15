const fetch = require('node-fetch');

// ✅ Updated to new HuggingFace Router endpoint (old api-inference.huggingface.co is deprecated)
const HUGGINGFACE_ROUTER_URL = 'https://router.huggingface.co/hf-inference/models';

/**
 * Call Hugging Face Inference API (new router endpoint)
 * FREE tier: sign up at huggingface.co, get token from Settings → Access Tokens
 */
async function callHuggingFace(messages, systemPrompt = '', model = null) {
  const modelId = model || process.env.HUGGINGFACE_MODEL || 'mistralai/Mistral-7B-Instruct-v0.3';

  // Build messages array for chat completion format (new API uses OpenAI-compatible format)
  const chatMessages = [];

  if (systemPrompt) {
    chatMessages.push({ role: 'system', content: systemPrompt });
  }

  chatMessages.push(...messages.map(m => ({ role: m.role, content: m.content })));

  try {
    const response = await fetch(`${HUGGINGFACE_ROUTER_URL}/${modelId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: chatMessages,
        max_tokens: 800,
        temperature: 0.7,
        top_p: 0.9,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HuggingFace API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // New router returns OpenAI-compatible format
    if (data.choices && data.choices[0]?.message?.content) {
      return data.choices[0].message.content.trim();
    }

    // Fallback: check for error in response
    if (data.error) {
      if (data.error.includes('loading') || data.error.includes('currently loading')) {
        throw new Error('MODEL_LOADING');
      }
      throw new Error(data.error);
    }

    throw new Error('Unexpected response format from HuggingFace');

  } catch (error) {
    if (error.message === 'MODEL_LOADING') {
      throw new Error('The AI model is loading. Please wait 20 seconds and try again.');
    }
    throw error;
  }
}

/**
 * Alternative: Use free Groq API (much faster, also free)
 * Sign up at groq.com for free API key
 */
async function callGroq(messages, systemPrompt = '') {
  const groqMessages = [];

  if (systemPrompt) {
    groqMessages.push({ role: 'system', content: systemPrompt });
  }

  groqMessages.push(...messages.map(m => ({
    role: m.role,
    content: m.content
  })));

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant', // Free model on Groq
      messages: groqMessages,
      max_tokens: 800,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

module.exports = { callHuggingFace, callGroq };