/**
 * Negotiation logic — session creation, message routing, expiry, and term agreement.
 */

import { v4 as uuidv4 } from 'uuid';
import type { NegotiationSession, NegotiationMessage, NegotiationTerm, MessageRole } from './types';
import { getSession, setSession } from './store';

const DEFAULT_MAX_ROUNDS    = 10;
const SESSION_TTL_HOURS     = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isExpired(session: NegotiationSession): boolean {
  return new Date(session.expiresAt) < new Date();
}

function terminalStatuses(): NegotiationSession['status'][] {
  return ['accepted', 'rejected', 'expired', 'settled', 'disputed'];
}

// ── Create Session ────────────────────────────────────────────────────────────

export interface CreateSessionOptions {
  initiatorAgentId: string;
  responderAgentId: string;
  subject:          string;
  initialTerms:     NegotiationTerm[];
  maxRounds?:       number;
}

export function createSession(opts: CreateSessionOptions): NegotiationSession {
  const now      = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const id       = uuidv4();
  const nowIso   = now.toISOString();

  const firstMessage: NegotiationMessage = {
    id:          uuidv4(),
    sessionId:   id,
    fromAgentId: opts.initiatorAgentId,
    toAgentId:   opts.responderAgentId,
    role:        'offer',
    terms:       opts.initialTerms,
    timestamp:   nowIso,
  };

  const session: NegotiationSession = {
    id,
    initiatorAgentId: opts.initiatorAgentId,
    responderAgentId: opts.responderAgentId,
    subject:          opts.subject,
    status:           'active',
    messages:         [firstMessage],
    totalRounds:      1,
    maxRounds:        opts.maxRounds ?? DEFAULT_MAX_ROUNDS,
    createdAt:        nowIso,
    updatedAt:        nowIso,
    expiresAt:        expiresAt.toISOString(),
  };

  setSession(session);
  return session;
}

// ── Add Message ───────────────────────────────────────────────────────────────

export interface AddMessageOptions {
  fromAgentId:      string;
  role:             MessageRole;
  terms:            NegotiationTerm[];
  message?:         string;
  expiresInSeconds?: number;
}

export interface AddMessageResult {
  session: NegotiationSession;
  msg:     NegotiationMessage;
  error?:  string;
}

export function addMessage(
  sessionId: string,
  opts:      AddMessageOptions
): AddMessageResult | { error: string } {
  const session = getSession(sessionId);
  if (!session) return { error: `Session ${sessionId} not found` };

  // Check expiry
  if (isExpired(session)) {
    const expired = { ...session, status: 'expired' as const, updatedAt: new Date().toISOString() };
    setSession(expired);
    return { error: 'Session has expired' };
  }

  // Check terminal status
  if (terminalStatuses().includes(session.status)) {
    return { error: `Session is already in terminal state: ${session.status}` };
  }

  // Validate sender is a participant
  if (opts.fromAgentId !== session.initiatorAgentId && opts.fromAgentId !== session.responderAgentId) {
    return { error: `Agent ${opts.fromAgentId} is not a participant in session ${sessionId}` };
  }

  const now = new Date().toISOString();

  const msg: NegotiationMessage = {
    id:              uuidv4(),
    sessionId,
    fromAgentId:     opts.fromAgentId,
    toAgentId:       opts.fromAgentId === session.initiatorAgentId
                       ? session.responderAgentId
                       : session.initiatorAgentId,
    role:            opts.role,
    terms:           opts.terms,
    message:         opts.message,
    expiresInSeconds: opts.expiresInSeconds,
    timestamp:       now,
  };

  // Determine new session status
  let newStatus: NegotiationSession['status'] = 'active';
  let agreedTerms: NegotiationTerm[] | undefined = session.agreedTerms;

  if (opts.role === 'accept') {
    newStatus  = 'accepted';
    agreedTerms = opts.terms;
  } else if (opts.role === 'reject' || opts.role === 'cancel') {
    newStatus = 'rejected';
  } else if (opts.role === 'settle') {
    newStatus = 'settled';
  }

  const newTotalRounds = session.totalRounds + 1;

  // Auto-reject if rounds exceeded (only for non-terminal messages)
  let finalStatus = newStatus;
  if (newStatus === 'active' && newTotalRounds > session.maxRounds) {
    finalStatus = 'rejected';
    msg.message = (msg.message ? msg.message + ' | ' : '') + `[Auto-rejected: exceeded maxRounds (${session.maxRounds})]`;
  }

  const updatedSession: NegotiationSession = {
    ...session,
    status:      finalStatus,
    messages:    [...session.messages, msg],
    agreedTerms,
    totalRounds: newTotalRounds,
    updatedAt:   now,
  };

  setSession(updatedSession);
  return { session: updatedSession, msg };
}

// ── Get Agreed Terms ──────────────────────────────────────────────────────────

export function getAgreedTerms(sessionId: string): NegotiationTerm[] | { error: string } {
  const session = getSession(sessionId);
  if (!session) return { error: `Session ${sessionId} not found` };
  if (session.status !== 'accepted' && session.status !== 'settled') {
    return { error: `Session is not accepted (current status: ${session.status})` };
  }
  return session.agreedTerms ?? [];
}
