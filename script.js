const pageId = document.body.dataset.page;
const subjects = [
  { name: 'Math', icon: '🔢', description: 'Numbers, equations, and problem solving.', category: 'Skills' },
  { name: 'Science', icon: '🔬', description: 'Experiment, explore, and understand the world.', category: 'Science' },
  { name: 'English', icon: '📚', description: 'Reading, writing, and communication skills.', category: 'Humanities' },
  { name: 'History', icon: '🌍', description: 'Stories from the past that shape today.', category: 'Humanities' },
  { name: 'Coding', icon: '💻', description: 'Build websites, apps, and automation.', category: 'Skills' },
  { name: 'Philosophy', icon: '🧠', description: 'Big questions, logic, and meaning.', category: 'Humanities' },
  { name: 'Economics', icon: '📊', description: 'Money, markets, and decision making.', category: 'Humanities' },
  { name: 'Geography', icon: '🗺', description: 'Places, maps, and global systems.', category: 'Science' },
  { name: 'Biology', icon: '🧬', description: 'Life, cells, and how living things work.', category: 'Science' },
  { name: 'Chemistry', icon: '⚗', description: 'Molecules, reactions, and materials science.', category: 'Science' },
  { name: 'Physics', icon: '⚡', description: 'Motion, energy, and the laws of nature.', category: 'Science' },
  { name: 'Art', icon: '🎨', description: 'Creativity, color, and visual expression.', category: 'Skills' }
];

const navLinks = [
  { label: 'Dashboard', href: 'dashboard.html' },
  { label: 'Learn', href: 'learn.html' },
  { label: 'Subjects', href: 'subjects.html' },
  { label: 'Quiz', href: 'quiz.html' },
  { label: 'Progress', href: 'progress.html' },
  { label: 'Chat', href: 'chat.html' }
];

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getSessionId() {
  let sessionId = lsGet('mm_sessionId', null);
  if (!sessionId) {
    sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    lsSet('mm_sessionId', sessionId);
  }
  return sessionId;
}

function ensureProfile() {
  const profile = lsGet('mm_name', '');
  if (!profile) {
    lsSet('mm_name', '');
    lsSet('mm_level', 'Newbie');
    lsSet('mm_count', 0);
    lsSet('mm_subject', 'Math');
    lsSet('mm_subjects', {});
    lsSet('mm_streak', []);
    lsSet('mm_milestones', []);
    lsSet('mm_quiz_scores', {});
    lsSet('mm_sessions', []);
    lsSet('mm_style', 'Visual');
    lsSet('mm_theme', 'dark');
    lsSet('mm_avatarColor', '#7b7cff');
  }
  getSessionId();
}

function formatName(name) {
  return name ? name.trim().split(' ')[0] : 'Learner';
}

function getSubjectByName(name) {
  return subjects.find((subject) => subject.name === name) || subjects[0];
}

function getLevelForCount(count) {
  if (count >= 150) return 'Master';
  if (count >= 100) return 'Scholar';
  if (count >= 60) return 'Explorer';
  if (count >= 25) return 'Learner';
  return 'Newbie';
}

function updateLevel() {
  const count = lsGet('mm_count', 0);
  const level = getLevelForCount(count);
  lsSet('mm_level', level);
  return level;
}

function addMilestone(eventName) {
  const milestones = lsGet('mm_milestones', []);
  milestones.push({ event: eventName, date: new Date().toLocaleDateString() });
  lsSet('mm_milestones', milestones);
}

function updateStreak() {
  const today = new Date().toISOString().slice(0, 10);
  const streak = lsGet('mm_streak', []);
  if (!streak.length || streak[streak.length - 1] !== today) {
    streak.push(today);
    if (streak.length > 7) streak.shift();
    lsSet('mm_streak', streak);
  }
}

