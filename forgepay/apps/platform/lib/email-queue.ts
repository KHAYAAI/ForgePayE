import { createClient, RedisClientType } from 'redis';
import { sendEmail } from './email';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = 'email:queue';
const DEAD_LETTER_QUEUE = 'email:dlq';
const QUEUE_PROCESSING_KEY = 'email:processing';

interface QueuedEmail {
  id: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  retries: number;
  createdAt: number;
  nextRetryAt?: number;
}

export class EmailQueue {
  private client: RedisClientType;
  private isProcessing = false;

  constructor() {
    this.client = createClient({ url: REDIS_URL });
  }

  async connect() {
    await this.client.connect();
    console.log('[Email Queue] Connected to Redis');
  }

  async disconnect() {
    await this.client.disconnect();
    console.log('[Email Queue] Disconnected from Redis');
  }

  async enqueueEmail(
    to: string,
    subject: string,
    html: string,
    text?: string
  ): Promise<string> {
    const emailId = `email-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const email: QueuedEmail = {
      id: emailId,
      to,
      subject,
      html,
      text,
      retries: 0,
      createdAt: Date.now(),
    };

    // Add to queue (max 1000 emails queued at once)
    await this.client.rPush(QUEUE_NAME, JSON.stringify(email));

    console.log(`[Email Queue] Enqueued: ${emailId} to ${to}`);
    return emailId;
  }

  async processQueue(maxConcurrent: number = 10) {
    if (this.isProcessing) {
      console.log('[Email Queue] Already processing, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      let processed = 0;
      const batchSize = Math.min(maxConcurrent, 10); // Max 10 emails per 5 seconds

      while (true) {
        const emails: string[] = [];

        // Pop up to batchSize emails from queue
        for (let i = 0; i < batchSize; i++) {
          const emailStr = await this.client.lPop(QUEUE_NAME);
          if (!emailStr) break;
          emails.push(emailStr);
        }

        if (emails.length === 0) break;

        // Process in parallel
        await Promise.all(
          emails.map((emailStr) => this.processEmail(emailStr))
        );

        processed += emails.length;

        // Rate limit: 10 emails every 5 seconds
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      console.log(`[Email Queue] Processed ${processed} emails`);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processEmail(emailStr: string) {
    try {
      const email: QueuedEmail = JSON.parse(emailStr);

      // Check if should retry or send
      if (email.nextRetryAt && email.nextRetryAt > Date.now()) {
        // Re-queue for later
        await this.client.rPush(QUEUE_NAME, emailStr);
        return;
      }

      // Send email
      const success = await sendEmail({
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      if (success) {
        console.log(`[Email Queue] ✅ Sent: ${email.id}`);
        return;
      }

      // If failed, retry with exponential backoff
      email.retries++;

      if (email.retries >= 5) {
        // 5 retries exhausted, move to DLQ
        console.error(`[Email Queue] ❌ DLQ: ${email.id} (5 retries failed)`);
        await this.client.rPush(DEAD_LETTER_QUEUE, JSON.stringify(email));
        return;
      }

      // Calculate backoff: 1s, 2s, 4s, 8s, 16s
      const backoffSeconds = Math.pow(2, email.retries - 1);
      email.nextRetryAt = Date.now() + backoffSeconds * 1000;

      console.log(
        `[Email Queue] 🔄 Retry ${email.retries}: ${email.id} in ${backoffSeconds}s`
      );
      await this.client.rPush(QUEUE_NAME, JSON.stringify(email));
    } catch (error) {
      console.error('[Email Queue] Process error:', error);
    }
  }

  async getQueueDepth(): Promise<number> {
    return this.client.lLen(QUEUE_NAME);
  }

  async getDeadLetterQueue(): Promise<QueuedEmail[]> {
    const emails = await this.client.lRange(DEAD_LETTER_QUEUE, 0, -1);
    return emails.map((e) => JSON.parse(e));
  }

  async clearDeadLetterQueue(): Promise<void> {
    await this.client.del(DEAD_LETTER_QUEUE);
    console.log('[Email Queue] Cleared DLQ');
  }

  async getMetrics() {
    const queueDepth = await this.getQueueDepth();
    const dlqCount = await this.client.lLen(DEAD_LETTER_QUEUE);

    return {
      queueDepth,
      deadLetterCount: dlqCount,
      isProcessing: this.isProcessing,
    };
  }
}

// Singleton instance
let emailQueue: EmailQueue | null = null;

export async function getEmailQueue(): Promise<EmailQueue> {
  if (!emailQueue) {
    emailQueue = new EmailQueue();
    await emailQueue.connect();
  }
  return emailQueue;
}

// Start processing every 5 seconds (10 emails/batch)
export async function startEmailQueueProcessor() {
  const queue = await getEmailQueue();

  setInterval(async () => {
    try {
      await queue.processQueue(10);
    } catch (error) {
      console.error('[Email Processor] Error:', error);
    }
  }, 5000); // Process every 5 seconds

  console.log('[Email Processor] Started (10 emails every 5 seconds)');
}
