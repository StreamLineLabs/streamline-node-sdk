import { describe, it, expect, beforeEach } from 'vitest';
import { ClientMetrics } from '../metrics';

describe('ClientMetrics', () => {
  let metrics: ClientMetrics;

  beforeEach(() => {
    metrics = new ClientMetrics();
  });

  it('should initialize with zero counters', () => {
    const snap = metrics.snapshot();
    expect(snap.messagesProduced).toBe(0);
    expect(snap.messagesConsumed).toBe(0);
    expect(snap.bytesSent).toBe(0);
    expect(snap.bytesReceived).toBe(0);
    expect(snap.errorsTotal).toBe(0);
  });

  it('should initialize as healthy', () => {
    expect(metrics.snapshot().isHealthy).toBe(true);
  });

  it('should initialize with zero active connections', () => {
    expect(metrics.snapshot().activeConnections).toBe(0);
  });

  it('should initialize with zero latency averages', () => {
    const snap = metrics.snapshot();
    expect(snap.produceLatencyAvgMs).toBe(0);
    expect(snap.consumeLatencyAvgMs).toBe(0);
  });

  it('should track uptime', () => {
    const snap = metrics.snapshot();
    expect(snap.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  describe('recordProduce', () => {
    it('should increment messages produced', () => {
      metrics.recordProduce(5, 1024, 10);
      expect(metrics.snapshot().messagesProduced).toBe(5);
    });

    it('should increment bytes sent', () => {
      metrics.recordProduce(1, 256, 5);
      expect(metrics.snapshot().bytesSent).toBe(256);
    });

    it('should accumulate across multiple calls', () => {
      metrics.recordProduce(3, 100, 5);
      metrics.recordProduce(7, 200, 10);
      const snap = metrics.snapshot();
      expect(snap.messagesProduced).toBe(10);
      expect(snap.bytesSent).toBe(300);
    });

    it('should calculate average produce latency', () => {
      metrics.recordProduce(1, 100, 10);
      metrics.recordProduce(1, 100, 20);
      metrics.recordProduce(1, 100, 30);
      expect(metrics.snapshot().produceLatencyAvgMs).toBe(20);
    });
  });

  describe('recordConsume', () => {
    it('should increment messages consumed', () => {
      metrics.recordConsume(10, 4096, 15);
      expect(metrics.snapshot().messagesConsumed).toBe(10);
    });

    it('should increment bytes received', () => {
      metrics.recordConsume(1, 512, 8);
      expect(metrics.snapshot().bytesReceived).toBe(512);
    });

    it('should calculate average consume latency', () => {
      metrics.recordConsume(1, 100, 5);
      metrics.recordConsume(1, 100, 15);
      expect(metrics.snapshot().consumeLatencyAvgMs).toBe(10);
    });
  });

  describe('recordError', () => {
    it('should increment error count', () => {
      metrics.recordError();
      expect(metrics.snapshot().errorsTotal).toBe(1);
    });

    it('should accumulate errors', () => {
      metrics.recordError();
      metrics.recordError();
      metrics.recordError();
      expect(metrics.snapshot().errorsTotal).toBe(3);
    });
  });

  describe('setActiveConnections', () => {
    it('should update connection count', () => {
      metrics.setActiveConnections(5);
      expect(metrics.snapshot().activeConnections).toBe(5);
    });

    it('should replace previous value', () => {
      metrics.setActiveConnections(5);
      metrics.setActiveConnections(3);
      expect(metrics.snapshot().activeConnections).toBe(3);
    });
  });

  describe('setHealthy', () => {
    it('should update health status', () => {
      metrics.setHealthy(false);
      expect(metrics.snapshot().isHealthy).toBe(false);
    });

    it('should toggle back to healthy', () => {
      metrics.setHealthy(false);
      metrics.setHealthy(true);
      expect(metrics.snapshot().isHealthy).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset all counters to zero', () => {
      metrics.recordProduce(10, 1024, 5);
      metrics.recordConsume(20, 2048, 10);
      metrics.recordError();
      metrics.setActiveConnections(3);
      metrics.setHealthy(false);

      metrics.reset();
      const snap = metrics.snapshot();

      expect(snap.messagesProduced).toBe(0);
      expect(snap.messagesConsumed).toBe(0);
      expect(snap.bytesSent).toBe(0);
      expect(snap.bytesReceived).toBe(0);
      expect(snap.errorsTotal).toBe(0);
      expect(snap.produceLatencyAvgMs).toBe(0);
      expect(snap.consumeLatencyAvgMs).toBe(0);
      expect(snap.activeConnections).toBe(0);
      expect(snap.isHealthy).toBe(true);
    });

    it('should reset uptime', () => {
      const before = metrics.snapshot().uptimeMs;
      metrics.reset();
      const after = metrics.snapshot().uptimeMs;
      expect(after).toBeLessThanOrEqual(before + 10);
    });
  });

  describe('snapshot', () => {
    it('should return an independent object', () => {
      const snap1 = metrics.snapshot();
      metrics.recordProduce(5, 100, 10);
      const snap2 = metrics.snapshot();
      expect(snap1.messagesProduced).toBe(0);
      expect(snap2.messagesProduced).toBe(5);
    });

    it('should include all fields', () => {
      const snap = metrics.snapshot();
      const keys = Object.keys(snap);
      expect(keys).toContain('messagesProduced');
      expect(keys).toContain('messagesConsumed');
      expect(keys).toContain('bytesSent');
      expect(keys).toContain('bytesReceived');
      expect(keys).toContain('errorsTotal');
      expect(keys).toContain('produceLatencyAvgMs');
      expect(keys).toContain('consumeLatencyAvgMs');
      expect(keys).toContain('activeConnections');
      expect(keys).toContain('isHealthy');
      expect(keys).toContain('uptimeMs');
    });
  });
});