function recordChat(subject) {
  const messageCount = lsGet('mm_count', 0) + 1;
  lsSet('mm_count', messageCount);
  const subjectsData = lsGet('mm_subjects', {});
  subjectsData[subject] = (subjectsData[subject] || 0) + 1;
  lsSet('mm_subjects', subjectsData);
  lsSet('mm_subject', subject);
  updateLevel();
  updateStreak();
  if ([1, 10, 25, 50, 100].includes(messageCount)) {
    addMilestone(`Sent ${messageCount} messages`);
  }
  const sessions = lsGet('mm_sessions', []);
  const currentSession = getSessionId();
  let session = sessions.find((item) => item.sessionId === currentSession && !item.ended);
  if (!session) {
    session = { sessionId: currentSession, subject, count: 0, started: new Date().toLocaleString(), ended: null };
    sessions.push(session);
  }
  session.count += 1;
  session.subject = subject;
  session.ended = new Date().toLocaleDateString();
  lsSet('mm_sessions', sessions);
}

function recordConversation(subject, userMessage, aiReply) {
  const conversations = lsGet('mm_conversations', []);
  conversations.push({
    subject,
    timestamp: new Date().toISOString(),
    userMessage,
    aiReply,
    sessionId: getSessionId()
  });
  // Keep only last 100 conversations
  if (conversations.length > 100) {
    conversations.shift();
  }
  lsSet('mm_conversations', conversations);
}

function getVitals() {
  return {
    name: lsGet('mm_name', ''),
    subject: lsGet('mm_subject', 'Math'),
    style: lsGet('mm_style', 'Visual'),
    theme: lsGet('mm_theme', 'dark'),
    avatarColor: lsGet('mm_avatarColor', '#7b7cff'),
    level: lsGet('mm_level', 'Newbie'),
    count: lsGet('mm_count', 0),
    streak: lsGet('mm_streak', []),
    subjectsData: lsGet('mm_subjects', {}),
    quizScores: lsGet('mm_quiz_scores', {}),
  };
}

function getExploredSubjects() {
  const subjectsData = lsGet('mm_subjects', {});
  return Object.entries(subjectsData)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ ...getSubjectByName(name), count }))
    .sort((a, b) => b.count - a.count);
}

function getFavoriteSubject() {
  const subjectsData = lsGet('mm_subjects', {});
  const entries = Object.entries(subjectsData).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries[0][0] : lsGet('mm_subject', 'Math');
}

function getQuizMetrics() {
  const scores = lsGet('mm_quiz_scores', {});
  const all = Object.values(scores).flat();
  const total = all.length;
  return {
    total,
    average: total ? Math.round(all.reduce((sum, value) => sum + value, 0) / total) : 0,
    scores,
  };
}

function getWeakArea() {
  const scores = lsGet('mm_quiz_scores', {});
  const averages = Object.entries(scores).map(([subject, values]) => ({
    subject,
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
  }));
  if (!averages.length) return 'None yet — take a quiz to find weak topics.';
  averages.sort((a, b) => a.average - b.average);
  return averages[0].subject;
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  lsSet('mm_theme', theme);
}

function buildNav() {
  const navContainer = document.querySelector('.site-nav');
  if (!navContainer) return;
  const links = navLinks
    .map((link) => {
      const active = pageId && window.location.pathname.endsWith(link.href);
      return `<a href="${link.href}" class="nav-link ${active ? 'active' : ''}">${link.label}</a>`;
    })
    .join('');
  navContainer.innerHTML = `
    <div class="nav-brand"><a href="/dashboard.html">🧠 MindMesh</a></div>
    <nav>${links}</nav>
    <div class="nav-right">
      <a href="/chat.html" class="chat-btn">Ask AI →</a>
      <div class="avatar">MM</div>
    </div>
  `;
}

function apiPost(path, payload) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => res.json());
}

function registerVisitor() {
  apiPost('/api/visit', { visitorId: getSessionId() }).catch(() => undefined);
}

