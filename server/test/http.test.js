import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { requestWithRetry, UpstreamError } from '../src/lib/http.js';

vi.mock('axios', () => ({ default: vi.fn() }));

const httpError = (status, headers = {}) => Object.assign(new Error(`status ${status}`), { response: { status, headers } });

describe('requestWithRetry', () => {
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };

  beforeEach(() => {
    sleeps.length = 0;
    axios.mockReset();
  });

  it('retries 5xx with exponential backoff and returns the eventual success', async () => {
    axios.mockRejectedValueOnce(httpError(503)).mockRejectedValueOnce(httpError(502)).mockResolvedValueOnce({ data: 'ok' });
    const res = await requestWithRetry({ url: '/x' }, { sleep, random: () => 1, baseDelayMs: 100 });
    expect(res.data).toBe('ok');
    expect(sleeps).toEqual([100, 200]);
  });

  it('honors Retry-After on 429', async () => {
    axios.mockRejectedValueOnce(httpError(429, { 'retry-after': '3' })).mockResolvedValueOnce({ data: 'ok' });
    await requestWithRetry({ url: '/x' }, { sleep, random: () => 1 });
    expect(sleeps).toEqual([3000]);
  });

  it('does not retry 4xx client errors', async () => {
    axios.mockRejectedValueOnce(httpError(404));
    await expect(requestWithRetry({ url: '/x' }, { sleep, upstream: 'tm' })).rejects.toBeInstanceOf(UpstreamError);
    expect(axios).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('gives up after the configured number of retries', async () => {
    axios.mockRejectedValue(httpError(500));
    await expect(requestWithRetry({ url: '/x' }, { sleep, retries: 2 })).rejects.toMatchObject({ status: 500, retryable: true });
    expect(axios).toHaveBeenCalledTimes(3);
  });
});
