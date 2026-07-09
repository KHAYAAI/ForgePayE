/**
 * Outbound Slack + CRM notifications for CSM-facing signals (churn risk,
 * stuck onboarding, etc).
 *
 * Both helpers are safe no-ops with a logged warning when their target env
 * var isn't configured — churn/onboarding detection must never throw or
 * block just because ops hasn't wired up Slack/CRM yet in a given
 * environment (dev, a fresh deploy before secrets are set, etc).
 */

import { logger } from './logger.js';

const SLACK_WEBHOOK_URL = process.env['SLACK_WEBHOOK_URL'] ?? '';
const CRM_WEBHOOK_URL = process.env['CRM_WEBHOOK_URL'] ?? '';
const CRM_API_KEY = process.env['CRM_API_KEY'] ?? '';
const FETCH_TIMEOUT_MS = 8_000;

export interface SlackAlertOptions {
  /** Overrides the channel baked into the Slack webhook, if the webhook supports it. */
  channel?: string;
  /** Slack "blocks" for richer formatting; falls back to plain `text` if omitted. */
  blocks?: unknown[];
}

/**
 * Posts a message to Slack via an Incoming Webhook. Returns true if the
 * message was actually delivered (false on missing config or delivery
 * failure — callers should treat notification delivery as best-effort,
 * never as a reason to fail the underlying business operation).
 */
export async function sendSlackAlert(text: string, options: SlackAlertOptions = {}): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) {
    logger.warn({ text }, '[notifications] SLACK_WEBHOOK_URL not set — Slack alert not sent');
    return false;
  }
  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        ...(options.channel ? { channel: options.channel } : {}),
        ...(options.blocks ? { blocks: options.blocks } : {}),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.error({ status: res.status, text }, '[notifications] Slack webhook rejected the alert');
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, text }, '[notifications] Slack webhook delivery failed');
    return false;
  }
}

export interface CrmTaskInput {
  /** Customer/agent this task is about. */
  subjectId: string;
  /** Short task title, e.g. "High churn risk — cust_123". */
  title: string;
  /** Longer description / context for the assignee. */
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  /** Free-form tags for CRM-side routing/filtering, e.g. ['churn', 'payments']. */
  tags?: string[];
}

/**
 * Creates a task in the CRM via a generic webhook contract: POST the task
 * payload, Bearer-authenticated with CRM_API_KEY. This is intentionally
 * generic (not Salesforce/HubSpot-specific) — CRM_WEBHOOK_URL is expected to
 * point at a thin adapter (e.g. a Zapier/Make webhook, or an internal
 * function) that translates this shape into the real CRM's API. Returns
 * true if the task was created; false on missing config or failure.
 */
export async function createCrmTask(task: CrmTaskInput): Promise<boolean> {
  if (!CRM_WEBHOOK_URL) {
    logger.warn({ task }, '[notifications] CRM_WEBHOOK_URL not set — CRM task not created');
    return false;
  }
  try {
    const res = await fetch(CRM_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(CRM_API_KEY ? { authorization: `Bearer ${CRM_API_KEY}` } : {}),
      },
      body: JSON.stringify(task),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.error({ status: res.status, task }, '[notifications] CRM webhook rejected the task');
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, task }, '[notifications] CRM webhook delivery failed');
    return false;
  }
}
