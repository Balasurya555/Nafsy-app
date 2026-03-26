require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// --- EMOTIONAL MEMORY SYSTEM (In-Memory Database) ---
const users = {
  'user_1': {
    moodHistory: [3, 2, 4, 3, 2, 3], // 1-5
    journals: [],
    chatHistory: [],
    burnoutScore: 42, // 0-100
  }
};

const emotionKeywords = {
  stress: ['توتر','متوترة','ضغط','قلق','أعصاب','خايفة','امتحان','stress','anxious','overwhelmed'],
  sadness: ['حزن','حزينة','بكاء','دموع','اكتئاب','وحدة','sad','crying','depressed','lonely'],
  fatigue: ['تعب','تعبانة','إجهاد','إرهاق','مرهقة','نوم','أرق','tired','exhausted','burnout','drained'],
  hope: ['أمل','الحمد لله','شكر','ممتنة','سعيدة','hope','grateful','happy','better']
};

function analyzeText(text) {
  const lower = text.toLowerCase();
  let dominant = 'neutral';
  let maxScore = 0;
  for (const [emotion, words] of Object.entries(emotionKeywords)) {
    let score = words.filter(w => lower.includes(w)).length;
    if (score > maxScore) { maxScore = score; dominant = emotion; }
  }
  return dominant;
}

function updateBurnout(userId) {
  const user = users[userId];
  const recentMoods = user.moodHistory.slice(-7);
  const avgMood = recentMoods.reduce((a, b) => a + b, 0) / (recentMoods.length || 1);
  
  // Base burnout on mood
  let base = 50 - (avgMood - 3) * 15; 
  
  // Adjust based on recent journals/chats
  const recentTexts = [...user.journals, ...user.chatHistory.filter(m => m.role==='user').map(m=>m.text)].slice(-5).join(' ');
  const dom = analyzeText(recentTexts);
  if (dom === 'fatigue') base += 15;
  if (dom === 'stress') base += 10;
  if (dom === 'sadness') base += 8;
  if (dom === 'hope') base -= 15;

  user.burnoutScore = Math.max(0, Math.min(100, Math.round(base)));
  
  // Generate Insight Message representing AI Insight Generator (WOW Feature)
  let insight = '';
  if (user.burnoutScore > 65) insight = '⚠️ مؤشر الإجهاد مرتفع جداً. يجب أخذ قسط من الراحة والاستعانة بشخص تثقين به.';
  else if (user.burnoutScore > 40) insight = 'لاحظت نمطاً من التعب والإجهاد هذا الأسبوع. أنصحك بتمرين التنفس المهدئ.';
  else insight = 'حالتك النفسية مستقرة وجيدة هذا الأسبوع 🌱';
  
  return insight;
}

// ===================== API ROUTES =====================

app.get('/api/profile/:id', (req, res) => {
  const user = users[req.params.id] || users['user_1'];
  const insight = updateBurnout(req.params.id || 'user_1');
  res.json({ burnoutScore: user.burnoutScore, moodHistory: user.moodHistory, insight });
});

app.post('/api/journal', (req, res) => {
  const { userId, text, mood } = req.body;
  const user = users[userId || 'user_1'];
  if (mood) user.moodHistory.push(mood);
  if (text) user.journals.push(text);
  
  const insight = updateBurnout(userId || 'user_1');
  res.json({ success: true, burnoutScore: user.burnoutScore, insight });
});

