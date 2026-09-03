import { describe, it, expect, vi, afterEach } from 'vitest';
import { Streamline } from '../client';
import { Consumer } from '../consumer';
import { Producer } from '../producer';
import { StreamlineError, UnsupportedOperationError } from '../types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Streamline.httpEndpoint', () => {
  it('exposes the resolved default endpoint', () => {
    expect(new Streamline('localhost:9092').httpEndpoint).toBe('http://localhost:9094');
  });

  it('exposes an explicitly configured endpoint', () => {
    expect(
      new Streamline('localhost:9092', { httpEndpoint: 'https://broker:8443' }).httpEndpoint,
    ).toBe('https://broker:8443');
  });
});

describe('Promise contract of synchronous public methods', () => {
  it('Streamline.close() returns a promise and aborts in-flight requests', async () => {
    const client = new Streamline('localhost:9092');
    await client.connect().catch(() => undefined);
    const result = client.close();
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });

  it('Consumer.start() returns a promise and seeks reject explicitly', async () => {
    const consumer = new Consumer(new Streamline('localhost:9092'), 'topic', 'group');
    expect(consumer.start()).toBeInstanceOf(Promise);
    const seek = consumer.seek(0, 5);
    expect(seek).toBeInstanceOf(Promise);
    await expect(seek).rejects.toBeInstanceOf(UnsupportedOperationError);
    await consumer.close();
  });

  it('Consumer.seekToEnd() rejects rather than resolving without effect', async () => {
    const client = new Streamline('localhost:9092');
    const consumer = new Consumer(client, 'topic');
    const result = consumer.seekToEnd();
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toBeInstanceOf(UnsupportedOperationError);
  });

  it('Producer.start() returns a promise', async () => {
    const producer = new Producer(new Streamline('localhost:9092'), 'topic');
    const started = producer.start();
    expect(started).toBeInstanceOf(Promise);
    await expect(started).resolves.toBeUndefined();
  });

  it('Producer.beginTransaction() rejects instead of throwing synchronously', async () => {
    const producer = new Producer(new Streamline('localhost:9092'), 'topic');
    await producer.beginTransaction();

    let result: Promise<void> | undefined;
    expect(() => {
      result = producer.beginTransaction();
    }).not.toThrow();
    await expect(result).rejects.toThrow(StreamlineError);
    await expect(producer.beginTransaction()).rejects.toThrow(/Transaction already in progress/);
  });

  it('Producer.beginTransaction() rejects once the producer is closed', async () => {
    const producer = new Producer(new Streamline('localhost:9092'), 'topic');
    await producer.close();
    await expect(producer.beginTransaction()).rejects.toThrow(/Producer is closed/);
  });

  it('Producer.abortTransaction() rejects without an open transaction', async () => {
    const producer = new Producer(new Streamline('localhost:9092'), 'topic');
    let result: Promise<void> | undefined;
    expect(() => {
      result = producer.abortTransaction();
    }).not.toThrow();
    await expect(result).rejects.toThrow(/No transaction in progress/);
  });

  it('Producer.abortTransaction() rejects buffered sends', async () => {
    const producer = new Producer(new Streamline('localhost:9092'), 'topic');
    await producer.beginTransaction();
    const buffered = producer.send({ value: 'x' });
    await producer.abortTransaction();
    await expect(buffered).rejects.toThrow(/Transaction aborted/);
    await expect(producer.abortTransaction()).rejects.toThrow(/No transaction in progress/);
  });
});

describe('Consumer.search', () => {
  function makeConsumer(): { consumer: Consumer; client: Streamline } {
    const client = new Streamline('localhost:9092');
    return { consumer: new Consumer(client, 'topic'), client };
  }

  it('posts the query to the topic search route', async () => {
    const { consumer, client } = makeConsumer();
    const spy = vi
      .spyOn(client, 'request')
      .mockResolvedValue(new Response(JSON.stringify({ hits: [], took_ms: 1 }), { status: 200 }));

    await consumer.search('my topic/1', 'hello');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/v1/topics/my%20topic%2F1/search');
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ query: 'hello', k: 10 });
  });

  it('honours the k option', async () => {
    const { consumer, client } = makeConsumer();
    const spy = vi
      .spyOn(client, 'request')
      .mockResolvedValue(new Response(JSON.stringify({ hits: [] }), { status: 200 }));

    await consumer.search('t', 'q', { k: 3 });
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body)).k).toBe(3);
  });

  it('returns the hits array', async () => {
    const { consumer, client } = makeConsumer();
    const hits = [{ offset: 1, score: 0.9, value: 'a' }];
    vi.spyOn(client, 'request').mockResolvedValue(
      new Response(JSON.stringify({ hits }), { status: 200 }),
    );
    await expect(consumer.search('t', 'q')).resolves.toEqual(hits);
  });

  it('returns an empty array when hits are omitted', async () => {
    const { consumer, client } = makeConsumer();
    vi.spyOn(client, 'request').mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(consumer.search('t', 'q')).resolves.toEqual([]);
  });

  it('throws a retryable StreamlineError on a non-2xx response', async () => {
    const { consumer, client } = makeConsumer();
    vi.spyOn(client, 'request').mockResolvedValue(
      new Response('index unavailable', { status: 503 }),
    );

    await expect(consumer.search('t', 'q')).rejects.toThrow(StreamlineError);

    vi.spyOn(client, 'request').mockResolvedValue(
      new Response('index unavailable', { status: 503 }),
    );
    const error = await consumer.search('t', 'q').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StreamlineError);
    expect((error as StreamlineError).code).toBe('SEARCH_ERROR');
    expect((error as StreamlineError).retryable).toBe(true);
  });
});