function renderSubjectCards(container, category = 'All', search = '') {
  if (!container) return;
  const query = search.trim().toLowerCase();
  const explored = lsGet('mm_subjects', {});
  const filtered = subjects.filter((item) => {
    const matchesCategory = category === 'All' || item.category === category;
    const matchesSearch = !query || item.name.toLowerCase().includes(query) || item.description.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });
  container.innerHTML = filtered
    .map((item) => {
      const count = explored[item.name] || 0;
      return `
        <article class="subject-card">
          <div class="subject-card-main">
            <div class="subject-icon">${item.icon}</div>
            <div>
              <h3>${item.name}</h3>
              <p>${item.description}</p>
            </div>
          </div>
          <div class="subject-card-actions">
            ${count ? '<span class="badge">Explored ✓</span>' : '<span class="badge badge-muted">New</span>'}
            <a class="button button-secondary" href="chat.html?subject=${encodeURIComponent(item.name)}">Start →</a>
          </div>
        </article>
      `;
    })
    .join('');
}

function initIndex() {
  buildNav();
  const startButton = document.querySelector('#start-free');
  if (!startButton) return;
  startButton.addEventListener('click', () => {
    const name = lsGet('mm_name', '');
    window.location.href = name ? 'dashboard.html' : 'onboarding.html';
  });
}

function initOnboarding() {
  buildNav();
  setTheme(lsGet('mm_theme', 'dark'));
  ensureProfile();

  const steps = [...document.querySelectorAll('.onboarding-step')];
  const progress = document.querySelector('#onboarding-progress');
  const nameInput = document.querySelector('#onboarding-name');
  const styleCards = [...document.querySelectorAll('.learning-style-card')];
  const subjectButtons = [...document.querySelectorAll('.subject-choice')];
  const nextButton = document.querySelector('#onboarding-next');
  const backButton = document.querySelector('#onboarding-back');
  let step = 1;
  let selectedStyle = lsGet('mm_style', 'Visual');
  let selectedSubject = lsGet('mm_subject', 'Math');

  function refresh() {
    steps.forEach((element, index) => element.classList.toggle('active', index === step - 1));
    if (progress) progress.value = step;
    backButton.style.display = step === 1 ? 'none' : 'inline-flex';
    nextButton.textContent = step === 3 ? 'Finish' : 'Next';
  }

  styleCards.forEach((card) => {
    card.addEventListener('click', () => {
      selectedStyle = card.dataset.value || 'Visual';
      styleCards.forEach((item) => item.classList.toggle('selected', item === card));
    });
    if (card.dataset.value === selectedStyle) card.classList.add('selected');
  });

  subjectButtons.forEach((card) => {
    card.addEventListener('click', () => {
      selectedSubject = card.dataset.value || 'Math';
      subjectButtons.forEach((item) => item.classList.toggle('selected', item === card));
    });
    if (card.dataset.value === selectedSubject) card.classList.add('selected');
  });

  nextButton.addEventListener('click', () => {
    if (step === 1) {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      lsSet('mm_name', name);
    }
    if (step === 3) {
      lsSet('mm_style', selectedStyle);
      lsSet('mm_subject', selectedSubject);
      lsSet('mm_level', 'Newbie');
      lsSet('mm_count', 0);
      lsSet('mm_subjects', { [selectedSubject]: 0 });
      lsSet('mm_streak', []);
      lsSet('mm_milestones', [{ event: 'Started onboarding', date: new Date().toLocaleDateString() }]);
      lsSet('mm_quiz_scores', {});
      lsSet('mm_sessions', []);
      getSessionId();
      window.location.href = 'dashboard.html';
      return;
    }
    step += 1;
    refresh();
  });

  backButton.addEventListener('click', () => {
    if (step > 1) {
      step -= 1;
      refresh();
    }
  });

  refresh();
}

