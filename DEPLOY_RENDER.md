# Render 部署步骤

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
Name: course-feedback-web
Runtime: Node
Build Command: npm install
Start Command: npm start
```

如果需要在网页里创建账号、保存每日使用次数，请给服务添加一个 Persistent Disk：

```text
Mount Path: /var/data
```

## 3. 填环境变量

在 Render 的 Environment 里填写：

```text
PUBLIC_MODE=true
ACCESS_CODE=SXB22660147
DAILY_LIMIT=10
AI_PROVIDER=custom
CUSTOM_MODEL=gpt-5.4-mini
CUSTOM_BASE_URL=https://api.tokenskingdom.com/v1
CUSTOM_API_KEY=你的 AI API Key
SESSION_SECRET=任意一串长密码
DATA_DIR=/var/data
```

不要填写本机代理地址，也不要上传 `.env`。

## 4. 部署后测试

Render 部署完成后会给一个网址，通常类似：

```text
https://course-feedback-web.onrender.com
```

打开网址后输入邀请码：

```text
SXB22660147
```

然后先用 1 个学生测试生成，确认 AI 正常、次数限制正常。

## 5. 注意

Render 免费服务可能会休眠，第一次打开可能需要等待一会儿。AI 调用费用由你的 AI 平台产生，网站的 10 次/天限制用于控制消耗。

管理员在网页中创建的账号和每日次数记录会写入 `DATA_DIR`。如果没有配置 Persistent Disk 和 `DATA_DIR=/var/data`，Render 重启或重新部署后这些数据可能会丢失。
