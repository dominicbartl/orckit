const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const redis = require('redis');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Redis connection
let redisClient;
(async () => {
  redisClient = redis.createClient({
    url: process.env.REDIS_URL,
  });

  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  redisClient.on('connect', () => console.log('✅ Connected to Redis'));

  await redisClient.connect();
})();

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await pool.query('SELECT 1');

    // Check Redis connection
    await redisClient.ping();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected',
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});

// Sample API endpoints
app.get('/api/users', async (req, res) => {
  try {
    // Try to get from cache first
    const cached = await redisClient.get('users');
    if (cached) {
      return res.json({
        source: 'cache',
        data: JSON.parse(cached),
      });
    }

    // Mock data (in real app, this would query the database)
    const users = [
      { id: 1, name: 'Alice Johnson', role: 'admin' },
      { id: 2, name: 'Bob Smith', role: 'user' },
      { id: 3, name: 'Charlie Brown', role: 'user' },
    ];

    // Cache the result
    await redisClient.setEx('users', 60, JSON.stringify(users));

    res.json({
      source: 'database',
      data: users,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = {
      totalUsers: 156,
      activeUsers: 42,
      totalRevenue: 125430.50,
      newSignups: 12,
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { name, role } = req.body;

    // In a real app, this would insert into the database
    const newUser = {
      id: Date.now(),
      name,
      role: role || 'user',
      createdAt: new Date().toISOString(),
    };

    // Invalidate cache
    await redisClient.del('users');

    res.status(201).json(newUser);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize database tables
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   API endpoints: http://localhost:${PORT}/api`);

  await initializeDatabase();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await pool.end();
  await redisClient.quit();
  process.exit(0);
});
