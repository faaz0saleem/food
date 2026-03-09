const jwt = require('jsonwebtoken');

const signAccessToken = (admin) => {
  return jwt.sign({ sub: admin.username, role: 'admin' }, process.env.JWT_SECRET || 'replace-me', {
    expiresIn: '15m'
  });
};

const signRefreshToken = (admin) => {
  return jwt.sign({ sub: admin.username, role: 'admin', type: 'refresh' }, process.env.JWT_SECRET || 'replace-me', {
    expiresIn: '7d'
  });
};

module.exports = { signAccessToken, signRefreshToken };
