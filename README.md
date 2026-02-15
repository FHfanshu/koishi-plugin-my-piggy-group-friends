# koishi-plugin-my-pig-group-friends

[![npm](https://img.shields.io/npm/v/koishi-plugin-my-pig-group-friends?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-my-pig-group-friends)

**猪醒** - 虚拟旅行打卡插件，让你的猪猪群友环游世界。

> 你群里有没有那种作息混乱、日夜颠倒的猪猪朋友？现在，每当他们在奇怪的时间冒泡，就送他们去世界各地"旅行"吧！

## 功能亮点

- **虚拟旅行打卡** - 生成精美毛玻璃效果足迹卡片，记录猪猪的环球之旅
- **智能日出选点** - LLM 会根据当前时间，选择正在迎接日出的地区作为目的地（毕竟是"猪醒"嘛）
- **高质量风景图** - 集成 Unsplash / Pexels API，获取目的地真实风景照片
- **AI 生图支持** - 可选生成小猪在当地旅行的 AI 插画
- **作息异常检测（实验性）** - 自动检测用户每日首条消息时间，判断作息是否异常
- **世界足迹地图** - 生成用户全球国家足迹地图与Top目的地统计

## 效果预览

当触发旅行时，会生成类似这样的卡片：

```
┌─────────────────────────────┐
│  [目的地风景照片背景]        │
│                             │
│  🐷 xxx 猪醒！              │
│                             │
│  去了 冰岛蓝湖温泉，冰岛！   │
│                             │
│  2024-01-15 06:32           │
└─────────────────────────────┘
```

## 安装

```bash
npm install koishi-plugin-my-pig-group-friends
```

## 依赖

### 必需
- `database` - 存储用户状态和旅行日志
- `cron` - 定时清理任务
- `puppeteer` - 渲染精美卡片

### 可选
- `chatluna` - LLM 动态生成旅行地点（推荐）
- `chatluna_storage` - 高效管理图片缓存
- `media-luna` - AI 绘图功能

## 使用方法

### 指令

| 指令 | 说明 |
|------|------|
| `pig` | 送自己去旅行 |
| `pig @某人` | 送指定用户去旅行 |
| `猪醒` | `pig` 的别名 |
| `pig.map` | 查看自己的世界足迹地图 |
| `pig.map @某人` | 查看指定用户世界足迹地图 |
| `世界足迹` | `pig.map` 的别名 |

### 示例

```
> 猪醒 @张三
🐷 张三 猪醒！去了 挪威罗弗敦群岛，挪威！
[精美卡片图片]
```

## 配置说明

### 最小可用配置（示例）

```yaml
my-pig-group-friends:
  outputMode: image
  travelMessageTemplate: 去了 {landmark}，{country}！📸
  llmLocationEnabled: false
  worldMapUseTianditu: false
  worldMapOfficialOnly: false
  monthlySummaryEnabled: false
  monthlySummaryScope: global
  debug: false
```

### 进阶配置（示例）

```yaml
my-pig-group-friends:
  outputMode: image
  travelMessageTemplate: 去了 {landmark}，{country}！📸

  llmLocationEnabled: true
  llmLocationModel: your-provider/your-model
  llmLocationCustomContext: 偏好北欧和小众自然景观
  llmFailureCooldownMs: 300000
  imageSearchPrompt: '{landmark} {country} landscape'
  unsplashAccessKey: ''
  pexelsApiKey: ''

  backgroundFetchMode: auto
  backgroundFetchTimeoutMs: 8000
  backgroundInlineMaxBytes: 8388608
  backgroundStoragePath: ./data/pig/backgrounds

  worldMapUseTianditu: true
  tiandituToken: ''
  tiandituTimeoutMs: 5000
  worldMapOfficialOnly: false

  aigcEnabled: false
  aigcChannel: ''
  aigcPrompt: 一个可爱的卡通小猪正在 {country} 的 {landmark} 前面自拍，阳光明媚，旅游照片风格

  experimentalAutoDetect: false
  experimentalAutoDetectScope: guild
  abnormalThreshold: 3
  defaultLat: 30
  defaultLng: 120

  silentRecordEnabled: true
  silentRecordAutoTravel: false

  nightOwlEnabled: true
  nightOwlStartHour: 0
  nightOwlEndHour: 5
  nightOwlGrayscaleAvatar: false

  useStorageService: true
  storageCacheHours: 24
  logRetentionDays: 45
  monthlySummaryEnabled: false
  monthlySummaryScope: global
  debug: false
```

### 常显配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `outputMode` | `image` | 输出模式：`image` 生成卡片，`text` 纯文本 |
| `travelMessageTemplate` | `去了 {landmark}，{country}！📸` | 旅行消息模板 |
| `backgroundFetchMode` | `auto` | 背景图拉取策略（auto/always/never） |
| `backgroundFetchTimeoutMs` | `8000` | 背景图拉取超时（毫秒） |
| `backgroundInlineMaxBytes` | `8388608` | 背景图转 data URL 的最大字节数 |
| `backgroundStoragePath` | `./data/pig/backgrounds` | 自定义背景图存储路径 |
| `worldMapOfficialOnly` | `false` | 仅展示官方底图，不做国家填色高亮 |
| `defaultLat` | `30` | 默认纬度（用于日出相关逻辑） |
| `defaultLng` | `120` | 默认经度（用于日出相关逻辑） |
| `logRetentionDays` | `45` | 旅行日志保留天数 |
| `monthlySummaryEnabled` | `false` | 是否启用每月自动总结（不影响手动 `pig.summary`） |
| `monthlySummaryScope` | `global` | 月度总结范围：`global`/`guild` |
| `debug` | `false` | 输出详细调试日志 |

### 按开关显示的配置项

| 开关 | 子项（仅开关为 `true` 时显示） |
|------|-------------------------------|
| `llmLocationEnabled` | `llmLocationModel`、`llmLocationCustomContext`、`llmFailureCooldownMs`、`imageSearchPrompt`、`unsplashAccessKey`、`pexelsApiKey` |
| `aigcEnabled` | `aigcChannel`、`aigcPrompt` |
| `worldMapUseTianditu` | `tiandituToken`、`tiandituTimeoutMs` |
| `experimentalAutoDetect` | `experimentalAutoDetectScope`、`abnormalThreshold` |
| `silentRecordEnabled` | `silentRecordAutoTravel` |
| `nightOwlEnabled` | `nightOwlStartHour`、`nightOwlEndHour`、`nightOwlGrayscaleAvatar` |
| `useStorageService` | `storageCacheHours` |

### 废弃兼容字段

以下字段仅兼容旧配置，当前版本已忽略，后续版本将移除：

- `sunriseApi`
- `logPath`

## 获取 API 密钥

### Unsplash（推荐）
1. 访问 [Unsplash Developers](https://unsplash.com/developers)
2. 创建应用，获取 Access Key
3. 免费额度：50 次/小时

### Pexels（备用）
1. 访问 [Pexels API](https://www.pexels.com/api/)
2. 注册并获取 API Key
3. 免费额度：200 次/小时

## License

MIT
