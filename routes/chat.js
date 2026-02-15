const express = require('express');
const Conversation = require('../models/Conversation');
const { SystemPrompt } = require('../models/Training');
const auth = require('../middleware/auth');
const { callHuggingFace, callGroq } = require('../config/aiService');

const router = express.Router();

// GET /api/chat/conversations - get all user conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      userId: req.user._id,
      isArchived: false
    })
      .select('title createdAt updatedAt messages model')
      .sort({ updatedAt: -1 });

    const conversationsWithPreview = conversations.map(conv => ({
      _id: conv._id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messageCount: conv.messages.length,
      lastMessage: conv.messages.length > 0
        ? conv.messages[conv.messages.length - 1].content.substring(0, 100)
        : '',
      model: conv.model
    }));

    res.json(conversationsWithPreview);
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// POST /api/chat/conversations - create new conversation
router.post('/conversations', auth, async (req, res) => {
  try {
    const { title } = req.body;
    const conversation = new Conversation({
      userId: req.user._id,
      title: title || 'New Chat',
      messages: []
    });
    await conversation.save();
    res.status(201).json(conversation);
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// GET /api/chat/conversations/:id - get specific conversation
router.get('/conversations/:id', auth, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user._id
    });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(conversation);
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// PUT /api/chat/conversations/:id - update conversation title
router.put('/conversations/:id', auth, async (req, res) => {
  try {
    const { title } = req.body;
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { title },
      { new: true }
    );
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update conversation' });
  }
});

// DELETE /api/chat/conversations/:id
router.delete('/conversations/:id', auth, async (req, res) => {
  try {
    const conversation = await Conversation.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// POST /api/chat/conversations/:id/message - send message and get AI response
router.post('/conversations/:id/message', auth, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Add user message
    const userMessage = {
      role: 'user',
      content: content.trim(),
      timestamp: new Date()
    };
    conversation.messages.push(userMessage);

    // Auto-generate title from first message
    if (conversation.messages.length === 1) {
      conversation.generateTitle();
    }

    // Get active system prompt for this user
    const activePrompt = await SystemPrompt.findOne({
      userId: req.user._id,
      isActive: true
    });

    const systemPromptText = activePrompt?.prompt ||
      `You are AnonymousThinker, a helpful, thoughtful, and intelligent AI assistant. 
       You provide clear, accurate, and engaging responses. You think deeply about questions 
       and provide nuanced answers. Be concise but thorough. If you don't know something, 
       say so honestly.`;

    // Prepare messages for AI (last 20 messages for context)
    const recentMessages = conversation.messages
      .slice(-20)
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content }));

    // ✅ AUTO-DETECT which API to use — Groq takes priority if key exists
    const hasGroq = !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim());
    const hasHuggingFace = !!(process.env.HUGGINGFACE_API_KEY && process.env.HUGGINGFACE_API_KEY.trim());

    console.log(`\n🤖 AI Selection:`);
    console.log(`   Groq key set:         ${hasGroq ? '✅ YES' : '❌ NO'}`);
    console.log(`   HuggingFace key set:  ${hasHuggingFace ? '✅ YES' : '❌ NO'}`);
    console.log(`   Using:                ${hasGroq ? '🚀 GROQ' : hasHuggingFace ? '🤗 HuggingFace' : '❌ NONE'}\n`);

    let aiResponse;

    try {
      if (hasGroq) {
        // Groq: fast, free, reliable
        aiResponse = await callGroq(recentMessages, systemPromptText);

      } else if (hasHuggingFace) {
        // HuggingFace: free but slower
        aiResponse = await callHuggingFace(recentMessages, systemPromptText);

      } else {
        // No API key at all
        aiResponse = `⚠️ **No AI API key found.**\n\nPlease add one of these to your \`backend/.env\` file and restart the server:\n\n**Option 1 — Groq (Recommended, Free, Fast):**\n\`\`\`\nGROQ_API_KEY=gsk_your_key_here\n\`\`\`\nGet your free key at: https://console.groq.com\n\n**Option 2 — HuggingFace (Free):**\n\`\`\`\nHUGGINGFACE_API_KEY=hf_your_key_here\n\`\`\`\nGet your free key at: https://huggingface.co/settings/tokens`;
      }

    } catch (aiError) {
      console.error('❌ AI call failed:', aiError.message);

      // Give a helpful error based on which service failed
      if (hasGroq) {
        aiResponse = `⚠️ Groq API error: ${aiError.message}\n\nPlease check:\n1. Your GROQ_API_KEY in .env is correct (starts with gsk_)\n2. Visit console.groq.com to verify your key is active\n3. Restart the server after any .env changes`;
      } else {
        aiResponse = `⚠️ HuggingFace API error: ${aiError.message}\n\nTip: Switch to Groq for a more reliable free option.\nGet a free key at console.groq.com and add GROQ_API_KEY to your .env`;
      }
    }

    // Add assistant message
    const assistantMessage = {
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date()
    };
    conversation.messages.push(assistantMessage);

    await conversation.save();

    res.json({
      userMessage,
      assistantMessage,
      conversationId: conversation._id,
      title: conversation.title
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// DELETE /api/chat/conversations/:id/messages - clear conversation messages
router.delete('/conversations/:id/messages', auth, async (req, res) => {
  try {
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { messages: [], title: 'New Chat' },
      { new: true }
    );
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ message: 'Messages cleared', conversation });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear messages' });
  }
});

module.exports = router;