function initSignup() {
  buildNav();
  setTheme(lsGet('mm_theme', 'dark'));
  ensureProfile();

  const form = document.querySelector('#signup-form');
  const nameInput = document.querySelector('#signup-name');
  const emailInput = document.querySelector('#signup-email');
  const passwordInput = document.querySelector('#signup-password');
  const confirmInput = document.querySelector('#signup-confirm');
  const termsCheckbox = document.querySelector('#terms-checkbox');
  const googleButton = document.querySelector('#google-signup');

  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    
    // Validation
    const name = nameInput?.value.trim();
    const email = emailInput?.value.trim();
    const password = passwordInput?.value;
    const confirm = confirmInput?.value;
    
    let hasError = false;

    // Reset error messages
    document.querySelectorAll('.error-message').forEach(el => el.classList.remove('show'));

    // Name validation
    if (!name || name.length < 2) {
      const nameError = document.querySelector('#name-error');
      if (nameError) {
        nameError.textContent = 'Please enter at least 2 characters';
        nameError.classList.add('show');
      }
      hasError = true;
    }

    // Email validation
    if (!email || !email.includes('@')) {
      const emailError = document.querySelector('#email-error');
      if (emailError) {
        emailError.textContent = 'Please enter a valid email';
        emailError.classList.add('show');
      }
      hasError = true;
    }

    // Password validation
    if (!password || password.length < 8) {
      const passwordError = document.querySelector('#password-error');
      if (passwordError) {
        passwordError.textContent = 'Password must be at least 8 characters';
        passwordError.classList.add('show');
      }
      hasError = true;
    }

    // Confirm password validation
    if (password !== confirm) {
      const confirmError = document.querySelector('#confirm-error');
      if (confirmError) {
        confirmError.textContent = 'Passwords do not match';
        confirmError.classList.add('show');
      }
      hasError = true;
    }

    // Terms validation
    if (termsCheckbox && !termsCheckbox.checked) {
      alert('Please agree to the Terms of Service and Privacy Policy');
      hasError = true;
    }

    if (hasError) return;

    // Store account info
    lsSet('mm_email', email);
    lsSet('mm_password', btoa(password)); // Basic encoding (not secure for production)
    lsSet('mm_name', name);
    lsSet('mm_level', 'Newbie');
    lsSet('mm_count', 0);
    lsSet('mm_subjects', {});
    lsSet('mm_streak', []);
    lsSet('mm_milestones', [{ event: 'Created account', date: new Date().toLocaleDateString() }]);
    lsSet('mm_quiz_scores', {});
    lsSet('mm_sessions', []);
    getSessionId();

    // Show success and redirect to onboarding
    const successMessage = document.querySelector('#signup-success');
    if (successMessage) {
      successMessage.classList.add('visible');
      setTimeout(() => {
        window.location.href = 'onboarding.html';
      }, 1200);
    } else {
      window.location.href = 'onboarding.html';
    }
  });

  // Google signup handler
  googleButton?.addEventListener('click', () => {
    alert('Google sign-up coming soon!');
  });
}


function initDashboard() {
  buildNav();
  setTheme(lsGet('mm_theme', 'dark'));
  ensureProfile();

  const vitals = getVitals();
  const welcomeName = document.querySelector('#dashboard-name');
  const levelValue = document.querySelector('#dashboard-level');
  const countValue = document.querySelector('#dashboard-count');
  const levelCard = document.querySelector('#dashboard-level-card');
  const subjectCount = document.querySelector('#dashboard-subjects');
  const resumeSubject = document.querySelector('#dashboard-resume-subject');
  const resumeLink = document.querySelector('#dashboard-resume-link');

  if (welcomeName) welcomeName.textContent = formatName(vitals.name);
  if (levelValue) levelValue.textContent = vitals.level;
  if (countValue) countValue.textContent = vitals.count;
  if (levelCard) levelCard.textContent = vitals.level;
  if (subjectCount) subjectCount.textContent = Object.keys(vitals.subjectsData).filter((key) => vitals.subjectsData[key] > 0).length;
  if (resumeSubject) resumeSubject.textContent = vitals.subject;
  if (resumeLink) resumeLink.href = `chat.html?subject=${encodeURIComponent(vitals.subject)}`;

  const subjectList = document.querySelector('#dashboard-subject-list');
  if (subjectList) {
    const explored = getExploredSubjects();
    subjectList.innerHTML = explored.length
      ? explored.map((item) => `
          <article class="subject-progress-card">
            <div class="subject-progress-top">
              <span class="subject-icon">${item.icon}</span>
              <div>
                <h3>${item.name}</h3>
                <small>${item.count} messages</small>
              </div>
            </div>
            <div class="progress-bar small"><span style="width: ${Math.min(100, item.count * 2)}%"></span></div>
          </article>
        `).join('')
      : '<p class="empty-state">No subject activity yet. Start learning to build your tracker.</p>';
  }

  const streakContainer = document.querySelector('#dashboard-streak');
  if (streakContainer) {
    streakContainer.innerHTML = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      return `<div class="streak-dot ${vitals.streak.includes(key) ? 'active' : ''}" title="${date.toLocaleDateString(undefined, { weekday: 'short' })}"></div>`;
    }).join('');
  }

  const challengeBox = document.querySelector('#dashboard-challenge');
  if (challengeBox) {
    fetch('/api/quiz-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: vitals.subject }),
    })
      .then((res) => res.json())
      .then((data) => {
        challengeBox.innerHTML = data.question
          ? `<p>${data.question}</p><small>${vitals.subject}</small>`
          : '<p>Try the quiz to discover a new challenge.</p>';
      })
      .catch(() => {
        challengeBox.innerHTML = '<p>Unable to load challenge right now.</p>';
      });
  }
}

