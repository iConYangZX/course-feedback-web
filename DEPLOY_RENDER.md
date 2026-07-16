# Render 测试版部署步骤

本分支仅用于测试版。代码会强制禁用 `DATABASE_URL`，并使用 Render 的临时目录保存测试数据，不会读取或写入正式版数据库。

## 1. 上传到 GitHub

新建一个 GitHub 仓库，建议仓库名：

```text
course-feedback-web
```

上传项目时不要上传 `.env`，项目里的 `.gitignore` 已经把 `.env` 排除了。

## 2. 在 Render 新建 Web Service

Render 后台选择：

```text
New + -> Web Service
```

连接刚才的 GitHub 仓库后，填写：

```text
Name: course-feedback-web-staging
Runtime: Node
Build Command: npm install
Start Command: npm start
```

## 3. 填环境变量

在 Render 的 Environment 里填写：

```text
DEPLOYMENT_TARGET=staging
PUBLIC_MODE=true
ACCESS_CODE=SXB22660147
DAILY_LIMIT=10
MAX_UPLOAD_TOTAL_MB=48
AI_PROVIDER=custom
CUSTOM_MODEL=gpt-5.4-mini
CUSTOM_BASE_URL=https://api.tokenskingdom.com/v1
CUSTOM_API_KEY=你的 AI API Key
SESSION_SECRET=任意一串长密码
```

测试服务不要填写 `DATABASE_URL`。即使误填，测试分支也会忽略它。

`MAX_UPLOAD_TOTAL_MB=48` 表示一次请求中全部上传文件合计最多 48MB；单个文件仍最多 20MB。需要调整时建议保持在 20-80MB，避免免费实例因多文件同时驻留内存而退出。

不要填写本机代理地址，也不要上传 `.env`。

## 4. 部署后测试

Render 部署完成后会给一个网址，通常类似：

```text
https://course-feedback-web-staging.onrender.com
```

打开网址后输入邀请码：

```text
SXB22660147
```

然后先用 1 个学生测试生成，确认 AI 正常、次数限制正常。

## 5. 注意

Render 免费服务可能会休眠，第一次打开可能需要等待一会儿。AI 调用费用由你的 AI 平台产生，网站的 10 次/天限制用于控制消耗。

测试版账号、班级、课件和教学记录只写入测试服务的临时目录，服务重启或重新部署后可能清空。这是为了与正式数据库硬隔离。
