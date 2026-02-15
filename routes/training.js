const express = require('express');
const { TrainingEntry, SystemPrompt } = require('../models/Training');
const auth = require('../middleware/auth');

const router = express.Router();

// ===== SYSTEM PROMPTS (Persona Training) =====

// GET /api/training/prompts - get all system prompts
router.get('/prompts', auth, async (req, res) => {
  try {
    const prompts = await SystemPrompt.find({ userId: req.user._id })
      .sort({ createdAt: -1 });
    res.json(prompts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch prompts' });
  }
});

// POST /api/training/prompts - create system prompt
router.post('/prompts', auth, async (req, res) => {
  try {
    const { name, prompt, isActive } = req.body;

    if (!name || !prompt) {
      return res.status(400).json({ error: 'Name and prompt are required' });
    }

    // If setting as active, deactivate all others
    if (isActive) {
      await SystemPrompt.updateMany(
        { userId: req.user._id },
        { isActive: false }
      );
    }

    const systemPrompt = new SystemPrompt({
      userId: req.user._id,
      name,
      prompt,
      isActive: isActive || false
    });

    await systemPrompt.save();
    res.status(201).json(systemPrompt);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create prompt' });
  }
});

// PUT /api/training/prompts/:id/activate - set a prompt as active
router.put('/prompts/:id/activate', auth, async (req, res) => {
  try {
    // Deactivate all
    await SystemPrompt.updateMany(
      { userId: req.user._id },
      { isActive: false }
    );

    // Activate selected
    const prompt = await SystemPrompt.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isActive: true },
      { new: true }
    );

    if (!prompt) {
      return res.status(404).json({ error: 'Prompt not found' });
    }

    res.json(prompt);
  } catch (error) {
    res.status(500).json({ error: 'Failed to activate prompt' });
  }
});

// PUT /api/training/prompts/deactivate-all - use default prompt
router.put('/prompts/deactivate-all', auth, async (req, res) => {
  try {
    await SystemPrompt.updateMany(
      { userId: req.user._id },
      { isActive: false }
    );
    res.json({ message: 'All prompts deactivated, using default' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to deactivate prompts' });
  }
});

// DELETE /api/training/prompts/:id
router.delete('/prompts/:id', auth, async (req, res) => {
  try {
    await SystemPrompt.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user._id 
    });
    res.json({ message: 'Prompt deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete prompt' });
  }
});

// ===== TRAINING EXAMPLES (Few-shot learning) =====

// GET /api/training/examples
router.get('/examples', auth, async (req, res) => {
  try {
    const examples = await TrainingEntry.find({ userId: req.user._id })
      .sort({ createdAt: -1 });
    res.json(examples);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch examples' });
  }
});

// POST /api/training/examples - add training example
router.post('/examples', auth, async (req, res) => {
  try {
    const { prompt, response, category } = req.body;

    if (!prompt || !response) {
      return res.status(400).json({ error: 'Prompt and response are required' });
    }

    const entry = new TrainingEntry({
      userId: req.user._id,
      prompt,
      response,
      category: category || 'general'
    });

    await entry.save();
    res.status(201).json(entry);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add training example' });
  }
});

// DELETE /api/training/examples/:id
router.delete('/examples/:id', auth, async (req, res) => {
  try {
    await TrainingEntry.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user._id 
    });
    res.json({ message: 'Example deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete example' });
  }
});

// GET /api/training/export - export training data as JSONL (for fine-tuning)
router.get('/export', auth, async (req, res) => {
  try {
    const examples = await TrainingEntry.find({ 
      userId: req.user._id,
      isApproved: true 
    });

    // Format as JSONL for Hugging Face fine-tuning
    const jsonlData = examples.map(ex => ({
      messages: [
        { role: 'user', content: ex.prompt },
        { role: 'assistant', content: ex.response }
      ]
    }));

    const jsonlString = jsonlData.map(d => JSON.stringify(d)).join('\n');

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', 'attachment; filename="training_data.jsonl"');
    res.send(jsonlString);
  } catch (error) {
    res.status(500).json({ error: 'Failed to export training data' });
  }
});

module.exports = router;