function initSubjects() {
  buildNav();
  setTheme(lsGet('mm_theme', 'dark'));
  ensureProfile();

  const searchInput = document.querySelector('#subject-search');
  const filterButtons = [...document.querySelectorAll('.filter-pill')];
  const grid = document.querySelector('#subject-grid');
  let activeFilter = 'All';

  function refresh() {
    renderSubjectCards(grid, activeFilter, searchInput ? searchInput.value : '');
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter || 'All';
      filterButtons.forEach((item) => item.classList.toggle('active', item === button));
      refresh();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', refresh);
  }

  refresh();
}

function initChat() {
  buildNav();
  setTheme(lsGet('mm_theme', 'dark'));
  ensureProfile();

  const subjectParam = getQueryParam('subject');
  const subjectName = subjectParam || lsGet('mm_subject', 'Math');
  const subject = getSubjectByName(subjectName);
  const chatSubject = document.querySelector('#chat-subject');
  const switchLink = document.querySelector('#switch-subject');
  const form = document.querySelector('#chat-form');
  const input = document.querySelector('#message-input');
  const messages = document.querySelector('#messages');

  if (chatSubject) chatSubject.textContent = `${subject.icon} ${subject.name}`;
  if (switchLink) switchLink.href = 'subjects.html';
  if (messages) messages.innerHTML = '';

  function appendMessage(text, sender) {
    if (!messages) return;
    const node = document.createElement('div');
    node.className = `message ${sender}`;
    node.innerHTML = `<div class="bubble">${text}</div>`;
    messages.appendChild(node);
    messages.scrollTop = messages.scrollHeight;
  }

  function showTyping() {
    if (!messages) return;
    const node = document.createElement('div');
    node.className = 'message assistant typing-indicator';
    node.id = 'typing-indicator';
    node.innerHTML = `<div class="bubble typing"><span></span><span></span><span></span></div>`;
    messages.appendChild(node);
    messages.scrollTop = messages.scrollHeight;
  }

  function hideTyping() {
    const indicator = document.querySelector('#typing-indicator');
    if (indicator) indicator.remove();
  }

  if (messages) appendMessage(`Ready to study ${subject.name}. Ask your first question!`, 'assistant');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    appendMessage(text, 'user');
    input.value = '';
    showTyping();
    try {
      const result = await apiPost('/api/chat', { 
        visitorId: getSessionId(), 
        subject: subject.name, 
        message: text,
        userLevel: lsGet('mm_level', 'Newbie')
      });
      hideTyping();
      const reply = result.reply || 'Sorry, I could not answer that.';
      appendMessage(reply, 'assistant');
      recordChat(subject.name);
      recordConversation(subject.name, text, reply);
    } catch (error) {
      hideTyping();
      const errorMsg = 'Connection error. Try again later.';
      appendMessage(errorMsg, 'assistant');
      recordConversation(subject.name, text, 'Error: ' + error.message);
    }
  });
}

