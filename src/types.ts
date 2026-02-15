import { MediaLunaService } from 'koishi-plugin-media-luna'
import { Service } from 'koishi'
import { BaseMessage } from '@langchain/core/messages'

interface Puppeteer extends Service {
  page(): Promise<any> // Using any to avoid complex type dependencies if puppeteer types aren't available
  render(html: string): Promise<string>
}

interface TempFileInfoWithData {
  path: string
  name: string
  type?: string
  expireTime: Date
  id: string
  size: number
  accessTime: Date
  accessCount: number
  data: Promise<Buffer>
  url: string
}

interface ChatLunaStorageService extends Service {
  createTempFile(buffer: Buffer, filename: string, expireHours?: number): Promise<TempFileInfoWithData>
  getTempFile(id: string): Promise<TempFileInfoWithData | null>
}

// ChatModel interface for LLM invocation
interface ChatModel {
  invoke(messages: BaseMessage[], options?: { temperature?: number }): Promise<{ content: string | object }>
}

// Chatluna service for LLM access
interface ChatlunaService extends Service {
  createChatModel(modelName: string): Promise<{ value: ChatModel | undefined }>
}

// 扩展 Koishi Context 类型以包含服务
declare module 'koishi' {
  interface Context {
    mediaLuna?: MediaLunaService
    puppeteer: Puppeteer
    chatluna_storage?: ChatLunaStorageService
    chatluna?: ChatlunaService
  }
}

// 重新导出 media-luna 的类型
export type { GenerationResult, OutputAsset, FileData } from 'koishi-plugin-media-luna'