// Context-Aware Chatbot with multi-API Fallbacks
app.post('/api/chat', async (req, res) => {
  const { userId, message } = req.body;
  const user = users[userId || 'user_1'];
  user.chatHistory.push({ role: 'user', text: message });
  
  const emotion = analyzeText(message);
  updateBurnout(userId || 'user_1');

  // SMART INTERVENTIONS & CRISIS DETECTION
  const crisisKeywords = ['انتحار','أموت','إيذاء نفسي','suicide','kill myself','end my life'];
  const isCrisis = crisisKeywords.some(k => message.toLowerCase().includes(k));
  
  if (isCrisis) {
    const crisisMsg = 'أنا هنا معك ولستِ وحدك. أرجوكِ تحدثي مع متخصص فوراً. اضغطي على زر "مساعدة 🆘"';
    user.chatHistory.push({ role: 'ai', text: crisisMsg });
    return res.json({ text: crisisMsg, crisis: true });
  }

  // Determine smart intervention based on state
  let exercise = null;
  if (emotion === 'stress' || user.burnoutScore > 60) {
    exercise = { icon: '🫁', name_ar: 'تنفس 4-7-8 للهدوء', name_en: '4-7-8 Calm Breathing', screen: 'player' };
  } else if (emotion === 'fatigue' || emotion === 'sadness') {
    exercise = { icon: '🧘', name_ar: 'تمرين الصبر — الوعي الحاضر', name_en: 'Patience — Present Awareness', screen: 'player' };
  }

  const systemContext = `You are "Nafsy AI", an emotionally intelligent mental health companion for Arab women. 
Context: User Burnout Score is ${user.burnoutScore}/100. Recent emotion detected: ${emotion}. 
Rules: 
1. Empathize first. 
2. Provide a short gentle insight acknowledging their state based on their burnout score.
3. Keep it to 2-3 short sentences max. 
4. Respond in warm Egyptian Arabic or simple English based on the language of the prompt.
5. Do not offer a medical diagnosis.`;

  // 1. Try Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `${systemContext}\n\nUser says: ${message}`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      const reply = response.text;
      if (reply) {
        user.chatHistory.push({ role: 'ai', text: reply });
        return res.json({ text: reply, exercise, burnout: user.burnoutScore });
      }
    } catch (e) { console.error('Gemini error:', e.message); }
  }

  // 2. Try Grok
  if (process.env.GROK_API_KEY && process.env.GROK_API_KEY.length > 10) {
    try {
      const gRes = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROK_API_KEY}` },
        body: JSON.stringify({
          model: 'grok-3-mini',
          messages: [ { role: 'system', content: systemContext }, { role: 'user', content: message } ],
          max_tokens: 300
        })
      });
      if (gRes.ok) {
        const data = await gRes.json();
        const reply = data.choices[0].message.content;
        user.chatHistory.push({ role: 'ai', text: reply });
        return res.json({ text: reply, exercise, burnout: user.burnoutScore });
      }
    } catch(e) { console.error('Grok error:', e.message); }
  }

  // 3. Fallback (Demo Engine for Hackathon)
  const fallbackReplies = {
    stress: 'حاسة إنك تحت ضغط كبير، وده شعور طبيعي.',
    sadness: 'أقدر أحس بالحزن في كلامك. مشاعرك دي مهمة ومسموعة، وأنا هنا جنبك.',
    fatigue: 'يبدو إن الإجهاد مأثر عليكي، وده واضح من كلامك الأيام دي.',
    hope: 'جميل إنك حاسة بروح إيجابية! استمري على هذا النحو.',
    neutral: 'أنا هنا عشان أسمعك. حابة تفضفضي أكتر؟'
  };
  
  let reply = fallbackReplies[emotion] || fallbackReplies.neutral;
  
  // Append demo insight matching the requested "Demo Flow"
  if (user.burnoutScore >= 50 && (emotion === 'fatigue' || emotion === 'stress' || message.includes('tired') || message.includes('overwhelmed'))) {
      reply = 'لاحظت إنك بتحسي بالتعب والإجهاد بقالك كام يوم. ده ممكن يكون بداية إجهاد نفسي (Burnout). أنصحك تريحي شوية وتجربي تمرين التنفس ده.';
      exercise = { icon: '🫁', name_ar: 'تنفس 4-7-8 للهدوء', name_en: '4-7-8 Calm Breathing', screen: 'player' };
  } else if (message.toLowerCase().includes('tired and overwhelmed')) {
      reply = "You've been feeling this way for a few days. This could be early burnout. Please try this breathing exercise to calm your system.";
      exercise = { icon: '🫁', name_ar: 'تنفس 4-7-8 للهدوء', name_en: '4-7-8 Calm Breathing', screen: 'player' };
  }

  user.chatHistory.push({ role: 'ai', text: reply });
  res.json({ text: reply, exercise, burnout: user.burnoutScore });
});

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