function initQuiz() {
  buildNav();
  setTheme(lsGet('mm_theme', 'dark'));
  ensureProfile();

  const tabs = [...document.querySelectorAll('.quiz-subject-tab button')];
  const generateButton = document.querySelector('#generate-quiz');
  const scoreLabel = document.querySelector('#quiz-score');
  const questionPanel = document.querySelector('#quiz-question');
  const nextButton = document.querySelector('#quiz-next');
  const resultsPanel = document.querySelector('#quiz-results');

  let activeSubject = getFavoriteSubject();
  let questions = [];
  let currentIndex = 0;
  let correctCount = 0;
  let answered = false;

  function updateScore() {
    if (scoreLabel) scoreLabel.textContent = `${correctCount} / ${questions.length || 5} correct`;
  }

  function renderQuestion() {
    if (!questionPanel) return;
    const question = questions[currentIndex];
    if (!question) {
      questionPanel.innerHTML = '<p class="empty-state">Generate a quiz to begin.</p>';
      nextButton.disabled = true;
      return;
    }
    questionPanel.innerHTML = `
      <div class="quiz-card-panel">
        <h2>${question.question}</h2>
        <div class="quiz-options">${question.options
          .map((option) => `<button class="button quiz-option" data-answer="${option[0]}">${option}</button>`)
          .join('')}</div>
        <div class="quiz-explanation"></div>
      </div>
    `;
    answered = false;
    nextButton.disabled = true;
    nextButton.textContent = currentIndex + 1 === questions.length ? 'Finish quiz' : 'Next question →';
    questionPanel.querySelectorAll('.quiz-option').forEach((button) => {
      button.addEventListener('click', () => {
        if (answered) return;
        answered = true;
        const selected = button.dataset.answer;
        questionPanel.querySelectorAll('.quiz-option').forEach((btn) => {
          btn.classList.add(btn.dataset.answer === question.correct ? 'correct' : 'wrong');
          btn.disabled = true;
        });
        if (selected === question.correct) correctCount += 1;
        const explanation = questionPanel.querySelector('.quiz-explanation');
        if (explanation) explanation.textContent = question.explanation;
        nextButton.disabled = false;
        updateScore();
      });
    });
    updateScore();
  }

  function renderResults() {
    if (!resultsPanel) return;
    const percent = questions.length ? Math.round((correctCount / questions.length) * 100) : 0;
    const grade = percent >= 90 ? 'A' : percent >= 75 ? 'B' : percent >= 60 ? 'C' : percent >= 50 ? 'D' : 'F';
    const message = grade === 'A' ? 'Excellent work!' : grade === 'B' ? 'Great job!' : grade === 'C' ? 'Solid effort!' : grade === 'D' ? 'Keep practicing!' : 'Let’s study this topic more.';
    resultsPanel.innerHTML = `
      <div class="quiz-results-card">
        <h2>${percent}%</h2>
        <p class="grade">Grade ${grade}</p>
        <p>${message}</p>
        <div class="quiz-results-actions">
          <button id="quiz-retry" class="button button-secondary">Try again</button>
          <a class="button button-primary" href="chat.html?subject=${encodeURIComponent(activeSubject)}">Learn this topic →</a>
        </div>
      </div>
    `;
    const scores = lsGet('mm_quiz_scores', {});
    scores[activeSubject] = scores[activeSubject] || [];
    scores[activeSubject].push(percent);
    lsSet('mm_quiz_scores', scores);
    addMilestone(`Completed quiz in ${activeSubject}`);
    document.querySelector('#quiz-retry')?.addEventListener('click', () => {
      resultsPanel.innerHTML = '';
      startQuiz();
    });
  }

  function startQuiz() {
    questions = [];
    currentIndex = 0;
    correctCount = 0;
    answered = false;
    if (questionPanel) questionPanel.innerHTML = '<p class="empty-state">Generate a quiz to begin.</p>';
    if (resultsPanel) resultsPanel.innerHTML = '';
    if (nextButton) nextButton.disabled = true;
    updateScore();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      activeSubject = tab.dataset.subject || 'Math';
      tabs.forEach((item) => item.classList.toggle('active', item === tab));
    });
  });

  generateButton?.addEventListener('click', async () => {
    if (!generateButton) return;
    generateButton.disabled = true;
    generateButton.textContent = 'Generating...';
    if (questionPanel) questionPanel.innerHTML = '<p class="empty-state">Generating quiz…</p>';
    questions = [];
    currentIndex = 0;
    correctCount = 0;
    updateScore();
    try {
      const data = await apiPost('/api/quiz', { subject: activeSubject });
      questions = Array.isArray(data) ? data : [];
      if (!questions.length) {
        if (questionPanel) questionPanel.innerHTML = '<p class="empty-state">Unable to generate quiz.</p>';
        nextButton.disabled = true;
      } else {
        currentIndex = 0;
        renderQuestion();
      }
    } catch (error) {
      if (questionPanel) questionPanel.innerHTML = '<p class="empty-state">Unable to generate quiz right now.</p>';
    }
    generateButton.disabled = false;
    generateButton.textContent = 'Generate Quiz';
  });

  nextButton?.addEventListener('click', () => {
    if (currentIndex + 1 < questions.length) {
      currentIndex += 1;
      renderQuestion();
    } else {
      renderResults();
      nextButton.disabled = true;
    }
  });

  startQuiz();
}

