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

const LEVEL_THRESHOLDS = [
  { name: 'Newbie', icon: '🌱', min: 0, max: 25 },
  { name: 'Learner', icon: '📖', min: 25, max: 60 },
  { name: 'Explorer', icon: '🧭', min: 60, max: 100 },
  { name: 'Scholar', icon: '📚', min: 100, max: 150 },
  { name: 'Master', icon: '🏆', min: 150, max: Infinity },
];

function getLevelForCount(count) {
  const entry = LEVEL_THRESHOLDS.find((level) => count >= level.min && count < level.max);
  return (entry || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1]).name;
}

function getLevelProgress(count) {
  const index = LEVEL_THRESHOLDS.findIndex((level) => count >= level.min && count < level.max);
  const level = index === -1 ? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] : LEVEL_THRESHOLDS[index];
  const next = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.indexOf(level) + 1] || null;
  const pct = level.max === Infinity ? 100 : Math.round(((count - level.min) / (level.max - level.min)) * 100);
  return {
    level: level.name,
    icon: level.icon,
    pct,
    nextLevel: next ? next.name : null,
    remaining: next ? Math.max(0, next.min - count) : 0,
  };
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
  if (window.MindMeshUI) {
    window.MindMeshUI.buildNav();
    return;
  }
  const navContainer = document.querySelector('.site-nav');
  if (!navContainer) return;
  const initials = formatName(lsGet('mm_name', '')).slice(0, 2).toUpperCase() || 'MM';
  const links = navLinks
    .map((link) => {
      const active = pageId && window.location.pathname.endsWith(link.href);
      return `<a href="${link.href}" class="nav-link ${active ? 'active' : ''}">${link.label}</a>`;
    })
    .join('');
  navContainer.innerHTML = `
    <div class="nav-brand"><a href="/">🧠 MindMesh</a></div>
    <nav class="nav-links">${links}</nav>
    <div class="nav-right">
      <a href="/chat.html" class="chat-btn">Ask AI →</a>
      <a href="/profile.html" class="avatar">${initials}</a>
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

function initOnboarding() {
  // Onboarding is now a fully self-contained gamified page.
  // All logic lives inline in onboarding.html.
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
  const publicPages = ['index', 'signup', 'onboarding', 'checkout'];
  const hasProfile = Boolean((lsGet('mm_name', '') || '').trim());

  if (!hasProfile && pageId && !publicPages.includes(pageId)) {
    window.location.href = 'onboarding.html';
    return;
  }

  if (hasProfile && pageId === 'signup') {
    window.location.href = 'dashboard.html';
    return;
  }

  ensureProfile();
  registerVisitor();
  if (pageId === 'onboarding') return initOnboarding();
  if (pageId === 'subjects') return initSubjects();
  if (pageId === 'profile') return initProfile();
  if (pageId === 'signup') return initSignup();
}

document.addEventListener('DOMContentLoaded', initPage);
