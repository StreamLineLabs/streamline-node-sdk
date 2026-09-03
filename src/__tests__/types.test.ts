import { describe, it, expect } from 'vitest';
import {
  StreamlineError,
  ConnectionError,
  AuthenticationError,
  TopicNotFoundError,
  TimeoutError,
  UnsupportedOperationError,
} from '../types';

describe('StreamlineError', () => {
  it('creates error with defaults', () => {
    const err = new StreamlineError('something went wrong');
    expect(err.message).toBe('something went wrong');
    expect(err.code).toBe('UNKNOWN');
    expect(err.retryable).toBe(false);
    expect(err.cause).toBeUndefined();
    expect(err.name).toBe('StreamlineError');
    expect(err).toBeInstanceOf(Error);
  });

  it('creates error with all properties', () => {
    const cause = new Error('root cause');
    const err = new StreamlineError('fail', 'CUSTOM_CODE', true, cause);
    expect(err.code).toBe('CUSTOM_CODE');
    expect(err.retryable).toBe(true);
    expect(err.cause).toBe(cause);
  });
});

describe('ConnectionError', () => {
  it('sets correct defaults', () => {
    const err = new ConnectionError('cannot connect');
    expect(err.name).toBe('ConnectionError');
    expect(err.code).toBe('CONNECTION_ERROR');
    expect(err.retryable).toBe(true);
    expect(err).toBeInstanceOf(StreamlineError);
    expect(err).toBeInstanceOf(Error);
  });

  it('wraps a cause', () => {
    const cause = new Error('ECONNREFUSED');
    const err = new ConnectionError('failed', cause);
    expect(err.cause).toBe(cause);
  });
});

describe('AuthenticationError', () => {
  it('is not retryable', () => {
    const err = new AuthenticationError('bad credentials');
    expect(err.name).toBe('AuthenticationError');
    expect(err.code).toBe('AUTH_ERROR');
    expect(err.retryable).toBe(false);
  });
});

describe('TopicNotFoundError', () => {
  it('includes topic name', () => {
    const err = new TopicNotFoundError('events');
    expect(err.name).toBe('TopicNotFoundError');
    expect(err.topic).toBe('events');
    expect(err.code).toBe('TOPIC_NOT_FOUND');
    expect(err.message).toContain('events');
    expect(err.retryable).toBe(false);
  });
});

describe('TimeoutError', () => {
  it('is retryable', () => {
    const err = new TimeoutError('operation timed out');
    expect(err.name).toBe('TimeoutError');
    expect(err.code).toBe('TIMEOUT');
    expect(err.retryable).toBe(true);
  });
});

describe('UnsupportedOperationError', () => {
  it('names the operation and is not retryable', () => {
    const err = new UnsupportedOperationError(
      'Consumer.onRebalance',
      'no group protocol',
      'Track assignment() instead',
    );
    expect(err.name).toBe('UnsupportedOperationError');
    expect(err.code).toBe('UNSUPPORTED_OPERATION');
    expect(err.operation).toBe('Consumer.onRebalance');
    expect(err.retryable).toBe(false);
    expect(err).toBeInstanceOf(StreamlineError);
  });

  it('includes the reason and the hint in the message', () => {
    const err = new UnsupportedOperationError('X.y', 'because', 'do z');
    expect(err.message).toContain('X.y is not supported by this client: because');
    expect(err.message).toContain('do z');
    expect(err.hint).toBe('do z');
  });
});
