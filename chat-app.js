require('dotenv').config();
const Groq = require('groq-sdk');
const readline = require('readline');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const conversationHistory = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function chat(userMessage) {
  try {
    conversationHistory.push({ role: "user", content: userMessage });

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: conversationHistory,
      max_tokens: 1024,
    });

    const reply = response.choices[0].message.content;
    conversationHistory.push({ role: "assistant", content: reply });
    return reply;

  } catch (error) {
    return `❌ Error: ${error.message}`;
  }
}

async function main() {
  console.log("🤖 Chat with Groq AI");
  console.log('Type your message and press Enter. Type "exit" to quit.\n');

  const promptUser = () => {
    rl.question("You: ", async (input) => {
      if (input.toLowerCase() === "exit") {
        console.log("\n👋 Goodbye!\n");
        rl.close();
        return;
      }
      if (!input.trim()) { promptUser(); return; }

      const response = await chat(input);
      console.log(`\nGroq: ${response}\n`);
      promptUser();
    });
  };

  promptUser();
}

main().catch(console.error);
