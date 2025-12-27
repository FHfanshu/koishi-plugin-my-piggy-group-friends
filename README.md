# koishi-plugin-my-pig-group-friends

[![npm](https://img.shields.io/npm/v/koishi-plugin-my-pig-group-friends?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-my-pig-group-friends)

猪醒 - 虚拟旅行打卡插件，让你的猪猪群友环游世界。

## 功能特点

- **虚拟旅行打卡**：随机（或通过 LLM）生成全球旅行地点，生成精美毛玻璃效果足迹卡片
- **作息异常检测（实验性）**：自动检测用户每日首条消息，根据当地日出时间判断作息是否异常并触发旅行
- **高质量背景**：集成 Unsplash API 获取目的地真实风景图
- **AI 生图支持**：支持通过 media-luna 插件生成小猪在当地旅行的 AI 插画
- **存储集成**：深度集成 chatluna-storage-service 进行图片管理

## 安装

```bash
npm install koishi-plugin-my-pig-group-friends
```

## 依赖

### 必需
- `database` - 存储用户状态和旅行日志
- `cron` - 定时清理和报表生成
- `puppeteer` - 生成精美卡片

### 可选
- `chatluna` - 用于 LLM 动态生成旅行地点
- `chatluna_storage` - 用于高效管理和分发生成的图片卡片
- `media-luna` - 用于 AI 绘图功能

## 使用方法

### 指令

- `pig [user]` - 触发一次虚拟旅行。如果不指定用户，则对自己生效。
- `猪醒 [user]` - `pig` 指令的别名。

## 配置项

### 基础设置
- `outputMode`: 输出模式（image/text）。
- `travelMessageTemplate`: 旅行消息模板。

### 地点与图片
- `llmLocationEnabled`: 是否启用 LLM 动态生成地点。
- `llmLocationModel`: 生成地点的 LLM 模型（推荐使用轻量快速模型）。
- `unsplashAccessKey`: Unsplash API 访问密钥。

### AI 生图（可选）
- `aigcEnabled`: 是否启用 AI 绘图。
- `aigcChannel`: media-luna 绘图渠道。
- `aigcPrompt`: 绘图提示词模板。

### 自动检测（实验性）
- `experimentalAutoDetect`: 是否启用自动作息异常检测。
- `abnormalThreshold`: 异常判定阈值（小时）。

## License

MIT
