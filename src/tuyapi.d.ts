declare module 'tuyapi' {
  interface TuyapiOptions {
    id: string
    key: string
    ip?: string
    version?: string
    name?: string
  }

  interface DpsData {
    dps?: Record<string, unknown>
  }

  class TuyAPI {
    constructor(options: TuyapiOptions)

    find(): Promise<void>
    connect(): Promise<void>
    disconnect(): Promise<void>
    get(options: { dps: number }): Promise<unknown>
    get(options: { schema: true }): Promise<string>
    set(options: { dps: number; set: unknown }): Promise<unknown>
    isConnected(): boolean

    on(event: 'data', callback: (data: DpsData | string) => void): this
    on(event: 'connected', callback: () => void): this
    on(event: 'disconnected', callback: () => void): this
    on(event: 'error', callback: (err: Error) => void): this
    on(event: 'heartbeat', callback: () => void): this
  }

  export default TuyAPI
}
