const jwt = require('jsonwebtoken');

const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Missing admin token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'replace-me');
    if (payload.role !== 'admin') {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    req.admin = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

module.exports = { authenticateAdmin };
