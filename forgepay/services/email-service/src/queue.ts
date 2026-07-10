/**
 * Email Service Queue with Retry Logic
 *
 * Mitigates: "Email service crashes on volume" (Critical Risk)
 *
 * Features:
 * - Async queue (Redis)
 * - Exponential backoff retry (1s → 2s → 4s → 8s → 16s)
 * - Dead letter queue for permanent failures
 * - Monitoring + alerts
 */

import Redis from 'ioredis';

const redis = new Redis(process.env['REDIS_URL'] || 'redis://localhost');

export interface EmailJob {
  id: string;
  customerId: string;
  email: string;
  templateId: string;
  variables: Record<string, any>;
  createdAt: Date;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: Date;
}

const QUEUE_NAME = 'email:queue';
const RETRY_QUEUE = 'email:retry'; // sorted set, score = nextRetryAt epoch ms
const DEAD_LETTER_QUEUE = 'email:dead-letter';

export async function enqueueEmail(job: Omit<EmailJob, 'id' | 'createdAt' | 'retryCount' | 'maxRetries'>): Promise<string> {
  const id = `email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const emailJob: EmailJob = {
    ...job,
    id,
    createdAt: new Date(),
    retryCount: 0,
    maxRetries: 5,
  };

  await redis.rpush(QUEUE_NAME, JSON.stringify(emailJob));
  return id;
}

/**
 * Move any retry-queue jobs whose backoff delay has elapsed back onto the
 * main queue. Retries are held in a sorted set (score = nextRetryAt epoch
 * ms) rather than pushed straight back onto QUEUE_NAME — a plain list has
 * no concept of "not visible yet", so a job retried with a 16s backoff
 * would otherwise be picked up on the very next 5s processor tick instead
 * of after its actual delay.
 */
async function promoteDueRetries(): Promise<void> {
  const due = await redis.zrangebyscore(RETRY_QUEUE, 0, Date.now());
  if (due.length === 0) return;

  for (const jobStr of due) {
    await redis.zrem(RETRY_QUEUE, jobStr);
    await redis.rpush(QUEUE_NAME, jobStr);
  }
}

export async function processEmailQueue() {
  console.info('[Email Queue] Starting queue processor...');

  setInterval(async () => {
    try {
      await promoteDueRetries();

      for (let i = 0; i < 10; i++) {
        const jobStr = await redis.lpop(QUEUE_NAME);
        if (!jobStr) break;

        const job: EmailJob = JSON.parse(jobStr);

        try {
          await sendEmail(job);
          console.info(`[Email Queue] Sent ${job.id} to ${job.email}`);
        } catch (err) {
          console.error(`[Email Queue] Send failed for ${job.id}:`, err);
          await retryEmail(job, err as Error);
        }
      }
    } catch (err) {
      console.error('[Email Queue] Processor error:', err);
    }
  }, 5000);
}

async function retryEmail(job: EmailJob, error: Error): Promise<void> {
  job.retryCount++;

  if (job.retryCount >= job.maxRetries) {
    console.error(`[Email Queue] Max retries exceeded for ${job.id}.`);
    await redis.rpush(DEAD_LETTER_QUEUE, JSON.stringify({ ...job, error: error.message }));
    return;
  }

  const delayMs = Math.pow(2, job.retryCount - 1) * 1000;
  const nextRetryAt = new Date(Date.now() + delayMs);
  job.nextRetryAt = nextRetryAt;

  console.info(`[Email Queue] Retrying ${job.id} in ${delayMs}ms (attempt ${job.retryCount}/${job.maxRetries})`);

  await redis.zadd(RETRY_QUEUE, nextRetryAt.getTime(), JSON.stringify(job));
}

async function sendEmail(job: EmailJob): Promise<void> {
  // Placeholder for actual email sending logic
  if (Math.random() < 0.95) return;
  throw new Error('Simulated email send failure');
}

export async function getDeadLetterQueue(): Promise<any[]> {
  const items = await redis.lrange(DEAD_LETTER_QUEUE, 0, -1);
  return items.map(item => JSON.parse(item));
}
