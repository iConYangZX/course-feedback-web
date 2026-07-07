# 自定义 AI 配置说明

这个网页把 AI Key 放在本地后端，不会放到浏览器页面里。

## 要改哪个文件

真正要填写的是这个文件：

```text
/Users/icon/Desktop/codex/course-feedback-web/.env
```

如果你用的是第三方中转/聚合平台，需要填写它提供的 URL、Key 和模型/渠道名：

```bash
AI_PROVIDER=custom
CUSTOM_API_KEY=你的平台密钥
CUSTOM_MODEL=平台里的模型或渠道名
CUSTOM_BASE_URL=平台提供的API端点URL

OPENAI_MODEL=gpt-5.4-mini
OPENAI_BASE_URL=https://api.openai.com/v1
HTTPS_PROXY=http://127.0.0.1:7897
PORT=5177
```

改完 `.env` 后，重启本地服务，网页就会调用真实 AI。

`HTTPS_PROXY` 用来让本地后端也走你的 VPN/代理。当前机器检测到的系统代理端口是 `127.0.0.1:7897`。

如果你用 OpenAI 官方 Key，把 `AI_PROVIDER` 改成 `openai`，并填写 `OPENAI_API_KEY`。

## 如果看不到 `.env`

macOS 会默认隐藏点开头的文件，所以 `.env` 在 Finder 里可能看不到。

在 Finder 里按：

```text
Command + Shift + .
```

就能显示隐藏文件。

## 现在的状态

如果当前提供方对应的 Key 是空的，网页可以正常跑，但生成的是演示反馈，不会真的调用 AI。
