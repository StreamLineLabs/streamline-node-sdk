import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitState } from '../circuit-breaker';
import { StreamlineError } from '../types';

describe('CircuitBreaker', () => {
  describe('initial state', () => {
    it('starts in closed state', () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe(CircuitState.Closed);
    });

    it('allows requests when closed', () => {
      const cb = new CircuitBreaker();
      expect(cb.allow()).toBe(true);
    });
  });

  describe('closed → open transition', () => {
    it('opens after failure threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });

      for (let i = 0; i < 3; i++) {
        cb.allow();
        cb.recordFailure();
      }

      expect(cb.getState()).toBe(CircuitState.Open);
      expect(cb.allow()).toBe(false);
    });

    it('does not open below threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });

      cb.allow();
      cb.recordFailure();
      cb.allow();
      cb.recordFailure();

      expect(cb.getState()).toBe(CircuitState.Closed);
      expect(cb.allow()).toBe(true);
    });
  });

  describe('open → half-open transition', () => {
    it('transitions to half-open after timeout', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        openTimeout: 50,
      });

      cb.allow();
      cb.recordFailure();
      cb.allow();
      cb.recordFailure();
      expect(cb.getState()).toBe(CircuitState.Open);

      await new Promise(r => setTimeout(r, 60));

      expect(cb.getState()).toBe(CircuitState.HalfOpen);
      expect(cb.allow()).toBe(true);
    });
  });

  describe('half-open → closed transition', () => {
    it('closes on sufficient successes', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        openTimeout: 50,
      });

      cb.allow();
      cb.recordFailure();
      cb.allow();
      cb.recordFailure();

      await new Promise(r => setTimeout(r, 60));

      cb.allow();
      cb.recordSuccess();

      expect(cb.getState()).toBe(CircuitState.Closed);
    });
  });

  describe('half-open → open transition', () => {
    it('reopens on failure in half-open state', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 2,
        openTimeout: 50,
      });

      cb.allow();
      cb.recordFailure();
      cb.allow();
      cb.recordFailure();

      await new Promise(r => setTimeout(r, 60));

      cb.allow();
      cb.recordFailure();

      expect(cb.getState()).toBe(CircuitState.Open);
    });
  });

  describe('half-open request limiting', () => {
    it('limits probe requests in half-open state', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        openTimeout: 50,
        halfOpenMaxRequests: 2,
      });

      cb.allow();
      cb.recordFailure();

      await new Promise(r => setTimeout(r, 60));

      expect(cb.allow()).toBe(true);  // first probe
      expect(cb.allow()).toBe(true);  // second probe
      expect(cb.allow()).toBe(false); // third rejected
    });
  });

  describe('success resets failure count', () => {
    it('resets failure count on success in closed state', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });

      cb.allow();
      cb.recordFailure();
      cb.allow();
      cb.recordFailure();
      cb.allow();
      cb.recordSuccess(); // resets

      cb.allow();
      cb.recordFailure();
      cb.allow();
      cb.recordFailure();

      expect(cb.getState()).toBe(CircuitState.Closed);
    });
  });

  describe('reset', () => {
    it('returns to closed state', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, openTimeout: 600000 });

      cb.allow();
      cb.recordFailure();
      expect(cb.getState()).toBe(CircuitState.Open);

      cb.reset();

      expect(cb.getState()).toBe(CircuitState.Closed);
      expect(cb.allow()).toBe(true);
    });
  });

  describe('state change callback', () => {
    it('fires on each transition', async () => {
      const transitions: string[] = [];

      const cb = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 1,
        openTimeout: 50,
        halfOpenMaxRequests: 1,
        onStateChange: (from, to) => transitions.push(`${from}->${to}`),
      });

      cb.allow();
      cb.recordFailure(); // CLOSED -> OPEN

      await new Promise(r => setTimeout(r, 60));
      cb.allow(); // OPEN -> HALF_OPEN
      cb.recordSuccess(); // HALF_OPEN -> CLOSED

      expect(transitions).toEqual([
        `${CircuitState.Closed}->${CircuitState.Open}`,
        `${CircuitState.Open}->${CircuitState.HalfOpen}`,
        `${CircuitState.HalfOpen}->${CircuitState.Closed}`,
      ]);
    });
  });

  describe('execute()', () => {
    it('returns result on success', async () => {
      const cb = new CircuitBreaker();

      const result = await cb.execute(async () => 'hello');

      expect(result).toBe('hello');
    });

    it('throws StreamlineError when circuit is open', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, openTimeout: 600000 });

      cb.allow();
      cb.recordFailure();

      await expect(cb.execute(async () => 'unreachable'))
        .rejects.toThrow('Circuit breaker is open');

      try {
        await cb.execute(async () => 'unreachable');
      } catch (err) {
        expect(err).toBeInstanceOf(StreamlineError);
        expect((err as StreamlineError).retryable).toBe(true);
        expect((err as StreamlineError).code).toBe('CIRCUIT_OPEN');
      }
    });

    it('records failure on retryable error', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 2, openTimeout: 600000 });

      const retryableError = new StreamlineError('transient', 'CONN', true);

      await expect(cb.execute(async () => { throw retryableError; })).rejects.toThrow();
      await expect(cb.execute(async () => { throw retryableError; })).rejects.toThrow();

      expect(cb.getState()).toBe(CircuitState.Open);
    });

    it('does not trip on non-retryable error', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 2, openTimeout: 600000 });

      const nonRetryableError = new StreamlineError('auth', 'AUTH', false);

      for (let i = 0; i < 5; i++) {
        await expect(cb.execute(async () => { throw nonRetryableError; })).rejects.toThrow();
      }

      expect(cb.getState()).toBe(CircuitState.Closed);
    });
  });
});
