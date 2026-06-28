/**
 * Support Ticket Monitoring & Escalation
 *
 * Mitigates: "Support team overwhelmed (>50 tickets/day)" (High Risk)
 *
 * Monitors:
 * - Ticket volume per day
 * - Average resolution time
 * - Escalation rate
 * - SLA compliance
 */

interface SupportMetrics {
  date: string;
  ticketsCreated: number;
  ticketsResolved: number;
  avgResolutionTimeHours: number;
  escalatedToEng: number;
  escalatedToCSM: number;
  slaBreaches: number;
}

const METRICS: Map<string, SupportMetrics> = new Map();

export async function trackSupportTicket(
  ticketId: string,
  createdAt: Date,
  category: 'payments' | 'treasury' | 'credit-bureau' | 'billing' | 'other',
  priority: 'critical' | 'high' | 'medium' | 'low'
): Promise<void> {
  const dateKey = createdAt.toISOString().split('T')[0];
  const metrics = METRICS.get(dateKey) || {
    date: dateKey,
    ticketsCreated: 0,
    ticketsResolved: 0,
    avgResolutionTimeHours: 0,
    escalatedToEng: 0,
    escalatedToCSM: 0,
    slaBreaches: 0,
  };

  metrics.ticketsCreated++;

  // Alert if >50 tickets in a day
  if (metrics.ticketsCreated > 50) {
    console.warn(
      `[Support Monitor] ALERT: ${metrics.ticketsCreated} tickets created today (>${50 + (metrics.ticketsCreated - 50)} over threshold)`
    );
    await alertOpsTeam(
      `Support team at capacity: ${metrics.ticketsCreated} tickets created today. Consider hiring temp CSM.`
    );
  }

  // Alert if critical ticket
  if (priority === 'critical') {
    console.warn(`[Support Monitor] CRITICAL ticket created: ${ticketId} (${category})`);
    await escalateToEngineering(ticketId, category);
  }

  METRICS.set(dateKey, metrics);
}

export async function trackTicketResolution(
  ticketId: string,
  createdAt: Date,
  resolvedAt: Date,
  resolvedBy: 'support' | 'eng' | 'csm'
): Promise<void> {
  const dateKey = createdAt.toISOString().split('T')[0];
  const metrics = METRICS.get(dateKey) || initializeMetrics(dateKey);

  const resolutionTimeHours = (resolvedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  const slaTimeHours = 24; // SLA: resolve within 24 hours

  metrics.ticketsResolved++;

  if (resolvedBy === 'eng') {
    metrics.escalatedToEng++;
  } else if (resolvedBy === 'csm') {
    metrics.escalatedToCSM++;
  }

  if (resolutionTimeHours > slaTimeHours) {
    metrics.slaBreaches++;
    console.warn(`[Support Monitor] SLA breach: ${ticketId} took ${resolutionTimeHours.toFixed(1)}h (>${slaTimeHours}h)`);
  }

  // Update average resolution time
  const totalTime = metrics.avgResolutionTimeHours * (metrics.ticketsResolved - 1) + resolutionTimeHours;
  metrics.avgResolutionTimeHours = totalTime / metrics.ticketsResolved;

  METRICS.set(dateKey, metrics);
}

export function getMetrics(date?: string): SupportMetrics | Map<string, SupportMetrics> {
  if (date) {
    return METRICS.get(date) || initializeMetrics(date);
  }
  return METRICS;
}

function initializeMetrics(dateKey: string): SupportMetrics {
  return {
    date: dateKey,
    ticketsCreated: 0,
    ticketsResolved: 0,
    avgResolutionTimeHours: 0,
    escalatedToEng: 0,
    escalatedToCSM: 0,
    slaBreaches: 0,
  };
}

async function escalateToEngineering(ticketId: string, category: string): Promise<void> {
  console.info(`[Support Monitor] Escalating ${ticketId} to engineering (${category})`);
  // TODO: Create PagerDuty incident, notify #eng-incidents Slack
}

async function alertOpsTeam(message: string): Promise<void> {
  console.error(`[ALERT] ${message}`);
  // TODO: Send to Slack #ops-alerts, trigger PagerDuty if critical
}

/**
 * Daily report on support metrics
 */
export async function generateDailySupportReport(date: string): Promise<string> {
  const metrics = METRICS.get(date);
  if (!metrics) {
    return `No metrics for ${date}`;
  }

  const report = `
Support Metrics for ${date}:
- Tickets Created: ${metrics.ticketsCreated}
- Tickets Resolved: ${metrics.ticketsResolved}
- Avg Resolution Time: ${metrics.avgResolutionTimeHours.toFixed(1)}h
- Escalated to Engineering: ${metrics.escalatedToEng}
- Escalated to CSM: ${metrics.escalatedToCSM}
- SLA Breaches: ${metrics.slaBreaches}
- Health: ${metrics.ticketsCreated > 50 ? '🔴 OVERLOAD' : metrics.ticketsCreated > 30 ? '🟡 HIGH' : '🟢 NORMAL'}
`;

  return report;
}
