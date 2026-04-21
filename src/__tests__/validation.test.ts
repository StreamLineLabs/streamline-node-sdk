import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateTopicName, calculateExponentialBackoff, StreamlineError } from '../types';
import { Producer } from '../producer';
import { Consumer } from '../consumer';
import { Admin } from '../admin';
import { Streamline } from '../client';

describe('validateTopicName', () => {
  it('accepts valid topic names', () => {
    expect(() => validateTopicName('my-topic')).not.toThrow();
    expect(() => validateTopicName('my.topic')).not.toThrow();
    expect(() => validateTopicName('my_topic')).not.toThrow();
    expect(() => validateTopicName('MyTopic123')).not.toThrow();
    expect(() => validateTopicName('a')).not.toThrow();
    expect(() => validateTopicName('topic.with.dots-and_underscores')).not.toThrow();
  });

  it('rejects empty topic name', () => {
    expect(() => validateTopicName('')).toThrow(StreamlineError);
    try {
      validateTopicName('');
    } catch (err) {
      expect((err as StreamlineError).code).toBe('INVALID_TOPIC');
    }
  });

  it('rejects topic name exceeding 249 characters', () => {
    const longName = 'a'.repeat(250);
    expect(() => validateTopicName(longName)).toThrow(StreamlineError);
    try {
      validateTopicName(longName);
    } catch (err) {
      expect((err as StreamlineError).code).toBe('INVALID_TOPIC');
      expect((err as StreamlineError).message).toContain('249');
    }
  });

  it('accepts topic name at exactly 249 characters', () => {
    const maxName = 'a'.repeat(249);
    expect(() => validateTopicName(maxName)).not.toThrow();
  });

  it('rejects "." as topic name', () => {
    expect(() => validateTopicName('.')).toThrow(StreamlineError);
    try {
      validateTopicName('.');
    } catch (err) {
      expect((err as StreamlineError).code).toBe('INVALID_TOPIC');
    }
  });

  it('rejects ".." as topic name', () => {
    expect(() => validateTopicName('..')).toThrow(StreamlineError);
    try {
      validateTopicName('..');
    } catch (err) {
      expect((err as StreamlineError).code).toBe('INVALID_TOPIC');
    }
  });

  it('rejects topic names with spaces', () => {
    expect(() => validateTopicName('my topic')).toThrow(StreamlineError);
  });

  it('rejects topic names with special characters', () => {
    expect(() => validateTopicName('topic!')).toThrow(StreamlineError);
    expect(() => validateTopicName('topic@name')).toThrow(StreamlineError);
    expect(() => validateTopicName('topic/name')).toThrow(StreamlineError);
    expect(() => validateTopicName('topic#name')).toThrow(StreamlineError);
  });
});

describe('calculateExponentialBackoff', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns base backoff on first attempt with max jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const result = calculateExponentialBackoff(100, 0, 30000);
    // 100 * 2^0 = 100, jitter = 0.5 + 1 * 0.5 = 1.0
    expect(result).toBe(100);
  });

  it('doubles backoff on each attempt', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const attempt0 = calculateExponentialBackoff(100, 0, 30000);
    const attempt1 = calculateExponentialBackoff(100, 1, 30000);
    const attempt2 = calculateExponentialBackoff(100, 2, 30000);
    expect(attempt0).toBe(100);
    expect(attempt1).toBe(200);
    expect(attempt2).toBe(400);
  });

  it('caps at maxMs', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const result = calculateExponentialBackoff(100, 20, 500);
    expect(result).toBe(500);
  });

  it('applies jitter in range [0.5, 1.0]', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const low = calculateExponentialBackoff(100, 0, 30000);
    // jitter = 0.5 + 0 * 0.5 = 0.5
    expect(low).toBe(50);

    vi.spyOn(Math, 'random').mockReturnValue(1);
    const high = calculateExponentialBackoff(100, 0, 30000);
    // jitter = 0.5 + 1 * 0.5 = 1.0
    expect(high).toBe(100);
  });

  it('never exceeds maxMs even with full jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const result = calculateExponentialBackoff(1000, 10, 5000);
    expect(result).toBeLessThanOrEqual(5000);
  });
});

describe('topic validation in Producer', () => {
  let mockClient: Streamline;

  it('rejects invalid topic name in constructor', () => {
    mockClient = new Streamline('localhost:9092');
    expect(() => new Producer(mockClient, '')).toThrow(StreamlineError);
    expect(() => new Producer(mockClient, '.')).toThrow(StreamlineError);
    expect(() => new Producer(mockClient, '..')).toThrow(StreamlineError);
    expect(() => new Producer(mockClient, 'invalid topic!')).toThrow(StreamlineError);
  });
});

describe('topic validation in Consumer', () => {
  let mockClient: Streamline;

  it('rejects invalid topic name in constructor', () => {
    mockClient = new Streamline('localhost:9092');
    expect(() => new Consumer(mockClient, '')).toThrow(StreamlineError);
    expect(() => new Consumer(mockClient, '.')).toThrow(StreamlineError);
    expect(() => new Consumer(mockClient, '..')).toThrow(StreamlineError);
    expect(() => new Consumer(mockClient, 'topic with spaces')).toThrow(StreamlineError);
  });
});

describe('topic validation in Admin', () => {
  let mockClient: Streamline;
  let admin: Admin;

  it('rejects invalid topic name in createTopic', async () => {
    mockClient = new Streamline('localhost:9092');
    admin = new Admin(mockClient);
    await expect(admin.createTopic('')).rejects.toThrow(StreamlineError);
    await expect(admin.createTopic('.')).rejects.toThrow(StreamlineError);
    await expect(admin.createTopic('..')).rejects.toThrow(StreamlineError);
    await expect(admin.createTopic('bad topic!')).rejects.toThrow(StreamlineError);
  });

  it('rejects invalid topic name in deleteTopic', async () => {
    mockClient = new Streamline('localhost:9092');
    admin = new Admin(mockClient);
    await expect(admin.deleteTopic('')).rejects.toThrow(StreamlineError);
    await expect(admin.deleteTopic('.')).rejects.toThrow(StreamlineError);
  });
});
