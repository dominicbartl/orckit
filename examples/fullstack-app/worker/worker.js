const redis = require('redis');
const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Redis connection
let redisClient;
let subscriber;

async function initializeWorker() {
  // Create Redis clients
  redisClient = redis.createClient({
    url: process.env.REDIS_URL,
  });

  subscriber = redisClient.duplicate();

  redisClient.on('error', (err) => console.error('Redis Client Error:', err));
  subscriber.on('error', (err) => console.error('Redis Subscriber Error:', err));

  redisClient.on('connect', () => console.log('✅ Worker connected to Redis'));
  subscriber.on('connect', () => console.log('✅ Worker subscriber connected to Redis'));

  await redisClient.connect();
  await subscriber.connect();

  console.log('🚀 Worker queue started successfully');
  console.log('   Listening for jobs on queue...');

  // Subscribe to job queue
  await subscriber.subscribe('jobs', async (message) => {
    try {
      const job = JSON.parse(message);
      await processJob(job);
    } catch (error) {
      console.error('Error processing job:', error);
    }
  });

  // Start periodic tasks
  startPeriodicTasks();
}

async function processJob(job) {
  console.log(`📋 Processing job: ${job.type}`, job);

  switch (job.type) {
    case 'send-email':
      await sendEmail(job.data);
      break;
    case 'generate-report':
      await generateReport(job.data);
      break;
    case 'cleanup-cache':
      await cleanupCache(job.data);
      break;
    default:
      console.warn(`Unknown job type: ${job.type}`);
  }

  console.log(`✅ Completed job: ${job.type}`);
}

async function sendEmail(data) {
  // Simulate email sending
  console.log(`📧 Sending email to: ${data.to}`);
  await sleep(1000);
  console.log(`   Subject: ${data.subject}`);
}

async function generateReport(data) {
  // Simulate report generation
  console.log(`📊 Generating ${data.reportType} report`);
  await sleep(2000);

  // Store result in cache
  const reportData = {
    reportType: data.reportType,
    generatedAt: new Date().toISOString(),
    data: {
      // Mock report data
      totalRecords: Math.floor(Math.random() * 1000),
      summary: 'Report generated successfully',
    },
  };

  await redisClient.setEx(
    `report:${data.reportType}:${Date.now()}`,
    3600,
    JSON.stringify(reportData)
  );
}

async function cleanupCache(data) {
  // Simulate cache cleanup
  console.log('🧹 Cleaning up expired cache entries');
  await sleep(500);

  const pattern = data.pattern || '*';
  // In production, you'd use SCAN instead of KEYS
  const keys = await redisClient.keys(pattern);
  console.log(`   Found ${keys.length} keys matching pattern: ${pattern}`);
}

function startPeriodicTasks() {
  // Run periodic tasks
  setInterval(async () => {
    try {
      console.log('⏰ Running periodic task: health check');

      // Check database connection
      await pool.query('SELECT 1');

      // Update worker status in Redis
      await redisClient.setEx(
        'worker:status',
        60,
        JSON.stringify({
          status: 'healthy',
          lastCheck: new Date().toISOString(),
          uptime: process.uptime(),
        })
      );
    } catch (error) {
      console.error('Error in periodic task:', error);
    }
  }, 30000); // Every 30 seconds

  // Simulate processing some background jobs
  setInterval(async () => {
    const jobTypes = ['send-email', 'generate-report', 'cleanup-cache'];
    const randomType = jobTypes[Math.floor(Math.random() * jobTypes.length)];

    const job = {
      type: randomType,
      data: {
        to: 'user@example.com',
        subject: 'Test Email',
        reportType: 'monthly-sales',
        pattern: 'temp:*',
      },
    };

    await processJob(job);
  }, 45000); // Every 45 seconds
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Graceful shutdown
async function shutdown() {
  console.log('SIGTERM received, shutting down worker...');

  try {
    if (subscriber) {
      await subscriber.unsubscribe();
      await subscriber.quit();
    }

    if (redisClient) {
      await redisClient.quit();
    }

    if (pool) {
      await pool.end();
    }

    console.log('✅ Worker shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the worker
initializeWorker().catch((error) => {
  console.error('Failed to initialize worker:', error);
  process.exit(1);
});