function initProgress() {
  buildNav();
  setTheme(lsGet('mm_theme', 'dark'));
  ensureProfile();

  const vitals = getVitals();
  const quizMetrics = getQuizMetrics();

  const levelName = document.querySelector('#progress-level-name');
  const totalMessages = document.querySelector('#progress-total-messages');
  const totalSessions = document.querySelector('#progress-total-sessions');
  const totalMessages2 = document.querySelector('#progress-total-messages-2');
  const favorite = document.querySelector('#progress-favorite-subject');
  const quizzesTaken = document.querySelector('#progress-quizzes-taken');
  const avgScore = document.querySelector('#progress-avg-score');
  const weakArea = document.querySelector('#progress-weak-area');
  const journeyList = document.querySelector('#progress-journey');
  const breakdown = document.querySelector('#progress-breakdown');

  if (levelName) levelName.textContent = vitals.level;
  if (totalMessages) totalMessages.textContent = vitals.count;
  if (totalMessages2) totalMessages2.textContent = vitals.count;
  if (totalSessions) totalSessions.textContent = lsGet('mm_sessions', []).length;
  if (favorite) favorite.textContent = getFavoriteSubject();
  if (quizzesTaken) quizzesTaken.textContent = quizMetrics.total;
  if (avgScore) avgScore.textContent = `${quizMetrics.average}%`;
  if (weakArea) weakArea.textContent = getWeakArea();

  if (journeyList) {
    const milestones = lsGet('mm_milestones', []);
    journeyList.innerHTML = milestones.length
      ? milestones.map((item) => `<li><span>${item.date}</span>${item.event}</li>`).join('')
      : '<li>No milestones yet.</li>';
  }

  if (breakdown) {
    const total = Object.values(vitals.subjectsData).reduce((sum, value) => sum + value, 0) || 1;
    breakdown.innerHTML = subjects
      .map((subject) => {
        const value = vitals.subjectsData[subject.name] || 0;
        const width = total ? Math.round((value / total) * 100) : 0;
        return `
          <div class="breakdown-row">
            <span>${subject.name}</span>
            <div class="breakdown-bar"><span style="width: ${width}%"></span></div>
            <strong>${value}</strong>
          </div>
        `;
      })
      .join('');
  }
}

