import { BridgeError } from './errors'

/** Bounded, instance-owned queue. A rejected task never poisons the next one. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve()
  private pending = 0
  private closed = false

  constructor(private readonly capacity = 64) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed) throw new BridgeError('disposed', '插件正在停用，请稍后再试。')
    if (this.pending >= this.capacity) throw new BridgeError('busy', '当前操作较多，请稍后再试。')
    this.pending++
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>(resolve => { release = resolve })
    try {
      await previous
      if (this.closed) throw new BridgeError('disposed', '插件正在停用，请稍后再试。')
      return await task()
    } finally {
      this.pending--
      release()
    }
  }

  close() { this.closed = true }
  drain() { return this.tail }
}
