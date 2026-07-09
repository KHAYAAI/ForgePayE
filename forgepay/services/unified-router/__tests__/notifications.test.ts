/**
 * Tests for the Slack/CRM notification helpers.
 * Verifies the safe-no-op-when-unconfigured contract and successful delivery.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function freshImport() {
  vi.resetModules();
  return import('../src/lib/notifications.js');
}

describe('sendSlackAlert', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it('returns false and does not call fetch when SLACK_WEBHOOK_URL is unset', async () => {
    delete process.env['SLACK_WEBHOOK_URL'];
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { sendSlackAlert } = await freshImport();

    const result = await sendSlackAlert('test message');

    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts to the webhook URL and returns true on success', async () => {
    process.env['SLACK_WEBHOOK_URL'] = 'https://hooks.slack.test/webhook';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    const { sendSlackAlert } = await freshImport();

    const result = await sendSlackAlert('churn risk!', { channel: '#csm' });

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://hooks.slack.test/webhook');
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe('churn risk!');
    expect(body.channel).toBe('#csm');
  });

  it('returns false when the webhook responds with a non-2xx status', async () => {
    process.env['SLACK_WEBHOOK_URL'] = 'https://hooks.slack.test/webhook';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { sendSlackAlert } = await freshImport();

    expect(await sendSlackAlert('test')).toBe(false);
  });

  it('returns false when fetch throws', async () => {
    process.env['SLACK_WEBHOOK_URL'] = 'https://hooks.slack.test/webhook';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { sendSlackAlert } = await freshImport();

    expect(await sendSlackAlert('test')).toBe(false);
  });
});

describe('createCrmTask', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  const task = {
    subjectId: 'cust_123',
    title: 'Churn risk',
    description: 'High risk churn signal',
    priority: 'high' as const,
    tags: ['churn'],
  };

  it('returns false and does not call fetch when CRM_WEBHOOK_URL is unset', async () => {
    delete process.env['CRM_WEBHOOK_URL'];
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { createCrmTask } = await freshImport();

    expect(await createCrmTask(task)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts the task with Bearer auth when CRM_API_KEY is set', async () => {
    process.env['CRM_WEBHOOK_URL'] = 'https://crm.test/tasks';
    process.env['CRM_API_KEY'] = 'secret-key';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    const { createCrmTask } = await freshImport();

    const result = await createCrmTask(task);

    expect(result).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://crm.test/tasks');
    expect(init.headers.authorization).toBe('Bearer secret-key');
    expect(JSON.parse(init.body as string)).toMatchObject(task);
  });

  it('omits the authorization header when CRM_API_KEY is unset', async () => {
    process.env['CRM_WEBHOOK_URL'] = 'https://crm.test/tasks';
    delete process.env['CRM_API_KEY'];
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    const { createCrmTask } = await freshImport();

    await createCrmTask(task);

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.authorization).toBeUndefined();
  });

  it('returns false when the CRM webhook responds with a non-2xx status', async () => {
    process.env['CRM_WEBHOOK_URL'] = 'https://crm.test/tasks';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    const { createCrmTask } = await freshImport();

    expect(await createCrmTask(task)).toBe(false);
  });
});