function initProfile() {
  buildNav();
  setTheme(lsGet('mm_theme', 'dark'));
  ensureProfile();

  const nameInput = document.querySelector('#profile-name');
  const styleCards = [...document.querySelectorAll('.learning-style-card')];
  const subjectSelect = document.querySelector('#profile-subject');
  const colorButtons = [...document.querySelectorAll('.avatar-color')];
  const themeToggle = document.querySelector('#theme-toggle');
  const saveButton = document.querySelector('#save-profile');
  const resetButton = document.querySelector('#reset-progress');
  const avatar = document.querySelector('#profile-avatar');

  const name = lsGet('mm_name', 'Learner');
  const style = lsGet('mm_style', 'Visual');
  const favorite = lsGet('mm_subject', 'Math');
  const theme = lsGet('mm_theme', 'dark');
  const avatarColor = lsGet('mm_avatarColor', '#7b7cff');

  if (nameInput) nameInput.value = name;
  if (themeToggle) themeToggle.checked = theme === 'dark';
  setTheme(theme);
  if (avatar) {
    const initials = name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    avatar.textContent = initials || 'MM';
    avatar.style.backgroundColor = avatarColor;
  }

  styleCards.forEach((card) => {
    if (card.dataset.value === style) card.classList.add('selected');
    card.addEventListener('click', () => {
      lsSet('mm_style', card.dataset.value || 'Visual');
      styleCards.forEach((item) => item.classList.toggle('selected', item === card));
    });
  });

  if (subjectSelect) {
    subjectSelect.innerHTML = subjects.map((subject) => `<option value="${subject.name}">${subject.icon} ${subject.name}</option>`).join('');
    subjectSelect.value = favorite;
    subjectSelect.addEventListener('change', () => lsSet('mm_subject', subjectSelect.value));
  }

  colorButtons.forEach((button) => {
    const color = button.dataset.color;
    button.style.backgroundColor = color;
    if (color === avatarColor) button.classList.add('selected');
    button.addEventListener('click', () => {
      lsSet('mm_avatarColor', color);
      colorButtons.forEach((item) => item.classList.toggle('selected', item === button));
      if (avatar) avatar.style.backgroundColor = color;
    });
  });

  nameInput?.addEventListener('input', () => lsSet('mm_name', nameInput.value));
  themeToggle?.addEventListener('change', () => setTheme(themeToggle.checked ? 'dark' : 'light'));
  saveButton?.addEventListener('click', (event) => {
    event.preventDefault();
    if (nameInput) lsSet('mm_name', nameInput.value.trim() || 'Learner');
    if (subjectSelect) lsSet('mm_subject', subjectSelect.value);
    const toast = document.querySelector('#save-toast');
    if (toast) {
      toast.classList.add('visible');
      setTimeout(() => toast.classList.remove('visible'), 2000);
    }
  });
  resetButton?.addEventListener('click', () => {
    if (confirm('Reset all progress? This cannot be undone.')) {
      localStorage.clear();
      window.location.reload();
    }
  });
}

function initPage() {
  // Check if user is logged in (has signed up)
  const isSignedUp = lsGet('mm_email', null) !== null;
  const isSignupOrIndex = pageId === 'signup' || pageId === 'index';
  
  // Redirect unauthenticated users to signup
  if (!isSignedUp && !isSignupOrIndex) {
    window.location.href = 'signup.html';
    return;
  }

  // Redirect authenticated users away from signup
  if (isSignedUp && pageId === 'signup') {
    window.location.href = 'dashboard.html';
    return;
  }

  ensureProfile();
  registerVisitor();
  if (pageId === 'index') return initIndex();
  if (pageId === 'onboarding') return initOnboarding();
  if (pageId === 'dashboard') return initDashboard();
  if (pageId === 'subjects') return initSubjects();
  if (pageId === 'chat') return initChat();
  if (pageId === 'quiz') return initQuiz();
  if (pageId === 'progress') return initProgress();
  if (pageId === 'profile') return initProfile();
  if (pageId === 'signup') return initSignup();
}

document.addEventListener('DOMContentLoaded', initPage);
