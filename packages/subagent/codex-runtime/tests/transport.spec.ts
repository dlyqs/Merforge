import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { JsonRpcLineTransport } from '../src/index.ts'

const task = () => new Promise<void>((resolve) => { setImmediate(resolve) })
describe('bounded persistent line transport', () => {
  it('counts UTF-8 bytes and whitespace in a complete frame, including exact limits', async () => {
    const frame = JSON.stringify({ method: 'delta', params: { text: '你' } })
    for (const extra of [0, 1]) {
      const input = new PassThrough(); const output = new PassThrough()
      const transport = new JsonRpcLineTransport(input, output, { maxFrameBytes: Buffer.byteLength(frame), strict: true })
      const observed = vi.fn(); const failed = vi.fn()
      transport.onNotification(observed); transport.onFailure(failed); transport.start()
      input.write(`${frame}${' '.repeat(extra)}\n`)
      await task()
      expect(observed).toHaveBeenCalledTimes(extra === 0 ? 1 : 0)
      expect(failed).toHaveBeenCalledTimes(extra)
      transport.close()
    }
  })
  it('rejects an oversized partial frame without waiting for a newline', async () => {
    const input = new PassThrough(); const output = new PassThrough()
    const transport = new JsonRpcLineTransport(input, output, { maxFrameBytes: 8, strict: true })
    const failed = vi.fn(); transport.onFailure(failed); transport.start()
    input.write('你你你')
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'JSON-RPC frame-limit' }))
    expect(input.listenerCount('data')).toBe(0)
    await expect(transport.request('closed', {})).rejects.toThrow('closed')
    transport.close()
  })
  it('suppresses a late server response and refuses writes after close', async () => {
    const input = new PassThrough(); const output = new PassThrough()
    const transport = new JsonRpcLineTransport(input, output, { maxFrameBytes: 1000, strict: true })
    const gate = Promise.withResolvers<string>(); const frames: string[] = []
    output.on('data', chunk => frames.push(String(chunk)))
    transport.onRequest(() => gate.promise); transport.start()
    input.write('{"id":"native-request","method":"ask","params":{}}\n')
    transport.close(); gate.resolve('late')
    await task()
    expect(frames).toEqual([])
    expect(() =>{  transport.notify('late') }).toThrow('closed')
  })
  it('contains callback failures and observes asynchronous output errors', async () => {
    const input = new PassThrough()
    const output = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('pipe-broke')) } })
    const transport = new JsonRpcLineTransport(input, output, { maxFrameBytes: 1000, strict: true })
    transport.onFailure(() => { throw new Error('observer-broke') }); transport.start()
    await expect(transport.request('test', {})).rejects.toThrow('pipe-broke')
    await task(); transport.close()
    output.emit('error', new Error('late-pipe-error'))
  })
})
