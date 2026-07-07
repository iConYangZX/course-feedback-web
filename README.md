# AI 课程反馈网页

一个本地可运行的课程反馈网页应用。前端负责班级管理、学生表现录入、课件上传和复制反馈；后端支持 OpenAI 官方接口、DeepSeek，以及 OpenAI 兼容的第三方平台。

## 功能

- 选择班课或一对一
- 班课：建立班级、选择年级、导入学生名单、填写反馈模板
- 班课：导入当节课课件、逐个选择学生表现、填写特殊备注
- 一对一：快速录入单个学生并生成反馈
- AI 根据模板、课程内容、课件和学生表现生成反馈
- 每个学生反馈可一键复制，也支持复制全部
- 未配置 API Key 时返回演示反馈，方便先试流程

## 启动

```bash
cp .env.example .env
npm install
npm start
```

然后打开：

```text
http://localhost:5177
```

## 配置 AI

编辑 `.env`：

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

第三方平台一般需要“URL + 密钥 + 模型/渠道名”。如果使用 OpenAI 官方 Key，把 `AI_PROVIDER` 改成 `openai`，并填写 `OPENAI_API_KEY`。

## 课件支持

支持上传 PDF、PPTX、DOCX、TXT、MD 和图片。后端会提取 PDF、PPTX、DOCX、TXT、MD 的文字；PDF 和图片也可以作为文件/图片输入交给 OpenAI 模型分析。
