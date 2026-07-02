const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');
const messages = document.querySelector('#messages');

const visitorIdKey = 'chatbot-visitor-id';
const visitorId = getOrCreateVisitorId();

function getOrCreateVisitorId() {
  let id = localStorage.getItem(visitorIdKey);
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `visitor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(visitorIdKey, id);
  }
  return id;
}

function addMessage(text, sender) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${sender}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  wrapper.appendChild(bubble);
  messages.appendChild(wrapper);
  messages.scrollTop = messages.scrollHeight;
}

function showTyping() {
  const typing = document.createElement('div');
  typing.className = 'message assistant';
  typing.innerHTML = `
    <div class="bubble typing" aria-label="assistant is typing">
      <span></span><span></span><span></span>
    </div>
  `;
  typing.id = 'typing-indicator';
  messages.appendChild(typing);
  messages.scrollTop = messages.scrollHeight;
}

function hideTyping() {
  const typing = document.querySelector('#typing-indicator');
  if (typing) typing.remove();
}

const backendUrl = 'http://localhost:4000';

async function apiPost(path, payload) {
  const response = await fetch(`${backendUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.json();
}

async function sendChat(message) {
  showTyping();
  try {
    const data = await apiPost('/api/chat', { visitorId, message });
    hideTyping();

    if (data.reply) {
      addMessage(data.reply, 'assistant');
    } else {
      addMessage('Sorry, I could not respond right now.', 'assistant');
    }
  } catch (error) {
    hideTyping();
    addMessage('Sorry, the connection dropped. Please try again in a moment.', 'assistant');
  }
}

async function registerVisitor() {
  try {
    await apiPost('/api/visit', { visitorId });
  } catch (error) {
    console.warn('Visitor registration failed:', error);
  }
}

function bootstrap() {
  addMessage('Hello! I can help answer questions and guide visitors on this chat page.', 'assistant');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const message = input.value.trim();
  if (!message) return;

  addMessage(message, 'user');
  input.value = '';
  await sendChat(message);
});

registerVisitor().then(bootstrap);
