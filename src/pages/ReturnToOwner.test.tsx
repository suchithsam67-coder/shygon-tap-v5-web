import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import ReturnToOwner from './ReturnToOwner';

/** The owner's Return-to-Owner inbox against AAROH-API v0.2 §10a response shapes. */

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }) } },
}));
vi.mock('../components/app/AppShell', () => ({
  AppShell: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

type Reply = { status: number; body: unknown };
let handler: (op: string, body: Record<string, unknown>) => Reply;
const calls: Record<string, unknown>[] = [];

const settings = { enabled: true, publicHint: null, changedAt: null, publicTapPublished: true, openThreads: 1, unread: 1, relayAllowed: false };
const summary = { id: 't1', status: 'open', createdAt: '2026-10-19T10:00:00Z', lastActivityAt: '2026-10-19T10:00:00Z', closedAt: null, reportedAt: null, unread: 1, messages: 1, preview: 'Found your card' };
const thread = (over = {}) => ({
  id: 't1',
  status: 'open',
  createdAt: '2026-10-19T10:00:00Z',
  lastActivityAt: '2026-10-19T10:00:00Z',
  closedAt: null,
  reportedAt: null,
  finderCanWrite: true,
  messages: [{ id: 'm1', from: 'finder', body: 'Found your card near the station.', at: '2026-10-19T10:00:00Z' }],
  ...over,
});
const base = (op: string): Reply =>
  op === 'settings.get'
    ? { status: 200, body: { settings } }
    : op === 'threads.list'
      ? { status: 200, body: { threads: [summary] } }
      : op === 'threads.get'
        ? { status: 200, body: { thread: thread() } }
        : { status: 500, body: { error: { code: 'unexpected', message: `unexpected ${op}` } } };

beforeEach(() => {
  calls.length = 0;
  handler = (op) => base(op);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/rescue');
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const reply = handler(body.op, body);
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = () =>
  render(
    <MemoryRouter>
      <ReturnToOwner />
    </MemoryRouter>,
  );

describe('Return to owner inbox', () => {
  it('says honestly that the relay is not switched on by SHYGON yet', async () => {
    show();
    expect(await screen.findByText(/SHYGON has not switched the relay on yet/)).toBeTruthy();
  });

  it('a failed reply stays in the box to retry with the same key; a confirmed one clears it', async () => {
    let n = 0;
    handler = (op, body) => {
      if (op !== 'threads.reply') return base(op);
      n += 1;
      return n === 1
        ? { status: 409, body: { error: { code: 'thread_closed', message: 'This conversation is closed.' } } }
        : { status: 200, body: { thread: thread({ status: 'owner_replied', messages: [...thread().messages, { id: 'm2', from: 'owner', body: String(body.message), at: '2026-10-19T10:05:00Z' }] }), replayed: false } };
    };
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Waiting for your reply/ }));
    const box = await screen.findByLabelText(/^Your reply/);
    fireEvent.change(box, { target: { value: 'Thank you, I will collect it.' } });
    fireEvent.click(screen.getByRole('button', { name: /Send reply/ }));
    expect(await screen.findByText('This conversation is closed.')).toBeTruthy();
    expect((box as HTMLTextAreaElement).value).toBe('Thank you, I will collect it.');
    fireEvent.click(screen.getByRole('button', { name: /Send reply/ }));
    await waitFor(() => expect((screen.getByLabelText(/^Your reply/) as HTMLTextAreaElement).value).toBe(''));
    const replies = calls.filter((c) => c.op === 'threads.reply');
    expect(replies[0]!.clientKey).toBe(replies[1]!.clientKey);
  });

  it('blocking asks first, then sends one block', async () => {
    handler = (op) => (op === 'threads.block' ? { status: 200, body: { thread: thread({ status: 'blocked' }) } } : base(op));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Waiting for your reply/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Block' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/cannot message you again for 90 days/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Block' }));
    expect(await screen.findByText(/Blocked\. No more messages can be sent here\./)).toBeTruthy();
    expect(calls.filter((c) => c.op === 'threads.block')).toEqual([{ op: 'threads.block', threadId: 't1' }]);
  });
});
